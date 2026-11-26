"""Builds an annotation cohort for the web annotator from 3D volumes.

Each candidate component becomes one "slab": a 48^3 box centred on it, that
readers judge (hair / vessel / noise ..., correct or not, one or several
objects). The output folder is what the page loads (app/data/<name>/):

    cohorte.json          cohort description, one entry per slab
    atlas/pack_NNNN.webp  slabs, 16 per image (lossless)
    ctx/ctx_NNNN.webp     per-slab context: the whole field of view, projected
                          over the slab's exact depth window
    champs/<volume>.webp  whole-volume projection (fallback context)

Input: one .npz per volume (see tools/phantom.py), with
    signal      float (X, Y, Z)   z = depth axis, growing INTO the tissue
                                  (air at low z, then the skin, then tissue)
    labels      int   (X, Y, Z)   candidate components, 0 = background
    skin        float (X, Y)      skin height in z voxels, NaN where unknown
    spacing_mm  float (3,)
All volumes of a cohort must share the same (X, Y) size.

Slab encoding (read by app.js, decodeSlab):
    48 depth planes tiled 8 x 6 in an 8 x 7 grid of 48 x 48 tiles;
    R = sqrt(signal / display ceiling) * 255: the square root spreads the
        dim range, and app.js squares it back (sigOf) for the tracer;
    G = the candidate being judged, B = other candidates (255 / 0);
    tile 48 = skin map: depth on 16 bits in R/G, B = 255 inside the box,
    128 present but outside, 0 absent.

Usage:
    python tools/build_cohort.py phantom_data/*.npz --out app/data/demo \
        --truth phantom_data --truth-out examples/demo_truth.json
"""
from __future__ import annotations

import argparse
import glob
import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

BOX, COLS, ROWS, SKIN_SLOT, PER_PACK = 48, 8, 7, 48, 16
FACTORS = (1, 2, 4)
REDUCTION = 2


def load(path: Path):
    d = np.load(path)
    return (path.stem, d["signal"].astype(np.float32), d["labels"].astype(np.int32),
            d["skin"].astype(np.float32), np.asarray(d["spacing_mm"], float))


def base_step(spacing):
    """Native step per axis so that a voxel is roughly isotropic."""
    ref = spacing[0]
    return [max(1, int(round(ref / s))) for s in spacing]


def crop_pooled(arr, origin, step, reducer, nxy=BOX):
    """Box of nxy x nxy x BOX cells starting at `origin`, each cell pooling
    step voxels. Out-of-volume voxels count as 0."""
    size = [nxy * step[0], nxy * step[1], BOX * step[2]]
    out = np.zeros(size, arr.dtype)
    src, dst = [], []
    for o, n, L in zip(origin, size, arr.shape):
        a, b = max(o, 0), min(o + n, L)
        src.append(slice(a, max(a, b)))
        dst.append(slice(a - o, a - o + max(0, b - a)))
    out[tuple(dst)] = arr[tuple(src)]
    r = out.reshape(nxy, step[0], nxy, step[1], BOX, step[2])
    return reducer(r, axis=(1, 3, 5))


def encode_skin(skin, origin, step, spacing, nxy=BOX):
    """Skin tile (nxy x nxy x 3) and the box's position relative to the skin."""
    X, Y = skin.shape
    tile = np.zeros((nxy, nxy, 3), np.uint8)
    zs = np.full((nxy, nxy), np.nan, np.float32)        # native skin height per column
    for x in range(nxy):
        cx = origin[0] + x * step[0] + step[0] // 2
        if not 0 <= cx < X:
            continue
        for y in range(nxy):
            cy = origin[1] + y * step[1] + step[1] // 2
            if 0 <= cy < Y:
                zs[x, y] = skin[cx, cy]
    zd = (zs - origin[2]) / step[2] - 0.5                # box coordinate of the surface
    ok = np.isfinite(zd)
    inside = ok & (zd >= 0) & (zd <= BOX - 1)
    z16 = np.round((np.clip(np.where(ok, zd, 0), -1, BOX + 1) + 1) * 65535 / (BOX + 2)).astype(np.uint32)
    t = tile.transpose(1, 0, 2)                         # rows = y, columns = x
    t[..., 0] = (z16 >> 8).T
    t[..., 1] = (z16 & 255).T
    t[..., 2] = np.where(inside, 255, np.where(ok, 128, 0)).T
    if inside.any() or not ok.any():
        return tile, "inside", 0.0
    # z grows into the tissue: a box at lower z than the skin is in the air
    z_first, z_last = origin[2], origin[2] + BOX * step[2]
    surf = zs[ok]
    if np.median(surf) >= z_last:                       # skin deeper than the box: slab above the skin
        return tile, "above", float((surf.min() - z_last) * spacing[2])
    return tile, "below", float((z_first - surf.max()) * spacing[2])


