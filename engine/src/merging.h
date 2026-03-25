#pragma once
/**
 * merging.h — CUDA-accelerated video merge with transitions.
 *
 * Pipeline: FFmpeg decode → CudaFrame → CUDA transition blend → NVENC encode
 * Called via: aura_engine --mode merge --config merge.json
 */

#include <string>
#include <vector>
#include <functional>

namespace merging {

// ── Transition type enum (maps to CUDA kernels) ──
enum TransitionType {
    TRANS_NONE = 0,
    // Documentary / Pro
    TRANS_DISSOLVE, TRANS_FADE, TRANS_FADEBLACK, TRANS_FADEWHITE,
    TRANS_FADEGRAYS, TRANS_FADEFAST, TRANS_FADESLOW,
    // Smooth
    TRANS_SMOOTHLEFT, TRANS_SMOOTHRIGHT, TRANS_SMOOTHUP, TRANS_SMOOTHDOWN,
    // Wipe
    TRANS_WIPELEFT, TRANS_WIPERIGHT, TRANS_WIPEUP, TRANS_WIPEDOWN,
    TRANS_WIPETL, TRANS_WIPETR, TRANS_WIPEBL, TRANS_WIPEBR,
    // Slide
    TRANS_SLIDELEFT, TRANS_SLIDERIGHT, TRANS_SLIDEUP, TRANS_SLIDEDOWN,
    // Cover
    TRANS_COVERLEFT, TRANS_COVERRIGHT, TRANS_COVERUP, TRANS_COVERDOWN,
    // Reveal
    TRANS_REVEALLEFT, TRANS_REVEALRIGHT, TRANS_REVEALUP, TRANS_REVEALDOWN,
    // Shape
    TRANS_CIRCLEOPEN, TRANS_CIRCLECLOSE, TRANS_CIRCLECROP,
    TRANS_RECTCROP, TRANS_RADIAL,
    // Barn Door
    TRANS_HORZOPEN, TRANS_HORZCLOSE, TRANS_VERTOPEN, TRANS_VERTCLOSE,
    // Slice / Wind
    TRANS_HLSLICE, TRANS_HRSLICE, TRANS_VUSLICE, TRANS_VDSLICE,
    TRANS_HLWIND, TRANS_HRWIND, TRANS_VUWIND, TRANS_VDWIND,
    // Effects
    TRANS_PIXELIZE, TRANS_ZOOMIN, TRANS_HBLUR, TRANS_DISTANCE,
    TRANS_SQUEEZEH, TRANS_SQUEEZEV,
    TRANS_DIAGTL, TRANS_DIAGTR, TRANS_DIAGBL, TRANS_DIAGBR,
    TRANS_COUNT
};

/// Convert FFmpeg xfade name → enum
TransitionType transitionFromName(const std::string& name);

// ── Merge config ──
struct MergeConfig {
    std::vector<std::string> videos;       // Input video paths
    std::vector<std::string> transitions;  // Resolved transition names per pair
    double transitionDuration = 1.0;       // Seconds
    std::string outputPath;
    int width  = 1920;
    int height = 1080;
    bool useGpu = true;
    std::string ffmpegPath;   // For audio extraction fallback
};

struct MergeResult {
    bool success = false;
    int totalClips = 0;
    double totalDuration = 0;
    std::string error;
};

/// Progress: (currentFrame, totalFrames, fps)
using ProgressCallback = std::function<void(int64_t, int64_t, double)>;
/// Log message
using LogCallback = std::function<void(const std::string&)>;
/// Stop check
using StopCheck = std::function<bool()>;

/// Execute merge pipeline
MergeResult executeMerge(
    const MergeConfig& config,
    ProgressCallback onProgress = nullptr,
    LogCallback onLog = nullptr,
    StopCheck shouldStop = nullptr
);

} // namespace merging
