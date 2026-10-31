# Jieqi · 揭棋

A full-board dark-xiangqi game for two people: play hotseat in one browser, or share a WebSocket room. The pure TypeScript engine enforces the rules; the online server holds the authoritative board and never sends covered identities to either player until a piece moves or is captured.

## Requirements and local play

Use Node.js 22.12+ on a supported release line (22, 24, or 26+) and npm.

```sh
npm ci
npm run dev
```

Open the address printed by Vite (normally <http://localhost:5173/>). Hotseat starts immediately: red moves first. Select one of your pieces, covered or revealed, then select a highlighted destination. A covered piece reveals itself when it moves; there is no separate flip action. **New hotseat game** resets the board.

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
- Each side has one general, two advisors, elephants, horses, rooks and cannons, and five soldiers. Only the generals start face-up. The other **15 identities per side are independently shuffled among that side's 15 non-general starting points** using Fisher–Yates. A covered piece's color and starting-square role are known, but its true identity is hidden from both players.
- A covered piece's **first move and capture use the role of its starting point**, not its hidden identity. For example, a covered piece on a soldier's starting point first moves like a soldier; it may then reveal as an elephant. It reveals immediately after moving and uses its true identity on later turns. There is no standalone flip.
- Covered pieces occupy and block points, and can capture or be captured. A captured covered piece's true identity is revealed to both players and remains in the captured-piece list.
- Revealed pieces use xiangqi movement: generals and advisors may land only in their own palace; elephants move two diagonally with an unblocked eye and may land only on their own side of the river; horses have a blockable leg; rooks travel along open ranks and files; cannons move similarly but capture over exactly one screen; soldiers move forward and can also move sideways after crossing the river. There is no rank-based capture restriction. These palace and river limits remain in effect after revelation, even if a piece is revealed outside its usual area.
- A move may not leave your general in check, including the flying-general rule: opposing generals cannot face each other along an open file. Covered pieces threaten according to their starting-square role; once revealed they threaten according to their true identity. Checkmate wins, and a player with no legal move loses even when not in check (stalemate). The game ends before a general is captured.
- There is **no automatic draw** or perpetual-check adjudication for repetition, a move count, or any other condition in this MVP, so a game can continue indefinitely.

## Project layout

- `src/game/engine.ts` — pure rules, legal actions, immutable game updates, and public board views.
- `src/App.tsx` and `src/styles.css` — browser UI.
- `src/multiplayer/` — shared protocol and browser WebSocket transport.
- `server/` — authoritative in-memory room server and integration tests.
