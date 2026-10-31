# Flip Xiangqi · 暗棋

A playable dark-chess MVP: two-player hotseat in one browser, or a shareable WebSocket room for two browsers. Rules are implemented in a pure TypeScript engine; the online server holds the authoritative board and never sends the identities of face-down pieces to clients.

## Requirements and local play

Use Node.js 22.12+ on a supported release line (22, 24, or 26+) and npm.

```sh
npm ci
npm run dev
```

Open the address printed by Vite (normally <http://localhost:5173/>). Hotseat starts immediately: take turns on the same device. Click a face-down piece to flip it, or click one of your face-up pieces and then a highlighted destination. **New hotseat game** resets the board.

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
2. Open the link in a second, separate browser session, or enter the code there. Player 1 starts; the board is enabled only for the player whose turn it is.
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

- The board has 4 rows × 8 columns. Each color has one general, two each of advisor, elephant, rook, horse and cannon, and five soldiers. All 32 pieces start face-down in random positions.
- Player 1 flips first and takes that piece's color; Player 2 takes the other color. On each turn, flip **any** face-down piece, or move one of your face-up pieces one orthogonal square.
- Ordinary pieces move to an empty square or capture an enemy face-up piece of equal or lower rank: **general > advisor > elephant > rook > horse > cannon > soldier**. A soldier may capture a general, but a general may not capture a soldier. A normal move cannot land on a face-down or friendly piece.
- A cannon moves one square when not capturing. To capture, it must jump exactly one intervening piece, of either color and face-up or face-down, along a row or column. The next piece must be an enemy face-up piece; its rank does not matter. Cannons cannot capture an adjacent piece or a face-down target.
- A player wins immediately on capturing **all** opposing pieces, counting the actual colors of pieces still face-down. A player also wins if the opponent has no legal action on their next turn; flipping any remaining face-down piece is a legal action.
- There is **no automatic draw** for repetition, a move count, or any other condition in this MVP, so a game can continue indefinitely. There are no check or facing-generals rules from full-board Xiangqi.

These rules are provisional pending the referenced RedNote video and Jiaxu's confirmation.

## Project layout

- `src/game/engine.ts` — pure rules, legal actions, immutable game updates, and public board views.
- `src/App.tsx` and `src/styles.css` — browser UI.
- `src/multiplayer/` — shared protocol and browser WebSocket transport.
- `server/` — authoritative in-memory room server and integration tests.
