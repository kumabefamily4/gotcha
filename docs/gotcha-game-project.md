---
name: gotcha-game-project
description: Gotcha! iPhone-landscape multiplayer WebGL scavenger game — spec, decisions, open questions (as of 2026-10-24)
metadata:
  type: project
---

Kumabe wants "Gotcha!": browser 3D game (Three.js), iPhone landscape, gyro 360 look, left joystick, right jump+action buttons (jump lower-left, action upper-right), mini-map top-right (blue self, red goal shown only after all items), multiplayer lobby by share URL, host picks items-per-player and starts, usernames, voice chat via mic, skateboarder-style humanoids, procedural pastel city (baby blue, teal, late-day yellow, orange), J-Pop-style BGM (different lobby/game tracks), per-player private items with route lengths within 10%, shared goal, HUD player statuses, leavers vanish. Host on Vercel, code in GitHub. Earlier ask: optional side-by-side stereo (cams 6.3 cm apart, parallel).

Open questions asked 2026-10-24 in thread: repo name; realtime service (recommended Supabase Realtime + Metered TURN vs PeerJS no-account); procedural synth music OK?; stereo default (proposed toggle, default Normal); action button meaning (proposed pick-up); expected player count for "yet to join".

**Why:** later threads must not re-ask. **How to apply:** update with answers when received. User prefs: plain text chat, no docs unless asked, blunt assessments.
