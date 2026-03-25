// ==============================================================================
// autosync.h — AutoSync Core Module (AuraSplit v3)
// 
// Single Responsibility: Parse, Match, and Compute cut points.
// All functions are pure — no side effects, no global state.
// ==============================================================================

#pragma once

#include <string>
#include <vector>
#include <functional>
#include <cstdint>

namespace autosync {

// ─── Data Types ───────────────────────────────────────────────

/// A single word detected by WhisperX with timing
struct Word {
    std::string text;
    double startTime;
    double endTime;
};

/// A script item parsed from [V1] format
struct ScriptItem {
    int videoId;
    std::string text;
};

/// A computed cut point (result of matching)
struct CutPoint {
    int videoId;
    double startTime;
    double endTime;
    std::string text;
};

/// Configuration for the matching algorithm
struct MatchConfig {
    double similarityThreshold = 0.85;   // Minimum match ratio
    int maxCollectedLength     = 5000;   // Safety cap for long Unicode
    int overflowChars          = 20;     // Extra chars before force-break
};

/// Progress callback: (current, total, message)
using ProgressCallback = std::function<void(int, int, const std::string&)>;


// ─── Text Processing (Pure Functions) ─────────────────────────

/// Normalize text: lowercase + remove punctuation
std::string cleanText(const std::string& input);

/// Count words in a string
int countWords(const std::string& text);

/// Compute similarity ratio between two strings (0.0 - 1.0)
/// Equivalent to Python's difflib.SequenceMatcher.ratio()
double similarityRatio(const std::string& a, const std::string& b);


// ─── Parsing (Pure Functions) ─────────────────────────────────

/// Parse [V1] script format → list of ScriptItems
std::vector<ScriptItem> parseScript(const std::string& content);

/// Parse SRT subtitle format → list of CutPoints
std::vector<CutPoint> parseSRT(const std::string& content);


// ─── Core Matching Algorithm (Pure Function) ──────────────────

/// Match WhisperX words to script items
/// This is the "secret sauce" — compiled into binary
std::vector<CutPoint> matchWordsToScript(
    const std::vector<Word>& words,
    const std::vector<ScriptItem>& scriptItems,
    const MatchConfig& config = MatchConfig{},
    ProgressCallback onProgress = nullptr
);


// ─── Silence Detection ────────────────────────────────────────

/// Detect silence periods in audio using FFmpeg
/// Returns list of (start, end) silence intervals
std::vector<std::pair<double, double>> detectSilence(
    const std::string& audioPath,
    const std::string& ffmpegPath,
    double thresholdDb = -35.0,
    double minDuration = 0.3
);

/// Trim trailing silence from cut points
std::vector<CutPoint> trimTrailingSilence(
    const std::vector<CutPoint>& cuts,
    const std::vector<std::pair<double, double>>& silencePeriods
);

} // namespace autosync
