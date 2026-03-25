// ==============================================================================
// cutting.h — FFmpeg Cutting Orchestration (AuraSplit v3)
//
// Single Responsibility: Execute FFmpeg commands to cut audio & video.
// No parsing logic — receives CutPoints from autosync module.
// ==============================================================================

#pragma once

#include "autosync.h"
#include <string>
#include <vector>
#include <functional>

namespace cutting {

// ─── Configuration ────────────────────────────────────────────

struct CutConfig {
    std::string audioPath;           // Full audio file path
    std::string videoSourceDir;      // Directory containing V1.mp4, V2.mp4, ...
    std::string imageSourceDir;      // Directory containing images (for SK3)
    std::string outputDir;           // Output directory
    std::string ffmpegPath = "ffmpeg";
    std::string ffprobePath = "ffprobe";
    std::string encoderName = "libx264";
    std::string encoderPreset = "ultrafast";
    int canvasWidth  = 1080;
    int canvasHeight = 1920;
    std::string effectType = "kenburns"; // kenburns, zoom_in, zoom_out, pan_left, pan_right, none
};

/// Result of a cutting operation
struct CutResult {
    int totalClips;
    int audioClips;
    int videoClips;
    double totalDuration;
    bool success;
    std::string error;
};

/// Log callback: (message)
using LogCallback = std::function<void(const std::string&)>;

/// Stop check callback: returns true if should stop
using StopCheck = std::function<bool()>;


// ─── Encoder Detection ────────────────────────────────────────

/// Detect best available encoder (h264_nvenc or libx264)
std::pair<std::string, std::string> detectBestEncoder(
    const std::string& ffmpegPath
);


// ─── File Operations ──────────────────────────────────────────

/// Find video file matching video ID (supports any extension)
/// Looks for "1.mp4", "V1.mp4", "001.mp4", etc.
std::string findVideoByVid(const std::string& videoDir, int videoId);

/// List all visual files (images + videos) recursively
std::vector<std::string> listVisualFiles(const std::string& folder);

/// Check if file has valid video stream via ffprobe
bool hasVideoStream(const std::string& filePath, const std::string& ffprobePath);


// ─── Cutting Operations ──────────────────────────────────────

/// Cut single audio segment
bool cutAudio(
    const autosync::CutPoint& cut,
    const std::string& audioPath,
    const std::string& outputPath,
    const std::string& ffmpegPath
);

/// Cut single video segment (from source video matching videoId)
bool cutVideo(
    const autosync::CutPoint& cut,
    const std::string& videoSourceDir,
    const std::string& outputPath,
    const CutConfig& config
);

/// Create video clip from image with Ken Burns effect
bool createImageClip(
    const std::string& imagePath,
    const std::string& outputPath,
    double duration,
    const CutConfig& config
);


// ─── Full Pipelines ──────────────────────────────────────────

/// SK1: AutoSync — cut audio + match video by ID
CutResult executeAutoSync(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress = nullptr,
    LogCallback onLog = nullptr,
    StopCheck shouldStop = nullptr
);

/// SK3 Image: AutoImage — cut audio + Ken Burns from images
CutResult executeAutoImage(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress = nullptr,
    LogCallback onLog = nullptr,
    StopCheck shouldStop = nullptr
);

/// SK3 Mixed: AutoMixed — cut audio + mix video/images
CutResult executeAutoMixed(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress = nullptr,
    LogCallback onLog = nullptr,
    StopCheck shouldStop = nullptr
);

} // namespace cutting
