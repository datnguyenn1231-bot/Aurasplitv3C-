# AuraSplit v2 — Build EXE Guide & Bug History

> **Tổng hợp toàn bộ kinh nghiệm build EXE** — bugs đã fix, lessons learned, workflow chuẩn.
> Cập nhật: 2026-02-10

## ✅ Test Status

| Phase | Feature | Status | Ghi chú |
|---|---|:---:|---|
| Phase 1 | AutoSync SK1 (SyncVideo) | ✅ STABLE | Download model + load + cut 140 clips |
| Phase 1 | AutoSync SK3 (SyncImage) | ✅ STABLE | Download model + load + cut 140 image clips |
| Phase 1 | Fresh model download | ✅ STABLE | Symlink-free via model_checker |
| Phase 1 | System Log streaming | ✅ STABLE | File IPC bypass stdout buffer |
| Phase 1 | Cython .pyd protection | ✅ STABLE | 3 files protected (process_task, model_checker, paths) |
| Phase 2 | Editor | ⬜ TODO | |
| Phase 2 | TTS | ⬜ TODO | |
| Phase 2 | Download | ⬜ TODO | |
| Phase 2 | Metadata | ⬜ TODO | |
| Phase 2 | Settings | ⬜ TODO | |

---

## 🔧 Build Workflow (chuẩn)

```powershell
# 1. Kill stale processes (BẮT BUỘC trước khi build!)
taskkill /F /IM AuraSplit.exe 2>$null
taskkill /F /IM electron.exe 2>$null
# CHÚ Ý: Không kill python.exe nếu đang dùng VS Code!

# 1.5. Clean Cython build/ (prevent electron-builder from copying temp artifacts)
Remove-Item "python\build" -Recurse -Force -ErrorAction SilentlyContinue

# 2. Build (vue-tsc → vite → electron-builder)
cd c:\Users\datng\Desktop\AI_TOOL\AuraSplit_v2
npm run build

# 3. Copy FFmpeg binaries (symlink workaround)
New-Item -ItemType Directory -Force "release\0.0.0\win-unpacked\resources\binaries" | Out-Null
Copy-Item "c:\Users\datng\Desktop\AI_TOOL\ffmpeg.exe" "release\0.0.0\win-unpacked\resources\binaries\ffmpeg.exe"
Copy-Item "c:\Users\datng\Desktop\AI_TOOL\ffprobe.exe" "release\0.0.0\win-unpacked\resources\binaries\ffprobe.exe"

# 3.5. Cython Protection — deploy .pyd, xóa .py source + cleanup
$dest = "release\0.0.0\win-unpacked\resources\python"
$src = "python"
Copy-Item "$src\process_task.cp311-win_amd64.pyd" "$dest\" -Force
Copy-Item "$src\model_checker.cp311-win_amd64.pyd" "$dest\" -Force
Copy-Item "$src\config\paths.cp311-win_amd64.pyd" "$dest\config\" -Force
Remove-Item "$dest\process_task.py" -Force -ErrorAction SilentlyContinue
Remove-Item "$dest\model_checker.py" -Force -ErrorAction SilentlyContinue
Remove-Item "$dest\config\paths.py" -Force -ErrorAction SilentlyContinue
Remove-Item "$dest\build" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$dest\setup_cython_v2.py" -Force -ErrorAction SilentlyContinue

# 4. Verify
Test-Path "release\0.0.0\win-unpacked\AuraSplit.exe"
```

**Output:** `release/0.0.0/win-unpacked/AuraSplit.exe`

---

## 🐛 Bugs Đã Fix (theo thứ tự phát hiện)

### Bug 1: TypeScript unused imports → build fail
- **Lỗi:** `vue-tsc` strict mode báo unused imports → `exit code 1`
- **Files:** `Sidebar.vue`, `EditorView.vue`, `TTSView.vue`, `MetadataView.vue`, `SettingsView.vue`, `useAutoSync.ts`, `main.ts`
- **Fix:** Remove all unused imports (`computed`, `ChevronDown`, `Play`, `Type`, `Subtitles`, `Trash2`, `ChevronRight`, `IMAGE_EXT`, `createRequire`)

