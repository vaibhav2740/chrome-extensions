# Krillion Bot

An AI sidekick for **Krillion Puffer Party** (krillion.io). It reads the current category, lines up a pool of answers with **Groq** and **Gemini**, tracks what other players have already said, and — if you turn on auto-write — types and submits your answer the moment you hold the puffer, retrying automatically if the game rejects one.

## Install
1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick this folder.
3. Open a Puffer Party game; a small glass widget appears (drag it anywhere). Click the toolbar icon for settings.

## API keys
Keys are never stored in this repo. Either paste them in the popup (**API keys & models**), or copy `keys.example.js` to `keys.local.js` (gitignored) and fill them in.
- Gemini: https://aistudio.google.com/apikey
- Groq: https://console.groq.com/keys (free tier is about 1,000 requests/day on the default model)

## How it behaves
- **Auto** provider picks the fastest healthy one (usually Groq) and falls back to the other on a rate limit; you can also pin one.
- Rate limits are respected: cooldowns per provider, a per-category cache, and a cap on refills per minute.
- It only acts when the answer box says it's your turn, never touches the chat box, and only runs on krillion.io, regqube.com and localhost.
- Only the category text and already-used answers are sent to the AI providers.

## Widget style
**Glass** blurs the game behind the widget; **Basic** is a solid panel that is lighter on weak devices (the blur is recomputed while the game animates). **Auto** (default) picks Basic for "reduce transparency" users and very low-end devices. Set it in the popup under *Widget style*.

## Diagnostics
The gear button in the widget copies a diagnostics report (detected category, chips, recent events) to the clipboard — handy for bug reports.

Shortcut: **Alt+Shift+P** plays your turn now.
