#!/bin/bash

# ============================================================
#  Radical Intelligence Platform — Mac Launcher
#  Starts both the app (port 3000) and API proxy (port 3001)
# ============================================================

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

clear
echo ""
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║   Radical Intelligence Platform           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo ""

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  ❌  Node.js is not installed."
  echo "  Go to https://nodejs.org, download LTS, install it, restart Mac."
  open "https://nodejs.org"
  echo "  Press any key to close..."
  read -n 1
  exit 1
fi
echo "  ✓ Node.js $(node --version)"
echo ""

# ── Install dependencies if needed ────────────────────────────────────────────
if [ ! -d "$DIR/node_modules" ]; then
  echo "  📦 First-time setup — installing (~60 seconds)..."
  npm install
  if [ $? -ne 0 ]; then
    echo "  ❌  Installation failed. Check internet and try again."
    echo "  Press any key to close..."
    read -n 1
    exit 1
  fi
  echo "  ✓ Setup complete"
  echo ""
fi

# ── Check if already running ──────────────────────────────────────────────────
if lsof -i :3000 &>/dev/null; then
  echo "  ⚠️  App already running — opening browser."
  open "http://localhost:3000"
  echo "  Press any key to close..."
  read -n 1
  exit 0
fi

# ── Start proxy server (port 3001) ────────────────────────────────────────────
echo "  🔌 Starting API proxy (port 3001)..."
node "$DIR/proxy.mjs" &
PROXY_PID=$!
sleep 1

if ! kill -0 $PROXY_PID 2>/dev/null; then
  echo "  ⚠️  Proxy failed to start — Yutori/Cohere will use sample data"
else
  echo "  ✓ API proxy running (PID $PROXY_PID)"
fi
echo ""

# ── Open browser after delay ──────────────────────────────────────────────────
(sleep 4 && open "http://localhost:3000") &

# ── Start app (port 3000) — this blocks until you close the window ────────────
echo "  🚀 Starting app..."
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  App:    http://localhost:3000              │"
echo "  │  Proxy:  http://localhost:3001              │"
echo "  │                                             │"
echo "  │  ⚠ Keep this window OPEN while using app   │"
echo "  │  To stop: close this window                 │"
echo "  └─────────────────────────────────────────────┘"
echo ""

npm run dev

# Clean up proxy when app stops
kill $PROXY_PID 2>/dev/null
echo ""
echo "  App stopped. Press any key to close..."
read -n 1
