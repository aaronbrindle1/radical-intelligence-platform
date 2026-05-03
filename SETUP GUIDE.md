# Radical Intelligence Platform
## How to install and run — plain English guide

---

## What's in this folder

```
Radical Intelligence Platform/
├── START-MAC.command        ← Double-click this on a Mac
├── START-WINDOWS.bat        ← Double-click this on Windows
├── SETUP GUIDE.md           ← This file
└── (other app files)
```

---

## STEP 1 — Install Node.js (one time only)

Node.js is a free program that runs the app. You only install it once, ever.

### On a Mac:
1. Open Safari and go to: **https://nodejs.org**
2. Click the big green button that says **"LTS"** (it looks like "22.x.x LTS")
3. The download starts automatically — a file called something like `node-v22.x.x.pkg`
4. Open your **Downloads** folder and double-click that `.pkg` file
5. Click **Continue → Continue → Agree → Install**
6. It asks for your Mac password — type it and click **Install Software**
7. When it says "The installation was successful" — click **Close**

### On Windows:
1. Open Edge or Chrome and go to: **https://nodejs.org**
2. Click the big green button that says **"LTS"**
3. The download starts — a file called something like `node-v22.x.x-x64.msi`
4. Open your **Downloads** folder and double-click that `.msi` file
5. Click **Next → Next → I accept → Next → Next → Install**
6. It may ask "Do you want to allow this app to make changes?" — click **Yes**
7. When it finishes — click **Finish**

> ✅ You only do Step 1 once. Next time you want to run the app, skip straight to Step 2.

---

## STEP 2 — Put the app folder somewhere easy to find

1. The zip file you downloaded is called **radical-intelligence-platform-v2.zip**
2. Find it in your **Downloads** folder
3. Double-click it to unzip it
4. You'll get a folder called **radical-app-package**
5. Drag this folder to your **Desktop** (or Documents — somewhere you'll find it)
6. Rename it to **"Radical Intelligence"** if you like

---

## STEP 3 — Start the app

### On a Mac:

1. Open the **"Radical Intelligence"** folder
2. Find the file called **START-MAC.command** (it has a terminal icon)
3. **Right-click** it (or two-finger tap on trackpad)
4. Click **"Open"**
5. A box appears saying *"macOS cannot verify the developer"*
6. Click **"Open"** (this is normal for apps not from the App Store)
7. A black Terminal window opens — this is the app running
8. After a few seconds, your browser opens automatically at **http://localhost:3000**
9. The Radical Intelligence Platform appears 🎉

> ⚠️ **First time only:** The Terminal window will say "installing dependencies" and take about 30 seconds. This only happens once.

> ⚠️ **Keep the Terminal window open** while using the app. Closing it stops the app.

### On Windows:

1. Open the **"Radical Intelligence"** folder
2. Find the file called **START-WINDOWS.bat**
3. **Double-click** it
4. A blue box may appear saying *"Windows protected your PC"*
5. Click **"More info"** then click **"Run anyway"** (this is normal)
6. A black Command Prompt window opens
7. After a few seconds, your browser opens automatically at **http://localhost:3000**
8. The Radical Intelligence Platform appears 🎉

> ⚠️ **First time only:** Takes about 30 seconds to install. Only happens once.

> ⚠️ **Keep the Command Prompt window open** while using the app. Closing it stops the app.

---

## STEP 4 — Add your Anthropic API key

When the app opens for the first time, you'll see a **blue banner at the top** asking for your Anthropic API key. This key unlocks all the AI features (briefings, boolean suggestions, competitor research).

**To get your key:**
1. Go to **https://console.anthropic.com**
2. Sign in or create a free account
3. Click **"API Keys"** in the left menu
4. Click **"Create Key"**
5. Give it a name like "Radical Intelligence"
6. Copy the key — it starts with `sk-ant-api03-...`

**To add it to the app:**
1. Paste the key into the box in the blue banner
2. Click **"Save key"**
3. The banner disappears — you're ready to go

> ✅ The key is saved to your browser. You won't need to enter it again.

---

## Every time after that

Just double-click **START-MAC.command** (or **START-WINDOWS.bat**) and the app opens. That's it.

---

## Stopping the app

Close the black Terminal (or Command Prompt) window. Or just leave it running in the background — it doesn't slow your computer down.

---

## If something goes wrong

**"Port 3000 is already in use"**
The app is already running. Just go to http://localhost:3000 in your browser.

**Browser opens but shows a blank page**
Wait 5 seconds and refresh (Cmd+R on Mac, F5 on Windows).

**"npm: command not found" or "npm is not recognized"**
Node.js didn't install correctly. Go back to Step 1 and try again, restarting your computer after the install.

**Anything else**
Take a screenshot and share it in this chat — it can be diagnosed and fixed.

---

## Your data is saved automatically

Everything you change in the app — portfolio edits, boolean queries, competitors, outlet lists, API keys — is saved automatically to your browser. It will still be there next time you open the app.

### SQLite Caching
The application now uses a local SQLite database (`api_cache.sqlite`) via the proxy server to cache API responses. This significantly reduces API costs for NewsAPI and Data365, and improves loading times for subsequent searches. The cache runs automatically — you do not need to set anything up. If you wish to clear it, you can delete the `api_cache.sqlite` file in the application folder and restart the proxy.

### Managing Approved Outlets
The platform filters NewsAPI results against a curated list of approved media outlets. To modify this list:
1. Go to **Admin → News Outlets**.
2. Add new outlets or remove existing ones, and assign tiers (T1, T2, T3).
3. The platform will automatically update news feeds and company detail views to display approved badges based on this list.

To back up your data: go to **Admin → Data & backup → Export config**.

---

*Radical Ventures Portfolio Intelligence Platform*
