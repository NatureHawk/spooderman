# THREADLINE v2: merge of the four upgrade branches

`C:\Users\PRIYANSHU\Pictures\spoodermanv2` (own git repo, branch `v2-merge`). It's a copy of main taken 2026-10-03
~03:45 with four branches merged in. **The original `spooderman` folder was not modified.**

| Branch | Worktree | What it adds | Report |
|---|---|---|---|
| render | `spooderman_render` | bloom, grade, vignette (medium+); AO, light shafts, reflection probe, skyline in water (high+); SSR, grain (ultra); 17:30 start | `merge_reports/render.md` |
| props | `spooderman_props` | 10 textured pedestrian appearances (19-bone rig kept), rooftop HVAC / skylights / street furniture | `merge_reports/props.md` |
| life | `spooderman_life` | sidewalk roadmap crowd (crosswalks, seats, carts, groups, reactions), quay wall + harbour traffic, 16 tree models + impostors | `merge_reports/life.md` |
| buildings | `spooderman_buildings` | PLUTO styles, 34 wall materials in scan colours, curtain walls, rule windows, interiors (medium+) | `merge_reports/buildings.md` |

Low quality keeps the original look for the render and buildings layers. Pedestrian models, crowd behaviour, trees and
waterfront apply on every tier, as their branches designed.

## How it was merged

- Every branch's baseline matched the current main (ignoring line endings) for every file it modified. No drift.
- Files changed by only one branch were copied from that worktree as is: `18_comic.js` (render), `01_assets.js`
  (props), `03c_trees.js` and `tools/hd/trees_gen.py` (life), `03d_facade.js` (buildings), plus all new modules,
  tools and tests.
- 3-way merges (`git merge-file`, each branch against its baseline):
  - `src/10_crowd.js`: props + life merged with no conflicts (props touched model selection, life touched behaviour).
  - `tools/build.js`: all four. The only conflict was three adjacent `order.splice` blocks; all were kept.
    Final order adds `03l_buildings` after `03d_facade`; `10c_crowdnav, 10d_crowdlife, 10e_npcposes, 03l_lifeprops,
    03m_waterfront` after `10_crowd`; `21_post, 21b_reflect` after `20_atmos`; `21_props` after those;
    `19_multi` last (multiplayer build only).
- Data: props `build/{people,props}.*`; life `build/extra/{crowd_nav,life_*,waterfront_*,trees_*}`; buildings
  `build/extra/{bstyle.json,walltex_*,wallcol.bin.gz}`. No file name collisions. The tree data is life's regenerated set,
  copied together as its report requires.

## Verification (merged build)

- Node: physics 31/31, contact 43/43, contact_anim 43, rooftops PASS, routes 17/17, city_activity PASS,
  crowd_life 6/6, waterfront 5/5, props_assets PASS (149 records), low_manhattan PASS.
- GPU browser: `render_post/tiers_browser` PASS (every tier × street/rain/night/waterfront, both comic styles,
  resize); `routes_browser` PASS; `props_browser` PASS; buildings `_bq_shot` PASS; `life/shots` 13 views with
  0 runtime errors at 54–84 fps (harness, High).
- Multiplayer: `node tests/multi_local_browser.js` runs the real `api/signal.js` locally (in-memory store) with a
  host and a joiner in headless Chrome. **PASS**: the WebRTC link comes up, both see each other, and the host's copy
  of the joiner sits at the joiner's exact position. No page errors; all four upgrades are active in the multiplayer
  build.
- Before/after sheet: `evidence/v2_before_after.jpg`. Per-view shots: `evidence/life/v2/`.

## Outputs

- `THREADLINE.html`: 81.7 MB (main: 63.5 MB). The growth comes from people/props packs, life data and wall materials.
- `hosting/threadline_multi/THREADLINE_multi.html`: 81.7 MB, built with `node tools/build_multi.js`.
  **Not deployed.** Deploy (replaces the live https://threadline-multi.vercel.app):
  `cd hosting/threadline_multi && npx --no-install vercel deploy --prod --yes`. Then check that
  `vercel git disconnect --yes` is still in effect (see project notes).

## Known limits carried over from the branches

- Render: SSR covers water and wet ground only; first switch to High/Ultra hitches while shaders compile;
  night windows glow modestly.
- Props: some fixtures (newsstand, subway entrance, bike dock, steam stack, dish) are exported but not placed;
  no child pedestrians.
- Life: far pedestrians are standing silhouettes; boats are procedural; cars can brush a walker already in a
  crosswalk.
- Buildings: no cornice geometry or new landmarks; colour vote can lighten mostly shadowed sides slightly.
- Performance: each branch measured its own cost (render +0.2 / ~2.4–3.4 / ~3.6–4.2 ms GPU on medium / high /
  ultra; buildings +0–2 ms; life ~+1 ms CPU). They add up; there's no combined controlled benchmark yet.
