/* THREADLINE build: stitches src/*.js + the Blender-exported asset library into ONE self-contained
   HTML file (THREADLINE.html). The asset binary is gzipped and base64-embedded; the game decodes it at
   runtime with DecompressionStream. Usage: node tools/build.js [out.html]
   Env TL_BUILD_DIR=<dir> reads the built data from <dir> instead of build/ (parallel work: each worker its own dir).
   Every file in <build>/extra/ is embedded as-is in #tl-extra (JSON map name -> base64); runtime: TL.Extra. */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BUILD = process.env.TL_BUILD_DIR ? path.resolve(ROOT, process.env.TL_BUILD_DIR) : path.join(ROOT, 'build');
const order = ['00_core.js', '01_assets.js', '02_collision.js', '03_city.js', '03b_scan.js', '03c_trees.js', '03d_facade.js', '03e_streets.js', '03f_replace.js', '03g_rooftops.js', '03h_roofobstacles.js', '04_physics.js', '04b_contact.js', '05_camera.js', '06b_motion.js', '06_anim.js', '06c_glide.js', '06d_contact_anim.js', '07_vfx.js',
  '08_combat.js', '09_ai.js', '10_crowd.js', '10b_citylife.js', '11_traffic.js', '12_missions.js', '12b_routes.js', '13_ui.js', '14_audio.js', '15_save.js', '16_game.js', '17_extras.js', '18_comic.js', '21_props.js'];
