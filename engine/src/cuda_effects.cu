/**
 * CUDA Effects — GPU-accelerated video processing kernels.
 *
 * Phase 2: BG Blur on GPU (box blur + brightness/saturation)
 * Phase 3: Per-pixel effects (mirror, noise, HDR, color grading, etc.)
 * Phase 4: Composite FG on BG
 *
 * All kernels operate on YUV420P planes (Y=full res, U/V=half res).
 * Uses CUDA device memory with explicit Host↔Device transfers.
 */

#include "cuda_effects.h"
#include <cuda_runtime.h>
#include <curand_kernel.h>
#include <cstdio>
#include <cmath>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ── CUDA Error Checking ──
#define CUDA_CHECK(call) do { \
    cudaError_t err = (call); \
    if (err != cudaSuccess) { \
        fprintf(stderr, "[CUDA] Error: %s at %s:%d\n", cudaGetErrorString(err), __FILE__, __LINE__); \
        return false; \
    } \
} while(0)

static bool g_cudaAvailable = false;
static cudaDeviceProp g_devProp;

// ── Device memory pools (cached across frames) ──
static uint8_t* d_srcY = nullptr;
static uint8_t* d_srcU = nullptr;
static uint8_t* d_srcV = nullptr;
static uint8_t* d_outY = nullptr;
static uint8_t* d_outU = nullptr;
static uint8_t* d_outV = nullptr;
static uint8_t* d_tmpY = nullptr;  // temp for blur passes
static uint8_t* d_tmpU = nullptr;
static uint8_t* d_tmpV = nullptr;
static uint8_t* d_origY = nullptr; // original for rotate/zoom
static uint8_t* d_origU = nullptr;
static uint8_t* d_origV = nullptr;
static size_t d_srcSize = 0, d_outSize = 0, d_tmpSize = 0, d_origSize = 0;
// curand states for noise
static curandState* d_randStates = nullptr;
static int d_randCount = 0;

// ═══════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════

bool cudaEffectsInit() {
    int deviceCount = 0;
    cudaGetDeviceCount(&deviceCount);
    if (deviceCount == 0) {
        fprintf(stderr, "[CUDA] No CUDA devices found\n");
        return false;
    }
    cudaGetDeviceProperties(&g_devProp, 0);
    fprintf(stderr, "[CUDA] Device: %s (SM %d.%d, %d SMs, %.1f GB)\n",
            g_devProp.name, g_devProp.major, g_devProp.minor,
            g_devProp.multiProcessorCount,
            g_devProp.totalGlobalMem / (1024.0 * 1024.0 * 1024.0));
    g_cudaAvailable = true;
    return true;
}

void cudaEffectsCleanup() {
    if (d_srcY) cudaFree(d_srcY);
    if (d_srcU) cudaFree(d_srcU);
    if (d_srcV) cudaFree(d_srcV);
    if (d_outY) cudaFree(d_outY);
    if (d_outU) cudaFree(d_outU);
    if (d_outV) cudaFree(d_outV);
    if (d_tmpY) cudaFree(d_tmpY);
    if (d_tmpU) cudaFree(d_tmpU);
    if (d_tmpV) cudaFree(d_tmpV);
    if (d_origY) cudaFree(d_origY);
    if (d_origU) cudaFree(d_origU);
    if (d_origV) cudaFree(d_origV);
    if (d_randStates) cudaFree(d_randStates);
    d_srcY = d_srcU = d_srcV = nullptr;
    d_outY = d_outU = d_outV = nullptr;
    d_tmpY = d_tmpU = d_tmpV = nullptr;
    d_origY = d_origU = d_origV = nullptr;
    d_randStates = nullptr;
    d_srcSize = d_outSize = d_tmpSize = d_origSize = 0;
    d_randCount = 0;
    g_cudaAvailable = false;
}

bool cudaEffectsAvailable() { return g_cudaAvailable; }

// ── Ensure device memory is allocated (cached) ──
static bool ensureDevMem(uint8_t*& ptr, size_t& cached, size_t needed) {
    if (cached >= needed) return true;
    if (ptr) cudaFree(ptr);
    CUDA_CHECK(cudaMalloc(&ptr, needed));
    cached = needed;
    return true;
}

// ═══════════════════════════════════════════════════
// PHASE 2: CUDA BG BLUR KERNELS
// ═══════════════════════════════════════════════════

// Horizontal box blur kernel — each thread processes one row
__global__ void kernelBoxBlurH(uint8_t* dst, const uint8_t* src, int w, int h, int radius) {
    int y = blockIdx.x * blockDim.x + threadIdx.x;
    if (y >= h) return;

    int diam = radius * 2 + 1;
    const uint8_t* row = src + y * w;
    uint8_t* out = dst + y * w;

    int sum = row[0] * (radius + 1);
    for (int x = 0; x < radius && x < w; x++) sum += row[x];

    for (int x = 0; x < w; x++) {
        int right = (x + radius < w) ? row[x + radius] : row[w - 1];
        int left = (x - radius - 1 >= 0) ? row[x - radius - 1] : row[0];
        sum += right - left;
        out[x] = (uint8_t)(sum / diam);
    }
}

// Vertical box blur kernel — each thread processes one column
__global__ void kernelBoxBlurV(uint8_t* dst, const uint8_t* src, int w, int h, int radius) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    if (x >= w) return;

    int diam = radius * 2 + 1;
    int sum = src[x] * (radius + 1);
    for (int y = 0; y < radius && y < h; y++) sum += src[y * w + x];

    for (int y = 0; y < h; y++) {
        int bottom = (y + radius < h) ? src[(y + radius) * w + x] : src[(h - 1) * w + x];
        int top = (y - radius - 1 >= 0) ? src[(y - radius - 1) * w + x] : src[x];
        sum += bottom - top;
        dst[y * w + x] = (uint8_t)(sum / diam);
    }
}

// Brightness + saturation adjustment kernel
__global__ void kernelBrightSat(uint8_t* Y, uint8_t* U, uint8_t* V,
                                 int w, int h, float brightness, float saturation) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    // Y plane
    if (idx < w * h) {
        int val = (int)(Y[idx] + brightness * 255.0f);
        Y[idx] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
    }
    // UV planes (half res)
    int cw = w / 2, ch = h / 2;
    if (idx < cw * ch) {
        int uVal = (int)((U[idx] - 128) * saturation + 128);
        int vVal = (int)((V[idx] - 128) * saturation + 128);
        U[idx] = (uint8_t)(uVal < 0 ? 0 : (uVal > 255 ? 255 : uVal));
        V[idx] = (uint8_t)(vVal < 0 ? 0 : (vVal > 255 ? 255 : vVal));
    }
}

// Bilinear scale kernel — each thread computes one output pixel
__global__ void kernelBilinearScale(uint8_t* dst, int dstW, int dstH,
                                     const uint8_t* src, int srcW, int srcH) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= dstW || y >= dstH) return;

    float sx = (float)x * srcW / dstW;
    float sy = (float)y * srcH / dstH;
    int ix = (int)sx, iy = (int)sy;
    float fx = sx - ix, fy = sy - iy;

    if (ix >= srcW - 1) { ix = srcW - 2; fx = 1.0f; }
    if (iy >= srcH - 1) { iy = srcH - 2; fy = 1.0f; }
    if (ix < 0) { ix = 0; fx = 0; }
    if (iy < 0) { iy = 0; fy = 0; }

    float val = src[iy * srcW + ix] * (1 - fx) * (1 - fy)
              + src[iy * srcW + ix + 1] * fx * (1 - fy)
              + src[(iy + 1) * srcW + ix] * (1 - fx) * fy
              + src[(iy + 1) * srcW + ix + 1] * fx * fy;
    dst[y * dstW + x] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
}

bool cudaBgBlur(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outW, int outH, int outStrideY, int outStrideUV,
    const uint8_t* srcY, const uint8_t* srcU, const uint8_t* srcV,
    int srcW, int srcH, int srcStrideY, int srcStrideUV,
    int blurAmount)
{
    if (!g_cudaAvailable) return false;

    // 0.125x downscale — 64x fewer pixels, blur is still smooth since it's blurry anyway
    int smallW = ((int)(outW * 0.125) / 2) * 2;
    int smallH = ((int)(outH * 0.125) / 2) * 2;
    if (smallW < 4) smallW = 4;
    if (smallH < 4) smallH = 4;
    int cSmallW = smallW / 2, cSmallH = smallH / 2;

    // Allocate GPU memory
    size_t srcBytes = srcW * srcH + srcW/2 * srcH/2 * 2;
    size_t smallBytes = smallW * smallH + cSmallW * cSmallH * 2;
    size_t outBytes = outW * outH + outW/2 * outH/2 * 2;

    if (!ensureDevMem(d_srcY, d_srcSize, srcBytes)) return false;
    d_srcU = d_srcY + srcW * srcH;
    d_srcV = d_srcU + srcW/2 * srcH/2;

    if (!ensureDevMem(d_tmpY, d_tmpSize, smallBytes * 2)) return false; // 2x for ping-pong
    d_tmpU = d_tmpY + smallW * smallH;
    d_tmpV = d_tmpU + cSmallW * cSmallH;
    uint8_t* d_tmp2Y = d_tmpY + smallBytes;
    uint8_t* d_tmp2U = d_tmp2Y + smallW * smallH;
    uint8_t* d_tmp2V = d_tmp2U + cSmallW * cSmallH;

    if (!ensureDevMem(d_outY, d_outSize, outBytes)) return false;
    d_outU = d_outY + outW * outH;
    d_outV = d_outU + outW/2 * outH/2;

    // Copy source to GPU — BATCH with cudaMemcpy2D (6 calls instead of 3840!)
    cudaMemcpy2D(d_srcY, srcW, srcY, srcStrideY, srcW, srcH, cudaMemcpyHostToDevice);
    cudaMemcpy2D(d_srcU, srcW/2, srcU, srcStrideUV, srcW/2, srcH/2, cudaMemcpyHostToDevice);
    cudaMemcpy2D(d_srcV, srcW/2, srcV, srcStrideUV, srcW/2, srcH/2, cudaMemcpyHostToDevice);

    // Step 1: Downscale source → small frame (GPU bilinear)
    dim3 blkScale(16, 16);
    dim3 grdScale((smallW + 15) / 16, (smallH + 15) / 16);
    kernelBilinearScale<<<grdScale, blkScale>>>(d_tmpY, smallW, smallH, d_srcY, srcW, srcH);
    dim3 grdScaleC((cSmallW + 15) / 16, (cSmallH + 15) / 16);
    kernelBilinearScale<<<grdScaleC, blkScale>>>(d_tmpU, cSmallW, cSmallH, d_srcU, srcW/2, srcH/2);
    kernelBilinearScale<<<grdScaleC, blkScale>>>(d_tmpV, cSmallW, cSmallH, d_srcV, srcW/2, srcH/2);

    // Step 2: 2-pass box blur on small frame (2 passes sufficient at 0.125x scale)
    int radius = blurAmount / 4;  // larger radius for smaller frame
    if (radius < 1) radius = 1;
    if (radius > smallW / 4) radius = smallW / 4;
    int cr = radius / 2;
    if (cr < 1) cr = 1;

    int blkBlur = 256;
    for (int pass = 0; pass < 2; pass++) {
        // H blur: tmp → tmp2
        kernelBoxBlurH<<<(smallH + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmp2Y, d_tmpY, smallW, smallH, radius);
        kernelBoxBlurH<<<(cSmallH + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmp2U, d_tmpU, cSmallW, cSmallH, cr);
        kernelBoxBlurH<<<(cSmallH + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmp2V, d_tmpV, cSmallW, cSmallH, cr);
        // V blur: tmp2 → tmp
        kernelBoxBlurV<<<(smallW + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmpY, d_tmp2Y, smallW, smallH, radius);
        kernelBoxBlurV<<<(cSmallW + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmpU, d_tmp2U, cSmallW, cSmallH, cr);
        kernelBoxBlurV<<<(cSmallW + blkBlur - 1) / blkBlur, blkBlur>>>(d_tmpV, d_tmp2V, cSmallW, cSmallH, cr);
    }

    // Step 3: Brightness(-0.35) + Saturation(1.2)
    int totalPixels = smallW * smallH;
    kernelBrightSat<<<(totalPixels + 255) / 256, 256>>>(d_tmpY, d_tmpU, d_tmpV,
                                                          smallW, smallH, -0.35f, 1.2f);

    // Step 4: Upscale to output resolution
    dim3 grdOut((outW + 15) / 16, (outH + 15) / 16);
    kernelBilinearScale<<<grdOut, blkScale>>>(d_outY, outW, outH, d_tmpY, smallW, smallH);
    dim3 grdOutC((outW/2 + 15) / 16, (outH/2 + 15) / 16);
    kernelBilinearScale<<<grdOutC, blkScale>>>(d_outU, outW/2, outH/2, d_tmpU, cSmallW, cSmallH);
    kernelBilinearScale<<<grdOutC, blkScale>>>(d_outV, outW/2, outH/2, d_tmpV, cSmallW, cSmallH);

    // Copy result back to host — BATCH with cudaMemcpy2D (3 calls instead of 3840!)
    cudaDeviceSynchronize();
    // Check for ANY kernel launch failures (arch mismatch, OOM, etc.)
    cudaError_t bgErr = cudaGetLastError();
    if (bgErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] BG blur FAILED: %s → CPU fallback\n", cudaGetErrorString(bgErr));
        return false;  // triggers effectBgBlur() CPU path
    }
    cudaMemcpy2D(outY, outStrideY, d_outY, outW, outW, outH, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outU, outStrideUV, d_outU, outW/2, outW/2, outH/2, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outV, outStrideUV, d_outV, outW/2, outW/2, outH/2, cudaMemcpyDeviceToHost);

    return true;
}


