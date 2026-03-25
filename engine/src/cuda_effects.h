#pragma once
/**
 * CUDA Effects — GPU-accelerated video processing kernels.
 * Replaces CPU pixel loops with massively parallel CUDA kernels.
 */

#include <cstdint>

// Initialize CUDA (call once at startup)
bool cudaEffectsInit();
void cudaEffectsCleanup();
bool cudaEffectsAvailable();

// ── BG Blur (Phase 2) ──
// GPU box blur: downscale → 3-pass blur → brightness/saturation → upscale
// Returns true if GPU blur was used, false if fallback to CPU needed
bool cudaBgBlur(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outW, int outH, int outStrideY, int outStrideUV,
    const uint8_t* srcY, const uint8_t* srcU, const uint8_t* srcV,
    int srcW, int srcH, int srcStrideY, int srcStrideUV,
    int blurAmount
);

// ── Per-pixel effects (Phase 3) ──
// Process all effects on GPU in a single kernel launch
struct CudaEffectParams {
    bool mirror;
    bool noise;
    int noiseIntensity;
    bool hdr;
    bool glow;
    bool lensDistortion;
    float rotate;        // degrees
    float pixelEnlarge;    // 0.0=off, 1.0=max
    float chromaShuffle;   // 0.0=off, 1.0=max (up to 30° hue)
    float zoomIntensity;
    float zoomPeriod;
    float zoomPhase;
    int64_t frameNum;
    // Color grading
    int colorMode;       // 0=none, 1=vibrant, 2=bw, 3=cool_blue, 4=warm
    // Advanced anti-detect (0.0=off, 1.0=max)
    float frameJitter;     // intensity for random pixel shift per frame
    float gammaShift;      // intensity for gamma curve oscillation
    float microColorCycle; // intensity for per-frame UV shift
    float dctNoise;        // intensity for 8x8 block noise
    float microZoom;       // antidetect base zoom
};

bool cudaApplyEffects(
    uint8_t* Y, uint8_t* U, uint8_t* V,
    int w, int h, int strideY, int strideUV,
    const CudaEffectParams& params
);

// ── Composite FG on BG (Phase 3) ──
bool cudaComposite(
    uint8_t* bgY, uint8_t* bgU, uint8_t* bgV,
    int bgW, int bgH, int bgStrideY, int bgStrideUV,
    const uint8_t* fgY, const uint8_t* fgU, const uint8_t* fgV,
    int fgW, int fgH, int fgStrideY, int fgStrideUV,
    int pasteX, int pasteY
);

// ═══════════════════════════════════════════════════
// PHASE 4: ZERO-COPY GPU PIPELINE
// Keep frames in GPU memory: NVDEC → CUDA → NVENC
// ═══════════════════════════════════════════════════

// GPU frame handle (opaque — wraps device pointers)
struct CudaFrame {
    uint8_t* d_Y;       // device pointer, Y plane (w * h)
    uint8_t* d_U;       // device pointer, U plane (w/2 * h/2)
    uint8_t* d_V;       // device pointer, V plane (w/2 * h/2)
    int w, h;
    int strideY, strideUV;
    bool ownsMemory;    // true if we allocated, false if borrowed
};

// Allocate a GPU frame
CudaFrame* cudaFrameAlloc(int w, int h);
void cudaFrameFree(CudaFrame* frame);

// Convert NV12 (NVDEC output) → YUV420P in GPU memory
// srcNV12_Y: device pointer to NV12 Y plane
// srcNV12_UV: device pointer to NV12 interleaved UV plane
bool cudaNV12toYUV420P(CudaFrame* dst,
                        const uint8_t* srcNV12_Y, int srcStrideY,
                        const uint8_t* srcNV12_UV, int srcStrideUV,
                        int srcW, int srcH);

// Convert YUV420P → NV12 (for NVENC input) in GPU memory
bool cudaYUV420PtoNV12(uint8_t* dstNV12_Y, int dstStrideY,
                        uint8_t* dstNV12_UV, int dstStrideUV,
                        const CudaFrame* src);