order.splice(order.indexOf('04b_contact.js')+1,0,'04c_reference.js');
order.splice(order.indexOf('03h_roofobstacles.js')+1,0,'03i_traversal_supports.js');
order.splice(order.indexOf('06d_contact_anim.js')+1,0,'06e_reference_anim.js');
// graphics pass: render-time culling for the citywide instanced kits; runs after every module that adds rooftop meshes
order.splice(order.indexOf(order.includes('03i_traversal_supports.js') ? '03i_traversal_supports.js' : '03h_roofobstacles.js') + 1, 0, '03j_render_cull.js');
order.splice(order.indexOf('03j_render_cull.js')+1,0,'03k_low_manhattan.js');
order.splice(order.indexOf('18_comic.js')+1,0,'20_atmos.js');
// rendering pass: AO / bloom / grade / reflections; wraps TL.Comic.render, so it loads after the comic + atmosphere modules
order.splice(order.indexOf('20_atmos.js')+1,0,'21_post.js');
order.splice(order.indexOf('21_post.js')+1,0,'21b_reflect.js');
// v2 performance: probe sees only static scenery, shader warm-up during loading (src/22_perf.js)
order.splice(order.indexOf('21b_reflect.js')+1,0,'22_perf.js');
// life pass: pedestrian roadmap + behaviour + extra NPC poses (after the crowd), see tools/scan/crowd_nav.py
order.splice(order.indexOf('10_crowd.js')+1,0,'10c_crowdnav.js','10d_crowdlife.js','10e_npcposes.js');
order.splice(order.indexOf('10e_npcposes.js')+1,0,'03l_lifeprops.js', '03m_waterfront.js');   // after the crowd roadmap: its build hook reads world.crowdNav;   // carts, stoops, shelters, waterfront kit
// building materials + interiors (03l_buildings.js) right after the facade look it extends
order.splice(order.indexOf('03d_facade.js')+1,0,'03l_buildings.js');
// opt-in extra modules appended after the core (TL_EXTRA_MODULES=19_multi.js for THREADLINE_multi.html; see tools/build_multi.js)
if (process.env.TL_EXTRA_MODULES) order.push(...process.env.TL_EXTRA_MODULES.split(',').map((s) => s.trim()).filter(Boolean));
let code = '';
for (const f of order) code += '\n/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8').replace(/^'use strict';\s*$/m, '');
const bin = fs.readFileSync(path.join(BUILD, 'assets.bin'));
const gz = zlib.gzipSync(bin, { level: 9 });
const b64 = gz.toString('base64').replace(/(.{1,160})/g, '$1\n');
const json = fs.readFileSync(path.join(BUILD, 'assets.json'), 'utf8');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
// road vehicles from the models in src/ (tools/hd/vehicles_import.py + vehicles_tex.py) — optional
{
  const B = (f) => path.join(BUILD, f);
  if (fs.existsSync(B('vehicles.json')) && fs.existsSync(B('vehicles.bin'))) {
    const vgz = zlib.gzipSync(fs.readFileSync(B('vehicles.bin')), { level: 9 });
    html = html.replace('/*VEH_JSON*/', () => fs.readFileSync(B('vehicles.json'), 'utf8')).replace('/*VEH_BIN*/', () => vgz.toString('base64').replace(/(.{1,160})/g, '$1\n'))
      .replace('/*VEH_TEX*/', () => (fs.existsSync(B('veh_tex.json')) ? fs.readFileSync(B('veh_tex.json'), 'utf8') : '{}'));
  } else html = html.replace(/\/\*VEH_(JSON|BIN|TEX)\*\//g, '');
}
// hero models (tools/hd/hd_import_heroes.py + hero_tex.py): user-supplied WEAVER / PULSE, override the procedural heroes — optional
{
  const B = (f) => path.join(BUILD, f);
  if (fs.existsSync(B('heroes.json')) && fs.existsSync(B('heroes.bin'))) {
    const hgz = zlib.gzipSync(fs.readFileSync(B('heroes.bin')), { level: 9 });
    html = html.replace('/*HERO_JSON*/', () => fs.readFileSync(B('heroes.json'), 'utf8')).replace('/*HERO_BIN*/', () => hgz.toString('base64').replace(/(.{1,160})/g, '$1\n'))
      .replace('/*HERO_TEX*/', () => (fs.existsSync(B('hero_tex.json')) ? fs.readFileSync(B('hero_tex.json'), 'utf8') : '{}'));
  } else html = html.replace(/\/\*HERO_(JSON|BIN|TEX)\*\//g, '');
}
// Lower Manhattan scan (seed MAN), produced by tools/scan/build_scan.py — optional
const B = (f) => path.join(BUILD, f);
let scanMB = 0;
if (fs.existsSync(B('scan.json'))) {
  const sgz = zlib.gzipSync(fs.readFileSync(B('scan.bin')), { level: 9 });
  const tex = fs.readFileSync(B('scan_tex.webp')), map = fs.readFileSync(B('scan_map.jpg'));
  html = html.replace('/*SCAN_JSON*/', () => fs.readFileSync(B('scan.json'), 'utf8'))
    .replace('/*SCAN_BIN*/', () => sgz.toString('base64').replace(/(.{1,160})/g, '$1\n'))
    .replace('/*SCAN_TEX*/', () => tex.toString('base64')).replace('/*SCAN_MAP*/', () => map.toString('base64'));
  scanMB = (sgz.length + tex.length + map.length) / 1048576;
} else html = html.replace(/\/\*SCAN_(JSON|BIN|TEX|MAP)\*\//g, '');
// NYC official buildings for the scan map, produced by tools/scan/build_nyc.py — optional
if (fs.existsSync(B('scan.json')) && fs.existsSync(B('nyc.json'))) {
  const ngz = zlib.gzipSync(fs.readFileSync(B('nyc.bin')), { level: 9 });
  html = html.replace('/*NYC_JSON*/', () => fs.readFileSync(B('nyc.json'), 'utf8'))
    .replace('/*NYC_BIN*/', () => ngz.toString('base64').replace(/(.{1,160})/g, '$1\n'));
  const gtex = fs.existsSync(B('nyc_ground.jpg')) ? fs.readFileSync(B('nyc_ground.jpg')) : Buffer.alloc(0);
  // Reconstructed wall surfaces are paired with the analytic windows. Never prefer
  // an older sharpened photo, which would bake a second window pattern underneath.
  const facadeMeta = fs.existsSync(B('extra/facade_meta.json')) ? JSON.parse(fs.readFileSync(B('extra/facade_meta.json'), 'utf8')) : null;
  const cleanWalls = facadeMeta && facadeMeta.wallSurface >= 2 && fs.existsSync(B('nyc_atlas_walls.webp'));
  const atlasFile = cleanWalls ? 'nyc_atlas_walls.webp' : fs.existsSync(B('nyc_atlas_sharp.webp')) ? 'nyc_atlas_sharp.webp' : 'nyc_atlas.webp';
  const atex = fs.existsSync(B(atlasFile)) ? fs.readFileSync(B(atlasFile)) : Buffer.alloc(0);
  html = html.replace('/*NYC_GROUND*/', () => gtex.toString('base64')).replace('/*NYC_ATLAS*/', () => atex.toString('base64'));
  scanMB += (ngz.length + gtex.length + atex.length) / 1048576;
} else html = html.replace(/\/\*NYC_(JSON|BIN|GROUND|ATLAS)\*\//g, '');
// hero landmarks (tools/scan/landmarks.py) — optional
if (fs.existsSync(B('landmarks.json'))) {
  const lgz = zlib.gzipSync(fs.readFileSync(B('landmarks.bin')), { level: 9 });
  html = html.replace('/*LM_JSON*/', () => fs.readFileSync(B('landmarks.json'), 'utf8')).replace('/*LM_BIN*/', () => lgz.toString('base64').replace(/(.{1,160})/g, '$1\n'));
  scanMB += lgz.length / 1048576;
} else html = html.replace(/\/\*LM_(JSON|BIN)\*\//g, '');
// Optional isolated pedestrian/prop packs, reusing the hero/vehicle binary format.
for (const id of ['people','props']) {
  if (!fs.existsSync(B(id+'.json'))) continue;
  const data = fs.readFileSync(B(id+'.json'),'utf8');
  const packed = zlib.gzipSync(fs.readFileSync(B(id+'.bin')),{level:9}).toString('base64');
  const tex = fs.existsSync(B(id+'_tex.json')) ? fs.readFileSync(B(id+'_tex.json'),'utf8') : '{}';
  const tags = `<script type="application/json" id="tl-${id}-json">${data}</script><script type="application/octet-stream" id="tl-${id}-bin">${packed}</script><script type="application/json" id="tl-${id}-tex">${tex}</script>`;
  html = html.replace('</head>',()=>tags+'</head>');
}
if(fs.existsSync(B('props_credits.json'))) html=html.replace('</head>',()=>'<script type="application/json" id="tl-props-credits">'+fs.readFileSync(B('props_credits.json'),'utf8').replace(/</g,'\\u003c')+'</script></head>');
html = html.replace('/*ASSETS_JSON*/', () => json).replace('/*ASSETS_BIN*/', () => b64).replace('/*GAME_CODE*/', () => '"use strict";\n' + code);
// extra data (trees, facade detail, ...): <build>/extra/* -> #tl-extra
{
  const ED = path.join(BUILD, 'extra'), ex = {};
  if (fs.existsSync(ED)) for (const f of fs.readdirSync(ED).sort()) { const fp = path.join(ED, f); if (fs.statSync(fp).isFile()) ex[f] = fs.readFileSync(fp).toString('base64'); }
  html = html.replace('/*EXTRA_JSON*/', () => JSON.stringify(ex));
  scanMB += Object.values(ex).reduce((a, v) => a + v.length * 0.75, 0) / 1048576;
}
const out = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : path.join(ROOT, 'THREADLINE.html');
fs.writeFileSync(out, html);
console.log('wrote', out, (html.length / 1048576).toFixed(2), 'MB (assets gz', (gz.length / 1048576).toFixed(2), 'MB, scan', scanMB.toFixed(2), 'MB, code', (code.length / 1024).toFixed(0), 'KB)');
