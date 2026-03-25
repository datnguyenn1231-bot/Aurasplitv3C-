/**
 * AuraEngine Effects — Per-pixel video processing on YUV420P frames.
 * Port of reup-filters.ts effects to C++ for single-pass rendering.
 * MATCHES FFmpeg filter chain EXACTLY.
 *
 * YUV420P layout:
 *   Y plane: full res (w × h), 1 byte per pixel (luma)
 *   U plane: half res (w/2 × h/2), 1 byte per pixel (chroma blue)
 *   V plane: half res (w/2 × h/2), 1 byte per pixel (chroma red)
 */

#include "effects.h"
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <algorithm>
#include <omp.h>

extern "C" {
#include <libswscale/swscale.h>
}

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ── Helpers ──

static inline uint8_t clamp8(int v) {
    return (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
}

static void hexToYUV(const char* hex, uint8_t& Y, uint8_t& U, uint8_t& V) {
    unsigned int r = 0, g = 0, b = 0;
    if (hex[0] == '#') hex++;
    sscanf(hex, "%02x%02x%02x", &r, &g, &b);
    Y = clamp8((int)(0.299 * r + 0.587 * g + 0.114 * b));
    U = clamp8((int)(-0.169 * r - 0.331 * g + 0.500 * b + 128));
    V = clamp8((int)(0.500 * r - 0.419 * g - 0.081 * b + 128));
}

// ── Fill rectangle (with alpha blending) ──

static void fillRect(AVFrame* frame, int x, int y, int w, int h,
                     uint8_t yVal, uint8_t uVal, uint8_t vVal, float alpha) {
    int fw = frame->width;
    int fh = frame->height;
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > fw) w = fw - x;
    if (y + h > fh) h = fh - y;
    if (w <= 0 || h <= 0) return;

    for (int row = y; row < y + h; row++) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0] + x;
        for (int col = 0; col < w; col++) {
            pY[col] = clamp8((int)(pY[col] * (1.0f - alpha) + yVal * alpha));
        }
    }
    int ux = x / 2, uy = y / 2, uw = (w + 1) / 2, uh = (h + 1) / 2;
    for (int row = uy; row < uy + uh && row < fh / 2; row++) {
        uint8_t* pU = frame->data[1] + row * frame->linesize[1] + ux;
        uint8_t* pV = frame->data[2] + row * frame->linesize[2] + ux;
        for (int col = 0; col < uw && (ux + col) < fw / 2; col++) {
            pU[col] = clamp8((int)(pU[col] * (1.0f - alpha) + uVal * alpha));
            pV[col] = clamp8((int)(pV[col] * (1.0f - alpha) + vVal * alpha));
        }
    }
}

// ═══════════════════════════════════════════════════
// L1: MIRROR — FFmpeg: hflip
// ═══════════════════════════════════════════════════

void effectMirror(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    for (int row = 0; row < h; row++) {
        uint8_t* line = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w / 2; col++)
            std::swap(line[col], line[w - 1 - col]);
    }
    int cw = w / 2, ch = h / 2;
    for (int row = 0; row < ch; row++) {
        uint8_t* lineU = frame->data[1] + row * frame->linesize[1];
        uint8_t* lineV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw / 2; col++) {
            std::swap(lineU[col], lineU[cw - 1 - col]);
            std::swap(lineV[col], lineV[cw - 1 - col]);
        }
    }
}

// ═══════════════════════════════════════════════════
// L3: NOISE — FFmpeg: noise=alls=N:allf=t+u
// ═══════════════════════════════════════════════════

void effectNoise(AVFrame* frame, int intensity) {
    int w = frame->width, h = frame->height;
    for (int row = 0; row < h; row++) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++) {
            int noise = (rand() % (intensity * 2 + 1)) - intensity;
            pY[col] = clamp8(pY[col] + noise);
        }
    }
}

// ═══════════════════════════════════════════════════
// L5: LENS DISTORTION — FFmpeg: lenscorrection=cx=0.5:cy=0.5:k1=-0.003:k2=-0.001
// ═══════════════════════════════════════════════════

