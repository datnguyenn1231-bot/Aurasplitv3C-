# AuraSplit v2 — AI Context Document
> Đọc file này TRƯỚC KHI làm bất kỳ thay đổi nào. Đây là "bộ não" chứa kiến thức tích lũy.

## Architecture Overview

### Export Pipeline (2 paths)
1. **C++ AuraEngine** (`engine/src/engine.cpp`) — primary, NVENC GPU encoding
2. **FFmpeg fallback** (`electron/ipc/reup-filters.ts` + `reup.ipc.ts`) — subprocess

### IPC Flow
```
Vue (ReupView.vue) → IPC 'reup:export' (L1057) → reup.ipc.ts
  → getEnginePath() (L88) checks: APP_ROOT + CWD paths for aura_engine.exe
  → Found? → runEngine() (L112) → C++ AuraEngine (NVENC GPU)
  → Not found/crash? → fastExport() → FFmpeg subprocess
```

### ⚠️ CRITICAL: Two Engine Config Locations in reup.ipc.ts
The main export handler `ipcMain.handle('reup:export')` is at **L1057**.
The `runEngine()` call with ALL config fields is at **~L1108-1166**.
There is also a batch/scan handler at L647 (`reup:scan`) with a SEPARATE `runEngine()` config.

**ANY new config field MUST be added to the runEngine() call at ~L1108.**

> Also exists: `getEnginePath()` at L88, `runEngine()` function definition at L112.

## C++ Engine Architecture

### Files
- `engine/src/engine.cpp` — Main loop: decode → effects → scale/BG → reframe → encode
- `engine/src/advanced_effects.cpp` — BG blur (gblur avfilter), logo, text, subtitle
- `engine/src/advanced_effects.h` — Headers  
- `engine/src/effects.cpp` — Basic effects (mirror, noise, HDR, color grading, etc.)
- `engine/CMakeLists.txt` — Build config (links avfilter, avcodec, swscale, etc.)

### BG Blur Pipeline (when bgBlur=true)
```
BG: source → cover-scale 1.3x (cached SwsContext) → gblur avfilter (SIMD, cached graph) → crop → darken
FG: source → effects → fit-scale → reframe(zoom*scaleX/Y) → paste on BG (reframePosX/Y offset)
Result: BG full frame (never reframed), FG reframed independently
```

### Performance: Static Caching Pattern
All heavy objects are **static cached** (created once, reused across frames):
In `advanced_effects.cpp`:
- `s_blurGraph` (L43) — avfilter graph: buffer→gblur(sigma)→buffersink
- `s_bgSws` (L46) — SwsContext for BG cover-scale (SWS_FAST_BILINEAR)
- `s_bgFrame` (L47) — BG cover-scaled frame buffer

In `engine.cpp` (static locals inside frame loop):
- `s_compBg` (L602) — composite output frame (outW×outH)
- `s_fgSws` (L604) — SwsContext for FG scale (**SWS_BILINEAR**, not LANCZOS!)
- `s_fgScaled` (L605) — FG scaled frame buffer

**⚠️ NEVER use SWS_LANCZOS for per-frame scaling** — use SWS_BILINEAR or SWS_FAST_BILINEAR.

### Config Parsing (engine.cpp parseConfigFromString)
Uses `jsonGetDouble()` and `jsonGetString()` to parse JSON config from IPC.
Key fields: `reframeZoom`, `reframeScaleX/Y`, `reframePosX/Y`, `bgBlur`, `bgBlurAmount`.

## CSS Preview ↔ Export Parity

### Reframe CSS (reup.css L489)
```css
transform: translate(var(--reframe-x), var(--reframe-y)) 
           scale(var(--reframe-sx), var(--reframe-sy)) 
           var(--pv-transform);
/* where: --reframe-sx = videoZoom * videoScaleX / 10000 */
```

### BG Blur CSS (reup.css L444)
```css
.ru-bg-blur {
  object-fit: cover; transform: scale(1.3);
  filter: blur(N) brightness(0.45) saturate(1.2);
}
```
BG is a SEPARATE <video> element — never affected by reframe transforms.

### FFmpeg BG Blur (reup-filters.ts L596-633)
```
FG: [0:v] → vFilters → format=rgba → pad(transparent) → reframe → [base]
BG: [0:v] → scale(cover 1.3x) → gblur(sigma) → crop → eq(-0.35,1.2) → [bg]
Compose: [bg][base] overlay=(W-w)/2:(H-h)/2
```

## Key Config Fields (JSON passed to engine)
```json
{
  "reframeZoom": 100,      // 0-200, default 100
  "reframeScaleX": 100,    // 0-200, default 100
  "reframeScaleY": 100,    // 0-200, default 100
  "reframePosX": 0,        // px offset
  "reframePosY": 0,        // px offset
  "bgBlur": true/false,
  "bgBlurAmount": 40,      // blur intensity
  "width": 1080, "height": 1920  // output dims from frameDimMap
}
```

## Frame Dimension Map (reup.ipc.ts ~L1102)
```typescript
const frameDimMap = {
  '9:16': { w: 1080, h: 1920 },
  '1:1':  { w: 1080, h: 1080 },
  '4:3':  { w: 1440, h: 1080 },
  '3:4':  { w: 1080, h: 1440 },
  '16:9': { w: 1920, h: 1080 },
}
```

## Build Commands
```powershell
# Build C++ engine
cd engine
cmake --build build --config Release

# Run dev
npm run dev

# Kill stale engine before rebuild
taskkill /f /im aura_engine.exe
```

## Debug Logging
Engine stderr forwarded to terminal via `process.stderr.write` in reup.ipc.ts.
Look for:
- `[ENGINE] Found at:` — engine binary path
- `[ENGINE-CONFIG] reframeZoom=X scaleX=Y ...` — parsed config values
- `[ENGINE-CONFIG] bgBlur=1 bgBlurAmount=40 dims=WxH` — BG blur config

## Performance Architecture Note
C++ engine processes ALL frames on CPU (decode, scale, blur, composite).
Only NVENC encoding uses GPU. For BG blur + scale ONLY, FFmpeg subprocess is actually
FASTER because its filter graph pipeline is more optimized (compiled SIMD + internal zero-copy).

**Future optimization options:**
1. **Smart fallback**: Skip C++ engine when only BG blur + scale → use FFmpeg directly
2. **Downscale BG**: Scale to 0.5x → blur → scale up to 1.3x (blur hides quality loss)
3. **GPU filters**: Build FFmpeg with CUDA (`scale_cuda`, GPU blur) — complex setup
4. **Skip blur for distant BG**: Use lower sigma for faster blur, visually similar

## Common Pitfalls
1. **ESM**: No `__dirname` — use `process.cwd()` instead
2. **Engine locked**: Must `taskkill /f /im aura_engine.exe` before rebuild
3. **Config not reaching engine**: Check the ACTUAL export path at ~L1090, not processVideo()
4. **Frame dims**: Use `frameDimMap` record, not `includes('9')` hack
5. **av_frame_clone per frame**: Avoid — use static cached frames with av_frame_copy