// ═══════════════════════════════════════════════════
// PHASE 3: CUDA EFFECTS KERNELS
// ═══════════════════════════════════════════════════

// Initialize curand states
__global__ void kernelInitRand(curandState* states, int n, unsigned long long seed) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx < n) curand_init(seed, idx, 0, &states[idx]);
}

// Mirror Y plane (horizontal flip)
__global__ void kernelMirrorY(uint8_t* Y, int w, int h) {
    int y = blockIdx.x * blockDim.x + threadIdx.x;
    if (y >= h) return;
    uint8_t* row = Y + y * w;
    for (int x = 0; x < w / 2; x++) {
        uint8_t tmp = row[x];
        row[x] = row[w - 1 - x];
        row[w - 1 - x] = tmp;
    }
}

// Mirror UV planes
__global__ void kernelMirrorUV(uint8_t* U, uint8_t* V, int cw, int ch) {
    int y = blockIdx.x * blockDim.x + threadIdx.x;
    if (y >= ch) return;
    uint8_t* rowU = U + y * cw;
    uint8_t* rowV = V + y * cw;
    for (int x = 0; x < cw / 2; x++) {
        uint8_t tmpU = rowU[x]; rowU[x] = rowU[cw - 1 - x]; rowU[cw - 1 - x] = tmpU;
        uint8_t tmpV = rowV[x]; rowV[x] = rowV[cw - 1 - x]; rowV[cw - 1 - x] = tmpV;
    }
}

// Noise on Y plane
__global__ void kernelNoise(uint8_t* Y, int w, int h, int intensity, curandState* states) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= w * h) return;
    int noise = (int)(curand_uniform(&states[idx % 65536]) * (intensity * 2 + 1)) - intensity;
    int val = Y[idx] + noise;
    Y[idx] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
}

// HDR: contrast + brightness on Y, saturation on UV
__global__ void kernelHDR_Y(uint8_t* Y, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    float val = (Y[idx] - 128) * 1.10f + 128 + 0.01f * 255;
    Y[idx] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
}

__global__ void kernelHDR_UV(uint8_t* U, uint8_t* V, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    int uVal = (int)((U[idx] - 128) * 1.10f + 128);
    int vVal = (int)((V[idx] - 128) * 1.10f + 128);
    U[idx] = (uint8_t)(uVal < 0 ? 0 : (uVal > 255 ? 255 : uVal));
    V[idx] = (uint8_t)(vVal < 0 ? 0 : (vVal > 255 ? 255 : vVal));
}

// Color grading: vibrant
__global__ void kernelColorVibrant_Y(uint8_t* Y, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    float val = (Y[idx] - 128) * 1.08f + 128 + 0.05f * 255;
    Y[idx] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
}

__global__ void kernelColorVibrant_UV(uint8_t* U, uint8_t* V, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    int uVal = (int)((U[idx] - 128) * 1.30f + 128);
    int vVal = (int)((V[idx] - 128) * 1.30f + 128);
    U[idx] = (uint8_t)(uVal < 0 ? 0 : (uVal > 255 ? 255 : uVal));
    V[idx] = (uint8_t)(vVal < 0 ? 0 : (vVal > 255 ? 255 : vVal));
}

// Glow: brightness boost + warm shift
__global__ void kernelGlow_Y(uint8_t* Y, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    int val = (int)(Y[idx] + 0.08f * 255);
    Y[idx] = (uint8_t)(val > 255 ? 255 : val);
}

__global__ void kernelGlow_UV(uint8_t* U, uint8_t* V, int n) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    int uVal = U[idx] - 2; U[idx] = (uint8_t)(uVal < 0 ? 0 : uVal);
    int vVal = V[idx] + 3; V[idx] = (uint8_t)(vVal > 255 ? 255 : vVal);
}

// Lens distortion on Y plane
__global__ void kernelLensDistortion(uint8_t* dst, const uint8_t* src, int w, int h,
                                      float k1, float k2) {
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    if (col >= w || row >= h) return;

    float nx = (float)col / w - 0.5f;
    float ny = (float)row / h - 0.5f;
    float r2 = nx * nx + ny * ny;
    float distort = 1.0f + k1 * r2 + k2 * r2 * r2;
    int sx = (int)((nx * distort + 0.5f) * w);
    int sy = (int)((ny * distort + 0.5f) * h);

    if (sx >= 0 && sx < w && sy >= 0 && sy < h)
        dst[row * w + col] = src[sy * w + sx];
    else
        dst[row * w + col] = 0;
}

// Rotate Y with bilinear interpolation
__global__ void kernelRotate(uint8_t* dst, const uint8_t* src, int w, int h,
                              float cosR, float sinR) {
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    if (col >= w || row >= h) return;

    float cx = w / 2.0f, cy = h / 2.0f;
    float dx = col - cx, dy = row - cy;
    float sx = dx * cosR + dy * sinR + cx;
    float sy = -dx * sinR + dy * cosR + cy;

    if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        int ix = (int)sx, iy = (int)sy;
        float fx = sx - ix, fy = sy - iy;
        float val = src[iy * w + ix] * (1 - fx) * (1 - fy)
                  + src[iy * w + ix + 1] * fx * (1 - fy)
                  + src[(iy + 1) * w + ix] * (1 - fx) * fy
                  + src[(iy + 1) * w + ix + 1] * fx * fy;
        dst[row * w + col] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
    } else {
        dst[row * w + col] = 0;
    }
}

// Chroma shuffle: hue rotate 12° + saturation 1.25
__global__ void kernelChromaShuffle(uint8_t* U, uint8_t* V, int n,
                                     float cosH, float sinH) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    float u = (float)(U[idx] - 128);
    float v = (float)(V[idx] - 128);
    int ru = (int)((u * cosH - v * sinH) * 1.25f + 128);
    int rv = (int)((u * sinH + v * cosH) * 1.25f + 128);
    U[idx] = (uint8_t)(ru < 0 ? 0 : (ru > 255 ? 255 : ru));
    V[idx] = (uint8_t)(rv < 0 ? 0 : (rv > 255 ? 255 : rv));
}

// Zoom effect with bilinear
__global__ void kernelZoom(uint8_t* dst, const uint8_t* src, int w, int h, float invZoom) {
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    if (col >= w || row >= h) return;

    float cx = w / 2.0f, cy = h / 2.0f;
    float sx = cx + (col - cx) * invZoom;
    float sy = cy + (row - cy) * invZoom;

    if (sx >= 0 && sx < w - 1 && sy >= 0 && sy < h - 1) {
        int ix = (int)sx, iy = (int)sy;
        float fx = sx - ix, fy = sy - iy;
        float val = src[iy * w + ix] * (1 - fx) * (1 - fy)
                  + src[iy * w + ix + 1] * fx * (1 - fy)
                  + src[(iy + 1) * w + ix] * (1 - fx) * fy
                  + src[(iy + 1) * w + ix + 1] * fx * fy;
        dst[row * w + col] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
    } else {
        int cx2 = max(0, min(w - 1, (int)roundf(sx)));
        int cy2 = max(0, min(h - 1, (int)roundf(sy)));
        dst[row * w + col] = src[cy2 * w + cx2];
    }
}

// ═══════════════════════════════════════════════════
// ADVANCED ANTI-DETECT KERNELS
// ═══════════════════════════════════════════════════

// Frame Jitter: shift plane by (dx, dy) pixels — wraps edges
__global__ void kernelFrameJitter(uint8_t* dst, const uint8_t* src, int w, int h,
                                   int dx, int dy) {
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    if (col >= w || row >= h) return;
    // Source pixel with wrap-around
    int sx = (col - dx + w) % w;
    int sy = (row - dy + h) % h;
    dst[row * w + col] = src[sy * w + sx];
}

// Gamma Shift: Y = 255 * pow(Y/255, gamma)
// gamma near 1.0 is imperceptible but changes every pixel value
__global__ void kernelGammaShift(uint8_t* Y, int n, float gamma) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    float normalized = Y[idx] / 255.0f;
    float corrected = powf(normalized, gamma) * 255.0f;
    Y[idx] = (uint8_t)(corrected < 0 ? 0 : (corrected > 255 ? 255 : corrected));
}

// Micro Color Cycle: shift U/V by small amount per frame
__global__ void kernelMicroColorCycle(uint8_t* U, uint8_t* V, int n,
                                       int uShift, int vShift) {
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= n) return;
    int uVal = U[idx] + uShift;
    int vVal = V[idx] + vShift;
    U[idx] = (uint8_t)(uVal < 0 ? 0 : (uVal > 255 ? 255 : uVal));
    V[idx] = (uint8_t)(vVal < 0 ? 0 : (vVal > 255 ? 255 : vVal));
}

// DCT Noise: block-position-dependent noise pattern (8x8 blocks)
// Each 8x8 block gets a unique noise offset based on its position
__global__ void kernelDctNoise(uint8_t* Y, int w, int h, int frameSeed) {
    int col = blockIdx.x * blockDim.x + threadIdx.x;
    int row = blockIdx.y * blockDim.y + threadIdx.y;
    if (col >= w || row >= h) return;
    // Block coordinates (8x8 DCT blocks)
    int bx = col / 8, by = row / 8;
    // Position within block
    int px = col % 8, py = row % 8;
    // Hash: unique per block+frame, deterministic
    unsigned int hash = (unsigned int)(bx * 7919 + by * 104729 + frameSeed * 31337 + px * 13 + py * 17);
    hash ^= hash >> 16; hash *= 0x45d9f3b; hash ^= hash >> 16;
    // Uniform noise in [-2, +2] range
    int noise = ((int)(hash % 5)) - 2;
    int val = Y[row * w + col] + noise;
    Y[row * w + col] = (uint8_t)(val < 0 ? 0 : (val > 255 ? 255 : val));
}

