// ==============================================================================
// autosync.cpp — AutoSync Core Implementation (AuraSplit v3)
//
// Ported from Python: process_task.py + _seq.py
// Atomic Design: each function does ONE thing, pure input→output
// ==============================================================================

#include "autosync.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <map>
#include <unordered_map>
#include <regex>
#include <sstream>
#include <iostream>
#include <fstream>
#include <array>
#include <cstdio>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

namespace autosync {

// ─── Text Processing ──────────────────────────────────────────

std::string cleanText(const std::string& input) {
    std::string result;
    result.reserve(input.size());

    for (unsigned char ch : input) {
        // Only strip ASCII-range punctuation (0x21-0x7E)
        // Preserve ALL UTF-8 multi-byte characters (0x80+)
        // This is critical for Vietnamese (ã,ẽ,ỹ), CJK, Thai, Arabic etc.
        if (ch < 0x80 && std::ispunct(ch)) {
            continue;
        }
        // Lowercase ASCII only (don't touch UTF-8 bytes)
        if (ch < 0x80) {
            result += static_cast<char>(std::tolower(ch));
        } else {
            result += static_cast<char>(ch);
        }
    }
    return result;
}


// SequenceMatcher equivalent — Longest Common Subsequence ratio
// Uses O(N*M) DP, with safety cap to prevent stack overflow on long strings
double similarityRatio(const std::string& a, const std::string& b) {
    if (a.empty() && b.empty()) return 1.0;
    if (a.empty() || b.empty()) return 0.0;

    const size_t lenA = a.size();
    const size_t lenB = b.size();

    // Safety cap: prevent O(N^2) explosion on very long strings
    if (lenA > 5000 || lenB > 5000) {
        // Fallback: simple character overlap ratio
        size_t common = 0;
        std::string shorter = (lenA < lenB) ? a : b;
        std::string longer  = (lenA < lenB) ? b : a;
        for (char ch : shorter) {
            size_t pos = longer.find(ch);
            if (pos != std::string::npos) {
                common++;
                longer[pos] = '\0'; // Mark as used
            }
        }
        return (2.0 * common) / (lenA + lenB);
    }

    // Standard LCS-based similarity (matches Python SequenceMatcher behavior)
    // Using 2 rows instead of full matrix to save memory
    std::vector<size_t> prev(lenB + 1, 0);
    std::vector<size_t> curr(lenB + 1, 0);

    for (size_t i = 1; i <= lenA; ++i) {
        for (size_t j = 1; j <= lenB; ++j) {
            if (a[i - 1] == b[j - 1]) {
                curr[j] = prev[j - 1] + 1;
            } else {
                curr[j] = std::max(prev[j], curr[j - 1]);
            }
        }
        std::swap(prev, curr);
        std::fill(curr.begin(), curr.end(), 0);
    }

    size_t lcsLength = prev[lenB];
    return (2.0 * lcsLength) / (lenA + lenB);
}


// ─── Parsing ──────────────────────────────────────────────────

std::vector<ScriptItem> parseScript(const std::string& content) {
    std::vector<ScriptItem> items;
    
    // Match [V1] or [v1] followed by text until next [V
    std::regex pattern(R"(\[[Vv](\d+)\]\s*([^\[]+))");
    auto begin = std::sregex_iterator(content.begin(), content.end(), pattern);
    auto end   = std::sregex_iterator();

    for (auto it = begin; it != end; ++it) {
        ScriptItem item;
        item.videoId = std::stoi((*it)[1].str());
        item.text    = (*it)[2].str();

        // Trim whitespace
        auto trimStart = item.text.find_first_not_of(" \t\r\n");
        auto trimEnd   = item.text.find_last_not_of(" \t\r\n");
        if (trimStart != std::string::npos) {
            item.text = item.text.substr(trimStart, trimEnd - trimStart + 1);
        }

        if (!item.text.empty()) {
            items.push_back(std::move(item));
        }
    }
    return items;
}


// Helper: convert SRT timestamp "HH:MM:SS,mmm" to seconds
static double srtTimeToSeconds(const std::string& timeStr) {
    int h = 0, m = 0, s = 0, ms = 0;

    // Replace comma with dot for consistent parsing
    std::string normalized = timeStr;
    for (char& ch : normalized) {
        if (ch == ',') ch = '.';
    }

    // Parse HH:MM:SS.mmm
    if (std::sscanf(normalized.c_str(), "%d:%d:%d.%d", &h, &m, &s, &ms) >= 3) {
        return h * 3600.0 + m * 60.0 + s + ms / 1000.0;
    }
    return 0.0;
}


std::vector<CutPoint> parseSRT(const std::string& content) {
    std::vector<CutPoint> results;

    // Split by double newline into blocks
    std::istringstream stream(content);
    std::string line;
    
    enum State { EXPECT_INDEX, EXPECT_TIMESTAMP, COLLECT_TEXT };
    State state = EXPECT_INDEX;
    
    CutPoint current;
    std::string textAccum;
    int lineIndex = 0;

    while (std::getline(stream, line)) {
        // Remove \r if present
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }

        // Trim whitespace
        auto start = line.find_first_not_of(" \t");
        auto end   = line.find_last_not_of(" \t");
        std::string trimmed = (start != std::string::npos) 
            ? line.substr(start, end - start + 1) 
            : "";

        switch (state) {
            case EXPECT_INDEX:
                if (trimmed.empty()) continue;
                // Try to parse as index number
                try {
                    current.videoId = std::stoi(trimmed);
                    state = EXPECT_TIMESTAMP;
                } catch (...) {
                    // Maybe timestamp line without index
                    if (trimmed.find(" --> ") != std::string::npos) {
                        current.videoId = static_cast<int>(results.size()) + 1;
                        goto parse_timestamp;
                    }
                }
                break;

            case EXPECT_TIMESTAMP:
            parse_timestamp: {
                auto arrowPos = trimmed.find(" --> ");
                if (arrowPos == std::string::npos) {
                    state = EXPECT_INDEX;
                    break;
                }
                std::string startStr = trimmed.substr(0, arrowPos);
                std::string endStr   = trimmed.substr(arrowPos + 5);
                current.startTime = srtTimeToSeconds(startStr);
                current.endTime   = srtTimeToSeconds(endStr);
                textAccum.clear();
                state = COLLECT_TEXT;
                break;
            }

            case COLLECT_TEXT:
                if (trimmed.empty()) {
                    // End of block — save
                    current.text = textAccum;
                    if (!current.text.empty()) {
                        results.push_back(current);
                    }
                    state = EXPECT_INDEX;
                } else {
                    if (!textAccum.empty()) textAccum += "\n";
                    textAccum += trimmed;
                }
                break;
        }
    }

