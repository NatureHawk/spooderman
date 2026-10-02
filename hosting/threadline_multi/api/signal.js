/* THREADLINE multiplayer signaling (Vercel Function).
   Only used for the WebRTC handshake: the room creator's browser is the game host, every joiner opens
   a direct peer connection to it, and this endpoint just passes the offer/answer between them.
   Storage: Upstash Redis over REST (Vercel Marketplace "Upstash for Redis" sets KV_REST_API_URL /
   KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Without it, an in-memory
   store is used, which only works under `vercel dev` (production functions don't share memory).

   POST /api/signal  JSON body, op:
     create            -> { room }                       new room code; the caller is its host
     send  room to msg -> { ok }                         queue msg for peer `to` ('host' or a joiner id)
     recv  room id     -> { msgs: [...], alive }         drain the queue of peer `id`
     close room        -> { ok }                         host left
     ice               -> { iceServers }                 STUN (+ TURN from env TURN_URLS/TURN_USERNAME/TURN_CREDENTIAL) */
'use strict';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ROOM_TTL = 2 * 3600, QUEUE_TTL = 120, MAX_MSG = 24 * 1024, MAX_QUEUE = 32;
const ROOM_RE = /^[A-HJ-NP-Z2-9]{5}$/, ID_RE = /^(host|[a-z0-9]{4,16})$/;

/* ---- store: Upstash REST, or process memory for local dev */
const mem = globalThis.__tlMem || (globalThis.__tlMem = new Map());   // key -> { v, exp }
function memGet(k) { const e = mem.get(k); if (!e) return null; if (e.exp < Date.now()) { mem.delete(k); return null; } return e.v; }
const memStore = {
  async setNX(k, v, ttl) { if (memGet(k) !== null) return false; mem.set(k, { v, exp: Date.now() + ttl * 1000 }); return true; },
  async exists(k) { return memGet(k) !== null; },
  async touch(k, ttl) { const v = memGet(k); if (v !== null) mem.set(k, { v, exp: Date.now() + ttl * 1000 }); },
  async del(k) { mem.delete(k); },
  async push(k, v, ttl) { const q = memGet(k) || []; q.push(v); if (q.length > MAX_QUEUE) q.shift(); mem.set(k, { v: q, exp: Date.now() + ttl * 1000 }); },
  async drain(k) { const q = memGet(k) || []; mem.delete(k); return q; },
};
async function redis(cmds) {
  const r = await fetch(URL_ + '/multi-exec', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error('redis ' + r.status);
  const out = await r.json();
  return out.map((x) => { if (x.error) throw new Error(x.error); return x.result; });
}
const redisStore = {
  async setNX(k, v, ttl) { const [r] = await redis([['SET', k, v, 'EX', String(ttl), 'NX']]); return r === 'OK'; },
  async exists(k) { const [r] = await redis([['EXISTS', k]]); return r === 1; },
  async touch(k, ttl) { await redis([['EXPIRE', k, String(ttl)]]); },
  async del(k) { await redis([['DEL', k]]); },
  async push(k, v, ttl) { await redis([['RPUSH', k, v], ['LTRIM', k, String(-MAX_QUEUE), '-1'], ['EXPIRE', k, String(ttl)]]); },
  async drain(k) { const [list] = await redis([['LRANGE', k, '0', '-1'], ['DEL', k]]); return list || []; },
};
const store = URL_ && TOKEN ? redisStore : memStore;

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I
  let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const turn = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (turn.length) list.push({ urls: turn, username: process.env.TURN_USERNAME || '', credential: process.env.TURN_CREDENTIAL || '' });
  return list;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }   // sendBeacon posts text/plain
  if (!b || typeof b !== 'object') { res.status(400).json({ error: 'bad body' }); return; }
  const room = String(b.room || ''), rk = 'tl:room:' + room;
  try {
    switch (b.op) {
      case 'create': {
        for (let i = 0; i < 8; i++) {
          const code = newCode();
          if (await store.setNX('tl:room:' + code, String(Date.now()), ROOM_TTL)) { res.json({ room: code, store: store === memStore ? 'memory' : 'redis' }); return; }
        }
        res.status(503).json({ error: 'no free room code' }); return;
      }
      case 'send': {
        const to = String(b.to || ''), msg = JSON.stringify(b.msg || null);
        if (!ROOM_RE.test(room) || !ID_RE.test(to)) { res.status(400).json({ error: 'bad room/peer' }); return; }
        if (msg.length > MAX_MSG) { res.status(413).json({ error: 'message too large' }); return; }
        if (!(await store.exists(rk))) { res.status(404).json({ error: 'room not found' }); return; }
        await store.push('tl:q:' + room + ':' + to, msg, QUEUE_TTL);
        res.json({ ok: true }); return;
      }
      case 'recv': {
        const id = String(b.id || '');
        if (!ROOM_RE.test(room) || !ID_RE.test(id)) { res.status(400).json({ error: 'bad room/peer' }); return; }
        const alive = await store.exists(rk);
        if (alive && id === 'host') await store.touch(rk, ROOM_TTL);   // the host's polling keeps the room open
        const raw = await store.drain('tl:q:' + room + ':' + id);
        const msgs = raw.map((s) => { try { return JSON.parse(s); } catch (e) { return null; } }).filter(Boolean);
        res.json({ msgs, alive }); return;
      }
      case 'close': {
        if (ROOM_RE.test(room)) await store.del(rk);
        res.json({ ok: true }); return;
      }
      case 'ice': res.json({ iceServers: iceServers() }); return;
      default: res.status(400).json({ error: 'unknown op' });
    }
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};
