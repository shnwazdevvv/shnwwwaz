# 🎵 Spotify Telegram Music Downloader Bot

A Telegram bot that lets users download any Spotify song as a 192kbps MP3 file, sourced from YouTube audio. Built with Node.js, deployable on Render with MongoDB Atlas for stats tracking.

---

## ✨ Features

- 🔗 Download by Spotify track URL
- 🔍 Search by song name / artist
- 📊 Per-user download stats via MongoDB
- 🎧 192kbps MP3 quality
- 💬 Live status updates in Telegram
- 🌐 Express HTTP server (required for Render)

---

## 🚀 Quick Deploy to Render

### Step 1: Get Your Credentials

#### Telegram Bot Token
1. Open Telegram, search for **@BotFather**
2. Send `/newbot` and follow the prompts
3. Copy the token (looks like `123456789:AAF...`)

#### Spotify API Keys
1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Log in → **Create App**
3. Fill in app name & description → check the boxes → Create
4. Copy **Client ID** and **Client Secret**

#### MongoDB Atlas (Free)
1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Create a free account → **Build a Database** → Free M0 tier
3. Create a username & password
4. Under **Network Access** → Add IP Address → `0.0.0.0/0` (allow all)
5. Under **Database** → Connect → Drivers → Copy the URI
6. Replace `<password>` with your actual password in the URI

---

### Step 2: Deploy on Render

1. **Fork or upload** this repo to GitHub
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name**: `spotify-telegram-bot` (or anything)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add **Environment Variables** (click "Add Environment Variable" for each):

| Key | Value |
|-----|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `SPOTIFY_CLIENT_ID` | From Spotify Dashboard |
| `SPOTIFY_CLIENT_SECRET` | From Spotify Dashboard |
| `MONGODB_URI` | Your MongoDB Atlas connection string |

> ⚠️ Do NOT add `PORT` — Render sets it automatically.

6. Click **Create Web Service** → Wait for deploy (~3-5 mins first time)

---

## 💻 Local Development

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/spotify-telegram-bot
cd spotify-telegram-bot

# 2. Install dependencies
npm install

# 3. Create your .env file
cp .env.example .env
# Edit .env with your credentials

# 4. Run
npm run dev   # with auto-reload (nodemon)
# OR
npm start     # production mode
```

---

## 🤖 Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message & instructions |
| `/help` | Detailed usage guide |
| `/search <query>` | Search and download a song |
| `/stats` | View your download history |

**Also supports:**
- Pasting a Spotify track URL directly
- Typing any song name + artist name

---

## 📁 Project Structure

```
spotify-telegram-bot/
├── index.js          # Entry point (starts server + bot)
├── bot.js            # All Telegram bot logic
├── server.js         # Express HTTP server (for Render health checks)
├── db.js             # MongoDB connection
├── models/
│   ├── Download.js   # Download log schema
│   └── User.js       # User schema
├── temp/             # Temporary MP3 files (auto-cleaned)
├── .env.example      # Environment variable template
├── package.json
└── README.md
```

---

## ⚙️ How It Works

1. User sends a Spotify URL or song name
2. Bot fetches track metadata from Spotify API (title, artist, album art)
3. Bot searches YouTube for matching audio using `yt-search`
4. Audio is downloaded via `ytdl-core` and converted to 192kbps MP3 using `ffmpeg`
5. MP3 is sent back to the user via Telegram
6. Download is logged to MongoDB
7. Temp file is deleted after sending

---

## 🛠️ Tech Stack

- **[node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)** — Telegram Bot SDK
- **[spotify-web-api-node](https://github.com/thelinmichael/spotify-web-api-node)** — Spotify metadata
- **[@distube/ytdl-core](https://github.com/distubejs/ytdl-core)** — YouTube audio download
- **[yt-search](https://github.com/talmobi/yt-search)** — YouTube search
- **[fluent-ffmpeg](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)** + **ffmpeg-static** — Audio conversion
- **[mongoose](https://mongoosejs.com/)** — MongoDB ODM
- **[express](https://expressjs.com/)** — HTTP server for Render

---

## 📝 Notes

- Songs are not stored permanently — temp files are deleted after sending
- The bot uses Spotify only for metadata (title, artist) — actual audio comes from YouTube
- Free Render plan may spin down after 15 min of inactivity; first request after that will be slow
- MongoDB Atlas free tier (M0) is sufficient for personal use
