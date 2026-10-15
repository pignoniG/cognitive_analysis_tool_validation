#!/usr/bin/env python3
"""Generate the spoken digits and instructions of the n-back with Piper (offline text-to-speech).

    pip install piper-tts numpy
    python tools/make_audio.py                         # the chosen voices into assets/audio/<lang>/
    python tools/make_audio.py --candidates            # every candidate voice into audio_candidates/, to compare

Each clip is trimmed so that speech starts at its first sample (the onset the presenter logs is the onset of
speech), given a 3 ms fade-in and a 20 ms fade-out, and scaled to the same loudness (RMS over the speech).
Clips are 16-bit mono WAV: compressed formats add encoder delay, which would shift the onsets. A manifest.json
per language lists every clip with its text, duration and level, and the voice with its licence.

The voices are downloaded once from https://huggingface.co/rhasspy/piper-voices into --models.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import wave
from datetime import date
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"

# Candidate voices, with what their model cards say about the training data. The first of each language is used
# unless --voice says otherwise.
VOICES = {
    "it": {
        "paola": {"model": "it/it_IT/paola/medium/it_IT-paola-medium",
                  "data": "Voice-Dataset-Italian (paolapersico1), CC0 1.0"},
        "serena": {"model": "it/it_IT/serena/high/it_IT-serena-high",
                   "data": "serena-synthetic-it-27h (committa), CC BY 4.0"},
    },
    "en": {
        "cori": {"model": "en/en_GB/cori/high/en_GB-cori-high",
                 "data": "LibriVox recordings, public domain"},
        "alba": {"model": "en/en_GB/alba/medium/en_GB-alba-medium",
                 "data": "Edinburgh DataShare 10283/3270, CC BY 4.0"},
    },
}

DIGITS = {
    "it": ["uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove"],
    "en": ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"],
}


def phrases(lang: str) -> dict[str, str]:
    """Every clip of a language: id -> text."""
    d = DIGITS[lang]
    out = {f"digit_{i + 1}": f"{w.capitalize()}." for i, w in enumerate(d)}
    if lang == "it":
        out |= {
            "rest": "Riposo. Tieni lo sguardo sul punto.",
            **{f"back_0_{i + 1}": f"Zero indietro. Premi quando senti {w}." for i, w in enumerate(d)},
            "back_1": "Uno indietro. Premi quando il numero è uguale al precedente.",
            "back_2": "Due indietro. Premi quando il numero è uguale a quello di due prima.",
            "back_3": "Tre indietro. Premi quando il numero è uguale a quello di tre prima.",
            "start": "Via.",
            "end": "Fine. Grazie.",
        }
    else:
        out |= {
            "rest": "Rest. Keep your eyes on the dot.",
            **{f"back_0_{i + 1}": f"Zero back. Press when you hear {w}." for i, w in enumerate(d)},
            "back_1": "One back. Press when the number is the same as the one before.",
            "back_2": "Two back. Press when the number is the same as two before.",
            "back_3": "Three back. Press when the number is the same as three before.",
            "start": "Start.",
            "end": "The end. Thank you.",
        }
    return out


TARGET_RMS_DB = -23.0     # loudness of the speech in every clip
PEAK_LIMIT_DB = -1.0
GATE_DB = -40.0           # a 10 ms window is speech when its RMS is within 40 dB of the clip's loudest window


def download(model: str, models: Path) -> Path:
    path = models / (Path(model).name + ".onnx")
    for suffix in (".onnx", ".onnx.json"):
        target = models / (Path(model).name + suffix)
        if not target.exists():
            models.mkdir(parents=True, exist_ok=True)
            print(f"  downloading {model}{suffix}")
            urllib.request.urlretrieve(HF + model + suffix, target)
    return path


def espeak_dir(models: Path) -> Path:
    """Piper's espeak-ng data, by a path espeak-ng can hold: it keeps the path in a 160-character buffer and, when
    the path is longer (a deep virtual environment), silently falls back to its build machine's path and fails
    ("Error processing file .../phontab"). A longer path is replaced by a symlink next to the models."""
    from piper.phonemize_espeak import ESPEAK_DATA_DIR

    if len(str(ESPEAK_DATA_DIR)) < 150:
        return ESPEAK_DATA_DIR
    link = models.parent / "espeak-ng-data"
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(ESPEAK_DATA_DIR, target_is_directory=True)
    if len(str(link)) >= 150:
        sys.exit(f"The espeak-ng data path is too long for espeak-ng: use a shorter --models folder ({link})")
    return link


def db(x: float) -> float:
    return 20 * np.log10(max(x, 1e-12))


def process(audio: np.ndarray, rate: int) -> tuple[np.ndarray, dict]:
    """Trim to the speech, fade the edges and scale to the common loudness."""
    win = int(0.010 * rate)
    n = len(audio) // win
    rms = np.sqrt(np.mean(audio[: n * win].reshape(n, win) ** 2, axis=1))
    loud = np.flatnonzero(rms > rms.max() * 10 ** (GATE_DB / 20))
    a, b = loud[0] * win, min(len(audio), (loud[-1] + 1) * win)
    # start exactly where the speech crosses the gate within its first window, so the onset is the first sample
    first = audio[a : a + win]
    above = np.flatnonzero(np.abs(first) > rms.max() * 10 ** (GATE_DB / 20))
    a += int(above[0]) if len(above) else 0
    clip = audio[a:b].astype(np.float64)
    speech_rms = np.sqrt(np.mean(clip**2))
    gain = 10 ** (TARGET_RMS_DB / 20) / speech_rms
    peak = np.abs(clip).max() * gain
    limited = peak > 10 ** (PEAK_LIMIT_DB / 20)
    if limited:
        gain *= 10 ** (PEAK_LIMIT_DB / 20) / peak
    clip *= gain
    fi, fo = int(0.003 * rate), int(0.020 * rate)
    clip[:fi] *= np.linspace(0, 1, fi)
    clip[-fo:] *= np.linspace(1, 0, fo)
    return clip, {"rms_dbfs": round(db(np.sqrt(np.mean(clip**2))), 2), "peak_dbfs": round(db(np.abs(clip).max()), 2),
                  "peak_limited": bool(limited), "trimmed_lead_s": round(a / rate, 4)}


def write_wav(path: Path, clip: np.ndarray, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.round(np.clip(clip, -1, 1) * 32767).astype("<i2").tobytes())


def generate(lang: str, name: str, out: Path, models: Path) -> None:
    from piper import PiperVoice, SynthesisConfig

    voice_info = VOICES[lang][name]
    voice = PiperVoice.load(download(voice_info["model"], models), espeak_data_dir=espeak_dir(models))
    config = SynthesisConfig(normalize_audio=False)
    out.mkdir(parents=True, exist_ok=True)
    clips = {}
    for cid, text in phrases(lang).items():
        chunks = list(voice.synthesize(text, syn_config=config))
        rate = chunks[0].sample_rate
        audio = np.concatenate([c.audio_float_array for c in chunks])
        clip, info = process(audio, rate)
        write_wav(out / f"{cid}.wav", clip, rate)
        clips[cid] = {"text": text, "file": f"{cid}.wav", "duration_s": round(len(clip) / rate, 4), **info}
    manifest = {
        "language": lang, "voice": name, "model": voice_info["model"], "training_data": voice_info["data"],
        "engine": "Piper (piper-tts), https://github.com/OHF-Voice/piper1-gpl", "generated": date.today().isoformat(),
        "sample_rate": rate, "target_rms_dbfs": TARGET_RMS_DB, "clips": clips,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    longest = max(clips.values(), key=lambda c: c["duration_s"])
    digits = [clips[f"digit_{i}"]["duration_s"] for i in range(1, 10)]
    print(f"{lang}/{name}: {len(clips)} clips; digits {min(digits):.2f}–{max(digits):.2f} s; "
          f"longest {longest['file']} {longest['duration_s']:.2f} s")


def candidates_page(root: Path) -> None:
    """An HTML page to listen to every candidate voice side by side."""
    rows = []
    for lang, voices in VOICES.items():
        ids = list(phrases(lang))
        head = "".join(f"<th>{v}<br><small>{VOICES[lang][v]['data']}</small></th>" for v in voices)
        body = "".join(
            f"<tr><td>{cid}<br><small>{phrases(lang)[cid]}</small></td>"
            + "".join(f'<td><audio controls preload="none" src="{lang}/{v}/{cid}.wav"></audio></td>' for v in voices)
            + "</tr>" for cid in ids)
        rows.append(f"<h2>{lang}</h2><table><tr><th>clip</th>{head}</tr>{body}</table>")
    (root / "index.html").write_text(
        "<!doctype html><meta charset=utf-8><title>Voice candidates</title>"
        "<style>body{font:14px system-ui;margin:16px}td,th{padding:4px 8px;border-bottom:1px solid #ccc;text-align:left}"
        "small{color:#666}audio{height:32px}</style><h1>Voice candidates</h1>" + "".join(rows))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--candidates", action="store_true", help="every candidate voice into audio_candidates/")
    ap.add_argument("--voice", action="append", default=[], metavar="LANG=NAME", help="choose a voice, e.g. it=serena")
    ap.add_argument("--models", type=Path, default=Path.home() / ".cache" / "validation-task" / "piper")
    args = ap.parse_args()
    if args.candidates:
        root = ROOT / "audio_candidates"
        for lang, voices in VOICES.items():
            for name in voices:
                generate(lang, name, root / lang / name, args.models)
        candidates_page(root)
        print(f"Listen at audio_candidates/index.html (served by server.py)")
        return 0
    chosen = {lang: next(iter(v)) for lang, v in VOICES.items()}
    for item in args.voice:
        lang, _, name = item.partition("=")
        if name not in VOICES.get(lang, {}):
            ap.error(f"unknown voice {item}")
        chosen[lang] = name
    for lang, name in chosen.items():
        generate(lang, name, ROOT / "assets" / "audio" / lang, args.models)
    return 0


if __name__ == "__main__":
    sys.exit(main())
