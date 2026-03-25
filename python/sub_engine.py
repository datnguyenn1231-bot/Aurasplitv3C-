"""
sub_engine.py — Dual-Engine Subtitle Generation (AuraSplit v3)

Architecture: Thin AI wrapper only — NO business logic.
  Asian languages (vi, ja, zh, ko) → Qwen3-ASR (more accurate for CJK)
  English & European (en, es, fr, de) → WhisperX (3-4x faster)

Usage: Called by sub_server.py (persistent process, model cache in RAM)
"""

import os
import sys
import json
import subprocess
import tempfile
import time
from typing import Optional, Callable, List, Dict, Any

# Suppress noisy warnings before torch import
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# ── Constants ────────────────────────────────────────

SUPPORTED_LANGUAGES = {
    "auto": None,
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "vi": "Vietnamese", "ko": "Korean", "ja": "Japanese", "zh": "Chinese",
}

# Routing: which engine for which language
ASIAN_LANGUAGES  = {"vi", "ko", "ja", "zh"}
WHISPER_LANGUAGES = {"en", "es", "fr", "de"}

# Qwen model defaults
DEFAULT_QWEN_MODEL = "Qwen/Qwen3-ASR-0.6B"
ALIGNER_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"

# WhisperX model
WHISPER_MODEL = "large-v3-turbo"

# ── Model Cache (persist across calls in sub_server) ─

_model_cache: Dict[str, Any] = {}


def clear_cache():
    """Free all cached models and GPU memory."""
    global _model_cache
    _model_cache.clear()
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except ImportError:
        pass


def get_engine_for_lang(lang: str) -> str:
    """Route language → engine. Returns 'qwen' or 'whisper'."""
    if lang in ASIAN_LANGUAGES:
        return "qwen"
    return "whisper"


# ── Helpers ──────────────────────────────────────────

def _format_timestamp(seconds: float) -> str:
    """Convert seconds → SRT timestamp HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _segments_to_srt(segments: List[Dict[str, Any]]) -> str:
    """Convert transcript segments → SRT string."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = _format_timestamp(seg["start"])
        end = _format_timestamp(seg["end"])
        text = seg["text"].strip()
        if text:
            lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def _group_words_to_segments(
    timestamps: list,
    max_words: int = 12,
    max_duration: float = 5.0,
) -> List[Dict[str, Any]]:
    """Group word-level timestamps into natural subtitle segments.
    Handles CJK (no space between words) and sentence boundaries.
    """
    if not timestamps:
        return []

    segments = []
    current_words = []
    current_start = None
    current_end = 0.0
    sentence_enders = {'.', '!', '?', '。', '！', '？', '…'}

    for ts in timestamps:
        # Handle both dict and dataclass formats
        if isinstance(ts, dict):
            word = ts.get("text", ts.get("word", "")).strip()
            start = ts.get("start", ts.get("s", 0))
            end = ts.get("end", ts.get("e", 0))
        else:
            word = str(getattr(ts, "text", getattr(ts, "word", ""))).strip()
            start = getattr(ts, "start_time", getattr(ts, "start", 0))
            end = getattr(ts, "end_time", getattr(ts, "end", 0))

        if not word:
            continue
        if current_start is None:
            current_start = start

        current_words.append(word)
        current_end = end

        # Break conditions
        is_sentence_end = any(word.endswith(c) for c in sentence_enders)
        too_many = len(current_words) >= max_words
        too_long = (current_end - current_start) >= max_duration

        if is_sentence_end or too_many or too_long:
            text = _join_words(current_words)
            segments.append({
                "start": float(current_start),
                "end": float(current_end),
                "text": text,
            })
            current_words = []
            current_start = None

    # Flush remaining
    if current_words and current_start is not None:
        text = _join_words(current_words)
        segments.append({
            "start": float(current_start),
            "end": float(current_end),
            "text": text,
        })
    return segments


def _join_words(words: List[str]) -> str:
    """Join words — CJK: no space, Latin: with space."""
    text = " ".join(words)
    # Detect CJK characters → remove spaces
    if any(
        '\u4e00' <= c <= '\u9fff'    # Chinese
        or '\u3040' <= c <= '\u30ff'  # Japanese Hiragana/Katakana
        or '\uac00' <= c <= '\ud7af'  # Korean
        for c in text
    ):
        text = "".join(words)
    return text


def _extract_audio(video_path: str, output_path: str, ffmpeg_path: str = "ffmpeg",
                   log_func: Optional[Callable] = None) -> bool:
    """Extract audio from video → 16kHz mono WAV (optimal for ASR)."""
    log = log_func or print
    log("🎵 Extracting audio from video...")

    cmd = [
        ffmpeg_path, "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "-loglevel", "error", output_path,
    ]
    try:
        si = None
        if sys.platform == "win32":
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = subprocess.SW_HIDE

        result = subprocess.run(cmd, capture_output=True, text=True,
                                startupinfo=si, timeout=120)
        if result.returncode != 0:
            log(f"⚠️ FFmpeg error: {result.stderr[:200]}")
            return False
        log("✅ Audio extracted")
        return True
    except Exception as e:
        log(f"❌ Audio extraction failed: {e}")
        return False


