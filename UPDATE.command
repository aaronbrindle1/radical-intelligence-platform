#!/bin/bash
cd "/Users/aaronbrindle/Desktop/Radical Intelligence Platform 4"

echo "Stopping any running servers..."
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null

echo "Downloading latest code from GitHub..."
curl -s -o proxy.mjs "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/proxy.mjs?$(date +%s)"
curl -s -o vite.config.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/vite.config.js?$(date +%s)"
curl -s -o src/App.jsx "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/App.jsx?$(date +%s)"

echo "Starting app..."
npm run dev