### Bug 2: Python/FFmpeg path sai trong EXE
- **Lỗi:** DEV dùng `../python_embed/python.exe`, EXE cần `resources/python_embed/python.exe`
- **Root cause:** `python.ipc.ts` hardcode relative path
- **Fix:** Thêm `getResourcesRoot()` → resolve path theo `app.isPackaged`:
  ```typescript
  function getResourcesRoot() {
    return app.isPackaged ? process.resourcesPath : path.join(getAppRoot(), '..')
  }
  ```

### Bug 3: `binaries/` symlink → electron-builder skip
- **Lỗi:** `binaries/` là symlink → electron-builder không copy vào build
- **Fix:** Manual copy `ffmpeg.exe` + `ffprobe.exe` sau build (step 3 trong workflow)

### Bug 4: `model_cache_dir` resolve sai trong EXE
- **Lỗi:** Python default `_script_dir/../models_ai` → trong EXE resolve sai
- **Fix:** TypeScript inject `model_cache_dir` vào config:
  ```typescript
  // python.ipc.ts — line 73-84
  if (app.isPackaged) {
    config.model_cache_dir = path.join(path.dirname(app.getPath('exe')), 'models_ai')
  } else {
    config.model_cache_dir = path.join(getAppRoot(), 'models_ai')
  }
  ```
- **Lưu ý:** `models_ai/` KHÔNG bundle trong extraResources (quá lớn ~3GB) → tạo cạnh EXE

### Bug 5: Log không hiện trong System Log (stdout buffer)
- **Lỗi:** `import torch; import whisperx` block 10-30s → stdout pipe buffer giữ messages
- **Root cause:** OS pipe buffer accumulates small data → Node.js `data` event chưa fire
- **Fix:** Thêm `_file_emit()` / `_pf_emit()` — ghi JSON vào progress file (`.jsonl`), Node.js poll file này mỗi 500ms → bypass stdout buffer
- **Quan trọng:** Chỉ dùng `_pf_emit` cho messages TRƯỚC blocking ops, KHÔNG dùng cho messages SAU (tránh duplicate)
- **Files:** `sk1_cutting.py` (line 317-319), `process_task.py` (line 1004-1013)

### Bug 6: WinError 1314 — Symlink privilege khi download model ⚠️ CRITICAL
- **Lỗi:** `whisperx.load_model("large-v3", download_root=...)` dùng HuggingFace Hub → tạo symlink giữa `blobs/` và `snapshots/` → Windows cần Admin
- **Khi nào xảy ra:** CHỉ khi download model lần đầu (model đã có thì không bị)
- **Fix 2 bước (CẢ HAI đều cần):**

  **Bước 1:** Pre-download bằng `model_checker.download_model()` (symlink-free):
  ```python
  # process_task.py — line 1056-1064
  from model_checker import download_model as _dl_model
  _ok, _path = _dl_model(model_name, target_dir=model_cache_dir, log_func=log_func)
  # → Download vào models_ai/large-v3/ (flat directory, không có blobs/snapshots)
  ```

  **Bước 2:** Pass ĐƯỜNG DẪN THƯ MỤC thay vì tên model:
  ```python
  # process_task.py — line 1066-1085
  _local_model_dir = os.path.join(model_cache_dir, model_name)
  if os.path.exists(os.path.join(_local_model_dir, "model.bin")):
      # Model đã có → load trực tiếp, KHÔNG qua HF Hub
      model = load_model_fn(_local_model_dir, device, compute_type=compute_type)
  else:
      # Fallback: HF Hub (cần admin cho symlinks)
      model = load_model_fn(model_name, device, compute_type=compute_type, download_root=model_cache_dir)
  ```

  > **TẠI SAO CẦN CẢ 2 BƯỚC?**
  > - Bước 1 chỉ download files vào `models_ai/large-v3/`
  > - Nếu chỉ có bước 1 → `load_model_fn("large-v3", ...)` vẫn dùng HF Hub cache format (`models--Systran--...`) → vẫn tạo symlink → vẫn crash!
  > - Bước 2 truyền path thay vì tên → faster-whisper thấy đây là directory → load trực tiếp

