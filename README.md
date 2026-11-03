# Real Smart Phone

Each seat number opens its own Android phone in the cloud. An AI can operate the phone for you, now or on a schedule.

- **Closed beta.** An invite link opens your phone directly. Each invite names a separate Android 12 phone (redroid) with its own storage; apps and photos stay while it sleeps. Accounts come later.
- **Live control.** H.264 from the phone (scrcpy), JPEG frames to the browser with frame acknowledgements, touches streamed as they happen. Type on a computer keyboard straight into the phone (Korean included), or use the phone's own keyboard.
- **AI.** Muse Spark looks at the screen and taps, swipes, types (Korean included) and opens apps until the task is done. When an element has no accessibility label (web views, images, games), SAM 3.1 finds it from a short description and the box is shown before the tap. A blue frame shows while the AI is in control; stop it at any time.
- **Hand-over.** For sign-ins, codes, CAPTCHAs, or confirming a send, post or payment, the AI stops and asks you to take over, then continues when you tap Continue. Scheduled runs ask through a push notification.
- **Schedules from chat.** "Every morning at 9…" or "every 10 minutes…" in the AI chat becomes a schedule.
- **Notifications.** Turn on the bell in the AI sheet and the phone's Android notifications (KakaoTalk, WhatsApp, Instagram…) arrive as push notifications, also on iPhone when added to the home screen.
- **Schedules.** Run a saved request every weekday at 09:00, every 30 minutes, or any cron time. Runs on the server with the browser closed.

## Run

Requirements: Linux host with binder support, Docker, `adb`, `ffmpeg`, Node 18+, `/usr/share/scrcpy/scrcpy-server` (v1.25).

```sh
npm install
cp deploy/real-smart-phone.env.example /etc/real-smart-phone.env   # fill in the Meta Model API key
node server.js
```

Invite a tester to phone 3: `APP_DATA=/var/lib/real-smart-phone node invites.js 3 "Name"` prints the link.

Deployment files are in `deploy/` (systemd unit, nginx location, Android image, home screen layout).

## AI provider

Configuration only. `AI_PROVIDER=meta` (default) uses Muse Spark on the Meta Model API (`MODEL_API_KEY`, `AI_MODEL=muse-spark-1.3`). `AI_PROVIDER=gemini` with `GEMINI_API_KEY`, or `AI_PROVIDER=openai-compatible` with `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL`, also work.
