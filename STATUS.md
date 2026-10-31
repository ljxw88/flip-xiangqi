# Status

- Playable hotseat and two-player WebSocket rooms, including server-side move validation, private face-down pieces, reconnection, and rematches.
- Run `npm ci` then `npm run dev`; for online play also run `npm run server` in a second terminal. See README for LAN and hosting instructions.
- Verified: `npm test` (33 tests), `npm run build`, and browser smoke tests for hotseat, online sync/reconnect, and mobile layout.
- Open questions: confirm the rules against Jiaxu's RedNote video, including draw/repetition rules; decide on production hosting, authentication, and persistence.
