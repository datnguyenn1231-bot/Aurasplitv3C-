#pragma once
/**
 * Advanced Effects — BG Blur, Logo Overlay, Text, Subtitle
 * Uses libavfilter for text/subtitle and stb_image for logo loading.
 */

#include "config.h"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavutil/frame.h>
}

// ── BG Blur: Create blurred+darkened background, composite FG on top ──
void effectBgBlur(AVFrame* fgFrame, AVFrame* srcFrame, int outW, int outH, int blurAmount);

// ── Logo Overlay: Load image and composite at specified position ──
void effectLogoOverlay(AVFrame* frame, const std::string& logoPath, int logoSizePct,
                       const std::string& position, int frameW, int frameH, int64_t frameNum = 0);

// ── Title/Desc Text: Render text overlay using avfilter drawtext ──
void effectDrawText(AVFrame* frame, const EngineConfig& config, int64_t frameNum = 0);

// ── Subtitle: Parse SRT and render current subtitle ──
void effectSubtitle(AVFrame* frame, const EngineConfig& config, double timeSec);

// ── Video/Image Overlay: Alpha-blend overlay on top of frame ──
void effectVideoOverlay(AVFrame* frame, const EngineConfig& config, int64_t frameNum);
