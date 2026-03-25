/**
 * merging.cpp — CUDA-accelerated video merge with transitions.
 *
 * Pipeline (single process, zero temp files):
 *   1. Open all input videos via FFmpeg avformat
 *   2. For each output frame:
 *      - Body zone: decode frame from current video → scale → encode
 *      - Transition zone: decode frameA + frameB → CUDA blend → encode
 *   3. Single NVENC encode pass → output .mp4
 *
 * OPTIMIZATION: Persistent decoders — each video decoder stays open,
 * frames read sequentially (no seek per frame). Only 2 decoders active
 * at any time (current clip + next clip during transitions).
 */

#include "merging.h"
#include "cuda_effects.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/opt.h>
#include <libavutil/imgutils.h>
#include <libswscale/swscale.h>
}

#include <cstdio>
#include <cstring>
#include <cmath>
#include <algorithm>
#include <chrono>

namespace merging {

// ── Transition name → enum mapping ──
TransitionType transitionFromName(const std::string& name) {
    if (name == "dissolve")    return TRANS_DISSOLVE;
    if (name == "fade")        return TRANS_FADE;
    if (name == "fadeblack")   return TRANS_FADEBLACK;
    if (name == "fadewhite")   return TRANS_FADEWHITE;
    if (name == "fadegrays")   return TRANS_FADEGRAYS;
    if (name == "fadefast")    return TRANS_FADEFAST;
    if (name == "fadeslow")    return TRANS_FADESLOW;
    if (name == "smoothleft")  return TRANS_SMOOTHLEFT;
    if (name == "smoothright") return TRANS_SMOOTHRIGHT;
    if (name == "smoothup")    return TRANS_SMOOTHUP;
    if (name == "smoothdown")  return TRANS_SMOOTHDOWN;
    if (name == "wipeleft")    return TRANS_WIPELEFT;
    if (name == "wiperight")   return TRANS_WIPERIGHT;
    if (name == "wipeup")      return TRANS_WIPEUP;
    if (name == "wipedown")    return TRANS_WIPEDOWN;
    if (name == "wipetl")      return TRANS_WIPETL;
    if (name == "wipetr")      return TRANS_WIPETR;
    if (name == "wipebl")      return TRANS_WIPEBL;
    if (name == "wipebr")      return TRANS_WIPEBR;
    if (name == "slideleft")   return TRANS_SLIDELEFT;
    if (name == "slideright")  return TRANS_SLIDERIGHT;
    if (name == "slideup")     return TRANS_SLIDEUP;
    if (name == "slidedown")   return TRANS_SLIDEDOWN;
    if (name == "coverleft")   return TRANS_COVERLEFT;
    if (name == "coverright")  return TRANS_COVERRIGHT;
    if (name == "coverup")     return TRANS_COVERUP;
    if (name == "coverdown")   return TRANS_COVERDOWN;
    if (name == "revealleft")  return TRANS_REVEALLEFT;
    if (name == "revealright") return TRANS_REVEALRIGHT;
    if (name == "revealup")    return TRANS_REVEALUP;
    if (name == "revealdown")  return TRANS_REVEALDOWN;
    if (name == "circleopen")  return TRANS_CIRCLEOPEN;
    if (name == "circleclose") return TRANS_CIRCLECLOSE;
    if (name == "circlecrop")  return TRANS_CIRCLECROP;
    if (name == "rectcrop")    return TRANS_RECTCROP;
    if (name == "radial")      return TRANS_RADIAL;
    if (name == "horzopen")    return TRANS_HORZOPEN;
    if (name == "horzclose")   return TRANS_HORZCLOSE;
    if (name == "vertopen")    return TRANS_VERTOPEN;
    if (name == "vertclose")   return TRANS_VERTCLOSE;
    if (name == "hlslice")     return TRANS_HLSLICE;
    if (name == "hrslice")     return TRANS_HRSLICE;
    if (name == "vuslice")     return TRANS_VUSLICE;
    if (name == "vdslice")     return TRANS_VDSLICE;
    if (name == "hlwind")      return TRANS_HLWIND;
    if (name == "hrwind")      return TRANS_HRWIND;
    if (name == "vuwind")      return TRANS_VUWIND;
    if (name == "vdwind")      return TRANS_VDWIND;
    if (name == "pixelize")    return TRANS_PIXELIZE;
    if (name == "zoomin")      return TRANS_ZOOMIN;
    if (name == "hblur")       return TRANS_HBLUR;
    if (name == "distance")    return TRANS_DISTANCE;
    if (name == "squeezeh")    return TRANS_SQUEEZEH;
    if (name == "squeezev")    return TRANS_SQUEEZEV;
    if (name == "diagtl")      return TRANS_DIAGTL;
    if (name == "diagtr")      return TRANS_DIAGTR;
    if (name == "diagbl")      return TRANS_DIAGBL;
    if (name == "diagbr")      return TRANS_DIAGBR;
    return TRANS_DISSOLVE;
}

// ═══════════════════════════════════════════════════
// PERSISTENT VIDEO DECODER — open once, read sequentially
// ═══════════════════════════════════════════════════

struct VideoDecoder {
    AVFormatContext* fmtCtx = nullptr;
    AVCodecContext* decCtx = nullptr;
    SwsContext* swsCtx = nullptr;
    int videoIdx = -1;
    int targetW = 0, targetH = 0;
    AVFrame* rawFrame = nullptr;
    AVPacket* pkt = nullptr;
    AVFrame* lastScaled = nullptr;
    bool eof = false;
    double currentPts = -1.0;  // Track current frame timestamp (seconds)

