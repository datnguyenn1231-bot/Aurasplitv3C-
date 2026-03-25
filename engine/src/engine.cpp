/**
 * AuraEngine implementation Ã¢â‚¬â€ Phase 1: Skeleton decode Ã¢â€ â€™ encode Ã¢â€ â€™ mux.
 * Uses FFmpeg C API for zero-copy frame processing.
 */

#include "engine.h"
#include "effects.h"
#include "advanced_effects.h"
#ifdef HAS_CUDA
#include "cuda_effects.h"
#endif

extern "C" {
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>
}
#include <iostream>
#include <chrono>
#include <thread>
#include <mutex>
#include <atomic>
#include <random>
#include <cmath>

// Ã¢â€â‚¬Ã¢â€â‚¬ Constructor / Destructor Ã¢â€â‚¬Ã¢â€â‚¬

AuraEngine::AuraEngine() {
#ifdef HAS_CUDA
    if (!cudaEffectsAvailable()) {
        if (cudaEffectsInit()) {
            fprintf(stderr, "\nÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â\n");
            fprintf(stderr, "[CUDA] Ã¢Å“â€¦ GPU ACCELERATION ENABLED\n");
            fprintf(stderr, "[CUDA] Effects + BG Blur Ã¢â€ â€™ running on GPU\n");
            fprintf(stderr, "Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â\n\n");
        } else {
            fprintf(stderr, "\nÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â\n");
            fprintf(stderr, "[CUDA] Ã¢ÂÅ’ GPU NOT AVAILABLE Ã¢â‚¬â€ using CPU fallback\n");
            fprintf(stderr, "Ã¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢ÂÃ¢â€¢Â\n\n");
        }
    } else {
        fprintf(stderr, "[CUDA] Ã¢Å“â€¦ GPU already initialized\n");
    }
#else
    fprintf(stderr, "[ENGINE] Ã¢Å¡Â Ã¯Â¸Â Built WITHOUT CUDA Ã¢â‚¬â€ CPU-only mode\n");
#endif
}
AuraEngine::~AuraEngine() {
    // Note: don't cleanup CUDA here Ã¢â‚¬â€ it's shared across engine instances
}

void AuraEngine::stop() {
    stopped_ = true;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Open Input File Ã¢â€â‚¬Ã¢â€â‚¬

int AuraEngine::openInput(
    const std::string& inputPath,
    AVFormatContext*& fmtCtx,
    AVCodecContext*& videoDecCtx, int& videoStreamIdx,
    AVCodecContext*& audioDecCtx, int& audioStreamIdx,
    int targetOutW, int targetOutH)
{
    fmtCtx = nullptr;
    videoDecCtx = nullptr;
    audioDecCtx = nullptr;
    videoStreamIdx = -1;
    audioStreamIdx = -1;

    // Open input
    fprintf(stderr, "[ENGINE] Opening input: %s\n", inputPath.c_str());
    if (avformat_open_input(&fmtCtx, inputPath.c_str(), nullptr, nullptr) < 0) {
        lastError_ = "Cannot open input: " + inputPath;
        fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
        return -1;
    }
    fprintf(stderr, "[ENGINE] Input opened OK\n");

    if (avformat_find_stream_info(fmtCtx, nullptr) < 0) {
        lastError_ = "Cannot find stream info";
        avformat_close_input(&fmtCtx);
        return -1;
    }

    // Find video stream
    for (unsigned i = 0; i < fmtCtx->nb_streams; i++) {
        AVCodecParameters* par = fmtCtx->streams[i]->codecpar;
        if (par->codec_type == AVMEDIA_TYPE_VIDEO && videoStreamIdx < 0) {
            videoStreamIdx = i;
        } else if (par->codec_type == AVMEDIA_TYPE_AUDIO && audioStreamIdx < 0) {
            audioStreamIdx = i;
        }
    }

    if (videoStreamIdx < 0) {
        lastError_ = "No video stream found";
        avformat_close_input(&fmtCtx);
        return -1;
    }

    // Open video decoder Ã¢â‚¬â€ try NVDEC (h264_cuvid) first, CPU fallback
    const AVCodec* videoCodec = nullptr;
    AVBufferRef* hwDeviceCtx = nullptr;
    
    // Smart CUVID: try GPU decoder, validate first frame, auto-fallback if corrupt
    AVCodecID codecId = fmtCtx->streams[videoStreamIdx]->codecpar->codec_id;
    const char* hwDecoderName = nullptr;
    if (codecId == AV_CODEC_ID_H264) hwDecoderName = "h264_cuvid";
    else if (codecId == AV_CODEC_ID_HEVC) hwDecoderName = "hevc_cuvid";
    else if (codecId == AV_CODEC_ID_VP9) hwDecoderName = "vp9_cuvid";
    else if (codecId == AV_CODEC_ID_AV1) hwDecoderName = "av1_cuvid";
    
    bool useHwDecode = false;
    if (hwDecoderName) {
        videoCodec = avcodec_find_decoder_by_name(hwDecoderName);
        if (videoCodec && av_hwdevice_ctx_create(&hwDeviceCtx, AV_HWDEVICE_TYPE_CUDA, nullptr, nullptr, 0) == 0) {
            useHwDecode = true;
            fprintf(stderr, "[ENGINE] Using NVDEC decoder: %s\n", hwDecoderName);
        } else {
            fprintf(stderr, "[ENGINE] NVDEC unavailable, falling back to CPU decoder\n");
            videoCodec = nullptr;
            if (hwDeviceCtx) { av_buffer_unref(&hwDeviceCtx); hwDeviceCtx = nullptr; }
        }
    }
    
    // Fallback to CPU decoder
    if (!videoCodec) {
        videoCodec = avcodec_find_decoder(codecId);
    }
    if (!videoCodec) {
        lastError_ = "Video decoder not found";
        avformat_close_input(&fmtCtx);
        return -1;
    }

    videoDecCtx = avcodec_alloc_context3(videoCodec);
    avcodec_parameters_to_context(videoDecCtx, fmtCtx->streams[videoStreamIdx]->codecpar);
    
    if (useHwDecode && hwDeviceCtx) {
        videoDecCtx->hw_device_ctx = av_buffer_ref(hwDeviceCtx);
        av_buffer_unref(&hwDeviceCtx);
        fprintf(stderr, "[ENGINE] CUDA hw_device_ctx set\n");
    } else {
        // Multi-threaded CPU decoding
        videoDecCtx->thread_count = std::min(8, (int)std::thread::hardware_concurrency());
        videoDecCtx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
    }
    
    // CUVID GPU-side resize: scale on GPU before transfer to CPU
    // This dramatically reduces GPUÃ¢â€ â€™CPU transfer time (10msÃ¢â€ â€™3ms)
    AVDictionary* decoderOpts = nullptr;
    if (useHwDecode && targetOutW > 0 && targetOutH > 0) {
        int srcW = fmtCtx->streams[videoStreamIdx]->codecpar->width;
        int srcH = fmtCtx->streams[videoStreamIdx]->codecpar->height;
        double srcAsp = (double)srcW / srcH;
        double dstAsp = (double)targetOutW / targetOutH;
        int fitW, fitH;
        if (srcAsp > dstAsp) {
            fitW = targetOutW; fitH = ((int)((double)targetOutW / srcAsp) / 2) * 2;
        } else {
            fitH = targetOutH; fitW = ((int)((double)targetOutH * srcAsp) / 2) * 2;
        }
        if (fitW < 2) fitW = 2;
        if (fitH < 2) fitH = 2;
        int fitPixels = fitW * fitH;
        int srcPixels = srcW * srcH;
        if (fitPixels < srcPixels * 0.8) {
            char resizeStr[64];
            snprintf(resizeStr, sizeof(resizeStr), "%dx%d", fitW, fitH);
            av_dict_set(&decoderOpts, "resize", resizeStr, 0);
            fprintf(stderr, "[ENGINE] CUVID GPU resize: %dx%d Ã¢â€ â€™ %s (GPU-side, %.0f%% less transfer)\n",
                srcW, srcH, resizeStr, (1.0 - (double)fitPixels/srcPixels) * 100);
        }
    }
    if (avcodec_open2(videoDecCtx, videoCodec, &decoderOpts) < 0) {
        av_dict_free(&decoderOpts);
        decoderOpts = nullptr;

        if (useHwDecode) {
            // HW decoder failed (e.g. AV1 10-bit) -> retry CPU
            fprintf(stderr, "[ENGINE] HW decoder failed to open, falling back to CPU decoder\n");
            avcodec_free_context(&videoDecCtx);
            useHwDecode = false;

            videoCodec = avcodec_find_decoder(codecId);
            if (!videoCodec) {
                lastError_ = "Video decoder not found (CPU fallback)";
                avformat_close_input(&fmtCtx);
                return -1;
            }
            videoDecCtx = avcodec_alloc_context3(videoCodec);
            avcodec_parameters_to_context(videoDecCtx, fmtCtx->streams[videoStreamIdx]->codecpar);
            videoDecCtx->thread_count = std::min(8, (int)std::thread::hardware_concurrency());
            videoDecCtx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;

            if (avcodec_open2(videoDecCtx, videoCodec, nullptr) < 0) {
                lastError_ = "Cannot open video decoder (CPU fallback)";
                avcodec_free_context(&videoDecCtx);
                avformat_close_input(&fmtCtx);
                return -1;
            }
            fprintf(stderr, "[ENGINE] CPU decoder opened OK: %s\n", videoCodec->name);
        } else {
            lastError_ = "Cannot open video decoder";
            avcodec_free_context(&videoDecCtx);
            avformat_close_input(&fmtCtx);
            return -1;
        }
    }
    av_dict_free(&decoderOpts);

    // Open audio decoder (optional)
    if (audioStreamIdx >= 0) {
        auto* audioCodec = avcodec_find_decoder(fmtCtx->streams[audioStreamIdx]->codecpar->codec_id);
        if (audioCodec) {
            audioDecCtx = avcodec_alloc_context3(audioCodec);
            avcodec_parameters_to_context(audioDecCtx, fmtCtx->streams[audioStreamIdx]->codecpar);
            if (avcodec_open2(audioDecCtx, audioCodec, nullptr) < 0) {
                avcodec_free_context(&audioDecCtx);
                audioDecCtx = nullptr;
                audioStreamIdx = -1;
            }
        }
    }

    return 0;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Open Output File Ã¢â€â‚¬Ã¢â€â‚¬

int AuraEngine::openOutput(
    const std::string& outputPath,
    AVFormatContext*& outFmtCtx,
    AVCodecContext*& videoEncCtx, AVStream*& videoStream,
    AVCodecContext*& audioEncCtx, AVStream*& audioStream,
    const AVCodecContext* inVideoCtx, const AVCodecContext* inAudioCtx,
    const EngineConfig& config)
{
    outFmtCtx = nullptr;
    videoEncCtx = nullptr;
    audioEncCtx = nullptr;

    fprintf(stderr, "[ENGINE] Creating output: %s\n", outputPath.c_str());
    avformat_alloc_output_context2(&outFmtCtx, nullptr, nullptr, outputPath.c_str());
    if (!outFmtCtx) {
        lastError_ = "Cannot create output context";
        fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
        return -1;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Video encoder Ã¢â€â‚¬Ã¢â€â‚¬
    const AVCodec* videoEnc = nullptr;
    if (config.useGpu) {
        videoEnc = avcodec_find_encoder_by_name("h264_nvenc");
    }
    if (!videoEnc) {
        videoEnc = avcodec_find_encoder(AV_CODEC_ID_H264);
    }
    if (!videoEnc) {
        lastError_ = "H264 encoder not found";
        avformat_free_context(outFmtCtx);
        return -1;
    }

    videoStream = avformat_new_stream(outFmtCtx, videoEnc);
    videoEncCtx = avcodec_alloc_context3(videoEnc);
    
    // Output dimensions (default 9:16)
    videoEncCtx->width = config.outputWidth;
    videoEncCtx->height = config.outputHeight;
    
    // Get framerate from input decoder context
    AVRational inFps = inVideoCtx->framerate;
    if (inFps.num == 0 || inFps.den == 0) {
        inFps = AVRational{30, 1};
    }
    videoEncCtx->framerate = inFps;
    videoEncCtx->time_base = AVRational{inFps.den, inFps.num}; // 1/fps
    videoEncCtx->gop_size = inFps.num / inFps.den; // 1 second
    videoEncCtx->pix_fmt = AV_PIX_FMT_YUV420P;
    
    fprintf(stderr, "[ENGINE] Encoder: %dx%d @ %d/%d fps, codec=%s\n",
            videoEncCtx->width, videoEncCtx->height,
            inFps.num, inFps.den, videoEnc->name);

    // Encoder settings
    if (config.useGpu && std::string(videoEnc->name) == "h264_nvenc") {
        av_opt_set(videoEncCtx->priv_data, "preset", config.preset.c_str(), 0);
        av_opt_set_int(videoEncCtx->priv_data, "cq", config.crf, 0);
        av_opt_set(videoEncCtx->priv_data, "rc", "vbr", 0);
    } else {
        av_opt_set(videoEncCtx->priv_data, "preset", "veryfast", 0);
        videoEncCtx->bit_rate = 0; // CRF mode
        av_opt_set_int(videoEncCtx->priv_data, "crf", config.crf, 0);
    }

    if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER) {
        videoEncCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    }

    int encRet = avcodec_open2(videoEncCtx, videoEnc, nullptr);
    if (encRet < 0) {
        // GPU encoder failed (old driver?) -> fallback to CPU libx264
        if (config.useGpu && std::string(videoEnc->name) == "h264_nvenc") {
            char errBuf[256];
            av_strerror(encRet, errBuf, sizeof(errBuf));
            fprintf(stderr, "[ENGINE] h264_nvenc failed (%s), falling back to libx264 CPU\n", errBuf);
            avcodec_free_context(&videoEncCtx);

            videoEnc = avcodec_find_encoder(AV_CODEC_ID_H264);
            if (!videoEnc) {
                lastError_ = "H264 CPU encoder not found";
                avformat_free_context(outFmtCtx);
                return -1;
            }
            // CRITICAL: Reuse existing videoStream — do NOT call avformat_new_stream() again!
            // Creating a second stream leaves stream #0 with codec_id=NONE,
            // causing "Could not find tag for codec none" error in MP4 muxer.
            videoEncCtx = avcodec_alloc_context3(videoEnc);
            videoEncCtx->width = config.outputWidth;
            videoEncCtx->height = config.outputHeight;
            videoEncCtx->framerate = inVideoCtx->framerate;
            if (videoEncCtx->framerate.num == 0) videoEncCtx->framerate = AVRational{30, 1};
            videoEncCtx->time_base = AVRational{videoEncCtx->framerate.den, videoEncCtx->framerate.num};
            videoEncCtx->gop_size = videoEncCtx->framerate.num / videoEncCtx->framerate.den;
            videoEncCtx->pix_fmt = AV_PIX_FMT_YUV420P;
            av_opt_set(videoEncCtx->priv_data, "preset", "veryfast", 0);
            videoEncCtx->bit_rate = 0;
            av_opt_set_int(videoEncCtx->priv_data, "crf", config.crf, 0);
            if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER)
                videoEncCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

            encRet = avcodec_open2(videoEncCtx, videoEnc, nullptr);
            if (encRet < 0) {
                char errBuf2[256];
                av_strerror(encRet, errBuf2, sizeof(errBuf2));
                lastError_ = std::string("Cannot open CPU encoder: ") + errBuf2;
                fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
                return -1;
            }
            fprintf(stderr, "[ENGINE] CPU encoder opened OK: libx264 (veryfast)\n");
        } else {
            char errBuf[256];
            av_strerror(encRet, errBuf, sizeof(errBuf));
            lastError_ = std::string("Cannot open video encoder: ") + errBuf;
            fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
            return -1;
        }
    }
    avcodec_parameters_from_context(videoStream->codecpar, videoEncCtx);
    videoStream->time_base = videoEncCtx->time_base;
    fprintf(stderr, "[ENGINE] Video encoder opened OK\n");

    // Ã¢â€â‚¬Ã¢â€â‚¬ Audio encoder (pass-through or re-encode to AAC) Ã¢â€â‚¬Ã¢â€â‚¬
    if (inAudioCtx) {
        const AVCodec* audioEnc = avcodec_find_encoder(AV_CODEC_ID_AAC);
        if (audioEnc) {
            audioStream = avformat_new_stream(outFmtCtx, audioEnc);
            audioEncCtx = avcodec_alloc_context3(audioEnc);
            audioEncCtx->sample_rate = inAudioCtx->sample_rate;
            audioEncCtx->ch_layout = inAudioCtx->ch_layout;
            audioEncCtx->sample_fmt = AV_SAMPLE_FMT_FLTP;
            audioEncCtx->bit_rate = 192000;
            audioEncCtx->time_base = AVRational{1, audioEncCtx->sample_rate};
            
            if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER) {
                audioEncCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
            }
            
            if (avcodec_open2(audioEncCtx, audioEnc, nullptr) < 0) {
                avcodec_free_context(&audioEncCtx);
                audioEncCtx = nullptr;
                audioStream = nullptr;
            } else {
                avcodec_parameters_from_context(audioStream->codecpar, audioEncCtx);
                audioStream->time_base = audioEncCtx->time_base;
            }
        }
    }

    // Open output file
    if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE)) {
        if (avio_open(&outFmtCtx->pb, outputPath.c_str(), AVIO_FLAG_WRITE) < 0) {
            lastError_ = "Cannot open output file: " + outputPath;
            return -1;
        }
    }

    int hdrRet = avformat_write_header(outFmtCtx, nullptr);
    if (hdrRet < 0) {
        char errBuf[256];
        av_strerror(hdrRet, errBuf, sizeof(errBuf));
        lastError_ = std::string("Cannot write output header: ") + errBuf;
        fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
        return -1;
    }

    fprintf(stderr, "[ENGINE] Output ready, starting processing...\n");
    return 0;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Auto-Rotate Frame (handle display matrix metadata) Ã¢â€â‚¬Ã¢â€â‚¬

