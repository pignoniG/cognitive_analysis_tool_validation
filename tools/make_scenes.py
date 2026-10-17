#!/usr/bin/env python3
"""Convert the chosen Poly Haven panoramas (CC0) to the 8-bit images the presenter shows.

    pip install numpy opencv-python
    # the .hdr files from https://polyhaven.com/hdris (Download > HDR), named <slug>.hdr: the 8k in one folder
    # (the headset's panoramas) and the 16k in another (the monitor's crops; 370 MB each, 3 GB of memory to convert)
    python tools/make_scenes.py --panoramas ~/hdr8k --views ~/hdr16k
    python tools/make_scenes.py --panoramas ~/hdr8k --views ~/hdr16k --sheet scenes_work/   # + a contact sheet

Two images per scene in assets/scenes: `<id>.jpg`, the 8192 x 4096 equirectangular panorama (the headset, world-locked),
and `<id>_view.jpg`, a rectilinear crop of the 16k panorama (the monitor): 90 x 60 degrees around the scene's view
direction at the 16k's own resolution (about 45 pixels per degree, 5214 x 3010), drawn flat at its true angular size.
The monitor never shows more than about 70 x 40 degrees, so the crop covers any viewing distance from 62 cm out for a
55-inch screen.

The panoramas are in arbitrary relative units, so each scene gets one fixed exposure (a gain on the linear values)
chosen so that its mean displayed luminance (sphere-weighted, after clipping at white) is the `mean` set below.
The set then spans dark to bright on purpose, whatever the photographer's exposure was. There is no tone mapping:
values above white are clipped, and the sun or lamps stay white. The panorama's gain is found on the whole sphere (the
headset shows any part of it); the crop's gain is found on the crop itself (the monitor shows only that), for the
same mean. Gains, means and clipped fractions are in the manifest.

`yaw` is the azimuth of the view direction in degrees from the image centre, positive to the right.
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "scenes"
W709 = np.array([0.2126, 0.7152, 0.0722])

# id: Poly Haven slug, label, author, the mean displayed luminance wanted (linear, 0-1), view direction
SCENES = [
    dict(id="night",    slug="pond_bridge_night",  label="Pond Bridge Night",  author="Greg Zaal",      mean=0.010, yaw=0),
    dict(id="indoor",   slug="empty_warehouse_01", label="Empty Warehouse 01", author="Sergej Majboroda", mean=0.080, yaw=0),
    dict(id="overcast", slug="potsdamer_platz",    label="Potsdamer Platz",    author="Greg Zaal",      mean=0.200, yaw=0),
    dict(id="bright",   slug="noon_grass",         label="Noon Grass",         author="Greg Zaal",      mean=0.350, yaw=0),
]
VIEW = (90, 60)            # the monitor's crop, degrees
HEADSET = (120, 105)       # the headset's field, degrees: the contact sheet shows it for the panorama


def load(path: Path) -> np.ndarray:
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise SystemExit(f"cannot read {path}")
    return np.ascontiguousarray(im[:, :, ::-1])        # BGR -> RGB, linear, float32


def sphere_weights(h: int, w: int) -> np.ndarray:
    lat = (np.arange(h) + 0.5) / h * np.pi - np.pi / 2
    return np.cos(lat)[:, None] * np.ones((h, w))


def srgb(lin: np.ndarray) -> np.ndarray:
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)


def displayed_mean(lin: np.ndarray, weights: np.ndarray, gain: float) -> float:
    y = np.clip(lin * gain, 0, 1) @ W709
    return float((y * weights).sum() / weights.sum())


def solve_gain(lin: np.ndarray, weights: np.ndarray, target: float) -> float:
    lo, hi = 1e-6, 1e6                                 # the displayed mean rises with the gain
    for _ in range(60):
        mid = np.sqrt(lo * hi)
        lo, hi = (mid, hi) if displayed_mean(lin, weights, mid) < target else (lo, mid)
    return float(np.sqrt(lo * hi))


def rectilinear(img: np.ndarray, hfov: float, vfov: float, yaw: float, size: tuple[int, int]) -> np.ndarray:
    """The view straight ahead at azimuth `yaw`, as a camera sees it, from an equirectangular image."""
    w, h = size
    x = (np.arange(w) + 0.5) / w * 2 - 1
    y = 1 - (np.arange(h) + 0.5) / h * 2
    gx, gy = np.meshgrid(x * np.tan(np.radians(hfov / 2)), y * np.tan(np.radians(vfov / 2)))
    lon = np.arctan2(gx, 1.0) + np.radians(yaw)
    lat = np.arctan2(gy, np.hypot(gx, 1.0))
    ih, iw = img.shape[:2]
    mapx = ((lon / (2 * np.pi) + 0.5) % 1.0) * iw
    mapy = (0.5 - lat / np.pi) * ih
    return cv2.remap(img, mapx.astype(np.float32), mapy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def to_jpeg(path: Path, linear: np.ndarray, quality: int) -> np.ndarray:
    rgb8 = np.round(srgb(linear) * 255).astype(np.uint8)
    cv2.imwrite(str(path), rgb8[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, quality,
                                              cv2.IMWRITE_JPEG_SAMPLING_FACTOR, cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444])
    return rgb8


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--panoramas", required=True, type=Path, help="folder with the 8k <slug>.hdr")
    ap.add_argument("--views", required=True, type=Path, help="folder with the 16k <slug>.hdr")
    ap.add_argument("--sheet", type=Path, help="folder for the contact sheet")
    ap.add_argument("--quality", type=int, default=92)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    manifest, tiles = [], []
    for s in SCENES:
        pano = load(args.panoramas.expanduser() / f"{s['slug']}.hdr")
        h, w = pano.shape[:2]
        wts = sphere_weights(h, w)
        gain = solve_gain(pano.astype(np.float64), wts, s["mean"])
        scaled = np.clip(pano * np.float32(gain), 0, 1)
        rgb8 = to_jpeg(OUT / f"{s['id']}.jpg", scaled, args.quality)
        y = scaled.astype(np.float64) @ W709
        clipped = float(((pano * np.float32(gain) >= 1).any(axis=2) * wts).sum() / wts.sum())   # a channel at white
        headset = rectilinear(scaled, *HEADSET, s["yaw"], (480, 420))
        # the monitor's crop, from the 16k panorama at its own resolution
        big = load(args.views.expanduser() / f"{s['slug']}.hdr")
        f = big.shape[1] / (2 * np.pi)                                  # pixels per radian at the centre
        vw, vh = round(2 * f * np.tan(np.radians(VIEW[0] / 2))), round(2 * f * np.tan(np.radians(VIEW[1] / 2)))
        crop_lin = rectilinear(big, *VIEW, s["yaw"], (vw, vh))
        del big
        # the monitor shows only the crop, whose mean differs from the sphere's: its own exposure for the same mean
        vgain = solve_gain(crop_lin[::4, ::4], np.ones(crop_lin[::4, ::4].shape[:2]), s["mean"])
        crop = np.clip(crop_lin * np.float32(vgain), 0, 1)
        to_jpeg(OUT / f"{s['id']}_view.jpg", crop, 95)
        crop_y = crop.astype(np.float64) @ W709
        manifest.append(dict(
            id=s["id"], file=f"{s['id']}.jpg", label=s["label"], yaw=s["yaw"], size=[w, h],
            view=dict(file=f"{s['id']}_view.jpg", fov_deg=list(VIEW), size=[vw, vh],
                      gain=round(vgain, 6), ev=round(float(np.log2(vgain)), 3),
                      pixels_per_degree=round(f * np.pi / 180, 1),
                      mean_linear_y=round(float(crop_y.mean()), 4),
                      clipped_fraction=round(float((crop >= 1).any(axis=2).mean()), 4)),
            source=f"https://polyhaven.com/a/{s['slug']}", author=s["author"], licence="CC0",
            gain=round(gain, 6), ev=round(float(np.log2(gain)), 3),
            mean_linear_y=round(float((y * wts).sum() / wts.sum()), 4), clipped_fraction=round(clipped, 4),
            headset_view_mean_linear_y=round(float((headset @ W709).mean()), 4)))
        m = manifest[-1]
        print(f"{s['id']:9} {s['slug']:20} gain {gain:9.5f} ({np.log2(gain):+6.2f} EV)  sphere mean Y {m['mean_linear_y']:.3f}, "
              f"clipped {clipped * 100:5.2f} %  | crop {vw}x{vh} mean Y {m['view']['mean_linear_y']:.3f}, "
              f"clipped {m['view']['clipped_fraction'] * 100:5.2f} %", flush=True)
        if args.sheet:
            eq = cv2.resize(rgb8, (960, 480), interpolation=cv2.INTER_AREA)
            tile = np.zeros((480 + 420, 960, 3), np.uint8)
            tile[:480] = eq
            tile[480:, :480] = np.round(srgb(headset) * 255).astype(np.uint8)
            tile[480:, 480:] = cv2.resize(np.round(srgb(crop) * 255).astype(np.uint8), (480, 420), interpolation=cv2.INTER_AREA)
            cv2.putText(tile, f"{s['id']}: {s['label']}  mean Y {m['mean_linear_y']:.3f}", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.putText(tile, "headset 120x105", (10, 510), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(tile, "monitor crop 90x60 (squeezed)", (490, 510), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1, cv2.LINE_AA)
            tiles.append(tile)
    (OUT / "manifest.json").write_text(json.dumps(dict(
        generated=date.today().isoformat(), tool="tools/make_scenes.py",
        note="8-bit sRGB images from Poly Haven HDRIs (CC0): an 8k equirectangular panorama for the headset and a "
             "16k-resolution crop for the monitor; one fixed exposure per scene, hard clip at white, no tone mapping",
        scenes=manifest), indent=1) + "\n")
    if args.sheet:
        args.sheet.mkdir(parents=True, exist_ok=True)
        top = np.hstack(tiles[:2])
        bottom = np.hstack(tiles[2:4]) if len(tiles) > 2 else np.zeros_like(top)
        cv2.imwrite(str(args.sheet / "contact_sheet.jpg"), np.vstack([top, bottom])[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 90])


if __name__ == "__main__":
    main()
