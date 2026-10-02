/* THREADLINE multiplayer build: the normal game + src/19_multi.js, written to the Vercel project
   hosting/threadline_multi/THREADLINE_multi.html (static page + api/signal.js handshake function).
   Usage: node tools/build_multi.js [out.html]     Deploy: cd hosting/threadline_multi && vercel --prod */
'use strict';
const path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join('hosting', 'threadline_multi', 'THREADLINE_multi.html');
execFileSync(process.execPath, [path.join(__dirname, 'build.js'), out], {
  cwd: ROOT, stdio: 'inherit',
  env: Object.assign({}, process.env, { TL_EXTRA_MODULES: '19_multi.js' }),
});
