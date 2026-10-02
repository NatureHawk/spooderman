# THREADLINE multiplayer (Vercel)

The person who clicks **Host Room** runs the room in their own browser. Friends connect straight to them over WebRTC.
Vercel only serves the page and the handshake function `api/signal.js`.

## Deploy
1. Rebuild the page from the repo root: `node tools/build_multi.js`
2. In the Vercel dashboard for this project, go to Storage and add **Upstash for Redis** (free tier).
   It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Without it, joining only works under `vercel dev`.
3. From this folder, run `vercel --prod`
4. Optional: for players on strict networks (some mobile and corporate NATs), set `TURN_URLS`, `TURN_USERNAME`
   and `TURN_CREDENTIAL` to a TURN server (for example Cloudflare TURN or Metered). STUN alone covers most home networks.

## Play
- Host: enter a name, then click **Host Room**. This uses the seed on the title screen. The invite link `/?room=CODE` is copied to the clipboard.
- Join: open the invite link (or type the code) and click **Join**. You load the host's city and spawn next to them.
- Up to 8 players. If the host closes their tab, the room ends.
