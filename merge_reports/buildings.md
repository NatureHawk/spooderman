# THREADLINE: building upgrade, merge report

Worktree: `C:\Users\PRIYANSHU\Pictures\spooderman_buildings` (own git repo, branch `claude/buildings-upgrade`).
Baseline: commit `48b847a`, a copy of main taken 2026-10-02 ~23:00. Nothing in main was modified or rebuilt, and
only this worktree's `THREADLINE.html` was built.

## What it does (seed MAN, NYC buildings, quality Medium and up)

| Feature | Medium | High | Ultra |
|---|---|---|---|
| Architectural style per building, from NYC PLUTO tax lots (year built, class, floors) | yes | yes | yes |
| Real wall materials: 34 CC0 ambientCG sets (brick, ashlar, granite, concrete) with real-world scale | 256 px | 512 px | 512 px |
| Wall colour = majority scan colour of each building side (blotches removed, scan colours kept) | yes | yes | yes |
| Glass towers rendered as curtain walls (mullions, spandrels, tinted reflective glass, lit at night) | yes | yes | yes |
| Rule-placed windows on walls with no measured window pattern; lot-line / party walls stay blank | yes | yes | yes |
| Normal-map relief on walls | no | yes | yes |
| Parallax rooms behind windows (walls, floor, ceiling lights, furniture, blinds, curtains; offices vs flats) | no | yes | yes + rugs, partitions |

**Low is the original look, pixel for pixel**: 0 differing pixels in all 7 facade views against a build of the
baseline commit. The new code compiles only under `#define TL_BQ`, which is never set on Low.

Colour rule (from the user): keep the scan's colours; the materials add only surface pattern (brightness),
never hue.

Coverage: materials and colour on 100% of wall area (661 buildings). Measured windows were already on 66% of wall
area. Of the remaining walls, about 1/3 get rule-placed windows and about 2/3 are lot-line walls left blank on
purpose. Not touched: landmark models (40 Wall St, Brooklyn Bridge, Charging Bull), roofs (photo; roof surfaces
belong to the props agent), raw scan geometry.

## Files

New:
- `src/03l_buildings.js`: runtime (style and material assignment, texture array, footprint map for lot-line walls,
  wall extents, GLSL)
- `tools/scan/building_styles.py`: PLUTO lots → `build/extra/bstyle.json`
- `tools/scan/walltex_pack.py`: materials → `build/extra/walltex_albedo.webp`, `walltex_normal.webp`, `walltex_meta.json`
- `tools/scan/wall_colors.py`: majority colour per building side → `build/extra/wallcol.bin.gz`
- `source/pluto/pluto_mn01_mn03.json` (1.9 MB, PLUTO export for MN01 + MN03)
- `source/walltex/acg/*` (258 MB, the 1K source materials; needed only to re-run `walltex_pack.py`)

Changed:
- `src/03d_facade.js`: `#ifdef TL_BQ` hooks (uniforms, vertex attributes, wall colour, curtain/rule-window shading,
  rooms) → `integration/03d_facade.js.patch`
- `tools/build.js`: one line adds `03l_buildings.js` to the order right after `03d_facade.js` →
  `integration/build.js.patch`

Main drift check (2026-10-03): main's `src/03d_facade.js` and `tools/build.js` differ from the baseline only in
line endings, so both patches apply. Main's `build/nyc.bin`, `nyc.json`, `nyc_atlas_walls.webp` and
`extra/facade_meta.json` are byte-identical to this worktree's, so the generated data can be copied as is.

## Merge steps

1. Copy `src/03l_buildings.js` and the three `tools/scan/*.py` files into main. Optionally copy `source/pluto/`,
   and `source/walltex/` if you want to be able to regenerate the materials.
2. Apply the two patches, keeping CRLF in `03d_facade.js`:
   `git apply --ignore-whitespace integration/03d_facade.js.patch integration/build.js.patch`, or edit by hand.
   They're small.
3. Data: copy `build/extra/{bstyle.json, walltex_albedo.webp, walltex_normal.webp, walltex_meta.json, wallcol.bin.gz}`
   into main's `build/extra/`. **If main's `nyc.bin` or atlas has changed since**, regenerate instead (needs
   `pip install pyproj` for styles):
   ```
   python tools/scan/building_styles.py
   python tools/scan/walltex_pack.py
   python tools/scan/wall_colors.py      # after facade_detail.py / sharpen_atlas.py (reads nyc_atlas_walls.webp)
   ```
   Pipeline position: after `facade_detail.py` → `sharpen_atlas.py` and before `node tools/build.js`.
   Safety: `wallcol.bin.gz` is checked against the triangle count and ignored if stale (falls back to the blurred
   photo colour). `bstyle.json` is keyed by building id; unknown ids get a height-based style.
4. `node tools/build.js`, then verify (below).

Ownership with the other parallel agents: render (`spooderman_render`) owns post and reflections, and its
reflection API isn't hooked in yet. Glass here uses the same analytic sky reflection the facade already used,
so it can be switched to their env map later in `bqCurtainShade` / `GLSL_MAP`. Props owns `assets.bin` and roofs.
Life owns trees and crowd. None of their files are touched here.

## Verification (this worktree)

- Node tests: physics 31/31, contact 43/43, contact_anim 43, rooftops PASS, routes 17/17, low_manhattan PASS.
  No physics or animation code changed.
- GPU screenshots (Chrome, ANGLE d3d11), Low / Medium / High: no shader or runtime errors.
  Sheets are in `tests/runtime_buildings/`: `final_low_vs_high.jpg`, `walkups_rule_windows.jpg`,
  `majority_colour_before_after.jpg`.
- Harnesses: `tests/_bq_shot.js` (7 facade views; env `TL_Q`, `TL_HOUR`, `TL_FACADE_LABEL`), `tests/_bq_walkups.js`
  (finds window-less walk-ups across the map), `tests/_bq_perf.js` (A/B of the building shader inside each tier).

## Cost

- Frame time, building shader on vs off in the same tier, 1000×720, 4 views, CPU-synced (`readPixels`), indicative
  only: Medium ≈ +0–1 ms, High ≈ +1–2 ms, Ultra ≈ +1.5–2 ms per frame. Use `spooderman_gfx/bench` GPU timer
  queries for exact numbers before merging, if needed.
- GPU memory for the texture arrays: Medium ≈ 23 MB, High/Ultra ≈ 90 MB (34 layers × albedo + normal, mipmapped).
- `THREADLINE.html`: +5.7 MB (63.5 → 69.2 MB, mostly the two material atlases).
- Load: footprint map + texture-array build add a short one-time step when the quality tier is applied.

## Known limits / follow-ups

- Sides whose true colour is mostly in shadow can read slightly lighter (the colour vote ignores the darkest 40% of
  samples, which removes baked shadows and window glass).
- Rule-placed windows use one size per style. Measured windows (from the photo) are untouched.
- Not done from the original plan: cornice / belt-course geometry, more landmark models.
- Night look not checked in live gameplay. The harness's forced night is washed out on Low too.
