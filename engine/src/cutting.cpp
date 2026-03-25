// ==============================================================================
// cutting.cpp — FFmpeg Cutting Implementation (AuraSplit v3)
//
// Ported from: process_task.py (_cutting_loop, _image_flow_loop, _make_image_clip)
// Atomic: each function wraps ONE FFmpeg operation
// ==============================================================================

#include "cutting.h"
#include "engine.h"

#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <regex>
#include <sstream>
#include <iostream>
#include <random>
#include <set>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace fs = std::filesystem;

namespace cutting {

// ─── Helper: Run FFmpeg command (hidden window on Windows) ────

static int runFFmpeg(const std::vector<std::string>& args) {
    std::string cmd;
    for (const auto& arg : args) {
        if (cmd.empty()) {
            cmd = "\"" + arg + "\"";
        } else {
            cmd += " \"" + arg + "\"";
        }
    }

#ifdef _WIN32
    STARTUPINFOA si = {};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    PROCESS_INFORMATION pi = {};
    std::string cmdMutable = cmd;

    if (!CreateProcessA(
        nullptr, &cmdMutable[0], nullptr, nullptr, FALSE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi
    )) {
        return -1;
    }

    WaitForSingleObject(pi.hProcess, 120000); // 2min timeout per clip

    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return static_cast<int>(exitCode);
#else
    return std::system(cmd.c_str());
#endif
}


// ─── Encoder Detection ────────────────────────────────────────

std::pair<std::string, std::string> detectBestEncoder(
    const std::string& ffmpegPath
) {
    int ret = runFFmpeg({
        ffmpegPath, "-v", "error",
        "-f", "lavfi", "-i", "nullsrc",
        "-c:v", "h264_nvenc",
        "-frames:v", "1",
        "-f", "null", "-"
    });

    if (ret == 0) {
        return {"h264_nvenc", "p1"};
    }
    return {"libx264", "ultrafast"};
}


// ─── File Operations ──────────────────────────────────────────

std::string findVideoByVid(const std::string& videoDir, int videoId) {
    if (videoDir.empty() || !fs::is_directory(videoDir)) {
        return "";
    }

    // Only match actual video files (skip images like .jfif, .jpg, .png)
    static const std::set<std::string> videoExts = {
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".flv", ".wmv"
    };

    std::vector<std::string> candidates;

    for (const auto& entry : fs::directory_iterator(videoDir)) {
        if (!entry.is_regular_file()) continue;

        // Check extension is video
        std::string ext = entry.path().extension().string();
        std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
        if (videoExts.find(ext) == videoExts.end()) continue;

        std::string stem = entry.path().stem().string();
        std::string s = stem;

        // Trim whitespace
        s.erase(0, s.find_first_not_of(" \t"));
        s.erase(s.find_last_not_of(" \t") + 1);

        // Remove leading 'V' or 'v'
        if (!s.empty() && (s[0] == 'V' || s[0] == 'v')) {
            s = s.substr(1);
        }

        try {
            if (std::stoi(s) == videoId) {
                candidates.push_back(entry.path().string());
            }
        } catch (...) {
            continue;
        }
    }

    if (candidates.empty()) return "";
    std::sort(candidates.begin(), candidates.end());
    return candidates[0];
}


std::vector<std::string> listVisualFiles(const std::string& folder) {
    std::vector<std::string> files;
    if (folder.empty() || !fs::is_directory(folder)) return files;

    for (const auto& entry : fs::recursive_directory_iterator(folder)) {
        if (entry.is_regular_file()) {
            files.push_back(entry.path().string());
        }
    }
    std::sort(files.begin(), files.end());
    return files;
}


bool hasVideoStream(const std::string& filePath, const std::string& ffprobePath) {
    // Build command to check video stream
    std::string cmd = "\"" + ffprobePath + "\" -v error"
        " -select_streams v:0 -show_entries stream=width,height"
        " -of default=noprint_wrappers=1 \"" + filePath + "\"";

    // Run and capture output
    std::string output;

#ifdef _WIN32
    STARTUPINFOA si = {};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    SECURITY_ATTRIBUTES sa = {};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE hReadPipe, hWritePipe;
    CreatePipe(&hReadPipe, &hWritePipe, &sa, 0);
    SetHandleInformation(hReadPipe, HANDLE_FLAG_INHERIT, 0);

    si.dwFlags |= STARTF_USESTDHANDLES;
    si.hStdOutput = hWritePipe;

    PROCESS_INFORMATION pi = {};
    std::string cmdMutable = cmd;

    if (CreateProcessA(
        nullptr, &cmdMutable[0], nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi
    )) {
        CloseHandle(hWritePipe);
        char buffer[1024];
        DWORD bytesRead;
        while (ReadFile(hReadPipe, buffer, sizeof(buffer) - 1, &bytesRead, nullptr) && bytesRead > 0) {
            buffer[bytesRead] = '\0';
            output += buffer;
        }
        WaitForSingleObject(pi.hProcess, 10000);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        CloseHandle(hWritePipe);
    }
    CloseHandle(hReadPipe);
#else
    FILE* pipe = popen(cmd.c_str(), "r");
    if (pipe) {
        char buffer[1024];
        while (fgets(buffer, sizeof(buffer), pipe)) output += buffer;
        pclose(pipe);
    }
#endif

    // Check for width= and height= > 0
    bool hasWidth = false, hasHeight = false;
    for (const auto& line : {output}) {
        if (line.find("width=") != std::string::npos) {
            auto pos = line.find("width=") + 6;
            try { if (std::stoi(line.substr(pos)) > 0) hasWidth = true; } catch (...) {}
        }
        if (line.find("height=") != std::string::npos) {
            auto pos = line.find("height=") + 7;
            try { if (std::stoi(line.substr(pos)) > 0) hasHeight = true; } catch (...) {}
        }
    }

    return hasWidth && hasHeight;
}


// ─── Cutting Operations ──────────────────────────────────────

bool cutAudio(
    const autosync::CutPoint& cut,
    const std::string& audioPath,
    const std::string& outputPath,
    const std::string& ffmpegPath
) {
    // Create output directory
    fs::create_directories(fs::path(outputPath).parent_path());

    double duration = cut.endTime - cut.startTime;

    // Fix: -ss AFTER -i = frame-accurate seek (not keyframe seek)
    // Fix: -avoid_negative_ts to prevent A/V desync when merging clips
    return runFFmpeg({
        ffmpegPath, "-y",
        "-i", audioPath,
        "-ss", std::to_string(cut.startTime),
        "-t", std::to_string(duration),
        "-vn", "-acodec", "libmp3lame",
        "-q:a", "2",
        "-avoid_negative_ts", "make_zero",
        "-loglevel", "error",
        outputPath
    }) == 0;
}


bool cutVideo(
    const autosync::CutPoint& cut,
    const std::string& videoSourceDir,
    const std::string& outputPath,
    const CutConfig& config
) {
    std::string videoSrc = findVideoByVid(videoSourceDir, cut.videoId);
    if (videoSrc.empty()) return false;

    fs::create_directories(fs::path(outputPath).parent_path());
    double duration = cut.endTime - cut.startTime;

    // Try with audio copy first
    int ret = runFFmpeg({
        config.ffmpegPath, "-y",
        "-ss", "0",
        "-i", videoSrc,
        "-t", std::to_string(duration),
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", config.encoderName, "-preset", config.encoderPreset,
        "-pix_fmt", "yuv420p", "-c:a", "copy",
        "-shortest", "-map_metadata", "-1",
        "-avoid_negative_ts", "make_zero",
        "-loglevel", "error",
        outputPath
    });

    if (ret != 0) {
        // Fallback: re-encode audio as AAC
        ret = runFFmpeg({
            config.ffmpegPath, "-y",
            "-ss", "0",
            "-i", videoSrc,
            "-t", std::to_string(duration),
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=30",
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", config.encoderName, "-preset", config.encoderPreset,
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
            "-shortest", "-map_metadata", "-1",
            "-avoid_negative_ts", "make_zero",
            "-loglevel", "error",
            outputPath
        });
    }

    return ret == 0;
}


/// Cut video segment AND scale to canvas dimensions
/// Used by SyncMixed to normalize all video clips to same output size
bool cutVideoToCanvas(
    const std::string& videoSrc,
    const std::string& outputPath,
    double duration,
    const CutConfig& config
) {
    fs::create_directories(fs::path(outputPath).parent_path());

    std::string cw = std::to_string(config.canvasWidth);
    std::string ch = std::to_string(config.canvasHeight);

    // Simple scale to fit + black padding
    std::string vf =
        "scale=" + cw + ":" + ch + ":force_original_aspect_ratio=decrease,"
        "pad=" + cw + ":" + ch + ":(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p";

    int ret = runFFmpeg({
        config.ffmpegPath, "-y",
        "-ss", "0",
        "-i", videoSrc,
        "-t", std::to_string(duration),
        "-vf", vf,
        "-an",
        "-c:v", config.encoderName, "-preset", config.encoderPreset,
        "-pix_fmt", "yuv420p",
        "-map_metadata", "-1",
        "-avoid_negative_ts", "make_zero",
        "-loglevel", "error",
        outputPath
    });

    return ret == 0;
}


bool createImageClip(
    const std::string& imagePath,
    const std::string& outputPath,
    double duration,
    const CutConfig& config
) {
    fs::create_directories(fs::path(outputPath).parent_path());

    double dur = std::max(0.10, duration);

    // Determine effect type
    std::string effect = config.effectType;
    if (effect == "random") {
        static std::mt19937 rng(std::random_device{}());
        std::uniform_int_distribution<int> dist(0, 3);
        const char* effects[] = {"zoom_in", "zoom_out", "pan_left", "pan_right"};
        effect = effects[dist(rng)];
    }
    if (effect == "kenburns" || effect.empty()) effect = "zoom_in";


    // ── Try AuraEngine processImage (NVENC GPU Ken Burns — 10x faster) ──
    // Note: avio_open on Windows can't handle UTF-8 paths (Vietnamese etc.)
    //       → write to temp file then rename to final path
    {
        // Build ASCII-safe temp path
        std::string tempOut;
        #ifdef _WIN32
        char tmpDir[MAX_PATH];
        GetTempPathA(MAX_PATH, tmpDir);
        tempOut = std::string(tmpDir) + "aura_kb_" +
                  fs::path(outputPath).stem().string() + ".mp4";
        #else
        tempOut = outputPath;  // Unix handles UTF-8 fine
        #endif

        EngineConfig engCfg;
        engCfg.outputPath = tempOut;
        engCfg.outputWidth = config.canvasWidth;
        engCfg.outputHeight = config.canvasHeight;
        engCfg.useGpu = true;

        AuraEngine engine;
        int ret = engine.processImage(engCfg, imagePath, dur);
        if (ret == 0) {
            #ifdef _WIN32
            // Move temp → final path (handles UTF-8 via fs::rename)
            try { fs::rename(tempOut, outputPath); return true; }
            catch (...) { /* rename failed, try copy */ }
            try { fs::copy_file(tempOut, outputPath, fs::copy_options::overwrite_existing);
                  fs::remove(tempOut); return true; }
            catch (...) {}
            #else
            return true;
            #endif
        }

        // Cleanup temp on failure
        #ifdef _WIN32
        try { fs::remove(tempOut); } catch (...) {}
        #endif

        fprintf(stderr, "[CUTTING] Engine processImage failed (%s), fallback to FFmpeg\n",
                engine.getError().c_str());
    }

    // ── FFmpeg fallback (CPU zoompan) ──
    int fps = 30;
    int frames = std::max(1, (int)(dur * fps));
    int scaledW = (int)(config.canvasWidth * 1.15);
    int scaledH = (int)(config.canvasHeight * 1.15);

    std::string sw = std::to_string(scaledW);
    std::string sh = std::to_string(scaledH);
    std::string cw = std::to_string(config.canvasWidth);
    std::string ch = std::to_string(config.canvasHeight);
    std::string fr = std::to_string(frames);
    std::string fpsStr = std::to_string(fps);

    std::string vf;
    if (effect == "none" || effect == "static") {
        vf = "scale=" + cw + ":" + ch + ":force_original_aspect_ratio=increase,"
             "crop=" + cw + ":" + ch + ",format=yuv420p";
    } else if (effect == "zoom_out") {
        vf = "scale=" + sw + ":" + sh + ":force_original_aspect_ratio=increase:flags=lanczos,"
             "crop=" + sw + ":" + sh + ","
             "zoompan=z='1.15-0.10*sin(on/" + fr + "*PI/2)':"
             "x='0':y='0':d=" + fr + ":s=" + cw + "x" + ch + ":fps=" + fpsStr + ",format=yuv420p";
    } else if (effect == "pan_left") {
        vf = "scale=" + sw + ":" + sh + ":force_original_aspect_ratio=increase:flags=lanczos,"
             "crop=" + sw + ":" + sh + ","
             "zoompan=z='1.0':x='(iw-ow)*on/" + fr + "':y='0':"
             "d=" + fr + ":s=" + cw + "x" + ch + ":fps=" + fpsStr + ",format=yuv420p";
    } else if (effect == "pan_right") {
        vf = "scale=" + sw + ":" + sh + ":force_original_aspect_ratio=increase:flags=lanczos,"
             "crop=" + sw + ":" + sh + ","
             "zoompan=z='1.0':x='(iw-ow)*(1-on/" + fr + ")':y='0':"
             "d=" + fr + ":s=" + cw + "x" + ch + ":fps=" + fpsStr + ",format=yuv420p";
    } else {
        vf = "scale=" + sw + ":" + sh + ":force_original_aspect_ratio=increase:flags=lanczos,"
             "crop=" + sw + ":" + sh + ","
             "zoompan=z='1.0+0.10*sin(on/" + fr + "*PI/2)':"
             "x='0':y='0':d=" + fr + ":s=" + cw + "x" + ch + ":fps=" + fpsStr + ",format=yuv420p";
    }

    // Check if input is video (gif/webm with animation)
    std::string ext = fs::path(imagePath).extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
    bool isVideo = (ext == ".mp4" || ext == ".mov" || ext == ".avi" || 
                    ext == ".mkv" || ext == ".webm" || ext == ".m4v");

    std::vector<std::string> cmd;
    if (isVideo) {
        cmd = {
            config.ffmpegPath, "-y", "-i", imagePath, "-t", std::to_string(dur),
            "-vf", vf, "-an", "-r", fpsStr,
            "-c:v", config.encoderName, "-preset", config.encoderPreset,
            "-pix_fmt", "yuv420p", "-map_metadata", "-1",
            "-movflags", "+faststart", "-loglevel", "error", outputPath
        };
    } else {
        cmd = {
            config.ffmpegPath, "-y", "-loop", "1", "-i", imagePath,
            "-frames:v", fr, "-vf", vf, "-an", "-r", fpsStr,
            "-c:v", config.encoderName, "-preset", config.encoderPreset,
            "-pix_fmt", "yuv420p", "-map_metadata", "-1",
            "-movflags", "+faststart", "-loglevel", "error", outputPath
        };
    }

    int ret = runFFmpeg(cmd);
    if (ret != 0) {
        // Fallback: software encoder
        for (auto& arg : cmd) {
            if (arg == config.encoderName) arg = "libx264";
            if (arg == config.encoderPreset) arg = "ultrafast";
        }
        ret = runFFmpeg(cmd);
    }

    return ret == 0;
}


// ─── Full Pipelines ──────────────────────────────────────────

CutResult executeAutoSync(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress,
    LogCallback onLog,
    StopCheck shouldStop
) {
    CutResult result = {static_cast<int>(cuts.size()), 0, 0, 0.0, true, ""};

    std::string outAud = config.outputDir + "/audios";
    std::string outVid = config.outputDir + "/videos";
    fs::create_directories(outAud);
    fs::create_directories(outVid);

    for (size_t i = 0; i < cuts.size(); ++i) {
        if (shouldStop && shouldStop()) {
            if (onLog) onLog("🛑 STOPPED.");
            break;
        }

        const auto& cut = cuts[i];
        double duration = cut.endTime - cut.startTime;
        result.totalDuration += duration;

        // Pad video ID to 3 digits
        char vidStr[8];
        std::snprintf(vidStr, sizeof(vidStr), "%03d", cut.videoId);

        // Cut audio
        std::string aOut = outAud + "/" + vidStr + ".mp3";
        if (cutAudio(cut, config.audioPath, aOut, config.ffmpegPath)) {
            result.audioClips++;
        }

        // Cut video
        std::string vOut = outVid + "/" + vidStr + ".mp4";
        if (cutVideo(cut, config.videoSourceDir, vOut, config)) {
            result.videoClips++;
        }

        // Progress
        if (onProgress) {
            onProgress(static_cast<int>(i + 1), result.totalClips,
                      "V" + std::string(vidStr) + " | " +
                      std::to_string(duration).substr(0, 5) + "s");
        }

        if (onLog) {
            std::string textShort = cut.text.substr(0, 40);
            onLog("[" + std::to_string(i + 1) + "/" + std::to_string(result.totalClips) +
                  "] V" + vidStr + " | " + std::to_string(duration).substr(0, 5) + "s | " + textShort);
        }
    }

    return result;
}


CutResult executeAutoImage(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress,
    LogCallback onLog,
    StopCheck shouldStop
) {
    CutResult result = {static_cast<int>(cuts.size()), 0, 0, 0.0, true, ""};

    std::string outAud = config.outputDir + "/audios";
    std::string outVid = config.outputDir + "/videos";
    fs::create_directories(outAud);
    fs::create_directories(outVid);

    // List visual files
    auto files = listVisualFiles(config.imageSourceDir);
    if (files.empty()) {
        result.success = false;
        result.error = "Image folder empty: " + config.imageSourceDir;
        return result;
    }

    size_t cursor = 0;

    for (size_t i = 0; i < cuts.size(); ++i) {
        if (shouldStop && shouldStop()) {
            if (onLog) onLog("🛑 STOPPED.");
            break;
        }

        const auto& cut = cuts[i];
        double duration = std::max(0.10, cut.endTime - cut.startTime);
        result.totalDuration += duration;

        char vidStr[8];
        std::snprintf(vidStr, sizeof(vidStr), "%03d", cut.videoId);

        // Cut audio
        std::string aOut = outAud + "/" + vidStr + ".mp3";
        if (cutAudio(cut, config.audioPath, aOut, config.ffmpegPath)) {
            result.audioClips++;
        }

        // Pick next visual file (round-robin)
        std::string picked;
        for (size_t tries = 0; tries < files.size(); ++tries) {
            const auto& p = files[cursor % files.size()];
            cursor++;
            if (hasVideoStream(p, config.ffprobePath)) {
                picked = p;
                break;
            }
        }

        if (picked.empty()) {
            if (onLog) onLog("❌ V" + std::string(vidStr) + " No readable visual file");
            continue;
        }

        // Create image clip with Ken Burns
        std::string vOut = outVid + "/" + vidStr + ".mp4";
        if (createImageClip(picked, vOut, duration, config)) {
            result.videoClips++;
        }

        if (onProgress) {
            onProgress(static_cast<int>(i + 1), result.totalClips, "Image V" + std::string(vidStr));
        }

        if (onLog) {
            std::string imgName = picked.empty() ? "(none)" : fs::path(picked).filename().string();
            std::string textShort = cut.text.substr(0, 40);
            onLog("[" + std::to_string(i + 1) + "/" + std::to_string(result.totalClips) +
                  "] V" + vidStr + " | " + std::to_string(duration).substr(0, 5) + "s | " + imgName + " | " + textShort);
        }
    }

    return result;
}


CutResult executeAutoMixed(
    const std::vector<autosync::CutPoint>& cuts,
    const CutConfig& config,
    autosync::ProgressCallback onProgress,
    LogCallback onLog,
    StopCheck shouldStop
) {
    CutResult result = {static_cast<int>(cuts.size()), 0, 0, 0.0, true, ""};

    std::string outAud = config.outputDir + "/audios";
    std::string outVid = config.outputDir + "/videos";
    fs::create_directories(outAud);
    fs::create_directories(outVid);

    // Video + Image extensions for classification
    static const std::set<std::string> videoExts = {
        ".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".flv", ".wmv"
    };

    // Determine media source dir (both videoSourceDir and imageSourceDir may point here)
    std::string mediaDir = config.imageSourceDir;
    if (mediaDir.empty()) mediaDir = config.videoSourceDir;

    for (size_t i = 0; i < cuts.size(); ++i) {
        if (shouldStop && shouldStop()) break;

        const auto& cut = cuts[i];
        double duration = std::max(0.10, cut.endTime - cut.startTime);
        result.totalDuration += duration;

        char vidStr[8];
        std::snprintf(vidStr, sizeof(vidStr), "%03d", cut.videoId);

        // Cut audio
        std::string aOut = outAud + "/" + vidStr + ".mp3";
        if (cutAudio(cut, config.audioPath, aOut, config.ffmpegPath))
            result.audioClips++;

        // ── Find ANY file matching this videoId in mediaDir ──
        std::string vOut = outVid + "/" + vidStr + ".mp4";
        std::string source;
        bool sourceIsVideo = false;

        if (!mediaDir.empty() && fs::is_directory(mediaDir)) {
            for (const auto& entry : fs::directory_iterator(mediaDir)) {
                if (!entry.is_regular_file()) continue;

                std::string stem = entry.path().stem().string();
                std::string s = stem;
                s.erase(0, s.find_first_not_of(" \t"));
                s.erase(s.find_last_not_of(" \t") + 1);
                if (!s.empty() && (s[0] == 'V' || s[0] == 'v')) s = s.substr(1);

                try {
                    if (std::stoi(s) == cut.videoId) {
                        source = entry.path().string();
                        std::string ext = entry.path().extension().string();
                        std::transform(ext.begin(), ext.end(), ext.begin(), ::tolower);
                        sourceIsVideo = videoExts.count(ext) > 0;
                        break;
                    }
                } catch (...) { continue; }
            }
        }

        if (!source.empty()) {
            if (sourceIsVideo) {
                // ── VIDEO: cut + scale to canvas with bgBlur ──
                if (cutVideoToCanvas(source, vOut, duration, config)) {
                    result.videoClips++;
                }
            } else {
                // ── IMAGE: Ken Burns effect ──
                if (createImageClip(source, vOut, duration, config)) {
                    result.videoClips++;
                }
            }
        }

        if (onProgress) {
            std::string tag = sourceIsVideo ? "🎬 Video" : "🖼️ Image";
            onProgress(static_cast<int>(i + 1), result.totalClips, tag + " V" + std::string(vidStr));
        }

        if (onLog) {
            std::string srcName = source.empty() ? "(none)" : fs::path(source).filename().string();
            std::string tag = sourceIsVideo ? "🎬" : "🖼️";
            std::string textShort = cut.text.substr(0, 40);
            onLog("[" + std::to_string(i + 1) + "/" + std::to_string(result.totalClips) +
                  "] V" + vidStr + " " + tag + " " + srcName + " | " +
                  std::to_string(duration).substr(0, 5) + "s | " + textShort);
        }
    }

    return result;
}

} // namespace cutting
