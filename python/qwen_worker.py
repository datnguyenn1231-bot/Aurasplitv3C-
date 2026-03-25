"""
qwen_worker.py — Qwen3-ASR Subtitle Worker (AuraSplit v3)

Thin wrapper: receives JSON config → runs Qwen transcription → outputs SRT.
No business logic — just AI API calls.

Security: This file contains NO proprietary algorithms.
          All logic is in the C++ engine binary.

Usage: python qwen_worker.py config.json
"""

import json
import os
import sys

# ── Set HF env vars BEFORE any import ──
os.environ["HF_HUB_DISABLE_SYMLINKS"] = "1"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"


def _emit(msg_type: str, **kwargs):
    """JSON line output → Electron captures via stdout."""
    payload = {"type": msg_type, **kwargs}
    line = json.dumps(payload, ensure_ascii=False)
    line = line.replace("\n", " ").replace("\r", "")
    print(line, flush=True)
    sys.stdout.flush()


def main():
    if len(sys.argv) < 2:
        _emit("error", message="Usage: qwen_worker.py config.json")
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        config = json.load(f)

    audio_path      = config["audio_path"]
    model_name      = config.get("model_name", "Qwen/Qwen3-ASR-0.6B")
    model_cache_dir = config.get("model_cache_dir", "models_ai")
    output_path     = config.get("output_path", "result.json")
    srt_path        = config.get("srt_path", "output.srt")

    os.environ["HF_HOME"] = model_cache_dir

    _emit("progress", percent=5, message="Loading dependencies...")

    import torch
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    import soundfile as sf

    # ── CUDA fallback ──
    # CRITICAL: CPU does NOT support float16 → RuntimeError!
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32

    if device == "cpu":
        _emit("log", message="⚠️ CPU mode — transcription will be slower")

    _emit("progress", percent=10, message=f"Device: {device.upper()} | Model: {model_name}")

    # ── Load model (check local first → skip download) ──
    _emit("progress", percent=15, message="Loading model...")

    # Determine local model path
    load_path = None
    sanitized_name = model_name.replace("/", "--")
    
    # 1st Check: Explicit manual folder (e.g. models_ai/Qwen--Qwen3-ASR-0.6B)
    manual_path = os.path.join(model_cache_dir, sanitized_name)
    if os.path.exists(manual_path) and any(f.endswith((".bin", ".safetensors")) for f in os.listdir(manual_path)):
        _emit("log", message=f"✅ Model found statically: {manual_path}")
        load_path = manual_path

    # 2nd Check: HuggingFace cache structure
    if not load_path:
        import glob
        hf_pattern = os.path.join(model_cache_dir, f"models--{sanitized_name}", "snapshots", "*")
        matches = glob.glob(hf_pattern)
        for match in matches:
            if os.path.isdir(match) and any(f.endswith((".bin", ".safetensors")) for f in os.listdir(match)):
                 _emit("log", message=f"✅ Model found in HF cache: {match}")
                 load_path = match
                 break

    if load_path:
        _emit("log", message="⏳ Loading model into GPU memory (Local/Offline)...")
    else:
        _emit("log", message="⬇️ First run — downloading model from HuggingFace...")
        load_path = model_name

    processor = AutoProcessor.from_pretrained(
        load_path, cache_dir=model_cache_dir, trust_remote_code=True
    )
    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        load_path, cache_dir=model_cache_dir, trust_remote_code=True,
        torch_dtype=dtype,
    ).to(device)

    # ── Process audio ──
    _emit("progress", percent=50, message="Processing audio...")
    audio_input, sample_rate = sf.read(audio_path)

    inputs = processor(audio_input, sampling_rate=sample_rate,
                       return_tensors="pt").to(device)

    _emit("progress", percent=70, message="Transcribing...")
    with torch.no_grad():
        generated_ids = model.generate(**inputs, max_new_tokens=512)

    transcription = processor.batch_decode(generated_ids, skip_special_tokens=True)
    text = transcription[0] if transcription else ""

    # ── Write SRT ──
    _emit("progress", percent=90, message="Saving results...")
    srt_content = f"1\n00:00:00,000 --> 00:00:00,000\n{text}\n"
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write(srt_content)

    # ── Write result JSON ──
    output = {"text": text, "srt_path": srt_path}
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)

    _emit("progress", percent=100, message=f"Done: {len(text)} chars")
    _emit("result", data={"text": text, "srt_path": srt_path, "chars": len(text)})


if __name__ == "__main__":
    main()
