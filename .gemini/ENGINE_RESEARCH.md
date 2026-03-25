# AuraSplit v2 — Complete Feature & Performance Research

## Feature Parity Map

### Basic Effects (`effects.cpp` → `applyAllEffects()`)

| # | Feature | FFmpeg Filter | C++ Function | Performance |
|---|---------|--------------|-------------|-------------|
| 1 | Mirror | `hflip` | `effectMirror` | ⚡ Fast (memcpy swap) |
| 2 | Noise | `noise=alls=N:allf=t+u` | `effectNoise` | ⚡ Fast (rand per pixel) |
| 3 | Lens Distortion | `lenscorrection` | `effectLensDistortion` | ⚠️ Medium (per-pixel math) |
| 4 | HDR | `eq=contrast:sat:brightness + unsharp` | `effectHDR` | ⚡ Fast (LUT-like) |
| 5 | Color Grading | `eq + colorbalance + hue` | `effectColorGrading` | ⚡ Fast |
| 6 | Glow | `eq + colorbalance + unsharp` | `effectGlow` | ⚡ Fast |
| 7 | Border | `drawbox` | `effectBorder` | ⚡ Fast (edge fill) |
| 8 | Glow Halo | `8x drawbox` | `effectGlowHalo` | ⚡ Fast |
| 9 | RGB Drift | `drawbox + hue` | `effectRGBDrift` | ⚡ Fast |
| 10 | Rotate | `rotate=RAD` | `effectRotate` | ⚠️ Medium (SSAA 2x scale) |
| 11 | Smart Crop | `crop + pad` | `effectSmartCrop` | ⚡ Fast |
| 12 | Pixel Enlarge | `scale 3x nearest + back` | `effectPixelEnlarge` | ⚠️ Medium (3x scale) |
| 13 | Chroma Shuffle | `hue=h=12 + eq=sat=1.25` | `effectChromaShuffle` | ⚡ Fast |
| 14 | RGB Shift | `rgbashift` | `effectRGBShift` | ⚡ Fast |

> All basic effects are fast (< 1ms/frame). These are NOT bottlenecks.

### Advanced Effects (`advanced_effects.cpp`)

| Feature | FFmpeg Method | C++ Function | Performance |
|---------|--------------|-------------|-------------|
| BG Blur | `gblur(sigma)` complex filter | `effectBgBlur` (avfilter gblur) | 🐢 **SLOW** (scale 1.3x → blur → crop) |
| Logo | overlay input | `effectLogoOverlay` (stb_image) | ⚡ Fast (cached load) |
| Title/Desc | `drawtext` | `effectDrawText` (avfilter) | ⚠️ 20ms/frame (filter graph per frame!) |
| Subtitle | `drawtext` | `effectSubtitle` (avfilter) | ⚠️ 20ms/frame (filter graph per frame!) |

### Pipeline Effects (`engine.cpp`)

| Feature | Method | Performance |
|---------|--------|-------------|
| Frame Decode | `avcodec_receive_frame` | ⚡ Fast |
| Auto-Rotate | `sws_scale` with rotation | ⚠️ First frame only check |
| Scale to Frame | `scaleFrame()` → `sws_scale` | ⚠️ Medium (LANCZOS per frame) |
| BG Blur Composite | effectBgBlur + FG paste | 🐢 **SLOW** (~50-100ms/frame) |
| Reframe | scale + position paste | ⚠️ Medium (sws_scale) |
| NVENC Encode | `avcodec_send_frame` (GPU) | ⚡ Fast (GPU) |
| Audio Copy | stream copy | ⚡ Fast |

## Performance Bottleneck Analysis

### Current timing estimate per frame (1080×1920 output):
```
Decode:               ~2ms
Basic effects (14):   ~5ms total
BG Cover Scale:       ~8ms (1.3x → 1404×2496, SWS_FAST_BILINEAR)
gblur on 1404×2496:   ~25ms ← BIGGEST CPU cost
Crop + darken:        ~2ms
FG Scale:             ~5ms (SWS_BILINEAR, cached)
Paste FG on BG:       ~1ms (memcpy)
frame_copy:           ~1ms
NVENC Encode:         ~3ms (GPU)
─────────────────────────
Total:                ~52ms/frame ≈ 19fps ≈ 3 seconds per minute
```

### With drawtext (Title/Subtitle): +40ms/frame → ~12fps → 5 sec/min
### Full shield: ~55ms/frame → ~18fps → ~3.3 sec/min

## 🔑 Top 3 Optimizations (by impact)

### 1. Downscale BG before blur (BIGGEST WIN — ~4x faster blur)
```
Current:  source → scale UP 1.3x (1404×2496 = 3.5M px) → gblur
Optimal:  source → scale DOWN 0.5x (540×960 = 518K px) → gblur → scale UP
Impact:   6.7x fewer pixels to blur → gblur ~4ms instead of ~25ms
```
BG is heavily blurred — downscale quality loss is INVISIBLE.

### 2. Cache drawtext filter graph (Title/Subtitle)
Currently `effectDrawText` and `effectSubtitle` create NEW filter graph per frame.
Cache graph as static (like gblur), reuse across frames.
Impact: 20ms → ~2ms per frame for each.

### 3. Use scaleFrame with SWS_BILINEAR instead of SWS_LANCZOS
`scaleFrame()` (non-bgBlur path) at L325 still uses SWS_LANCZOS.
Change to SWS_BILINEAR for ~5x faster scaling.
Impact: ~8ms → ~2ms per scale operation.

## Speed Targets (after optimizations)

| Scenario | Current | After Opt | Target (CapCut-level) |
|----------|---------|-----------|----------------------|
| BG blur + scale only | ~52ms/frame (19fps) | ~20ms/frame (50fps) | 60fps+ |
| Full shield + BG | ~70ms/frame (14fps) | ~30ms/frame (33fps) | 30fps+ |
| Full shield + BG + subtitle | ~110ms/frame (9fps) | ~35ms/frame (28fps) | 25fps+ |

> CapCut runs at ~30-60fps for similar processing using GPU compute shaders.
> CPU-only target: 25-50fps = 1 minute video exports in 2-4 seconds.
