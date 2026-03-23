require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const SpotifyWebApi = require("spotify-web-api-node");
const ytdl = require("@distube/ytdl-core");
const ytSearch = require("yt-search");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const fs = require("fs");
const path = require("path");
const connectDB = require("./db");
const Download = require("./models/Download");
const User = require("./models/User");

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

// Connect to MongoDB
connectDB();

// Init Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Init Spotify API
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// ─── Premium Custom Emoji IDs ──────────────────────────────────────────────
// Usage in MarkdownV2: \u{custom_emoji id="..."}  but Telegram uses special
// entity type "custom_emoji" — we send them via entities array in sendMessage.
// Helper below wraps text with a random premium emoji entity prepended.
const PREMIUM_EMOJI_IDS = [
  "5210956306952758910",
  "5461117441612462242",
  "5456140674028019486",
  "5224607267797606837",
  "5229064374403998351",
  "5260293700088511294",
  "5240241223632954241",
  "5274099962655816924",
  "5440660757194744323",
  "5314504236132747481",
  "5436113877181941026",
  "5447644880824181073",
  "5420323339723881652",
  "5447410659077661506",
  "5443038326535759644",
  "5467538555158943525",
  "5452069934089641166",
  "5231200819986047254",
  "5449683594425410231",
  "5447183459602669338",
  "5451882707875276247",
  "5244837092042750681",
  "5246762912428603768",
  "5206607081334906820",
];

// Placeholder char used in text for each custom emoji (Telegram requires a
// visible char at the entity offset — we use the star ★ as a neutral stand-in)
const EMOJI_PLACEHOLDER = "✦";

/** Pick a random premium emoji ID */
function randEmojiId() {
  return PREMIUM_EMOJI_IDS[Math.floor(Math.random() * PREMIUM_EMOJI_IDS.length)];
}

/**
 * Build a custom_emoji entity object.
 * @param {number} offset  character offset in the text string
 * @param {string} emojiId premium emoji ID
 */
function emojiEntity(offset, emojiId) {
  return { type: "custom_emoji", offset, length: 1, custom_emoji_id: emojiId };
}

/**
 * Send a message that uses premium emojis via entities.
 * `emojiSlots` is an array of character indices in `text` where EMOJI_PLACEHOLDER
 * appears — each one gets a random premium emoji entity assigned.
 */
async function sendPremium(chatId, text, emojiSlots, extra = {}) {
  const entities = emojiSlots.map((offset) => emojiEntity(offset, randEmojiId()));
  return bot.sendMessage(chatId, text, {
    parse_mode: "HTML",
    entities,
    ...extra,
  });
}

/**
 * Edit a message that uses premium emojis.
 */
async function editPremium(chatId, messageId, text, emojiSlots) {
  const entities = emojiSlots.map((offset) => emojiEntity(offset, randEmojiId()));
  return bot.editMessageText(text, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: "HTML",
    entities,
  });
}

// Refresh Spotify token
async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body["access_token"]);
    setTimeout(refreshSpotifyToken, (data.body["expires_in"] - 60) * 1000);
    console.log("✅ Spotify token refreshed");
  } catch (err) {
    console.error("❌ Spotify token error:", err.message);
    setTimeout(refreshSpotifyToken, 30000);
  }
}
refreshSpotifyToken();

// Ensure temp dir exists
const TEMP_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Helper: clean filename
function sanitizeFilename(name) {
  return name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").substring(0, 80);
}

// Helper: format duration ms → m:ss
function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// Helper: search YouTube and return best audio URL
async function getYouTubeAudioUrl(query) {
  const results = await ytSearch(query);
  if (!results.videos.length) throw new Error("No YouTube results found");
  const video = results.videos[0];
  return { url: video.url, title: video.title };
}

// Helper: download YouTube audio → MP3 via ffmpeg
function downloadAudioAsMP3(youtubeUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const stream = ytdl(youtubeUrl, { quality: "highestaudio", filter: "audioonly" });
    ffmpeg(stream)
      .audioBitrate(192)
      .toFormat("mp3")
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .save(outputPath);
  });
}

// Upsert user in DB
async function upsertUser(telegramUser) {
  try {
    await User.findOneAndUpdate(
      { telegramId: telegramUser.id },
      {
        telegramId: telegramUser.id,
        username: telegramUser.username || "",
        firstName: telegramUser.first_name || "",
        lastName: telegramUser.last_name || "",
        lastSeen: new Date(),
      },
      { upsert: true, new: true }
    );
  } catch (e) {
    console.error("User upsert error:", e.message);
  }
}

// Log download to DB
async function logDownload(telegramId, trackName, artist, youtubeUrl, success) {
  try {
    await Download.create({ telegramId, trackName, artist, youtubeUrl, success, downloadedAt: new Date() });
  } catch (e) {
    console.error("Log download error:", e.message);
  }
}

