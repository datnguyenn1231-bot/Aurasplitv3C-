"""
whisper_worker.py — WhisperX Transcription Worker (AuraSplit v3)

DAEMON MODE: stays alive, keeps model in GPU RAM between transcriptions.
ONE-SHOT MODE: backwards compatible when called with config.json argument.

Security: This file contains NO proprietary algorithms.
          All logic is in the C++ engine binary.

Usage:
  python whisper_worker.py --daemon        # Persistent daemon (stdin/stdout JSON)
  python whisper_worker.py config.json     # One-shot (legacy)
"""

import json
import os
import sys
import warnings

# ── Suppress noisy warnings BEFORE any torch/whisperx import ──
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", message=".*torchcodec.*")
warnings.filterwarnings("ignore", message=".*TensorFloat-32.*")
warnings.filterwarnings("ignore", message=".*Lightning.*")
os.environ["PYTHONWARNINGS"] = "ignore"
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"
os.environ["PYTHONIOENCODING"] = "utf-8"


# ── Globals: cached models ──
_cached_model = None
_cached_model_key = None   # "model_name:device:compute_type"
_cached_align = {}         # lang → (model_a, metadata)
_torch = None
_whisperx = None


def _emit(msg_type: str, **kwargs):
    """JSON line output → Electron autosync.ipc.ts captures."""
    payload = {"type": msg_type, **kwargs}
    line = json.dumps(payload, ensure_ascii=False)
    line = line.replace("\n", " ").replace("\r", "")
    print(line, flush=True)
    sys.stdout.flush()


def _load_deps():
    """Lazy-load torch + whisperx (only once)."""
    global _torch, _whisperx
    if _torch is None:
        _emit("log", message="[WHISPER] Loading dependencies (torch, whisperx)...")
        import torch
        _torch = torch
        _emit("log", message=f"[WHISPER] ✅ PyTorch {torch.__version__} loaded")
        import whisperx
        _whisperx = whisperx
        _emit("log", message="[WHISPER] ✅ WhisperX loaded")


def _get_or_load_model(model_name, device, compute_type, model_cache_dir):
    """Load model or return cached version."""
    global _cached_model, _cached_model_key

    key = f"{model_name}:{device}:{compute_type}"
    if _cached_model is not None and _cached_model_key == key:
        _emit("log", message="[WHISPER] ⚡ Model already in GPU RAM — skipping load!")
        return _cached_model

    # Unload previous model
    if _cached_model is not None:
        _emit("log", message="[WHISPER] ♻️ Unloading previous model...")
        del _cached_model
        _cached_model = None
        _torch.cuda.empty_cache()

    # Load new model
    model_path = os.path.join(model_cache_dir, model_name)
    if os.path.exists(os.path.join(model_path, "model.bin")):
        _emit("log", message=f"[WHISPER] ✅ Model found locally: {model_path}")
        _emit("log", message="[WHISPER] Loading model into GPU memory...")
        model = _whisperx.load_model(model_path, device, compute_type=compute_type)
    else:
        _emit("log", message="[WHISPER] ⬇️ Model not found, downloading from HuggingFace...")
        _emit("log", message="[WHISPER] ⏳ Lần đầu tải model (~3GB) — Xin vui lòng chờ đợi, quá trình này mất 3-5 phút!")
        _emit("log", message="[WHISPER] ⏳ Please wait... First-time download may take 3-5 minutes!")
        model = _whisperx.load_model(model_name, device, compute_type=compute_type,
                                      download_root=model_cache_dir)
        _emit("log", message="[WHISPER] ✅ Model downloaded successfully! Lần sau sẽ load từ cache ngay.")

    _cached_model = model
    _cached_model_key = key
    _emit("log", message="[WHISPER] ✅ Model loaded and cached in GPU RAM!")
    return model


def _get_or_load_align(lang, device, model_cache_dir):
    """Load alignment model or return cached version."""
    global _cached_align

    if lang in _cached_align:
        _emit("log", message=f"[WHISPER] ⚡ Align model for '{lang}' already cached!")
        return _cached_align[lang]

    _emit("log", message=f"[WHISPER] 🎯 Loading alignment model for '{lang}'...")
    model_a, metadata = _whisperx.load_align_model(
        language_code=lang, device=device,
        model_dir=model_cache_dir
    )
    _cached_align[lang] = (model_a, metadata)
    _emit("log", message=f"[WHISPER] ✅ Align model cached for '{lang}'!")
    return model_a, metadata