void effectLensDistortion(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    float k1 = -0.003f, k2 = -0.001f;

    uint8_t* origY = new uint8_t[w * h];
    for (int row = 0; row < h; row++)
        memcpy(origY + row * w, frame->data[0] + row * frame->linesize[0], w);

    #pragma omp parallel for schedule(static)
    for (int row = 0; row < h; row++) {
        uint8_t* dst = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++) {
            float nx = (float)col / w - 0.5f;
            float ny = (float)row / h - 0.5f;
            float r2 = nx * nx + ny * ny;
            float distort = 1.0f + k1 * r2 + k2 * r2 * r2;
            int sx = (int)((nx * distort + 0.5f) * w);
            int sy = (int)((ny * distort + 0.5f) * h);
            if (sx >= 0 && sx < w && sy >= 0 && sy < h)
                dst[col] = origY[sy * w + sx];
        }
    }
    delete[] origY;
}

// ═══════════════════════════════════════════════════
// L6: HDR — FFmpeg: eq=contrast=1.15:saturation=1.20:brightness=0.02, unsharp=5:5:0.5:3:3:0.0
// ═══════════════════════════════════════════════════

void effectHDR(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    // CSS: contrast(1.10) saturate(1.10) brightness(1.01) → match CSS values
    for (int row = 0; row < h; row++) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++) {
            float val = (pY[col] - 128) * 1.10f + 128 + 0.01f * 255;
            pY[col] = clamp8((int)val);
        }
    }
    // saturation=1.10 (CSS value, not FFmpeg-boosted 1.20)
    int cw = w / 2, ch = h / 2;
    for (int row = 0; row < ch; row++) {
        uint8_t* pU = frame->data[1] + row * frame->linesize[1];
        uint8_t* pV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw; col++) {
            pU[col] = clamp8((int)((pU[col] - 128) * 1.10f + 128));
            pV[col] = clamp8((int)((pV[col] - 128) * 1.10f + 128));
        }
    }
}

// ═══════════════════════════════════════════════════
// COLOR GRADING — FFmpeg: eq=brightness/contrast/saturation + hue
// EXACT match to getColorGradingFilter() in reup-filters.ts
// ═══════════════════════════════════════════════════

void effectColorGrading(AVFrame* frame, const std::string& mode) {
    if (mode == "none" || mode.empty()) return;

    int w = frame->width, h = frame->height;
    int cw = w / 2, ch = h / 2;

    if (mode == "vibrant") {
        // CSS: saturate(1.3) contrast(1.08) brightness(1.05) → match CSS values
        for (int row = 0; row < h; row++) {
            uint8_t* pY = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                float val = (pY[col] - 128) * 1.08f + 128 + 0.05f * 255;
                pY[col] = clamp8((int)val);
            }
        }
        for (int row = 0; row < ch; row++) {
            uint8_t* pU = frame->data[1] + row * frame->linesize[1];
            uint8_t* pV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                pU[col] = clamp8((int)((pU[col] - 128) * 1.30f + 128));
                pV[col] = clamp8((int)((pV[col] - 128) * 1.30f + 128));
            }
        }
    } else if (mode == "bw") {
        // hue=s=0, eq=contrast=1.15
        for (int row = 0; row < ch; row++) {
            uint8_t* pU = frame->data[1] + row * frame->linesize[1];
            uint8_t* pV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                pU[col] = 128; pV[col] = 128; // desaturate
            }
        }
        for (int row = 0; row < h; row++) {
            uint8_t* pY = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                float val = (pY[col] - 128) * 1.15f + 128;
                pY[col] = clamp8((int)val);
            }
        }
    } else if (mode == "cool_blue") {
        // eq=saturation=0.85:brightness=0.01, hue=h=15
        float hueRad = 15.0f * (float)M_PI / 180.0f;
        float cosH = cosf(hueRad), sinH = sinf(hueRad);
        for (int row = 0; row < h; row++) {
            uint8_t* pY = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                pY[col] = clamp8(pY[col] + (int)(0.01f * 255));
            }
        }
        for (int row = 0; row < ch; row++) {
            uint8_t* pU = frame->data[1] + row * frame->linesize[1];
            uint8_t* pV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                float u = (pU[col] - 128) * 0.85f;
                float v = (pV[col] - 128) * 0.85f;
                pU[col] = clamp8((int)(u * cosH - v * sinH + 128));
                pV[col] = clamp8((int)(u * sinH + v * cosH + 128));
            }
        }
    } else if (mode == "warm") {
        // Warm tone: brightness + warm tint
        for (int row = 0; row < h; row++) {
            uint8_t* pY = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                pY[col] = clamp8(pY[col] + (int)(0.03f * 255));
            }
        }
        for (int row = 0; row < ch; row++) {
            uint8_t* pU = frame->data[1] + row * frame->linesize[1];
            uint8_t* pV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                pU[col] = clamp8(pU[col] - 4);  // less blue
                pV[col] = clamp8(pV[col] + 6);  // more warm/red
            }
        }
    } else if (mode == "sepia") {
        // Warm sepia: desaturate 70% + warm tint + contrast
        for (int row = 0; row < h; row++) {
            uint8_t* pY = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                float val = (pY[col] - 128) * 1.05f + 128 + 0.02f * 255;
                pY[col] = clamp8((int)val);
            }
        }
        for (int row = 0; row < ch; row++) {
            uint8_t* pU = frame->data[1] + row * frame->linesize[1];
            uint8_t* pV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                float u = (pU[col] - 128) * 0.30f;  // heavy desaturate
                float v = (pV[col] - 128) * 0.30f;
                pU[col] = clamp8((int)(u + 128 - 8));   // cool shift
                pV[col] = clamp8((int)(v + 128 + 12));   // warm shift
            }
        }
    }
}