def slab_tiles(vol_rgb, skin_tile):
    """(n, n, BOX, 3) volume indexed x, y, z -> one atlas strip of n x n tiles
    (n = BOX for a slab, the halo size for a search tile)."""
    n = vol_rgb.shape[0]
    strip = np.zeros((ROWS * n, COLS * n, 3), np.uint8)
    for z in range(BOX):
        r, c = divmod(z, COLS)
        strip[r * n:(r + 1) * n, c * n:(c + 1) * n] = vol_rgb[:, :, z].transpose(1, 0, 2)
    r, c = divmod(SKIN_SLOT, COLS)
    strip[r * n:(r + 1) * n, c * n:(c + 1) * n] = skin_tile
    return strip


def encode_signal(sig, ceiling):
    """Signal -> 8-bit R channel: square root of the signal divided by the
    volume's display ceiling. app.js expects this coding: its tracer squares
    R back (sigOf) before thresholding at half the local maximum."""
    return np.rint(np.sqrt(np.clip(sig / ceiling, 0, 1)) * 255).astype(np.uint8)


def to_image(xy):
    """(X, Y[, C]) array -> image rows: row 0 = Y max, column 0 = X min."""
    return np.flipud(np.swapaxes(xy, 0, 1))


def downsample_max(a, k):
    X, Y = a.shape[:2]
    a = a[:X - X % k, :Y - Y % k]
    return a.reshape(X // k, k, Y // k, k, *a.shape[2:]).max(axis=(1, 3))


def build_trace(paths, out, a):
    """Search step: tiles of the field of view where readers trace the objects
    the detector MISSED. Each tile is a 48 x 48 window inside a larger margin
    (the halo, 144 x 144 cells by default) that the reader can pan through.
    Detected candidates are drawn as "other shapes" (B), so that nobody traces
    them again; G stays empty (no candidate to judge)."""
    halo = a.halo
    rng = np.random.default_rng(a.seed)
    for sub in ("halo", "ctx", "champs"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    tiles, fields, truth, shape_xy, strips, ctx_imgs = [], {}, {}, None, [], []
    first_step = None
    for path in paths:
        d = np.load(path)
        name = path.stem
        sig, lab, skin = d["signal"].astype(np.float32), d["labels"], d["skin"].astype(np.float32)
        spacing = np.asarray(d["spacing_mm"], float)
        missed = d["missed"] if "missed" in d.files else None
        X, Y, Z = sig.shape
        shape_xy = shape_xy or [X, Y]
        if [X, Y] != shape_xy:
            raise SystemExit(f"{name}: all volumes must share the same (X, Y) size")
        step = base_step(spacing)                       # search tiles are read at full resolution
        first_step = first_step or step
        if X < halo * step[0] or Y < halo * step[1]:
            raise SystemExit(f"{name}: volume smaller than the halo ({halo} cells)")
        ceiling = float(np.percentile(sig, 99.95)) or 1.0
        r8 = encode_signal(sig, ceiling)
        detected = lab > 0

        fr = r8.max(axis=2)
        fg = np.where(detected.any(axis=2), 255, 0).astype(np.uint8)
        Image.fromarray(to_image(np.stack([fr, fg, np.zeros_like(fr)], -1))).save(
            out / "champs" / f"{name}.webp", lossless=True)
        fields[name] = {"file": f"champs/{name}.webp", "shape_xy": [X, Y]}

        side, depth = BOX * step[0], BOX * step[2]
        cands = []
        for tx in range(0, X - side + 1, side):
            for ty in range(0, Y - side + 1, side):
                sk = skin[tx:tx + side, ty:ty + side]
                if np.isnan(sk).mean() > 0.5:
                    continue
                # `above` of the box depth in the air (low z), the rest under the skin
                oz = int(np.nanmedian(sk) - a.above * depth)
                oz = min(max(oz, 0), max(Z - depth, 0))
                win = r8[tx:tx + side, ty:ty + side, oz:oz + depth]
                free = ~detected[tx:tx + side, ty:ty + side, oz:oz + depth]
                cands.append((tx, ty, oz, int(((win >= 160) & free).sum())))
        # draw tiles, favouring bright undetected signal (but not only)
        w = np.array([1.0 + min(c[3], 200) / 20 for c in cands])
        k = min(a.tiles, len(cands))
        picked = sorted(rng.choice(len(cands), size=k, replace=False, p=w / w.sum()))
        for n, i in enumerate(picked):
            tx, ty, oz, bright = cands[i]
            hx = int(min(max(tx - (halo - BOX) // 2 * step[0], 0), X - halo * step[0]))
            hy = int(min(max(ty - (halo - BOX) // 2 * step[1], 0), Y - halo * step[1]))
            wx, wy = (tx - hx) // step[0], (ty - hy) // step[1]
            R = crop_pooled(r8, [hx, hy, oz], step, np.max, halo)
            B = np.where(crop_pooled(detected, [hx, hy, oz], step, np.any, halo), 255, 0).astype(np.uint8)
            skin_tile, _, _ = encode_skin(skin, [hx, hy, oz], step, spacing, halo)
            _, skin_state, gap = encode_skin(skin, [tx, ty, oz], step, spacing)
            strips.append(slab_tiles(np.stack([R, np.zeros_like(R), B], -1), skin_tile))
            cr = r8[:, :, oz:oz + depth].max(axis=2)
            z0 = np.zeros_like(cr)
            ctx_imgs.append(to_image(downsample_max(np.stack([cr, z0, z0], -1), REDUCTION)))
            tid = f"T{name}-{n:04d}"
            tiles.append({
                "slab_id": tid, "volume": name, "rank": 0, "draw_rank": 0, "page": 1, "anchor": False,
                "spacing_mm": [float(s * m) for s, m in zip(spacing, step)],
                "native_spacing_mm": [float(s) for s in spacing],
                "origin_xyz": [int(tx), int(ty), int(oz)], "step_xyz": step, "factor": 1,
                "contained": True, "voxels_sampled": 0, "voxels_native": 0,
                "display_ceiling": ceiling, "tutorial": False,
                "inclusion_probability": round(float(min(1.0, w[i] / w.sum() * k)), 4),
                "edge_mm": 0.0, "n_judgeable": 0, "bright_cluster": bright,
                "halo_origin_xyz": [hx, hy, int(oz)], "halo_size": halo,
                "window_xy": [int(wx), int(wy)],
                "skin_state": skin_state, "skin_gap_mm": round(gap, 3),
                "halo_pack": "", "halo_slot": 0, "ctx_pack": "", "ctx_slot": 0,
            })
            if missed is not None:
                truth[tid] = int(missed[tx:tx + side, ty:ty + side, oz:oz + depth].sum())
        print(f"{name}: {k} search tiles")

    order = rng.permutation(len(tiles))
    for rank, i in enumerate(order):
        tiles[i]["rank"] = tiles[i]["draw_rank"] = int(rank)
    if tiles:                                           # one practice tile, outside the measure
        min(tiles, key=lambda t: t["rank"]).update(tutorial=True, rank=-1, draw_rank=-1)
    per_pack = 4                                        # 4 halos per image (4 x 1008 px tall)
    by_rank = sorted(range(len(tiles)), key=lambda i: tiles[i]["rank"])
    ix, iy = shape_xy[0] // REDUCTION, shape_xy[1] // REDUCTION
    for p in range(math.ceil(len(by_rank) / per_pack)):
        members = by_rank[p * per_pack:(p + 1) * per_pack]
        sheet = np.zeros((per_pack * ROWS * halo, COLS * halo, 3), np.uint8)
        for slot, i in enumerate(members):
            sheet[slot * ROWS * halo:(slot + 1) * ROWS * halo] = strips[i]
            tiles[i].update(halo_pack=f"halo/halo_{p:04d}.webp", halo_slot=slot)
        Image.fromarray(sheet).save(out / "halo" / f"halo_{p:04d}.webp", lossless=True)
    for p in range(math.ceil(len(by_rank) / PER_PACK)):
        members = by_rank[p * PER_PACK:(p + 1) * PER_PACK]
        csheet = np.zeros((PER_PACK * iy, ix, 3), np.uint8)
        for slot, i in enumerate(members):
            csheet[slot * iy:(slot + 1) * iy] = ctx_imgs[i][:iy, :ix]
            tiles[i].update(ctx_pack=f"ctx/ctx_{p:04d}.webp", ctx_slot=slot)
        Image.fromarray(csheet).save(out / "ctx" / f"ctx_{p:04d}.webp", lossless=True)

    tiles.sort(key=lambda t: t["rank"])
    cohort = {
        "contract": "photoacoustic-annotation-cohort.v1", "mode": "trace",
        "built_at": datetime.now().isoformat(timespec="seconds"), "seed": a.seed,
        "registry": "build_cohort", "box": BOX, "atlas_cols": COLS, "atlas_rows": ROWS,
        "skin_slot": SKIN_SLOT, "per_pack": per_pack, "signal_bits": 8,
        "step_xyz_base": first_step, "volumes": [p.stem for p in paths], "slabs": tiles,
        "fields": fields,
        "field_channels": "R signal (same ceiling as the tiles) - G detected candidates in the column",
        "field_orientation": "row 0 = Y max, column 0 = X min",
        "page": 1, "pages": 1,
        "design": {"tiles_per_volume": a.tiles, "halo_voxels": halo, "above_fraction": a.above,
                   "weight": "1 + min(bright undetected voxels, 200) / 20"},
        "note": "Tiles favour bright undetected signal; detected candidates are drawn as other shapes.",
        "context": {"reduction": REDUCTION, "shape_xy": shape_xy, "image_xy": [ix, iy],
                    "channels": "R signal over the tile's exact depth window",
                    "orientation": "row 0 = Y max"},
    }
    (out / "cohorte.json").write_text(json.dumps(cohort, ensure_ascii=False))
    if a.truth_out and truth:
        Path(a.truth_out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.truth_out).write_text(json.dumps(truth, indent=1, sort_keys=True))
    print(f"search cohort: {len(tiles)} tiles -> {out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("volumes", nargs="+", help=".npz volumes (globs accepted)")
    ap.add_argument("--mode", choices=["review", "trace"], default="review",
                    help="review: one block per candidate; trace: search tiles for missed objects")
    ap.add_argument("--tiles", type=int, default=20, help="trace mode: tiles drawn per volume")
    ap.add_argument("--halo", type=int, default=144, help="trace mode: margin size, in display cells")
    ap.add_argument("--above", type=float, default=0.6, help="trace mode: share of the box depth above the skin")
    ap.add_argument("--out", required=True, help="output folder, e.g. app/data/demo")
    ap.add_argument("--seed", type=int, default=20261125)
    ap.add_argument("--anchors", type=int, default=4, help="slabs every reader sees first")
    ap.add_argument("--truth", help="folder with <volume>.truth.json (label -> nature), optional")
    ap.add_argument("--truth-out", help="where to write slab_id -> nature (keep it OUT of the served folder)")
    ap.add_argument("--min-voxels", type=int, default=20, help="ignore smaller candidates")
    a = ap.parse_args()

    paths = sorted({Path(p) for g in a.volumes for p in glob.glob(g)})
    if not paths:
        raise SystemExit("no input volume")
    out = Path(a.out)
    if a.mode == "trace":
        return build_trace(paths, out, a)
    for sub in ("atlas", "ctx", "champs"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(a.seed)

    slabs, fields, truth, shape_xy = [], {}, {}, None
    strips, ctx_imgs = [], []
    for path in paths:
        name, sig, lab, skin, spacing = load(path)
        X, Y, Z = sig.shape
        if shape_xy is None:
            shape_xy = [X, Y]
        elif [X, Y] != shape_xy:
            raise SystemExit(f"{name}: all volumes must share the same (X, Y) size")
        kinds = {}
        if a.truth and (Path(a.truth) / f"{name}.truth.json").exists():
            kinds = json.loads((Path(a.truth) / f"{name}.truth.json").read_text())
        base = base_step(spacing)
        if path == paths[0]:
            first_base = base
        ceiling = float(np.percentile(sig, 99.95)) or 1.0
        r8 = encode_signal(sig, ceiling)

        # whole-volume projection: R signal, G every candidate in the column
        fr = r8.max(axis=2)
        fg = np.where((lab > 0).any(axis=2), 255, 0).astype(np.uint8)
        field = np.stack([fr, fg, np.zeros_like(fr)], -1)
        Image.fromarray(to_image(field)).save(out / "champs" / f"{name}.webp", lossless=True)
        fields[name] = {"file": f"champs/{name}.webp", "shape_xy": [X, Y]}

        objects = ndi.find_objects(lab)
        for idx, sl in enumerate(objects, start=1):
            if sl is None:
                continue
            mask = lab[sl] == idx
            nvox = int(mask.sum())
            if nvox < a.min_voxels:
                continue
            ext = [s.stop - s.start for s in sl]
            factor = next((f for f in FACTORS
                           if all(e <= 0.85 * BOX * b * f for e, b in zip(ext, base))), FACTORS[-1])
            step = [b * factor for b in base]
            contained = all(e <= BOX * s for e, s in zip(ext, step))
            centre = [(s.start + s.stop) // 2 for s in sl]
            origin = []
            for c, s, L in zip(centre, step, (X, Y, Z)):
                o = c - BOX * s // 2
                if BOX * s <= L:
                    o = min(max(o, 0), L - BOX * s)
                origin.append(int(o))

            cand = lab == idx
            R = crop_pooled(r8, origin, step, np.max)
            G = np.where(crop_pooled(cand, origin, step, np.any), 255, 0).astype(np.uint8)
            B = np.where(crop_pooled((lab > 0) & ~cand, origin, step, np.any), 255, 0).astype(np.uint8)
            skin_tile, skin_state, gap = encode_skin(skin, origin, step, spacing)
            strips.append(slab_tiles(np.stack([R, G, B], -1), skin_tile))

            # context: whole field, projected over the slab's exact depth window
            z0, z1 = max(origin[2], 0), min(origin[2] + BOX * step[2], Z)
            cr = r8[:, :, z0:z1].max(axis=2) if z1 > z0 else np.zeros((X, Y), np.uint8)
            cg = np.where(cand.any(axis=2), 255, 0).astype(np.uint8)
            ctx = downsample_max(np.stack([cr, cg, np.zeros_like(cr)], -1), REDUCTION)
            ctx_imgs.append(to_image(ctx))

            sid = f"{name}-{idx:05d}"
            slabs.append({
                "slab_id": sid, "volume": name, "rank": 0, "anchor": False,
                "spacing_mm": [float(s * k) for s, k in zip(spacing, step)],
                "native_spacing_mm": [float(s) for s in spacing],
                "origin_xyz": origin, "step_xyz": step, "factor": factor,
                "contained": bool(contained), "voxels_sampled": int((G > 0).sum()),
                "voxels_native": nvox, "display_ceiling": ceiling,
                "pack": "", "pack_slot": 0, "tutorial": False,
                "skin_state": skin_state, "skin_gap_mm": round(gap, 3),
                "ctx_pack": "", "ctx_slot": 0,
            })
            if str(idx) in kinds:
                truth[sid] = kinds[str(idx)]
        print(f"{name}: {sum(s['volume'] == name for s in slabs)} slabs")

    # reading order: shuffled once, anchors first
    order = rng.permutation(len(slabs))
    for rank, i in enumerate(order):
        slabs[i]["rank"] = int(rank)
        slabs[i]["anchor"] = rank < a.anchors
    # tutorial slabs (practice, outside the measure): one of each nature if known
    tutorial = []
    for kind in ("hair", "vessel", "noise"):
        pick = [s for s in slabs if truth.get(s["slab_id"]) == kind and not s["anchor"]]
        if pick:
            pick[0]["tutorial"] = True
            tutorial.append(pick[0]["slab_id"])

    # packs, in reading order
    by_rank = sorted(range(len(slabs)), key=lambda i: slabs[i]["rank"])
    ix, iy = shape_xy[0] // REDUCTION, shape_xy[1] // REDUCTION
    for p in range(math.ceil(len(by_rank) / PER_PACK)):
        members = by_rank[p * PER_PACK:(p + 1) * PER_PACK]
        sheet = np.zeros((PER_PACK * ROWS * BOX, COLS * BOX, 3), np.uint8)
        csheet = np.zeros((PER_PACK * iy, ix, 3), np.uint8)
        for slot, i in enumerate(members):
            sheet[slot * ROWS * BOX:(slot + 1) * ROWS * BOX] = strips[i]
            csheet[slot * iy:(slot + 1) * iy] = ctx_imgs[i][:iy, :ix]
            slabs[i].update(pack=f"pack_{p:04d}.webp", pack_slot=slot,
                            ctx_pack=f"ctx/ctx_{p:04d}.webp", ctx_slot=slot)
        Image.fromarray(sheet).save(out / "atlas" / f"pack_{p:04d}.webp", lossless=True)
        Image.fromarray(csheet).save(out / "ctx" / f"ctx_{p:04d}.webp", lossless=True)

    slabs.sort(key=lambda s: s["rank"])
    cohort = {
        "contract": "photoacoustic-annotation-cohort.v1",
        "built_at": datetime.now().isoformat(timespec="seconds"),
        "seed": a.seed, "registry": "build_cohort",
        "box": BOX, "atlas_cols": COLS, "atlas_rows": ROWS, "skin_slot": SKIN_SLOT,
        "per_pack": PER_PACK, "signal_bits": 8,
        "step_xyz_base": first_base, "judgeable_mm": 0.75,
        "volumes": [p.stem for p in paths],
        "slabs": slabs,
        "note": "No field of this file reveals the true nature of a slab.",
        "tutorial_slabs": tutorial,
        "measured_slabs": sum(not s["tutorial"] for s in slabs),
        "fields": fields,
        "field_channels": "R signal (same ceiling as the slabs) - G candidates in the column",
        "field_orientation": "row 0 = Y max, column 0 = X min",
        "reduction": "maximum per display cell (signal and masks)",
        "context": {"reduction": REDUCTION, "shape_xy": shape_xy, "image_xy": [ix, iy],
                    "channels": "R signal over the slab's exact depth window - G candidate in the column",
                    "orientation": "row 0 = Y max"},
    }
    (out / "cohorte.json").write_text(json.dumps(cohort, ensure_ascii=False))
    if a.truth_out and truth:
        Path(a.truth_out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.truth_out).write_text(json.dumps(truth, indent=1, sort_keys=True))
    print(f"cohort: {len(slabs)} slabs, {math.ceil(len(slabs) / PER_PACK)} packs -> {out}")


if __name__ == "__main__":
    main()
