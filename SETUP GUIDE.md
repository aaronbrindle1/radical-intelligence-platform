# Radical Intelligence Platform
## Setup & Feature Guide

---

## What this app does

The Radical Intelligence Platform is a private portfolio monitoring tool that tracks media coverage, social mentions, sentiment, and competitive share of voice for a curated list of companies. It runs entirely on your laptop — no cloud subscription required beyond the API keys you provide.

**Key capabilities:**
- 📰 News monitoring across approved outlets, with sentiment scoring
- 🐦 Twitter/X social mention tracking
- 🏆 Share of voice (SOV) analysis vs. named competitors
- 🤖 AI briefings and boolean query suggestions (via Claude / Anthropic)
- 📊 Downloadable PDF Portfolio Co. Reports
- 📧 Automated monthly Gmail draft reports (last Wednesday of each month)
- 🔬 Sandbox mode — test any company not in the main portfolio

---

## What's in this folder

```
Radical Intelligence Platform/
├── START-MAC.command        ← Double-click to launch on Mac
├── START-WINDOWS.bat        ← Double-click to launch on Windows
├── SETUP GUIDE.md           ← This file
├── proxy.mjs                ← Local API proxy server (port 3001)
├── report-mailer.mjs        ← Monthly report email logic
├── src/                     ← React app source code
│   ├── App.jsx              ← Main application
│   ├── data.js              ← Portfolio company definitions
│   ├── api.js               ← API call helpers
│   └── cache.js             ← SQLite cache helpers
└── package.json             ← Node dependencies
```

---

## STEP 1 — Install Node.js (one time only)

Node.js is a free runtime that the app needs. You only install it once.

### On a Mac:
1. Open Safari and go to **https://nodejs.org**
2. Click the big green **"LTS"** button
3. Open the downloaded `.pkg` file from your Downloads folder
4. Click **Continue → Continue → Agree → Install**
5. Enter your Mac password when prompted → click **Install Software**
6. When it says "The installation was successful" → click **Close**

### On Windows:
1. Go to **https://nodejs.org** and click the green **"LTS"** button
2. Open the downloaded `.msi` file
3. Click **Next → Next → I accept → Next → Next → Install**
4. Click **Yes** if asked to allow changes
5. Click **Finish** when done

> ✅ You only do Step 1 once. After that, skip straight to Step 2.

---

## STEP 2 — Start the app

### Mac:
1. Open the **Radical Intelligence Platform** folder
2. Right-click **START-MAC.command** → click **"Open"**
3. If macOS says it can't verify the developer → click **"Open"** (normal for non-App Store apps)
4. A Terminal window opens. After a few seconds, your browser opens at **http://localhost:3000**

### Windows:
1. Open the folder and double-click **START-WINDOWS.bat**
2. If Windows shows a blue "protected your PC" warning → click **"More info"** → **"Run anyway"**
3. A Command Prompt window opens. After a few seconds, your browser opens at **http://localhost:3000**

> ⚠️ **First run only:** Takes ~60 seconds to install dependencies. This only happens once.

> ⚠️ **Keep the Terminal/Command Prompt window open** while using the app. Closing it stops everything.

---

## STEP 3 — Add your API keys

When the app opens for the first time, go to **Admin → API Keys** and enter:

### Required — Anthropic (Claude AI)
Powers AI briefings, boolean query suggestions, and competitive analysis.
1. Go to **https://console.anthropic.com** → sign in
2. Click **API Keys** → **Create Key**
3. Copy the key (starts with `sk-ant-api03-...`) and paste it into the app

### Recommended — NewsAPI
Powers news monitoring and article fetching.
1. Go to **https://newsapi.org** → sign up for a free or paid account
2. Copy your API key from the dashboard

### Optional — Twitter/X (Data365)
Powers social mention tracking.
1. Go to **https://data365.co** → create an account
2. Copy your API key

> ✅ Keys are saved in your browser. You won't need to re-enter them after the first time.

---

## Every time after that

Just double-click **START-MAC.command** (or **START-WINDOWS.bat**) and the app opens. That's it.

---

## Features overview

### Portfolio tab
Displays all portfolio companies. For each company you can:
- Run a fresh search (fetches news + social for the past 30 days)
- View an AI briefing
- Download a PDF Portfolio Co. Report
- See share of voice vs. competitors