def _find_ffmpeg() -> str:
    """Find FFmpeg executable — check local binaries first."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(script_dir, "..", "binaries", "ffmpeg.exe"),
        os.path.join(script_dir, "..", "ffmpeg", "ffmpeg.exe"),
        os.path.join(script_dir, "..", "..", "ffmpeg.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return os.path.abspath(c)
    return "ffmpeg"


# ═══════════════════════════════════════════════════
# ENGINE 1: WhisperX (batched faster-whisper + alignment)
# ═══════════════════════════════════════════════════

def transcribe_with_whisperx(
    video_path: str,
    output_srt_path: str,
    lang: str = "en",
    model_size: str = WHISPER_MODEL,
    model_cache_dir: Optional[str] = None,
    log_func: Optional[Callable] = None,
) -> Dict[str, Any]:
    """WhisperX pipeline: transcribe → word-align → SRT."""
    log = log_func or print
    log("[ENGINE] 🚀 Using WhisperX (batched + word alignment)")

    # Extract audio
    log("[1/4] 🎵 Extracting audio...")
    audio_path = os.path.join(tempfile.gettempdir(), f"v3_wx_{int(time.time())}.wav")
    ffmpeg = _find_ffmpeg()
    if not _extract_audio(video_path, audio_path, ffmpeg, log):
        raise RuntimeError(f"Failed to extract audio from {video_path}")

    try:
        import torch
        import whisperx

        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        batch_size = 16 if device == "cuda" else 4

        if device == "cpu":
            log("⚠️ CPU mode — transcription sẽ chậm hơn 10-20x")

        log(f"   Device: {device}, Model: {model_size}, Batch: {batch_size}")

        # Load model (cached)
        cache_key = f"whisperx:{model_size}:{device}:{compute_type}"
        if cache_key in _model_cache:
            model = _model_cache[cache_key]
            log("[2/4] ⚡ Model loaded from cache!")
        else:
            log("[2/4] 🧠 Loading WhisperX model...")
            model_kwargs = dict(
                whisper_arch=model_size, device=device, compute_type=compute_type,
            )
            if model_cache_dir:
                # Check local first → skip HF download
                local_path = os.path.join(model_cache_dir, model_size)
                if os.path.exists(os.path.join(local_path, "model.bin")):
                    log(f"   ✅ Model found locally: {local_path}")
                    model_kwargs["whisper_arch"] = local_path
                else:
                    model_kwargs["download_root"] = model_cache_dir
            model = whisperx.load_model(**model_kwargs)
            _model_cache[cache_key] = model
            log("   ✅ Model loaded & cached!")

        # Transcribe
        log("[3/4] 🎤 Transcribing (batched)...")
        audio = whisperx.load_audio(audio_path)
        t_kwargs = dict(audio=audio, batch_size=batch_size)
        if lang and lang != "auto":
            t_kwargs["language"] = lang

        result = model.transcribe(**t_kwargs)
        detected_lang = result.get("language", lang)
        raw_segments = result.get("segments", [])
        log(f"   Language: {detected_lang}, Segments: {len(raw_segments)}")

        # Word alignment
        log("[4/4] 🎯 Aligning words (wav2vec2)...")
        try:
            align_kwargs = dict(
                language_code=detected_lang, device=device,
            )
            if model_cache_dir:
                align_kwargs["model_dir"] = model_cache_dir
            model_a, metadata = whisperx.load_align_model(**align_kwargs)
            aligned = whisperx.align(raw_segments, model_a, metadata, audio, device,
                                     return_char_alignments=False)
            aligned_segments = aligned.get("segments", raw_segments)
            del model_a
            log(f"   ✅ Aligned: {len(aligned_segments)} segments")
        except Exception as e:
            log(f"   ⚠️ Alignment failed ({e}), using raw segments")
            aligned_segments = raw_segments

        # Build output segments
        segments = []
        for seg in aligned_segments:
            text = seg.get("text", "").strip()
            if not text:
                continue
            segments.append({
                "start": float(seg.get("start", 0)),
                "end": float(seg.get("end", 0)),
                "text": text,
            })

        # Write SRT
        srt = _segments_to_srt(segments)
        with open(output_srt_path, "w", encoding="utf-8") as f:
            f.write(srt)
        log(f"✅ SRT saved: {output_srt_path}")

        # Word timing JSON sidecar (for C++ engine)
        words_json = output_srt_path + ".words.json"
        try:
            with open(words_json, "w", encoding="utf-8") as f:
                json.dump(aligned_segments, f, ensure_ascii=False)
        except Exception:
            words_json = ""

        return {
            "engine": "whisperx",
            "language": detected_lang,
            "srt_path": output_srt_path,
            "words_json_path": words_json,
            "segments_count": len(segments),
            "segments": segments[:50],  # cap for IPC
        }
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass


# ═══════════════════════════════════════════════════
# ENGINE 2: Qwen3-ASR (Asian languages)
# ═══════════════════════════════════════════════════

def transcribe_with_qwen(
    video_path: str,
    output_srt_path: str,
    lang: str = "auto",
    model_name: str = DEFAULT_QWEN_MODEL,
    use_aligner: bool = True,
    model_cache_dir: Optional[str] = None,
    log_func: Optional[Callable] = None,
) -> Dict[str, Any]:
    """Qwen3-ASR pipeline: transcribe → ForcedAligner → SRT."""
    log = log_func or print
    log("[ENGINE] 🧠 Using Qwen3-ASR")

    # Extract audio
    log("[1/4] 🎵 Extracting audio...")
    audio_path = os.path.join(tempfile.gettempdir(), f"v3_qwen_{int(time.time())}.wav")
    ffmpeg = _find_ffmpeg()
    if not _extract_audio(video_path, audio_path, ffmpeg, log):
        raise RuntimeError(f"Failed to extract audio from {video_path}")

    try:
        import torch

        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        # CRITICAL: CPU does NOT support float16 → crash! Use float32.
        dtype = torch.float16 if torch.cuda.is_available() else torch.float32

        if device == "cpu":
            log("⚠️ CPU mode — Qwen will be slow")

        if model_cache_dir:
            os.environ["HF_HOME"] = model_cache_dir
            os.environ["HUGGINGFACE_HUB_CACHE"] = os.path.join(model_cache_dir, "hub")

        log(f"   Device: {device}, Dtype: {dtype}, Model: {model_name}")

        # Load model (cached)
        cache_key = f"qwen:{model_name}:{device}:{use_aligner}"
        if cache_key in _model_cache:
            model = _model_cache[cache_key]
            log("[2/4] ⚡ Qwen model from cache!")
        else:
            log("[2/4] 🧠 Loading Qwen3-ASR model...")
            from qwen_asr import Qwen3ASRModel

            # Check flash_attn for 2x speed
            attn_impl = "sdpa"
            try:
                import flash_attn  # noqa: F401
                attn_impl = "flash_attention_2"
                log("   ⚡ Flash Attention 2 detected")
            except ImportError:
                log("   📌 Using SDPA attention")

            model_kwargs = dict(
                dtype=dtype, device_map=device,
                max_inference_batch_size=4 if torch.cuda.is_available() else 1,
                max_new_tokens=512, attn_implementation=attn_impl,
            )
            if use_aligner:
                log(f"   + ForcedAligner: {ALIGNER_MODEL}")
                model_kwargs["forced_aligner"] = ALIGNER_MODEL
                model_kwargs["forced_aligner_kwargs"] = dict(
                    dtype=dtype, device_map=device,
                )

            model = Qwen3ASRModel.from_pretrained(model_name, **model_kwargs)

            # torch.compile for speed (PyTorch 2.0+)
            if hasattr(torch, "compile") and torch.cuda.is_available():
                try:
                    model = torch.compile(model, mode="reduce-overhead")
                    log("   ⚡ torch.compile enabled")
                except Exception:
                    pass

            _model_cache[cache_key] = model
            log("   ✅ Model loaded & cached!")

        # Transcribe
        log("[3/4] 🎤 Transcribing...")
        language_param = SUPPORTED_LANGUAGES.get(lang)
        t_kwargs = dict(audio=audio_path, language=language_param)
        if use_aligner:
            t_kwargs["return_time_stamps"] = True

        with torch.inference_mode():
            results = model.transcribe(**t_kwargs)

        if not results:
            raise RuntimeError("Transcription returned empty")

        result = results[0]
        detected_lang = getattr(result, "language", lang)
        text = getattr(result, "text", "")
        timestamps = getattr(result, "time_stamps", None)

        log(f"   Language: {detected_lang}, Length: {len(text)} chars")

        # Generate segments
        log("[4/4] 📝 Generating SRT...")
        if use_aligner and timestamps:
            segments = _group_words_to_segments(timestamps)
            log(f"   Word-level: {len(timestamps)} words → {len(segments)} segments")
        else:
            segments = []
            if hasattr(result, "segments"):
                for seg in result.segments:
                    segments.append({
                        "start": float(getattr(seg, "start", 0)),
                        "end": float(getattr(seg, "end", 0)),
                        "text": str(getattr(seg, "text", "")),
                    })
            elif text:
                segments = [{"start": 0, "end": 30, "text": text}]

        # Write SRT
        srt = _segments_to_srt(segments)
        with open(output_srt_path, "w", encoding="utf-8") as f:
            f.write(srt)
        log(f"✅ SRT saved: {output_srt_path}")

        return {
            "engine": "qwen",
            "language": detected_lang,
            "srt_path": output_srt_path,
            "segments_count": len(segments),
            "segments": segments[:50],
        }
    finally:
        try:
            os.remove(audio_path)
        except OSError:
            pass