// ─── /start ────────────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  await upsertUser(msg.from);
  const firstName = msg.from.first_name || "there";

  // ✦ marks where a premium emoji entity will be injected (offset calculated below)
  // We build the text first, then find offsets of each ✦
  const lines = [
    `✦ <b>Welcome, ${firstName}!</b>`,
    ``,
    `✦ I can download any Spotify song as MP3!`,
    ``,
    `<b>✦ How to use:</b>`,
    `  • Paste a Spotify track link`,
    `  • Or just type a song name`,
    ``,
    `<b>✦ Commands:</b>`,
    `  /search <code>song name</code> — Search &amp; download`,
    `  /stats — Your download history`,
    `  /help — Show help`,
    ``,
    `✦ <i>Example:</i>`,
    `<code>https://open.spotify.com/track/...</code>`,
    `or type: <code>Shape of You Ed Sheeran</code>`,
  ];
  const text = lines.join("\n");
  const slots = findEmojiSlots(text);
  await sendPremium(msg.chat.id, text, slots);
});

// ─── /help ─────────────────────────────────────────────────────────────────
bot.onText(/\/help/, async (msg) => {
  const lines = [
    `✦ <b>Help Guide</b>`,
    ``,
    `✦ <b>Download by Spotify link:</b>`,
    `Paste any Spotify track URL directly.`,
    ``,
    `✦ <b>Download by song name:</b>`,
    `Just type the song + artist, e.g:`,
    `<code>Blinding Lights The Weeknd</code>`,
    ``,
    `✦ <b>Search command:</b>`,
    `/search Bohemian Rhapsody Queen`,
    ``,
    `✦ <b>Supported formats:</b>`,
    `• <code>open.spotify.com/track/...</code>`,
    ``,
    `✦ <b>Notes:</b>`,
    `• MP3 files are 192kbps quality`,
    `• Large files may take ~30 seconds`,
    `• Audio is sourced from YouTube`,
  ];
  const text = lines.join("\n");
  const slots = findEmojiSlots(text);
  await sendPremium(msg.chat.id, text, slots);
});

// ─── /stats ────────────────────────────────────────────────────────────────
bot.onText(/\/stats/, async (msg) => {
  await upsertUser(msg.from);
  try {
    const total = await Download.countDocuments({ telegramId: msg.from.id });
    const successful = await Download.countDocuments({ telegramId: msg.from.id, success: true });
    const recent = await Download.find({ telegramId: msg.from.id }).sort({ downloadedAt: -1 }).limit(5);
    const recentList = recent.length
      ? recent.map((d, i) => `  ${i + 1}. ${escHtml(d.trackName)} — ${escHtml(d.artist)}`).join("\n")
      : "  No downloads yet";

    const lines = [
      `✦ <b>Your Download Stats</b>`,
      ``,
      `✦ Total downloads: <b>${total}</b>`,
      `✦ Successful: <b>${successful}</b>`,
      `✦ Failed: <b>${total - successful}</b>`,
      ``,
      `✦ <b>Recent downloads:</b>`,
      recentList,
    ];
    const text = lines.join("\n");
    const slots = findEmojiSlots(text);
    await sendPremium(msg.chat.id, text, slots);
  } catch (e) {
    bot.sendMessage(msg.chat.id, "❌ Could not fetch stats.");
  }
});

// ─── /search ───────────────────────────────────────────────────────────────
bot.onText(/\/search (.+)/, async (msg, match) => {
  await upsertUser(msg.from);
  await handleSongDownload(msg, match[1].trim());
});

// ─── Main message handler ──────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  await upsertUser(msg.from);
  const text = msg.text.trim();
  const spotifyRegex = /https?:\/\/(open\.spotify\.com\/track\/|spotify\.link\/)([a-zA-Z0-9]+)/;
  if (text.match(spotifyRegex)) {
    await handleSpotifyUrl(msg, text);
  } else {
    await handleSongDownload(msg, text);
  }
});

