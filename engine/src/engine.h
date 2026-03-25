#pragma once
/**
 * AuraEngine — FFmpeg C API video processing engine.
 * 
 * Pipeline: NVDEC decode → process frames → NVENC encode → mux .mp4
 * Zero file I/O between stages (frames stay in memory).
 */

#include "config.h"
#include <functional>

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/opt.h>
#include <libavutil/imgutils.h>
#include <libavutil/hwcontext.h>
#include <libavutil/display.h>
#include <libswscale/swscale.h>
#include <libswresample/swresample.h>
}

// Progress callback: (currentFrame, totalFrames, fps)
using ProgressCallback = std::function<void(int64_t, int64_t, double)>;

class AuraEngine {
public:
    AuraEngine();
    ~AuraEngine();
    
    /**
     * Process a single video: decode → apply effects → encode → mux.
     * Returns 0 on success, non-zero on error.
     */
    int processVideo(const EngineConfig& config, ProgressCallback onProgress = nullptr);
    
    /**
     * Process multiple videos in batch mode (multi-threaded).
     * Returns number of successfully processed videos.
     */
    int processBatch(const EngineConfig& config, ProgressCallback onProgress = nullptr);
    
    /**
     * Generate video from a static image with Ken Burns zoom effect.
     * Uses NVENC pipeline: stb_image load → RGB→YUV → animated zoom → encode.
     * Returns 0 on success, non-zero on error.
     */
    int processImage(const EngineConfig& config, const std::string& imagePath,
                     double duration, ProgressCallback onProgress = nullptr);
    
    /**
     * Stop processing (can be called from another thread).
     */
    void stop();
    
    /**
     * Get last error message.
     */
    const std::string& getError() const { return lastError_; }

private:
    bool stopped_ = false;
    std::string lastError_;
    
    // ── Internal pipeline stages ──
    int openInput(const std::string& inputPath,
                  AVFormatContext*& fmtCtx,
                  AVCodecContext*& videoDecCtx, int& videoStreamIdx,
                  AVCodecContext*& audioDecCtx, int& audioStreamIdx,
                  int targetOutW = 0, int targetOutH = 0);
    
    int openOutput(const std::string& outputPath,
                   AVFormatContext*& outFmtCtx,
                   AVCodecContext*& videoEncCtx, AVStream*& videoStream,
                   AVCodecContext*& audioEncCtx, AVStream*& audioStream,
                   const AVCodecContext* inVideoCtx, const AVCodecContext* inAudioCtx,
                   const EngineConfig& config);
    
    // Scale frame to target dimensions (9:16 etc.)
    AVFrame* scaleFrame(AVFrame* src, int dstW, int dstH, SwsContext*& swsCtx);
    
    // Auto-rotate frame based on display matrix metadata
    AVFrame* autoRotateFrame(AVFrame* src, double rotation, SwsContext*& swsCtx);
    
    // Apply visual effects to a frame (Phase 2+)
    void applyEffects(AVFrame* frame, const EngineConfig& config, int64_t frameNum);
};