    bool open(const std::string& path, int tw, int th) {
        targetW = tw; targetH = th;
        if (avformat_open_input(&fmtCtx, path.c_str(), nullptr, nullptr) < 0)
            return false;
        avformat_find_stream_info(fmtCtx, nullptr);
        for (unsigned i = 0; i < fmtCtx->nb_streams; i++) {
            if (fmtCtx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
                videoIdx = (int)i; break;
            }
        }
        if (videoIdx < 0) return false;
        auto* par = fmtCtx->streams[videoIdx]->codecpar;
        const AVCodec* codec = avcodec_find_decoder(par->codec_id);
        decCtx = avcodec_alloc_context3(codec);
        avcodec_parameters_to_context(decCtx, par);
        avcodec_open2(decCtx, codec, nullptr);
        rawFrame = av_frame_alloc();
        pkt = av_packet_alloc();
        return true;
    }

    void scaleRaw() {
        if (!swsCtx) {
            swsCtx = sws_getContext(
                rawFrame->width, rawFrame->height, (AVPixelFormat)rawFrame->format,
                targetW, targetH, AV_PIX_FMT_YUV420P,
                SWS_BILINEAR, nullptr, nullptr, nullptr);
        }
        if (!lastScaled) {
            lastScaled = av_frame_alloc();
            lastScaled->format = AV_PIX_FMT_YUV420P;
            lastScaled->width = targetW;
            lastScaled->height = targetH;
            av_frame_get_buffer(lastScaled, 32);
        }
        sws_scale(swsCtx, rawFrame->data, rawFrame->linesize, 0,
                  rawFrame->height, lastScaled->data, lastScaled->linesize);
    }

    // Read next raw frame from decoder (internal)
    bool readNextRaw() {
        if (eof) return false;
        while (av_read_frame(fmtCtx, pkt) >= 0) {
            if (pkt->stream_index != videoIdx) { av_packet_unref(pkt); continue; }
            avcodec_send_packet(decCtx, pkt);
            av_packet_unref(pkt);
            if (avcodec_receive_frame(decCtx, rawFrame) == 0) {
                auto* stream = fmtCtx->streams[videoIdx];
                currentPts = rawFrame->pts * av_q2d(stream->time_base);
                scaleRaw();
                return true;
            }
        }
        eof = true;
        return false;
    }

    // Get frame at the specified local timestamp (seconds from start of clip)
    // Advances decoder forward until reaching the target time.
    // Handles any source framerate (24, 30, 60, VFR) correctly.
    AVFrame* frameAt(double targetTime) {
        // First call: read the first frame
        if (currentPts < 0 && !eof) {
            readNextRaw();
        }
        // Already at or past EOF: return last decoded frame
        if (eof) return lastScaled;
        // Advance frames until we reach the target timestamp
        while (currentPts < targetTime - 0.016) { // 0.016 = ~half frame at 30fps
            if (!readNextRaw()) break; // EOF
        }
        return lastScaled;
    }