// ─── Handle Spotify URL ────────────────────────────────────────────────────
async function handleSpotifyUrl(msg, url) {
  const chatId = msg.chat.id;
  let statusMsg;
  try {
    const t1 = `✦ Fetching track info from Spotify...`;
    statusMsg = await sendPremium(chatId, t1, findEmojiSlots(t1));

    const openMatch = url.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
    if (!openMatch) throw new Error("Please use a full Spotify track URL (open.spotify.com/track/...)");
    const trackId = openMatch[1].split("?")[0];

    const trackData = await spotifyApi.getTrack(trackId);
    const track = trackData.body;
    const trackName = track.name;
    const artists = track.artists.map((a) => a.name).join(", ");
    const album = track.album.name;
    const duration = formatDuration(track.duration_ms);
    const albumArt = track.album.images[0]?.url;

    const t2 = `✦ Found: <b>${escHtml(trackName)}</b>\n✦ ${escHtml(artists)}\n✦ ${escHtml(album)} · ${duration}\n\n✦ Searching YouTube audio...`;
    await editPremium(chatId, statusMsg.message_id, t2, findEmojiSlots(t2));

    await downloadAndSend(msg, `${trackName} ${artists}`, trackName, artists, albumArt, statusMsg);
  } catch (err) {
    console.error("Spotify URL error:", err.message);
    const errText = `❌ Error: ${escHtml(err.message)}`;
    if (statusMsg) bot.editMessageText(errText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
    else bot.sendMessage(chatId, errText, { parse_mode: "HTML" });
  }
}

// ─── Handle plain song search ──────────────────────────────────────────────
async function handleSongDownload(msg, query) {
  const chatId = msg.chat.id;
  let statusMsg;
  try {
    const t1 = `✦ Searching Spotify for: <b>${escHtml(query)}</b>...`;
    statusMsg = await sendPremium(chatId, t1, findEmojiSlots(t1));

    const results = await spotifyApi.searchTracks(query, { limit: 1 });
    const tracks = results.body.tracks?.items;
    if (!tracks || tracks.length === 0) {
      const t = `❌ No Spotify results found for: "${escHtml(query)}"\n\nTry a different search term.`;
      await bot.editMessageText(t, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
      return;
    }

    const track = tracks[0];
    const trackName = track.name;
    const artists = track.artists.map((a) => a.name).join(", ");
    const album = track.album.name;
    const duration = formatDuration(track.duration_ms);
    const albumArt = track.album.images[0]?.url;

    const t2 = `✦ Found: <b>${escHtml(trackName)}</b>\n✦ ${escHtml(artists)}\n✦ ${escHtml(album)} · ${duration}\n\n✦ Downloading audio...`;
    await editPremium(chatId, statusMsg.message_id, t2, findEmojiSlots(t2));

    await downloadAndSend(msg, `${trackName} ${artists}`, trackName, artists, albumArt, statusMsg);
  } catch (err) {
    console.error("Search error:", err.message);
    const errText = `❌ Error: ${escHtml(err.message)}`;
    if (statusMsg) bot.editMessageText(errText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" });
    else bot.sendMessage(chatId, errText, { parse_mode: "HTML" });
  }
}

// ─── Core download + send ──────────────────────────────────────────────────
async function downloadAndSend(msg, ytQuery, trackName, artist, albumArtUrl, statusMsg) {
  const chatId = msg.chat.id;
  const safeFilename = sanitizeFilename(`${trackName}_${artist}`);
  const outputPath = path.join(TEMP_DIR, `${safeFilename}_${Date.now()}.mp3`);

  try {
    const t1 = `✦ Searching YouTube for audio...\n✦ ${escHtml(trackName)} — ${escHtml(artist)}`;
    await editPremium(chatId, statusMsg.message_id, t1, findEmojiSlots(t1));

    const { url: ytUrl } = await getYouTubeAudioUrl(ytQuery);

    const t2 = `✦ Downloading &amp; converting to MP3...\n✦ ${escHtml(trackName)} — ${escHtml(artist)}\n\n<i>This may take 10–30 seconds...</i>`;
    await editPremium(chatId, statusMsg.message_id, t2, findEmojiSlots(t2));

    await downloadAudioAsMP3(ytUrl, outputPath);

    const t3 = `✦ Uploading to Telegram...\n✦ ${escHtml(trackName)} — ${escHtml(artist)}`;
    await editPremium(chatId, statusMsg.message_id, t3, findEmojiSlots(t3));

    const caption = `✦ <b>${escHtml(trackName)}</b>\n✦ ${escHtml(artist)}\n\n<i>Downloaded via Spotify Music Bot</i>`;
    await bot.sendAudio(
      chatId,
      fs.createReadStream(outputPath),
      { title: trackName, performer: artist, caption, parse_mode: "HTML" },
      { filename: `${safeFilename}.mp3`, contentType: "audio/mpeg" }
    );

    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    await logDownload(msg.from.id, trackName, artist, ytUrl, true);
  } catch (err) {
    console.error("Download/send error:", err.message);
    await logDownload(msg.from.id, trackName, artist, "", false);
    const errText = `❌ Failed to download: <b>${escHtml(trackName)}</b>\n\nError: ${escHtml(err.message)}\n\nPlease try again.`;
    bot.editMessageText(errText, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "HTML" }).catch(() => {
      bot.sendMessage(chatId, `❌ Failed to download "${trackName}". Please try again.`);
    });
  } finally {
    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
  }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/** Escape HTML special chars for HTML parse_mode */
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Find all byte offsets of ✦ in the string.
 * Telegram entity offsets are UTF-16 code unit positions.
 */
function findEmojiSlots(text) {
  const slots = [];
  // Iterate as UTF-16 to get correct entity offsets
  let utf16Offset = 0;
  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (char === EMOJI_PLACEHOLDER) {
      slots.push(utf16Offset);
    }
    const code = text.codePointAt(i);
    const step = code > 0xffff ? 2 : 1;
    utf16Offset += step;
    i += step;
  }
  return slots;
}

// ─── Polling error handler ─────────────────────────────────────────────────
bot.on("polling_error", (err) => {
  console.error("Polling error:", err.message);
});

console.log("🤖 Telegram Spotify Bot is running...");
