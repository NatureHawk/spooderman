#!/bin/bash
# before/after set for MERGE_REPORT.md: base_render.html (untouched baseline) vs THREADLINE.html (this worktree), same scenes, same seeds
cd "$(dirname "$0")/../.."
OUT=evidence/render_post
S="node tests/render_post/shoot.js --quality ultra --out $OUT"
for b in base new; do
  H=shots/base_render.html; [ $b = new ] && H=THREADLINE.html
  $S --html $H --tag ${b}_day      --scenes street,skyline,waterfront_day
  $S --html $H --tag ${b}_golden   --scenes golden_street,skyline,waterfront,heroclose --hour 17.5
  $S --html $H --tag ${b}_night    --scenes night,waterfront_night
  $S --html $H --tag ${b}_rain     --scenes rain,rainlow,rainlow_night
done