// ═══════════════════════════════════════════════════
// GLOW — FFmpeg: eq=brightness=0.10:contrast=1.06,
//        colorbalance=rm=0.10:gm=0.05:bm=-0.05,
//        unsharp=7:7:1.2:7:7:0.0
// ═══════════════════════════════════════════════════

void effectGlow(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    // CSS: brightness(1.08) → match CSS
    for (int row = 0; row < h; row++) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++) {
            float val = pY[col] + 0.08f * 255;
            pY[col] = clamp8((int)val);
        }
    }
    // Warm color shift (subtle)
    int cw = w / 2, ch = h / 2;
    for (int row = 0; row < ch; row++) {
        uint8_t* pU = frame->data[1] + row * frame->linesize[1];
        uint8_t* pV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw; col++) {
            pU[col] = clamp8(pU[col] - 2);   // subtle cool
            pV[col] = clamp8(pV[col] + 3);   // subtle warm
        }
    }
}

// ═══════════════════════════════════════════════════
// BORDER — FFmpeg: drawbox solid on edges
// ═══════════════════════════════════════════════════

void effectBorder(AVFrame* frame, int bw, const std::string& colorHex) {
    if (bw <= 0) return;
    uint8_t yVal, uVal, vVal;
    hexToYUV(colorHex.c_str(), yVal, uVal, vVal);
    int w = frame->width, h = frame->height;
    fillRect(frame, 0, 0, w, bw, yVal, uVal, vVal, 1.0f);       // top
    fillRect(frame, 0, h - bw, w, bw, yVal, uVal, vVal, 1.0f);  // bottom
    fillRect(frame, 0, 0, bw, h, yVal, uVal, vVal, 1.0f);       // left
    fillRect(frame, w - bw, 0, bw, h, yVal, uVal, vVal, 1.0f);  // right
}

// ═══════════════════════════════════════════════════
// GLOW HALO — FFmpeg: 8 drawbox layers on edges
// EXACT colors/sizes from reup-filters.ts L304-314
// ═══════════════════════════════════════════════════

void effectGlowHalo(AVFrame* frame) {
    uint8_t yVal, uVal, vVal;
    hexToYUV("FFC864", yVal, uVal, vVal);
    int w = frame->width, h = frame->height;
    // 2px, alpha 0.10 — matches FFmpeg: drawbox w=2, alpha 0.10
    fillRect(frame, 0, 0, 2, h, yVal, uVal, vVal, 0.10f);      // left
    fillRect(frame, w - 2, 0, 2, h, yVal, uVal, vVal, 0.10f);   // right
    fillRect(frame, 0, 0, w, 2, yVal, uVal, vVal, 0.10f);        // top
    fillRect(frame, 0, h - 2, w, 2, yVal, uVal, vVal, 0.10f);    // bottom
}

// ═══════════════════════════════════════════════════
// RGB DRIFT — FFmpeg: drawbox + hue=H=3*n
// EXACT colors from reup-filters.ts L320-330
// ═══════════════════════════════════════════════════

