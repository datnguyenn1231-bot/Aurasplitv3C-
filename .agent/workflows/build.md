---
description: Build AuraSplit v3 EXE (Electron + python_embed)  
---

// turbo-all

## Build AuraSplit v3 EXE

### 1. Kill stale processes
```powershell
taskkill /F /IM AuraSplit.exe 2>$null; taskkill /F /IM electron.exe 2>$null; Write-Host "✅ Killed stale processes"
```

### 2. Copy engine binary to binaries/
```powershell
Copy-Item "c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v3\engine\build\Release\aura_engine.exe" "c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v3\binaries\aura_engine.exe" -Force
Write-Host "✅ Engine copied"
```

### 3. Build (vue-tsc + vite + electron-builder)
```powershell
cd c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v3
npm run build
```

### 4. Verify build output
```powershell
$base = "c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v3\release\0.0.0\win-unpacked"
$exe = "$base\AuraSplit.exe"
$engine = "$base\resources\binaries\aura_engine.exe"
$python = "$base\resources\python\whisper_worker.py"
$shaders = (Get-ChildItem "$base\resources\shaders" -Filter "*.glsl" -ErrorAction SilentlyContinue).Count
if ((Test-Path $exe) -and (Test-Path $engine) -and (Test-Path $python)) {
  Write-Host "✅ Build OK: $exe"
  Write-Host "  Engine: $(Test-Path $engine)"
  Write-Host "  Python workers: $(Test-Path $python)"
  Write-Host "  Shaders: $shaders .glsl files"
} else { Write-Host "❌ BUILD FAILED - check output" }
```

### 5. (Optional) Launch EXE to test
```powershell
Start-Process "c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v3\release\0.0.0\win-unpacked\AuraSplit.exe"
```

## Notes
- Build output: `release/0.0.0/win-unpacked/AuraSplit.exe`
- `python_embed/` resolved via `../python_embed` in electron-builder.json5
  - If folder doesn't exist → build still works, AutoSync won't function
- `models_ai/` NOT bundled (too large) → auto-downloaded on first use
- Code signing disabled (`signAndEditExecutable: false`)
- License: 4-layer system (HWID + Cloud + AES-256 cache + anti-tamper)
