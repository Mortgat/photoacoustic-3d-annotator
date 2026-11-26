# Photoacoustic 3D Annotator

A browser-based tool to build a **human ground truth of hairs, vessels and noise in 3D photoacoustic volumes**, with several readers working remotely. It runs as a static web page: no server, no install for readers.

**Live demo:** <https://mortgat.github.io/photoacoustic-3d-annotator/> (step 1) · [step 2, search tiles](https://mortgat.github.io/photoacoustic-3d-annotator/?data=demo-search)

![The annotator on the synthetic demo data](docs/annotator.webp)

> The repository ships with **synthetic data only** (a procedural phantom). No patient data is included.

## The two steps

**Step 1 — Review detected shapes.** Each *block* (a 48³ voxel box) is centred on one automatically detected candidate. The reader locates it relative to the skin, decides its **nature** (hair, vessel, noise, + "not sure"), checks its **outline** and fixes it if needed (add / erase voxels, fill gaps, trace along the signal, or **cut** a candidate that merges several objects), then confirms.

**Step 2 — Search for missed hairs.** Each *tile* is a 48 × 48 window of the field of view, sampled with priority to bright undetected signal. Shapes already detected are shown in brown; the reader **traces the hairs the method missed** inside the red square, voxel path by voxel path. The tile comes with a wider margin (144 × 144) that the reader pans through with the arrows, so that a hair crossing the edge of the square can be followed to its end instead of being cut.

Features:

- **WebGL2 ray-marched volume view** (signal / voxels / editable blocks), with the estimated skin surface and neighbouring shapes, plus a **maximum-intensity projection** that zooms out to the whole field of view;
- **voxel tools**: 1- and 7-voxel brush, eraser, bucket fill, gap filling, signal-following tracer, cuts into parts;
- **interactive tutorials** with practice blocks, **English / Japanese** interface;
- per-reader identifiers, resumable sessions, reading order with anchor blocks;
- answers saved **locally in the reader's browser** and **exported as JSON**, then merged with `tools/collect_answers.py`. Nothing is sent to any server.

## Quick start (demo)

```bash
git clone https://github.com/Mortgat/photoacoustic-3d-annotator.git
cd photoacoustic-3d-annotator/app
python -m http.server 8000
```

Open <http://localhost:8000> (step 1) or <http://localhost:8000/?data=demo-search> (step 2), enter any reader ID, and follow the tutorial.

## Build cohorts from your own volumes

Requirements: Python 3.10+, `pip install -r requirements.txt` (NumPy, SciPy, Pillow).

1. Save one `.npz` per volume with:

   | key | type | meaning |
   |---|---|---|
   | `signal` | float, `(X, Y, Z)` | the volume. **z is the depth axis and grows into the tissue** (air at low z, then skin, then tissue) |
   | `labels` | int, `(X, Y, Z)` | candidate components from your detector, `0` = background |
   | `skin` | float, `(X, Y)` | skin height, in z voxels; `NaN` where unknown |
   | `spacing_mm` | float, `(3,)` | voxel size along x, y, z |
   | `missed` *(optional)* | bool, `(X, Y, Z)` | known missed objects, only used to score the search step |

   All volumes of one cohort must share the same `(X, Y)` size.

2. Build both steps into folders served by the page:

   ```bash
   python tools/build_cohort.py my_volumes/*.npz --out app/data/study1
   python tools/build_cohort.py my_volumes/*.npz --mode trace --tiles 30 --out app/data/study1-search
   ```

3. Point `app/config.js` (`pages.review`, `pages.search`) at `?data=study1` and `?data=study1-search`, and open `http://localhost:8000/?data=study1`.

In step 1, each candidate becomes one block; the box step (1, 2 or 4 voxels per display cell) is chosen so that the candidate fits. In step 2, tiles are drawn from a grid over the field of view, with a depth window placed around the skin. The signal is max-pooled, divided by a per-volume display ceiling and stored as lossless WebP atlases. See the docstring of [`tools/build_cohort.py`](tools/build_cohort.py) for the exact encoding.

### Recreate the demo data

```bash
python tools/phantom.py --out phantom_data --volumes 2 --seed 7
python tools/build_cohort.py "phantom_data/*.npz" --out app/data/demo --truth phantom_data --truth-out examples/demo_truth.json
python tools/build_cohort.py "phantom_data/*.npz" --mode trace --tiles 12 --out app/data/demo-search --truth-out examples/demo_search_truth.json
python tools/make_tutorial_images.py phantom_data/phantom01.npz --out app/tuto
```

The phantom contains a wavy skin surface, branching vessels under it, hairs leaving the skin at an angle (some lying on it), isolated noise blobs, one hair crossing a vessel that the "detector" merges into a single candidate, and hairs the detector missed (the targets of step 2).

## Collect the answers

Readers click **⋯ → Export my answers** and send you the JSON file. Then:

```bash
python tools/collect_answers.py exports/*.json --out answers.csv
# step 1 on the demo, compared with the phantom's truth:
python tools/collect_answers.py exports/*.json --truth examples/demo_truth.json
```

## Deploy

The page is static: any web server works. The included workflow (`.github/workflows/pages.yml`) publishes `app/` to **GitHub Pages** on every push to `main` (enable it in *Settings → Pages → Source: GitHub Actions*). Readers then only need the link.

Deployment settings live in [`app/config.js`](app/config.js): data folder (`?data=`), the author's reader ID (`?author=`), and the links between the two steps. When you change the code, bump the `?v=` version in `index.html` and in the imports at the top of `app.js`, so that browsers load the new files.

## Repository layout

```
app/                    the web page (serve app/ with any web server)
  app.js                annotator: state, WebGL rendering, tools, storage, export
  strings.js            interface texts (EN / JA)
  tutorial.js           tutorial screens and figures
  config.js             deployment settings
  data/demo/            synthetic cohort, step 1 (review)
  data/demo-search/     synthetic cohort, step 2 (search tiles)
  tuto/                 tutorial figures, rendered from the phantom
tools/
  phantom.py            synthetic volumes
  build_cohort.py       volumes (.npz) -> cohorts for the page (--mode review | trace)
  make_tutorial_images.py
  collect_answers.py    exported answers -> CSV (+ agreement with a truth file)
examples/               phantom truths and a sample export
```

The code also contains extensions used in the original study (second reading of the author's outlines, blind arbitration between readers, tile review). They need extra reference files and stay disabled in this release.

Code comments are mostly in French (the original working language); interface texts are in English and Japanese.

## Context and citation

This tool produced the human ground truth used to evaluate MIRAH:

> R. Décarpentries, Y. Onoue, H. Kajita, R. Bise, M. Isogawa. *MIRAH: Annotation-Free 3D Body-Hair Segmentation in Photoacoustic Volumes From a Recipe Defined in Millimeters.* Submitted to IEEE ISBI 2027 (under review).

It was developed in an AI-assisted way (Claude), with every design decision, check and protocol choice made by the author.

## License

MIT — see [LICENSE](LICENSE).