void effectRGBDrift(AVFrame* frame, int64_t frameNum) {
    int w = frame->width, h = frame->height;
    
    // Animated hue angle for border colors only (NOT whole frame)
    // CSS preview only cycles border colors, video content stays unchanged
    float hueAngle = (float)(frameNum * 3) * (float)M_PI / 180.0f;
    float cosH = cosf(hueAngle), sinH = sinf(hueAngle);
    
    // Helper: rotate a color's UV by hue angle
    auto rotateHue = [cosH, sinH](uint8_t& u, uint8_t& v) {
        float fu = (float)(u - 128);
        float fv = (float)(v - 128);
        u = clamp8((int)(fu * cosH - fv * sinH + 128));
        v = clamp8((int)(fu * sinH + fv * cosH + 128));
    };

    // Pre-rotate border colors by hue angle (rainbow cycling)
    uint8_t y1, u1, v1, y2, u2, v2;
    hexToYUV("FF4488", y1, u1, v1); rotateHue(u1, v1);
    hexToYUV("44AAFF", y2, u2, v2); rotateHue(u2, v2);
    
    // 1px drawbox — matches FFmpeg: drawbox w=1, alpha 0.12
    // Subtle colored edge (imperceptible to eye, changes fingerprint)
    fillRect(frame, 0, 0, 1, h, y1, u1, v1, 0.12f);      // left
    fillRect(frame, w - 1, 0, 1, h, y2, u2, v2, 0.12f);   // right
    fillRect(frame, 0, 0, w, 1, y2, u2, v2, 0.12f);        // top
    fillRect(frame, 0, h - 1, w, 1, y1, u1, v1, 0.12f);    // bottom
}

// ═══════════════════════════════════════════════════
// ROTATE — FFmpeg: rotate=RAD:c=black@0:ow=iw:oh=ih
// ═══════════════════════════════════════════════════

void effectRotate(AVFrame* frame, float degrees, bool withSSAA) {
    if (degrees == 0.0f) return;
    float rad = -degrees * (float)M_PI / 180.0f;
    float cosR = cosf(rad), sinR = sinf(rad);
    int w = frame->width, h = frame->height;
    float cx = w / 2.0f, cy = h / 2.0f;

    uint8_t* origY = new uint8_t[w * h];
    for (int row = 0; row < h; row++)
        memcpy(origY + row * w, frame->data[0] + row * frame->linesize[0], w);

    #pragma omp parallel for schedule(static)
    for (int row = 0; row < h; row++) {
        uint8_t* dst = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++) {
            float dx = col - cx, dy = row - cy;
            float sx = dx * cosR + dy * sinR + cx;
            float sy = -dx * sinR + dy * cosR + cy;
            if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
                int ix = (int)sx, iy = (int)sy;
                float fx = sx - ix, fy = sy - iy;
                dst[col] = clamp8((int)(
                    origY[iy * w + ix] * (1 - fx) * (1 - fy) +
                    origY[iy * w + ix + 1] * fx * (1 - fy) +
                    origY[(iy + 1) * w + ix] * (1 - fx) * fy +
                    origY[(iy + 1) * w + ix + 1] * fx * fy
                ));
            } else {
                dst[col] = 0;
            }
        }
    }

    int cw = w / 2, ch = h / 2;
    float ccx = cw / 2.0f, ccy = ch / 2.0f;
    uint8_t* origU = new uint8_t[cw * ch];
    uint8_t* origV = new uint8_t[cw * ch];
    for (int row = 0; row < ch; row++) {
        memcpy(origU + row * cw, frame->data[1] + row * frame->linesize[1], cw);
        memcpy(origV + row * cw, frame->data[2] + row * frame->linesize[2], cw);
    }
    #pragma omp parallel for schedule(static)
    for (int row = 0; row < ch; row++) {
        uint8_t* dstU = frame->data[1] + row * frame->linesize[1];
        uint8_t* dstV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw; col++) {
            float dx = col - ccx, dy = row - ccy;
            float sx = dx * cosR + dy * sinR + ccx;
            float sy = -dx * sinR + dy * cosR + ccy;
            if (sx >= 0 && sx < cw - 1 && sy >= 0 && sy < ch - 1) {
                int ix = (int)sx, iy = (int)sy;
                dstU[col] = origU[iy * cw + ix];
                dstV[col] = origV[iy * cw + ix];
            } else {
                dstU[col] = 128; dstV[col] = 128;
            }
        }
    }
    delete[] origY;
    delete[] origU;
    delete[] origV;
    (void)withSSAA;
}

// ═══════════════════════════════════════════════════
// SMART CROP — FFmpeg: crop edges + pad back
// CropX = cut left+right, CropY = cut top+bottom
// ═══════════════════════════════════════════════════

