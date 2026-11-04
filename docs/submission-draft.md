# Real Smart Phone — hackathon submission draft

Track: Indie Developer · Theme: Build for Your World
Demo: https://mobile.ai-ing.org (closed beta, invite link) · Code: https://github.com/flam-ing/real-smart-phone

## One line

Your own Android phone in the cloud, and an AI built on Meta's models that uses it for you: it sees the screen, taps and types like a person, hands control back when it needs you, and keeps working on a schedule while your real phone is in your pocket.

## The problem

Most of what people do every day lives inside phone apps that have no API and no web version: messengers like KakaoTalk and WhatsApp, Instagram and Threads, delivery, maps. AI assistants can write and search, but they cannot press the buttons in those apps. Giving an AI your real phone is risky and drains it; leaving the work to you means doing the same taps every day.

## What it does

- Every tester gets a private Android 12 phone in the cloud (one container per invite), opened from any browser on iPhone, Android or a Mac and installable as an app. Apps and logins stay while it sleeps.
- Ask in plain language — "find today's weather in Seoul", "open Facebook and tell me the latest post" — and Muse Spark operates the phone step by step. A Meta-blue frame shows while the AI is in control; you can interrupt or redirect it mid-task.
- When the AI meets something only you should do — a sign-in, a password or code, a CAPTCHA, or confirming a send, post or payment — it stops and says "Your turn". You do it on the phone, tap Continue, and it carries on.
- "Every morning at 8, …" becomes a schedule that runs on the server with the browser closed, with a calendar and a day timeline of runs.
- The phone's notifications (KakaoTalk, WhatsApp, Instagram…) arrive on your real device as push notifications.
- The phone's Camera shows your real device's camera live, and the shutter puts the photo in the phone's gallery for any app to attach.

## How we use Meta AI

- **Muse Spark 1.3 (Meta Model API)** is the agent. Each step it gets one downscaled screenshot, the on-screen elements with their positions and a short log of what it already did, and answers with one action as JSON (tap, swipe, type, open app/URL, schedule, ask the user, done). Reasoning effort is set to low: a typical 4–6 step task costs about one cent.
- **SAM 3.1 (Meta Model API)** grounds what the accessibility tree cannot see. When Muse Spark wants to tap something unlabeled — an icon in a web view, a photo, a game button — it describes it in a few words ("blue Sign in button"), SAM 3.1 segments it on the full-resolution screen, and we tap the center of the best box. The viewer sees the box before the tap.
- **Meta open weights**: the Model tab can switch a phone to Llama 4 served by Fireworks, Together, Groq or other OpenAI-compatible hosts, or to other providers with the tester's own key. Muse Spark is included by default.

## How it is built

- One Oracle Cloud ARM server (4 cores). Each invite maps to a redroid Android 12 container with Google Play, its own /data and ADB port; phones boot on demand (about 12 s), sleep when idle, and up to three run at once.
- Live screen: scrcpy H.264 → MJPEG over WebSocket with frame acknowledgements, so a slow network gets the newest frame instead of a backlog (about 0.25 s from a tap to the changed frame on the server).
- Touch is streamed as it happens (down/move/up) through Android's monkey port; Korean and other text goes through an ADB keyboard.
- Node.js server without a framework: invite links signed as HS256 tokens, per-phone schedules (cron), Web Push (VAPID) for notifications, per-phone provider keys stored server-side only.

## Demo video (1:27)

[docs/demo.mp4](demo.mp4). Every scene is a real run on the beta, recorded from the web page.

1. The home screen, and the AI button at the bottom right.
2. "Open the browser, search for today's weather in Seoul and tell me the temperature. Also do this every morning at 8." Muse Spark searches, answers 11 °C, and adds a daily 08:00 schedule; the Schedules tab shows it as a list, a calendar and a day timeline.
3. "Open Google Maps, find a well-rated cafe near Gangnam Station, and tell me its name and rating." It applies the Top rated filter and answers HIGGS COFFEE, 4.9.
4. "Install Google Drive from the Play Store." SAM 3.1 finds the Install button (box shown before the tap) and the install starts.
5. The same phone in a desktop browser.

Narration is TTS (Qwen3-TTS) and the music was synthesized for the video. AI runs are sped up 3× to 23×, as marked on screen.

## Honest limits

- Apps that check for emulators (some banking and second-hand market apps) refuse to run.
- The camera works in our Camera page, not inside other apps' own cameras or video calls; there is no phone audio yet.
- Beta access is by invite link; accounts come later.