    AVFrame* nextFrame() {
        if (eof) return lastScaled;
        readNextRaw();
        return lastScaled;
    }

    double duration() const {
        if (!fmtCtx) return 0;
        return fmtCtx->duration / (double)AV_TIME_BASE;
    }

    void close() {
        if (lastScaled) av_frame_free(&lastScaled);
        if (rawFrame) av_frame_free(&rawFrame);
        if (pkt) av_packet_free(&pkt);
        if (swsCtx) { sws_freeContext(swsCtx); swsCtx = nullptr; }
        if (decCtx) avcodec_free_context(&decCtx);
        if (fmtCtx) avformat_close_input(&fmtCtx);
    }
};

// ═══════════════════════════════════════════════════════════
// MAIN MERGE PIPELINE (optimized: persistent decoders)
// ═══════════════════════════════════════════════════════════

MergeResult executeMerge(
    const MergeConfig& config,
    ProgressCallback onProgress,
    LogCallback onLog,
    StopCheck shouldStop)
{
    MergeResult result;
    result.totalClips = (int)config.videos.size();
    int n = result.totalClips;

    auto LOG = [&](const std::string& msg) {
        fprintf(stderr, "[MERGE] %s\n", msg.c_str());
        if (onLog) onLog(msg);
    };

    if (n < 2) {
        result.error = "Need at least 2 videos";
        return result;
    }

    // ── Step 1: Open all decoders + get durations ──
    LOG("Opening " + std::to_string(n) + " decoders...");
    std::vector<VideoDecoder> decs(n);
    std::vector<double> durations(n);
    for (int i = 0; i < n; i++) {
        if (!decs[i].open(config.videos[i], config.width, config.height)) {
            result.error = "Cannot open: " + config.videos[i];
            for (int j = 0; j < i; j++) decs[j].close();
            return result;
        }
        durations[i] = decs[i].duration();
    }

    double totalDur = durations[0];
    for (int i = 1; i < n; i++)
        totalDur += durations[i] - config.transitionDuration;
    result.totalDuration = totalDur;
    int fps = 30;
    int64_t totalFrames = (int64_t)(totalDur * fps);

    LOG("Total: " + std::to_string(totalDur) + "s, " +
        std::to_string(totalFrames) + " frames, " + std::to_string(n) + " clips");

    // ── Step 2: Resolve transition types ──
    std::vector<TransitionType> transTypes(n - 1);
    for (int i = 0; i < n - 1; i++) {
        transTypes[i] = i < (int)config.transitions.size()
            ? transitionFromName(config.transitions[i])
            : TRANS_DISSOLVE;
    }

    // ── Step 3: Setup encoder ──
    LOG("Encoder: " + std::string(config.useGpu ? "NVENC" : "CPU"));

    AVFormatContext* outFmtCtx = nullptr;
    avformat_alloc_output_context2(&outFmtCtx, nullptr, nullptr, config.outputPath.c_str());
    if (!outFmtCtx) { result.error = "Cannot create output"; goto cleanup_decs; }

    {
        const AVCodec* encoder = config.useGpu
            ? avcodec_find_encoder_by_name("h264_nvenc")
            : avcodec_find_encoder_by_name("libx264");
        if (!encoder) encoder = avcodec_find_encoder(AV_CODEC_ID_H264);

        AVStream* outStream = avformat_new_stream(outFmtCtx, nullptr);
        AVCodecContext* encCtx = avcodec_alloc_context3(encoder);

        encCtx->width = config.width;
        encCtx->height = config.height;
        encCtx->time_base = {1, fps};
        encCtx->framerate = {fps, 1};
        encCtx->pix_fmt = AV_PIX_FMT_YUV420P;
        encCtx->gop_size = 30;
        encCtx->max_b_frames = 2;

        if (config.useGpu) {
            av_opt_set(encCtx->priv_data, "preset", "p1", 0);
            av_opt_set(encCtx->priv_data, "rc", "vbr", 0);
            av_opt_set_int(encCtx->priv_data, "cq", 20, 0);
            av_opt_set(encCtx->priv_data, "profile", "high", 0);
            av_opt_set_int(encCtx->priv_data, "b_ref_mode", 0, 0); // no B-ref for compat
        } else {
            av_opt_set(encCtx->priv_data, "preset", "fast", 0);
            encCtx->bit_rate = 0;
            av_opt_set_int(encCtx->priv_data, "crf", 20, 0);
            av_opt_set(encCtx->priv_data, "profile", "high", 0);
        }

        if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER)
            encCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

        if (avcodec_open2(encCtx, encoder, nullptr) < 0) {
            // GPU encoder failed -> fallback to CPU libx264
            if (config.useGpu && std::string(encoder->name) == "h264_nvenc") {
                fprintf(stderr, "[MERGE] NVENC failed to open, falling back to libx264 CPU...\n");
                avcodec_free_context(&encCtx);
                encoder = avcodec_find_encoder(AV_CODEC_ID_H264);
                if (!encoder) {
                    result.error = "H264 CPU encoder not found";
                    avformat_free_context(outFmtCtx);
                    goto cleanup_decs;
                }
                encCtx = avcodec_alloc_context3(encoder);
                encCtx->width = config.width;
                encCtx->height = config.height;
                encCtx->time_base = {1, fps};
                encCtx->framerate = {fps, 1};
                encCtx->pix_fmt = AV_PIX_FMT_YUV420P;
                encCtx->gop_size = 30;
                encCtx->max_b_frames = 2;
                
                av_opt_set(encCtx->priv_data, "preset", "fast", 0);
                encCtx->bit_rate = 0;
                av_opt_set_int(encCtx->priv_data, "crf", 20, 0);
                av_opt_set(encCtx->priv_data, "profile", "high", 0);
                
                if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER)
                    encCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
                
                if (avcodec_open2(encCtx, encoder, nullptr) < 0) {
                    result.error = "Cannot open CPU encoder";
                    avcodec_free_context(&encCtx);
                    avformat_free_context(outFmtCtx);
                    goto cleanup_decs;
                }
            } else {
                result.error = "Cannot open encoder";
                avcodec_free_context(&encCtx);
                avformat_free_context(outFmtCtx);
                goto cleanup_decs;
            }
        }

