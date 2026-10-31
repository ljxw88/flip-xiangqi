# 翻转象棋 · Flip

A full-board **全盖翻转** game for two people: play hotseat in one browser, or share a WebSocket room. Every piece starts covered, including both generals. The pure TypeScript engine enforces the rules; the online server never sends a covered identity to either player until its owner flips it.

## Requirements and local play

Use Node.js 22.12+ on a supported release line (22, 24, or 26+) and npm.

```sh
npm ci
npm run dev
```

Open the address printed by Vite (normally <http://localhost:5173/>). Hotseat starts immediately: red plays first. On your turn, click one of your covered pieces to flip it **in place**, or select one of your revealed pieces and then a highlighted destination. A flip ends the turn; it does not also move. **New hotseat game** resets the board.

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

This version replaces both the old 4×8 Banqi and the earlier full-board 揭棋 protocols. After upgrading, restart the room server and reload both browsers; old in-memory rooms cannot be continued.

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

- The board has 9 files × 10 ranks, a river and two palaces. Pieces occupy the standard xiangqi starting points; black is at the top and red at the bottom. Red moves first.
- Each side has one general, two advisors, elephants, horses, rooks and cannons, and five soldiers. **All 16 identities on each side, including the general, are shuffled independently among that side's 16 starting points** using Fisher–Yates. The color of a covered piece is public; its true identity is hidden from both players. A general may start outside its usual palace.
- Each turn consists of exactly one action: **flip one of your own covered pieces in place**, or **move one of your already revealed pieces**. A flip ends the turn. Covered pieces cannot move, attack, be captured, or be landed on; they still block lines and can serve as cannon screens. There is no starting-square movement role.
- Revealed pieces move and capture according to their true xiangqi identity, with no rank-based capture ladder: generals and advisors are palace-limited; elephants move two diagonally with an unblocked eye and may land only on their own side of the river; horses have a blockable leg; rooks travel along open ranks and files; cannons move similarly but capture over exactly one screen; soldiers move forward and can also move sideways after crossing the river. A piece revealed outside its usual area may be unable to move. Captures remain visible in the captured-piece list.
- A covered general cannot be checked or captured. Once revealed, a general can be captured or checkmated. Moves may not leave your revealed general in check, and two revealed generals may not face each other along an open file (the flying-general rule). If you start your turn in check, you must resolve it by moving; flipping cannot resolve check. Since the hidden identity is unknown, flipping is still allowed when it reveals your general into check, and the opponent may capture it immediately.
- Capturing or checkmating the revealed enemy general wins. A player with no legal flip or move loses, including stalemate when not in check.
- There is **no automatic draw** or perpetual-check adjudication for repetition, a move count, or any other condition in this MVP, so a game can continue indefinitely.

## Project layout

- `src/game/engine.ts` — pure rules, legal actions, immutable game updates, and public board views.
- `src/App.tsx` and `src/styles.css` — browser UI.
- `src/multiplayer/` — shared protocol and browser WebSocket transport.
- `server/` — authoritative in-memory room server and integration tests.