// ── Main effects dispatcher (Phase 3) ──
bool cudaApplyEffects(
    uint8_t* Y, uint8_t* U, uint8_t* V,
    int w, int h, int strideY, int strideUV,
    const CudaEffectParams& params)
{
    if (!g_cudaAvailable) return false;

    int ySize = w * h;
    int cw = w / 2, ch = h / 2;
    int uvSize = cw * ch;
    size_t totalSize = ySize + uvSize * 2;

    // Alloc device memory
    if (!ensureDevMem(d_srcY, d_srcSize, totalSize)) return false;
    uint8_t* dY = d_srcY;
    uint8_t* dU = d_srcY + ySize;
    uint8_t* dV = dU + uvSize;

    // Upload strided → packed (single DMA per plane, not per row)
    cudaMemcpy2D(dY, w, Y, strideY, w, h, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dU, cw, U, strideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dV, cw, V, strideUV, cw, ch, cudaMemcpyHostToDevice);

    int blk = 256;
    dim3 blk2d(16, 16);
    dim3 grd2d((w + 15) / 16, (h + 15) / 16);
    dim3 grd2dC((cw + 15) / 16, (ch + 15) / 16);

    // Mirror
    if (params.mirror) {
        kernelMirrorY<<<(h + blk - 1) / blk, blk>>>(dY, w, h);
        kernelMirrorUV<<<(ch + blk - 1) / blk, blk>>>(dU, dV, cw, ch);
    }

    // Noise
    if (params.noise && params.noiseIntensity > 0) {
        int randN = 65536;
        if (!d_randStates || d_randCount < randN) {
            if (d_randStates) cudaFree(d_randStates);
            cudaMalloc(&d_randStates, randN * sizeof(curandState));
            kernelInitRand<<<(randN + 255) / 256, 256>>>(d_randStates, randN, 42 + params.frameNum);
            d_randCount = randN;
        }
        kernelNoise<<<(ySize + blk - 1) / blk, blk>>>(dY, w, h, params.noiseIntensity, d_randStates);
    }

    // Lens distortion (needs orig buffer) — Y + U + V planes
    if (params.lensDistortion) {
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelLensDistortion<<<grd2d, blk2d>>>(dY, d_origY, w, h, -0.003f, -0.001f);
        kernelLensDistortion<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, -0.003f, -0.001f);
        kernelLensDistortion<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, -0.003f, -0.001f);
    }

    // HDR
    if (params.hdr) {
        kernelHDR_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelHDR_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Color grading
    if (params.colorMode == 1) { // vibrant
        kernelColorVibrant_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelColorVibrant_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Glow
    if (params.glow) {
        kernelGlow_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelGlow_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Rotate — Y + U + V planes
    if (params.rotate != 0.0f) {
        float rad = -params.rotate * (float)M_PI / 180.0f;
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelRotate<<<grd2d, blk2d>>>(dY, d_origY, w, h, cosf(rad), sinf(rad));
        kernelRotate<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, cosf(rad), sinf(rad));
        kernelRotate<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, cosf(rad), sinf(rad));
    }

    // Chroma Shuffle (intensity-scaled)
    if (params.chromaShuffle > 0.0f) {
        float hueRad = (30.0f * params.chromaShuffle) * (float)M_PI / 180.0f;
        kernelChromaShuffle<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize, cosf(hueRad), sinf(hueRad));
    }

    // ── Advanced Anti-Detect ──

    // Frame Jitter: random ±1-2px shift per frame (Y + U + V)
    if (params.frameJitter > 0.0f) {
        unsigned int seed = (unsigned int)(params.frameNum * 7919 + 31337);
        seed ^= seed >> 16; seed *= 0x45d9f3b; seed ^= seed >> 16;
        int maxS = (int)roundf(5.0f * params.frameJitter); if (maxS < 1) maxS = 1;
        int dx = ((int)(seed % (unsigned)(maxS * 2 + 1))) - maxS;
        int dy = ((int)((seed >> 8) % (unsigned)(maxS * 2 + 1))) - maxS;
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelFrameJitter<<<grd2d, blk2d>>>(dY, d_origY, w, h, dx, dy);
        kernelFrameJitter<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, dx / 2, dy / 2);
        kernelFrameJitter<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, dx / 2, dy / 2);
    }

    // Gamma Shift: subtle gamma curve change (imperceptible)
    if (params.gammaShift > 0.0f) {
        float gamma = 1.0f + (0.08f * params.gammaShift) * sinf((float)params.frameNum * 0.1f);
        kernelGammaShift<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize, gamma);
    }

    // Micro Color Cycle: per-frame UV ±1-2 shift
    if (params.microColorCycle > 0.0f) {
        int uShift = (int)roundf(5.0f * params.microColorCycle * sinf((float)params.frameNum * 0.07f));
        int vShift = (int)roundf(5.0f * params.microColorCycle * cosf((float)params.frameNum * 0.11f));
        kernelMicroColorCycle<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize, uShift, vShift);
    }

    // DCT Noise: 8x8 block-position-dependent noise
    if (params.dctNoise > 0.0f) {
        kernelDctNoise<<<grd2d, blk2d>>>(dY, w, h, (int)params.frameNum);
    }

    // Zoom & Micro Zoom — Y + U + V planes
    float baseZ3 = (params.microZoom > 1.0f) ? params.microZoom : 1.0f;
    bool hasZoomAnim3 = (params.zoomIntensity > 1.0f);
    
    if (baseZ3 > 1.0f || hasZoomAnim3) {
        float zoom = baseZ3;
        if (hasZoomAnim3) {
            float targetZ = baseZ3 * params.zoomIntensity;
            float amp = targetZ - baseZ3;
            float t = (float)params.frameNum / 30.0f;
            
            float period = params.zoomPeriod > 0.0f ? params.zoomPeriod : 16.0f;
            float phase  = params.zoomPhase;
            float freq   = (float)M_PI * 2.0f / period;
            
            zoom = baseZ3 + amp * 0.5f * (1.0f - cosf(t * freq + phase));
        }
        if (zoom > 1.001f) {
            float invZoom = 1.0f / zoom;
            if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
            uint8_t* d_oU = d_origY + ySize;
            uint8_t* d_oV = d_oU + uvSize;
            cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
            cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
            cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
            kernelZoom<<<grd2d, blk2d>>>(dY, d_origY, w, h, invZoom);
            kernelZoom<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, invZoom);
            kernelZoom<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, invZoom);
        }
    }

    // Download packed → strided (single DMA per plane)
    cudaDeviceSynchronize();
    cudaError_t fxErr = cudaGetLastError();
    if (fxErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] Effects FAILED: %s → CPU fallback\n", cudaGetErrorString(fxErr));
        return false;
    }
    cudaMemcpy2D(Y, strideY, dY, w, w, h, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(U, strideUV, dU, cw, cw, ch, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(V, strideUV, dV, cw, cw, ch, cudaMemcpyDeviceToHost);

    return true;
}

// ═══════════════════════════════════════════════════
// PHASE 3: COMPOSITE FG ON BG
// ═══════════════════════════════════════════════════

__global__ void kernelComposite(uint8_t* bg, int bgW, const uint8_t* fg, int fgW, int fgH,
                                 int pasteX, int pasteY) {
    int fx = blockIdx.x * blockDim.x + threadIdx.x;
    int fy = blockIdx.y * blockDim.y + threadIdx.y;
    if (fx >= fgW || fy >= fgH) return;
    int bx = pasteX + fx, by = pasteY + fy;
    bg[by * bgW + bx] = fg[fy * fgW + fx];
}

bool cudaComposite(
    uint8_t* bgY, uint8_t* bgU, uint8_t* bgV,
    int bgW, int bgH, int bgStrideY, int bgStrideUV,
    const uint8_t* fgY, const uint8_t* fgU, const uint8_t* fgV,
    int fgW, int fgH, int fgStrideY, int fgStrideUV,
    int pasteX, int pasteY)
{
    if (!g_cudaAvailable) return false;
    for (int r = 0; r < fgH && (pasteY + r) < bgH; r++)
        memcpy(bgY + (pasteY + r) * bgStrideY + pasteX,
               fgY + r * fgStrideY, fgW);
    int cpx = pasteX/2, cpy = pasteY/2, cfw = fgW/2, cfh = fgH/2;
    for (int r = 0; r < cfh && (cpy + r) < bgH/2; r++) {
        memcpy(bgU + (cpy + r) * bgStrideUV + cpx, fgU + r * fgStrideUV, cfw);
        memcpy(bgV + (cpy + r) * bgStrideUV + cpx, fgV + r * fgStrideUV, cfw);
    }
    return true;
}

// ═══════════════════════════════════════════════════
// PHASE 4: ZERO-COPY GPU PIPELINE
// All operations stay in GPU device memory
// ═══════════════════════════════════════════════════

// ── NV12 → YUV420P conversion kernel ──
// NV12: Y plane (w*h) + interleaved UV plane (w * h/2, UVUVUV...)
// YUV420P: Y plane (w*h) + separate U (w/2 * h/2) + V (w/2 * h/2)
__global__ void kernelNV12toYUV420P_Y(uint8_t* dstY, const uint8_t* srcY,
                                       int w, int h, int srcStride, int dstStride) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= w || y >= h) return;
    dstY[y * dstStride + x] = srcY[y * srcStride + x];
}

__global__ void kernelNV12toYUV420P_UV(uint8_t* dstU, uint8_t* dstV,
                                        const uint8_t* srcUV, int cw, int ch,
                                        int srcStride, int dstStride) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= cw || y >= ch) return;
    dstU[y * dstStride + x] = srcUV[y * srcStride + x * 2];      // U
    dstV[y * dstStride + x] = srcUV[y * srcStride + x * 2 + 1];  // V
}

// ── YUV420P → NV12 conversion kernel ──
__global__ void kernelYUV420PtoNV12_UV(uint8_t* dstUV, const uint8_t* srcU,
                                        const uint8_t* srcV, int cw, int ch,
                                        int srcStride, int dstStride) {
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= cw || y >= ch) return;
    dstUV[y * dstStride + x * 2] = srcU[y * srcStride + x];      // U
    dstUV[y * dstStride + x * 2 + 1] = srcV[y * srcStride + x];  // V
}

// ── Composite kernel (device→device) ──
__global__ void kernelCompositeDevice(uint8_t* bg, int bgStride,
                                       const uint8_t* fg, int fgStride,
                                       int fgW, int fgH, int pasteX, int pasteY) {
    int fx = blockIdx.x * blockDim.x + threadIdx.x;
    int fy = blockIdx.y * blockDim.y + threadIdx.y;
    if (fx >= fgW || fy >= fgH) return;
    bg[(pasteY + fy) * bgStride + pasteX + fx] = fg[fy * fgStride + fx];
}

// ── CudaFrame allocation ──

CudaFrame* cudaFrameAlloc(int w, int h) {
    CudaFrame* f = new CudaFrame();
    f->w = w; f->h = h;
    f->strideY = w;     // packed (no padding)
    f->strideUV = w / 2;
    f->ownsMemory = true;

    int ySize = w * h;
    int uvSize = (w / 2) * (h / 2);
    cudaError_t err;
    err = cudaMalloc(&f->d_Y, ySize);
    if (err != cudaSuccess) { delete f; return nullptr; }
    err = cudaMalloc(&f->d_U, uvSize);
    if (err != cudaSuccess) { cudaFree(f->d_Y); delete f; return nullptr; }
    err = cudaMalloc(&f->d_V, uvSize);
    if (err != cudaSuccess) { cudaFree(f->d_Y); cudaFree(f->d_U); delete f; return nullptr; }

    // Zero-init
    cudaMemset(f->d_Y, 0, ySize);
    cudaMemset(f->d_U, 128, uvSize);
    cudaMemset(f->d_V, 128, uvSize);
    return f;
}

