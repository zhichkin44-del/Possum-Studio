# Possum Studio

A Telegram bot and Windows desktop app that help a pet owner turn phone footage of a pet into short vertical videos (YouTube Shorts, TikTok, Instagram Reels) with ready-to-paste captions. For people filming a pet at home who want a simple, repeatable routine.

Interface language: Russian. The bot texts and the desktop app are in Russian; this README and the code documentation are in English.

Nothing is published automatically. The app prepares videos and text; the person uploads them.

Status: tests are green (see [Tests](#tests)). The first live run with a real Telegram account and real footage is still pending.

## Features

- Daily shooting task sent by the Telegram bot, with a weekly summary.
- Video intake from Telegram; the bot keeps a log of tasks and uploads.
- Automatic montage with FFmpeg: 9:16 at 1080×1920, up to 18 s, loudness −14 LUFS, cover image, and a check sheet of frames.
- Captions, hashtags and first comments for YouTube (RU and EN), TikTok and Instagram Reels.
- Desktop app (Windows): inbox, render queue, manual publishing buttons, and encrypted storage of API keys (Windows DPAPI).
- Optional AI-written texts and frame recognition via your own API key (Anthropic or OpenRouter). Without a key, template texts are used.

## Requirements

- Node.js 20 or newer.
- FFmpeg and ffprobe on `PATH`, or set the `FFMPEG` and `FFPROBE` variables. On Windows: `winget install Gyan.FFmpeg`.
- A Telegram account and a bot token from @BotFather (see [docs/BOTFATHER.md](docs/BOTFATHER.md)).
- Optional: an Anthropic or OpenRouter API key for AI texts. Without it the app works with templates.
- Operating systems: Windows 10/11 (full support, including the desktop app), Linux and macOS (bot and tests).

## Installation

### Windows (PowerShell)

```powershell
git clone https://github.com/zhichkin44-del/Possum-Studio.git
cd Possum-Studio
npm ci
npm run set-token
npm start
```

### Linux and macOS

```bash
git clone https://github.com/zhichkin44-del/Possum-Studio.git
cd Possum-Studio
npm ci
npm run set-token
npm start
```

`npm run set-token` asks for the bot token with hidden input and saves it to `data/.token`. The token is never printed. To check it with Telegram, run `npm run set-token -- --verify`.

To run the desktop app on Windows, use `npm run app`. To build the Windows installer, use `npm run dist`.

## Configuration

Copy `.env.example` for reference. The app does not read `.env` automatically; set variables in your shell or let the defaults apply.

| Variable | Required | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | No | Bot token. Alternative to `npm run set-token`. |
| `POSSUM_DATA_DIR` | No | Data folder. Default: `data/`. |
| `FFMPEG`, `FFPROBE` | No | Paths to ffmpeg and ffprobe if they are not on `PATH`. |
| `POSSUM_TZ` | No | Time zone offset in hours, for example `7`. Default: the system time zone. |
| `POSSUM_FONT` | No | Path to a caption font file. |
| `POSSUM_CLIP_MODEL` | No | Path to the local CLIP model file used for recognising the pet. |
| `POSSUM_STATS_API` | No | Stats endpoint. Not connected by default. |

Where to get keys:

- Telegram bot token: create a bot with @BotFather in Telegram (`/newbot`).
- AI key (optional): an Anthropic key from the Anthropic console (API Keys), or an OpenRouter key from openrouter.ai. Enter it in the desktop app settings, not in files.

Other settings, such as the pet's name and task times, go in `data/config.json` (optional).

## Usage

1. Run `npm start`. The console prints an invite link for the owner and one for the person filming. Each link opens the bot in Telegram; press Start.
2. The bot sends a daily shooting task at 19:30 (configurable). Film it, then send the video to the bot.
3. The bot builds a short video, a caption and a cover, and sends them back. Publish manually on the platform of your choice.
4. Every week the bot sends a summary of uploads and tasks.

Other scenarios:

- Desktop app (Windows): `npm run app`. Drop a batch of videos into the inbox; the app proposes short clips and renders them into the queue.
- Demo with sample footage: `npm run demo`.

## Tests

```bash
npm test
```

Tests need no internet: the Telegram API is faked, and the montage tests use a real ffmpeg when it is available. Last run on a fresh `npm ci` clone, 2026-11-21: 500 tests, 493 passed, 0 failed, 7 skipped.

## Project structure

- `src/` — Telegram bot: tasks, video intake, posts, weekly summary, poller, store.
- `core/` — shared engine for the bot and the desktop app: montage, texts, AI client, settings with encryption, publishing adapters.
- `app/` — Electron desktop app (Windows), including the Russian UI in `app/ui/`.
- `assets/` — fonts and sound effects with their licences.
- `scripts/` — token entry (`set-token`), demo, sample post, icon and model fetch.
- `test/` — automated tests (`node --test`).
- `docs/` — architecture, plans, bot text samples and layouts (in Russian).
- `craft/` — notes on fonts, sounds and montage rules.

## License

MIT. See [LICENSE](LICENSE).
