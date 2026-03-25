/**
 * Advanced Effects — BG Blur, Logo Overlay, Text, Subtitle
 * 
 * BG Blur: 3-pass box blur on YUV planes (fast gaussian approximation)
 * Logo: stb_image for PNG/JPG loading, alpha-composite on frame
 * Text: libavfilter drawtext for title/description with word-wrap
 * Subtitle: Simple SRT parser + drawtext at current timestamp
 */

#define _USE_MATH_DEFINES
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_ONLY_JPEG
#include "stb_image.h"

#include "advanced_effects.h"
#include "cuda_effects.h"
#include <cstring>
#include <cmath>
#include <algorithm>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>

extern "C" {
#include <libavutil/frame.h>
#include <libavutil/imgutils.h>
#include <libavutil/opt.h>
#include <libavformat/avformat.h>
#include <libavcodec/avcodec.h>
#include <libavfilter/avfilter.h>
#include <libavfilter/buffersrc.h>
#include <libavfilter/buffersink.h>
#include <libswscale/swscale.h>
}

static inline uint8_t clamp8adv(int v) {
    return (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
}

// ═══════════════════════════════════════════════════
// BG BLUR — Manual box blur on 0.25x frame (NO avfilter overhead)
// CSS: filter: blur(40px) brightness(0.65) saturate(1.2); transform: scale(1.3)
// ═══════════════════════════════════════════════════

static SwsContext* s_bgSwsDown = nullptr;
static SwsContext* s_bgSwsUp = nullptr;
static AVFrame* s_bgSmall = nullptr;
static AVFrame* s_bgTemp = nullptr;     // temp for blur passes
static int s_bgSmallW = 0, s_bgSmallH = 0;
static int s_bgOutW = 0, s_bgOutH = 0;
static int s_bgSrcW = 0, s_bgSrcH = 0;

// Fast horizontal box blur on Y/U/V planes
static void boxBlurH(uint8_t* dst, const uint8_t* src, int w, int h, int stride, int radius) {
    int diam = radius * 2 + 1;
    for (int y = 0; y < h; y++) {
        const uint8_t* row = src + y * stride;
        uint8_t* out = dst + y * stride;
        int sum = row[0] * (radius + 1);
        for (int x = 0; x < radius && x < w; x++) sum += row[x];
        for (int x = 0; x < w; x++) {
            int right = (x + radius < w) ? row[x + radius] : row[w - 1];
            int left = (x - radius - 1 >= 0) ? row[x - radius - 1] : row[0];
            sum += right - left;
            out[x] = (uint8_t)(sum / diam);
        }
    }
}

// Fast vertical box blur
static void boxBlurV(uint8_t* dst, const uint8_t* src, int w, int h, int stride, int radius) {
    int diam = radius * 2 + 1;
    for (int x = 0; x < w; x++) {
        int sum = src[x] * (radius + 1);
        for (int y = 0; y < radius && y < h; y++) sum += src[y * stride + x];
        for (int y = 0; y < h; y++) {
            int bottom = (y + radius < h) ? src[(y + radius) * stride + x] : src[(h - 1) * stride + x];
            int top = (y - radius - 1 >= 0) ? src[(y - radius - 1) * stride + x] : src[x];
            sum += bottom - top;
            dst[y * stride + x] = (uint8_t)(sum / diam);
        }
    }
}

void effectBgBlur(AVFrame* outFrame, AVFrame* srcFrame, int outW, int outH, int blurAmount) {
    // 0.25x downscale — 16x fewer pixels than full res, invisible quality loss for blur
    int smallW = ((int)(outW * 0.25) / 2) * 2;
    int smallH = ((int)(outH * 0.25) / 2) * 2;
    if (smallW < 4) smallW = 4;
    if (smallH < 4) smallH = 4;
    
    // Cover-scale: account for aspect ratio
    double srcAsp = (double)srcFrame->width / srcFrame->height;
    double tgtAsp = (double)smallW / smallH;
    int coverW, coverH;
    if (srcAsp > tgtAsp) {
        coverH = smallH;
        coverW = ((int)(smallH * srcAsp) / 2) * 2;
    } else {
        coverW = smallW;
        coverH = ((int)(smallW / srcAsp) / 2) * 2;
    }
    if (coverW < 4) coverW = 4;
    if (coverH < 4) coverH = 4;
    
    // Cache SwsContexts (dims constant across frames)
    bool dimsChanged = s_bgSrcW != srcFrame->width || s_bgSrcH != srcFrame->height ||
                       s_bgSmallW != coverW || s_bgSmallH != coverH ||
                       s_bgOutW != outW || s_bgOutH != outH;
    if (dimsChanged) {
        if (s_bgSwsDown) sws_freeContext(s_bgSwsDown);
        if (s_bgSwsUp) sws_freeContext(s_bgSwsUp);
        if (s_bgSmall) av_frame_free(&s_bgSmall);
        if (s_bgTemp) av_frame_free(&s_bgTemp);
        
        s_bgSwsDown = sws_getContext(
            srcFrame->width, srcFrame->height, (AVPixelFormat)srcFrame->format,
            coverW, coverH, AV_PIX_FMT_YUV420P,
            SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        s_bgSwsUp = sws_getContext(
            smallW, smallH, AV_PIX_FMT_YUV420P,
            outW, outH, AV_PIX_FMT_YUV420P,
            SWS_FAST_BILINEAR, nullptr, nullptr, nullptr);
        
        s_bgSmall = av_frame_alloc();
        s_bgSmall->format = AV_PIX_FMT_YUV420P;
        s_bgSmall->width = coverW; s_bgSmall->height = coverH;
        av_frame_get_buffer(s_bgSmall, 0);
        
        s_bgTemp = av_frame_alloc();
        s_bgTemp->format = AV_PIX_FMT_YUV420P;
        s_bgTemp->width = coverW; s_bgTemp->height = coverH;
        av_frame_get_buffer(s_bgTemp, 0);
        
        s_bgSrcW = srcFrame->width; s_bgSrcH = srcFrame->height;
        s_bgSmallW = coverW; s_bgSmallH = coverH;
        s_bgOutW = outW; s_bgOutH = outH;
    }
    if (!s_bgSwsDown || !s_bgSwsUp) return;
    
    // Step 1: Downscale source → tiny cover frame
    sws_scale(s_bgSwsDown, srcFrame->data, srcFrame->linesize, 0, srcFrame->height,
              s_bgSmall->data, s_bgSmall->linesize);
    
    // Step 2: 3-pass box blur (approximates gaussian) — FAST on tiny frame!
    int radius = blurAmount / 8;  // scaled for tiny frame
    if (radius < 1) radius = 1;
    if (radius > coverW / 4) radius = coverW / 4;
    
    // 3 passes: H→V, H→V, H→V (3-pass box blur ≈ gaussian)
    for (int pass = 0; pass < 3; pass++) {
        // Y plane
        boxBlurH(s_bgTemp->data[0], s_bgSmall->data[0], coverW, coverH, s_bgSmall->linesize[0], radius);
        boxBlurV(s_bgSmall->data[0], s_bgTemp->data[0], coverW, coverH, s_bgSmall->linesize[0], radius);
        // U plane
        int cr = radius / 2; if (cr < 1) cr = 1;
        boxBlurH(s_bgTemp->data[1], s_bgSmall->data[1], coverW/2, coverH/2, s_bgSmall->linesize[1], cr);
        boxBlurV(s_bgSmall->data[1], s_bgTemp->data[1], coverW/2, coverH/2, s_bgSmall->linesize[1], cr);
        // V plane
        boxBlurH(s_bgTemp->data[2], s_bgSmall->data[2], coverW/2, coverH/2, s_bgSmall->linesize[2], cr);
        boxBlurV(s_bgSmall->data[2], s_bgTemp->data[2], coverW/2, coverH/2, s_bgSmall->linesize[2], cr);
    }
    
    // Step 3: Apply brightness(0.65) and saturation(1.2) on TINY frame (4x fewer pixels!)
    // CSS brightness(x) = multiply by x; matches preview CSS filter exactly
    for (int r = 0; r < coverH; r++) {
        uint8_t* p = s_bgSmall->data[0] + r * s_bgSmall->linesize[0];
        for (int c = 0; c < coverW; c++)
            p[c] = clamp8adv((int)(p[c] * 0.65f));
    }
    for (int r = 0; r < coverH/2; r++) {
        uint8_t* pu = s_bgSmall->data[1] + r * s_bgSmall->linesize[1];
        uint8_t* pv = s_bgSmall->data[2] + r * s_bgSmall->linesize[2];
        for (int c = 0; c < coverW/2; c++) {
            pu[c] = clamp8adv((int)((pu[c] - 128) * 1.2f + 128));
            pv[c] = clamp8adv((int)((pv[c] - 128) * 1.2f + 128));
        }
    }
    
    // Step 4: Crop center then upscale to output
    int cropX = ((coverW - smallW) / 2) & ~1;
    int cropY = ((coverH - smallH) / 2) & ~1;
    AVFrame cropView;
    memset(&cropView, 0, sizeof(cropView));
    cropView.data[0] = s_bgSmall->data[0] + cropY * s_bgSmall->linesize[0] + cropX;
    cropView.data[1] = s_bgSmall->data[1] + (cropY/2) * s_bgSmall->linesize[1] + cropX/2;
    cropView.data[2] = s_bgSmall->data[2] + (cropY/2) * s_bgSmall->linesize[2] + cropX/2;
    cropView.linesize[0] = s_bgSmall->linesize[0];
    cropView.linesize[1] = s_bgSmall->linesize[1];
    cropView.linesize[2] = s_bgSmall->linesize[2];
    
    sws_scale(s_bgSwsUp, cropView.data, cropView.linesize, 0, smallH,
              outFrame->data, outFrame->linesize);
}

// ═══════════════════════════════════════════════════
// LOGO OVERLAY — Load image with stb_image, composite on frame
// ═══════════════════════════════════════════════════

// Cache loaded logo to avoid re-loading every frame
static uint8_t* g_logoRGBA = nullptr;
static int g_logoW = 0, g_logoH = 0;
static std::string g_logoPath;

void effectLogoOverlay(AVFrame* frame, const std::string& logoPath, int logoSizePct,
                       const std::string& position, int frameW, int frameH, int64_t frameNum) {
    if (logoPath.empty()) return;
    
    // Load logo (cached)
    if (logoPath != g_logoPath || !g_logoRGBA) {
        if (g_logoRGBA) { stbi_image_free(g_logoRGBA); g_logoRGBA = nullptr; }
        int channels;
        g_logoRGBA = stbi_load(logoPath.c_str(), &g_logoW, &g_logoH, &channels, 4);
        g_logoPath = logoPath;
        if (!g_logoRGBA) {
            fprintf(stderr, "[ENGINE] Failed to load logo: %s\n", logoPath.c_str());
            return;
        }
        fprintf(stderr, "[ENGINE] Loaded logo: %dx%d (%s)\n", g_logoW, g_logoH, logoPath.c_str());
    }
    if (!g_logoRGBA) return;
    
    // Scale logo to target size (% of frame width)
    int targetW = (int)(frameW * logoSizePct / 100.0f);
    float logoAspect = (float)g_logoW / g_logoH;
    int targetH = (int)(targetW / logoAspect);
    if (targetW < 1 || targetH < 1) return;
    
    // Resolve position — 'auto' cycles through 4 corners every 3s (90 frames at 30fps)
    std::string resolvedPos = position;
    if (position == "auto") {
        const char* corners[] = { "top-left", "top-right", "bottom-right", "bottom-left" };
        int cornerIdx = (int)((frameNum / 90) % 4); // 90 frames = 3 seconds at 30fps
        resolvedPos = corners[cornerIdx];
    }
    
    // Calculate position
    int margin = 20;
    int posX, posY;
    if (resolvedPos == "top-left") { posX = margin; posY = margin; }
    else if (resolvedPos == "top-right") { posX = frameW - targetW - margin; posY = margin; }
    else if (resolvedPos == "bottom-left") { posX = margin; posY = frameH - targetH - margin; }
    else { posX = frameW - targetW - margin; posY = frameH - targetH - margin; } // default: bottom-right
    
    // Simple nearest-neighbor scale + alpha composite on Y plane
    for (int row = 0; row < targetH && (posY + row) < frameH; row++) {
        int srcRow = row * g_logoH / targetH;
        uint8_t* dstY = frame->data[0] + (posY + row) * frame->linesize[0];
        for (int col = 0; col < targetW && (posX + col) < frameW; col++) {
            int srcCol = col * g_logoW / targetW;
            uint8_t* px = g_logoRGBA + (srcRow * g_logoW + srcCol) * 4;
            uint8_t r = px[0], g = px[1], b = px[2], a = px[3];
            if (a == 0) continue;
            // RGB → Y
            uint8_t yVal = clamp8adv((int)(0.299f * r + 0.587f * g + 0.114f * b));
            float alpha = a / 255.0f;
            dstY[posX + col] = clamp8adv((int)(dstY[posX + col] * (1 - alpha) + yVal * alpha));
        }
    }
    // UV planes
    int cFrameW = frameW / 2, cPosX = posX / 2, cPosY = posY / 2;
    int cTargetW = targetW / 2, cTargetH = targetH / 2;
    for (int row = 0; row < cTargetH && (cPosY + row) < frameH / 2; row++) {
        int srcRow = row * 2 * g_logoH / targetH;
        uint8_t* dstU = frame->data[1] + (cPosY + row) * frame->linesize[1];
        uint8_t* dstV = frame->data[2] + (cPosY + row) * frame->linesize[2];
        for (int col = 0; col < cTargetW && (cPosX + col) < cFrameW; col++) {
            int srcCol = col * 2 * g_logoW / targetW;
            uint8_t* px = g_logoRGBA + (srcRow * g_logoW + srcCol) * 4;
            uint8_t r = px[0], g_c = px[1], b = px[2], a = px[3];
            if (a == 0) continue;
            uint8_t uVal = clamp8adv((int)(-0.169f * r - 0.331f * g_c + 0.500f * b + 128));
            uint8_t vVal = clamp8adv((int)(0.500f * r - 0.419f * g_c - 0.081f * b + 128));
            float alpha = a / 255.0f;
            dstU[cPosX + col] = clamp8adv((int)(dstU[cPosX + col] * (1 - alpha) + uVal * alpha));
            dstV[cPosX + col] = clamp8adv((int)(dstV[cPosX + col] * (1 - alpha) + vVal * alpha));
        }
    }
}

// ═══════════════════════════════════════════════════
// TITLE/DESC TEXT — Using libavfilter drawtext
// ═══════════════════════════════════════════════════

void effectDrawText(AVFrame* frame, const EngineConfig& config, int64_t frameNum) {
    if (config.titleText.empty() && config.descText.empty()) return;
    
    int w = frame->width, h = frame->height;
    
    // Cache the filter graph — title/desc text is constant across all frames
    static AVFilterGraph* s_dtGraph = nullptr;
    static AVFilterContext* s_dtSrcCtx = nullptr;
    static AVFilterContext* s_dtSinkCtx = nullptr;
    static int s_dtW = 0, s_dtH = 0;
    
    if (!s_dtGraph || s_dtW != w || s_dtH != h) {
        if (s_dtGraph) avfilter_graph_free(&s_dtGraph);
        s_dtGraph = avfilter_graph_alloc();
        if (!s_dtGraph) return;
    
    const AVFilter* bufSrc = avfilter_get_by_name("buffer");
    const AVFilter* bufSink = avfilter_get_by_name("buffersink");
    if (!bufSrc || !bufSink) { avfilter_graph_free(&s_dtGraph); s_dtGraph = nullptr; return; }
    
    char srcArgs[256];
    snprintf(srcArgs, sizeof(srcArgs), "video_size=%dx%d:pix_fmt=%d:time_base=1/30",
             w, h, AV_PIX_FMT_YUV420P);
    
    if (avfilter_graph_create_filter(&s_dtSrcCtx, bufSrc, "in", srcArgs, nullptr, s_dtGraph) < 0 ||
        avfilter_graph_create_filter(&s_dtSinkCtx, bufSink, "out", nullptr, nullptr, s_dtGraph) < 0) {
        avfilter_graph_free(&s_dtGraph); s_dtGraph = nullptr;
        return;
    }
    
    AVFilterContext* lastCtx = s_dtSrcCtx;
    
    // ── Font resolution (matching reup-filters.ts fontMap) ──
    std::string fontPath;
    const char* appRoot = getenv("APP_ROOT");
    std::string appRootStr = appRoot ? std::string(appRoot) : ".";
    
    auto bundledFont = [&](const std::string& filename) -> std::string {
        std::string p = appRootStr + "/fonts/" + filename;
        for (auto& c : p) if (c == '\\') c = '/';
        return p;
    };
    
    // Map textFont config to font file (same as TS fontMap)
    std::string userFont = config.textFont.empty() ? "Inter" : config.textFont;
    if (userFont == "Inter") fontPath = bundledFont("Inter-Bold.ttf");
    else if (userFont == "Dancing Script") fontPath = bundledFont("DancingScript-Bold.ttf");
    else if (userFont == "Pacifico") fontPath = bundledFont("Pacifico-Regular.ttf");
    else if (userFont == "Lobster") fontPath = bundledFont("Lobster-Regular.ttf");
    else if (userFont == "Sigmar One") fontPath = bundledFont("SigmarOne-Regular.ttf");
    else if (userFont == "Bungee Shade") fontPath = bundledFont("BungeeShade-Regular.ttf");
    else if (userFont == "Patrick Hand") fontPath = bundledFont("PatrickHand-Regular.ttf");
    else if (userFont == "Dela Gothic One") fontPath = bundledFont("DelaGothicOne-Regular.ttf");
    else if (userFont == "Fugaz One") fontPath = bundledFont("FugazOne-Regular.ttf");
    else if (userFont == "Bangers") fontPath = bundledFont("Bangers-Regular.ttf");
    else if (userFont == "Impact" || userFont == "Luckiest Guy") fontPath = "C:/Windows/Fonts/impact.ttf";
    else if (userFont == "Arial") fontPath = "C:/Windows/Fonts/arialbd.ttf";
    else fontPath = bundledFont("Inter-Bold.ttf");
    
    // Check if file exists, fallback to arialbd
    if (!std::ifstream(fontPath).good()) {
        fontPath = "C:/Windows/Fonts/arialbd.ttf";
    }
    
    // Font path for drawtext — use forward slashes only, NO colon escaping
    // (fontfile path is inside single quotes in drawtext args, so no escaping needed)
    std::string ffmpegFont = fontPath;
    for (auto& c : ffmpegFont) if (c == '\\') c = '/';
    
    auto escapeText = [](const std::string& t) -> std::string {
        std::string out;
        for (char c : t) {
            if (c == '\'') out += "\\'";
            else if (c == ':') out += "\\:";
            else if (c == '\\') out += "/";
            else if (c == ',') out += "\\,";
            else if (c == '%') out += "%%";
            else out += c;
        }
        return out;
    };
    
    // ── Font scaling: match reup-filters.ts previewScale ──
    // Preview container: max 480x420, scale = frameW / (frameW * pvScale)
    float pvScale = std::min(480.0f / w, 420.0f / h);
    float pvWidth = w * pvScale;
    float previewScale = (float)w / pvWidth; // = 1.0 / pvScale
    int titleSize = (int)roundf((config.titleFontSize > 0 ? config.titleFontSize : 24) * previewScale);
    int descSize = (int)roundf((config.descFontSize > 0 ? config.descFontSize : 14) * previewScale);
    
    // ── Word wrap (matching TS wrapText) ──
    auto wrapText = [](const std::string& text, int maxChars) -> std::vector<std::string> {
        std::vector<std::string> lines;
        std::string current;
        std::string word;
        for (size_t i = 0; i <= text.size(); i++) {
            char c = i < text.size() ? text[i] : ' ';
            if (c == ' ' || c == '\t' || i == text.size()) {
                if (!word.empty()) {
                    std::string test = current.empty() ? word : current + " " + word;
                    if ((int)test.size() > maxChars && !current.empty()) {
                        lines.push_back(current);
                        current = word;
                    } else {
                        current = test;
                    }
                    word.clear();
                }
            } else {
                word += c;
            }
        }
        if (!current.empty()) lines.push_back(current);
        return lines;
    };
    
    float titleCharW = titleSize * 0.55f;
    int titleMaxChars = std::max(10, (int)floorf((w * 0.80f) / titleCharW));
    float descCharW = descSize * 0.55f;
    int descMaxChars = std::max(10, (int)floorf((w * 0.70f) / descCharW));
    
    int titleOX = (int)roundf(config.titleOffsetX * previewScale);
    int titleOY = (int)roundf(config.titleOffsetY * previewScale);
    int descOX = (int)roundf(config.descOffsetX * previewScale);
    int descOY = (int)roundf(config.descOffsetY * previewScale);
    
    const AVFilter* dt = avfilter_get_by_name("drawtext");
    if (!dt) { avfilter_graph_free(&s_dtGraph); s_dtGraph = nullptr; return; }
    int filterIdx = 0;
    
    // ── Title (vertically centered + offset) ──
    if (!config.titleText.empty()) {
        auto lines = wrapText(config.titleText, titleMaxChars);
        int lineH = (int)roundf(titleSize * 1.3f);
        int totalH = (int)lines.size() * lineH;
        int centerY = h / 2 + titleOY;
        int startY = std::max(10, centerY - totalH / 2);
        
        for (size_t i = 0; i < lines.size(); i++) {
            int yPos = startY + (int)i * lineH;
            char dtArgs[2048];
            snprintf(dtArgs, sizeof(dtArgs),
                "fontfile='%s':text='%s':x=(w-text_w)/2+%d:y=%d:fontsize=%d:fontcolor=%s:borderw=5:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.6",
                ffmpegFont.c_str(), escapeText(lines[i]).c_str(),
                titleOX, yPos, titleSize, config.textColor.c_str());
            
            char name[32];
            snprintf(name, sizeof(name), "title_%d", filterIdx++);
            AVFilterContext* dtCtx = nullptr;
            if (avfilter_graph_create_filter(&dtCtx, dt, name, dtArgs, nullptr, s_dtGraph) == 0) {
                avfilter_link(lastCtx, 0, dtCtx, 0);
                lastCtx = dtCtx;
            }
        }
    }
    
    // ── Description (bottom + offset) ──
    if (!config.descText.empty()) {
        auto lines = wrapText(config.descText, descMaxChars);
        int lineH = (int)roundf(descSize * 1.3f);
        int totalH = (int)lines.size() * lineH;
        int bottomPad = (int)roundf(40.0f * previewScale);
        int lastLineBottom = std::min(h - 20, h - bottomPad + descOY);
        int startY = lastLineBottom - totalH;
        
        for (size_t i = 0; i < lines.size(); i++) {
            int yPos = std::max(10, startY + (int)i * lineH);
            char dtArgs[2048];
            snprintf(dtArgs, sizeof(dtArgs),
                "fontfile='%s':text='%s':x=(w-text_w)/2+%d:y=%d:fontsize=%d:fontcolor=%s:borderw=4:bordercolor=black:shadowx=1:shadowy=1:shadowcolor=black@0.5",
                ffmpegFont.c_str(), escapeText(lines[i]).c_str(),
                descOX, yPos, descSize, config.textColor.c_str());
            
            char name[32];
            snprintf(name, sizeof(name), "desc_%d", filterIdx++);
            AVFilterContext* dtCtx = nullptr;
            if (avfilter_graph_create_filter(&dtCtx, dt, name, dtArgs, nullptr, s_dtGraph) == 0) {
                avfilter_link(lastCtx, 0, dtCtx, 0);
                lastCtx = dtCtx;
            }
        }
    }
    
    if (avfilter_link(lastCtx, 0, s_dtSinkCtx, 0) < 0 || avfilter_graph_config(s_dtGraph, nullptr) < 0) {
        fprintf(stderr, "[ENGINE] drawtext graph config FAILED\n");
        avfilter_graph_free(&s_dtGraph); s_dtGraph = nullptr;
        return;
    }
    
        s_dtW = w; s_dtH = h;
        fprintf(stderr, "[ENGINE] drawtext graph OK (font=%s, title='%s', desc='%s', titleSize=%d, descSize=%d)\n",
                fontPath.c_str(), config.titleText.c_str(), config.descText.c_str(), titleSize, descSize);
    } // end graph init
    
    // Create fresh frame for each push (no reference issues)
    AVFrame* pushFrame = av_frame_alloc();
    if (!pushFrame) return;
    pushFrame->format = AV_PIX_FMT_YUV420P;
    pushFrame->width = w;
    pushFrame->height = h;
    if (av_frame_get_buffer(pushFrame, 0) < 0) {
        av_frame_free(&pushFrame);
        return;
    }
    av_frame_copy(pushFrame, frame);
    pushFrame->pts = frameNum;
    
    int pushRet = av_buffersrc_add_frame(s_dtSrcCtx, pushFrame);
    av_frame_free(&pushFrame); // buffersrc refs the data internally
    
    if (pushRet >= 0) {
        AVFrame* outFrame = av_frame_alloc();
        int pullRet = av_buffersink_get_frame(s_dtSinkCtx, outFrame);
        if (pullRet >= 0) {
            for (int row = 0; row < h; row++)
                memcpy(frame->data[0] + row * frame->linesize[0],
                       outFrame->data[0] + row * outFrame->linesize[0], w);
            for (int row = 0; row < h / 2; row++) {
                memcpy(frame->data[1] + row * frame->linesize[1],
                       outFrame->data[1] + row * outFrame->linesize[1], w / 2);
                memcpy(frame->data[2] + row * frame->linesize[2],
                       outFrame->data[2] + row * outFrame->linesize[2], w / 2);
            }
        } else if (frameNum <= 1) {
            fprintf(stderr, "[ENGINE] drawtext pull FAILED: %d\n", pullRet);
        }
        av_frame_free(&outFrame);
    } else if (frameNum <= 1) {
        fprintf(stderr, "[ENGINE] drawtext push FAILED: %d\n", pushRet);
    }
}

// ═══════════════════════════════════════════════════
// SUBTITLE — Parse SRT and render with drawtext
// ═══════════════════════════════════════════════════

struct SrtEntry {
    double startSec, endSec;
    std::string text;
};

static std::vector<SrtEntry> g_srtEntries;
static std::string g_srtLoadedPath;

static double parseSrtTime(const std::string& ts) {
    int h = 0, m = 0, s = 0, ms = 0;
    sscanf(ts.c_str(), "%d:%d:%d,%d", &h, &m, &s, &ms);
    return h * 3600.0 + m * 60.0 + s + ms / 1000.0;
}

static void loadSrt(const std::string& path) {
    if (path == g_srtLoadedPath && !g_srtEntries.empty()) return;
    g_srtEntries.clear();
    g_srtLoadedPath = path;
    
    std::ifstream file(path);
    if (!file.is_open()) return;
    
    std::string line;
    SrtEntry entry;
    int state = 0; // 0=index, 1=time, 2=text
    
    while (std::getline(file, line)) {
        // Remove \r
        if (!line.empty() && line.back() == '\r') line.pop_back();
        
        if (line.empty()) {
            if (state == 2 && !entry.text.empty()) {
                g_srtEntries.push_back(entry);
                entry = {};
            }
            state = 0;
            continue;
        }
        
        if (state == 0) {
            // Index line (number) — skip
            state = 1;
        } else if (state == 1) {
            // Timestamp line: 00:00:01,000 --> 00:00:04,000
            size_t arrowPos = line.find("-->");
            if (arrowPos != std::string::npos) {
                entry.startSec = parseSrtTime(line.substr(0, arrowPos));
                entry.endSec = parseSrtTime(line.substr(arrowPos + 4));
            }
            state = 2;
        } else if (state == 2) {
            // Text line(s)
            if (!entry.text.empty()) entry.text += " ";
            entry.text += line;
        }
    }
    if (state == 2 && !entry.text.empty())
        g_srtEntries.push_back(entry);
    
    fprintf(stderr, "[ENGINE] Loaded SRT: %zu entries from %s\n", g_srtEntries.size(), path.c_str());
}

// ── Word-level timing (from WhisperX JSON sidecar) ──
struct WordTiming {
    std::string word;
    double start;
    double end;
};
struct SegmentWords {
    double start;
    double end;
    std::string text;
    std::vector<WordTiming> words;
};

static std::vector<SegmentWords> s_wordTimings;
static std::string s_wordTimingsPath;

// Simple JSON parser for word timing sidecar
static void loadWordTimings(const std::string& path) {
    if (path.empty() || path == s_wordTimingsPath) return;
    s_wordTimingsPath = path;
    s_wordTimings.clear();
    
    std::ifstream f(path);
    if (!f.good()) {
        fprintf(stderr, "[SUB] Word timing file not found: %s\n", path.c_str());
        return;
    }
    
    std::string json((std::istreambuf_iterator<char>(f)),
                      std::istreambuf_iterator<char>());
    f.close();
    
    // Minimal JSON array-of-objects parser
    // Format: [{"start":0.1,"end":1.2,"text":"hello","words":[{"word":"hello","start":0.1,"end":0.5},...]}]
    size_t pos = 0;
    auto skipWS = [&]() { while (pos < json.size() && (json[pos]==' '||json[pos]=='\n'||json[pos]=='\r'||json[pos]=='\t')) pos++; };
    auto expectChar = [&](char c) -> bool { skipWS(); if (pos < json.size() && json[pos]==c) { pos++; return true; } return false; };
    auto readString = [&]() -> std::string {
        skipWS();
        if (pos >= json.size() || json[pos] != '"') return "";
        pos++;
        std::string s;
        while (pos < json.size() && json[pos] != '"') {
            if (json[pos] == '\\' && pos+1 < json.size()) { pos++; s += json[pos]; }
            else s += json[pos];
            pos++;
        }
        if (pos < json.size()) pos++; // skip closing quote
        return s;
    };
    auto readNumber = [&]() -> double {
        skipWS();
        size_t start = pos;
        while (pos < json.size() && (json[pos]=='-'||json[pos]=='.'||(json[pos]>='0'&&json[pos]<='9'))) pos++;
        return atof(json.substr(start, pos-start).c_str());
    };
    auto skipValue = [&]() {
        skipWS();
        if (pos >= json.size()) return;
        if (json[pos] == '"') { readString(); return; }
        if (json[pos] == '[' || json[pos] == '{') {
            char open = json[pos], close = (open=='[') ? ']' : '}';
            int depth = 1; pos++;
            while (pos < json.size() && depth > 0) {
                if (json[pos] == open) depth++;
                else if (json[pos] == close) depth--;
                else if (json[pos] == '"') { pos++; while (pos<json.size()&&json[pos]!='"') { if (json[pos]=='\\') pos++; pos++; } }
                pos++;
            }
            return;
        }
        // number/bool/null
        while (pos < json.size() && json[pos]!=',' && json[pos]!='}' && json[pos]!=']') pos++;
    };
    
    if (!expectChar('[')) return;
    
    while (pos < json.size()) {
        skipWS();
        if (pos < json.size() && json[pos] == ']') break;
        if (!expectChar('{')) break;
        
        SegmentWords seg;
        while (pos < json.size() && json[pos] != '}') {
            std::string key = readString();
            expectChar(':');
            
            if (key == "start") seg.start = readNumber();
            else if (key == "end") seg.end = readNumber();
            else if (key == "text") seg.text = readString();
            else if (key == "words") {
                if (expectChar('[')) {
                    while (pos < json.size() && json[pos] != ']') {
                        skipWS();
                        if (json[pos] == ']') break;
                        if (!expectChar('{')) break;
                        WordTiming wt;
                        while (pos < json.size() && json[pos] != '}') {
                            std::string wkey = readString();
                            expectChar(':');
                            if (wkey == "word") wt.word = readString();
                            else if (wkey == "start") wt.start = readNumber();
                            else if (wkey == "end") wt.end = readNumber();
                            else skipValue();
                            skipWS();
                            if (pos < json.size() && json[pos] == ',') pos++;
                        }
                        expectChar('}');
                        if (!wt.word.empty()) seg.words.push_back(wt);
                        skipWS();
                        if (pos < json.size() && json[pos] == ',') pos++;
                    }
                    expectChar(']');
                }
            } else {
                skipValue();
            }
            skipWS();
            if (pos < json.size() && json[pos] == ',') pos++;
        }
        expectChar('}');
        if (!seg.text.empty()) s_wordTimings.push_back(seg);
        skipWS();
        if (pos < json.size() && json[pos] == ',') pos++;
    }
    
    int totalWords = 0;
    for (auto& s : s_wordTimings) totalWords += (int)s.words.size();
    fprintf(stderr, "[SUB] Loaded word timing: %zu segments, %d words from %s\n",
            s_wordTimings.size(), totalWords, path.c_str());
}

// Find word timings for a given segment text
static const SegmentWords* findSegmentWords(const std::string& text, double timeSec) {
    for (const auto& sw : s_wordTimings) {
        if (sw.text == text || (timeSec >= sw.start && timeSec <= sw.end)) {
            return &sw;
        }
    }
    return nullptr;
}

void effectSubtitle(AVFrame* frame, const EngineConfig& config, double timeSec) {
    if (config.srtPath.empty() && config.assPath.empty()) return;
    
    int w = frame->width, h = frame->height;

    // ═══════════════════════════════════════════════════
    // MODE 1: ASS file — use FFmpeg ass filter (matches preview exactly)
    // ═══════════════════════════════════════════════════
    if (!config.assPath.empty()) {
        // Persistent ASS filter graph — cached between frames
        static AVFilterGraph* s_assGraph = nullptr;
        static AVFilterContext* s_assSrcCtx = nullptr;
        static AVFilterContext* s_assSinkCtx = nullptr;
        static std::string s_assPath;
        static int s_assW = 0, s_assH = 0;
        static bool s_assInitFailed = false;  // prevent retry spam
        
        // Skip if init already failed for this path (prevent per-frame error spam)
        if (s_assInitFailed && s_assPath == config.assPath && s_assW == w && s_assH == h) {
            // fall through to legacy drawtext below
        } else if (s_assPath != config.assPath || s_assW != w || s_assH != h) {
            s_assInitFailed = false;  // reset on new path/dims
            if (s_assGraph) { avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; }
            s_assSrcCtx = nullptr; s_assSinkCtx = nullptr;
            
            s_assGraph = avfilter_graph_alloc();
            if (!s_assGraph) { s_assInitFailed = true; return; }
            
            const AVFilter* bufSrc = avfilter_get_by_name("buffer");
            const AVFilter* bufSink = avfilter_get_by_name("buffersink");
            if (!bufSrc || !bufSink) { avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return; }
            
            char srcArgs[256];
            snprintf(srcArgs, sizeof(srcArgs), "video_size=%dx%d:pix_fmt=%d:time_base=1/30",
                     w, h, AV_PIX_FMT_YUV420P);
            
            if (avfilter_graph_create_filter(&s_assSrcCtx, bufSrc, "in", srcArgs, nullptr, s_assGraph) < 0 ||
                avfilter_graph_create_filter(&s_assSinkCtx, bufSink, "out", nullptr, nullptr, s_assGraph) < 0) {
                avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return;
            }
            
            // Create ASS filter — must set filename BEFORE init
            // The ass filter reads filename during init(), so we:
            //   1. avfilter_graph_alloc_filter (alloc without init)
            //   2. av_opt_set filename/fontsdir (before init)
            //   3. avfilter_init_str (initialize with options already set)
            const AVFilter* assFilter = avfilter_get_by_name("ass");
            if (!assFilter) {
                fprintf(stderr, "[SUB-ASS] ERROR: 'ass' filter not available in FFmpeg build\n");
                avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return;
            }
            
            AVFilterContext* assCtx = avfilter_graph_alloc_filter(s_assGraph, assFilter, "ass");
            if (!assCtx) {
                fprintf(stderr, "[SUB-ASS] ERROR: failed to alloc ass filter\n");
                avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return;
            }
            
            // Set filename/fontsdir BEFORE init (raw path, no escaping needed)
            av_opt_set(assCtx->priv, "filename", config.assPath.c_str(), 0);
            if (!config.fontsDir.empty()) {
                av_opt_set(assCtx->priv, "fontsdir", config.fontsDir.c_str(), 0);
            }
            fprintf(stderr, "[SUB-ASS] Set filename=%s fontsdir=%s\n", config.assPath.c_str(), config.fontsDir.c_str());
            
            // Now initialize — ass filter will read filename during init
            if (avfilter_init_str(assCtx, nullptr) < 0) {
                fprintf(stderr, "[SUB-ASS] ERROR: failed to init ass filter\n");
                avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return;
            }
            
            avfilter_link(s_assSrcCtx, 0, assCtx, 0);
            avfilter_link(assCtx, 0, s_assSinkCtx, 0);
            
            if (avfilter_graph_config(s_assGraph, nullptr) < 0) {
                fprintf(stderr, "[SUB-ASS] ERROR: filter graph config failed\n");
                avfilter_graph_free(&s_assGraph); s_assGraph = nullptr; s_assInitFailed = true; return;
            }
            
            s_assPath = config.assPath;
            s_assW = w;
            s_assH = h;
            fprintf(stderr, "[SUB-ASS] Filter graph initialized: %s (%dx%d)\n", config.assPath.c_str(), w, h);
        }
        
        // Feed frame through ASS filter (per-frame — ASS handles animation timing)
        if (s_assGraph && s_assSrcCtx && s_assSinkCtx) {
            // Set PTS from timeSec for correct subtitle timing
            frame->pts = (int64_t)(timeSec * 30.0);  // time_base=1/30
            
            int ret = av_buffersrc_add_frame_flags(s_assSrcCtx, frame, AV_BUFFERSRC_FLAG_KEEP_REF);
            if (ret >= 0) {
                AVFrame* rendered = av_frame_alloc();
                ret = av_buffersink_get_frame(s_assSinkCtx, rendered);
                if (ret >= 0) {
                    // Copy rendered frame data back to original frame
                    for (int y = 0; y < h; y++)
                        memcpy(frame->data[0] + y * frame->linesize[0],
                               rendered->data[0] + y * rendered->linesize[0], w);
                    for (int y = 0; y < h/2; y++) {
                        memcpy(frame->data[1] + y * frame->linesize[1],
                               rendered->data[1] + y * rendered->linesize[1], w/2);
                        memcpy(frame->data[2] + y * frame->linesize[2],
                               rendered->data[2] + y * rendered->linesize[2], w/2);
                    }
                }
                av_frame_free(&rendered);
            }
        }
        return;  // ASS mode done — no drawtext fallback needed
    }

    // ═══════════════════════════════════════════════════
    // MODE 2: Legacy drawtext — SRT path only (no ASS)
    // ═══════════════════════════════════════════════════
    loadSrt(config.srtPath);
    loadWordTimings(config.wordsJsonPath);
    
    // Find current subtitle + timing for animation
    std::string currentText;
    double subStartSec = 0.0, subEndSec = 0.0;
    for (const auto& e : g_srtEntries) {
        if (timeSec >= e.startSec && timeSec <= e.endSec) {
            currentText = e.text;
            subStartSec = e.startSec;
            subEndSec = e.endSec;
            break;
        }
    }
    if (currentText.empty()) return;

    // ── CUDA subtitle cache ──
    static CudaSubCache* s_subCache = nullptr;
    static std::string s_subCachedText;
    static std::string s_subCachedFontKey;
    static int s_subW = 0, s_subH = 0;

    // Font key = font path + size + color (rebuild if any change)
    std::string fontKey = config.subFontPath + "|" + std::to_string(config.subFontSize) + "|" + config.subColor;
    
    // For karaoke/word_pop: include active word in cache key so we re-render on word change
    std::string renderAnimCheck = config.subAnimation;
    if (config.subStyle == "dynamic_caption") renderAnimCheck = "word_pop";
    const SegmentWords* segWordsCheck = findSegmentWords(currentText, timeSec);
    if (segWordsCheck && !segWordsCheck->words.empty() &&
        (renderAnimCheck == "karaoke" || renderAnimCheck == "word_pop")) {
        int activeIdx = -1;
        for (size_t wi = 0; wi < segWordsCheck->words.size(); wi++) {
            if (timeSec >= segWordsCheck->words[wi].start && timeSec <= segWordsCheck->words[wi].end) {
                activeIdx = (int)wi; break;
            }
        }
        if (activeIdx < 0) {
            for (int wi = (int)segWordsCheck->words.size()-1; wi >= 0; wi--) {
                if (timeSec > segWordsCheck->words[wi].end) { activeIdx = wi; break; }
            }
        }
        fontKey += "|w" + std::to_string(activeIdx);
    }

    // Initialize CUDA cache once
    if (!s_subCache && cudaEffectsAvailable()) {
        s_subCache = cudaSubCacheCreate();
    }

    // Pre-render subtitle texture when text/word changes
    if (s_subCachedText != currentText || s_subW != w || s_subH != h || s_subCachedFontKey != fontKey) {
        // Build avfilter graph for ONE-TIME render
        AVFilterGraph* graph = avfilter_graph_alloc();
        if (!graph) return;

        const AVFilter* bufSrc = avfilter_get_by_name("buffer");
        const AVFilter* bufSink = avfilter_get_by_name("buffersink");
        if (!bufSrc || !bufSink) { avfilter_graph_free(&graph); return; }

        AVFilterContext* srcCtx = nullptr;
        AVFilterContext* sinkCtx = nullptr;
        char srcArgs[256];
        snprintf(srcArgs, sizeof(srcArgs), "video_size=%dx%d:pix_fmt=%d:time_base=1/30",
                 w, h, AV_PIX_FMT_YUV420P);

        if (avfilter_graph_create_filter(&srcCtx, bufSrc, "in", srcArgs, nullptr, graph) < 0 ||
            avfilter_graph_create_filter(&sinkCtx, bufSink, "out", nullptr, nullptr, graph) < 0) {
            avfilter_graph_free(&graph); return;
        }

        // Font — use user-selected font or fallback
        std::string fontPath = config.subFontPath;
        if (fontPath.empty()) {
            const char* appRoot = getenv("APP_ROOT");
            std::string appRootStr = appRoot ? std::string(appRoot) : ".";
            fontPath = appRootStr + "/fonts/Inter-Bold.ttf";
        }
        for (auto& c : fontPath) if (c == '\\') c = '/';
        if (!std::ifstream(fontPath).good())
            fontPath = "C:/Windows/Fonts/arialbd.ttf";
        
        std::string ffmpegFont;
        for (char c : fontPath) {
            if (c == ':') ffmpegFont += "\\:";
            else ffmpegFont += c;
        }

        // Font size — scale to output resolution
        int fontSize = config.subFontSize;
        if (fontSize < 10) fontSize = 22;
        fontSize = (int)(fontSize * ((float)w / 640.0f));
        if (fontSize > 100) fontSize = 100;
        if (fontSize < 14) fontSize = 14;

        // ── Style profile: map subStyle → drawtext params ──
        // Matches CSS from useSubtitleRenderer.ts
        std::string fontcolor = config.subColor;
        if (fontcolor.empty()) fontcolor = "#ffffff";
        int borderW = 3;
        std::string borderColor = "black";
        int shadowX = 2, shadowY = 2;
        std::string shadowColor = "black@0.6";
        bool useBox = true;
        std::string boxColor = "black@0.35";
        int boxBorderW = 6;

        const std::string& style = config.subStyle;
        if (style == "bold_center") {
            // Montserrat Black, white, thick outline
            fontcolor = "#ffffff";
            borderW = 4;
            shadowX = 0; shadowY = 3;
            shadowColor = "black@0.6";
            useBox = false;
        } else if (style == "karaoke") {
            // Poppins Bold, gold, glow
            fontcolor = "#FFD700";
            borderW = 3;
            shadowX = 0; shadowY = 0;
            shadowColor = "#FFD700@0.4";
            useBox = false;
        } else if (style == "thin_minimal") {
            // Poppins 600, white, thin outline
            fontcolor = "#ffffff";
            borderW = 2;
            shadowX = 1; shadowY = 1;
            shadowColor = "black@0.5";
            useBox = false;
        } else if (style == "neon_glow") {
            // Bangers, cyan neon
            fontcolor = "#00ffcc";
            borderW = 3;
            shadowX = 0; shadowY = 0;
            shadowColor = "#00ffcc@0.5";
            useBox = false;
        } else if (style == "dynamic_caption") {
            // Montserrat Black, white, thick outline, uppercase
            fontcolor = "#ffffff";
            borderW = 4;
            shadowX = 0; shadowY = 4;
            shadowColor = "black@0.6";
            useBox = false;
        } else {
            // Default: use user color with standard styling
            useBox = true;
        }

        // Override fontcolor with user's custom color if they explicitly set one
        if (!config.subColor.empty() && style != "karaoke" && style != "neon_glow") {
            fontcolor = config.subColor;
        }

        // Word-wrap with MAX 3 LINES — auto-reduce fontSize if needed
        const int MAX_SUB_LINES = 3;
        int renderFontSize = fontSize;
        std::vector<std::string> lines;
        
        for (int attempt = 0; attempt < 4; attempt++) {
            lines.clear();
            float charWidth = renderFontSize * 0.55f;
            int maxCharsPerLine = (int)((w * 0.85f) / charWidth);
            if (maxCharsPerLine < 10) maxCharsPerLine = 10;
            
            std::string word, line;
            for (size_t i = 0; i <= currentText.size(); i++) {
                char c = (i < currentText.size()) ? currentText[i] : ' ';
                if (c == ' ' || i == currentText.size()) {
                    if (!word.empty()) {
                        std::string test = line.empty() ? word : line + " " + word;
                        if ((int)test.size() > maxCharsPerLine && !line.empty()) {
                            lines.push_back(line);
                            line = word;
                        } else {
                            line = test;
                        }
                        word.clear();
                    }
                } else {
                    word += c;
                }
            }
            if (!line.empty()) lines.push_back(line);
            if (lines.empty()) lines.push_back(currentText);
            
            if ((int)lines.size() <= MAX_SUB_LINES) break;
            renderFontSize = (int)(renderFontSize * 0.8f);
            if (renderFontSize < fontSize * 0.4f) { renderFontSize = (int)(fontSize * 0.4f); break; }
        }
        fontSize = renderFontSize;
        if ((int)lines.size() > MAX_SUB_LINES) {
            lines.resize(MAX_SUB_LINES);
            if (!lines.back().empty()) lines.back() += "...";
        }

        // Position
        int lineHeight = (int)(fontSize * 1.4f);
        int totalHeight = (int)lines.size() * lineHeight;
        int baseY;
        if (config.subPosition == "top") baseY = 40;
        else if (config.subPosition == "center") baseY = (h - totalHeight) / 2;
        else baseY = h - totalHeight - 80;
        
        fprintf(stderr, "[SUB-CFG] anim='%s' pos='%s' style='%s' fontSize=%d baseY=%d lines=%zu font='%s'\n",
                config.subAnimation.c_str(), config.subPosition.c_str(), config.subStyle.c_str(),
                fontSize, baseY, lines.size(), config.subFontPath.c_str());

        // ── Per-word karaoke rendering vs standard line rendering ──
        // Determine animation for render strategy (need to match animation section below)
        std::string renderAnim = config.subAnimation;
        if (config.subStyle == "dynamic_caption") renderAnim = "word_pop";
        
        const SegmentWords* segWords = findSegmentWords(currentText, timeSec);
        bool usePerWordRender = (segWords && !segWords->words.empty() &&
                                 (renderAnim == "karaoke" || renderAnim == "word_pop"));
        
        // Chain drawtext filters
        AVFilterContext* lastCtx = srcCtx;
        
        if (usePerWordRender) {
            // ── Per-word rendering: each word gets its own drawtext ──
            // Calculate active word index from timeSec
            int activeWordIdx = -1;
            for (size_t wi = 0; wi < segWords->words.size(); wi++) {
                if (timeSec >= segWords->words[wi].start && timeSec <= segWords->words[wi].end) {
                    activeWordIdx = (int)wi;
                    break;
                }
            }
            if (activeWordIdx < 0) {
                for (int wi = (int)segWords->words.size()-1; wi >= 0; wi--) {
                    if (timeSec > segWords->words[wi].end) { activeWordIdx = wi; break; }
                }
            }
            
            int spaceWidth = (int)(fontSize * 0.3f);
            int lineMaxW = (int)(w * 0.85f);
            
            // Per-word layout with proper line grouping
            struct WordLayout {
                std::string text;
                int relX;        // relative X within its line
                int wPx;         // estimated pixel width
                int lineIdx;     // which line this word belongs to
                bool active;
            };
            std::vector<WordLayout> wordLayouts;
            
            // First pass: assign words to lines
            int xCursor = 0;
            int currentLine = 0;
            for (size_t wi = 0; wi < segWords->words.size(); wi++) {
                int wordW = (int)(segWords->words[wi].word.size() * fontSize * 0.55f);
                if (wordW < fontSize) wordW = fontSize; // minimum one char width
                if (xCursor > 0 && xCursor + spaceWidth + wordW > lineMaxW) {
                    currentLine++;
                    xCursor = 0;
                }
                WordLayout wl;
                wl.text = segWords->words[wi].word;
                wl.relX = xCursor;
                wl.wPx = wordW;
                wl.lineIdx = currentLine;
                wl.active = ((int)wi == activeWordIdx);
                wordLayouts.push_back(wl);
                xCursor += wordW + spaceWidth;
            }
            
            // Compute total width per line
            int numLines = currentLine + 1;
            std::vector<int> lineWidths(numLines, 0);
            for (const auto& wl : wordLayouts) {
                int endX = wl.relX + wl.wPx;
                if (endX > lineWidths[wl.lineIdx]) lineWidths[wl.lineIdx] = endX;
            }
            
            // Render each word with centered positioning
            int filterIdx = 0;
            for (const auto& wl : wordLayouts) {
                std::string escaped;
                for (char c : wl.text) {
                    if (c == '\'') escaped += "\\'";
                    else if (c == ':') escaped += "\\:";
                    else if (c == '\\') escaped += "/";
                    else if (c == ',') escaped += "\\,";
                    else escaped += c;
                }
                
                // Center this line + add word's relative position
                int lineW = lineWidths[wl.lineIdx];
                int lineStartX = (w - lineW) / 2;
                int absX = lineStartX + wl.relX;
                int absY = baseY + wl.lineIdx * lineHeight;
                
                // Active word: bright highlight | Inactive: dimmed
                std::string wordColor;
                int wordBorderW = borderW;
                if (wl.active) {
                    if (style == "karaoke") wordColor = "#FFD700";
                    else if (style == "neon_glow") wordColor = "#00ffff";
                    else wordColor = "#FFFF00";
                    wordBorderW = borderW + 1;
                } else {
                    if (style == "karaoke") wordColor = "#ffffff@0.5";
                    else wordColor = fontcolor + "@0.5";
                }
                
                char dtArgs[4096];
                snprintf(dtArgs, sizeof(dtArgs),
                    "fontfile='%s':text='%s':x=%d:y=%d:fontsize=%d"
                    ":fontcolor=%s:borderw=%d:bordercolor=%s"
                    ":shadowx=%d:shadowy=%d:shadowcolor=%s",
                    ffmpegFont.c_str(), escaped.c_str(),
                    absX, absY, fontSize,
                    wordColor.c_str(), wordBorderW, borderColor.c_str(),
                    shadowX, shadowY, shadowColor.c_str());
                
                const AVFilter* dt = avfilter_get_by_name("drawtext");
                char filterName[64];
                snprintf(filterName, sizeof(filterName), "subw%d", filterIdx++);
                AVFilterContext* dtCtx = nullptr;
                if (!dt || avfilter_graph_create_filter(&dtCtx, dt, filterName, dtArgs, nullptr, graph) < 0) {
                    avfilter_graph_free(&graph); return;
                }
                avfilter_link(lastCtx, 0, dtCtx, 0);
                lastCtx = dtCtx;
            }
        } else {
            // ── Standard line-based rendering ──
            for (size_t li = 0; li < lines.size(); li++) {
                std::string escaped;
                for (char c : lines[li]) {
                    if (c == '\'') escaped += "\\'";
                    else if (c == ':') escaped += "\\:";
                    else if (c == '\\') escaped += "/";
                    else if (c == ',') escaped += "\\,";
                    else escaped += c;
                }
                int yPos = baseY + (int)li * lineHeight;
                char dtArgs[4096];
                if (useBox) {
                    snprintf(dtArgs, sizeof(dtArgs),
                        "fontfile='%s':text='%s':x=(w-text_w)/2:y=%d:fontsize=%d"
                        ":fontcolor=%s:borderw=%d:bordercolor=%s"
                        ":shadowx=%d:shadowy=%d:shadowcolor=%s"
                        ":box=1:boxcolor=%s:boxborderw=%d",
                        ffmpegFont.c_str(), escaped.c_str(), yPos, fontSize,
                        fontcolor.c_str(), borderW, borderColor.c_str(),
                        shadowX, shadowY, shadowColor.c_str(),
                        boxColor.c_str(), boxBorderW);
                } else {
                    snprintf(dtArgs, sizeof(dtArgs),
                        "fontfile='%s':text='%s':x=(w-text_w)/2:y=%d:fontsize=%d"
                        ":fontcolor=%s:borderw=%d:bordercolor=%s"
                        ":shadowx=%d:shadowy=%d:shadowcolor=%s",
                        ffmpegFont.c_str(), escaped.c_str(), yPos, fontSize,
                        fontcolor.c_str(), borderW, borderColor.c_str(),
                        shadowX, shadowY, shadowColor.c_str());
                }

                const AVFilter* dt = avfilter_get_by_name("drawtext");
                char filterName[32];
                snprintf(filterName, sizeof(filterName), "sub%zu", li);
                AVFilterContext* dtCtx = nullptr;
                if (!dt || avfilter_graph_create_filter(&dtCtx, dt, filterName, dtArgs, nullptr, graph) < 0) {
                    avfilter_graph_free(&graph); return;
                }
                avfilter_link(lastCtx, 0, dtCtx, 0);
                lastCtx = dtCtx;
            }
        }
        avfilter_link(lastCtx, 0, sinkCtx, 0);

        if (avfilter_graph_config(graph, nullptr) < 0) {
            avfilter_graph_free(&graph); return;
        }

        // Create a mid-gray frame (Y=128, U=128, V=128) as baseline
        fprintf(stderr, "[SUB] Pre-rendering subtitle: '%s' (%dx%d)\n", currentText.c_str(), w, h);
        AVFrame* grayFrame = av_frame_alloc();
        if (!grayFrame) {
            fprintf(stderr, "[SUB] ERROR: av_frame_alloc failed for grayFrame\n");
            avfilter_graph_free(&graph);
            return;
        }
        grayFrame->format = AV_PIX_FMT_YUV420P;
        grayFrame->width = w;
        grayFrame->height = h;
        int ret = av_frame_get_buffer(grayFrame, 0);
        if (ret < 0) {
            fprintf(stderr, "[SUB] ERROR: av_frame_get_buffer failed: %d\n", ret);
            av_frame_free(&grayFrame);
            avfilter_graph_free(&graph);
            return;
        }
        memset(grayFrame->data[0], 128, grayFrame->linesize[0] * h);
        memset(grayFrame->data[1], 128, grayFrame->linesize[1] * (h / 2));
        memset(grayFrame->data[2], 128, grayFrame->linesize[2] * (h / 2));
        grayFrame->pts = 0;
        fprintf(stderr, "[SUB] Gray frame created OK\n");

        // Render drawtext on gray frame (ONE TIME)
        bool uploadOk = false;
        ret = av_buffersrc_add_frame(srcCtx, grayFrame);
        if (ret >= 0) {
            fprintf(stderr, "[SUB] avfilter render started...\n");
            AVFrame* rendered = av_frame_alloc();
            ret = av_buffersink_get_frame(sinkCtx, rendered);
            if (ret >= 0) {
                fprintf(stderr, "[SUB] avfilter render OK, uploading to GPU...\n");
                // Upload to CUDA cache: rendered on gray baseline → alpha from |Y-128|
                if (s_subCache) {
                    uploadOk = cudaSubCacheUpload(s_subCache,
                        rendered->data[0], rendered->data[1], rendered->data[2],
                        w, h, rendered->linesize[0], rendered->linesize[1]);
                    fprintf(stderr, "[SUB] CUDA upload: %s\n", uploadOk ? "OK" : "FAILED");
                }
            } else {
                fprintf(stderr, "[SUB] ERROR: av_buffersink_get_frame failed: %d\n", ret);
            }
            av_frame_free(&rendered);
        } else {
            fprintf(stderr, "[SUB] ERROR: av_buffersrc_add_frame failed: %d\n", ret);
        }
        av_frame_free(&grayFrame);
        avfilter_graph_free(&graph);

        s_subCachedText = currentText;
        s_subCachedFontKey = fontKey;
        s_subW = w;
        s_subH = h;
    }

    // ── Animation System ──
    // Easing functions
    auto easeOutCubic = [](float t) -> float {
        t = 1.0f - t;
        return 1.0f - t * t * t;
    };
    auto easeOutBounce = [](float t) -> float {
        if (t < 1.0f / 2.75f) return 7.5625f * t * t;
        else if (t < 2.0f / 2.75f) { t -= 1.5f / 2.75f; return 7.5625f * t * t + 0.75f; }
        else if (t < 2.5f / 2.75f) { t -= 2.25f / 2.75f; return 7.5625f * t * t + 0.9375f; }
        else { t -= 2.625f / 2.75f; return 7.5625f * t * t + 0.984375f; }
    };
    auto easeOutElastic = [](float t) -> float {
        if (t <= 0.0f) return 0.0f;
        if (t >= 1.0f) return 1.0f;
        return (float)(pow(2.0, -10.0 * t) * sin((t - 0.075) * (2.0 * M_PI) / 0.3) + 1.0);
    };

    double subDuration = subEndSec - subStartSec;
    double elapsed = timeSec - subStartSec;
    double remaining = subEndSec - timeSec;
    float progress = (subDuration > 0) ? (float)(elapsed / subDuration) : 1.0f;
    if (progress < 0.0f) progress = 0.0f;
    if (progress > 1.0f) progress = 1.0f;

    // Animation params
    float fadeAlpha = 1.0f;
    int yOffset = 0;
    double fadeInDur = 0.3;
    double fadeOutDur = 0.2;
    int animHeight = h / 6;  // max animation travel distance

    // Auto-force animation for certain styles (matches preview behavior)
    std::string anim = config.subAnimation;
    if (config.subStyle == "dynamic_caption") anim = "word_pop";

    if (anim == "none") {
        // No animation — full opacity, no offset
        fadeAlpha = 1.0f;
        yOffset = 0;
    }
    else if (anim == "fade") {
        // Simple fade in/out
        if (elapsed < fadeInDur)
            fadeAlpha = (float)(elapsed / fadeInDur);
        else if (remaining < fadeOutDur)
            fadeAlpha = (float)(remaining / fadeOutDur);
        yOffset = 0;
    }
    else if (anim == "pop") {
        // Elastic scale in + fade (yOffset approximates scale from center)
        float animProgress = (elapsed < 0.5) ? (float)(elapsed / 0.5) : 1.0f;
        float scale = easeOutElastic(animProgress);
        // Approximate scale via yOffset: during scale-in, push text down slightly
        yOffset = (int)((1.0f - scale) * animHeight * 0.3f);
        fadeAlpha = (animProgress < 0.2f) ? animProgress * 5.0f : 1.0f;
        // Fade out at end
        if (remaining < fadeOutDur)
            fadeAlpha *= (float)(remaining / fadeOutDur);
    }
    else if (anim == "slide_up") {
        // Slide up from below + fade
        float animProgress = (elapsed < 0.4) ? (float)(elapsed / 0.4) : 1.0f;
        float eased = easeOutCubic(animProgress);
        yOffset = (int)((1.0f - eased) * animHeight);
        fadeAlpha = (animProgress < 0.15f) ? animProgress * 6.67f : 1.0f;
        if (remaining < fadeOutDur)
            fadeAlpha *= (float)(remaining / fadeOutDur);
    }
    else if (anim == "bounce") {
        // Drop from top with bounce easing
        float animProgress = (elapsed < 0.6) ? (float)(elapsed / 0.6) : 1.0f;
        float eased = easeOutBounce(animProgress);
        yOffset = (int)((1.0f - eased) * -animHeight);  // negative = from above
        fadeAlpha = 1.0f;
        if (remaining < fadeOutDur)
            fadeAlpha = (float)(remaining / fadeOutDur);
    }
    else if (anim == "typewriter") {
        // Typewriter: fade reveals progressively (full text rendered, alpha ramps)
        // True typewriter would need per-char re-rendering. Instead, we fade in quickly.
        float animProgress = (elapsed < 0.8) ? (float)(elapsed / 0.8) : 1.0f;
        fadeAlpha = easeOutCubic(animProgress);
        yOffset = 0;
        if (remaining < fadeOutDur)
            fadeAlpha *= (float)(remaining / fadeOutDur);
    }
    else if (anim == "karaoke") {
        // Karaoke: full text visible, fade in at start + fade out at end
        if (elapsed < fadeInDur)
            fadeAlpha = (float)(elapsed / fadeInDur);
        else if (remaining < fadeOutDur)
            fadeAlpha = (float)(remaining / fadeOutDur);
        yOffset = 0;
    }
    else if (anim == "word_pop") {
        // Dynamic caption: pop in with elastic + fade
        float animProgress = (elapsed < 0.35) ? (float)(elapsed / 0.35) : 1.0f;
        float scale = easeOutElastic(animProgress);
        yOffset = (int)((1.0f - scale) * animHeight * 0.5f);
        fadeAlpha = (animProgress < 0.15f) ? animProgress * 6.67f : 1.0f;
        if (remaining < fadeOutDur)
            fadeAlpha *= (float)(remaining / fadeOutDur);
    }
    else {
        // Unknown animation — default to fade
        if (elapsed < fadeInDur) fadeAlpha = (float)(elapsed / fadeInDur);
        else if (remaining < fadeOutDur) fadeAlpha = (float)(remaining / fadeOutDur);
    }

    // Clamp
    if (fadeAlpha < 0.0f) fadeAlpha = 0.0f;
    if (fadeAlpha > 1.0f) fadeAlpha = 1.0f;

    // GPU-accelerated subtitle overlay with animation params
    if (s_subCache && s_subCache->valid) {
        cudaSubOverlay(frame->data[0], frame->data[1], frame->data[2],
                       w, h, frame->linesize[0], frame->linesize[1],
                       s_subCache, fadeAlpha, yOffset);
    }
}


// ═══════════════════════════════════════════════════
// VIDEO/IMAGE OVERLAY — alpha-blend overlay on frame
// ═══════════════════════════════════════════════════

// Cached overlay decoder for video files
static AVFormatContext* g_ovFmtCtx = nullptr;
static AVCodecContext* g_ovDecCtx = nullptr;
static int g_ovVideoIdx = -1;
static SwsContext* g_ovSws = nullptr;
static AVFrame* g_ovYUV = nullptr;       // current decoded YUV frame
static std::string g_ovPath;
static bool g_ovIsVideo = false;
static int g_ovTargetW = 0, g_ovTargetH = 0;

// For image overlays
static uint8_t* g_ovRGBA = nullptr;
static int g_ovImgW = 0, g_ovImgH = 0;
static AVFrame* g_ovImgYUV = nullptr;

static void closeOverlayDecoder() {
    if (g_ovSws) { sws_freeContext(g_ovSws); g_ovSws = nullptr; }
    if (g_ovYUV) { av_frame_free(&g_ovYUV); }
    if (g_ovDecCtx) { avcodec_free_context(&g_ovDecCtx); }
    if (g_ovFmtCtx) { avformat_close_input(&g_ovFmtCtx); }
    g_ovVideoIdx = -1;
    g_ovIsVideo = false;
}

static bool openOverlayVideo(const std::string& path, int targetW, int targetH) {
    closeOverlayDecoder();
    if (g_ovRGBA) { stbi_image_free(g_ovRGBA); g_ovRGBA = nullptr; }
    if (g_ovImgYUV) { av_frame_free(&g_ovImgYUV); }

    // Detect type by extension
    std::string ext;
    auto dot = path.rfind('.');
    if (dot != std::string::npos) {
        ext = path.substr(dot);
        for (auto& c : ext) c = tolower(c);
    }
    bool isVideo = (ext == ".mp4" || ext == ".webm" || ext == ".mov" || ext == ".avi" || ext == ".mkv");

    if (!isVideo) {
        // Image overlay — use stbi_load
        int channels;
        g_ovRGBA = stbi_load(path.c_str(), &g_ovImgW, &g_ovImgH, &channels, 4);
        if (!g_ovRGBA) {
            fprintf(stderr, "[ENGINE] Failed to load overlay image: %s\n", path.c_str());
            return false;
        }
        // Convert RGBA to YUV420P frame for efficient per-frame blending
        g_ovImgYUV = av_frame_alloc();
        g_ovImgYUV->format = AV_PIX_FMT_YUV420P;
        g_ovImgYUV->width = targetW;
        g_ovImgYUV->height = targetH;
        av_frame_get_buffer(g_ovImgYUV, 0);
        // Scale RGBA → target size → YUV420P
        SwsContext* imgSws = sws_getContext(g_ovImgW, g_ovImgH, AV_PIX_FMT_RGBA,
                                             targetW, targetH, AV_PIX_FMT_YUV420P,
                                             SWS_BILINEAR, nullptr, nullptr, nullptr);
        if (imgSws) {
            uint8_t* srcData[1] = { g_ovRGBA };
            int srcStride[1] = { g_ovImgW * 4 };
            sws_scale(imgSws, srcData, srcStride, 0, g_ovImgH,
                      g_ovImgYUV->data, g_ovImgYUV->linesize);
            sws_freeContext(imgSws);
        }
        g_ovIsVideo = false;
        g_ovTargetW = targetW;
        g_ovTargetH = targetH;
        fprintf(stderr, "[ENGINE] Loaded overlay image: %dx%d → %dx%d (%s)\n",
                g_ovImgW, g_ovImgH, targetW, targetH, path.c_str());
        return true;
    }

    // Video overlay — open with FFmpeg
    if (avformat_open_input(&g_ovFmtCtx, path.c_str(), nullptr, nullptr) < 0) {
        fprintf(stderr, "[ENGINE] Failed to open overlay video: %s\n", path.c_str());
        return false;
    }
    avformat_find_stream_info(g_ovFmtCtx, nullptr);

    for (unsigned i = 0; i < g_ovFmtCtx->nb_streams; i++) {
        if (g_ovFmtCtx->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_VIDEO) {
            g_ovVideoIdx = i;
            break;
        }
    }
    if (g_ovVideoIdx < 0) {
        avformat_close_input(&g_ovFmtCtx);
        fprintf(stderr, "[ENGINE] No video stream in overlay: %s\n", path.c_str());
        return false;
    }

    const AVCodec* codec = avcodec_find_decoder(g_ovFmtCtx->streams[g_ovVideoIdx]->codecpar->codec_id);
    g_ovDecCtx = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(g_ovDecCtx, g_ovFmtCtx->streams[g_ovVideoIdx]->codecpar);
    avcodec_open2(g_ovDecCtx, codec, nullptr);

    g_ovSws = sws_getContext(g_ovDecCtx->width, g_ovDecCtx->height, g_ovDecCtx->pix_fmt,
                              targetW, targetH, AV_PIX_FMT_YUV420P,
                              SWS_BILINEAR, nullptr, nullptr, nullptr);
    g_ovYUV = av_frame_alloc();
    g_ovYUV->format = AV_PIX_FMT_YUV420P;
    g_ovYUV->width = targetW;
    g_ovYUV->height = targetH;
    av_frame_get_buffer(g_ovYUV, 0);

    g_ovIsVideo = true;
    g_ovTargetW = targetW;
    g_ovTargetH = targetH;
    fprintf(stderr, "[ENGINE] Opened overlay video: %dx%d → %dx%d (%s)\n",
            g_ovDecCtx->width, g_ovDecCtx->height, targetW, targetH, path.c_str());
    return true;
}

static bool decodeNextOverlayFrame() {
    if (!g_ovFmtCtx || !g_ovDecCtx) return false;

    AVPacket* pkt = av_packet_alloc();
    AVFrame* raw = av_frame_alloc();
    bool got = false;

    while (av_read_frame(g_ovFmtCtx, pkt) >= 0) {
        if (pkt->stream_index == g_ovVideoIdx) {
            if (avcodec_send_packet(g_ovDecCtx, pkt) == 0) {
                if (avcodec_receive_frame(g_ovDecCtx, raw) == 0) {
                    sws_scale(g_ovSws, raw->data, raw->linesize, 0, raw->height,
                              g_ovYUV->data, g_ovYUV->linesize);
                    got = true;
                    av_packet_unref(pkt);
                    break;
                }
            }
        }
        av_packet_unref(pkt);
    }

    // If EOF, loop back to start
    if (!got) {
        av_seek_frame(g_ovFmtCtx, g_ovVideoIdx, 0, AVSEEK_FLAG_BACKWARD);
        avcodec_flush_buffers(g_ovDecCtx);
        // Try once more
        while (av_read_frame(g_ovFmtCtx, pkt) >= 0) {
            if (pkt->stream_index == g_ovVideoIdx) {
                if (avcodec_send_packet(g_ovDecCtx, pkt) == 0) {
                    if (avcodec_receive_frame(g_ovDecCtx, raw) == 0) {
                        sws_scale(g_ovSws, raw->data, raw->linesize, 0, raw->height,
                                  g_ovYUV->data, g_ovYUV->linesize);
                        got = true;
                        av_packet_unref(pkt);
                        break;
                    }
                }
            }
            av_packet_unref(pkt);
        }
    }

    av_frame_free(&raw);
    av_packet_free(&pkt);
    return got;
}

void effectVideoOverlay(AVFrame* frame, const EngineConfig& config, int64_t frameNum) {
    if (config.overlayPath.empty()) return;

    // Blink: check if overlay should be visible at this frame
    if (config.overlayBlink) {
        float t = (float)frameNum / 30.0f;
        float cycle = config.overlayBlinkSpeed;
        float interval = config.overlayInterval;
        float totalCycle = cycle + interval;
        float phase = fmodf(t, totalCycle);
        if (phase > cycle) return;
    }

    int w = frame->width, h = frame->height;
    float opacity = config.overlayOpacity / 100.0f;
    if (opacity <= 0.0f) return;
    if (opacity > 1.0f) opacity = 1.0f;

    // Open overlay (cached)
    if (config.overlayPath != g_ovPath || g_ovTargetW != w || g_ovTargetH != h) {
        if (!openOverlayVideo(config.overlayPath, w, h)) return;
        g_ovPath = config.overlayPath;
        if (g_ovIsVideo) decodeNextOverlayFrame(); // get first frame
    }

    // Get current overlay YUV frame
    AVFrame* ovFrame = nullptr;
    if (g_ovIsVideo) {
        decodeNextOverlayFrame();  // advance to next frame
        ovFrame = g_ovYUV;
    } else {
        ovFrame = g_ovImgYUV;
    }
    if (!ovFrame) return;

    // Alpha-blend: overlay Y/U/V onto main frame with opacity
    // Since overlay is YUV (no alpha channel), use uniform opacity
    for (int row = 0; row < h; row++) {
        uint8_t* dstY = frame->data[0] + row * frame->linesize[0];
        uint8_t* srcY = ovFrame->data[0] + row * ovFrame->linesize[0];
        for (int col = 0; col < w; col++) {
            dstY[col] = (uint8_t)((1 - opacity) * dstY[col] + opacity * srcY[col]);
        }
    }
    int ch = h / 2, cw = w / 2;
    for (int row = 0; row < ch; row++) {
        uint8_t* dstU = frame->data[1] + row * frame->linesize[1];
        uint8_t* dstV = frame->data[2] + row * frame->linesize[2];
        uint8_t* srcU = ovFrame->data[1] + row * ovFrame->linesize[1];
        uint8_t* srcV = ovFrame->data[2] + row * ovFrame->linesize[2];
        for (int col = 0; col < cw; col++) {
            dstU[col] = (uint8_t)((1 - opacity) * dstU[col] + opacity * srcU[col]);
            dstV[col] = (uint8_t)((1 - opacity) * dstV[col] + opacity * srcV[col]);
        }
    }
}
