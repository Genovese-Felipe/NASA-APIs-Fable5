# NASA API integrations

Cosmoscope draws on **eight NASA data sources**. Every integration was verified against the live services (August 2026), and each one carries an embedded sample fallback so the app degrades gracefully offline, under rate limiting, or inside a sandboxed host.

| # | Source | Endpoint | Key? | Used for |
|---|---|---|---|---|
| 1 | **APOD** — Astronomy Picture of the Day | `api.nasa.gov/planetary/apod` | yes | 🖼 Picture of the Day tab (any date since 1995-06-16, 🎲 random) |
| 2 | **NeoWs** — Near Earth Object Web Service | `api.nasa.gov/neo/rest/v1/feed` | yes | ☄️ This week's asteroid flybys + in-scene schematic visualization |
| 3 | **EPIC** — Earth Polychromatic Imaging Camera | `epic.gsfc.nasa.gov/api/natural` | no | 🌍 Full-disc Earth photos from DSCOVR at L1 |
| 4 | **DONKI** — Space Weather Database | `kauai.ccmc.gsfc.nasa.gov/DONKI/WS/get/{FLR,CME}` | no | ☀️ Flares & CMEs; recent M/X activity *energizes the rendered Sun* |
| 5 | **Image & Video Library** | `images-api.nasa.gov/search` | no | 🔭 140k+ image search with lightbox |
| 6 | **Mars rover imagery** | via Image Library queries | no | 🤖 Curiosity / Perseverance galleries |
| 7 | **NASA sonifications & mission audio** | `images-api.nasa.gov` (`media_type=audio`) | no | 🔊 Playable space audio in the Library tab |
| 8 | **JPL SSD ephemeris data** | Standish Table 1 (embedded) | — | 🕰 The positions of everything you see |

## Verified behaviors the code depends on

These findings came from empirical testing (curl with CORS `Origin` headers, live calls), not just documentation:

- **EPIC:** the documented `api.nasa.gov/EPIC/api/natural/images` proxy 302-redirects to a malformed URL that lands on a 404 page. Cosmoscope calls `epic.gsfc.nasa.gov/api/natural` directly — keyless, `Access-Control-Allow-Origin: *`. Archive image URLs are built as `archive/natural/{YYYY}/{MM}/{DD}/jpg/{image}.jpg`, where the date comes from splitting the JSON `date` field (which uses a **space**, not ISO `T`).
- **DONKI:** the api.nasa.gov proxy returned HTTP 503 on every attempt across several date ranges. The CCMC origin (`kauai.ccmc.gsfc.nasa.gov`) works keyless with CORS `*`; Cosmoscope tries it first and falls back to the proxy. Timestamps arrive as `2026-07-01T06:19Z` (no seconds) — the client inserts `:00` before parsing.
- **Mars Rover Photos API is dead:** every endpoint (both rovers, `latest_photos`, `photos?sol=N`, and the origin `mars-photos.herokuapp.com` itself) returns a Heroku “No such app” 404 — the backend was decommissioned. The Mars tab therefore streams mission imagery from the Image & Video Library, with an in-app note explaining the substitution.
- **NeoWs:** ranges over 7 days are rejected (HTTP 400); all velocity/distance values are **strings** and are `parseFloat`ed before use; `near_earth_objects` is an object keyed by date, not an array.
- **APOD:** on video days `hdurl` is absent and `url` is an embed link — the client guards for this and links out with a thumbnail (`thumbs=true`). Requesting a future date returns 400.
- **Image Library:** thumbnails come from `links.find(rel === 'preview')`; audio items require a second fetch of the item's `collection.json`, whose asset URLs are listed as `http://` and are rewritten to `https://` to avoid mixed-content blocking.
- **Exoplanet Archive (deliberately excluded):** its TAP service returns **no CORS headers at all**, so a static GitHub Pages site cannot query it from the browser. Rather than ship a proxy dependency, Cosmoscope leaves it out and documents why here.

## Rate limiting & caching

`DEMO_KEY` is shared per IP (documented ≈30 req/h; observed as low as 10 req/h). Cosmoscope:

- caches every response in `localStorage` with per-source TTLs (APOD 24 h, NeoWs/EPIC/Library 30 min, DONKI 15 min);
- prefers the keyless hosts (4 of the 8 sources never touch the quota);
- detects HTTP 429 and shows a localized hint pointing at **Settings → NASA API**, where users can paste their own free key from [api.nasa.gov](https://api.nasa.gov) (stored in the browser only);
- falls back to embedded sample data with a visible 📡 badge whenever the network fails, so every panel always has something meaningful to show.

## Attribution

All data and imagery are courtesy of NASA and are generally in the public domain; NASA does not endorse this application. Sources are named in each panel and in the [README](../README.md#-credits--license).