    // Don't forget last block
    if (state == COLLECT_TEXT && !textAccum.empty()) {
        current.text = textAccum;
        results.push_back(current);
    }

    return results;
}


// ─── Helper: count words in a string ──────────────────────────
int countWords(const std::string& text) {
    int count = 0;
    bool inWord = false;
    for (unsigned char ch : text) {
        if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
            inWord = false;
        } else if (!inWord) {
            inWord = true;
            count++;
        }
    }
    return count;
}


// ─── Needleman-Wunsch Global Sequence Alignment ───────────────
//
// Industry-standard DP algorithm (bioinformatics):
// 1. Build O(N×M) scoring matrix (match=+2, mismatch=-1, gap=-1)
// 2. Traceback from (N,M) → (0,0) to find optimal alignment
// 3. Return mapping: script_index → whisper_index (only for matches)
//
// For 1940×1936 words ≈ 3.75M cells → C++ handles in ~5ms

static std::unordered_map<size_t, size_t> alignWords(
    const std::vector<std::string>& script,
    const std::vector<std::string>& whisper
) {
    const int n = (int)script.size();
    const int m = (int)whisper.size();

    // Scoring
    const int MATCH = 2;
    const int MISMATCH = -1;
    const int GAP = -1;

    // DP matrix (use short to save memory: 1940*1936*2 = ~7.5MB)
    std::vector<std::vector<short>> dp(n + 1, std::vector<short>(m + 1, 0));

    // Initialize borders
    for (int i = 0; i <= n; ++i) dp[i][0] = (short)(i * GAP);
    for (int j = 0; j <= m; ++j) dp[0][j] = (short)(j * GAP);

    // Fill DP matrix
    for (int i = 1; i <= n; ++i) {
        const auto& sWord = script[i - 1];
        for (int j = 1; j <= m; ++j) {
            int score = (sWord == whisper[j - 1]) ? MATCH : MISMATCH;
            int diag  = dp[i - 1][j - 1] + score;
            int up    = dp[i - 1][j] + GAP;
            int left  = dp[i][j - 1] + GAP;
            dp[i][j] = (short)std::max({diag, up, left});
        }
    }

    // Traceback — extract only matched pairs
    std::unordered_map<size_t, size_t> s2w;
    int i = n, j = m;

    while (i > 0 && j > 0) {
        const auto& sWord = script[i - 1];
        const auto& wWord = whisper[j - 1];
        int score = (sWord == wWord) ? MATCH : MISMATCH;

        if (dp[i][j] == dp[i - 1][j - 1] + score) {
            // Diagonal move: matched or mismatched
            if (sWord == wWord) {
                s2w[i - 1] = j - 1;  // Only store actual matches
            }
            i--; j--;
        } else if (dp[i][j] == dp[i - 1][j] + GAP) {
            i--;  // Gap in whisper (script word has no match)
        } else {
            j--;  // Gap in script (extra whisper word)
        }
    }

    return s2w;
}