def transcribe(config):
    """Core transcription logic — uses cached models."""
    _load_deps()

    audio_path     = config["audio_path"]
    model_name     = config.get("model_name", "large-v3")
    device         = config.get("device", "cuda")
    compute_type   = config.get("compute_type", "float16")
    lang_code      = config.get("lang_code")
    fast_mode      = config.get("fast_mode", False)
    model_cache_dir = config.get("model_cache_dir", "models_ai")
    output_path    = config.get("output_path", "result.json")

    # Normalize language
    if lang_code and str(lang_code).strip().lower() in ("", "auto", "detect"):
        lang_code = None

    os.environ["HF_HOME"] = model_cache_dir

    if device == "cuda" and not _torch.cuda.is_available():
        device = "cpu"
        compute_type = "int8"
        _emit("log", message="[WHISPER] ⚠️ CUDA not available, using CPU (slower)")

    gpu_name = ""
    if device == "cuda":
        try:
            gpu_name = _torch.cuda.get_device_name(0)
        except Exception:
            pass

    _emit("log", message=f"[WHISPER] Device: {device.upper()} {gpu_name} | Model: {model_name}")

    # Load model (cached!)
    model = _get_or_load_model(model_name, device, compute_type, model_cache_dir)

    # Transcribe
    _emit("log", message="[WHISPER] Loading audio file...")
    audio = _whisperx.load_audio(audio_path)
    _emit("log", message=f"[WHISPER] ✅ Audio loaded ({len(audio)/16000:.1f}s)")

    batch_size = 16 if device == "cuda" else 4
    kwargs = {"batch_size": batch_size}
    if lang_code:
        kwargs["language"] = lang_code
        _emit("log", message=f"[WHISPER] Language: {lang_code}")
    else:
        _emit("log", message="[WHISPER] Language: auto-detect")

    _emit("log", message="[WHISPER] 🎤 Transcribing... (batched)")

    try:
        result = model.transcribe(audio, **kwargs)
    except RuntimeError as e:
        if "out of memory" in str(e).lower():
            _emit("log", message="[WHISPER] ⚠️ GPU OOM, retrying with batch_size=2...")
            _torch.cuda.empty_cache()
            kwargs["batch_size"] = 2
            result = model.transcribe(audio, **kwargs)
        else:
            raise

    detected_lang = result.get("language") or lang_code or "en"
    seg_count = len(result.get("segments", []))
    _emit("log", message=f"[WHISPER] ✅ Transcription done! {seg_count} segments, lang={detected_lang}")

    # NOTE: do NOT delete model — keep in RAM for next run!

    # Align (unless fast_mode)
    if not fast_mode:
        _emit("log", message=f"[WHISPER] 🎯 Aligning words (wav2vec2, lang={detected_lang})...")
        try:
            model_a, metadata = _get_or_load_align(detected_lang, device, model_cache_dir)
            _emit("log", message="[WHISPER] Aligning...")
            result = _whisperx.align(
                result["segments"], model_a, metadata, audio, device,
                return_char_alignments=False
            )
            _emit("log", message="[WHISPER] ✅ Alignment done!")
        except Exception as e:
            _emit("log", message=f"[WHISPER] ⚠️ Alignment skipped: {e}")

    # Extract words
    words = []
    for seg in result.get("segments", []):
        if isinstance(seg, dict) and seg.get("words"):
            words.extend([w for w in seg["words"] if "start" in w])
        else:
            try:
                words.append({"word": seg.get("text", ""),
                            "start": seg["start"], "end": seg["end"]})
            except (KeyError, TypeError):
                continue

    # Write output
    output = {"words": words, "language": detected_lang,
              "segments": result.get("segments", [])}
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    _emit("log", message=f"[WHISPER] ✅ Done: {len(words)} words, lang={detected_lang}")
    return output_path


def daemon_main():
    """Persistent daemon — read JSON tasks from stdin, keep models in RAM."""
    global _cached_model, _cached_model_key, _cached_align, _torch
    _emit("log", message="🚀 WhisperX Daemon started — models will be cached in GPU RAM!")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            task = json.loads(line)
        except json.JSONDecodeError as e:
            _emit("error", message=f"Invalid JSON: {e}")
            continue

        cmd = task.get("cmd", "transcribe")

        if cmd == "shutdown":
            _emit("log", message="🛑 WhisperX Daemon shutting down...")
            break

        if cmd == "ping":
            _emit("pong", message="alive")
            continue

        if cmd == "unload":
            if _cached_model is not None:
                del _cached_model
                _cached_model = None
                _cached_model_key = None
            _cached_align.clear()
            if _torch is not None:
                _torch.cuda.empty_cache()
            _emit("log", message="♻️ All models unloaded, GPU RAM freed!")
            continue

        if cmd == "transcribe":
            try:
                result_path = transcribe(task)
                _emit("result", output_path=result_path)
            except Exception as e:
                import traceback
                _emit("error", message=f"Transcription failed: {e}")
                traceback.print_exc(file=sys.stderr)
            continue

        _emit("error", message=f"Unknown command: {cmd}")

    # Cleanup all
    try:
        if _cached_model is not None:
            del _cached_model
        if _torch is not None:
            _torch.cuda.empty_cache()
    except Exception:
        pass


def oneshot_main():
    """One-shot mode — backwards compatible with old config.json argument."""
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        config = json.load(f)
    transcribe(config)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        daemon_main()
    elif len(sys.argv) >= 2:
        oneshot_main()
    else:
        _emit("error", message="Usage: whisper_worker.py --daemon | whisper_worker.py config.json")
        sys.exit(1)
