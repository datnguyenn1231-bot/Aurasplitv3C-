/**
 * AuraEngine — Entry point (AuraSplit v3).
 * 
 * Modes:
 *   REUP:      aura_engine --config config.json
 *   AUTOSYNC:  aura_engine --mode autosync --config sync.json
 *   AUTOIMAGE: aura_engine --mode autoimage --config sync.json
 *   AUTOMIXED: aura_engine --mode automixed --config sync.json
 *   MERGE:     aura_engine --mode merge --config merge.json
 * 
 * Progress is reported as JSON lines to stdout:
 *   {"progress": 0.45, "frame": 1350, "total": 3000, "fps": 120.5}
 *   {"done": true, "success": true}
 */

#include "engine.h"
#include "autosync.h"
#include "cutting.h"
#include "merging.h"
#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <cstring>
#include <csignal>

#ifdef _WIN32
#include <windows.h>
#endif

// — Global engine ref for signal handling —
static AuraEngine* g_engine = nullptr;
static bool g_stopped = false;

void signalHandler(int sig) {
    (void)sig;
    g_stopped = true;
    if (g_engine) g_engine->stop();
}

// â”€â”€ Minimal JSON value parser (no external dependency) â”€â”€
static std::string jsonGetString(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(":", pos + search.size());
    if (pos == std::string::npos) return "";
    pos = json.find("\"", pos + 1);
    if (pos == std::string::npos) return "";
    pos++;
    std::string result;
    for (size_t i = pos; i < json.size(); i++) {
        if (json[i] == '\\' && i + 1 < json.size()) {
            char next = json[i + 1];
            if (next == '\\') { result += '\\'; i++; }
            else if (next == '/') { result += '/'; i++; }
            else if (next == '"') { result += '"'; i++; }
            else if (next == 'n') { result += '\n'; i++; }
            else { result += json[i]; }
        } else if (json[i] == '"') {
            break;
        } else {
            result += json[i];
        }
    }
    return result;
}

static int jsonGetInt(const std::string& json, const std::string& key, int def) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return def;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return def;
    return std::atoi(json.c_str() + pos + 1);
}

static double jsonGetDouble(const std::string& json, const std::string& key, double def) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return def;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return def;
    return std::atof(json.c_str() + pos + 1);
}

static bool jsonGetBool(const std::string& json, const std::string& key, bool def) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return def;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return def;
    std::string rest = json.substr(pos + 1, 10);
    return rest.find("true") != std::string::npos;
}

// Backward-compatible: handles bool (true=1.0, false=0.0) AND number (0.0-1.0)
static float jsonGetFloatOrBool(const std::string& json, const std::string& key, float def) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return def;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return def;
    // Skip whitespace after colon
    size_t vStart = pos + 1;
    while (vStart < json.size() && json[vStart] == ' ') vStart++;
    if (vStart >= json.size()) return def;
    // Check for boolean
    if (json.substr(vStart, 4) == "true") return 1.0f;
    if (json.substr(vStart, 5) == "false") return 0.0f;
    // Otherwise parse as number
    return (float)std::atof(json.c_str() + vStart);
}

