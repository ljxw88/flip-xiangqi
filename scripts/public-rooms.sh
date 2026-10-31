#!/usr/bin/env bash
# Expose the local room server to the Internet through a free Cloudflare quick tunnel,
# then point the GitHub Pages build at it and redeploy. Run on the host that runs `npm run server`.
# Quick-tunnel hostnames change on every restart; this script republishes the site each time.
set -euo pipefail
PORT="${WS_PORT:-3001}"
REPO="${REPO:-ljxw88/flip-xiangqi}"
REF="${REF:-$(git rev-parse --abbrev-ref HEAD)}"
LOG="${LOG:-/tmp/flip-xiangqi-tunnel.log}"

: > "$LOG"
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill $TUNNEL_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  HOST=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$HOST" ] && break
  sleep 1
done
[ -n "${HOST:-}" ] || { echo "No tunnel URL; see $LOG" >&2; exit 1; }

WS_URL="wss://${HOST#https://}/ws"
echo "Public room server: $WS_URL"
echo "$WS_URL" > /tmp/flip-xiangqi-ws-url
gh variable set VITE_WS_URL --repo "$REPO" --body "$WS_URL"
gh workflow run pages.yml --repo "$REPO" --ref "$REF"
wait $TUNNEL_PID