std::vector<CutPoint> matchWordsToScript(
    const std::vector<Word>& words,
    const std::vector<ScriptItem>& scriptItems,
    const MatchConfig& config,
    ProgressCallback onProgress
) {
    if (words.empty() || scriptItems.empty()) return {};

    // ═══════════════════════════════════════════════════════════════
    // PROPORTIONAL WORD-INDEX MAPPING
    //
    // For TTS audio, script words and whisper words are in EXACT same
    // order. We simply map cumulative word counts by ratio.
    //
    // Script: 1940 words → [V1]=2w, [V2]=12w, [V3]=8w, ...
    // Whisper: 1936 words with accurate timestamps
    // Ratio: 1936/1940 = 0.998
    //
    // V1: words 0-1 → whisper[0] to whisper[1]
    // V2: words 2-13 → whisper[2] to whisper[12] (scaled)
    //
    // Each [V] independently calculated — no drift accumulation.
    // No text matching needed — just index arithmetic.
    // ═══════════════════════════════════════════════════════════════

    // Step 1: Count words per segment
    struct SegInfo {
        int videoId;
        std::string text;
        int wordCount;
    };
    std::vector<SegInfo> segments;
    int totalScriptWords = 0;

    for (const auto& item : scriptItems) {
        SegInfo si;
        si.videoId = item.videoId;
        si.text = item.text;
        si.wordCount = countWords(item.text);
        totalScriptWords += si.wordCount;
        segments.push_back(std::move(si));
    }

    int totalWhisper = (int)words.size();
    double ratio = (totalScriptWords > 0) ? (double)totalWhisper / totalScriptWords : 1.0;

    fprintf(stderr, "[ENGINE] Proportional mapping: %d script words -> %d whisper words (ratio=%.4f)\n",
            totalScriptWords, totalWhisper, ratio);

    // Step 1.5: CLOSE TIMESTAMP GAPS
    // Whisper wav2vec2 creates 10-22s gaps between its ~28 segments.
    // These gaps make proportional mapping inflate segments.
    // Fix: create adjusted timestamps where gaps > 0.5s are closed.
    // We DON'T modify the original words — use separate timestamp arrays.
    std::vector<double> adjStart(totalWhisper);
    std::vector<double> adjEnd(totalWhisper);

    if (totalWhisper > 0) {
        adjStart[0] = words[0].startTime;
        adjEnd[0] = words[0].endTime;

        double totalGapRemoved = 0.0;
        int gapsFixed = 0;
        const double MAX_NATURAL_GAP = 0.5;  // max natural silence between words

        for (int i = 1; i < totalWhisper; ++i) {
            double gap = words[i].startTime - words[i - 1].endTime;
            double excessGap = 0.0;

            if (gap > MAX_NATURAL_GAP) {
                // Keep MAX_NATURAL_GAP, remove the rest
                excessGap = gap - MAX_NATURAL_GAP;
                totalGapRemoved += excessGap;
                gapsFixed++;
            }

            double wordDuration = words[i].endTime - words[i].startTime;
            adjStart[i] = words[i].startTime - totalGapRemoved;
            adjEnd[i] = adjStart[i] + wordDuration;
        }

        fprintf(stderr, "[ENGINE] Gap closing: %d gaps fixed, %.1fs removed (%.1fs -> %.1fs effective)\n",
                gapsFixed, totalGapRemoved,
                words.back().endTime, adjEnd[totalWhisper - 1]);
    }
    // Step 2: Map each [V] to whisper word range using cumulative proportion
    std::vector<CutPoint> results;
    results.reserve(segments.size());
    int cumWords = 0;

    for (size_t k = 0; k < segments.size(); ++k) {
        const auto& seg = segments[k];

        // Calculate whisper index range for this segment
        int whisperStart = (int)std::round(cumWords * ratio);
        cumWords += seg.wordCount;
        int whisperEnd = (int)std::round(cumWords * ratio) - 1;

        // Clamp to valid range
        whisperStart = std::max(0, std::min(whisperStart, totalWhisper - 1));
        whisperEnd = std::max(whisperStart, std::min(whisperEnd, totalWhisper - 1));

        CutPoint cut;
        cut.videoId = seg.videoId;
        cut.text = seg.text;

        // Use GAP-CLOSED timestamps for cut points
        // This prevents segments from spanning 20s gaps between Whisper segments
        if (k == 0) {
            cut.startTime = std::max(0.0, words[whisperStart].startTime - 0.05);
        } else {
            cut.startTime = results.back().endTime;
        }

        // End: use ORIGINAL word endTime (actual audio position)
        // But CHECK if this segment spans a large gap — if so, cut at the gap
        double rawEnd = words[whisperEnd].endTime;
        
        // Find the largest gap WITHIN this segment's word range
        double largestGap = 0;
        int gapWordIdx = -1;
        for (int w = whisperStart; w < whisperEnd; ++w) {
            double g = words[w + 1].startTime - words[w].endTime;
            if (g > largestGap) {
                largestGap = g;
                gapWordIdx = w;
            }
        }

        // If there's a huge gap (>2s) inside this segment, CUT AT THE GAP
        // The words BEFORE the gap belong to THIS segment
        // The words AFTER the gap belong to the NEXT segment
        if (largestGap > 2.0 && gapWordIdx >= whisperStart) {
            // End this segment at the word before the gap + small padding
            double gapStart = words[gapWordIdx].endTime;
            double gapEnd = words[gapWordIdx + 1].startTime;
            cut.endTime = gapStart + 0.3;  // slight padding into silence
        } else {
            cut.endTime = rawEnd;
            // Normal silence gap splitting
            if (whisperEnd + 1 < totalWhisper) {
                double nextStart = words[whisperEnd + 1].startTime;
                double gap = nextStart - cut.endTime;
                if (gap > 0.05 && gap < 2.0) {
                    cut.endTime += gap / 2.0;
                }
            }
        }

        results.push_back(cut);

        if (onProgress) {
            onProgress((int)(k + 1), (int)segments.size(),
                       "Mapped V" + std::to_string(seg.videoId));
        }
    }

    // Last segment: extend to end of audio
    if (!results.empty() && !words.empty()) {
        double audioEnd = words.back().endTime + 0.5;
        if (results.back().endTime < audioEnd) {
            results.back().endTime = audioEnd;
        }
    }

    fprintf(stderr, "[ENGINE] Proportional mapping: %zu segments, ratio=%.4f\n",
            results.size(), ratio);

    return results;
}