EngineConfig parseConfigFromString(const std::string& json) {
    EngineConfig cfg;
    cfg.inputPath = jsonGetString(json, "input");
    cfg.outputPath = jsonGetString(json, "output");
    cfg.outputWidth = jsonGetInt(json, "width", 1080);
    cfg.outputHeight = jsonGetInt(json, "height", 1920);
    cfg.speed = (float)jsonGetDouble(json, "speed", 1.0);
    cfg.useGpu = jsonGetBool(json, "gpu", true);
    cfg.crf = jsonGetInt(json, "crf", 23);
    cfg.preset = jsonGetString(json, "preset");
    if (cfg.preset.empty()) cfg.preset = "p1";
    cfg.mirror = jsonGetBool(json, "mirror", false);
    cfg.noise = jsonGetBool(json, "noise", false);
    cfg.noiseIntensity = jsonGetInt(json, "noiseIntensity", 10);
    cfg.hdr = jsonGetBool(json, "hdr", false);
    cfg.glow = jsonGetBool(json, "glow", false);
    cfg.rgbDrift = jsonGetBool(json, "rgbDrift", false);
    cfg.lensDistortion = jsonGetBool(json, "lensDistortion", false);
    cfg.rotate = (float)jsonGetDouble(json, "rotate", 0.0);
    cfg.borderWidth = jsonGetInt(json, "borderWidth", 0);
    cfg.borderColor = jsonGetString(json, "borderColor");
    if (cfg.borderColor.empty()) cfg.borderColor = "#000000";
    cfg.colorGrading = jsonGetString(json, "colorGrading");
    if (cfg.colorGrading.empty()) cfg.colorGrading = "none";
    cfg.zoomEffect = jsonGetBool(json, "zoomEffect", false);
    cfg.zoomIntensity = (float)jsonGetDouble(json, "zoomIntensity", 1.0);
    cfg.zoomPeriod = (float)jsonGetDouble(json, "zoomPeriod", 16.0);
    cfg.zoomPhase = (float)jsonGetDouble(json, "zoomPhase", 0.0);
    cfg.microZoom = (float)jsonGetDouble(json, "microZoom", 1.0);
    cfg.removeAudio = jsonGetBool(json, "removeAudio", false);
    cfg.parallel = jsonGetInt(json, "parallel", 2);
    cfg.cropX = (float)jsonGetDouble(json, "cropX", 0.0);
    cfg.cropY = (float)jsonGetDouble(json, "cropY", 0.0);
    cfg.crop = (float)jsonGetDouble(json, "crop", 0.0);
    cfg.reframeZoom = (float)jsonGetDouble(json, "reframeZoom", 100.0);
    cfg.reframeScaleX = (float)jsonGetDouble(json, "reframeScaleX", 100.0);
    cfg.reframeScaleY = (float)jsonGetDouble(json, "reframeScaleY", 100.0);
    cfg.reframePosX = (float)jsonGetDouble(json, "reframePosX", 0.0);
    cfg.reframePosY = (float)jsonGetDouble(json, "reframePosY", 0.0);
    cfg.pixelEnlarge = jsonGetFloatOrBool(json, "pixelEnlarge", 0.0f);
    cfg.chromaShuffle = jsonGetFloatOrBool(json, "chromaShuffle", 0.0f);
    cfg.frameJitter = jsonGetFloatOrBool(json, "frameJitter", 0.0f);
    cfg.gammaShift = jsonGetFloatOrBool(json, "gammaShift", 0.0f);
    cfg.microColorCycle = jsonGetFloatOrBool(json, "microColorCycle", 0.0f);
    cfg.dctNoise = jsonGetFloatOrBool(json, "dctNoise", 0.0f);
    cfg.bgBlur = jsonGetBool(json, "bgBlur", false);
    cfg.bgBlurAmount = jsonGetInt(json, "bgBlurAmount", 40);
    cfg.logoPath = jsonGetString(json, "logoPath");
    cfg.logoSize = jsonGetInt(json, "logoSize", 12);
    cfg.logoPosition = jsonGetString(json, "logoPosition");
    if (cfg.logoPosition.empty()) cfg.logoPosition = "bottom-right";
    cfg.overlayPath = jsonGetString(json, "overlayPath");
    cfg.overlayOpacity = (float)jsonGetDouble(json, "overlayOpacity", 100.0);
    cfg.overlayBlink = jsonGetBool(json, "overlayBlink", false);
    cfg.overlayBlinkSpeed = (float)jsonGetDouble(json, "overlayBlinkSpeed", 1.0);
    cfg.overlayInterval = (float)jsonGetDouble(json, "overlayInterval", 3.0);
    cfg.titleText = jsonGetString(json, "titleText");
    cfg.descText = jsonGetString(json, "descText");
    cfg.textFont = jsonGetString(json, "textFont");
    if (cfg.textFont.empty()) cfg.textFont = "Inter";
    cfg.textColor = jsonGetString(json, "textColor");
    if (cfg.textColor.empty()) cfg.textColor = "#ffffff";
    cfg.titleFontSize = jsonGetInt(json, "titleFontSize", 24);
    cfg.descFontSize = jsonGetInt(json, "descFontSize", 14);
    cfg.titleOffsetX = jsonGetInt(json, "titleOffsetX", 0);
    cfg.titleOffsetY = jsonGetInt(json, "titleOffsetY", 0);
    cfg.descOffsetX = jsonGetInt(json, "descOffsetX", 0);
    cfg.descOffsetY = jsonGetInt(json, "descOffsetY", 0);
    cfg.srtPath = jsonGetString(json, "srtPath");
    cfg.wordsJsonPath = jsonGetString(json, "wordsJsonPath");
    cfg.assPath = jsonGetString(json, "assPath");
    cfg.fontsDir = jsonGetString(json, "fontsDir");
    cfg.subStyle = jsonGetString(json, "subStyle");
    if (cfg.subStyle.empty()) cfg.subStyle = "bold_center";
    cfg.subFontPath = jsonGetString(json, "subFontPath");
    cfg.subFontSize = jsonGetInt(json, "subFontSize", 42);
    cfg.subAnimation = jsonGetString(json, "subAnimation");
    if (cfg.subAnimation.empty()) cfg.subAnimation = "none";
    cfg.subColor = jsonGetString(json, "subColor");
    if (cfg.subColor.empty()) cfg.subColor = "#ffffff";
    cfg.subPosition = jsonGetString(json, "subPosition");
    if (cfg.subPosition.empty()) cfg.subPosition = "bottom";
    cfg.audioEvade = jsonGetBool(json, "audioEvade", false);
    cfg.volumeBoost = (float)jsonGetDouble(json, "volumeBoost", 1.0);
    cfg.vFilterChain = jsonGetString(json, "vFilterChain");
    return cfg;
}