void cudaFrameFree(CudaFrame* frame) {
    if (!frame) return;
    if (frame->ownsMemory) {
        if (frame->d_Y) cudaFree(frame->d_Y);
        if (frame->d_U) cudaFree(frame->d_U);
        if (frame->d_V) cudaFree(frame->d_V);
    }
    delete frame;
}

// ── NV12 → YUV420P ──
bool cudaNV12toYUV420P(CudaFrame* dst,
                        const uint8_t* srcNV12_Y, int srcStrideY,
                        const uint8_t* srcNV12_UV, int srcStrideUV,
                        int srcW, int srcH) {
    if (!g_cudaAvailable || !dst) return false;
    dim3 blk(16, 16);
    dim3 grd((srcW + 15) / 16, (srcH + 15) / 16);
    kernelNV12toYUV420P_Y<<<grd, blk>>>(dst->d_Y, srcNV12_Y, srcW, srcH, srcStrideY, dst->strideY);

    int cw = srcW / 2, ch = srcH / 2;
    dim3 grdC((cw + 15) / 16, (ch + 15) / 16);
    kernelNV12toYUV420P_UV<<<grdC, blk>>>(dst->d_U, dst->d_V, srcNV12_UV, cw, ch, srcStrideUV, dst->strideUV);
    return true;
}

// ── YUV420P → NV12 ──
bool cudaYUV420PtoNV12(uint8_t* dstNV12_Y, int dstStrideY,
                        uint8_t* dstNV12_UV, int dstStrideUV,
                        const CudaFrame* src) {
    if (!g_cudaAvailable || !src) return false;
    int w = src->w, h = src->h;
    dim3 blk(16, 16);

    // Copy Y: just a strided copy
    dim3 grd((w + 15) / 16, (h + 15) / 16);
    kernelNV12toYUV420P_Y<<<grd, blk>>>(dstNV12_Y, src->d_Y, w, h, src->strideY, dstStrideY);

    // Merge U+V → interleaved UV
    int cw = w / 2, ch = h / 2;
    dim3 grdC((cw + 15) / 16, (ch + 15) / 16);
    kernelYUV420PtoNV12_UV<<<grdC, blk>>>(dstNV12_UV, src->d_U, src->d_V, cw, ch, src->strideUV, dstStrideUV);
    return true;
}

// ── Apply effects on device memory (no host transfer!) ──
bool cudaApplyEffectsDevice(CudaFrame* frame, const CudaEffectParams& params) {
    if (!g_cudaAvailable || !frame) return false;

    int w = frame->w, h = frame->h;
    int ySize = w * h;
    int cw = w / 2, ch = h / 2;
    int uvSize = cw * ch;
    uint8_t* dY = frame->d_Y;
    uint8_t* dU = frame->d_U;
    uint8_t* dV = frame->d_V;

    int blk = 256;
    dim3 blk2d(16, 16);
    dim3 grd2d((w + 15) / 16, (h + 15) / 16);

    // Mirror
    if (params.mirror) {
        kernelMirrorY<<<(h + blk - 1) / blk, blk>>>(dY, w, h);
        kernelMirrorUV<<<(ch + blk - 1) / blk, blk>>>(dU, dV, cw, ch);
    }

    // Noise
    if (params.noise && params.noiseIntensity > 0) {
        int randN = 65536;
        if (!d_randStates || d_randCount < randN) {
            if (d_randStates) cudaFree(d_randStates);
            cudaMalloc(&d_randStates, randN * sizeof(curandState));
            kernelInitRand<<<(randN + 255) / 256, 256>>>(d_randStates, randN, 42 + params.frameNum);
            d_randCount = randN;
        }
        kernelNoise<<<(ySize + blk - 1) / blk, blk>>>(dY, w, h, params.noiseIntensity, d_randStates);
    }

    // Lens distortion — Y + U + V planes
    if (params.lensDistortion) {
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelLensDistortion<<<grd2d, blk2d>>>(dY, d_origY, w, h, -0.003f, -0.001f);
        dim3 grd2dC((cw + 15) / 16, (ch + 15) / 16);
        kernelLensDistortion<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, -0.003f, -0.001f);
        kernelLensDistortion<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, -0.003f, -0.001f);
    }

    // HDR
    if (params.hdr) {
        kernelHDR_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelHDR_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Color grading
    if (params.colorMode == 1) {
        kernelColorVibrant_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelColorVibrant_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Glow
    if (params.glow) {
        kernelGlow_Y<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize);
        kernelGlow_UV<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize);
    }

    // Rotate — Y + U + V planes
    if (params.rotate != 0.0f) {
        float rad = -params.rotate * (float)M_PI / 180.0f;
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelRotate<<<grd2d, blk2d>>>(dY, d_origY, w, h, cosf(rad), sinf(rad));
        dim3 grd2dC((cw + 15) / 16, (ch + 15) / 16);
        kernelRotate<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, cosf(rad), sinf(rad));
        kernelRotate<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, cosf(rad), sinf(rad));
    }

    // Chroma Shuffle (intensity-scaled)
    if (params.chromaShuffle > 0.0f) {
        float hueRad = (30.0f * params.chromaShuffle) * (float)M_PI / 180.0f;
        kernelChromaShuffle<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize, cosf(hueRad), sinf(hueRad));
    }

    // ── Advanced Anti-Detect ──

    // Frame Jitter: random ±1-2px shift per frame (Y + U + V)
    if (params.frameJitter > 0.0f) {
        unsigned int seed = (unsigned int)(params.frameNum * 7919 + 31337);
        seed ^= seed >> 16; seed *= 0x45d9f3b; seed ^= seed >> 16;
        int maxS = (int)roundf(5.0f * params.frameJitter); if (maxS < 1) maxS = 1;
        int dx = ((int)(seed % (unsigned)(maxS * 2 + 1))) - maxS;
        int dy = ((int)((seed >> 8) % (unsigned)(maxS * 2 + 1))) - maxS;
        if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
        uint8_t* d_oU = d_origY + ySize;
        uint8_t* d_oV = d_oU + uvSize;
        cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
        cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
        kernelFrameJitter<<<grd2d, blk2d>>>(dY, d_origY, w, h, dx, dy);
        dim3 grd2dC((cw + 15) / 16, (ch + 15) / 16);
        kernelFrameJitter<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, dx / 2, dy / 2);
        kernelFrameJitter<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, dx / 2, dy / 2);
    }

    // Gamma Shift: subtle gamma curve change (imperceptible)
    if (params.gammaShift > 0.0f) {
        float gamma = 1.0f + (0.08f * params.gammaShift) * sinf((float)params.frameNum * 0.1f);
        kernelGammaShift<<<(ySize + blk - 1) / blk, blk>>>(dY, ySize, gamma);
    }

    // Micro Color Cycle: per-frame UV ±1-2 shift
    if (params.microColorCycle > 0.0f) {
        int uShift = (int)roundf(5.0f * params.microColorCycle * sinf((float)params.frameNum * 0.07f));
        int vShift = (int)roundf(5.0f * params.microColorCycle * cosf((float)params.frameNum * 0.11f));
        kernelMicroColorCycle<<<(uvSize + blk - 1) / blk, blk>>>(dU, dV, uvSize, uShift, vShift);
    }

    // DCT Noise: 8x8 block-position-dependent noise
    if (params.dctNoise > 0.0f) {
        kernelDctNoise<<<grd2d, blk2d>>>(dY, w, h, (int)params.frameNum);
    }

    // Zoom & Micro Zoom — Y + U + V planes
    float baseZ4 = (params.microZoom > 1.0f) ? params.microZoom : 1.0f;
    bool hasZoomAnim4 = (params.zoomIntensity > 1.0f);
    
    if (baseZ4 > 1.0f || hasZoomAnim4) {
        float zoom = baseZ4;
        if (hasZoomAnim4) {
            float targetZ = baseZ4 * params.zoomIntensity;
            float amp = targetZ - baseZ4;
            float t = (float)params.frameNum / 30.0f;
            
            float period = params.zoomPeriod > 0.0f ? params.zoomPeriod : 16.0f;
            float phase  = params.zoomPhase;
            float freq   = (float)M_PI * 2.0f / period;
            
            zoom = baseZ4 + amp * 0.5f * (1.0f - cosf(t * freq + phase));
        }
        if (zoom > 1.001f) {
            float invZoom = 1.0f / zoom;
            if (!ensureDevMem(d_origY, d_origSize, ySize + uvSize * 2)) return false;
            uint8_t* d_oU = d_origY + ySize;
            uint8_t* d_oV = d_oU + uvSize;
            cudaMemcpy(d_origY, dY, ySize, cudaMemcpyDeviceToDevice);
            cudaMemcpy(d_oU, dU, uvSize, cudaMemcpyDeviceToDevice);
            cudaMemcpy(d_oV, dV, uvSize, cudaMemcpyDeviceToDevice);
            kernelZoom<<<grd2d, blk2d>>>(dY, d_origY, w, h, invZoom);
            dim3 grd2dC((cw + 15) / 16, (ch + 15) / 16);
            kernelZoom<<<grd2dC, blk2d>>>(dU, d_oU, cw, ch, invZoom);
            kernelZoom<<<grd2dC, blk2d>>>(dV, d_oV, cw, ch, invZoom);
        }
    }

    return true;
}

// ── BG Blur on device memory (optimized: 0.125x + 2-pass) ──
bool cudaBgBlurDevice(CudaFrame* outBg, const CudaFrame* src,
                       int outW, int outH, int blurAmount) {
    if (!g_cudaAvailable || !outBg || !src) return false;

    // Ultra-small blur frame (0.125x = 64x fewer pixels than full res)
    int smallW = ((int)(outW * 0.125) / 2) * 2;
    int smallH = ((int)(outH * 0.125) / 2) * 2;
    if (smallW < 4) smallW = 4;
    if (smallH < 4) smallH = 4;
    int cSmallW = smallW / 2, cSmallH = smallH / 2;

    size_t smallBytes = smallW * smallH + cSmallW * cSmallH * 2;
    if (!ensureDevMem(d_tmpY, d_tmpSize, smallBytes * 2)) return false;
    uint8_t* sY = d_tmpY;
    uint8_t* sU = sY + smallW * smallH;
    uint8_t* sV = sU + cSmallW * cSmallH;
    uint8_t* t2Y = d_tmpY + smallBytes;
    uint8_t* t2U = t2Y + smallW * smallH;
    uint8_t* t2V = t2U + cSmallW * cSmallH;

    dim3 blkS(16, 16);

    // Downscale src → small
    dim3 grdS((smallW + 15) / 16, (smallH + 15) / 16);
    kernelBilinearScale<<<grdS, blkS>>>(sY, smallW, smallH, src->d_Y, src->w, src->h);
    dim3 grdSC((cSmallW + 15) / 16, (cSmallH + 15) / 16);
    kernelBilinearScale<<<grdSC, blkS>>>(sU, cSmallW, cSmallH, src->d_U, src->w/2, src->h/2);
    kernelBilinearScale<<<grdSC, blkS>>>(sV, cSmallW, cSmallH, src->d_V, src->w/2, src->h/2);

    // 2-pass box blur (sufficient at 0.125x resolution)
    int radius = blurAmount / 16;  // smaller radius for smaller frame
    if (radius < 1) radius = 1;
    if (radius > smallW / 4) radius = smallW / 4;
    int cr = radius / 2; if (cr < 1) cr = 1;
    int bb = 256;

    for (int pass = 0; pass < 2; pass++) {
        kernelBoxBlurH<<<(smallH + bb - 1) / bb, bb>>>(t2Y, sY, smallW, smallH, radius);
        kernelBoxBlurH<<<(cSmallH + bb - 1) / bb, bb>>>(t2U, sU, cSmallW, cSmallH, cr);
        kernelBoxBlurH<<<(cSmallH + bb - 1) / bb, bb>>>(t2V, sV, cSmallW, cSmallH, cr);
        kernelBoxBlurV<<<(smallW + bb - 1) / bb, bb>>>(sY, t2Y, smallW, smallH, radius);
        kernelBoxBlurV<<<(cSmallW + bb - 1) / bb, bb>>>(sU, t2U, cSmallW, cSmallH, cr);
        kernelBoxBlurV<<<(cSmallW + bb - 1) / bb, bb>>>(sV, t2V, cSmallW, cSmallH, cr);
    }

    // Brightness + saturation
    int totalPx = smallW * smallH;
    kernelBrightSat<<<(totalPx + 255) / 256, 256>>>(sY, sU, sV, smallW, smallH, -0.35f, 1.2f);

    // Upscale to output
    dim3 grdO((outW + 15) / 16, (outH + 15) / 16);
    kernelBilinearScale<<<grdO, blkS>>>(outBg->d_Y, outW, outH, sY, smallW, smallH);
    dim3 grdOC((outW/2 + 15) / 16, (outH/2 + 15) / 16);
    kernelBilinearScale<<<grdOC, blkS>>>(outBg->d_U, outW/2, outH/2, sU, cSmallW, cSmallH);
    kernelBilinearScale<<<grdOC, blkS>>>(outBg->d_V, outW/2, outH/2, sV, cSmallW, cSmallH);

    return true;
}