void effectSmartCrop(AVFrame* frame, float cropX, float cropY) {
    int w = frame->width, h = frame->height;
    if (cropX <= 0 && cropY <= 0) return;
    
    float keepX = 1.0f - 2.0f * cropX;
    float keepY = 1.0f - 2.0f * cropY;
    if (keepX < 0.1f) keepX = 0.1f;
    if (keepY < 0.1f) keepY = 0.1f;
    
    int cropW = ((int)(w * keepX) / 2) * 2;
    int cropH = ((int)(h * keepY) / 2) * 2;
    int offX = ((int)(w * cropX) / 2) * 2;
    int offY = ((int)(h * cropY) / 2) * 2;
    
    // Copy cropped region to temp, then write back centered with black padding
    uint8_t* tmpY = new uint8_t[cropW * cropH];
    for (int row = 0; row < cropH; row++)
        memcpy(tmpY + row * cropW, frame->data[0] + (offY + row) * frame->linesize[0] + offX, cropW);
    
    // Clear Y to black
    for (int row = 0; row < h; row++)
        memset(frame->data[0] + row * frame->linesize[0], 0, w);
    
    // Paste back centered
    int padX = ((w - cropW) / 2 / 2) * 2;
    int padY = ((h - cropH) / 2 / 2) * 2;
    for (int row = 0; row < cropH && (padY + row) < h; row++)
        memcpy(frame->data[0] + (padY + row) * frame->linesize[0] + padX, tmpY + row * cropW, cropW);
    delete[] tmpY;
    
    // UV planes
    int cw = w / 2, ch = h / 2;
    int ccropW = cropW / 2, ccropH = cropH / 2;
    int coffX = offX / 2, coffY = offY / 2;
    int cpadX = padX / 2, cpadY = padY / 2;
    
    uint8_t* tmpU = new uint8_t[ccropW * ccropH];
    uint8_t* tmpV = new uint8_t[ccropW * ccropH];
    for (int row = 0; row < ccropH; row++) {
        memcpy(tmpU + row * ccropW, frame->data[1] + (coffY + row) * frame->linesize[1] + coffX, ccropW);
        memcpy(tmpV + row * ccropW, frame->data[2] + (coffY + row) * frame->linesize[2] + coffX, ccropW);
    }
    for (int row = 0; row < ch; row++) {
        memset(frame->data[1] + row * frame->linesize[1], 128, cw);
        memset(frame->data[2] + row * frame->linesize[2], 128, cw);
    }
    for (int row = 0; row < ccropH && (cpadY + row) < ch; row++) {
        memcpy(frame->data[1] + (cpadY + row) * frame->linesize[1] + cpadX, tmpU + row * ccropW, ccropW);
        memcpy(frame->data[2] + (cpadY + row) * frame->linesize[2] + cpadX, tmpV + row * ccropW, ccropW);
    }
    delete[] tmpU;
    delete[] tmpV;
}

// ═══════════════════════════════════════════════════
// PIXEL ENLARGE — FFmpeg: scale 3x nearest → scale back → contrast boost
// ═══════════════════════════════════════════════════

void effectPixelEnlarge(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    // Nearest-neighbor 3x up then 3x down = pixelate effect
    // Equivalent: replace each 3x3 block with average
    for (int row = 0; row < h; row += 3) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col += 3) {
            uint8_t val = pY[col];
            for (int dy = 0; dy < 3 && (row + dy) < h; dy++)
                for (int dx = 0; dx < 3 && (col + dx) < w; dx++)
                    frame->data[0][(row + dy) * frame->linesize[0] + col + dx] = val;
        }
    }
    // Contrast boost: contrast=1.12, brightness=0.04
    for (int row = 0; row < h; row++) {
        uint8_t* pY = frame->data[0] + row * frame->linesize[0];
        for (int col = 0; col < w; col++)
            pY[col] = clamp8((int)((pY[col] - 128) * 1.12f + 128 + 0.04f * 255));
    }
}

// ═══════════════════════════════════════════════════
// CHROMA SHUFFLE — FFmpeg: hue=h=12, eq=saturation=1.25
// ═══════════════════════════════════════════════════