EngineConfig parseConfigFromFile(const std::string& jsonPath) {
    std::ifstream file(jsonPath);
    std::stringstream ss;
    ss << file.rdbuf();
    return parseConfigFromString(ss.str());
}

// â”€â”€ Progress reporter (JSON to stdout) â”€â”€
void reportProgress(int64_t current, int64_t total, double fps) {
    double progress = total > 0 ? (double)current / total : 0;
    printf("{\"progress\": %.4f, \"frame\": %lld, \"total\": %lld, \"fps\": %.1f}\n",
           progress, (long long)current, (long long)total, fps);
    fflush(stdout);
}

// â”€â”€ AutoSync progress reporter (JSON to stdout) â”€â”€
void reportAutoSyncProgress(int current, int total, const std::string& msg) {
    double progress = total > 0 ? (double)current / total : 0;
    printf("{\"progress\": %.4f, \"clip\": %d, \"total\": %d, \"message\": \"%s\"}\n",
           progress, current, total, msg.c_str());
    fflush(stdout);
}

void reportAutoSyncLog(const std::string& msg) {
    printf("{\"log\": \"%s\"}\n", msg.c_str());
    fflush(stdout);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// AutoSync Mode â€” parse words, match script, cut video
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

static int runAutoSync(const std::string& configPath, const std::string& mode) {
    // Read config JSON
    std::ifstream configFile(configPath);
    if (!configFile.is_open()) {
        fprintf(stderr, "Error: Cannot open config: %s\n", configPath.c_str());
        return 1;
    }
    std::stringstream ss;
    ss << configFile.rdbuf();
    std::string json = ss.str();

    // Parse AutoSync config
    std::string audioPath      = jsonGetString(json, "audio_path");
    std::string scriptPath     = jsonGetString(json, "script_path");
    std::string wordsJsonPath  = jsonGetString(json, "words_json_path");
    std::string videoSourceDir = jsonGetString(json, "video_source_dir");
    std::string imageSourceDir = jsonGetString(json, "image_source_dir");
    std::string outputDir      = jsonGetString(json, "output_dir");
    std::string ffmpegPath     = jsonGetString(json, "ffmpeg_path");
    std::string effectType     = jsonGetString(json, "effect_type");
    int canvasW                = jsonGetInt(json, "canvas_width", 1080);
    int canvasH                = jsonGetInt(json, "canvas_height", 1920);

    if (ffmpegPath.empty()) ffmpegPath = "ffmpeg";
    if (effectType.empty()) effectType = "kenburns";

    fprintf(stderr, "[ENGINE] Mode: %s | Audio: %s\n", mode.c_str(), audioPath.c_str());

    // Step 1: Load words from WhisperX output
    std::vector<autosync::Word> words;
    if (!wordsJsonPath.empty()) {
        // Windows UTF-8 path support
#ifdef _WIN32
        int wlen = MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, nullptr, 0);
        std::wstring wpath(wlen, 0);
        MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, &wpath[0], wlen);
        std::ifstream wf(wpath.c_str());
#else
        std::ifstream wf(wordsJsonPath);
#endif
        if (wf.is_open()) {
            std::string wjson((std::istreambuf_iterator<char>(wf)),
                               std::istreambuf_iterator<char>());
            // Parse words array — look for "word" key inside "words" array only
            size_t wordsArrayStart = wjson.find("\"words\"");
            if (wordsArrayStart == std::string::npos) wordsArrayStart = 0;
            size_t pos = wordsArrayStart;
            while ((pos = wjson.find("\"word\"", pos)) != std::string::npos) {
                // Find the enclosing { } for this word object
                size_t objStart = wjson.rfind('{', pos);
                size_t objEnd = wjson.find('}', pos);
                if (objStart == std::string::npos || objEnd == std::string::npos) { pos += 6; continue; }
                std::string obj = wjson.substr(objStart, objEnd - objStart + 1);
                autosync::Word w;
                w.text = jsonGetString(obj, "word");
                w.startTime = jsonGetDouble(obj, "start", 0);
                w.endTime = jsonGetDouble(obj, "end", 0);
                if (!w.text.empty() && w.endTime > 0) words.push_back(w);
                pos = objEnd + 1;
            }
            fprintf(stderr, "[ENGINE] Loaded %zu words from %s\n", words.size(), wordsJsonPath.c_str());
        } else {
            fprintf(stderr, "[ENGINE] ERROR: Cannot open words file: %s\n", wordsJsonPath.c_str());
        }
    }

    // Step 2: Parse script or SRT
    std::vector<autosync::CutPoint> cuts;
    
    if (!scriptPath.empty()) {
        // Windows UTF-8 path support for script file
#ifdef _WIN32
        int swlen = MultiByteToWideChar(CP_UTF8, 0, scriptPath.c_str(), -1, nullptr, 0);
        std::wstring swpath(swlen, 0);
        MultiByteToWideChar(CP_UTF8, 0, scriptPath.c_str(), -1, &swpath[0], swlen);
        std::ifstream sf(swpath.c_str());
#else
        std::ifstream sf(scriptPath);
#endif
        if (!sf.is_open()) {
            fprintf(stderr, "[ENGINE] ERROR: Cannot open script file: %s\n", scriptPath.c_str());
            printf("{\"done\": true, \"success\": false, \"error\": \"Cannot open script file\"}\n");
            return 1;
        }
        std::string scriptContent((std::istreambuf_iterator<char>(sf)),
                                   std::istreambuf_iterator<char>());

        fprintf(stderr, "[ENGINE] Script file loaded: %zu bytes\n", scriptContent.size());

        // Check if SRT format
        bool isSRT = scriptPath.size() > 4 &&
                     (scriptPath.substr(scriptPath.size() - 4) == ".srt" ||
                      scriptPath.substr(scriptPath.size() - 4) == ".SRT");

        if (isSRT) {
            // SRT mode: timestamps from subtitle file
            cuts = autosync::parseSRT(scriptContent);
            fprintf(stderr, "[ENGINE] SRT mode: %zu segments\n", cuts.size());

            // Trim silence
            auto silence = autosync::detectSilence(audioPath, ffmpegPath);
            cuts = autosync::trimTrailingSilence(cuts, silence);
        } else {
            // TXT mode: Check for Python forced-alignment cut_points first
            bool usedForcedCuts = false;
            if (!wordsJsonPath.empty()) {
                #ifdef _WIN32
                int cp_wlen = MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, nullptr, 0);
                std::wstring cp_wpath(cp_wlen, 0);
                MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, &cp_wpath[0], cp_wlen);
                std::ifstream cpf(cp_wpath.c_str());
                #else
                std::ifstream cpf(wordsJsonPath);
                #endif
                if (cpf.is_open()) {
                    std::string cpjson((std::istreambuf_iterator<char>(cpf)),
                                       std::istreambuf_iterator<char>());
                    size_t cpPos = cpjson.find("\"cut_points\"");
                    if (cpPos != std::string::npos) {
                        size_t arrStart = cpjson.find('[', cpPos);
                        if (arrStart != std::string::npos) {
                            size_t pos = arrStart;
                            while ((pos = cpjson.find("\"videoId\"", pos)) != std::string::npos) {
                                size_t objStart = cpjson.rfind('{', pos);
                                size_t objEnd = cpjson.find('}', pos);
                                if (objStart == std::string::npos || objEnd == std::string::npos) { pos += 9; continue; }
                                std::string obj = cpjson.substr(objStart, objEnd - objStart + 1);
                                autosync::CutPoint cp;
                                cp.videoId = jsonGetInt(obj, "videoId", 0);
                                cp.startTime = jsonGetDouble(obj, "startTime", 0);
                                cp.endTime = jsonGetDouble(obj, "endTime", 0);
                                cp.text = jsonGetString(obj, "text");
                                if (cp.videoId > 0 && cp.endTime > cp.startTime) {
                                    cuts.push_back(cp);
                                }
                                pos = objEnd + 1;
                            }
                        }
                        if (!cuts.empty()) {
                            fprintf(stderr, "[ENGINE] ✅ Using forced-alignment cut points: %zu segments\n", cuts.size());
                            usedForcedCuts = true;
                        }
                    }
                }
            }

            // Fallback: Time-proportional mapping using audio_duration
            if (!usedForcedCuts) {
                auto scriptItems = autosync::parseScript(scriptContent);
                fprintf(stderr, "[ENGINE] Script: %zu items, Words: %zu\n",
                        scriptItems.size(), words.size());

                // Read audio_duration from words JSON
                double audioDuration = 0.0;
                if (!wordsJsonPath.empty()) {
                    #ifdef _WIN32
                    int ad_wlen = MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, nullptr, 0);
                    std::wstring ad_wpath(ad_wlen, 0);
                    MultiByteToWideChar(CP_UTF8, 0, wordsJsonPath.c_str(), -1, &ad_wpath[0], ad_wlen);
                    std::ifstream adf(ad_wpath.c_str());
                    #else
                    std::ifstream adf(wordsJsonPath);
                    #endif
                    if (adf.is_open()) {
                        std::string adjson((std::istreambuf_iterator<char>(adf)),
                                           std::istreambuf_iterator<char>());
                        audioDuration = jsonGetDouble(adjson, "audio_duration", 0.0);
                    }
                }

                if (audioDuration > 0 && !scriptItems.empty()) {
                    // PURE TIME-PROPORTIONAL MAPPING
                    // time_per_word = audio_duration / total_script_words
                    // Each [V] gets proportional share of total time
                    // No whisper word timestamps needed!
                    int totalScriptWords = 0;
                    for (const auto& item : scriptItems) {
                        totalScriptWords += autosync::countWords(item.text);
                    }

                    double timePerWord = audioDuration / (totalScriptWords > 0 ? totalScriptWords : 1);
                    fprintf(stderr, "[ENGINE] Time-proportional: %.3fs / %d words = %.4fs/word\n",
                            audioDuration, totalScriptWords, timePerWord);

                    double cumTime = 0.0;
                    for (const auto& item : scriptItems) {
                        int wc = autosync::countWords(item.text);
                        autosync::CutPoint cut;
                        cut.videoId = item.videoId;
                        cut.text = item.text;
                        cut.startTime = cumTime;
                        cumTime += wc * timePerWord;
                        cut.endTime = cumTime;
                        cuts.push_back(cut);
                    }
                    fprintf(stderr, "[ENGINE] Time-proportional: %zu segments mapped\n", cuts.size());
                } else {
                    // No audio_duration — use word-level timestamps
                    cuts = autosync::matchWordsToScript(words, scriptItems, {},
                                                         reportAutoSyncProgress);
                }
            }
        }
    }

    if (cuts.empty()) {
        fprintf(stderr, "[ENGINE] Error: No cuts generated\n");
        printf("{\"done\": true, \"success\": false, \"error\": \"No cuts\"}\n");
        return 1;
    }

    fprintf(stderr, "[ENGINE] Cutting %zu segments...\n", cuts.size());

    // Step 3: Setup cutting config
    cutting::CutConfig cutConfig;
    cutConfig.audioPath      = audioPath;
    cutConfig.videoSourceDir = videoSourceDir;
    cutConfig.imageSourceDir = imageSourceDir;
    cutConfig.outputDir      = outputDir;
    cutConfig.ffmpegPath     = ffmpegPath;
    cutConfig.canvasWidth    = canvasW;
    cutConfig.canvasHeight   = canvasH;
    cutConfig.effectType     = effectType;

    // Detect best encoder
    auto [enc, preset] = cutting::detectBestEncoder(ffmpegPath);
    cutConfig.encoderName   = enc;
    cutConfig.encoderPreset = preset;
    fprintf(stderr, "[ENGINE] Encoder: %s (%s)\n", enc.c_str(), preset.c_str());

    // Step 4: Execute cutting pipeline
    cutting::CutResult result;

    if (mode == "autosync") {
        result = cutting::executeAutoSync(cuts, cutConfig,
            reportAutoSyncProgress, reportAutoSyncLog,
            []() { return g_stopped; });
    } else if (mode == "autoimage") {
        result = cutting::executeAutoImage(cuts, cutConfig,
            reportAutoSyncProgress, reportAutoSyncLog,
            []() { return g_stopped; });
    } else if (mode == "automixed") {
        result = cutting::executeAutoMixed(cuts, cutConfig,
            reportAutoSyncProgress, reportAutoSyncLog,
            []() { return g_stopped; });
    }

    // Report final
    printf("{\"done\": true, \"success\": %s, \"audio_clips\": %d, \"video_clips\": %d, \"duration\": %.1f}\n",
           result.success ? "true" : "false",
           result.audioClips, result.videoClips, result.totalDuration);
    fflush(stdout);

    return result.success ? 0 : 1;
}