- **Env vars (đặt sớm trong api_wrapper.py):**
  ```python
  os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
  os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
  os.environ["HF_HUB_DISABLE_XET"] = "1"
  ```

### Bug 7: Stale processes gây tràn RAM/SSD
- **Lỗi:** Python process từ lần test trước vẫn chạy ngầm → RAM + SSD 100%
- **Fix:** LUÔN kill processes trước khi build hoặc test lại (step 1 trong workflow)
- **Check:** `Get-Process -Name AuraSplit,electron,python -ErrorAction SilentlyContinue`
- **Phân biệt:** Process từ VS Code (`.venv\Scripts\python.exe`, `Python311\python.exe`) KHÔNG phải AuraSplit → không cần kill

### Bug 8: Cython — Entry point crash (exit code 2)
- **Lỗi:** `api_wrapper.py` compile → `.pyd` → Python không tìm được file để chạy (`.pyd` chỉ import được, không execute)
- **Rule:** File gọi qua `python.exe <file>.py` → **KHÔNG compile .pyd**
- **Fix:** Giữ `api_wrapper.py` nguyên, chỉ compile files được **import**

### Bug 9: Cython — `_seq.pyd` crash on Japanese Unicode
- **Lỗi:** `_seq.py` chứa `SequenceMatcher` xử lý tiếng Nhật → crash silent khi compile `.pyd`
- **Khi nào xảy ra:** Khi matching words-to-script với Japanese text
- **Root cause:** Cython + `difflib.SequenceMatcher` + long Unicode strings → C-level crash
- **Fix:** Giữ `_seq.py` nguyên (docstring ghi rõ: "MUST stay in .py")
- **Bài học từ V1:** BUILD_HYBRID.bat v5.9.25 đã tách `_seq.py` (Bridge Split) vì lý do tương tự

---

## 🔒 Cython Protection (~70% coverage)

### Files Protected (.pyd — binary, không đọc được)
| File | Lines | Nội dung |
|---|---|---|
| `process_task.pyd` | 1165 | Core AI pipeline: model load, transcription, cutting loop |
| `model_checker.pyd` | 162 | Model download logic, HF Hub bypass |
| `config/paths.pyd` | 41 | Path resolution DEV/EXE |

### Files PHẢI giữ .py (crash nếu compile)
| File | Lines | Lý do |
|---|---|---|
| `api_wrapper.py` | 197 | Entry point (`python.exe api_wrapper.py`) |
| `_seq.py` | 95 | Japanese Unicode crash (SequenceMatcher) |
| `sk1_cutting.py` | 487 | subprocess + `import torch/whisperx` |
| `sk3_image_flow.py` | 684 | subprocess + `import torch/whisperx` |
| `safe_kernel.py` | 217 | FFmpeg subprocess.Popen crash |
| `async_logger.py` | 60 | Utility nhỏ, ít giá trị |
| `config/constants.py` | ~50 | Chỉ dropdown options |

### Security Assessment
| Tình huống | Kết quả |
|---|:---:|
| Copy cả folder chạy? | ❌ Thiếu `process_task.py` |
| Đọc core AI pipeline? | ❌ .pyd binary |
| Decompile `.pyd`? | 🔒 Rất khó (C machine code) |
| Dev giỏi tái tạo? | ⏰ 2-3 ngày + hiểu whisperx |

> **Muốn ~100%?** Cần PyArmor Pro ($299) — obfuscate + anti-debug + runtime encryption.
> Cython free nhưng chỉ compile bytecode → C → machine code, không obfuscate.

