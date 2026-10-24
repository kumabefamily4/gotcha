# Gotcha!

Multiplayer iPhone-landscape browser scavenger game (Three.js). Create a room, share the URL, find your items, meet at the goal.

## Local play

Serve the repo root over HTTP (ES modules + workers need a server):

```bash
npx --yes serve -l 3000
```

Open `http://localhost:3000/?net=local` in two tabs to test lobby and game without Ably.

## Deploy (Vercel)

1. Import GitHub repo `kumabefamily4/gotcha` in Vercel (root directory = repo root).
2. Set environment variable **`ABLY_API_KEY`** (`appId.keyId:secret` from Ably dashboard).
3. Optional voice relay: **`TURN_URLS`**, **`TURN_USERNAME`**, **`TURN_CREDENTIAL`** (see `api/turn.js`).
4. Deploy. Share `https://your-app.vercel.app/?g=ROOMCODE` or use in-app share link.

## Music

Place optional tracks at `music/lobby.mp3` and `music/game.mp3`. If missing, the built-in synth BGM plays. Add credits in `src/credits.js` when using licensed audio.

## Tests

```bash
npm test
```

## Docs

Project spec and decisions: `docs/gotcha-game-project.md` (from Claude project memory).