// ─── Silence Detection ────────────────────────────────────────

// Helper: run command and capture stderr
static std::string runCommandGetStderr(const std::string& cmd) {
    std::string result;

#ifdef _WIN32
    // Hide window on Windows
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
    si.hStdError = hWritePipe;
    si.hStdOutput = hWritePipe;

    PROCESS_INFORMATION pi = {};
    std::string cmdMutable = cmd;

    if (CreateProcessA(
        nullptr, &cmdMutable[0], nullptr, nullptr, TRUE,
        CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi
    )) {
        CloseHandle(hWritePipe);

        char buffer[4096];
        DWORD bytesRead;
        while (ReadFile(hReadPipe, buffer, sizeof(buffer) - 1, &bytesRead, nullptr) && bytesRead > 0) {
            buffer[bytesRead] = '\0';
            result += buffer;
        }

        WaitForSingleObject(pi.hProcess, 30000); // 30s timeout
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
    CloseHandle(hReadPipe);
#else
    // Unix
    FILE* pipe = popen((cmd + " 2>&1").c_str(), "r");
    if (pipe) {
        char buffer[4096];
        while (fgets(buffer, sizeof(buffer), pipe)) {
            result += buffer;
        }
        pclose(pipe);
    }
#endif

    return result;
}


std::vector<std::pair<double, double>> detectSilence(
    const std::string& audioPath,
    const std::string& ffmpegPath,
    double thresholdDb,
    double minDuration
) {
    std::vector<std::pair<double, double>> periods;

    // Build FFmpeg silencedetect command
    std::string cmd = "\"" + ffmpegPath + "\" -i \"" + audioPath + "\""
        + " -af \"silencedetect=noise=" + std::to_string(static_cast<int>(thresholdDb)) + "dB"
        + ":d=" + std::to_string(minDuration) + "\""
        + " -f null -";

    std::string output = runCommandGetStderr(cmd);

    // Parse silence_start / silence_end from output
    double silenceStart = -1.0;
    std::istringstream lines(output);
    std::string line;

    while (std::getline(lines, line)) {
        auto startPos = line.find("silence_start:");
        if (startPos != std::string::npos) {
            try {
                std::string val = line.substr(startPos + 15);
                val = val.substr(0, val.find_first_of(" \t\r\n"));
                silenceStart = std::stod(val);
            } catch (...) {
                silenceStart = -1.0;
            }
        }

        auto endPos = line.find("silence_end:");
        if (endPos != std::string::npos && silenceStart >= 0) {
            try {
                std::string val = line.substr(endPos + 13);
                val = val.substr(0, val.find_first_of(" \t\r\n"));
                double silenceEnd = std::stod(val);
                periods.emplace_back(silenceStart, silenceEnd);
            } catch (...) {}
            silenceStart = -1.0;
        }
    }

    return periods;
}


std::vector<CutPoint> trimTrailingSilence(
    const std::vector<CutPoint>& cuts,
    const std::vector<std::pair<double, double>>& silencePeriods
) {
    std::vector<CutPoint> trimmed;
    trimmed.reserve(cuts.size());

    for (const auto& cut : cuts) {
        CutPoint adjusted = cut;

        for (const auto& [silStart, silEnd] : silencePeriods) {
            // If silence starts during this segment and extends to/past its end
            if (silStart >= cut.startTime && silStart < cut.endTime &&
                silEnd >= cut.endTime - 0.1) {
                adjusted.endTime = silStart + 0.05; // Small offset
                break;
            }
        }

        trimmed.push_back(std::move(adjusted));
    }

    return trimmed;
}

} // namespace autosync
