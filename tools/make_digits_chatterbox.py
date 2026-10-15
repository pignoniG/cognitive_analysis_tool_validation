#!/usr/bin/env python3
"""Generate the Italian digits with Chatterbox Multilingual (Resemble AI, MIT), imitating the Kokoro voice of the
Italian phrases.

    # Python 3.10–3.13, in its own environment (PyTorch, about 3 GB of model on the first run)
    pip install chatterbox-tts "setuptools<81" numpy
    python tools/make_audio.py                       # first: the phrases, which are also the voice to imitate
    python tools/make_digits_chatterbox.py           # then: digit_1..9.wav into assets/audio/it/
    python tools/make_digits_chatterbox.py --takes 3=3,9=2    # another take for some digits

Kokoro's Italian voices read the phrases well but single digits badly, so the digits come from here. Chatterbox
is given about 12 s of the phrases as the voice to imitate. Its synthesis is random, so each digit is generated
with a fixed seed per take (take k of digit d uses seed 100 k + d); the chosen takes are listed in TAKES. Single
words sometimes go on with babble after a pause: `first_utterance` cuts it off, then the clip is trimmed and
levelled like every other clip (make_audio.process). Chatterbox marks everything it generates with an inaudible
watermark (Perth), which stays in the clips.
"""

from __future__ import annotations

import argparse
import json
import sys
import wave
from datetime import date
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_audio as M  # noqa: E402

ROOT = M.ROOT
LANG = "it"
REFERENCE_CLIPS = ("rest", "back_1", "back_2", "end")
TAKES = {d: 1 for d in range(1, 10)}       # digit -> take, chosen by listening (October 2026)


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768, w.getframerate()


def reference(folder: Path, out: Path) -> Path:
    """The phrases of `folder`, 0.3 s apart, as the voice to imitate."""
    parts, rate = [], None
    for cid in REFERENCE_CLIPS:
        a, rate = read_wav(folder / f"{cid}.wav")
        parts += [a, np.zeros(int(0.3 * rate), np.float32)]
    M.write_wav(out, np.concatenate(parts).astype(np.float64), rate)
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--takes", default="", help="digit=take pairs overriding TAKES, e.g. 3=3,9=2")
    ap.add_argument("--out", type=Path, default=ROOT / "assets" / "audio" / LANG)
    args = ap.parse_args()
    takes = dict(TAKES)
    for pair in filter(None, args.takes.split(",")):
        d, _, k = pair.partition("=")
        takes[int(d)] = int(k)

    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    voice = manifest["voice"]
    ref = reference(args.out, args.out.parent / f"reference_{LANG}.wav.tmp")
    device = "mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu"
    tts = ChatterboxMultilingualTTS.from_pretrained(device=device)
    tts.prepare_conditionals(str(ref))
    ref.unlink()

    for d, word in enumerate(M.DIGITS[LANG], 1):
        text = f"{word.capitalize()}."
        torch.manual_seed(100 * takes[d] + d)
        raw = tts.generate(text, language_id=LANG).squeeze(0).numpy().astype(np.float64)
        cut = M.first_utterance(raw, tts.sr)
        clip, levels = M.process(cut, tts.sr)
        M.write_wav(args.out / f"digit_{d}.wav", clip, tts.sr)
        manifest["clips"][f"digit_{d}"] = {
            "text": text, "file": f"digit_{d}.wav", "duration_s": round(len(clip) / tts.sr, 4), **levels,
            "engine": "Chatterbox Multilingual (ResembleAI/chatterbox, MIT), Perth watermark",
            "imitating": f"Kokoro {voice} ({', '.join(REFERENCE_CLIPS)})", "take": takes[d], "seed": 100 * takes[d] + d,
            "cut_after_s": round(len(cut) / tts.sr, 3), "raw_s": round(len(raw) / tts.sr, 3), "device": device,
            "generated": date.today().isoformat(),
        }
        print(f"{word}: take {takes[d]}, {len(raw) / tts.sr:.2f} s generated, {len(clip) / tts.sr:.2f} s kept")
    manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"Listen at {M.clips_page().relative_to(ROOT)} (served by server.py)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