// ── Composite device→device ──
bool cudaCompositeDevice(CudaFrame* bg, const CudaFrame* fg, int pasteX, int pasteY) {
    if (!g_cudaAvailable || !bg || !fg) return false;
    int fgW = fg->w, fgH = fg->h;
    dim3 blk(16, 16);
    dim3 grd((fgW + 15) / 16, (fgH + 15) / 16);

    kernelCompositeDevice<<<grd, blk>>>(bg->d_Y, bg->strideY, fg->d_Y, fg->strideY, fgW, fgH, pasteX, pasteY);
    int cfw = fgW/2, cfh = fgH/2, cpx = pasteX/2, cpy = pasteY/2;
    dim3 grdC((cfw + 15) / 16, (cfh + 15) / 16);
    kernelCompositeDevice<<<grdC, blk>>>(bg->d_U, bg->strideUV, fg->d_U, fg->strideUV, cfw, cfh, cpx, cpy);
    kernelCompositeDevice<<<grdC, blk>>>(bg->d_V, bg->strideUV, fg->d_V, fg->strideUV, cfw, cfh, cpx, cpy);
    return true;
}

// ── Scale device→device (bilinear) ──
bool cudaScaleDevice(CudaFrame* dst, const CudaFrame* src) {
    if (!g_cudaAvailable || !dst || !src) return false;
    dim3 blk(16, 16);
    dim3 grd((dst->w + 15) / 16, (dst->h + 15) / 16);
    kernelBilinearScale<<<grd, blk>>>(dst->d_Y, dst->w, dst->h, src->d_Y, src->w, src->h);
    dim3 grdC((dst->w/2 + 15) / 16, (dst->h/2 + 15) / 16);
    kernelBilinearScale<<<grdC, blk>>>(dst->d_U, dst->w/2, dst->h/2, src->d_U, src->w/2, src->h/2);
    kernelBilinearScale<<<grdC, blk>>>(dst->d_V, dst->w/2, dst->h/2, src->d_V, src->w/2, src->h/2);
    return true;
}

// ── Upload host → device ──
bool cudaUploadFrame(CudaFrame* dst,
                      const uint8_t* srcY, const uint8_t* srcU, const uint8_t* srcV,
                      int srcW, int srcH, int srcStrideY, int srcStrideUV) {
    if (!g_cudaAvailable || !dst) return false;
    for (int r = 0; r < srcH; r++)
        cudaMemcpy(dst->d_Y + r * dst->strideY, srcY + r * srcStrideY, srcW, cudaMemcpyHostToDevice);
    int cw = srcW / 2, ch = srcH / 2;
    for (int r = 0; r < ch; r++) {
        cudaMemcpy(dst->d_U + r * dst->strideUV, srcU + r * srcStrideUV, cw, cudaMemcpyHostToDevice);
        cudaMemcpy(dst->d_V + r * dst->strideUV, srcV + r * srcStrideUV, cw, cudaMemcpyHostToDevice);
    }
    return true;
}

// ── Download device → host ──
bool cudaDownloadFrame(uint8_t* dstY, uint8_t* dstU, uint8_t* dstV,
                        int dstStrideY, int dstStrideUV,
                        const CudaFrame* src) {
    if (!g_cudaAvailable || !src) return false;
    cudaDeviceSynchronize();
    cudaError_t dlErr = cudaGetLastError();
    if (dlErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] Download FAILED: %s\n", cudaGetErrorString(dlErr));
        return false;
    }
    for (int r = 0; r < src->h; r++)
        cudaMemcpy(dstY + r * dstStrideY, src->d_Y + r * src->strideY, src->w, cudaMemcpyDeviceToHost);
    int cw = src->w / 2, ch = src->h / 2;
    for (int r = 0; r < ch; r++) {
        cudaMemcpy(dstU + r * dstStrideUV, src->d_U + r * src->strideUV, cw, cudaMemcpyDeviceToHost);
        cudaMemcpy(dstV + r * dstStrideUV, src->d_V + r * src->strideUV, cw, cudaMemcpyDeviceToHost);
    }
    return true;
}

// ═══════════════════════════════════════════════════
// SUBTITLE GPU CACHE — pre-render once, blend every frame
// ═══════════════════════════════════════════════════

// Alpha blend kernel for Y plane (full resolution) + yOffset
// yOffset: shift subtitle source reading (positive = subtitle appears lower)
__global__ void kernelSubAlphaBlendY(
    uint8_t* frameY, int frameStride,
    const uint8_t* subY, const uint8_t* alpha,
    int w, int h, int fadeAlpha8, int yOffset)
{
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= w || y >= h) return;

    // Source Y in subtitle texture (shifted by yOffset)
    int sy = y - yOffset;
    if (sy < 0 || sy >= h) return;  // out of subtitle bounds

    int fidx = y * frameStride + x;
    int sidx = sy * w + x;

    int a = (alpha[sidx] * fadeAlpha8) >> 8;  // combined alpha
    if (a == 0) return;  // fully transparent — skip (most pixels!)
    
    int inv = 255 - a;
    frameY[fidx] = (uint8_t)((subY[sidx] * a + frameY[fidx] * inv + 128) >> 8);
}

// Alpha blend kernel for U/V planes (half resolution) + yOffset
__global__ void kernelSubAlphaBlendUV(
    uint8_t* frameU, uint8_t* frameV, int frameStride,
    const uint8_t* subU, const uint8_t* subV, const uint8_t* alpha,
    int cw, int ch, int fullW, int fadeAlpha8, int yOffset)
{
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= cw || y >= ch) return;

    // Half-res yOffset
    int syHalf = y - yOffset / 2;
    if (syHalf < 0 || syHalf >= ch) return;

    int fidx = y * frameStride + x;
    int sidx = syHalf * cw + x;

    // Sample alpha from full-res (2x2 average for chroma)
    int ax = x * 2, ay = (y - yOffset / 2) * 2 + yOffset;
    if (ay < 0 || ay >= ch * 2) return;
    int syFull = ay;
    int a00 = alpha[syFull * fullW + ax];
    int a01 = (ax + 1 < fullW) ? alpha[syFull * fullW + ax + 1] : a00;
    int a10 = (syFull + 1 < (ch * 2)) ? alpha[(syFull + 1) * fullW + ax] : a00;
    int a11 = ((ax + 1 < fullW) && (syFull + 1 < (ch * 2))) ? alpha[(syFull + 1) * fullW + ax + 1] : a00;
    int a = ((a00 + a01 + a10 + a11 + 2) / 4 * fadeAlpha8) >> 8;
    
    if (a == 0) return;
    int inv = 255 - a;
    frameU[fidx] = (uint8_t)((subU[sidx] * a + frameU[fidx] * inv + 128) >> 8);
    frameV[fidx] = (uint8_t)((subV[sidx] * a + frameV[fidx] * inv + 128) >> 8);
}

CudaSubCache* cudaSubCacheCreate() {
    CudaSubCache* c = new CudaSubCache();
    c->d_subY = c->d_subU = c->d_subV = c->d_alpha = nullptr;
    c->w = c->h = 0;
    c->valid = false;
    return c;
}

void cudaSubCacheDestroy(CudaSubCache* c) {
    if (!c) return;
    if (c->d_subY) cudaFree(c->d_subY);
    if (c->d_subU) cudaFree(c->d_subU);
    if (c->d_subV) cudaFree(c->d_subV);
    if (c->d_alpha) cudaFree(c->d_alpha);
    delete c;
}