---

## 📁 Cấu trúc Files Quan Trọng

```
AuraSplit_v2/
├── electron/
│   ├── main.ts              # Electron main process
│   └── ipc/
│       ├── python.ipc.ts    # Python subprocess IPC (path resolution, config injection)
│       └── ffmpeg.ipc.ts    # FFmpeg IPC
├── python/                  # → copies to resources/python/ in EXE
│   ├── setup_cython_v2.py   # Cython build script (compile .py → .pyd)
│   ├── api_wrapper.py       # Entry point (MUST stay .py!)
│   ├── process_task.py      # → .pyd in EXE (AI pipeline, 1165 lines)
│   ├── model_checker.py     # → .pyd in EXE (download logic)
│   ├── _seq.py              # MUST stay .py (Japanese Unicode crash)
│   ├── config/paths.py      # → .pyd in EXE (path resolution)
│   └── engines/
│       ├── sk1_cutting.py   # MUST stay .py (subprocess + torch)
│       └── sk3_image_flow.py # MUST stay .py (subprocess + torch)
├── electron-builder.json5   # Build config (extraResources, code signing disabled)
└── release/0.0.0/win-unpacked/  # Build output
    ├── AuraSplit.exe
    ├── models_ai/           # Created on first run (NOT bundled!)
    │   └── large-v3/        # Downloaded by model_checker (flat, no symlinks)
    └── resources/
        ├── python/          # Python engines (protected: .pyd + remaining .py)
        ├── python_embed/    # Embedded Python (from extraResources)
        └── binaries/        # ffmpeg + ffprobe (manual copy!)
```

---

## ⚠️ Checklist Trước Mỗi Lần Build

- [ ] Kill tất cả AuraSplit/electron processes
- [ ] Check TypeScript errors: `npx vue-tsc --noEmit`
- [ ] Build: `npm run build`
- [ ] Copy ffmpeg/ffprobe vào `resources/binaries/`
- [ ] **Cython: compile .pyd + deploy + xóa .py source**
- [ ] Verify `.pyd` files tồn tại, `.py` source đã xóa
- [ ] Test EXE mở được
- [ ] Test SK1/SK3 với model đã có (không download)
- [ ] Test xóa model → download lại (WinError 1314 check)
- [ ] Verify log hiện đầy đủ trong System Log
- [ ] Kill processes sau khi test xong

---

## 💡 Lessons Learned

1. **Luôn kill processes trước build** — stale python/electron processes gây tràn RAM
2. **Symlink = nightmare trên Windows** — HF Hub, electron-builder đều bị. Dùng `local_dir_use_symlinks=False`
3. **stdout buffer = log mất** — dùng file-based IPC cho messages trước blocking ops (KHÔNG dùng cho sau → tránh duplicate)
4. **`app.isPackaged`** là source of truth cho DEV vs EXE, KHÔNG dùng `sys.frozen` (Electron ≠ PyInstaller)
5. **`models_ai/` không bundle** — quá lớn (~3GB), tải on-demand cạnh EXE
6. **`binaries/` symlink** — electron-builder skip, phải copy thủ công
7. **Pass directory path, KHÔNG pass model name** — `load_model_fn("models_ai/large-v3")` load trực tiếp, `load_model_fn("large-v3")` dùng HF Hub → symlink → crash
8. **VS Code python ≠ AuraSplit python** — check `Path` property trước khi kill, tránh kill nhầm VS Code
9. **Entry point KHÔNG compile .pyd** — `python.exe api_wrapper.py` → .pyd chỉ import được, không execute
10. **`_seq.py` + Japanese Unicode = crash as .pyd** — Cython + `difflib.SequenceMatcher` + long Unicode → C-level crash. Rule từ V1 BUILD_HYBRID
11. **Cython ≠ obfuscation** — compile .py → C → machine code (khó decompile), nhưng không anti-debug. Muốn 100% cần PyArmor Pro ($299)
