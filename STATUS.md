# Status

- Playable full-board 全盖翻转 (9 × 10): all 32 pieces, including generals, start covered, with each side's 16 identities independently shuffled over its standard starting points.
- Each turn is either an own-color flip in place or a move of a revealed piece; flipping ends the turn. Default: covered pieces cannot move, attack, be captured, or be landed on, but still block and screen.
- Capture or checkmate a revealed general to win; stalemate loses. A covered general cannot be checked; a flip may reveal it into check, but a player already in check must resolve it by moving.
- Hotseat and two-player WebSocket rooms include server-side validation, hidden identities, reconnection, and rematches. Revealed captures remain visible.
- Run `npm ci` then `npm run dev`; for online play also run `npm run server` in a second terminal. See README for rules, LAN play, and hosting.
- After upgrading from 揭棋 or Banqi, restart the room server and reload both browsers; old rooms are incompatible.
- Verified with `npm test` (47 tests), `npm run build`, and Firefox smoke tests for hotseat, 360px mobile, online flips and moves, covered immunity, wins, rematches, and reconnection.
- No repetition or perpetual-check adjudication, persistent games, authentication, or production hosting hardening yet.