        avcodec_parameters_from_context(outStream->codecpar, encCtx);
        outStream->time_base = encCtx->time_base;

        if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE))
            avio_open(&outFmtCtx->pb, config.outputPath.c_str(), AVIO_FLAG_WRITE);

        // movflags +faststart → MOOV atom ở đầu file → stream/upload OK
        AVDictionary* muxOpts = nullptr;
        av_dict_set(&muxOpts, "movflags", "+faststart", 0);
        avformat_write_header(outFmtCtx, &muxOpts);
        av_dict_free(&muxOpts);

        // ── Step 4: Init CUDA ──
        bool hasCuda = false;
#ifdef HAS_CUDA
        hasCuda = cudaEffectsInit();
        if (hasCuda) LOG("CUDA initialized");
        else LOG("CUDA init failed, using CPU blend");
#else
        LOG("Built without CUDA, using CPU blend");
#endif

        // ── Step 5: Build timeline ──
        std::vector<double> clipStart(n);
        clipStart[0] = 0;
        for (int i = 1; i < n; i++)
            clipStart[i] = clipStart[i-1] + durations[i-1] - config.transitionDuration;

        // Decoders start at frame 0 naturally after open() — no seek needed

        // ── Step 6: Frame-by-frame render ──
        LOG("Rendering " + std::to_string(totalFrames) + " frames...");
        auto startTime = std::chrono::steady_clock::now();

        AVFrame* encFrame = av_frame_alloc();
        encFrame->format = AV_PIX_FMT_YUV420P;
        encFrame->width = config.width;
        encFrame->height = config.height;
        av_frame_get_buffer(encFrame, 32);

        AVPacket* encPkt = av_packet_alloc();
        int64_t framesWritten = 0;


        for (int64_t f = 0; f < totalFrames; f++) {
            if (shouldStop && shouldStop()) break;

            double t = (double)f / fps;

            // Find current clip
            int clipIdx = 0;
            for (int i = n - 1; i >= 0; i--) {
                if (t >= clipStart[i]) { clipIdx = i; break; }
            }

            // Check transition zone
            // Transition from clip (clipIdx-1) to clipIdx occurs at clipStart[clipIdx]
            bool inTransition = false;
            double transProgress = 0;
            int transIdx = -1;

            if (clipIdx > 0) {
                double ts = clipStart[clipIdx];
                if (t >= ts && t < ts + config.transitionDuration) {
                    inTransition = true;
                    transProgress = (t - ts) / config.transitionDuration;
                    transIdx = clipIdx - 1;  // blend from previous clip to current
                }
            }

            if (inTransition && transIdx >= 0) {
                // ── Transition: timestamp-based reads from both decoders ──
                double localA = t - clipStart[transIdx];
                double localB = t - clipStart[transIdx + 1];
                AVFrame* frameA = decs[transIdx].frameAt(localA);
                AVFrame* frameB = decs[transIdx + 1].frameAt(localB);

                if (frameA && frameB) {
#ifdef HAS_CUDA
                    if (hasCuda) {
                        cudaTransitionBlend(
                            encFrame->data[0], encFrame->data[1], encFrame->data[2],
                            encFrame->linesize[0], encFrame->linesize[1],
                            frameA->data[0], frameA->data[1], frameA->data[2],
                            frameA->linesize[0], frameA->linesize[1],
                            frameB->data[0], frameB->data[1], frameB->data[2],
                            frameB->linesize[0], frameB->linesize[1],
                            config.width, config.height,
                            (float)transProgress, (int)transTypes[transIdx]
                        );
                    } else
#endif
                    {
                        float alpha = (float)transProgress;
                        int ySize = config.width * config.height;
                        for (int p = 0; p < ySize; p++)
                            encFrame->data[0][p] = (uint8_t)(frameA->data[0][p]*(1-alpha) + frameB->data[0][p]*alpha);
                        int uvSize = (config.width/2) * (config.height/2);
                        for (int p = 0; p < uvSize; p++) {
                            encFrame->data[1][p] = (uint8_t)(frameA->data[1][p]*(1-alpha) + frameB->data[1][p]*alpha);
                            encFrame->data[2][p] = (uint8_t)(frameA->data[2][p]*(1-alpha) + frameB->data[2][p]*alpha);
                        }
                    }
                } else if (frameA) {
                    av_frame_copy(encFrame, frameA);
                } else if (frameB) {
                    av_frame_copy(encFrame, frameB);
                }
            } else {
                // ── Body: timestamp-based read from current decoder ──
                double localT = t - clipStart[clipIdx];
                AVFrame* frame = decs[clipIdx].frameAt(localT);
                if (frame) av_frame_copy(encFrame, frame);
            }


            // Encode
            encFrame->pts = f;
            avcodec_send_frame(encCtx, encFrame);
            while (avcodec_receive_packet(encCtx, encPkt) == 0) {
                av_packet_rescale_ts(encPkt, encCtx->time_base, outStream->time_base);
                encPkt->stream_index = outStream->index;
                av_interleaved_write_frame(outFmtCtx, encPkt);
                av_packet_unref(encPkt);
            }
            framesWritten++;

            if (f % 30 == 0 && onProgress) {
                auto now = std::chrono::steady_clock::now();
                double elapsed = std::chrono::duration<double>(now - startTime).count();
                onProgress(f, totalFrames, elapsed > 0 ? f / elapsed : 0);
            }
        }

        // Flush
        avcodec_send_frame(encCtx, nullptr);
        while (avcodec_receive_packet(encCtx, encPkt) == 0) {
            av_packet_rescale_ts(encPkt, encCtx->time_base, outStream->time_base);
            encPkt->stream_index = outStream->index;
            av_interleaved_write_frame(outFmtCtx, encPkt);
            av_packet_unref(encPkt);
        }

        av_write_trailer(outFmtCtx);
        av_frame_free(&encFrame);
        av_packet_free(&encPkt);
        avcodec_free_context(&encCtx);
        if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE))
            avio_closep(&outFmtCtx->pb);
        avformat_free_context(outFmtCtx);

#ifdef HAS_CUDA
        if (hasCuda) cudaEffectsCleanup();
#endif

        LOG("Done! " + std::to_string(framesWritten) + " frames");
        result.success = !shouldStop || !shouldStop();
    }

cleanup_decs:
    for (int i = 0; i < n; i++) decs[i].close();
    return result;
}

} // namespace merging
