"""Collects the answer files exported by readers into one table.

Each reader clicks "Export my answers" in the annotator and sends you the
JSON file (hcr_<reader>_<date>.json). This script merges them into a CSV, one
row per (reader, slab), keeping each reader's latest answer, and, if a truth
file is given (e.g. examples/demo_truth.json for the phantom), prints each
reader's agreement with it.

Usage:
    python tools/collect_answers.py exports/*.json --out answers.csv \
        --truth examples/demo_truth.json
"""
from __future__ import annotations

import argparse
import csv
import glob
import json
from collections import Counter, defaultdict
from pathlib import Path

FIELDS = ["reader_id", "slab_id", "nature", "doubt", "support", "added_voxels",
          "removed_voxels", "parts", "practice", "confirmed_at"]


def rows_from(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    reader = data.get("reader_id", path.stem)
    for a in data.get("answers", []):
        yield {
            "reader_id": a.get("reader_id", reader),
            "slab_id": a.get("slab_id"),
            "nature": a.get("nature"),
            "doubt": bool(a.get("doubt")),
            "support": "+".join(a.get("support") or []),
            "added_voxels": len(a.get("added_index") or []) or a.get("added_voxels", 0),
            "removed_voxels": len(a.get("removed_index") or []) or a.get("removed_voxels", 0),
            "parts": len(a.get("parts") or []) if isinstance(a.get("parts"), list) else a.get("parts", ""),
            "practice": bool(a.get("practice")),
            "confirmed_at": a.get("confirmed_at") or a.get("at") or "",
        }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exports", nargs="+", help="exported JSON files (globs accepted)")
    ap.add_argument("--out", default="answers.csv")
    ap.add_argument("--truth", help="slab_id -> nature JSON, optional")
    a = ap.parse_args()

    latest: dict[tuple, dict] = {}
    for p in sorted({Path(x) for g in a.exports for x in glob.glob(g)}):
        for r in rows_from(p):
            key = (r["reader_id"], r["slab_id"])
            if key not in latest or str(r["confirmed_at"]) >= str(latest[key]["confirmed_at"]):
                latest[key] = r
    rows = sorted(latest.values(), key=lambda r: (r["reader_id"], r["slab_id"]))
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} answers from {len({r['reader_id'] for r in rows})} readers -> {a.out}")

    if a.truth:
        truth = json.loads(Path(a.truth).read_text(encoding="utf-8"))
        per = defaultdict(Counter)
        confusion = Counter()
        for r in rows:
            t = truth.get(r["slab_id"])
            if t is None or r["practice"]:
                continue
            t = "hair" if t == "merged" else t            # merged = a hair touching a vessel
            per[r["reader_id"]]["n"] += 1
            per[r["reader_id"]]["ok"] += int(r["nature"] == t)
            confusion[(t, r["nature"])] += 1
        for reader, c in sorted(per.items()):
            print(f"  {reader}: {c['ok']}/{c['n']} natures agree with the truth ({100 * c['ok'] / max(c['n'], 1):.0f} %)")
        if confusion:
            print("  truth -> answer:", ", ".join(f"{t}->{n}: {k}" for (t, n), k in sorted(confusion.items())))


if __name__ == "__main__":
    main()
