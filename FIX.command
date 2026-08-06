#!/bin/bash
cd "/Users/aaronbrindle/Desktop/Radical Intelligence Platform 4"
lsof -ti:3000 | xargs kill -9 2>/dev/null
lsof -ti:3001 | xargs kill -9 2>/dev/null
sleep 1
curl -sf -o proxy.mjs "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/proxy.mjs?$(date +%s)"
curl -sf -o src/api.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/api.js?$(date +%s)"
curl -sf -o src/data.js "https://raw.githubusercontent.com/aaronbrindle1/radical-intelligence-platform/main/src/data.js?$(date +%s)"
npm run dev