AVFrame* AuraEngine::autoRotateFrame(AVFrame* src, double rotation, SwsContext*& swsCtx) {
    // Normalize rotation to 0-360
    int rot = ((int)round(-rotation) % 360 + 360) % 360;
    if (rot == 0) return av_frame_clone(src);
    
    int srcW = src->width, srcH = src->height;
    int dstW, dstH;
    
    if (rot == 90 || rot == 270) {
        dstW = srcH; dstH = srcW; // Swap dimensions
    } else {
        dstW = srcW; dstH = srcH; // 180Ã‚Â° keeps same dimensions
    }
    
    // Ensure even dimensions
    dstW &= ~1; dstH &= ~1;
    
    AVFrame* dst = av_frame_alloc();
    dst->format = AV_PIX_FMT_YUV420P;
    dst->width = dstW;
    dst->height = dstH;
    av_frame_get_buffer(dst, 0);
    dst->pts = src->pts;
    dst->duration = src->duration;
    
    if (rot == 180) {
        // Flip both horizontally and vertically
        for (int row = 0; row < srcH; row++) {
            uint8_t* sLine = src->data[0] + row * src->linesize[0];
            uint8_t* dLine = dst->data[0] + (srcH - 1 - row) * dst->linesize[0];
            for (int col = 0; col < srcW; col++)
                dLine[srcW - 1 - col] = sLine[col];
        }
        int cw = srcW / 2, ch = srcH / 2;
        for (int row = 0; row < ch; row++) {
            for (int col = 0; col < cw; col++) {
                dst->data[1][(ch - 1 - row) * dst->linesize[1] + (cw - 1 - col)] = 
                    src->data[1][row * src->linesize[1] + col];
                dst->data[2][(ch - 1 - row) * dst->linesize[2] + (cw - 1 - col)] = 
                    src->data[2][row * src->linesize[2] + col];
            }
        }
    } else if (rot == 90) {
        // Rotate 90Ã‚Â° CW: dst[col][H-1-row] = src[row][col]
        for (int row = 0; row < srcH; row++) {
            for (int col = 0; col < srcW; col++) {
                dst->data[0][col * dst->linesize[0] + (srcH - 1 - row)] = 
                    src->data[0][row * src->linesize[0] + col];
            }
        }
        int cw = srcW / 2, ch = srcH / 2;
        for (int row = 0; row < ch; row++) {
            for (int col = 0; col < cw; col++) {
                dst->data[1][col * dst->linesize[1] + (ch - 1 - row)] = 
                    src->data[1][row * src->linesize[1] + col];
                dst->data[2][col * dst->linesize[2] + (ch - 1 - row)] = 
                    src->data[2][row * src->linesize[2] + col];
            }
        }
    } else if (rot == 270) {
        // Rotate 270Ã‚Â° CW (= 90Ã‚Â° CCW): dst[W-1-col][row] = src[row][col]
        for (int row = 0; row < srcH; row++) {
            for (int col = 0; col < srcW; col++) {
                dst->data[0][(srcW - 1 - col) * dst->linesize[0] + row] = 
                    src->data[0][row * src->linesize[0] + col];
            }
        }
        int cw = srcW / 2, ch = srcH / 2;
        for (int row = 0; row < ch; row++) {
            for (int col = 0; col < cw; col++) {
                dst->data[1][(cw - 1 - col) * dst->linesize[1] + row] = 
                    src->data[1][row * src->linesize[1] + col];
                dst->data[2][(cw - 1 - col) * dst->linesize[2] + row] = 
                    src->data[2][row * src->linesize[2] + col];
            }
        }
    }
    
    return dst;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Scale Frame Ã¢â€â‚¬Ã¢â€â‚¬

AVFrame* AuraEngine::scaleFrame(AVFrame* src, int dstW, int dstH, SwsContext*& swsCtx) {
    int srcW = src->width;
    int srcH = src->height;
    
    // Ã¢â€â‚¬Ã¢â€â‚¬ L2: Smart Crop (crop edges + pad back) Ã¢â€â‚¬Ã¢â€â‚¬
    // Matches FFmpeg: crop=trunc(iw*keepX/2)*2:trunc(ih*keepY/2)*2:iw*cx:ih*cy
    // Then: pad back to original size with black
    int cropW = srcW, cropH = srcH, cropX = 0, cropY = 0;
    // (Smart crop is applied to source BEFORE scaling to output dim)
    // The actual crop values come from config but are applied in processVideo
    // Here we just handle the frame template scaling
    
    // Ã¢â€â‚¬Ã¢â€â‚¬ Frame Template: scale to fit + pad Ã¢â€â‚¬Ã¢â€â‚¬
    // FFmpeg: scale=W:H:force_original_aspect_ratio=decrease Ã¢â€ â€™ pad=W:H
    // This scales to FIT (letterbox), preserving aspect ratio
    
    double srcAspect = (double)srcW / srcH;
    double dstAspect = (double)dstW / dstH;
    
    // Calculate scaled dimensions (force_original_aspect_ratio=decrease)
    int scaledW, scaledH;
    if (srcAspect > dstAspect) {
        // Source is wider Ã¢â€ â€™ fit by width, black bars top/bottom
        scaledW = dstW;
        scaledH = (int)((double)dstW / srcAspect);
    } else {
        // Source is taller Ã¢â€ â€™ fit by height, black bars left/right
        scaledH = dstH;
        scaledW = (int)((double)dstH * srcAspect);
    }
    // Align to 2 for YUV420P
    scaledW &= ~1;
    scaledH &= ~1;
    if (scaledW < 2) scaledW = 2;
    if (scaledH < 2) scaledH = 2;
    
    // Step 1: Scale source to scaled dimensions
    // Only recreate SwsContext when dimensions actually change
    static int s_scSrcW = 0, s_scSrcH = 0, s_scDstW = 0, s_scDstH = 0;
    if (s_scSrcW != srcW || s_scSrcH != srcH || s_scDstW != scaledW || s_scDstH != scaledH) {
        if (swsCtx) { sws_freeContext(swsCtx); swsCtx = nullptr; }
        swsCtx = sws_getContext(
            srcW, srcH, (AVPixelFormat)src->format,
            scaledW, scaledH, AV_PIX_FMT_YUV420P,
            SWS_BILINEAR, nullptr, nullptr, nullptr
        );
        s_scSrcW = srcW; s_scSrcH = srcH; s_scDstW = scaledW; s_scDstH = scaledH;
    }
    if (!swsCtx) return nullptr;
    
    // If scaled == dst, no padding needed
    if (scaledW == dstW && scaledH == dstH) {
        AVFrame* dst = av_frame_alloc();
        dst->format = AV_PIX_FMT_YUV420P;
        dst->width = dstW;
        dst->height = dstH;
        av_frame_get_buffer(dst, 0);
        sws_scale(swsCtx, src->data, src->linesize, 0, srcH,
                  dst->data, dst->linesize);
        dst->pts = src->pts;
        dst->duration = src->duration;
        return dst;
    }
    
    // Step 2: Scale to intermediate, then pad to final
    AVFrame* scaled = av_frame_alloc();
    scaled->format = AV_PIX_FMT_YUV420P;
    scaled->width = scaledW;
    scaled->height = scaledH;
    av_frame_get_buffer(scaled, 0);
    sws_scale(swsCtx, src->data, src->linesize, 0, srcH,
              scaled->data, scaled->linesize);
    
    // Step 3: Create final frame with black padding
    AVFrame* dst = av_frame_alloc();
    dst->format = AV_PIX_FMT_YUV420P;
    dst->width = dstW;
    dst->height = dstH;
    av_frame_get_buffer(dst, 0);
    
    // Fill Y plane with black (0), U/V with neutral (128)
    memset(dst->data[0], 0, dst->linesize[0] * dstH);
    for (int row = 0; row < dstH / 2; row++) {
        memset(dst->data[1] + row * dst->linesize[1], 128, dstW / 2);
        memset(dst->data[2] + row * dst->linesize[2], 128, dstW / 2);
    }
    
    // Copy scaled content centered (pad=(ow-iw)/2:(oh-ih)/2)
    int padX = (dstW - scaledW) / 2;
    int padY = (dstH - scaledH) / 2;
    padX &= ~1; padY &= ~1; // Align to 2
    
    // Copy Y
    for (int row = 0; row < scaledH; row++) {
        memcpy(dst->data[0] + (padY + row) * dst->linesize[0] + padX,
               scaled->data[0] + row * scaled->linesize[0],
               scaledW);
    }
    // Copy U/V
    int cPadX = padX / 2, cPadY = padY / 2;
    int cScaledW = scaledW / 2, cScaledH = scaledH / 2;
    for (int row = 0; row < cScaledH; row++) {
        memcpy(dst->data[1] + (cPadY + row) * dst->linesize[1] + cPadX,
               scaled->data[1] + row * scaled->linesize[1],
               cScaledW);
        memcpy(dst->data[2] + (cPadY + row) * dst->linesize[2] + cPadX,
               scaled->data[2] + row * scaled->linesize[2],
               cScaledW);
    }
    
    av_frame_free(&scaled);
    dst->pts = src->pts;
    dst->duration = src->duration;
    return dst;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Apply Effects (CPU Ã¢â‚¬â€ proven visual parity with CSS preview) Ã¢â€â‚¬Ã¢â€â‚¬
// NOTE: avfilter approach was attempted but caused regressions:
//   - hue=H=3*n shifted entire frame Ã¢â€ â€™ rainbow flashing
//   - rgbashift too aggressive Ã¢â€ â€™ color artifacts  
//   - crop+pad dimension mismatch Ã¢â€ â€™ effects vanishing
//   - HDR/glow values differ between FFmpeg eq and CSS
//   - Zoom effect not handled by avfilter
// CPU effects match preview. Speed optimization Ã¢â€ â€™ Phase 4 (CUDA).

void AuraEngine::applyEffects(AVFrame* frame, const EngineConfig& config, int64_t frameNum) {
#ifdef HAS_CUDA
    if (cudaEffectsAvailable()) {
        // Smart Crop BEFORE CUDA effects (CPU, must be first)
        {
            float sCropX = config.cropX > 0 ? config.cropX : config.crop;
            float sCropY = config.cropY > 0 ? config.cropY : config.crop;
            if (sCropX > 0 || sCropY > 0) effectSmartCrop(frame, sCropX, sCropY);
        }

        CudaEffectParams params = {};
        params.mirror = config.mirror;
        params.noise = config.noise;
        params.noiseIntensity = config.noiseIntensity;
        params.hdr = config.hdr;
        params.glow = config.glow;
        params.lensDistortion = config.lensDistortion;
        params.rotate = config.rotate;
        params.pixelEnlarge = config.pixelEnlarge;
        params.chromaShuffle = config.chromaShuffle;
        // Advanced anti-detect
        params.frameJitter = config.frameJitter;
        params.gammaShift = config.gammaShift;
        params.microColorCycle = config.microColorCycle;
        params.dctNoise = config.dctNoise;
        params.microZoom = config.microZoom;
        params.zoomIntensity = config.zoomEffect ? config.zoomIntensity : 0.0f;
        params.zoomPeriod = config.zoomPeriod;
        params.zoomPhase = config.zoomPhase;
        params.frameNum = frameNum;
        // Color mode: CUDA only handles vibrant, rest via CPU after
        if (config.colorGrading == "vibrant") params.colorMode = 1;
        else params.colorMode = 0;

        if (cudaApplyEffects(frame->data[0], frame->data[1], frame->data[2],
                             frame->width, frame->height,
                             frame->linesize[0], frame->linesize[1], params)) {
            // Color grading not handled by CUDA (bw, cool_blue, warm, sepia)
            if (config.colorGrading != "none" && config.colorGrading != "vibrant")
                effectColorGrading(frame, config.colorGrading);
            // Border, glow halo, RGB drift (CPU Ã¢â‚¬â€ simple fillRect, not worth GPU kernel)
            if (config.borderWidth > 0)
                effectBorder(frame, config.borderWidth, config.borderColor);
            if (config.glow) effectGlowHalo(frame);
            if (config.rgbDrift) effectRGBDrift(frame, frameNum);
            return; // GPU path done
        }
        // Fall through to CPU if GPU failed
    }
#endif
    applyAllEffects(frame, config, frameNum, config.bgBlur);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Main Process Pipeline Ã¢â€â‚¬Ã¢â€â‚¬


// -- Validate decoded frame (detect green/corrupt CUVID output) --
static bool isFrameCorrupt(AVFrame* frame) {
    if (!frame || !frame->data[0]) return true;
    int w = frame->width, h = frame->height;
    if (w < 16 || h < 16) return true;
    
    // Sample Y plane: check if all values are near-zero (green frame = Y~0)
    // Sample 100 random-ish points spread across the frame
    int blackPixels = 0, totalSamples = 0;
    for (int row = h/10; row < h - h/10; row += h/10) {
        for (int col = w/10; col < w - w/10; col += w/10) {
            uint8_t y = frame->data[0][row * frame->linesize[0] + col];
            if (y < 5) blackPixels++;
            totalSamples++;
        }
    }
    // If >90% of sampled pixels are near-black, frame is likely corrupt
    if (totalSamples > 0 && (float)blackPixels / totalSamples > 0.9f) {
        fprintf(stderr, "[ENGINE] Frame validation: %d/%d pixels near-black -> CORRUPT\n", 
                blackPixels, totalSamples);
        return true;
    }
    return false;
}
int AuraEngine::processVideo(const EngineConfig& config, ProgressCallback onProgress) {
    stopped_ = false;
    lastError_.clear();
    fprintf(stderr, "[ENGINE] processVideo: %s Ã¢â€ â€™ %s\n", config.inputPath.c_str(), config.outputPath.c_str());

    // Input
    AVFormatContext* inFmtCtx = nullptr;
    AVCodecContext* videoDecCtx = nullptr;
    AVCodecContext* audioDecCtx = nullptr;
    int videoIdx = -1, audioIdx = -1;

    if (openInput(config.inputPath, inFmtCtx, videoDecCtx, videoIdx, audioDecCtx, audioIdx,
                  config.outputWidth, config.outputHeight) != 0) {
        fprintf(stderr, "[ENGINE] FAILED at openInput: %s\n", lastError_.c_str());
        return -1;
    }
    fprintf(stderr, "[ENGINE] Input: %dx%d, video=%d, audio=%d\n",
            videoDecCtx->width, videoDecCtx->height, videoIdx, audioIdx);

    // -- Smart CUVID probe: decode 1 frame, validate, restart if corrupt --
    bool isHwDecoder = (videoDecCtx->hw_device_ctx != nullptr);
    if (isHwDecoder) {
        fprintf(stderr, "[ENGINE] Probing GPU decoder — validating first frame...\n");
        AVPacket* probePkt = av_packet_alloc();
        AVFrame* probeFrame = av_frame_alloc();
        bool probeOk = false;
        int probeAttempts = 0;
        
        while (av_read_frame(inFmtCtx, probePkt) >= 0 && probeAttempts < 30) {
            if (probePkt->stream_index == videoIdx) {
                if (avcodec_send_packet(videoDecCtx, probePkt) == 0) {
                    if (avcodec_receive_frame(videoDecCtx, probeFrame) == 0) {
                        // Transfer from GPU if needed
                        AVFrame* cpuProbe = probeFrame;
                        AVFrame* hwTmp = nullptr;
                        if (probeFrame->format == AV_PIX_FMT_CUDA || probeFrame->hw_frames_ctx) {
                            hwTmp = av_frame_alloc();
                            hwTmp->format = AV_PIX_FMT_NV12;
                            if (av_hwframe_transfer_data(hwTmp, probeFrame, 0) >= 0) {
                                cpuProbe = hwTmp;
                            }
                        }
                        
                        if (!isFrameCorrupt(cpuProbe)) {
                            fprintf(stderr, "[ENGINE] GPU decoder probe PASSED -- using CUVID (max speed)\n");
                            probeOk = true;
                        } else {
                            fprintf(stderr, "[ENGINE] GPU decoder produced CORRUPT frame\n");
                        }
                        if (hwTmp) av_frame_free(&hwTmp);
                        av_packet_unref(probePkt);
                        break;
                    }
                }
                probeAttempts++;
            }
            av_packet_unref(probePkt);
        }
        av_frame_free(&probeFrame);
        av_packet_free(&probePkt);
        
        if (!probeOk) {
            // CUVID corrupt → reopen with CPU decoder
            fprintf(stderr, "[ENGINE] Reopening input with CPU decoder (safe fallback)\n");
            avcodec_free_context(&videoDecCtx);
            avcodec_free_context(&audioDecCtx);
            avformat_close_input(&inFmtCtx);
            
            // Reopen without CUVID — force CPU by passing 0x0 target (disables CUVID resize)
            // We need a way to force CPU: temporarily override by reopening manually
            AVCodecID fcodecId;
            if (avformat_open_input(&inFmtCtx, config.inputPath.c_str(), nullptr, nullptr) < 0 ||
                avformat_find_stream_info(inFmtCtx, nullptr) < 0) {
                lastError_ = "Cannot reopen input for CPU fallback";
                return -1;
            }
            videoIdx = -1; audioIdx = -1;
            for (unsigned i = 0; i < inFmtCtx->nb_streams; i++) {
                if (inFmtCtx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO && videoIdx < 0) videoIdx = i;
                else if (inFmtCtx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_AUDIO && audioIdx < 0) audioIdx = i;
            }
            fcodecId = inFmtCtx->streams[videoIdx]->codecpar->codec_id;
            const AVCodec* cpuCodec = avcodec_find_decoder(fcodecId);
            videoDecCtx = avcodec_alloc_context3(cpuCodec);
            avcodec_parameters_to_context(videoDecCtx, inFmtCtx->streams[videoIdx]->codecpar);
            videoDecCtx->thread_count = std::min(8, (int)std::thread::hardware_concurrency());
            videoDecCtx->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
            avcodec_open2(videoDecCtx, cpuCodec, nullptr);
            fprintf(stderr, "[ENGINE] CPU decoder opened: %s (8 threads)\n", cpuCodec->name);
            
            // Reopen audio
            if (audioIdx >= 0) {
                auto* ac = avcodec_find_decoder(inFmtCtx->streams[audioIdx]->codecpar->codec_id);
                if (ac) {
                    audioDecCtx = avcodec_alloc_context3(ac);
                    avcodec_parameters_to_context(audioDecCtx, inFmtCtx->streams[audioIdx]->codecpar);
                    if (avcodec_open2(audioDecCtx, ac, nullptr) < 0) { avcodec_free_context(&audioDecCtx); audioIdx = -1; }
                }
            }
        } else {
            // Probe used some packets — seek back to start
            av_seek_frame(inFmtCtx, -1, 0, AVSEEK_FLAG_BACKWARD);
            avcodec_flush_buffers(videoDecCtx);
            if (audioDecCtx) avcodec_flush_buffers(audioDecCtx);
        }
    }


    // Ã¢â€â‚¬Ã¢â€â‚¬ Detect display rotation metadata Ã¢â€â‚¬Ã¢â€â‚¬
    double displayRotation = 0;
    const AVPacketSideData* sd = nullptr;
    for (int i = 0; i < (int)inFmtCtx->streams[videoIdx]->codecpar->nb_coded_side_data; i++) {
        if (inFmtCtx->streams[videoIdx]->codecpar->coded_side_data[i].type == AV_PKT_DATA_DISPLAYMATRIX) {
            sd = &inFmtCtx->streams[videoIdx]->codecpar->coded_side_data[i];
            break;
        }
    }
    if (sd && sd->size >= 9 * sizeof(int32_t)) {
        displayRotation = av_display_rotation_get((const int32_t*)sd->data);
        fprintf(stderr, "[ENGINE] Display rotation: %.0f degrees\n", displayRotation);
    }

    // Output
    AVFormatContext* outFmtCtx = nullptr;
    AVCodecContext* videoEncCtx = nullptr;
    AVCodecContext* audioEncCtx = nullptr;
    AVStream* outVideoStream = nullptr;
    AVStream* outAudioStream = nullptr;

    if (openOutput(config.outputPath, outFmtCtx, videoEncCtx, outVideoStream,
                   audioEncCtx, outAudioStream, videoDecCtx, audioDecCtx, config) != 0) {
        avcodec_free_context(&videoDecCtx);
        avcodec_free_context(&audioDecCtx);
        avformat_close_input(&inFmtCtx);
        return -1;
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Estimate total frames for progress Ã¢â€â‚¬Ã¢â€â‚¬
    int64_t totalFrames = 0;
    if (inFmtCtx->streams[videoIdx]->nb_frames > 0) {
        totalFrames = inFmtCtx->streams[videoIdx]->nb_frames;
    } else {
        double dur = (double)inFmtCtx->duration / AV_TIME_BASE;
        AVRational fps = av_guess_frame_rate(inFmtCtx, inFmtCtx->streams[videoIdx], nullptr);
        totalFrames = (int64_t)(dur * fps.num / fps.den);
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Process loop Ã¢â€â‚¬Ã¢â€â‚¬
    SwsContext* swsToYuv = nullptr;   // source Ã¢â€ â€™ YUV420P (source res)
    SwsContext* swsToOut = nullptr;   // YUV420P source Ã¢â€ â€™ output res
    SwrContext* swrCtx = nullptr;
    AVPacket* pkt = av_packet_alloc();
    AVFrame* frame = av_frame_alloc();
    int64_t frameCount = 0;
    auto startTime = std::chrono::steady_clock::now();

    // Audio resampler
    if (audioDecCtx && audioEncCtx) {
        swr_alloc_set_opts2(&swrCtx,
            &audioEncCtx->ch_layout, audioEncCtx->sample_fmt, audioEncCtx->sample_rate,
            &audioDecCtx->ch_layout, audioDecCtx->sample_fmt, audioDecCtx->sample_rate,
            0, nullptr);
        swr_init(swrCtx);
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Timing profiler accumulators Ã¢â€â‚¬Ã¢â€â‚¬
    double t_decode = 0, t_hwTransfer = 0, t_convert = 0, t_effects = 0;
    double t_bgBlur = 0, t_fgScale = 0, t_reframe = 0, t_overlays = 0, t_encode = 0;
    auto tNow = [](){ return std::chrono::high_resolution_clock::now(); };
    auto tMs = [](auto a, auto b){ return std::chrono::duration<double, std::milli>(b - a).count(); };

    while (av_read_frame(inFmtCtx, pkt) >= 0 && !stopped_) {
        if (pkt->stream_index == videoIdx) {
            // Ã¢â€â‚¬Ã¢â€â‚¬ Video pipeline Ã¢â€â‚¬Ã¢â€â‚¬
            if (avcodec_send_packet(videoDecCtx, pkt) == 0) {
                auto tp0 = tNow();
                while (avcodec_receive_frame(videoDecCtx, frame) == 0) {
                    auto tp1 = tNow();
                    t_decode += tMs(tp0, tp1);
                    // GPUÃ¢â€ â€™CPU transfer for NVDEC hw-decoded frames
                    AVFrame* cpuFrame = frame;
                    AVFrame* hwTransferred = nullptr;
                    if (frame->format == AV_PIX_FMT_CUDA || frame->hw_frames_ctx) {
                        hwTransferred = av_frame_alloc();
                        hwTransferred->format = AV_PIX_FMT_NV12; // cuvid outputs NV12
                        if (av_hwframe_transfer_data(hwTransferred, frame, 0) < 0) {
                            av_frame_free(&hwTransferred);
                            hwTransferred = nullptr;
                            cpuFrame = frame; // fallback to raw frame
                        } else {
                            hwTransferred->pts = frame->pts;
                            hwTransferred->duration = frame->duration;
                            cpuFrame = hwTransferred;
                        }
                    }
                    auto tp2 = tNow();
                    t_hwTransfer += tMs(tp1, tp2);
                    int srcW = cpuFrame->width;
                    int srcH = cpuFrame->height;

                    // Step 1.5: Auto-rotate if display matrix present
                    AVFrame* oriented = cpuFrame;
                    SwsContext* rotSws = nullptr;
                    bool didRotate = false;
                    if (displayRotation != 0) {
                        // First convert to YUV420P if needed
                        AVFrame* yuvTmp = nullptr;
                        if ((AVPixelFormat)cpuFrame->format != AV_PIX_FMT_YUV420P) {
                            if (!swsToYuv) {
                                swsToYuv = sws_getContext(
                                    srcW, srcH, (AVPixelFormat)cpuFrame->format,
                                    srcW, srcH, AV_PIX_FMT_YUV420P,
                                    SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
                            }
                            yuvTmp = av_frame_alloc();
                            yuvTmp->format = AV_PIX_FMT_YUV420P;
                            yuvTmp->width = srcW;
                            yuvTmp->height = srcH;
                            av_frame_get_buffer(yuvTmp, 0);
                            sws_scale(swsToYuv, cpuFrame->data, cpuFrame->linesize, 0, srcH,
                                      yuvTmp->data, yuvTmp->linesize);
                            yuvTmp->pts = cpuFrame->pts;
                        } else {
                            yuvTmp = av_frame_clone(cpuFrame);
                        }
                        oriented = autoRotateFrame(yuvTmp, displayRotation, rotSws);
                        av_frame_free(&yuvTmp);
                        didRotate = true;
                        srcW = oriented->width;
                        srcH = oriented->height;
                    }

                    // Step 2: Convert to YUV420P at source resolution
                    AVFrame* yuv = nullptr;
                    AVFrame* src = didRotate ? oriented : cpuFrame;
                    if ((AVPixelFormat)src->format == AV_PIX_FMT_YUV420P) {
                        // Already YUV420P, use directly (avoid copy)
                        yuv = av_frame_clone(src);
                    } else {
                        // Convert pixel format
                        SwsContext* convSws = sws_getContext(
                            srcW, srcH, (AVPixelFormat)src->format,
                            srcW, srcH, AV_PIX_FMT_YUV420P,
                            SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
                        if (convSws) {
                            yuv = av_frame_alloc();
                            yuv->format = AV_PIX_FMT_YUV420P;
                            yuv->width = srcW;
                            yuv->height = srcH;
                            av_frame_get_buffer(yuv, 0);
                            sws_scale(convSws, src->data, src->linesize, 0, srcH,
                                      yuv->data, yuv->linesize);
                            yuv->pts = src->pts;
                            sws_freeContext(convSws);
                        }
                    }
                    if (didRotate) {
                        av_frame_free(&oriented);
                        if (rotSws) sws_freeContext(rotSws);
                    }
                    if (!yuv) continue;

                    auto tp3 = tNow();
                    t_convert += tMs(tp2, tp3);


                    AVFrame* final_frame = nullptr;
                    {
                    // Step 3a: BG Blur on CLEAN frame (before effects Ã¢â‚¬â€ BG should not have RGB border etc.)
                    // Static caches for bgBlur path (dims constant across frames)
                    static AVFrame* s_compBg = nullptr;
                    static int s_compW = 0, s_compH = 0;
                    static SwsContext* s_fgSws = nullptr;
                    static AVFrame* s_fgScaled = nullptr;
                    static int s_fgSrcW = 0, s_fgSrcH = 0, s_fgDstW = 0, s_fgDstH = 0;
                    
                    auto tp5 = tp3; // default: no bgBlur overhead
                    if (config.bgBlur) {
                        int fw = config.outputWidth, fh = config.outputHeight;
                        // Cache bgFrame (reuse across frames)
                        if (!s_compBg || s_compW != fw || s_compH != fh) {
                            if (s_compBg) av_frame_free(&s_compBg);
                            s_compBg = av_frame_alloc();
                            s_compBg->format = AV_PIX_FMT_YUV420P;
                            s_compBg->width = fw; s_compBg->height = fh;
                            av_frame_get_buffer(s_compBg, 0);
                            // Init to black (Y=0, U=128, V=128) — prevent green if blur fails
                            memset(s_compBg->data[0], 0, s_compBg->linesize[0] * fh);
                            memset(s_compBg->data[1], 128, s_compBg->linesize[1] * (fh / 2));
                            memset(s_compBg->data[2], 128, s_compBg->linesize[2] * (fh / 2));
                            s_compW = fw; s_compH = fh;
                        }
#ifdef HAS_CUDA
                        if (cudaEffectsAvailable()) {
                            if (!cudaBgBlur(s_compBg->data[0], s_compBg->data[1], s_compBg->data[2],
                                            fw, fh, s_compBg->linesize[0], s_compBg->linesize[1],
                                            yuv->data[0], yuv->data[1], yuv->data[2],
                                            yuv->width, yuv->height, yuv->linesize[0], yuv->linesize[1],
                                            config.bgBlurAmount)) {
                                effectBgBlur(s_compBg, yuv, fw, fh, config.bgBlurAmount); // CPU fallback
                            }
                        } else
#endif
                        effectBgBlur(s_compBg, yuv, fw, fh, config.bgBlurAmount);
                        tp5 = tNow();
                        t_bgBlur += tMs(tp3, tp5);
                    }
                    
                    // Step 3a.5: EARLY DOWNSCALE Ã¢â‚¬â€ when source is larger than output,
                    // scale down BEFORE effects to reduce pixel count (huge perf win)
                    // e.g. 1920x1080 source Ã¢â€ â€™ 1080x1920 output: effects on ~1M px instead of 2M
                    {
                        int outW = config.outputWidth, outH = config.outputHeight;
                        int srcW = yuv->width, srcH = yuv->height;
                        // Calculate what size the source would need to be to fit output
                        double srcAsp = (double)srcW / srcH;
                        double dstAsp = (double)outW / outH;
                        int fitW, fitH;
                        if (srcAsp > dstAsp) {
                            fitW = outW; fitH = ((int)((double)outW / srcAsp) / 2) * 2;
                        } else {
                            fitH = outH; fitW = ((int)((double)outH * srcAsp) / 2) * 2;
                        }
                        if (fitW < 2) fitW = 2;
                        if (fitH < 2) fitH = 2;

                        int fitPixels = fitW * fitH;
                        int srcPixels = srcW * srcH;
                        // Trigger if fitted size is >20% smaller than source
                        // e.g. 1920x1080Ã¢â€ â€™1080x608: 656K vs 2M = 3x reduction
                        if (fitPixels < srcPixels * 0.8) {
                            static SwsContext* s_earlyScaleSws = nullptr;
                            static int s_esSrcW = 0, s_esSrcH = 0, s_esDstW = 0, s_esDstH = 0;
                            if (s_esSrcW != srcW || s_esSrcH != srcH ||
                                s_esDstW != fitW || s_esDstH != fitH) {
                                if (s_earlyScaleSws) sws_freeContext(s_earlyScaleSws);
                                s_earlyScaleSws = sws_getContext(
                                    srcW, srcH, AV_PIX_FMT_YUV420P,
                                    fitW, fitH, AV_PIX_FMT_YUV420P,
                                    SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
                                s_esSrcW = srcW; s_esSrcH = srcH;
                                s_esDstW = fitW; s_esDstH = fitH;
                                fprintf(stderr, "[ENGINE] Early downscale: %dx%d Ã¢â€ â€™ %dx%d (%.0f%% less pixels)\n",
                                    srcW, srcH, fitW, fitH, (1.0 - (double)fitPixels/srcPixels) * 100);
                            }
                            if (s_earlyScaleSws) {
                                AVFrame* scaled = av_frame_alloc();
                                scaled->format = AV_PIX_FMT_YUV420P;
                                scaled->width = fitW; scaled->height = fitH;
                                av_frame_get_buffer(scaled, 0);
                                sws_scale(s_earlyScaleSws, yuv->data, yuv->linesize, 0,
                                          yuv->height, scaled->data, scaled->linesize);
                                scaled->pts = yuv->pts;
                                scaled->duration = yuv->duration;
                                av_frame_free(&yuv);
                                yuv = scaled;
                            }
                        }
                    }

                    // Step 3b: Apply effects at (possibly downscaled) resolution
                    // When bgBlur: skip edge effects (border, glow halo, RGB drift bars)
                    // Ã¢â‚¬â€ they'll be applied to the final composite at output resolution
                    applyEffects(yuv, config, frameCount);
                    auto tp4 = tNow();
                    t_effects += tMs(tp5, tp4);

                    // Step 4+5+6: Frame scaling with optional BG Blur + Reframe

                    if (config.bgBlur) {
                        int fw = config.outputWidth, fh = config.outputHeight;
                        
                        // FG scaling with reframe zoom
                        int yuvW = yuv->width, yuvH = yuv->height;
                        double srcAsp = (double)yuvW / yuvH;
                        double dstAsp = (double)fw / fh;
                        int fitW, fitH;
                        if (srcAsp > dstAsp) {
                            fitW = fw;
                            fitH = ((int)((double)fw / srcAsp) / 2) * 2;
                        } else {
                            fitH = fh;
                            fitW = ((int)((double)fh * srcAsp) / 2) * 2;
                        }
                        if (fitW < 2) fitW = 2;
                        if (fitH < 2) fitH = 2;
                        
                        // Reframe: zoom only the FG (BG stays full output)
                        float rfZoom = config.reframeZoom / 100.0f;
                        float rfSX = config.reframeScaleX / 100.0f;
                        float rfSY = config.reframeScaleY / 100.0f;
                        float totalSX = rfZoom * rfSX;
                        float totalSY = rfZoom * rfSY;
                        
                        int fgW = ((int)roundf(fitW * totalSX) / 2) * 2;
                        int fgH = ((int)roundf(fitH * totalSY) / 2) * 2;
                        if (fgW < 2) fgW = 2;
                        if (fgH < 2) fgH = 2;
                        
                        // Cache FG SwsContext + scaled frame
                        // Overscale by 4% to crop away edge artifacts from effects
                        // (border, glow halos, lens distortion, sws_scale interpolation)
                        int overW = ((int)roundf(fgW * 1.04f) / 2) * 2;
                        int overH = ((int)roundf(fgH * 1.04f) / 2) * 2;
                        if (overW < 4) overW = fgW;
                        if (overH < 4) overH = fgH;
                        
                        if (!s_fgSws || s_fgSrcW != yuvW || s_fgSrcH != yuvH ||
                            s_fgDstW != overW || s_fgDstH != overH) {
                            if (s_fgSws) sws_freeContext(s_fgSws);
                            if (s_fgScaled) av_frame_free(&s_fgScaled);
                            s_fgSws = sws_getContext(yuvW, yuvH, AV_PIX_FMT_YUV420P,
                                overW, overH, AV_PIX_FMT_YUV420P,
                                SWS_BILINEAR, nullptr, nullptr, nullptr);
                            s_fgScaled = av_frame_alloc();
                            s_fgScaled->format = AV_PIX_FMT_YUV420P;
                            s_fgScaled->width = overW; s_fgScaled->height = overH;
                            av_frame_get_buffer(s_fgScaled, 0);
                            s_fgSrcW = yuvW; s_fgSrcH = yuvH;
                            s_fgDstW = overW; s_fgDstH = overH;
                        }
                        if (s_fgSws) {
                            sws_scale(s_fgSws, yuv->data, yuv->linesize, 0, yuvH,
                                      s_fgScaled->data, s_fgScaled->linesize);
                            
                            // Crop center of overscaled FG Ã¢â€ â€™ exact fgWÃƒâ€”fgH (edge artifacts removed)
                            int cropX = ((overW - fgW) / 2) & ~1;
                            int cropY = ((overH - fgH) / 2) & ~1;
                            
                            // Paste FG centered on BG + position offset
                            int pasteX = ((fw - fgW) / 2 + (int)roundf(config.reframePosX)) & ~1;
                            int pasteY = ((fh - fgH) / 2 + (int)roundf(config.reframePosY)) & ~1;
                            int srcOffX = cropX, srcOffY = cropY;
                            if (pasteX < 0) { srcOffX += -pasteX; pasteX = 0; }
                            if (pasteY < 0) { srcOffY += -pasteY; pasteY = 0; }
                            int copyW = std::min(fgW, fw - pasteX);
                            int copyH = std::min(fgH, fh - pasteY);
                            
                            for (int r = 0; r < copyH; r++)
                                memcpy(s_compBg->data[0] + (pasteY + r) * s_compBg->linesize[0] + pasteX,
                                       s_fgScaled->data[0] + (srcOffY + r) * s_fgScaled->linesize[0] + srcOffX, copyW);
                            int cpx = pasteX/2, cpy = pasteY/2, sox = srcOffX/2, soy = srcOffY/2;
                            int ccw = copyW/2, cch = copyH/2;
                            for (int r = 0; r < cch; r++) {
                                memcpy(s_compBg->data[1] + (cpy+r)*s_compBg->linesize[1]+cpx,
                                       s_fgScaled->data[1] + (soy+r)*s_fgScaled->linesize[1]+sox, ccw);
                                memcpy(s_compBg->data[2] + (cpy+r)*s_compBg->linesize[2]+cpx,
                                       s_fgScaled->data[2] + (soy+r)*s_fgScaled->linesize[2]+sox, ccw);
                            }
                        }
                        // Cache final_frame (reuse across frames Ã¢â‚¬â€ no alloc per frame!)
                        static AVFrame* s_finalFrame = nullptr;
                        static int s_finalW = 0, s_finalH = 0;
                        if (!s_finalFrame || s_finalW != fw || s_finalH != fh) {
                            if (s_finalFrame) av_frame_free(&s_finalFrame);
                            s_finalFrame = av_frame_alloc();
                            s_finalFrame->format = AV_PIX_FMT_YUV420P;
                            s_finalFrame->width = fw; s_finalFrame->height = fh;
                            av_frame_get_buffer(s_finalFrame, 0);
                            s_finalW = fw; s_finalH = fh;
                        }
                        av_frame_copy(s_finalFrame, s_compBg);
                        final_frame = av_frame_clone(s_finalFrame); // clone for encoder ownership
                        final_frame->pts = yuv->pts;  // preserve PTS for subtitle timing
                    } else {
                        // No BG Blur: standard scaleFrame with black padding
                        final_frame = scaleFrame(yuv, config.outputWidth, config.outputHeight, swsToOut);
                    }
                    int64_t savedPts = yuv->pts; // save before free
                    av_frame_free(&yuv);
                    if (!final_frame) continue;
                    final_frame->pts = savedPts;  // ensure PTS survives for subtitle timing
                    
                    auto tp6 = tNow();
                    if (!config.bgBlur) t_fgScale += tMs(tp4, tp6);
                    else t_fgScale += tMs(tp5, tp6);

                    // Step 5: Reframe (only when NO bgBlur Ã¢â‚¬â€ bgBlur handles zoom inline)
                    if (!config.bgBlur) {
                    float rfZoom = config.reframeZoom / 100.0f;
                    float rfSX = config.reframeScaleX / 100.0f;
                    float rfSY = config.reframeScaleY / 100.0f;
                    float totalSX = rfZoom * rfSX;
                    float totalSY = rfZoom * rfSY;
                    bool hasReframe = totalSX != 1.0f || totalSY != 1.0f || 
                                     config.reframePosX != 0.0f || config.reframePosY != 0.0f;
                    
                    if (hasReframe) {
                        int fw = config.outputWidth, fh = config.outputHeight;
                        int scaledW = ((int)roundf(fw * totalSX / 2.0f)) * 2;
                        int scaledH = ((int)roundf(fh * totalSY / 2.0f)) * 2;
                        if (scaledW < 2) scaledW = 2;
                        if (scaledH < 2) scaledH = 2;
                        
                        SwsContext* rfSws = sws_getContext(
                            fw, fh, AV_PIX_FMT_YUV420P,
                            scaledW, scaledH, AV_PIX_FMT_YUV420P,
                            SWS_BILINEAR, nullptr, nullptr, nullptr);
                        if (rfSws) {
                            AVFrame* rfScaled = av_frame_alloc();
                            rfScaled->format = AV_PIX_FMT_YUV420P;
                            rfScaled->width = scaledW;
                            rfScaled->height = scaledH;
                            av_frame_get_buffer(rfScaled, 0);
                            sws_scale(rfSws, final_frame->data, final_frame->linesize, 0, fh,
                                      rfScaled->data, rfScaled->linesize);
                            sws_freeContext(rfSws);
                            
                            // Pad THEN crop (independent)
                            bool needPadW = scaledW < fw, needPadH = scaledH < fh;
                            bool needCropW = scaledW > fw, needCropH = scaledH > fh;
                            
                            int padW = std::max(scaledW, fw);
                            int padH = std::max(scaledH, fh);
                            padW = (padW / 2) * 2; padH = (padH / 2) * 2;
                            
                            AVFrame* padded = av_frame_alloc();
                            padded->format = AV_PIX_FMT_YUV420P;
                            padded->width = padW; padded->height = padH;
                            av_frame_get_buffer(padded, 0);
                            for (int r = 0; r < padH; r++)
                                memset(padded->data[0] + r * padded->linesize[0], 0, padW);
                            for (int r = 0; r < padH / 2; r++) {
                                memset(padded->data[1] + r * padded->linesize[1], 128, padW / 2);
                                memset(padded->data[2] + r * padded->linesize[2], 128, padW / 2);
                            }
                            
                            int pasteX = needPadW ? std::max(0, (int)roundf((fw - scaledW) / 2.0f + config.reframePosX)) : 0;
                            int pasteY = needPadH ? std::max(0, (int)roundf((fh - scaledH) / 2.0f + config.reframePosY)) : 0;
                            pasteX &= ~1; pasteY &= ~1;
                            
                            int copyW = std::min(scaledW, padW - pasteX);
                            int copyH = std::min(scaledH, padH - pasteY);
                            for (int r = 0; r < copyH; r++)
                                memcpy(padded->data[0] + (pasteY + r) * padded->linesize[0] + pasteX,
                                       rfScaled->data[0] + r * rfScaled->linesize[0], copyW);
                            int cpx2 = pasteX/2, cpy2 = pasteY/2, ccw2 = copyW/2, cch2 = copyH/2;
                            for (int r = 0; r < cch2; r++) {
                                memcpy(padded->data[1] + (cpy2+r)*padded->linesize[1]+cpx2,
                                       rfScaled->data[1] + r*rfScaled->linesize[1], ccw2);
                                memcpy(padded->data[2] + (cpy2+r)*padded->linesize[2]+cpx2,
                                       rfScaled->data[2] + r*rfScaled->linesize[2], ccw2);
                            }
                            av_frame_free(&rfScaled);
                            
                            AVFrame* rfOut = av_frame_alloc();
                            rfOut->format = AV_PIX_FMT_YUV420P;
                            rfOut->width = fw; rfOut->height = fh;
                            av_frame_get_buffer(rfOut, 0);
                            
                            int cropX = needCropW ? std::max(0, (int)roundf((scaledW - fw) / 2.0f - config.reframePosX)) : 0;
                            int cropY = needCropH ? std::max(0, (int)roundf((scaledH - fh) / 2.0f - config.reframePosY)) : 0;
                            cropX &= ~1; cropY &= ~1;
                            
                            int srcCW = std::min(fw, padW - cropX);
                            int srcCH = std::min(fh, padH - cropY);
                            for (int r = 0; r < srcCH; r++)
                                memcpy(rfOut->data[0] + r * rfOut->linesize[0],
                                       padded->data[0] + (cropY + r) * padded->linesize[0] + cropX, srcCW);
                            int ccropX = cropX/2, ccropY = cropY/2;
                            for (int r = 0; r < srcCH/2; r++) {
                                memcpy(rfOut->data[1] + r*rfOut->linesize[1],
                                       padded->data[1] + (ccropY+r)*padded->linesize[1]+ccropX, srcCW/2);
                                memcpy(rfOut->data[2] + r*rfOut->linesize[2],
                                       padded->data[2] + (ccropY+r)*padded->linesize[2]+ccropX, srcCW/2);
                            }
                            av_frame_free(&padded);
                            
                            rfOut->pts = final_frame->pts;
                            av_frame_free(&final_frame);
                            final_frame = rfOut;
                        }
                    }
                    } // end !config.bgBlur reframe
                    auto tp7 = tNow();
                    t_reframe += tMs(tp6, tp7);
                    // Step 7: Logo overlay (on final composited frame)
                    if (!config.logoPath.empty())
                        effectLogoOverlay(final_frame, config.logoPath, config.logoSize,
                                          config.logoPosition, config.outputWidth, config.outputHeight, frameCount);

                    // Step 8: Title/Description text
                    if (!config.titleText.empty() || !config.descText.empty())
                        effectDrawText(final_frame, config, frameCount);

                    if (!config.srtPath.empty()) {
                        // Use actual PTS for precise subtitle timing
                        // (handles any input fps + speed is post-processed outside engine)
                        double timeSec;
                        if (final_frame->pts != AV_NOPTS_VALUE && videoIdx >= 0) {
                            AVRational tb = inFmtCtx->streams[videoIdx]->time_base;
                            timeSec = (double)final_frame->pts * av_q2d(tb);
                        } else {
                            timeSec = (double)frameCount / 30.0; // fallback
                        }
                        // Debug: log timing for first few frames
                        if (frameCount < 3 || frameCount % 300 == 0) {
                            fprintf(stderr, "[SUB-TIME] frame=%lld pts=%lld timeSec=%.3f (frameCount/30=%.3f)\n",
                                    (long long)frameCount, (long long)(final_frame->pts),
                                    timeSec, (double)frameCount / 30.0);
                        }
                        effectSubtitle(final_frame, config, timeSec);
                    }

                    // Step 10: Video/Image Overlay
                    if (!config.overlayPath.empty())
                        effectVideoOverlay(final_frame, config, frameCount);

                    } // end effects block

                    // Re-timestamp for encoder (handle speed)
                    if (config.speed != 1.0f && config.speed > 0.0f) {
                        final_frame->pts = (int64_t)(frameCount / config.speed);
                    } else {
                        final_frame->pts = frameCount;
                    }
                    final_frame->pict_type = AV_PICTURE_TYPE_NONE;

                    // Encode
                    auto tp8 = tNow();
                    if (avcodec_send_frame(videoEncCtx, final_frame) == 0) {
                        AVPacket* encPkt = av_packet_alloc();
                        while (avcodec_receive_packet(videoEncCtx, encPkt) == 0) {
                            av_packet_rescale_ts(encPkt, videoEncCtx->time_base, outVideoStream->time_base);
                            encPkt->stream_index = outVideoStream->index;
                            // DTS monotonic guard: ensure strictly increasing DTS
                            static int64_t lastVideoDts = AV_NOPTS_VALUE;
                            if (lastVideoDts != AV_NOPTS_VALUE && encPkt->dts <= lastVideoDts) {
                                encPkt->dts = lastVideoDts + 1;
                                if (encPkt->pts < encPkt->dts) encPkt->pts = encPkt->dts;
                            }
                            lastVideoDts = encPkt->dts;
                            av_interleaved_write_frame(outFmtCtx, encPkt);
                        }
                        av_packet_free(&encPkt);
                    }

                    av_frame_free(&final_frame);
                    if (hwTransferred) av_frame_free(&hwTransferred);
                    auto tp9 = tNow();
                    t_encode += tMs(tp8, tp9);
                    frameCount++;

                    // Print timing every 30 frames
                    if (frameCount % 30 == 0) {
                        int n = 30;
#ifdef HAS_CUDA
                        const char* mode = cudaEffectsAvailable() ? "GPU" : "CPU";
#else
                        const char* mode = "CPU";
#endif
                        fprintf(stderr, "[PERF-%s] frame %lld avg/30: decode=%.1f hw=%.1f conv=%.1f fx=%.1f blur=%.1f fg=%.1f rf=%.1f ov=%.1f enc=%.1f TOTAL=%.1fms\n",
                            mode, (long long)frameCount,
                            t_decode/n, t_hwTransfer/n, t_convert/n, t_effects/n,
                            t_bgBlur/n, t_fgScale/n, t_reframe/n, t_overlays/n, t_encode/n,
                            (t_decode+t_hwTransfer+t_convert+t_effects+t_bgBlur+t_fgScale+t_reframe+t_overlays+t_encode)/n);
                        t_decode=t_hwTransfer=t_convert=t_effects=t_bgBlur=t_fgScale=t_reframe=t_overlays=t_encode=0;
                    }
                    tp0 = tNow(); // reset for next frame decode

                    // Progress callback
                    if (onProgress && (frameCount % 30 == 0 || frameCount == totalFrames)) {
                        auto now = std::chrono::steady_clock::now();
                        double elapsed = std::chrono::duration<double>(now - startTime).count();
                        double fps = elapsed > 0 ? frameCount / elapsed : 0;
                        onProgress(frameCount, totalFrames, fps);
                    }
                }
            }
        } else if (pkt->stream_index == audioIdx && audioEncCtx && swrCtx) {
            // Ã¢â€â‚¬Ã¢â€â‚¬ Audio: decode Ã¢â€ â€™ resample Ã¢â€ â€™ encode Ã¢â€â‚¬Ã¢â€â‚¬
            if (avcodec_send_packet(audioDecCtx, pkt) == 0) {
                while (avcodec_receive_frame(audioDecCtx, frame) == 0) {
                    // Resample
                    AVFrame* outFrame = av_frame_alloc();
                    outFrame->ch_layout = audioEncCtx->ch_layout;
                    outFrame->sample_rate = audioEncCtx->sample_rate;
                    outFrame->format = audioEncCtx->sample_fmt;
                    outFrame->nb_samples = audioEncCtx->frame_size > 0 
                        ? audioEncCtx->frame_size : frame->nb_samples;
                    av_frame_get_buffer(outFrame, 0);
                    
                    swr_convert(swrCtx, outFrame->data, outFrame->nb_samples,
                               (const uint8_t**)frame->data, frame->nb_samples);
                    
                    outFrame->pts = frame->pts;

                    // Encode
                    if (avcodec_send_frame(audioEncCtx, outFrame) == 0) {
                        AVPacket* encPkt = av_packet_alloc();
                        while (avcodec_receive_packet(audioEncCtx, encPkt) == 0) {
                            av_packet_rescale_ts(encPkt, audioEncCtx->time_base, outAudioStream->time_base);
                            encPkt->stream_index = outAudioStream->index;
                            av_interleaved_write_frame(outFmtCtx, encPkt);
                        }
                        av_packet_free(&encPkt);
                    }
                    av_frame_free(&outFrame);
                }
            }
        }
        av_packet_unref(pkt);
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Flush encoders Ã¢â€â‚¬Ã¢â€â‚¬
    avcodec_send_frame(videoEncCtx, nullptr);
    AVPacket* flushPkt = av_packet_alloc();
    while (avcodec_receive_packet(videoEncCtx, flushPkt) == 0) {
        av_packet_rescale_ts(flushPkt, videoEncCtx->time_base, outVideoStream->time_base);
        flushPkt->stream_index = outVideoStream->index;
        av_interleaved_write_frame(outFmtCtx, flushPkt);
    }

    if (audioEncCtx) {
        avcodec_send_frame(audioEncCtx, nullptr);
        while (avcodec_receive_packet(audioEncCtx, flushPkt) == 0) {
            av_packet_rescale_ts(flushPkt, audioEncCtx->time_base, outAudioStream->time_base);
            flushPkt->stream_index = outAudioStream->index;
            av_interleaved_write_frame(outFmtCtx, flushPkt);
        }
    }
    av_packet_free(&flushPkt);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Finalize Ã¢â€â‚¬Ã¢â€â‚¬
    av_write_trailer(outFmtCtx);

    // Ã¢â€â‚¬Ã¢â€â‚¬ Cleanup Ã¢â€â‚¬Ã¢â€â‚¬
    av_packet_free(&pkt);
    av_frame_free(&frame);
    if (swsToYuv) sws_freeContext(swsToYuv);
    if (swsToOut) sws_freeContext(swsToOut);
    if (swrCtx) swr_free(&swrCtx);
    avcodec_free_context(&videoEncCtx);
    avcodec_free_context(&audioEncCtx);
    if (outFmtCtx && !(outFmtCtx->oformat->flags & AVFMT_NOFILE))
        avio_closep(&outFmtCtx->pb);
    avformat_free_context(outFmtCtx);
    avcodec_free_context(&videoDecCtx);
    avcodec_free_context(&audioDecCtx);
    avformat_close_input(&inFmtCtx);

    return stopped_ ? -2 : 0;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Batch Processing Ã¢â€â‚¬Ã¢â€â‚¬

int AuraEngine::processBatch(const EngineConfig& config, ProgressCallback onProgress) {
    if (config.batchInputs.empty()) {
        return processVideo(config, onProgress);
    }

    std::atomic<int> successCount{0};
    std::atomic<int> queueIdx{0};
    std::mutex progressMutex;
    int total = (int)config.batchInputs.size();

    auto worker = [&]() {
        while (!stopped_) {
            int idx = queueIdx.fetch_add(1);
            if (idx >= total) break;

            EngineConfig jobConfig = config;
            jobConfig.inputPath = config.batchInputs[idx];
            
            // Auto-generate output path
            std::string input = jobConfig.inputPath;
            size_t dotPos = input.rfind('.');
            if (dotPos != std::string::npos) {
                jobConfig.outputPath = input.substr(0, dotPos) + "_REUP.mp4";
            } else {
                jobConfig.outputPath = input + "_REUP.mp4";
            }

            AuraEngine engine;
            int ret = engine.processVideo(jobConfig, [&](int64_t cur, int64_t tot, double fps) {
                std::lock_guard<std::mutex> lock(progressMutex);
                if (onProgress) {
                    // Report: video index * 1000 + progress within video
                    onProgress(idx * 1000 + (cur * 1000 / std::max(tot, (int64_t)1)), total * 1000, fps);
                }
            });

            if (ret == 0) successCount++;
            
            {
                std::lock_guard<std::mutex> lock(progressMutex);
                fprintf(stderr, "{\"batch_progress\": %d, \"batch_total\": %d, \"file\": \"%s\", \"status\": \"%s\"}\n",
                    idx + 1, total, jobConfig.inputPath.c_str(), ret == 0 ? "ok" : "error");
            }
        }
    };

    // Launch parallel workers
    int numWorkers = std::min(config.parallel, total);
    std::vector<std::thread> threads;
    for (int i = 0; i < numWorkers; i++) {
        threads.emplace_back(worker);
    }
    for (auto& t : threads) {
        t.join();
    }

    return successCount.load();
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Process Image Ã¢â€ â€™ Video with Ken Burns Ã¢â€â‚¬Ã¢â€â‚¬

#define STB_IMAGE_IMPLEMENTATION_GUARD
#ifndef STB_IMAGE_IMPLEMENTATION
// stb_image already included via stb_impl.cpp
#endif
#include "stb_image.h"

int AuraEngine::processImage(const EngineConfig& config, const std::string& imagePath,
                              double duration, ProgressCallback onProgress) {
    stopped_ = false;
    lastError_.clear();
    auto tStart = std::chrono::steady_clock::now();

    int imgW, imgH, channels;
    unsigned char* imgData = stbi_load(imagePath.c_str(), &imgW, &imgH, &channels, 3);
    if (!imgData) {
        lastError_ = "Cannot load image: " + imagePath;
        fprintf(stderr, "[ENGINE] ERROR: %s\n", lastError_.c_str());
        return -1;
    }

    int fps = 30;
    int totalFrames = std::max(1, (int)(duration * fps));
    int outW = config.outputWidth, outH = config.outputHeight;

    // Pre-scale to 1.15x output as RGB (proven smooth: 1px/1242px = 0.08% = invisible)
    // MUST pre-scale because original image (~512px) is too small for smooth crop
    int bigW = (int)(outW * 1.15f);
    int bigH = (int)(outH * 1.15f);
    uint8_t* bigRgb = (uint8_t*)malloc(bigW * bigH * 3);
    if (!bigRgb) { stbi_image_free(imgData); lastError_ = "Alloc failed"; return -1; }

    {
        SwsContext* swsUp = sws_getContext(imgW, imgH, AV_PIX_FMT_RGB24,
            bigW, bigH, AV_PIX_FMT_RGB24, SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        const uint8_t* srcP[1] = { imgData };
        int srcS[1] = { imgW * 3 };
        uint8_t* dstP[1] = { bigRgb };
        int dstS[1] = { bigW * 3 };
        sws_scale(swsUp, srcP, srcS, 0, imgH, dstP, dstS);
        sws_freeContext(swsUp);
    }
    stbi_image_free(imgData);

    // Upload pre-scaled RGB to GPU (ONCE per image, ~7MB)
    bool useCuda = cudaKenBurnsUpload(bigRgb, bigW, bigH);

    // Encoder setup
    AVFormatContext* outFmtCtx = nullptr;
    avformat_alloc_output_context2(&outFmtCtx, nullptr, nullptr, config.outputPath.c_str());
    if (!outFmtCtx) { free(bigRgb); cudaKenBurnsCleanup(); lastError_ = "Cannot create output"; return -1; }

    static const AVCodec* s_enc = nullptr;
    static bool s_isNvenc = false;
    if (!s_enc) {
        s_enc = avcodec_find_encoder_by_name("h264_nvenc");
        if (s_enc) s_isNvenc = true;
        else s_enc = avcodec_find_encoder(AV_CODEC_ID_H264);
    }
    if (!s_enc) { free(bigRgb); cudaKenBurnsCleanup(); avformat_free_context(outFmtCtx); lastError_ = "No encoder"; return -1; }

    AVStream* vStream = avformat_new_stream(outFmtCtx, nullptr);
    AVCodecContext* encCtx = avcodec_alloc_context3(s_enc);
    encCtx->width = outW; encCtx->height = outH;
    encCtx->framerate = {fps, 1}; encCtx->time_base = {1, fps};
    encCtx->gop_size = fps; encCtx->pix_fmt = AV_PIX_FMT_YUV420P;
    if (s_isNvenc) {
        av_opt_set(encCtx->priv_data, "preset", "p1", 0);
        av_opt_set_int(encCtx->priv_data, "cq", 23, 0);
        av_opt_set(encCtx->priv_data, "rc", "vbr", 0);
    } else {
        av_opt_set(encCtx->priv_data, "preset", "ultrafast", 0);
        av_opt_set_int(encCtx->priv_data, "crf", 23, 0);
    }
    if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER) encCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
    
    if (avcodec_open2(encCtx, s_enc, nullptr) < 0) {
        if (s_isNvenc) {
            fprintf(stderr, "[ENGINE] Ken Burns NVENC failed, falling back to libx264 CPU...\n");
            avcodec_free_context(&encCtx);
            s_enc = avcodec_find_encoder(AV_CODEC_ID_H264);
            s_isNvenc = false;
            if (!s_enc) {
                free(bigRgb); cudaKenBurnsCleanup(); avformat_free_context(outFmtCtx); lastError_ = "No CPU encoder"; return -1;
            }
            encCtx = avcodec_alloc_context3(s_enc);
            encCtx->width = outW; encCtx->height = outH;
            encCtx->framerate = {fps, 1}; encCtx->time_base = {1, fps};
            encCtx->gop_size = fps; encCtx->pix_fmt = AV_PIX_FMT_YUV420P;
            av_opt_set(encCtx->priv_data, "preset", "ultrafast", 0);
            av_opt_set_int(encCtx->priv_data, "crf", 23, 0);
            if (outFmtCtx->oformat->flags & AVFMT_GLOBALHEADER) encCtx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;
            
            if (avcodec_open2(encCtx, s_enc, nullptr) < 0) {
                free(bigRgb); cudaKenBurnsCleanup(); avcodec_free_context(&encCtx);
                avformat_free_context(outFmtCtx); lastError_ = "Cannot open CPU encoder"; return -1;
            }
        } else {
            free(bigRgb); cudaKenBurnsCleanup(); avcodec_free_context(&encCtx);
            avformat_free_context(outFmtCtx); lastError_ = "Cannot open encoder"; return -1;
        }
    }
    avcodec_parameters_from_context(vStream->codecpar, encCtx);
    vStream->time_base = encCtx->time_base;
    if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE)) {
        if (avio_open(&outFmtCtx->pb, config.outputPath.c_str(), AVIO_FLAG_WRITE) < 0) {
            free(bigRgb); cudaKenBurnsCleanup(); avcodec_free_context(&encCtx);
            avformat_free_context(outFmtCtx); lastError_ = "Cannot open output"; return -1;
        }
    }
    if (avformat_write_header(outFmtCtx, nullptr) < 0) {
        free(bigRgb); cudaKenBurnsCleanup(); avcodec_free_context(&encCtx);
        avformat_free_context(outFmtCtx); lastError_ = "Cannot write header"; return -1;
    }

    AVFrame* outFrame = av_frame_alloc();
    outFrame->format = AV_PIX_FMT_YUV420P;
    outFrame->width = outW; outFrame->height = outH;
    av_frame_get_buffer(outFrame, 0);

    int64_t lastDts = AV_NOPTS_VALUE;
    SwsContext* swsCur = nullptr;
    int prevSW = 0, prevSH = 0;

    // Ken Burns ZOOM IN on 1.15x buffer
    // Crop from full bigW×bigH (zoom=1) to center outW×outH (max zoom)
    for (int i = 0; i < totalFrames && !stopped_; i++) {
        float t = (float)i / (float)std::max(1, totalFrames - 1);
        float eased = 0.5f - 0.5f * cosf(t * 3.14159265f);

        float cropW = bigW - (bigW - outW) * eased;
        float cropH = bigH - (bigH - outH) * eased;
        float cropX = ((float)bigW - cropW) * 0.5f;
        float cropY = ((float)bigH - cropH) * 0.5f;

        if (useCuda) {
            // GPU: pass FLOAT crop coords → sub-pixel precision → zero jitter!
            // Clamp to valid bounds
            if (cropW < outW) cropW = outW;
            if (cropH < outH) cropH = outH;
            if (cropX < 0) cropX = 0;
            if (cropY < 0) cropY = 0;
            if (cropX + cropW > bigW) cropX = bigW - cropW;
            if (cropY + cropH > bigH) cropY = bigH - cropH;

            cudaKenBurnsFrame(outFrame->data[0], outFrame->data[1], outFrame->data[2],
                              outW, outH, outFrame->linesize[0], outFrame->linesize[1],
                              cropX, cropY, cropW, cropH);
        } else {
            // CPU fallback: round to int for sws_scale
            int sx = (int)(cropX + 0.5f);
            int sy = (int)(cropY + 0.5f);
            int sw = (int)(cropW + 0.5f);
            int sh = (int)(cropH + 0.5f);
            if (sw < outW) sw = outW; if (sh < outH) sh = outH;
            if (sx + sw > bigW) sx = bigW - sw;
            if (sy + sh > bigH) sy = bigH - sh;
            if (sx < 0) sx = 0; if (sy < 0) sy = 0;

            if (sw != prevSW || sh != prevSH) {
                if (swsCur) sws_freeContext(swsCur);
                swsCur = sws_getContext(sw, sh, AV_PIX_FMT_RGB24,
                    outW, outH, AV_PIX_FMT_YUV420P, SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
                prevSW = sw; prevSH = sh;
            }
            if (swsCur) {
                const uint8_t* rgbP[1] = { bigRgb + sy * (bigW * 3) + sx * 3 };
                int rgbS[1] = { bigW * 3 };
                sws_scale(swsCur, rgbP, rgbS, 0, sh, outFrame->data, outFrame->linesize);
            }
        }

        outFrame->pts = i;
        outFrame->pict_type = AV_PICTURE_TYPE_NONE;
        if (avcodec_send_frame(encCtx, outFrame) == 0) {
            AVPacket* pkt = av_packet_alloc();
            while (avcodec_receive_packet(encCtx, pkt) == 0) {
                av_packet_rescale_ts(pkt, encCtx->time_base, vStream->time_base);
                pkt->stream_index = vStream->index;
                if (lastDts != AV_NOPTS_VALUE && pkt->dts <= lastDts) pkt->dts = lastDts + 1;
                lastDts = pkt->dts;
                if (pkt->pts < pkt->dts) pkt->pts = pkt->dts;
                av_interleaved_write_frame(outFmtCtx, pkt);
            }
            av_packet_free(&pkt);
        }
    }

    avcodec_send_frame(encCtx, nullptr);
    { AVPacket* pkt = av_packet_alloc();
      while (avcodec_receive_packet(encCtx, pkt) == 0) {
          av_packet_rescale_ts(pkt, encCtx->time_base, vStream->time_base);
          pkt->stream_index = vStream->index;
          if (lastDts != AV_NOPTS_VALUE && pkt->dts <= lastDts) pkt->dts = lastDts + 1;
          lastDts = pkt->dts; if (pkt->pts < pkt->dts) pkt->pts = pkt->dts;
          av_interleaved_write_frame(outFmtCtx, pkt);
      } av_packet_free(&pkt); }

    av_write_trailer(outFmtCtx);
    cudaKenBurnsCleanup();
    if (swsCur) sws_freeContext(swsCur);
    av_frame_free(&outFrame);
    avcodec_free_context(&encCtx);
    if (!(outFmtCtx->oformat->flags & AVFMT_NOFILE)) avio_closep(&outFmtCtx->pb);
    avformat_free_context(outFmtCtx);
    free(bigRgb);

    auto tEnd = std::chrono::steady_clock::now();
    double ms = std::chrono::duration<double, std::milli>(tEnd - tStart).count();
    fprintf(stderr, "[ENGINE] processImage DONE: %d frames, %.0fms (%s)\n",
            totalFrames, ms, imagePath.c_str());
    return 0;
}