bool cudaSubCacheUpload(CudaSubCache* cache,
                         const uint8_t* subY, const uint8_t* subU, const uint8_t* subV,
                         int w, int h, int strideY, int strideUV) {
    if (!g_cudaAvailable || !cache) return false;
    int cw = w / 2, ch = h / 2;
    
    // Reallocate if dimensions changed
    if (cache->w != w || cache->h != h) {
        if (cache->d_subY) cudaFree(cache->d_subY);
        if (cache->d_subU) cudaFree(cache->d_subU);
        if (cache->d_subV) cudaFree(cache->d_subV);
        if (cache->d_alpha) cudaFree(cache->d_alpha);
        
        cudaMalloc(&cache->d_subY, w * h);
        cudaMalloc(&cache->d_subU, cw * ch);
        cudaMalloc(&cache->d_subV, cw * ch);
        cudaMalloc(&cache->d_alpha, w * h);
        cache->w = w;
        cache->h = h;
    }
    
    // Compute alpha mask: |subY - 128| (rendered on gray Y=128 baseline)
    uint8_t* alphaBuf = (uint8_t*)malloc(w * h);
    if (!alphaBuf) return false;
    for (int r = 0; r < h; r++) {
        for (int c = 0; c < w; c++) {
            int subPx = subY[r * strideY + c];
            int diff = abs(subPx - 128);
            alphaBuf[r * w + c] = (diff > 4) ? (uint8_t)(diff < 64 ? diff * 4 : 255) : 0;
        }
    }
    
    // Upload subtitle YUV + alpha to GPU
    cudaMemcpy2D(cache->d_subY, w, subY, strideY, w, h, cudaMemcpyHostToDevice);
    cudaMemcpy2D(cache->d_subU, cw, subU, strideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy2D(cache->d_subV, cw, subV, strideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy(cache->d_alpha, alphaBuf, w * h, cudaMemcpyHostToDevice);
    
    free(alphaBuf);
    cache->valid = true;
    
    fprintf(stderr, "[SUB-CUDA] Uploaded subtitle texture %dx%d to GPU\n", w, h);
    return true;
}

bool cudaSubOverlay(uint8_t* frameY, uint8_t* frameU, uint8_t* frameV,
                     int frameW, int frameH, int strideY, int strideUV,
                     const CudaSubCache* cache, float fadeAlpha, int yOffset) {
    if (!g_cudaAvailable || !cache || !cache->valid) return false;
    if (cache->w != frameW || cache->h != frameH) return false;
    
    int fadeAlpha8 = (int)(fadeAlpha * 255);
    if (fadeAlpha8 <= 0) return true;  // fully transparent, skip
    if (fadeAlpha8 > 255) fadeAlpha8 = 255;
    
    int cw = frameW / 2, ch = frameH / 2;
    
    // Upload video frame to GPU
    static uint8_t* d_fY = nullptr;
    static uint8_t* d_fU = nullptr;
    static uint8_t* d_fV = nullptr;
    static size_t d_fSize = 0;
    
    size_t needed = frameW * frameH + cw * ch * 2;
    if (d_fSize < needed) {
        if (d_fY) cudaFree(d_fY);
        cudaMalloc(&d_fY, needed);
        d_fU = d_fY + frameW * frameH;
        d_fV = d_fU + cw * ch;
        d_fSize = needed;
    }
    
    // Batch upload frame
    cudaMemcpy2D(d_fY, frameW, frameY, strideY, frameW, frameH, cudaMemcpyHostToDevice);
    cudaMemcpy2D(d_fU, cw, frameU, strideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy2D(d_fV, cw, frameV, strideUV, cw, ch, cudaMemcpyHostToDevice);
    
    // Launch blend kernels with yOffset
    dim3 blk(16, 16);
    dim3 grdY((frameW + 15) / 16, (frameH + 15) / 16);
    dim3 grdUV((cw + 15) / 16, (ch + 15) / 16);
    
    kernelSubAlphaBlendY<<<grdY, blk>>>(d_fY, frameW, cache->d_subY, cache->d_alpha,
                                         frameW, frameH, fadeAlpha8, yOffset);
    kernelSubAlphaBlendUV<<<grdUV, blk>>>(d_fU, d_fV, cw, cache->d_subU, cache->d_subV,
                                           cache->d_alpha, cw, ch, frameW, fadeAlpha8, yOffset);
    
    // Download result back
    cudaDeviceSynchronize();
    cudaError_t subErr = cudaGetLastError();
    if (subErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] Subtitle composite FAILED: %s\n", cudaGetErrorString(subErr));
        return false;
    }
    cudaMemcpy2D(frameY, strideY, d_fY, frameW, frameW, frameH, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(frameU, strideUV, d_fU, cw, cw, ch, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(frameV, strideUV, d_fV, cw, cw, ch, cudaMemcpyDeviceToHost);
    
    return true;
}

// ═══════════════════════════════════════════════════
// CUDA KEN BURNS: RGB CROP+SCALE → YUV420P
// Upload RGB once per image, GPU crop+scale+convert per frame
// ═══════════════════════════════════════════════════

static uint8_t* d_kenRgb = nullptr;   // GPU RGB source buffer
static size_t d_kenRgbSize = 0;
static int d_kenW = 0, d_kenH = 0;

// Device buffers for output YUV (cached)
static uint8_t* d_kenOutY = nullptr;
static uint8_t* d_kenOutU = nullptr;
static uint8_t* d_kenOutV = nullptr;
static size_t d_kenOutSize = 0;

// Y plane kernel: each thread = one output Y pixel
// Bilinear sample from RGB source crop, convert to Y (BT.601)
__global__ void kernelKenBurnsY(
    uint8_t* outY, int outW, int outH,
    const uint8_t* rgb, int rgbW, int rgbH,
    float sx, float sy, float sw, float sh)
{
    int ox = blockIdx.x * blockDim.x + threadIdx.x;
    int oy = blockIdx.y * blockDim.y + threadIdx.y;
    if (ox >= outW || oy >= outH) return;

    // Map output pixel to source crop region (float precision)
    float srcX = sx + ((float)ox + 0.5f) * sw / outW - 0.5f;
    float srcY = sy + ((float)oy + 0.5f) * sh / outH - 0.5f;

    // Bilinear interpolation
    int ix = (int)floorf(srcX);
    int iy = (int)floorf(srcY);
    float fx = srcX - ix;
    float fy = srcY - iy;

    // Clamp to image bounds
    int ix0 = max(0, min(ix, rgbW - 1));
    int iy0 = max(0, min(iy, rgbH - 1));
    int ix1 = max(0, min(ix + 1, rgbW - 1));
    int iy1 = max(0, min(iy + 1, rgbH - 1));

    // Read 4 RGB pixels (3 bytes each)
    const uint8_t* p00 = rgb + (iy0 * rgbW + ix0) * 3;
    const uint8_t* p10 = rgb + (iy0 * rgbW + ix1) * 3;
    const uint8_t* p01 = rgb + (iy1 * rgbW + ix0) * 3;
    const uint8_t* p11 = rgb + (iy1 * rgbW + ix1) * 3;

    // Bilinear interpolate R, G, B
    float w00 = (1 - fx) * (1 - fy);
    float w10 = fx * (1 - fy);
    float w01 = (1 - fx) * fy;
    float w11 = fx * fy;

    float R = p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11;
    float G = p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11;
    float B = p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11;

    // RGB → Y (BT.601)
    float Y = 16.0f + 0.257f * R + 0.504f * G + 0.098f * B;
    outY[oy * outW + ox] = (uint8_t)fminf(235.0f, fmaxf(16.0f, Y));
}

// UV plane kernel: each thread = one output UV pixel (2x2 luma block)
// Average 4 luma positions for chroma subsampling
__global__ void kernelKenBurnsUV(
    uint8_t* outU, uint8_t* outV, int outCW, int outCH,
    const uint8_t* rgb, int rgbW, int rgbH,
    float sx, float sy, float sw, float sh, int outW, int outH)
{
    int cx = blockIdx.x * blockDim.x + threadIdx.x;
    int cy = blockIdx.y * blockDim.y + threadIdx.y;
    if (cx >= outCW || cy >= outCH) return;

    // Center of 2x2 luma block
    float centerOX = cx * 2.0f + 1.0f;
    float centerOY = cy * 2.0f + 1.0f;

    // Map to source
    float srcX = sx + centerOX * sw / outW - 0.5f;
    float srcY = sy + centerOY * sh / outH - 0.5f;

    int ix = (int)floorf(srcX);
    int iy = (int)floorf(srcY);
    float fx = srcX - ix;
    float fy = srcY - iy;

    int ix0 = max(0, min(ix, rgbW - 1));
    int iy0 = max(0, min(iy, rgbH - 1));
    int ix1 = max(0, min(ix + 1, rgbW - 1));
    int iy1 = max(0, min(iy + 1, rgbH - 1));

    const uint8_t* p00 = rgb + (iy0 * rgbW + ix0) * 3;
    const uint8_t* p10 = rgb + (iy0 * rgbW + ix1) * 3;
    const uint8_t* p01 = rgb + (iy1 * rgbW + ix0) * 3;
    const uint8_t* p11 = rgb + (iy1 * rgbW + ix1) * 3;

    float w00 = (1 - fx) * (1 - fy);
    float w10 = fx * (1 - fy);
    float w01 = (1 - fx) * fy;
    float w11 = fx * fy;

    float R = p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11;
    float G = p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11;
    float B = p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11;

    // RGB → U, V (BT.601)
    float U = 128.0f - 0.148f * R - 0.291f * G + 0.439f * B;
    float V = 128.0f + 0.439f * R - 0.368f * G - 0.071f * B;
    outU[cy * outCW + cx] = (uint8_t)fminf(240.0f, fmaxf(16.0f, U));
    outV[cy * outCW + cx] = (uint8_t)fminf(240.0f, fmaxf(16.0f, V));
}

bool cudaKenBurnsUpload(const uint8_t* rgbData, int rgbW, int rgbH) {
    if (!g_cudaAvailable) return false;

    size_t needed = (size_t)rgbW * rgbH * 3;
    if (d_kenRgbSize < needed) {
        if (d_kenRgb) cudaFree(d_kenRgb);
        cudaError_t err = cudaMalloc(&d_kenRgb, needed);
        if (err != cudaSuccess) { d_kenRgb = nullptr; d_kenRgbSize = 0; return false; }
        d_kenRgbSize = needed;
    }

    cudaMemcpy(d_kenRgb, rgbData, needed, cudaMemcpyHostToDevice);
    d_kenW = rgbW;
    d_kenH = rgbH;
    return true;
}

bool cudaKenBurnsFrame(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outW, int outH, int outStrideY, int outStrideUV,
    float fsx, float fsy, float fsw, float fsh)
{
    if (!g_cudaAvailable || !d_kenRgb) return false;

    int outCW = outW / 2, outCH = outH / 2;
    size_t ySize = outW * outH;
    size_t uvSize = outCW * outCH;
    size_t needed = ySize + uvSize * 2;

    if (d_kenOutSize < needed) {
        if (d_kenOutY) cudaFree(d_kenOutY);
        if (d_kenOutU) cudaFree(d_kenOutU);
        if (d_kenOutV) cudaFree(d_kenOutV);
        cudaMalloc(&d_kenOutY, ySize);
        cudaMalloc(&d_kenOutU, uvSize);
        cudaMalloc(&d_kenOutV, uvSize);
        d_kenOutSize = needed;
    }

    // Launch Y kernel (one thread per output pixel)
    dim3 blk(16, 16);
    dim3 grdY((outW + 15) / 16, (outH + 15) / 16);
    kernelKenBurnsY<<<grdY, blk>>>(d_kenOutY, outW, outH,
                                    d_kenRgb, d_kenW, d_kenH,
                                    fsx, fsy, fsw, fsh);

    // Launch UV kernel (one thread per 2x2 output block)
    dim3 grdUV((outCW + 15) / 16, (outCH + 15) / 16);
    kernelKenBurnsUV<<<grdUV, blk>>>(d_kenOutU, d_kenOutV, outCW, outCH,
                                      d_kenRgb, d_kenW, d_kenH,
                                      fsx, fsy, fsw, fsh, outW, outH);

    // Download YUV planes to host (strided)
    cudaDeviceSynchronize();
    cudaError_t kbErr = cudaGetLastError();
    if (kbErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] KenBurns FAILED: %s\n", cudaGetErrorString(kbErr));
        return false;
    }
    cudaMemcpy2D(outY, outStrideY, d_kenOutY, outW, outW, outH, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outU, outStrideUV, d_kenOutU, outCW, outCW, outCH, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outV, outStrideUV, d_kenOutV, outCW, outCW, outCH, cudaMemcpyDeviceToHost);

    return true;
}

void cudaKenBurnsCleanup() {
    if (d_kenRgb) { cudaFree(d_kenRgb); d_kenRgb = nullptr; d_kenRgbSize = 0; }
    if (d_kenOutY) { cudaFree(d_kenOutY); d_kenOutY = nullptr; }
    if (d_kenOutU) { cudaFree(d_kenOutU); d_kenOutU = nullptr; }
    if (d_kenOutV) { cudaFree(d_kenOutV); d_kenOutV = nullptr; }
    d_kenOutSize = 0;
    d_kenW = d_kenH = 0;
}

// ═══════════════════════════════════════════════════
// TRANSITION BLENDING — GPU pixel operations
// ═══════════════════════════════════════════════════

// Transition type IDs (must match merging.h TransitionType enum)
#define T_NONE         0
#define T_DISSOLVE     1
#define T_FADE         2
#define T_FADEBLACK    3
#define T_FADEWHITE    4
#define T_FADEGRAYS    5
#define T_FADEFAST     6
#define T_FADESLOW     7
#define T_SMOOTHLEFT   8
#define T_SMOOTHRIGHT   9
#define T_SMOOTHUP     10
#define T_SMOOTHDOWN   11
#define T_WIPELEFT     12
#define T_WIPERIGHT    13
#define T_WIPEUP       14
#define T_WIPEDOWN     15
#define T_WIPETL       16
#define T_WIPETR       17
#define T_WIPEBL       18
#define T_WIPEBR       19
#define T_SLIDELEFT    20
#define T_SLIDERIGHT   21
#define T_SLIDEUP      22
#define T_SLIDEDOWN    23
#define T_COVERLEFT    24
#define T_COVERRIGHT   25
#define T_COVERUP      26
#define T_COVERDOWN    27
#define T_REVEALLEFT   28
#define T_REVEALRIGHT  29
#define T_REVEALUP     30
#define T_REVEALDOWN   31
#define T_CIRCLEOPEN   32
#define T_CIRCLECLOSE  33
#define T_CIRCLECROP   34
#define T_RECTCROP     35
#define T_RADIAL       36
#define T_HORZOPEN     37
#define T_HORZCLOSE    38
#define T_VERTOPEN     39
#define T_VERTCLOSE    40
#define T_HLSLICE      41
#define T_HRSLICE      42
#define T_VUSLICE      43
#define T_VDSLICE      44
#define T_HLWIND       45
#define T_HRWIND       46
#define T_VUWIND       47
#define T_VDWIND       48
#define T_PIXELIZE     49
#define T_ZOOMIN       50
#define T_HBLUR        51
#define T_DISTANCE     52
#define T_SQUEEZEH     53
#define T_SQUEEZEV     54
#define T_DIAGTL       55
#define T_DIAGTR       56
#define T_DIAGBL       57
#define T_DIAGBR       58

// GPU smoothstep
__device__ float d_smoothstep(float edge0, float edge1, float x) {
    float t = fminf(fmaxf((x - edge0) / (edge1 - edge0), 0.0f), 1.0f);
    return t * t * (3.0f - 2.0f * t);
}

// Main transition kernel — Y plane (full resolution)
__global__ void kernelTransBlendY(
    uint8_t* out, const uint8_t* A, const uint8_t* B,
    int w, int h, float t, int transType)
{
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= w || y >= h) return;

    int idx = y * w + x;
    float a = A[idx], b = B[idx];
    float nx = (float)x / w;  // normalized 0..1
    float ny = (float)y / h;
    float result;

    switch (transType) {
    case T_DISSOLVE: default:
        result = a * (1 - t) + b * t;
        break;
    case T_FADE: case T_FADEBLACK:
        result = t < 0.5f ? a * (1 - 2*t) : b * (2*t - 1);
        break;
    case T_FADEWHITE:
        result = t < 0.5f ? a + (255 - a) * (2*t) : 255 - (255 - b) * (2*t - 1) / 1.0f;
        if (t < 0.5f) result = a * (1 - 2*t) + 255 * (2*t);
        else result = 255 * (1 - (2*t-1)) + b * (2*t-1);
        break;
    case T_FADEGRAYS: {
        // Y plane is already grayscale — dissolve through mid-gray (128)
        float midgray = 128.0f;
        result = t < 0.5f ? a * (1 - 2*t) + midgray * (2*t)
                          : midgray * (1 - (2*t-1)) + b * (2*t-1);
        break;
    }
    case T_FADEFAST:
        result = a * (1 - t*t) + b * (t*t); // ease-in quadratic
        break;
    case T_FADESLOW: {
        float st = sqrtf(t); // ease-out
        result = a * (1 - st) + b * st;
        break;
    }
    // ── Smooth (eased wipes) ──
    case T_SMOOTHLEFT: {
        float edge = 1.0f - d_smoothstep(t - 0.1f, t + 0.1f, nx);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_SMOOTHRIGHT: {
        float edge = 1.0f - d_smoothstep(t - 0.1f, t + 0.1f, 1 - nx);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_SMOOTHUP: {
        float edge = 1.0f - d_smoothstep(t - 0.1f, t + 0.1f, ny);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_SMOOTHDOWN: {
        float edge = 1.0f - d_smoothstep(t - 0.1f, t + 0.1f, 1 - ny);
        result = a * (1 - edge) + b * edge;
        break;
    }
    // ── Hard wipes ──
    case T_WIPELEFT:  result = nx < t ? b : a; break;
    case T_WIPERIGHT: result = (1 - nx) < t ? b : a; break;
    case T_WIPEUP:    result = ny < t ? b : a; break;
    case T_WIPEDOWN:  result = (1 - ny) < t ? b : a; break;
    case T_WIPETL:    result = (nx + ny) / 2 < t ? b : a; break;
    case T_WIPETR:    result = ((1-nx) + ny) / 2 < t ? b : a; break;
    case T_WIPEBL:    result = (nx + (1-ny)) / 2 < t ? b : a; break;
    case T_WIPEBR:    result = ((1-nx) + (1-ny)) / 2 < t ? b : a; break;
    // ── Diagonal wipes ──
    case T_DIAGTL: {
        float d = (nx + ny) / 2.0f;
        float edge = 1.0f - d_smoothstep(t - 0.05f, t + 0.05f, d);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_DIAGTR: {
        float d = ((1-nx) + ny) / 2.0f;
        float edge = 1.0f - d_smoothstep(t - 0.05f, t + 0.05f, d);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_DIAGBL: {
        float d = (nx + (1-ny)) / 2.0f;
        float edge = 1.0f - d_smoothstep(t - 0.05f, t + 0.05f, d);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_DIAGBR: {
        float d = ((1-nx) + (1-ny)) / 2.0f;
        float edge = 1.0f - d_smoothstep(t - 0.05f, t + 0.05f, d);
        result = a * (1 - edge) + b * edge;
        break;
    }
    // ── Slides ──
    case T_SLIDELEFT: {
        int srcX = x + (int)((1 - t) * w);
        result = srcX < w ? B[y * w + srcX] : a;
        break;
    }
    case T_SLIDERIGHT: {
        int srcX = x - (int)((1 - t) * w);
        result = srcX >= 0 ? B[y * w + srcX] : a;
        break;
    }
    case T_SLIDEUP: {
        int srcY = y + (int)((1 - t) * h);
        result = srcY < h ? B[srcY * w + x] : a;
        break;
    }
    case T_SLIDEDOWN: {
        int srcY = y - (int)((1 - t) * h);
        result = srcY >= 0 ? B[srcY * w + x] : a;
        break;
    }
    // ── Covers (B slides over A) ──
    case T_COVERLEFT: {
        int bx = x + (int)((1 - t) * w);
        result = bx < w ? B[y * w + bx] : a;
        break;
    }
    case T_COVERRIGHT: {
        int bx = x - (int)((1 - t) * w);
        result = bx >= 0 ? B[y * w + bx] : a;
        break;
    }
    case T_COVERUP: {
        int by = y + (int)((1 - t) * h);
        result = by < h ? B[by * w + x] : a;
        break;
    }
    case T_COVERDOWN: {
        int by = y - (int)((1 - t) * h);
        result = by >= 0 ? B[by * w + x] : a;
        break;
    }
    // ── Reveals (A slides away) ──
    case T_REVEALLEFT: {
        int ax = x - (int)(t * w);
        result = ax >= 0 ? A[y * w + ax] : b;
        break;
    }
    case T_REVEALRIGHT: {
        int ax = x + (int)(t * w);
        result = ax < w ? A[y * w + ax] : b;
        break;
    }
    case T_REVEALUP: {
        int ay = y - (int)(t * h);
        result = ay >= 0 ? A[ay * w + x] : b;
        break;
    }
    case T_REVEALDOWN: {
        int ay = y + (int)(t * h);
        result = ay < h ? A[ay * w + x] : b;
        break;
    }
    // ── Shapes ──
    case T_CIRCLEOPEN: {
        float dx = nx - 0.5f, dy = ny - 0.5f;
        float dist = sqrtf(dx*dx + dy*dy) / 0.707f; // normalize to 0..1
        result = dist < t ? b : a;
        break;
    }
    case T_CIRCLECLOSE: {
        float dx = nx - 0.5f, dy = ny - 0.5f;
        float dist = sqrtf(dx*dx + dy*dy) / 0.707f;
        result = dist > (1 - t) ? b : a;
        break;
    }
    case T_CIRCLECROP: {
        float dx = nx - 0.5f, dy = ny - 0.5f;
        float dist = sqrtf(dx*dx + dy*dy) / 0.707f;
        float edge = d_smoothstep(t - 0.02f, t + 0.02f, dist);
        result = a * edge + b * (1 - edge);
        break;
    }
    case T_RECTCROP: {
        float dx = fabsf(nx - 0.5f) * 2;
        float dy = fabsf(ny - 0.5f) * 2;
        float d = fmaxf(dx, dy);
        result = d > (1 - t) ? b : a;
        break;
    }
    case T_RADIAL: {
        float angle = atan2f(ny - 0.5f, nx - 0.5f);
        float norm = (angle + M_PI) / (2 * M_PI); // 0..1
        result = norm < t ? b : a;
        break;
    }
    // ── Barn door ──
    case T_HORZOPEN: {
        float d = fabsf(nx - 0.5f) * 2;
        result = d > (1 - t) ? b : a;
        break;
    }
    case T_HORZCLOSE: {
        float d = fabsf(nx - 0.5f) * 2;
        result = d < t ? b : a;
        break;
    }
    case T_VERTOPEN: {
        float d = fabsf(ny - 0.5f) * 2;
        result = d > (1 - t) ? b : a;
        break;
    }
    case T_VERTCLOSE: {
        float d = fabsf(ny - 0.5f) * 2;
        result = d < t ? b : a;
        break;
    }
    // ── Slice/Wind ──
    case T_HLSLICE: case T_HLWIND: {
        int stripe = y / (h / 8 + 1);
        float offset = (stripe % 2 == 0) ? t : 1 - t;
        result = nx < offset ? b : a;
        break;
    }
    case T_HRSLICE: case T_HRWIND: {
        int stripe = y / (h / 8 + 1);
        float offset = (stripe % 2 == 0) ? t : 1 - t;
        result = (1 - nx) < offset ? b : a;
        break;
    }
    case T_VUSLICE: case T_VUWIND: {
        int stripe = x / (w / 8 + 1);
        float offset = (stripe % 2 == 0) ? t : 1 - t;
        result = ny < offset ? b : a;
        break;
    }
    case T_VDSLICE: case T_VDWIND: {
        int stripe = x / (w / 8 + 1);
        float offset = (stripe % 2 == 0) ? t : 1 - t;
        result = (1 - ny) < offset ? b : a;
        break;
    }
    // ── Effects ──
    case T_PIXELIZE: {
        int blockSize = max(1, (int)((1 - t) * 64));
        int bx = (x / blockSize) * blockSize + blockSize/2;
        int by = (y / blockSize) * blockSize + blockSize/2;
        bx = min(bx, w - 1); by = min(by, h - 1);
        float pa = A[by * w + bx], pb = B[by * w + bx];
        result = pa * (1 - t) + pb * t;
        break;
    }
    case T_ZOOMIN: {
        float zoom = 1.0f + t * 0.5f;
        float invZ = 1.0f / zoom;
        float sx = 0.5f + (nx - 0.5f) * invZ;
        float sy = 0.5f + (ny - 0.5f) * invZ;
        int srcX = (int)(sx * w), srcY = (int)(sy * h);
        srcX = max(0, min(w-1, srcX)); srcY = max(0, min(h-1, srcY));
        float za = A[srcY * w + srcX];
        result = za * (1 - t) + b * t;
        break;
    }
    case T_HBLUR: {
        int radius = (int)((1 - t) * 20);
        float sum = 0; int count = 0;
        for (int dx = -radius; dx <= radius; dx++) {
            int sx = x + dx;
            if (sx >= 0 && sx < w) { sum += A[y * w + sx]; count++; }
        }
        float blurred = count > 0 ? sum / count : a;
        result = blurred * (1 - t) + b * t;
        break;
    }
    case T_DISTANCE: {
        float dx = nx - 0.5f, dy = ny - 0.5f;
        float dist = sqrtf(dx*dx + dy*dy) / 0.707f;
        float edge = 1.0f - d_smoothstep(t - 0.15f, t + 0.15f, dist);
        result = a * (1 - edge) + b * edge;
        break;
    }
    case T_SQUEEZEH: {
        float center = 0.5f;
        float d = fabsf(ny - center) * 2;
        float squeeze = 1 - t;
        if (d < squeeze) {
            int srcY = (int)((ny - center) / squeeze * 0.5f * h + h * 0.5f);
            srcY = max(0, min(h-1, srcY));
            result = A[srcY * w + x];
        } else {
            result = b;
        }
        break;
    }
    case T_SQUEEZEV: {
        float center = 0.5f;
        float d = fabsf(nx - center) * 2;
        float squeeze = 1 - t;
        if (d < squeeze) {
            int srcX = (int)((nx - center) / squeeze * 0.5f * w + w * 0.5f);
            srcX = max(0, min(w-1, srcX));
            result = A[y * w + srcX];
        } else {
            result = b;
        }
        break;
    }
    }

    out[idx] = (uint8_t)(result < 0 ? 0 : (result > 255 ? 255 : result));
}

// UV plane transition kernel (half resolution, same logic)
__global__ void kernelTransBlendUV(
    uint8_t* outU, uint8_t* outV,
    const uint8_t* aU, const uint8_t* aV,
    const uint8_t* bU, const uint8_t* bV,
    int cw, int ch, int w, int h, float t, int transType)
{
    int x = blockIdx.x * blockDim.x + threadIdx.x;
    int y = blockIdx.y * blockDim.y + threadIdx.y;
    if (x >= cw || y >= ch) return;

    int idx = y * cw + x;
    // Map chroma coords to luma coords for transition math
    float nx = (float)(x * 2) / w;
    float ny = (float)(y * 2) / h;

    // Compute blend factor using same logic as Y
    float factor;
    switch (transType) {
    case T_DISSOLVE: default: factor = t; break;
    case T_FADE: case T_FADEBLACK:
        factor = t < 0.5f ? 0.0f : 1.0f; // snap at midpoint for UV
        break;
    case T_FADEWHITE: case T_FADEGRAYS:
        factor = t; break;
    case T_FADEFAST: factor = t * t; break;
    case T_FADESLOW: factor = sqrtf(t); break;
    case T_SMOOTHLEFT: factor = 1.0f - d_smoothstep(t-0.1f, t+0.1f, nx); break;
    case T_SMOOTHRIGHT: factor = 1.0f - d_smoothstep(t-0.1f, t+0.1f, 1-nx); break;
    case T_SMOOTHUP: factor = 1.0f - d_smoothstep(t-0.1f, t+0.1f, ny); break;
    case T_SMOOTHDOWN: factor = 1.0f - d_smoothstep(t-0.1f, t+0.1f, 1-ny); break;
    case T_WIPELEFT: factor = nx < t ? 1.0f : 0.0f; break;
    case T_WIPERIGHT: factor = (1-nx) < t ? 1.0f : 0.0f; break;
    case T_WIPEUP: factor = ny < t ? 1.0f : 0.0f; break;
    case T_WIPEDOWN: factor = (1-ny) < t ? 1.0f : 0.0f; break;
    case T_WIPETL: factor = (nx+ny)/2 < t ? 1.0f : 0.0f; break;
    case T_WIPETR: factor = ((1-nx)+ny)/2 < t ? 1.0f : 0.0f; break;
    case T_WIPEBL: factor = (nx+(1-ny))/2 < t ? 1.0f : 0.0f; break;
    case T_WIPEBR: factor = ((1-nx)+(1-ny))/2 < t ? 1.0f : 0.0f; break;
    case T_DIAGTL: { float d = (nx+ny)/2; factor = 1.0f - d_smoothstep(t-0.05f, t+0.05f, d); break; }
    case T_DIAGTR: { float d = ((1-nx)+ny)/2; factor = 1.0f - d_smoothstep(t-0.05f, t+0.05f, d); break; }
    case T_DIAGBL: { float d = (nx+(1-ny))/2; factor = 1.0f - d_smoothstep(t-0.05f, t+0.05f, d); break; }
    case T_DIAGBR: { float d = ((1-nx)+(1-ny))/2; factor = 1.0f - d_smoothstep(t-0.05f, t+0.05f, d); break; }
    case T_CIRCLEOPEN: case T_DISTANCE: {
        float dx = nx-0.5f, dy = ny-0.5f;
        float dist = sqrtf(dx*dx+dy*dy) / 0.707f;
        factor = dist < t ? 1.0f : 0.0f;
        break;
    }
    case T_CIRCLECLOSE: {
        float dx = nx-0.5f, dy = ny-0.5f;
        float dist = sqrtf(dx*dx+dy*dy) / 0.707f;
        factor = dist > (1-t) ? 1.0f : 0.0f;
        break;
    }
    case T_RADIAL: {
        float angle = atan2f(ny-0.5f, nx-0.5f);
        float norm = (angle + M_PI) / (2*M_PI);
        factor = norm < t ? 1.0f : 0.0f;
        break;
    }
    case T_HORZOPEN: { float d = fabsf(nx-0.5f)*2; factor = d > (1-t) ? 1.0f : 0.0f; break; }
    case T_HORZCLOSE: { float d = fabsf(nx-0.5f)*2; factor = d < t ? 1.0f : 0.0f; break; }
    case T_VERTOPEN: { float d = fabsf(ny-0.5f)*2; factor = d > (1-t) ? 1.0f : 0.0f; break; }
    case T_VERTCLOSE: { float d = fabsf(ny-0.5f)*2; factor = d < t ? 1.0f : 0.0f; break; }
    case T_RECTCROP: {
        float dx = fabsf(nx-0.5f)*2, dy = fabsf(ny-0.5f)*2;
        factor = fmaxf(dx,dy) > (1-t) ? 1.0f : 0.0f;
        break;
    }
    // Slide/cover/reveal: use position-based blend
    case T_SLIDELEFT: case T_COVERLEFT: factor = nx < t ? 1.0f : 0.0f; break;
    case T_SLIDERIGHT: case T_COVERRIGHT: factor = (1-nx) < t ? 1.0f : 0.0f; break;
    case T_SLIDEUP: case T_COVERUP: factor = ny < t ? 1.0f : 0.0f; break;
    case T_SLIDEDOWN: case T_COVERDOWN: factor = (1-ny) < t ? 1.0f : 0.0f; break;
    case T_REVEALLEFT: factor = nx < t ? 1.0f : 0.0f; break;
    case T_REVEALRIGHT: factor = (1-nx) < t ? 1.0f : 0.0f; break;
    case T_REVEALUP: factor = ny < t ? 1.0f : 0.0f; break;
    case T_REVEALDOWN: factor = (1-ny) < t ? 1.0f : 0.0f; break;
    // Slice/Wind
    case T_HLSLICE: case T_HLWIND: {
        int stripe = (y*2) / (h/8+1); float offset = (stripe%2==0)?t:1-t;
        factor = nx < offset ? 1.0f : 0.0f; break;
    }
    case T_HRSLICE: case T_HRWIND: {
        int stripe = (y*2) / (h/8+1); float offset = (stripe%2==0)?t:1-t;
        factor = (1-nx) < offset ? 1.0f : 0.0f; break;
    }
    case T_VUSLICE: case T_VUWIND: {
        int stripe = (x*2) / (w/8+1); float offset = (stripe%2==0)?t:1-t;
        factor = ny < offset ? 1.0f : 0.0f; break;
    }
    case T_VDSLICE: case T_VDWIND: {
        int stripe = (x*2) / (w/8+1); float offset = (stripe%2==0)?t:1-t;
        factor = (1-ny) < offset ? 1.0f : 0.0f; break;
    }
    case T_PIXELIZE: case T_ZOOMIN: case T_HBLUR:
    case T_SQUEEZEH: case T_SQUEEZEV: case T_CIRCLECROP:
        factor = t; break; // simple blend for UV
    }

    outU[idx] = (uint8_t)(aU[idx] * (1 - factor) + bU[idx] * factor);
    outV[idx] = (uint8_t)(aV[idx] * (1 - factor) + bV[idx] * factor);
}

// ── Device buffers for transition blending ──
static uint8_t* d_transA = nullptr;  // frame A (Y+U+V packed)
static uint8_t* d_transB = nullptr;  // frame B
static uint8_t* d_transOut = nullptr; // output
static size_t d_transSize = 0;

bool cudaTransitionBlend(
    uint8_t* outY, uint8_t* outU, uint8_t* outV,
    int outStrideY, int outStrideUV,
    const uint8_t* aY, const uint8_t* aU, const uint8_t* aV,
    int aStrideY, int aStrideUV,
    const uint8_t* bY, const uint8_t* bU, const uint8_t* bV,
    int bStrideY, int bStrideUV,
    int w, int h, float progress, int transType)
{
    if (!g_cudaAvailable) return false;

    int ySize = w * h;
    int cw = w / 2, ch = h / 2;
    int uvSize = cw * ch;
    size_t frameSize = ySize + uvSize * 2;

    // Allocate 3 frame buffers (A, B, out)
    if (d_transSize < frameSize) {
        if (d_transA) cudaFree(d_transA);
        if (d_transB) cudaFree(d_transB);
        if (d_transOut) cudaFree(d_transOut);
        CUDA_CHECK(cudaMalloc(&d_transA, frameSize));
        CUDA_CHECK(cudaMalloc(&d_transB, frameSize));
        CUDA_CHECK(cudaMalloc(&d_transOut, frameSize));
        d_transSize = frameSize;
    }

    uint8_t* dAy = d_transA;
    uint8_t* dAu = d_transA + ySize;
    uint8_t* dAv = dAu + uvSize;
    uint8_t* dBy = d_transB;
    uint8_t* dBu = d_transB + ySize;
    uint8_t* dBv = dBu + uvSize;
    uint8_t* dOy = d_transOut;
    uint8_t* dOu = d_transOut + ySize;
    uint8_t* dOv = dOu + uvSize;

    // Upload A
    cudaMemcpy2D(dAy, w, aY, aStrideY, w, h, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dAu, cw, aU, aStrideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dAv, cw, aV, aStrideUV, cw, ch, cudaMemcpyHostToDevice);
    // Upload B
    cudaMemcpy2D(dBy, w, bY, bStrideY, w, h, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dBu, cw, bU, bStrideUV, cw, ch, cudaMemcpyHostToDevice);
    cudaMemcpy2D(dBv, cw, bV, bStrideUV, cw, ch, cudaMemcpyHostToDevice);

    // Launch kernels
    dim3 blk(16, 16);
    dim3 grdY((w + 15) / 16, (h + 15) / 16);
    dim3 grdUV((cw + 15) / 16, (ch + 15) / 16);

    kernelTransBlendY<<<grdY, blk>>>(dOy, dAy, dBy, w, h, progress, transType);
    kernelTransBlendUV<<<grdUV, blk>>>(dOu, dOv, dAu, dAv, dBu, dBv,
                                        cw, ch, w, h, progress, transType);

    // Download result
    cudaDeviceSynchronize();
    cudaError_t trErr = cudaGetLastError();
    if (trErr != cudaSuccess) {
        fprintf(stderr, "[CUDA] Transition FAILED: %s\n", cudaGetErrorString(trErr));
        return false;
    }
    cudaMemcpy2D(outY, outStrideY, dOy, w, w, h, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outU, outStrideUV, dOu, cw, cw, ch, cudaMemcpyDeviceToHost);
    cudaMemcpy2D(outV, outStrideUV, dOv, cw, cw, ch, cudaMemcpyDeviceToHost);

    return true;
}

