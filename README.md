# 翻转象棋 · Flip

A full-board **全盖翻转** game for two people: play hotseat in one browser, or share a WebSocket room. Generals (帅/将), advisors (仕/士) and elephants (相/象) start face-up on their standard points; the other 22 pieces start covered.

**Play now:** <https://ljxw88.github.io/flip-xiangqi/> (hotseat and online rooms). The pure TypeScript engine enforces the rules; the online server reveals a covered piece's color and identity only when it is flipped or captured.

## Requirements and local play

Use Node.js 22.12+ on a supported release line (22, 24, or 26+) and npm.

```sh
npm ci
npm run dev
```

Open the address printed by Vite (normally <http://localhost:5173/>). Hotseat starts immediately: red plays first. Flip any covered piece. If it is your color, move that same piece immediately or choose **End turn**; if it is your opponent's color, the turn ends automatically. Alternatively, move an already revealed piece of your own color. Generals, advisors and elephants start face-up; the other covered backs look identical and their colors are mixed across the board. **New hotseat game** resets the board. On narrow phones, swipe the enlarged board sideways for larger tap targets, or choose **Fit board** to see it all at once.

```sh
npm test       # rules and WebSocket room tests
npm run build  # type-check and build the browser app into dist/
```

## Online play

Run both processes on the host machine, in separate terminals:

```sh
npm run server
```

```sh
npm run dev
```

1. Open the app, choose **Create online room**, and copy the invite link (or room code).
2. Open the link in a second, separate browser session, or enter the code there. Player 1 is red and moves first; Player 2 is black. The board is enabled only for the player whose turn it is.
3. For two devices on the same network, open the app on the host using `http://<host-LAN-IP>:5173/` **before** creating the room, and share the resulting link. `localhost` in a link refers to each device itself. Vite listens on network interfaces; allow port 5173 through the host firewall if necessary.

Vite proxies `/ws` to the room server at `127.0.0.1:3001`, so the other browser needs access only to Vite's port. If changing the backend port, set `WS_PORT` to the same value for **both** commands. `WS_HOST` changes the server's bind address (default `127.0.0.1`).

The game pauses if either player disconnects. Reload the same tab or use **Reconnect** to reclaim its seat using a session token stored in that tab's session storage. Seats remain reserved for their original players; create a new room for different players. Rooms are kept in memory and expire 30 minutes after both players disconnect; restarting the server deletes them immediately. After a game ends, either connected player may start a rematch.

This version changes the room protocol and replaces earlier turn and placement rules. After upgrading, restart the room server and reload both browsers; old in-memory rooms cannot be continued.

### Public deployment (GitHub Pages + room server)

- The browser app is built and deployed to <https://ljxw88.github.io/flip-xiangqi/> by `.github/workflows/pages.yml` on every push to `main` or `feat/full-cover-flip` (and on manual dispatch). It builds with `VITE_BASE=/flip-xiangqi/` and `VITE_WS_URL` from the repository variable of the same name.
- GitHub Pages cannot host WebSockets, so the room server runs on the `carrier` host (`npm run server`, port 3001) and is exposed through a free Cloudflare quick tunnel by `scripts/public-rooms.sh`. That script starts `cloudflared`, sets the `VITE_WS_URL` repository variable to the tunnel's `wss://…trycloudflare.com/ws` endpoint, and re-runs the Pages workflow so the site points at it. Quick-tunnel hostnames change whenever the tunnel restarts; rerun the script (it redeploys automatically). On carrier both processes run in the `flipx` tmux session.
- For a stable endpoint, replace the quick tunnel with a named Cloudflare tunnel, Tailscale Funnel, or any host that runs `npm run server` behind TLS, then set `VITE_WS_URL` and re-run the workflow.

### Hosting beyond a local network

The development server and plain HTTP/WebSocket are intended for trusted networks. For Internet play, build with `npm run build`, serve `dist/` over HTTPS, and reverse-proxy WebSocket upgrades on `/ws` to the running room server at `127.0.0.1:3001`. For example, inside an existing HTTPS nginx server block:

```nginx
location = /ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

The browser connects to `/ws` on the page's origin, using `wss` on HTTPS. Alternatively set `VITE_WS_URL` to a complete `ws://` or `wss://` endpoint when running Vite or building the app. `npm run preview` serves the built UI but does **not** proxy the room server; configure a reverse proxy or `VITE_WS_URL` for online play there.

This is not production-hardened: there are no accounts, persistent games, rate limits, or built-in TLS. Room links admit the second player, and reconnect tokens are bearer credentials; share them only with trusted people.

## Rules implemented

- The board has 9 files × 10 ranks, a river and two palaces. Pieces occupy the standard xiangqi starting points; the black palace is at the top and the red palace at the bottom. Red moves first.
- Each color has one general, two advisors, elephants, horses, rooks and cannons, and five soldiers. The non-fixed red and black pieces are shuffled among the **32 standard starting points**, so either color may appear on either half. **Generals, advisors and elephants start face-up**; all horses, rooks, cannons and soldiers start covered. Covered backs are identical; neither color nor rank of a covered piece is sent to players before a flip or capture.
- Generals always occupy the center of their own home rank, with advisors immediately beside them. Elephants are reserved for legal landings on their own side; every piece must have a possible move on an otherwise empty board. After these placements, the remaining pieces are Fisher–Yates shuffled over the free standard points. Because those positions were deducible anyway, the general, advisors and elephants are dealt face-up.
- A turn is either **move an already revealed piece of your color**, or **flip any covered piece**. If the flip reveals your color, you may move that same piece immediately or choose **End turn** to leave it in place. If it reveals your opponent's color, the turn ends automatically. You cannot flip twice or move a different piece in that chain. Covered pieces cannot move or attack, but they block lines and can serve as cannon screens. There is no starting-square movement role.
- A revealed piece may capture **any covered piece**, including one of its own color, using its normal movement and capture rules. Capturing a covered piece reveals its identity and color in the capture list. Revealed friendly pieces cannot be captured.
- Revealed pieces move and capture according to their true xiangqi identity, with no rank-based capture ladder: generals and advisors are palace-limited; elephants move two diagonally with an unblocked eye and may land only on their own side of the river; horses have a blockable leg; rooks travel along open ranks and files; cannons move similarly but capture over exactly one screen; soldiers move forward and can also move sideways after crossing the river. Other pieces may temporarily block a revealed piece. Captures remain visible in the captured-piece list.
- A covered general cannot be checked but **can be captured**, revealing it. Capturing the opponent's general wins, even if it was covered; capturing your own covered general loses. A revealed enemy general can also be checkmated. Moves may not leave your revealed general in check, and two revealed generals may not face each other along an open file (the flying-general rule). If you start your turn in check, you must resolve it by moving; flipping cannot resolve check. A flip may reveal your general into check: you can move it immediately if legal, or end the turn and risk capture.
- A player with no legal flip or move loses, including stalemate when not in check.
- There is **no automatic draw** or perpetual-check adjudication for repetition, a move count, or any other condition in this MVP, so a game can continue indefinitely.

## Project layout

- `src/game/engine.ts` — pure rules, legal actions, immutable game updates, and public board views.
- `src/App.tsx` and `src/styles.css` — browser UI.
- `src/multiplayer/` — shared protocol and browser WebSocket transport.
- `server/` — authoritative in-memory room server and integration tests.
