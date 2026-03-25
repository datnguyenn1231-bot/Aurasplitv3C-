#pragma once
/**
 * AuraEngine config — parsed from JSON input.
 * Matches the ReupConfig interface in TypeScript.
 */

#include <string>
#include <vector>

struct EngineConfig {
    // ── Input/Output ──
    std::string inputPath;
    std::string outputPath;
    
    // ── Effects ──
    bool mirror = false;
    float cropX = 0.0f;           // 0..0.5 = cut % from each side
    float cropY = 0.0f;
    float crop = 0.0f;            // uniform crop (fallback)
    float speed = 1.0f;
    bool noise = false;
    int noiseIntensity = 10;
    bool hdr = false;
    bool glow = false;
    bool rgbDrift = false;
    bool lensDistortion = false;
    float rotate = 0.0f;          // degrees
    int borderWidth = 0;
    std::string borderColor = "#000000";
    
    // ── Color grading ──
    std::string colorGrading = "none";  // warm, cool, vintage, etc.
    
    // ── Frame ──
    int outputWidth = 1080;
    int outputHeight = 1920;
    std::string frameTemplate = "none";
    
    // ── Zoom ──
    bool zoomEffect = false;
    float zoomIntensity = 1.0f;   // 1.0 = no zoom
    float zoomPeriod = 16.0f;
    float zoomPhase = 0.0f;
    float microZoom = 1.0f;
    
    // ── Reframe ──
    float reframeZoom = 100.0f;
    float reframeScaleX = 100.0f;
    float reframeScaleY = 100.0f;
    float reframePosX = 0.0f;
    float reframePosY = 0.0f;
    
    // ── Pixel-level anti-detect (0.0=off, 1.0=max) ──
    float pixelEnlarge = 0.0f;
    float chromaShuffle = 0.0f;
    // ── Advanced anti-detect (0.0=off, 1.0=max) ──
    float frameJitter = 0.0f;
    float gammaShift = 0.0f;
    float microColorCycle = 0.0f;
    float dctNoise = 0.0f;
    
    // ── BG Blur ──
    bool bgBlur = false;
    int bgBlurAmount = 40;
    
    // ── Logo ──
    std::string logoPath;
    int logoSize = 12;            // % of frame width
    std::string logoPosition = "bottom-right";
    
    // ── Overlay (video/image overlay on top) ──
    std::string overlayPath;
    float overlayOpacity = 100.0f;  // 0-100
    bool overlayBlink = false;
    float overlayBlinkSpeed = 1.0f; // seconds per blink cycle
    float overlayInterval = 3.0f;   // seconds between blinks
    // ── Title/Desc ──
    std::string titleText;
    std::string descText;
    std::string textFont = "Inter";
    std::string textColor = "#ffffff";
    int titleFontSize = 24;
    int descFontSize = 14;
    int titleOffsetX = 0;
    int titleOffsetY = 0;
    int descOffsetX = 0;
    int descOffsetY = 0;
    
    // ── Subtitle ──
    std::string srtPath;
    std::string wordsJsonPath;          // word-level timing JSON sidecar
    std::string assPath;                // pre-generated ASS file (shared with preview)
    std::string fontsDir;               // directory containing subtitle fonts
    std::string subStyle = "bold_center";
    std::string subFontPath;        // resolved .ttf path from UI font selection
    int subFontSize = 42;           // scaled font size for output resolution
    std::string subAnimation = "none"; // none, fade, slide, word_highlight
    std::string subColor = "#ffffff";
    std::string subPosition = "bottom"; // top, center, bottom
    
    // ── Audio ──
    bool audioEvade = false;
    float volumeBoost = 1.0f;
    
    // ── Encoding ──
    bool useGpu = true;
    int crf = 23;
    std::string preset = "p1";
    
    // ── Batch mode ──
    std::vector<std::string> batchInputs;
    int parallel = 2;
    
    // ── Misc ──
    bool removeAudio = false;
    bool cleanMetadata = false;
    
    // ── Avfilter optimization ──
    // Pre-built FFmpeg video filter chain from TypeScript buildFilterChain()
    // When set, replaces CPU-based applyAllEffects with optimized avfilter pipeline
    std::string vFilterChain;
};

EngineConfig parseConfigFromFile(const std::string& jsonPath);
EngineConfig parseConfigFromString(const std::string& jsonStr);
