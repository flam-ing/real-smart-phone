# Real Smart Phone

Each seat number opens its own Android phone in the cloud. An AI can operate the phone for you, now or on a schedule.

- **Seats.** Beta: enter the number you were given. Each number is a separate Android 12 phone (redroid) with its own storage. Apps and photos stay while the phone sleeps. Accounts come later.
- **Live control.** H.264 from the phone (scrcpy), JPEG frames to the browser with frame acknowledgements, touches streamed as they happen. Tap a text field and your own keyboard types into the phone, Korean included.
- **AI.** The AI looks at the screen and taps, swipes, types (Korean included) and opens apps until the task is done. A blue frame shows while it is in control. Stop it at any time.
- **Schedules.** Run a saved request every weekday at 09:00, every 30 minutes, or any cron time. Runs on the server with the browser closed.

## Run

Requirements: Linux host with binder support, Docker, `adb`, `ffmpeg`, Node 18+, `/usr/share/scrcpy/scrcpy-server` (v1.25).

```sh
npm install
cp deploy/real-smart-phone.env.example /etc/real-smart-phone.env   # fill in the Meta Model API key
node server.js
```

Deployment files are in `deploy/` (systemd unit, nginx location, Android image).

## AI provider

Configuration only. `AI_PROVIDER=meta` (default) uses Muse Spark on the Meta Model API (`MODEL_API_KEY`, `AI_MODEL=muse-spark-1.3`). `AI_PROVIDER=gemini` with `GEMINI_API_KEY`, or `AI_PROVIDER=openai-compatible` with `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`, also work.
