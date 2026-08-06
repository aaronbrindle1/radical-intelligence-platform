#!/bin/bash
cd "/Users/aaronbrindle/Desktop/Radical Intelligence Platform 4"

echo ">>> Stopping all running servers..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

echo ">>> Downloading latest code from GitHub..."
curl -sf -o proxy.mjs "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/proxy.mjs?$(date +%s)" && echo "  proxy.mjs updated" || echo "  proxy.mjs FAILED"
curl -sf -o vite.config.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/vite.config.js?$(date +%s)" && echo "  vite.config.js updated" || echo "  vite.config.js FAILED"
curl -sf -o src/App.jsx "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/App.jsx?$(date +%s)" && echo "  App.jsx updated" || echo "  App.jsx FAILED"
curl -sf -o src/api.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/api.js?$(date +%s)" && echo "  api.js updated" || echo "  api.js FAILED"
curl -sf -o src/data.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/data.js?$(date +%s)" && echo "  data.js updated" || echo "  data.js FAILED"

echo ">>> Starting app..."
npm run dev
