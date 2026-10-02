'use strict';
/* Local 2-player check of THREADLINE_multi.html: static page + the real api/signal.js (in-memory store), host + joiner. */
const http = require('http'), fs = require('fs'), path = require('path');
const DIR = process.argv[2] || path.join(__dirname, '..', 'hosting', 'threadline_multi');
const harness = path.join(process.env.LOCALAPPDATA, 'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');
const puppeteer = require(path.join(harness, 'node_modules/puppeteer-core'));
const handler = require(path.join(DIR, 'api/signal.js'));
const srv = http.createServer((req, res) => {
  if (req.url.startsWith('/api/signal')) {
    let body = ''; req.on('data', (c) => body += c); req.on('end', () => {
      req.body = body ? JSON.parse(body) : null;
      const r = { setHeader: (k, v) => res.setHeader(k, v), status(c) { res.statusCode = c; return r; }, json(o) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); } };
      handler(req, r).catch((e) => { res.statusCode = 500; res.end(String(e)); });
    });
    return;
  }
  if (req.url.includes('/three@')) { res.setHeader('access-control-allow-origin', '*'); res.setHeader('Content-Type', 'application/javascript'); fs.createReadStream(path.join(harness, 'node_modules/three/build/three.min.js')).pipe(res); return; }
  res.setHeader('Content-Type', 'text/html'); fs.createReadStream(path.join(DIR, 'THREADLINE_multi.html')).pipe(res);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await new Promise((r) => srv.listen(8765, r));
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errs = { A: [], B: [] };
  const open = async (k) => {
    const p = await browser.newPage(); await p.setViewport({ width: 800, height: 450 });
    await p.setRequestInterception(true);
    p.on('request', (r) => r.url().includes('/three@') ? r.respond({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/javascript', body: fs.readFileSync(path.join(harness, 'node_modules/three/build/three.min.js')) }) : r.continue());
    p.on('pageerror', (e) => errs[k].push(e.message));
    await p.goto('http://localhost:8765/');
    await p.waitForFunction(() => window.__TL && window.__TL.game.state === 'title', { timeout: 120000 });
    return p;
  };
  try {
    const A = await open('A');
    const room = await A.evaluate(async () => { const n = TL.game.net; n.name = 'HostP'; await n.host(); await TL.ScanData.load(); TL.Input.prototype.lock = function () {}; TL.game.startGame({ seed: 'MAN' }); return n.room; });
    console.log('room', room);
    const B = await open('B');
    const seed = await B.evaluate(async (room) => { const n = TL.game.net; n.name = 'JoinP'; await n.join(room); await TL.ScanData.load(); TL.Input.prototype.lock = function () {}; TL.game.startGame({ seed: n.seed }); return n.seed; }, room);
    console.log('joiner got seed', seed);
    for (const P of [A, B]) await P.waitForFunction(() => TL.game.hero && TL.game.hero.ctrl, { timeout: 240000 });
    await B.waitForFunction(() => TL.game.net.remotes.size >= 1, { timeout: 60000 }).catch(() => {});
    await sleep(5000);
    // move the joiner's hero, then check the host sees it there
    await B.evaluate(() => { const h = TL.game.hero.ctrl || TL.game.hero; const p = (h.pos || h.c.pos); p.x += 25; });
    await A.bringToFront(); await A.evaluate(() => { const g = TL.game; if (g.state === 'paused') { if (g.resume) g.resume(); else g.state = 'play'; } });
    await sleep(5000);
    const sa = await A.evaluate(() => { const n = TL.game.net; const r = [...n.remotes.values()][0]; const rp = r && r.hero && r.hero.ctrl.pos; return { role: n.role, peers: n.peers.size, ready: [...n.peers.values()].map((p) => p.ready), buf: r ? r.buf.length : -1, hero: !!(r && r.hero), state: TL.game.state, remotes: n.remotes.size, players: [...n.players.values()], remotePos: rp && [rp.x, rp.y, rp.z].map((v) => +v.toFixed(1)), tlErrs: TL.errors.length, bq: TL.Buildings && TL.Buildings.ok, post: TL.Post && TL.Post.tier, crowd: !!TL.CrowdLife }; });
    const sb = await B.evaluate(() => { const n = TL.game.net; const h = TL.game.hero.ctrl || TL.game.hero; const p = h.pos || h.c.pos; const r = [...n.remotes.values()][0]; return { role: n.role, state: TL.game.state, buf: r ? r.buf.length : -1, hero: !!(r && r.hero), remotes: n.remotes.size, players: [...n.players.values()], myPos: [p.x, p.y, p.z].map((v) => +v.toFixed(1)), tlErrs: TL.errors.length }; });
    console.log('HOST', JSON.stringify(sa)); console.log('JOIN', JSON.stringify(sb));
    await A.screenshot({ path: path.join(__dirname, 'mp_host.png') }); await B.screenshot({ path: path.join(__dirname, 'mp_joiner.png') });
    const ok = sa.remotes >= 1 && sb.remotes >= 1 && sa.remotePos && Math.hypot(sa.remotePos[0] - sb.myPos[0], sa.remotePos[2] - sb.myPos[2]) < 6;
    console.log('page errors', JSON.stringify(errs).slice(0, 800));
    console.log(ok ? 'PASS multiplayer: host and joiner see each other, positions in sync' : 'FAIL multiplayer');
  } finally { await browser.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
