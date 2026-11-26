"""Synthetic photoacoustic-like volume for the demo cohort.

The phantom imitates what a reader sees in a real acquisition, without any
patient data:

* a wavy skin surface, with a faint signal sheet on it;
* vessels below the skin: smooth, roughly parallel to the surface, branching;
* hairs: thin, bright, straight-ish filaments that leave the skin at an angle
  and continue in the air above it (some lie on the skin);
* noise: small isolated blobs;
* one hair that touches a vessel, so that the detector merges them into a
  single candidate (exercises the "Several objects" / cut tool).

Axes: array index order is (x, y, z). The phantom is drawn with z growing OUT
of the skin, then saved with the annotator's convention: z grows INTO the
tissue (air at low z, skin, then tissue at high z).

Output: one .npz file per volume, read by build_cohort.py:
    signal      float32 (X, Y, Z)
    labels      int32   (X, Y, Z)   candidate components, 0 = background
    skin        float32 (X, Y)      skin height (z index), NaN where unknown
    spacing_mm  float64 (3,)
    missed      bool    (X, Y, Z)   hairs present in the signal but missed by
                                    the "detector" (truth for the tile search)
and a JSON side file with the true nature of each candidate label.

Usage:
    python tools/phantom.py --out phantom_data --volumes 2 --seed 7
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

SHAPE = (320, 320, 128)              # x, y, z voxels
SPACING_MM = (0.06, 0.06, 0.03)      # z sampled twice as finely, as in PA scanners


def skin_surface(rng: np.random.Generator, shape) -> np.ndarray:
    """Skin height z_s(x, y), in voxels: a gentle 2D undulation."""
    nx, ny, nz = shape
    x = np.arange(nx)[:, None] / nx
    y = np.arange(ny)[None, :] / ny
    base = 0.62 * nz
    s = base
    for _ in range(4):
        fx, fy = rng.uniform(0.5, 2.0, 2)
        ph = rng.uniform(0, 2 * np.pi, 2)
        amp = rng.uniform(1.5, 4.0)
        s = s + amp * np.sin(2 * np.pi * fx * x + ph[0]) * np.cos(2 * np.pi * fy * y + ph[1])
    return s.astype(np.float32)


def stamp_tube(vol, lab, pts, radius, value, label):
    """Draws a tube of `radius` (voxels, in x/y units) along the points.

    z is anisotropic (0.03 mm vs 0.06 mm), so the tube is twice as many
    voxels thick along z: the physical cross-section stays round."""
    nx, ny, nz = vol.shape
    r = float(radius)
    rz = 2.0 * r
    for p in pts:
        x0, y0, z0 = p
        xs = slice(max(int(x0 - r - 1), 0), min(int(x0 + r + 2), nx))
        ys = slice(max(int(y0 - r - 1), 0), min(int(y0 + r + 2), ny))
        zs = slice(max(int(z0 - rz - 1), 0), min(int(z0 + rz + 2), nz))
        if xs.start >= xs.stop or ys.start >= ys.stop or zs.start >= zs.stop:
            continue
        gx, gy, gz = np.ogrid[xs, ys, zs]
        d2 = ((gx - x0) / r) ** 2 + ((gy - y0) / r) ** 2 + ((gz - z0) / rz) ** 2
        inside = d2 <= 1.0
        prof = value * np.exp(-1.2 * d2)
        sub = vol[xs, ys, zs]
        np.maximum(sub, np.where(inside, prof, 0), out=sub)
        if label:
            lsub = lab[xs, ys, zs]
            lsub[inside & (lsub == 0)] = label


def polyline(p0, direction, length, curvature, rng, step=0.5):
    """Points along a gently bending curve."""
    pts = []
    p = np.asarray(p0, float)
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    for _ in range(int(length / step)):
        pts.append(p.copy())
        d = d + rng.normal(0, curvature, 3) * np.array([1, 1, 0.3])
        d /= np.linalg.norm(d)
        p = p + d * step
    return np.array(pts)


def make_volume(rng: np.random.Generator):
    nx, ny, nz = SHAPE
    vol = np.zeros(SHAPE, np.float32)
    lab = np.zeros(SHAPE, np.int32)
    skin = skin_surface(rng, SHAPE)
    kinds: dict[int, str] = {}
    next_label = 1

    def skin_at(x, y):
        return float(skin[int(np.clip(x, 0, nx - 1)), int(np.clip(y, 0, ny - 1))])

    # --- vessels: below the skin, parallel to it, with a branch ------------
    vessel_paths = []
    for _ in range(7):
        x0, y0 = rng.uniform(30, nx - 30, 2)
        depth = rng.uniform(18, 45)                      # 0.54 to 1.35 mm under the skin
        ang = rng.uniform(0, 2 * np.pi)
        pts = polyline((x0, y0, 0), (np.cos(ang), np.sin(ang), 0), rng.uniform(45, 75), 0.05, rng)
        pts[:, 2] = [skin_at(px, py) - depth for px, py, _ in pts]
        r = rng.uniform(1.8, 3.2)
        stamp_tube(vol, lab, pts, r, rng.uniform(0.75, 1.0), next_label)
        if rng.random() < 0.6:                            # branch
            k = len(pts) // 2
            bang = ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.0)
            bpts = polyline(pts[k], (np.cos(bang), np.sin(bang), 0), rng.uniform(20, 35), 0.05, rng)
            bpts[:, 2] = [skin_at(px, py) - depth + rng.uniform(-1, 1) for px, py, _ in bpts]
            stamp_tube(vol, lab, bpts, r * 0.7, rng.uniform(0.7, 0.9), next_label)
        kinds[next_label] = "vessel"
        vessel_paths.append(pts)
        next_label += 1

    # --- hairs: from a follicle below the skin, out into the air -----------
    for i in range(12):
        x0, y0 = rng.uniform(30, nx - 30, 2)
        z0 = skin_at(x0, y0) - rng.uniform(6, 14)         # follicle
        ang = rng.uniform(0, 2 * np.pi)
        lying = i % 4 == 3                                # some hairs lie on the skin
        tilt = rng.uniform(0.15, 0.3) if lying else rng.uniform(0.6, 1.4)
        direction = (np.cos(ang), np.sin(ang), tilt)
        pts = polyline((x0, y0, z0), direction, rng.uniform(40, 70), 0.02, rng)
        pts = pts[(pts[:, 2] < nz - 3) & (pts[:, 2] > 2)]
        if lying:                                         # stays just above the surface
            pts[:, 2] = np.maximum(pts[:, 2], [skin_at(px, py) + 3 for px, py, _ in pts])
        stamp_tube(vol, lab, pts, rng.uniform(0.9, 1.3), rng.uniform(1.1, 1.4), next_label)
        kinds[next_label] = "hair"
        next_label += 1

    # --- missed hairs: in the signal, NOT in the candidates ----------------
    # (what readers look for in the tile search step)
    missed = np.zeros(SHAPE, np.int32)
    for _ in range(8):
        x0, y0 = rng.uniform(30, nx - 30, 2)
        z0 = skin_at(x0, y0) - rng.uniform(6, 12)
        ang = rng.uniform(0, 2 * np.pi)
        pts = polyline((x0, y0, z0), (np.cos(ang), np.sin(ang), rng.uniform(0.5, 1.2)),
                       rng.uniform(35, 60), 0.02, rng)
        pts = pts[(pts[:, 2] < nz - 3) & (pts[:, 2] > 2)]
        stamp_tube(vol, missed, pts, rng.uniform(0.8, 1.1), rng.uniform(0.9, 1.2), 1)
    missed[lab > 0] = 0

    # --- one hair crossing a vessel: the detector merges them --------------
    v = vessel_paths[0]
    k = len(v) // 3
    cross = v[k]
    pts = polyline(cross + np.array([0, 0, -2]), (0.4, 0.2, 1.0), 60, 0.02, rng)
    pts = pts[pts[:, 2] < nz - 3]
    merged_label = lab[int(cross[0]), int(cross[1]), int(cross[2])] or 1
    stamp_tube(vol, lab, pts, 1.1, 1.3, merged_label)
    kinds[merged_label] = "merged"

    # --- noise: isolated blobs ---------------------------------------------
    for _ in range(10):
        x0, y0 = rng.uniform(10, nx - 10, 2)
        z0 = skin_at(x0, y0) + rng.uniform(-40, 20)
        pts = polyline((x0, y0, z0), rng.normal(0, 1, 3), rng.uniform(1, 5), 0.3, rng)
        stamp_tube(vol, lab, pts, rng.uniform(1.0, 2.0), rng.uniform(0.35, 0.6), next_label)
        kinds[next_label] = "noise"
        next_label += 1

    # --- skin sheet, background, blur ---------------------------------------
    zz = np.arange(nz)[None, None, :]
    sheet = 0.12 * np.exp(-((zz - skin[:, :, None]) / 1.5) ** 2)
    vol = np.maximum(vol, sheet.astype(np.float32))
    vol = ndi.gaussian_filter(vol, (0.7, 0.7, 1.2))
    # speckle: smoothed, low-amplitude noise (PA background), quieter in the air
    speckle = ndi.gaussian_filter(rng.normal(0, 1, SHAPE).astype(np.float32), (1.2, 1.2, 2.0))
    speckle = np.abs(speckle) * (0.02 / (speckle.std() + 1e-6))
    speckle[zz.repeat(nx, 0).repeat(ny, 1) > skin[:, :, None] + 1] *= 0.4
    vol += speckle.astype(np.float32)

    return vol.astype(np.float32), lab, skin, kinds, missed > 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="phantom_data", help="output folder")
    ap.add_argument("--volumes", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(a.seed)
    for i in range(a.volumes):
        name = f"phantom{i + 1:02d}"
        vol, lab, skin, kinds, missed = make_volume(rng)
        # saved with the annotator's convention: z grows INTO the tissue
        # (skin at low z, as acquired from above), so the z axis is flipped
        nz = vol.shape[2]
        np.savez_compressed(out / f"{name}.npz", signal=vol[:, :, ::-1], labels=lab[:, :, ::-1],
                            skin=(nz - 1 - skin).astype(np.float32), spacing_mm=np.array(SPACING_MM),
                            missed=missed[:, :, ::-1])
        (out / f"{name}.truth.json").write_text(json.dumps({str(k): v for k, v in kinds.items()}, indent=1))
        print(f"{name}: {len(kinds)} candidates "
              f"({sum(v == 'hair' for v in kinds.values())} hairs, "
              f"{sum(v == 'vessel' for v in kinds.values())} vessels, "
              f"{sum(v == 'noise' for v in kinds.values())} noise, "
              f"{sum(v == 'merged' for v in kinds.values())} merged)")


if __name__ == "__main__":
    main()
