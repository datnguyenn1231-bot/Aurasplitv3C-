#pragma once
/**
 * AuraEngine Effects — Per-pixel video processing on YUV420P frames.
 */

#include "config.h"
#include <cstdint>

extern "C" {
#include <libavutil/frame.h>
}

// Individual effects
void effectMirror(AVFrame* frame);
void effectNoise(AVFrame* frame, int intensity);
void effectHDR(AVFrame* frame);
void effectColorGrading(AVFrame* frame, const std::string& mode);
void effectGlow(AVFrame* frame);
void effectGlowHalo(AVFrame* frame);
void effectRGBDrift(AVFrame* frame, int64_t frameNum);
void effectBorder(AVFrame* frame, int borderWidth, const std::string& colorHex);
void effectRotate(AVFrame* frame, float degrees, bool withSSAA);
void effectLensDistortion(AVFrame* frame);
void effectSmartCrop(AVFrame* frame, float cropX, float cropY);
void effectPixelEnlarge(AVFrame* frame);
void effectChromaShuffle(AVFrame* frame);
void effectRGBShift(AVFrame* frame);

// Apply all effects based on config (single call)
// skipEdgeEffects: when true, skip edge-drawing effects (border, glow halo, RGB drift borders)
// Used for bgBlur path: FG gets content effects, composite gets edge effects
void applyAllEffects(AVFrame* frame, const EngineConfig& config, int64_t frameNum, bool skipEdgeEffects = false);
