# Status

- Playable full-board 揭棋 (9 × 10), with standard starting points, two visible generals, and independently shuffled hidden identities for each side.
- A covered piece's first move uses its starting-square role, then reveals its true identity; a covered capture is also revealed. Checkmate and stalemate are wins, with xiangqi movement, check, and flying-general rules.
- Hotseat and two-player WebSocket rooms include server-side validation, hidden identities, reconnection, and rematches. Captures remain visible in the game history.
- Run `npm ci` then `npm run dev`; for online play also run `npm run server` in a second terminal. See README for rules, LAN play, and hosting.
- Verified with `npm test`, `npm run build`, and Firefox smoke tests for hotseat, 360px mobile layout, online moves, capture reveals, and reconnection.
- No repetition or perpetual-check adjudication, persistent games, authentication, or production hosting hardening yet.