// â”€â”€ Main â”€â”€
int main(int argc, char* argv[]) {
    signal(SIGINT, signalHandler);
    signal(SIGTERM, signalHandler);

    std::string mode;
    std::string configPath;
    EngineConfig config;
    bool hasBatch = false;

    // Parse command line
    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--mode") == 0 && i + 1 < argc) {
            mode = argv[++i];
        } else if (strcmp(argv[i], "--config") == 0 && i + 1 < argc) {
            configPath = argv[++i];
            if (mode.empty()) {
                config = parseConfigFromFile(configPath);
            }
        } else if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            config.inputPath = argv[++i];
        } else if (strcmp(argv[i], "--output") == 0 && i + 1 < argc) {
            config.outputPath = argv[++i];
        } else if (strcmp(argv[i], "--width") == 0 && i + 1 < argc) {
            config.outputWidth = std::atoi(argv[++i]);
        } else if (strcmp(argv[i], "--height") == 0 && i + 1 < argc) {
            config.outputHeight = std::atoi(argv[++i]);
        } else if (strcmp(argv[i], "--gpu") == 0) {
            config.useGpu = true;
        } else if (strcmp(argv[i], "--cpu") == 0) {
            config.useGpu = false;
        } else if (strcmp(argv[i], "--parallel") == 0 && i + 1 < argc) {
            config.parallel = std::atoi(argv[++i]);
        } else if (strcmp(argv[i], "--batch") == 0) {
            hasBatch = true;
            for (int j = i + 1; j < argc; j++) {
                if (argv[j][0] == '-') break;
                config.batchInputs.push_back(argv[j]);
                i = j;
            }
        }
    }

    // ── Merge mode ──
    if (mode == "merge") {
        if (configPath.empty()) {
            fprintf(stderr, "Error: --config required for merge mode\n");
            return 1;
        }
        std::ifstream mf(configPath);
        if (!mf.is_open()) {
            fprintf(stderr, "Error: Cannot open config: %s\n", configPath.c_str());
            return 1;
        }
        std::stringstream mss;
        mss << mf.rdbuf();
        std::string mjson = mss.str();

        merging::MergeConfig mcfg;
        mcfg.outputPath = jsonGetString(mjson, "output");
        mcfg.width = jsonGetInt(mjson, "width", 1920);
        mcfg.height = jsonGetInt(mjson, "height", 1080);
        mcfg.useGpu = jsonGetBool(mjson, "gpu", true);
        mcfg.transitionDuration = jsonGetDouble(mjson, "transition_duration", 1.0);
        mcfg.ffmpegPath = jsonGetString(mjson, "ffmpeg_path");

        // Parse videos array: "videos": ["path1", "path2", ...]
        {
            size_t pos = mjson.find("\"videos\"");
            if (pos != std::string::npos) {
                size_t arrStart = mjson.find('[', pos);
                size_t arrEnd = mjson.find(']', arrStart);
                if (arrStart != std::string::npos && arrEnd != std::string::npos) {
                    std::string arr = mjson.substr(arrStart + 1, arrEnd - arrStart - 1);
                    size_t p = 0;
                    while ((p = arr.find('"', p)) != std::string::npos) {
                        size_t end = arr.find('"', p + 1);
                        if (end == std::string::npos) break;
                        std::string val = arr.substr(p + 1, end - p - 1);
                        // Unescape backslashes
                        std::string clean;
                        for (size_t i = 0; i < val.size(); i++) {
                            if (val[i] == '\\' && i+1 < val.size() && (val[i+1] == '\\' || val[i+1] == '/'))
                                { clean += val[i+1]; i++; }
                            else clean += val[i];
                        }
                        if (!clean.empty()) mcfg.videos.push_back(clean);
                        p = end + 1;
                    }
                }
            }
        }

        // Parse transitions array: "transitions": ["dissolve", "fade", ...]
        {
            size_t pos = mjson.find("\"transitions\"");
            if (pos != std::string::npos) {
                size_t arrStart = mjson.find('[', pos);
                size_t arrEnd = mjson.find(']', arrStart);
                if (arrStart != std::string::npos && arrEnd != std::string::npos) {
                    std::string arr = mjson.substr(arrStart + 1, arrEnd - arrStart - 1);
                    size_t p = 0;
                    while ((p = arr.find('"', p)) != std::string::npos) {
                        size_t end = arr.find('"', p + 1);
                        if (end == std::string::npos) break;
                        mcfg.transitions.push_back(arr.substr(p + 1, end - p - 1));
                        p = end + 1;
                    }
                }
            }
        }

        fprintf(stderr, "[ENGINE] Merge mode: %zu videos, %zu transitions\n",
                mcfg.videos.size(), mcfg.transitions.size());

        auto mergeResult = merging::executeMerge(mcfg,
            [](int64_t cur, int64_t total, double fps) {
                double progress = total > 0 ? (double)cur / total : 0;
                printf("{\"progress\": %.4f, \"frame\": %lld, \"total\": %lld, \"fps\": %.1f}\n",
                       progress, (long long)cur, (long long)total, fps);
                fflush(stdout);
            },
            [](const std::string& msg) {
                printf("{\"log\": \"%s\"}\n", msg.c_str());
                fflush(stdout);
            },
            []() { return g_stopped; }
        );

        printf("{\"done\": true, \"success\": %s, \"duration\": %.1f}\n",
               mergeResult.success ? "true" : "false", mergeResult.totalDuration);
        fflush(stdout);
        return mergeResult.success ? 0 : 1;
    }

    // ── AutoSync/AutoImage/AutoMixed modes ──
    if (mode == "autosync" || mode == "autoimage" || mode == "automixed") {
        if (configPath.empty()) {
            fprintf(stderr, "Error: --config required for --%s mode\n", mode.c_str());
            return 1;
        }
        return runAutoSync(configPath, mode);
    }

    // â”€â”€ REUP mode (existing behavior) â”€â”€
    if (config.inputPath.empty() && config.batchInputs.empty()) {
        fprintf(stderr, "AuraEngine v2.0 â€” Video export + AutoSync engine\n\n");
        fprintf(stderr, "Usage:\n");
        fprintf(stderr, "  aura_engine --input video.mp4 --output out.mp4 [--gpu]\n");
        fprintf(stderr, "  aura_engine --mode autosync --config sync.json\n");
        fprintf(stderr, "  aura_engine --mode autoimage --config sync.json\n");
        fprintf(stderr, "  aura_engine --mode automixed --config sync.json\n");
        fprintf(stderr, "  aura_engine --config config.json\n");
        return 1;
    }

    if (config.outputPath.empty() && !config.inputPath.empty()) {
        std::string input = config.inputPath;
        size_t dotPos = input.rfind('.');
        if (dotPos != std::string::npos) {
            config.outputPath = input.substr(0, dotPos) + "_REUP.mp4";
        } else {
            config.outputPath = input + "_REUP.mp4";
        }
    }

    AuraEngine engine;
    g_engine = &engine;

    fprintf(stderr, "AuraEngine: %s â†’ %s (%dx%d, %s)\n",
            config.inputPath.c_str(), config.outputPath.c_str(),
            config.outputWidth, config.outputHeight,
            config.useGpu ? "NVENC GPU" : "CPU");

    int result;
    if (hasBatch || !config.batchInputs.empty()) {
        fprintf(stderr, "Batch mode: %zu files Ã— %d parallel\n",
                config.batchInputs.size(), config.parallel);
        result = engine.processBatch(config, reportProgress);
        printf("{\"done\": true, \"success\": %d, \"total\": %zu}\n",
               result, config.batchInputs.size());
    } else {
        result = engine.processVideo(config, reportProgress);
        printf("{\"done\": true, \"success\": %s}\n", result == 0 ? "true" : "false");
    }

    if (result < 0) {
        fprintf(stderr, "Error: %s\n", engine.getError().c_str());
    }

    g_engine = nullptr;
    return result == 0 ? 0 : 1;
}