### Company Detail page
Click any company to see:
- Full article list with sentiment scores
- Social mentions
- SOV breakdown with charts
- AI competitive analysis
- Download button for a single-company PDF report

### Sandbox tab
Test any company not in the main portfolio:
- Enter a company name and (optionally) a boolean query
- Toggle News and Twitter on/off
- Enter the company's Twitter handle for social tracking
- The boolean query status shows whether it's saved and active

### Share of Voice (SOV)
Each company has a competitor list you can edit:
- Click **Edit** next to the competitor list
- Add or remove names
- Click **✓ Done** to save — changes persist across sessions

### Admin panel

| Tab | What it does |
|-----|-------------|
| **API Keys** | Enter Anthropic, NewsAPI, Twitter/Data365 keys |
| **Features** | Enable/disable Twitter, social features |
| **News Outlets** | Manage approved outlet list and tiers (T1/T2/T3) |
| **Data & Backup** | Export all your data as a JSON file; import from a backup |
| **📧 Monthly Reports** | Configure automated Gmail draft reports (see below) |

---

## Automated Monthly Reports (Gmail Drafts)

The app can automatically generate PDF Portfolio Co. Reports and save them as Gmail **drafts** on the last Wednesday of every month — ready to review and send.

### One-time Gmail setup

**1. Create a Google Cloud project (or use an existing one)**
- Go to **https://console.cloud.google.com**
- Create a new project or select an existing one

**2. Enable the Gmail API**
- In the left sidebar: **APIs & Services → Library**
- Search for **Gmail API** → click **Enable**

**3. Create OAuth credentials**
- **APIs & Services → Credentials → + Create Credentials → OAuth client ID**
- Application type: **Desktop app**
- Give it any name (e.g. `Radical Reports`) → click **Create**
- Copy the **Client ID** and **Client Secret**

**4. Add the redirect URI**
- Click the pencil (edit) icon on the new OAuth client
- Under **Authorized redirect URIs**, add: `http://localhost:3001/gmail/callback`
- Click **Save**

**5. Connect Gmail in the app**
- Open the app → **Admin → 📧 Monthly Reports**
- Paste your Client ID and Client Secret
- Click **Connect Gmail** — a Google sign-in page opens in your browser
- Sign in and approve access → you'll be redirected back and see **"Gmail connected ✓"**

### Configuring the monthly run

In **Admin → 📧 Monthly Reports**:
1. **Select companies** — check which portfolio companies to include
2. **Recipients** — enter one or more email addresses (comma-separated)
3. Click **Save settings**

The cron job fires every Wednesday at 8am and checks if it's the last Wednesday of the month. If yes, it generates a PDF for each selected company and saves a draft in your Gmail.

You can also click **Trigger now** to send a test run immediately.

> ⚠️ The app (START-MAC.command) must be running for the cron job to fire. If the Terminal window is closed, the scheduled job won't run.

---

## Backing up and restoring your data

All your edits (competitors, boolean queries, outlet lists, settings) live in your browser's localStorage. To back up:

1. Go to **Admin → Data & Backup**
2. Click **⬇ Export data** — saves a `.json` file to your Downloads
3. Keep this file somewhere safe (Dropbox, email to yourself, etc.)

To restore on a new computer:
1. Start the app and go to **Admin → Data & Backup**
2. Click **⬆ Import data** and select your backup file
3. The page reloads with all your data restored

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Port 3000 is already in use" | App is already running — go to http://localhost:3000 |
| Browser opens but blank page | Wait 5 seconds and refresh (Cmd+R / F5) |
| "npm: command not found" | Node.js didn't install correctly — redo Step 1 and restart your computer |
| App opens but no news results | Check that your NewsAPI key is entered in Admin → API Keys |
| AI briefing is blank | Check that your Anthropic key is valid in Admin → API Keys |
| Gmail drafts not appearing | Make sure the Terminal window is open; check that Gmail is connected in Admin → Monthly Reports |

---

## SQLite cache

The proxy server caches API responses in `api_cache.sqlite`. This reduces API costs for repeat searches. If you want a completely fresh fetch, delete this file from the app folder and restart.

---

*Radical Ventures — Radical Intelligence Platform*
