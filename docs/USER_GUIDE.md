# Cosmoscope user guide

*Available in-app in 9 languages: English, 中文, Português, Español, 한국어, Français, Deutsch, 日本語, Русский — pick yours on the welcome screen or in the top bar.*

## First contact

When Cosmoscope opens you'll see the welcome card. Choose **Begin with sound** for the full experience (a procedural deep-space soundscape — nothing is streamed, everything is synthesized live in your browser) or **Begin quietly**. The camera then glides from a wide view of the Solar System down to Earth — *where it actually is on today's date*.

## Moving around

| Gesture | Effect |
|---|---|
| Drag (mouse or finger) | Orbit around the selected world |
| Scroll wheel / pinch | Zoom in and out |
| Click a planet or its label | Select it and fly there |
| Drag with inertia | Flick the camera and let it glide |

Three camera modes live in the bottom bar:

- **🛰 Orbit** — locked to the selected body. This is where you'll spend most time.
- **🚀 Free** — a spaceship: `W A S D` to translate, `Q E` for down/up, drag to look, `Shift` to boost. Speed auto-scales with altitude, so you can cruise between planets or skim a cloud deck.
- **🎥 Tour** — the Grand Tour. Sit back: the camera flies Sun → Mercury → … → Neptune with a localized fact card at each stop. Any drag hands control back to you.

## Time travel

The top bar owns time itself:

- **⏸ / ▶** pauses and resumes the simulation.
- The **slider** scales time from real-time up to **1 year per second** — watch Mercury whip around while Neptune barely creeps.
- **Now** snaps back to the present moment.
- The date readout is always the *simulated* UTC time driving the planet positions.

Try it: select the Moon, set *1 day/s*, and watch the phases and — with patience and luck — a solar eclipse sweep across Earth. The shadow is not an effect; it is computed by shadow rays every frame.

## The panels (left rail)

- **🪐 Explore** — the body grid. Each world's card shows localized facts (radius, orbital period, rotation, live distances) plus **Fly there** and **♪ Sonify**, which converts orbital data into a short melody: deep and slow for Neptune, bright and hurried for Mercury.
- **🖼 Picture of the Day** — NASA's APOD. Pick any date back to June 1995, or roll the 🎲.
- **☄️ Asteroids** — this week's real near-Earth objects from NeoWs, sorted by miss distance, with hazard badges. Tick **Visualize flybys** to see them as points around Earth (schematic positions, true miss-distance ordering).
- **🤖 Mars Rovers** — Curiosity and Perseverance imagery. (NASA retired the dedicated rover-photos API, so these stream from the NASA Image Library — the app tells you so.)
- **🌍 Earth from Space** — today's full-disc Earth photographs from the DSCOVR satellite at the L1 point, 1.5 million km away.
- **☀️ Space Weather** — solar flares (30 days) and coronal mass ejections (7 days) from DONKI. **If the Sun has produced strong recent flares, the rendered Sun in the scene visibly seethes with extra energy.**
- **🔭 NASA Media Library** — search 140,000+ images, or flip to **Sounds** for NASA sonifications and mission audio, playable in place.
- **🎬 Capture & Export** — see below.
- **⚙️ Settings** — see below.

## Capturing your view

### Stills
Pick a resolution — your screen, Full HD, QHD, **4K**, or **8K** — a format (PNG lossless, JPEG, WebP) and press **📸 Capture still**. High resolutions are ray-traced *tile by tile* at full quality: an 8K frame is 33 megapixels of genuine rendering, not an upscale. Files download immediately and stack in a list for re-download.

*Note: 8K needs a desktop-class GPU; phones (especially iPhones) may cap out — the app will tell you rather than fail silently.*

### Video
Press **⏺ Start recording**, fly around, press **⏹ Stop** — the file downloads instantly. Cosmoscope prefers **MP4 (H.264)** wherever the browser can mux it (Chrome/Edge 126+, Safari) and falls back to **WebM** (Firefox and others) — both open in VLC and every modern player. Choose 30/60 fps and a bitrate tier (8/16/35 Mb/s). If sound is on, the soundscape is recorded into the video.

## Settings that matter

- **Quality preset** — Low / Medium / High / Ultra change ray-tracing depth (noise octaves, soft shadows, belt dust, bloom) and render scale. Ultra super-samples at 1.5×; Low runs on integrated graphics.
- **Render scale** — fine-grained resolution control (0.5×–2×).
- **Scale model** — **Showcase** compresses distances so all worlds are visible together (still real angular positions); **True scale** uses honest proportions. Try it once — the emptiness is the lesson.
- **Labels / Orbit paths** — declutter toggles (also `L` and `P`).
- **Audio** — separate master / music / interface volumes.
- **NASA API** — paste your free api.nasa.gov key here (stored only in your browser) to lift the shared DEMO_KEY rate limit.

## Accessibility

- Every action is reachable by keyboard (see `H` for the shortcut list); panels are semantic DOM with ARIA labels, not canvas paint.
- The app honors `prefers-reduced-motion`: camera flights become cuts and film grain is disabled.
- Text sits on scrims to preserve contrast over the star field; touch targets are ≥ 40 px.

## Troubleshooting

| Symptom | Explanation / fix |
|---|---|
| “rate limit reached” toast | The shared DEMO_KEY quota is exhausted — add your own free key in Settings, or just wait an hour. Panels keep working with cached/sample data. |
| Images show a 🛰 placeholder | The image host is unreachable (offline, blocked network). Data text still shows. |
| Black screen at start | Cosmoscope needs WebGL2. Update your browser/GPU drivers; virtually every browser since 2017 qualifies. |
| 8K export fails | Your device's canvas limit is below 33 MP (common on phones). Use 4K. |
| Recording button disabled | The browser lacks MediaRecorder (very old browsers). |
