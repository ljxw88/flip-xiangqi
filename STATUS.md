# Status

- **Play:** <https://ljxw88.github.io/flip-xiangqi/> (GitHub Pages, public repo). Hotseat works offline; **VS → Create room** gives an invite link that works from anywhere.
- **Online rooms:** the room server runs on carrier (`npm run server`, port 3001) behind a free Cloudflare quick tunnel (`scripts/public-rooms.sh`, tmux session `flipx` on carrier). The script writes the current `wss://…trycloudflare.com/ws` URL to the `VITE_WS_URL` repo variable and redeploys Pages automatically; the hostname changes whenever the tunnel restarts. Rooms are in memory and depend on carrier being up.
- **Opening:** generals (帅/将), advisors (仕/士) and elephants (相/象) start face-up on their standard points; the other 22 pieces start covered (暗) on the standard starting points, with red and black mixed across both halves. Placement rules: generals at palace centers, advisors beside them, elephants on legal landings, no piece on a point where it can never move.
- **Turns:** either player may flip any covered piece. A same-color flip allows an optional immediate move of that piece or **End turn**; an opponent-color flip ends the turn. Only revealed pieces of your own color move. Covered pieces can be captured by either side, including their owner.
- **Winning:** capture an enemy general (covered or revealed), or checkmate it. Capturing your own covered general loses; stalemate loses. A player in check must resolve it by moving.
- **UI:** dark casino-style board with a sparse header (new game ↻, online VS, rules ?) and bottom sheets for rules and rooms; narrow phones can zoom the board.
- **Dev:** `npm ci`, `npm run dev` + `npm run server`. Verified with `npm test` (72 tests) and `npm run build`; Pages deploy runs both in CI.
- **Not yet:** stable WS hostname (needs Tailscale Funnel enabled on the tailnet, a named Cloudflare tunnel, or a hosting account), repetition/perpetual-check adjudication, persistent games, accounts, rate limiting.
