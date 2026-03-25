"""
sub_server.py — Persistent AI Subtitle Server (AuraSplit v3)

Keeps WhisperX/Qwen models cached in GPU memory between calls.
Protocol: stdin → JSON lines, stdout → JSON lines.

Architecture: This file handles IPC only. AI logic lives in sub_engine.py.
"""

import sys
import os
import json
import traceback

# ── Fix Windows encoding + disable HF symlinks BEFORE any import ──
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

# Add script dir to path — so 'import sub_engine' works
_script_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _script_dir)


def _sanitize(value):
    """Remove newlines from values → JSON stays single line."""
    if isinstance(value, str):
        return value.replace('\r\n', ' ').replace('\r', ' ').replace('\n', ' ').strip()
    if isinstance(value, dict):
        return {k: _sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_sanitize(v) for v in value]
    return value


def _emit(task_id: str, msg_type: str, **kwargs):
    """Send JSON-line message to stdout → Electron python.ipc.ts captures."""
    payload = {"task_id": task_id, "type": msg_type, **kwargs}
    payload = _sanitize(payload)
    line = json.dumps(payload, ensure_ascii=False)
    line = line.replace("\n", " ").replace("\r", "")
    print(line, flush=True)
    sys.stdout.flush()


def handle_sub_task(task: dict):
    """Run a single subtitle task with dual-engine routing."""
    task_id = task.get("task_id", "unknown")

    try:
        from sub_engine import (
            transcribe_with_whisperx,
            transcribe_with_qwen,
            get_engine_for_lang,
        )

        video_path      = task.get("video_path", "")
        output_srt      = task.get("output_srt_path", "")
        lang            = task.get("lang_code", "auto")
        model_name      = task.get("model_name", "Qwen/Qwen3-ASR-0.6B")
        use_aligner     = task.get("use_aligner", True)
        force_engine    = task.get("engine", "")
        model_cache_dir = task.get("model_cache_dir",
                                   os.path.join(_script_dir, "..", "models_ai"))

        if not video_path or not os.path.isfile(video_path):
            _emit(task_id, "error", message=f"Video not found: {video_path}")
            return

        # Auto-generate SRT path if not specified
        if not output_srt:
            base = os.path.splitext(video_path)[0]
            output_srt = base + ".srt"

        # Determine engine: force or auto-route by language
        if force_engine in ("qwen", "whisper"):
            engine = force_engine
        else:
            engine = get_engine_for_lang(lang)

        engine_label = "WhisperX 🚀" if engine == "whisper" else "Qwen3-ASR 🧠"

        def log_func(msg: str):
            _emit(task_id, "log", message=msg)
            # Parse progress from [X/Y] pattern
            import re
            matches = re.findall(r'\[(\d+)/(\d+)\]', msg)
            if matches:
                cur, total = int(matches[-1][0]), int(matches[-1][1])
                if total > 0:
                    pct = int(5 + (cur / total) * 85)
                    _emit(task_id, "progress", percent=min(pct, 90), message=msg)

        _emit(task_id, "progress", percent=5,
              message=f"Language: {lang} → Engine: {engine_label}")
        _emit(task_id, "log",
              message=f"[ROUTE] Language: {lang} → Engine: {engine_label}")

        if engine == "whisper":
            result = transcribe_with_whisperx(
                video_path=video_path,
                output_srt_path=output_srt,
                lang=lang,
                model_cache_dir=model_cache_dir,
                log_func=log_func,
            )
        else:
            result = transcribe_with_qwen(
                video_path=video_path,
                output_srt_path=output_srt,
                lang=lang,
                model_name=model_name,
                use_aligner=use_aligner,
                model_cache_dir=model_cache_dir,
                log_func=log_func,
            )

        # Convert segments — force native Python types (numpy float32 not JSON-serializable)
        raw_segments = result.get("segments", [])[:50]
        segments = []
        for seg in raw_segments:
            segments.append({
                "start": float(seg.get("start", 0)),
                "end": float(seg.get("end", 0)),
                "text": str(seg.get("text", "")),
            })

        _emit(task_id, "result", data={
            "status": "ok",
            "task": "sub",
            "engine": result.get("engine", engine),
            "language": str(result.get("language", "")),
            "srt_path": str(result.get("srt_path", "")),
            "words_json_path": str(result.get("words_json_path", "")),
            "segments_count": int(result.get("segments_count", 0)),
            "segments": segments,
        })
        _emit(task_id, "progress", percent=100, message="✅ SUB Complete!")

    except Exception as e:
        tb = traceback.format_exc()
        # Write error log for debugging
        try:
            log_path = os.path.join(_script_dir, "sub_error.log")
            with open(log_path, "w", encoding="utf-8") as f:
                f.write(f"Task: {task_id}\n{tb}\n")
        except Exception:
            pass
        _emit(task_id, "error", message=f"SUB error: {e}")


def main():
    """Main loop — read JSON tasks from stdin, process, stay alive."""
    _emit("server", "log", message="🚀 SUB Server started — models will be cached!")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            task = json.loads(line)
        except json.JSONDecodeError as e:
            _emit("server", "error", message=f"Invalid JSON: {e}")
            continue

        # Shutdown
        if task.get("cmd") == "shutdown":
            _emit("server", "log", message="🛑 SUB Server shutting down...")
            break

        # Ping
        if task.get("cmd") == "ping":
            _emit("server", "log", message="🏓 pong")
            continue

        # Process task
        handle_sub_task(task)

    # Cleanup — free GPU memory
    try:
        from sub_engine import clear_cache
        clear_cache()
    except Exception:
        pass


if __name__ == "__main__":
    main()
