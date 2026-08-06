#!/bin/bash
cd "/Users/aaronbrindle/Desktop/Radical Intelligence Platform 4"

# Kill anything on ports 3000 and 3001
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1

# Download ALL latest files from GitHub
curl -sf -o proxy.mjs "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/proxy.mjs?t=$(date +%s)"
curl -sf -o vite.config.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/vite.config.js?t=$(date +%s)"
curl -sf -o src/App.jsx "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/App.jsx?t=$(date +%s)"
curl -sf -o src/api.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/api.js?t=$(date +%s)"
curl -sf -o src/data.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/data.js?t=$(date +%s)"

# Start
npm run dev