// Apply all effects on device memory (no host transfer!)
bool cudaApplyEffectsDevice(CudaFrame* frame, const CudaEffectParams& params);

// BG blur on device memory (no host transfer!)
bool cudaBgBlurDevice(CudaFrame* outBg, const CudaFrame* src,
                       int outW, int outH, int blurAmount);

// Composite FG onto BG on device memory
bool cudaCompositeDevice(CudaFrame* bg, const CudaFrame* fg,
                          int pasteX, int pasteY);

// Scale frame on device memory (bilinear)
bool cudaScaleDevice(CudaFrame* dst, const CudaFrame* src);

// Upload host frame → device frame
bool cudaUploadFrame(CudaFrame* dst,
                      const uint8_t* srcY, const uint8_t* srcU, const uint8_t* srcV,
                      int srcW, int srcH, int srcStrideY, int srcStrideUV);

// Download device frame → host frame
bool cudaDownloadFrame(uint8_t* dstY, uint8_t* dstU, uint8_t* dstV,
                        int dstStrideY, int dstStrideUV,
                        const CudaFrame* src);

// ═══════════════════════════════════════════════════
// SUBTITLE GPU CACHE — pre-render once, blend every frame
// ═══════════════════════════════════════════════════

struct CudaSubCache {
    uint8_t* d_subY;    // subtitle Y plane on GPU
    uint8_t* d_subU;    // subtitle U plane on GPU
    uint8_t* d_subV;    // subtitle V plane on GPU
    uint8_t* d_alpha;   // alpha mask (Y-res, 0=transparent, 255=opaque)
    int w, h;           // texture dimensions
    bool valid;
};

// Initialize subtitle cache (call once)
CudaSubCache* cudaSubCacheCreate();
void cudaSubCacheDestroy(CudaSubCache* cache);

// Upload pre-rendered subtitle YUV to GPU (rendered on gray Y=128 baseline)
// Alpha computed from |subY - 128| internally
bool cudaSubCacheUpload(CudaSubCache* cache,
                         const uint8_t* subY, const uint8_t* subU, const uint8_t* subV,
                         int w, int h, int strideY, int strideUV);

// Alpha-blend cached subtitle onto video frame (GPU, <0.5ms)
// fadeAlpha: 0.0-1.0 for fade/pop, yOffset: vertical shift in pixels (for slide/bounce)
bool cudaSubOverlay(uint8_t* frameY, uint8_t* frameU, uint8_t* frameV,
                     int frameW, int frameH, int strideY, int strideUV,
                     const CudaSubCache* cache, float fadeAlpha, int yOffset);

// ═══════════════════════════════════════════════════
// CUDA RGB CROP+SCALE → YUV420P (Ken Burns zoom)
// Upload RGB once, per-frame GPU crop+scale+convert
// ═══════════════════════════════════════════════════

// Upload RGB source to GPU (call once per image)
bool cudaKenBurnsUpload(const uint8_t* rgbData, int rgbW, int rgbH);

// Render one zoomed frame: crop (fsx,fsy,fsw,fsh) from uploaded RGB,
// bilinear scale to outW×outH, convert to YUV420P, download to AVFrame planes
// FLOAT crop coords = sub-pixel precision = zero jitter!
bool cudaKenBurnsFrame(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outW, int outH, int outStrideY, int outStrideUV,
    float fsx, float fsy, float fsw, float fsh);

// Free GPU RGB buffer
void cudaKenBurnsCleanup();

// ═══════════════════════════════════════════════════
// TRANSITION BLENDING — GPU pixel operations
// Blends two YUV420P frames with a transition effect
// ═══════════════════════════════════════════════════

bool cudaTransitionBlend(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outStrideY, int outStrideUV,
    const uint8_t* aY, const uint8_t* aU, const uint8_t* aV,
    int aStrideY, int aStrideUV,
    const uint8_t* bY, const uint8_t* bU, const uint8_t* bV,
    int bStrideY, int bStrideUV,
    int w, int h, float progress, int transitionType);