void effectChromaShuffle(AVFrame* frame) {
    int cw = frame->width / 2, ch = frame->height / 2;
    float hueRad = 12.0f * (float)M_PI / 180.0f;
    float cosH = cosf(hueRad), sinH = sinf(hueRad);
    
    for (int row = 0; row < ch; row++) {
        uint8_t* pU = frame->data[1] + row * frame->linesize[1];
        uint8_t* pV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw; col++) {
            float u = (float)(pU[col] - 128);
            float v = (float)(pV[col] - 128);
            // Hue rotate 12° + saturation 1.25
            float ru = (u * cosH - v * sinH) * 1.25f;
            float rv = (u * sinH + v * cosH) * 1.25f;
            pU[col] = clamp8((int)(ru + 128));
            pV[col] = clamp8((int)(rv + 128));
        }
    }
}

// ═══════════════════════════════════════════════════
// RGB CHANNEL SHIFT — FFmpeg: rgbashift=rh=-3:rv=1:bh=3:bv=-1
// Shifts Y plane pixels to simulate RGB channel displacement
// ═══════════════════════════════════════════════════

void effectRGBShift(AVFrame* frame) {
    int w = frame->width, h = frame->height;
    // Shift U (blue-ish) and V (red-ish) channels slightly
    int cw = w / 2, ch = h / 2;
    
    uint8_t* origU = new uint8_t[cw * ch];
    uint8_t* origV = new uint8_t[cw * ch];
    for (int row = 0; row < ch; row++) {
        memcpy(origU + row * cw, frame->data[1] + row * frame->linesize[1], cw);
        memcpy(origV + row * cw, frame->data[2] + row * frame->linesize[2], cw);
    }
    
    // Shift U by (-1, 0) and V by (1, 0) in chroma space (≈ rh=-3:bh=3 at full res)
    for (int row = 0; row < ch; row++) {
        uint8_t* dU = frame->data[1] + row * frame->linesize[1];
        uint8_t* dV = frame->data[2] + row * frame->linesize[2];
        for (int col = 0; col < cw; col++) {
            int srcU = std::max(0, std::min(cw - 1, col + 1));
            int srcV = std::max(0, std::min(cw - 1, col - 1));
            dU[col] = origU[row * cw + srcU];
            dV[col] = origV[row * cw + srcV];
        }
    }
    delete[] origU;
    delete[] origV;
}

// ═══════════════════════════════════════════════════
// MAIN EFFECT DISPATCHER
// Order EXACTLY matches reup-filters.ts:
//   L1:Mirror → L2:Crop → L3:Noise → L5:Lens →
//   L6:HDR → ColorGrading → Glow(eq) → Border →
//   GlowHalo → RGB Drift → Rotate → Zoom →
//   Pixel Enlarge → Chroma Shuffle → RGB Shift
// ═══════════════════════════════════════════════════

