"""Tutorial figures (app/tuto/*.webp) rendered from the synthetic phantom.

The original figures were screenshots of real acquisitions. These ones are
rendered from tools/phantom.py output, with the colours of the annotator, so
that the tutorial can be published without any patient data.

Usage:
    python tools/make_tutorial_images.py phantom_data/phantom01.npz --out app/tuto
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

BG = np.array([5, 8, 11], float)
MARK = np.array([127, 212, 245], float)      # candidate being judged
OTHER = np.array([138, 90, 46], float)       # other detected shapes
SKIN = (216, 201, 163)
ADDED = np.array([242, 193, 78], float)
CUT = np.array([177, 75, 255], float)
REMOVED = np.array([235, 56, 46], float)
PART_B = np.array([255, 128, 64], float)
SIZE = 360


def grey(sig, lo=0.08, hi=0.85, gamma=0.9):
    t = np.clip((sig - lo) / (hi - lo), 0, 1) ** gamma
    return BG + (255 - BG) * t[..., None]


def blend(img, mask, colour, a=0.72):
    img = img.copy()
    img[mask] = img[mask] * (1 - a) + colour * a
    return img


def finish(img, scale_xy=(1, 1)):
    """float image (rows, cols, 3) -> square PIL image, nearest upscaling."""
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
    w, h = im.size
    w2, h2 = int(w * scale_xy[0]), int(h * scale_xy[1])
    im = im.resize((w2, h2), Image.NEAREST)
    s = SIZE / max(w2, h2)
    im = im.resize((max(1, int(w2 * s)), max(1, int(h2 * s))), Image.NEAREST)
    canvas = Image.new("RGB", (SIZE, SIZE), tuple(int(c) for c in BG))
    canvas.paste(im, ((SIZE - im.size[0]) // 2, (SIZE - im.size[1]) // 2))
    return canvas


def box_around(mask, pad, shape):
    sl = ndi.find_objects(mask.astype(np.int32))[0]
    return tuple(slice(max(s.start - pad, 0), min(s.stop + pad, n)) for s, n in zip(sl, shape))


def side_view(sig, lab, skin, label, others=True, pad=18):
    """Profile: x to the right, z (out of the skin) up. Like the 3D view at load."""
    cand = lab == label
    bx = box_around(cand, pad, sig.shape)
    # the skin must be in the frame: extend the depth window around it
    zsk = skin[bx[0], bx[1]]
    zlo = int(min(bx[2].start, np.nanmin(zsk) - 12))
    zhi = int(max(bx[2].stop, np.nanmax(zsk) + 12))
    bx = (bx[0], bx[1], slice(max(zlo, 0), min(zhi, sig.shape[2])))
    s, c, o = sig[bx], cand[bx], (lab[bx] > 0) & ~cand[bx]
    img = grey(s.max(axis=1).T[::-1])
    if others:
        img = blend(img, o.any(axis=1).T[::-1], OTHER, 0.55)
    img = blend(img, c.any(axis=1).T[::-1], MARK)
    pil = finish(img, (1, 0.5))                      # z voxels are half as thick
    # skin line (median over y of the box), drawn like the app's skin sheet
    zs = np.nanmedian(skin[bx[0], bx[1]], axis=1) - bx[2].start
    d = ImageDraw.Draw(pil)
    nz = s.shape[2]
    w, h = s.shape[0], nz * 0.5
    sc = SIZE / max(w, h)
    ox, oy = (SIZE - w * sc) / 2, (SIZE - h * sc) / 2
    pts = [(ox + (i + 0.5) * sc, oy + (nz - zs[i]) * 0.5 * sc) for i in range(len(zs))]
    d.line(pts, fill=SKIN, width=2)
    return pil


def top_view(sig, lab, label, region=None, pad=18, colour_extra=None):
    cand = lab == label
    bx = region or box_around(cand, pad, sig.shape)
    s, c, o = sig[bx], cand[bx], (lab[bx] > 0) & ~cand[bx]
    img = grey(s.max(axis=2).T[::-1])
    img = blend(img, o.any(axis=2).T[::-1], OTHER, 0.55)
    img = blend(img, c.any(axis=2).T[::-1], MARK)
    if colour_extra:
        for m, col in colour_extra:
            img = blend(img, m[bx].any(axis=2).T[::-1], col)
    return img, bx


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("volume", help="phantom .npz (with its .truth.json next to it)")
    ap.add_argument("--out", default="app/tuto")
    a = ap.parse_args()
    p = Path(a.volume)
    d = np.load(p)
    # files use z growing into the tissue; figures are drawn with z out of the skin
    sig, lab = d["signal"][:, :, ::-1], d["labels"][:, :, ::-1]
    skin = (sig.shape[2] - 1 - d["skin"]).astype(np.float32)
    kinds = {int(k): v for k, v in json.loads(p.with_suffix("").with_suffix(".truth.json").read_text()).items()} \
        if p.with_suffix("").with_suffix(".truth.json").exists() else \
        json.loads((p.parent / (p.stem + ".truth.json")).read_text())
    kinds = {int(k): v for k, v in kinds.items()}
    sizes = ndi.sum(np.ones_like(lab), lab, index=list(kinds))
    by = lambda kind: [k for k, n in sorted(zip(kinds, sizes), key=lambda t: -t[1]) if kinds[k] == kind]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    save = lambda im, name: im.save(out / f"{name}.webp", quality=88)

    vessel, noise, merged = by("vessel")[0], by("noise")[0], by("merged")[0]

    def z_extent(k):
        z = np.argwhere(lab == k)[:, 2]
        return int(z.max() - z.min())
    hair = sorted(by("hair"), key=z_extent)[-2]       # a hair leaving the skin at an angle

    # 1. natures, in profile
    save(side_view(sig, lab, skin, hair), "hair")
    save(side_view(sig, lab, skin, vessel), "vessel")
    save(side_view(sig, lab, skin, noise, pad=24), "blob")
    # hair above the skin: the hair whose centroid sits highest above the surface
    def height(k):
        z = np.argwhere(lab == k)
        return float(np.mean(z[:, 2] - skin[z[:, 0], z[:, 1]]))
    save(side_view(sig, lab, skin, max(by("hair"), key=height)), "hair_above")
    # vessel crossing the DRAWN skin: the estimated surface is off, here drawn
    # through the vessel. The skin is a clue, not a rule.
    v = np.argwhere(lab == vessel)
    drawn = skin + (np.median(v[:, 2]) - np.median(skin[v[:, 0], v[:, 1]]))
    tilt = np.linspace(-6, 6, skin.shape[0])[:, None]          # and slightly tilted
    save(side_view(sig, lab, (drawn + tilt).astype(np.float32), vessel, pad=24), "vessel_cross")

    # 2. the two views and the zoomed-out projection
    save(side_view(sig, lab, skin, vessel, pad=30), "view_volume")
    img, bx = top_view(sig, lab, vessel, pad=30)
    save(finish(img), "view_mip")
    full = grey(sig.max(axis=2).T[::-1])
    full = blend(full, (lab > 0).any(axis=2).T[::-1], OTHER, 0.45)
    full = blend(full, (lab == vessel).any(axis=2).T[::-1], MARK)
    pil = finish(full)
    sc = SIZE / max(sig.shape[:2])
    Y = sig.shape[1]
    ImageDraw.Draw(pil).rectangle([bx[0].start * sc, (Y - bx[1].stop) * sc, bx[0].stop * sc, (Y - bx[1].start) * sc],
                                  outline=(229, 72, 77), width=2)
    save(pil, "view_mipout")

    # 3. one outline covering two objects (hair crossing a vessel), then cut
    m = lab == merged
    save(side_view(sig, lab, skin, merged), "merge_before3d")
    img, bx = top_view(sig, lab, merged)
    save(finish(img), "merge_beforemip")
    # part B = the steep part (the hair): voxels far above the vessel's depth
    zmed = np.median(np.argwhere(m)[:, 2])
    partb = m & (np.arange(sig.shape[2])[None, None, :] > zmed + 6)
    cutp = m & (np.abs(np.arange(sig.shape[2])[None, None, :] - (zmed + 6)) < 1.5)
    s, cc = sig[bx], m[bx]
    side = grey(s.max(axis=1).T[::-1])
    side = blend(side, cc.any(axis=1).T[::-1], MARK)
    side = blend(side, partb[bx].any(axis=1).T[::-1], PART_B)
    side = blend(side, cutp[bx].any(axis=1).T[::-1], CUT, 0.9)
    save(finish(side, (1, 0.5)), "merge_after3d")
    img2, _ = top_view(sig, lab, merged, region=bx, colour_extra=[(partb, PART_B), (cutp, CUT)])
    save(finish(img2), "merge_aftermip")

    # 4. missed columns: the bright tip of a hair outside the outline, then added
    hz = np.argwhere(lab == hair)
    tip = hz[np.argmax(hz[:, 2])]
    trimmed = (lab == hair).copy()
    trimmed[max(tip[0] - 8, 0):tip[0] + 9, max(tip[1] - 8, 0):tip[1] + 9, :] = False
    lab2 = np.where(lab == hair, 0, lab)
    lab2[trimmed] = hair
    region = box_around(lab == hair, 18, sig.shape)
    before, _ = top_view(sig, lab2, hair, region=region)
    save(finish(before), "cols_before")
    after = blend(before, ((lab == hair) & ~trimmed)[region].any(axis=2).T[::-1], ADDED)
    save(finish(after), "cols_after")
    print("tutorial figures ->", out)


if __name__ == "__main__":
    main()
