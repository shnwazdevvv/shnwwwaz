const mongoose = require("mongoose");

const downloadSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    index: true,
  },
  trackName: {
    type: String,
    required: true,
  },
  artist: {
    type: String,
    default: "",
  },
  youtubeUrl: {
    type: String,
    default: "",
  },
  success: {
    type: Boolean,
    default: true,
  },
  downloadedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model("Download", downloadSchema);