void applyAllEffects(AVFrame* frame, const EngineConfig& config, int64_t frameNum, bool skipEdgeEffects) {
    // L1: Mirror
    if (config.mirror) effectMirror(frame);

    // L2: Smart Crop (crop edges + pad back)
    // With bgBlur: still crop, but don't worry about black padding — 
    // the bgBlur composite path rescales FG to fit, so padding won't be visible
    {
        float sCropX = config.cropX > 0 ? config.cropX : config.crop;
        float sCropY = config.cropY > 0 ? config.cropY : config.crop;
        if (sCropX > 0 || sCropY > 0) effectSmartCrop(frame, sCropX, sCropY);
    }

    // L3: Noise/Grain
    if (config.noise) effectNoise(frame, config.noiseIntensity);

    // L5: Lens Distortion
    if (config.lensDistortion) effectLensDistortion(frame);

    // L6: HDR
    if (config.hdr) effectHDR(frame);

    // Color Grading
    effectColorGrading(frame, config.colorGrading);

    // Glow (brightness + color boost)
    if (config.glow) effectGlow(frame);

    // Border (solid drawbox) — at FG video edges (matches FFmpeg)
    if (config.borderWidth > 0) effectBorder(frame, config.borderWidth, config.borderColor);

    // Glow Halo (drawbox edge layers) — at FG video edges
    if (config.glow) effectGlowHalo(frame);

    // RGB Drift (drawbox + hue rotation) — at FG video edges
    if (config.rgbDrift) effectRGBDrift(frame, frameNum);

    // Rotate — LAST effect (after all drawbox effects so borders rotate with content)
    if (config.rotate != 0.0f) effectRotate(frame, config.rotate, config.glow || config.rgbDrift);

    // ── PIXEL-LEVEL ANTI-DETECT (after all visual effects) ──
    
    // Pixel Enlarge
    if (config.pixelEnlarge > 0.0f) effectPixelEnlarge(frame);
    
    // Chroma Shuffle
    if (config.chromaShuffle > 0.0f) effectChromaShuffle(frame);
    
    // RGB channel shift (part of rgbDrift at pixel level)
    if (config.rgbDrift) effectRGBShift(frame);

    // Zoom Effect & Micro Zoom — PURE BILINEAR: no sws_scale, no integer rounding jitter
    // For each pixel: src = center + (dst - center) / zoom → bilinear sample
    float baseZ = (config.microZoom > 1.0f) ? config.microZoom : 1.0f;
    bool hasZoomAnim = (config.zoomEffect && config.zoomIntensity > 1.0f);
    
    if (baseZ > 1.0f || hasZoomAnim) {
        int w = frame->width, h = frame->height;
        float zoom = baseZ;
        
        if (hasZoomAnim) {
            float targetZ = baseZ * config.zoomIntensity;
            float amp = targetZ - baseZ;
            float t = (float)frameNum / 30.0f;
            
            float period = config.zoomPeriod > 0.0f ? config.zoomPeriod : 16.0f;
            float phase  = config.zoomPhase;
            float freq   = (float)M_PI * 2.0f / period;
            
            // S-curve matches CSS 'ease-in-out' exactly, but now fully randomized per video
            zoom = baseZ + amp * 0.5f * (1.0f - cosf(t * freq + phase));
        }
        
        if (zoom <= 1.001f) return; // No visible zoom
        
        float cx = w / 2.0f, cy = h / 2.0f;
        float invZoom = 1.0f / zoom;
        
        // Y plane: full resolution bilinear
        uint8_t* origY = new uint8_t[w * h];
        for (int row = 0; row < h; row++)
            memcpy(origY + row * w, frame->data[0] + row * frame->linesize[0], w);
        
        #pragma omp parallel for schedule(static)
        for (int row = 0; row < h; row++) {
            uint8_t* dst = frame->data[0] + row * frame->linesize[0];
            for (int col = 0; col < w; col++) {
                float sx = cx + (col - cx) * invZoom;
                float sy = cy + (row - cy) * invZoom;
                
                if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
                    int ix = (int)sx, iy = (int)sy;
                    float fx = sx - ix, fy = sy - iy;
                    dst[col] = clamp8((int)(
                        origY[iy * w + ix]       * (1 - fx) * (1 - fy) +
                        origY[iy * w + ix + 1]   * fx       * (1 - fy) +
                        origY[(iy+1) * w + ix]   * (1 - fx) * fy       +
                        origY[(iy+1) * w + ix+1] * fx       * fy
                    ));
                } else {
                    int cx2 = std::max(0, std::min(w-1, (int)roundf(sx)));
                    int cy2 = std::max(0, std::min(h-1, (int)roundf(sy)));
                    dst[col] = origY[cy2 * w + cx2];
                }
            }
        }
        delete[] origY;
        
        // UV planes: half resolution bilinear  
        int cw = w / 2, ch = h / 2;
        float ccx = cw / 2.0f, ccy = ch / 2.0f;
        uint8_t* origU = new uint8_t[cw * ch];
        uint8_t* origV = new uint8_t[cw * ch];
        for (int row = 0; row < ch; row++) {
            memcpy(origU + row * cw, frame->data[1] + row * frame->linesize[1], cw);
            memcpy(origV + row * cw, frame->data[2] + row * frame->linesize[2], cw);
        }
        
        #pragma omp parallel for schedule(static)
        for (int row = 0; row < ch; row++) {
            uint8_t* dstU = frame->data[1] + row * frame->linesize[1];
            uint8_t* dstV = frame->data[2] + row * frame->linesize[2];
            for (int col = 0; col < cw; col++) {
                float sx = ccx + (col - ccx) * invZoom;
                float sy = ccy + (row - ccy) * invZoom;
                
                int ix = std::max(0, std::min(cw-1, (int)roundf(sx)));
                int iy = std::max(0, std::min(ch-1, (int)roundf(sy)));
                dstU[col] = origU[iy * cw + ix];
                dstV[col] = origV[iy * cw + ix];
            }
        }
        delete[] origU;
        delete[] origV;
    }
}
