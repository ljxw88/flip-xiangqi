# Status

- Playable full-board 全盖翻转 (9 × 10): all 32 pieces start covered on standard starting points, with red and black mixed across both halves. Generals stay at home-rank centers and advisors beside them; elephants use legal own-side landings, and no piece is dealt to a point where it can never move.
- Each turn is a move of a revealed piece, or an own-color flip followed by an optional immediate move of that same piece. **End turn** keeps it in place. Covered pieces cannot move or attack, but can be captured by either side, including their owner, and are revealed in the capture list.
- Capture an enemy general (covered or revealed), or checkmate a revealed general, to win. Capturing your own covered general loses; stalemate loses. A covered general cannot be checked, and a player already in check must resolve it by moving.
- Identical covered backs and an original dark casino-inspired interface; narrow phones default to larger, horizontally scrollable board targets with a fit-to-screen option.
- Hotseat and two-player WebSocket rooms include server-side validation, hidden identities, reconnection, and rematches. Captures remain visible.
- Run `npm ci` then `npm run dev`; for online play also run `npm run server` in a second terminal. See README for rules, LAN play, and hosting.
- After upgrading, restart the room server and reload both browsers; old room protocols are incompatible.
- Verified with `npm test` (65 tests), `npm run build`, and Firefox smoke tests for 320px mobile, mixed-color flips, same-turn moves, covered captures, reconnects, wins, and rematches.
- No repetition or perpetual-check adjudication, persistent games, authentication, or production hosting hardening yet.
