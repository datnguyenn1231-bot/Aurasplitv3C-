"""
align_words.py — Post-WhisperX alignment script.

Usage: python align_words.py <words_json_path> <script_path>

Reads WhisperX words JSON + script file → aligns using SequenceMatcher
→ writes cut_points back to the words JSON file.
"""
import json, re, os, sys
from difflib import SequenceMatcher


def clean_word(text):
    """Strip ASCII punctuation, lowercase ASCII, keep UTF-8."""
    return ''.join(
        ch.lower() if ord(ch) < 128 else ch
        for ch in text
        if not (ord(ch) < 128 and not ch.isalnum() and ch != ' ')
    ).strip()


def align(words_json_path, script_path):
    # Load words
    with open(words_json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    whisper_words = data["words"]

    # Load and parse script
    with open(script_path, "r", encoding="utf-8") as f:
        script = f.read()
    items = re.findall(r'\[V(\d+)\]\s*([^\[]+)', script, re.IGNORECASE)
    if not items:
        print(json.dumps({"type": "log", "message": "[ALIGN] No [V] items found in script"}))
        return

    # Build flat word lists
    script_words = []
    for vid_str, text in items:
        vid = int(vid_str)
        cleaned = clean_word(text)
        for w in cleaned.split():
            if w.strip():
                script_words.append((w, vid))

    w_clean = [clean_word(w.get("word", "")) for w in whisper_words]

    # Sequence alignment
    s_texts = [sw[0] for sw in script_words]
    matcher = SequenceMatcher(None, s_texts, w_clean, autojunk=False)

    # Map script → whisper
    s2w = {}
    for block in matcher.get_matching_blocks():
        for i in range(block.size):
            s2w[block.a + i] = block.b + i

    matched = len(s2w)
    print(json.dumps({"type": "log", "message": f"[ALIGN] Matched {matched}/{len(s_texts)} words ({matched/len(s_texts)*100:.1f}%)"}))

    # Group by videoId
    vid_data = {}
    for s_idx, (word, vid) in enumerate(script_words):
        if vid not in vid_data:
            vid_data[vid] = {"start": None, "end": None, "text": "", "matched": 0, "total": 0}
        vid_data[vid]["total"] += 1
        if s_idx in s2w:
            w_idx = s2w[s_idx]
            ws = whisper_words[w_idx].get("start", 0)
            we = whisper_words[w_idx].get("end", 0)
            if vid_data[vid]["start"] is None or ws < vid_data[vid]["start"]:
                vid_data[vid]["start"] = ws
            if vid_data[vid]["end"] is None or we > vid_data[vid]["end"]:
                vid_data[vid]["end"] = we
            vid_data[vid]["matched"] += 1

    # Text labels
    for vid_str, text in items:
        vid = int(vid_str)
        if vid in vid_data:
            vid_data[vid]["text"] = text.strip()[:60]

    # Fill unmatched gaps
    vids = sorted(vid_data.keys())
    for i, vid in enumerate(vids):
        if vid_data[vid]["start"] is None:
            prev_end = 0
            for j in range(i - 1, -1, -1):
                if vid_data[vids[j]]["end"] is not None:
                    prev_end = vid_data[vids[j]]["end"]
                    break
            next_start = whisper_words[-1]["end"] if whisper_words else 0
            for j in range(i + 1, len(vids)):
                if vid_data[vids[j]]["start"] is not None:
                    next_start = vid_data[vids[j]]["start"]
                    break
            vid_data[vid]["start"] = prev_end
            vid_data[vid]["end"] = next_start

    # Padding using raw timestamps
    raw_starts = {vid: vid_data[vid]["start"] for vid in vids}
    raw_ends = {vid: vid_data[vid]["end"] for vid in vids}

    for i, vid in enumerate(vids):
        if i + 1 < len(vids):
            gap = raw_starts[vids[i + 1]] - raw_ends[vid]
            if gap > 0:
                vid_data[vid]["end"] = raw_ends[vid] + min(0.5, gap * 0.5)
            else:
                vid_data[vid]["end"] = raw_ends[vid]
        else:
            vid_data[vid]["end"] = raw_ends[vid] + 0.5

        if i > 0:
            vid_data[vid]["start"] = max(raw_starts[vid] - 0.05, vid_data[vids[i - 1]]["end"])
        else:
            vid_data[vid]["start"] = max(0, raw_starts[vid] - 0.05)

    # Build cut_points
    cut_points = []
    for vid in vids:
        d = vid_data[vid]
        cut_points.append({
            "videoId": vid,
            "startTime": round(d["start"], 3),
            "endTime": round(d["end"], 3),
            "text": d["text"],
        })

    # Write back to words JSON
    data["cut_points"] = cut_points
    with open(words_json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)

    print(json.dumps({"type": "log", "message": f"[ALIGN] ✅ {len(cut_points)} cut points written"}))


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"type": "error", "message": "Usage: align_words.py <words_json> <script_path>"}))
        sys.exit(1)
    align(sys.argv[1], sys.argv[2])
