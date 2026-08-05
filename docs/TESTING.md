# Testing & governance

## Test pyramid

### 1. Unit tests — `node --test tests/unit/*.test.mjs`

No dependencies; pure-module imports.

- **`orbits.test.mjs`** — the ephemeris is treated as a scientific artifact:
  - Kepler solver residuals < 1e-8 across eccentricities.
  - Standish Table 1 spot-checked against the values published by JPL SSD.
  - 60-year sweep keeps every planet inside its true perihelion/aphelion bounds.
  - Earth ≈ 0.9833 au in early January (perihelion); Moon stays within 356–407 Mm.
  - Scene invariants for both scale modes (body count, finite positions, ring radii ordering, true-scale proportion check against the real au/Earth-radius ratio).
- **`i18n.test.mjs`** — every one of the 9 languages must carry *exactly* the English key set, no empty strings, and identical `{placeholder}` sets — a translation can't silently drift.

### 2. Build verification — `node scripts/build-artifact.mjs`

The bundler is also a linter: it fails on unsupported import/export forms, duplicate top-level identifiers across modules, leftover references to external files, or a `</script` sequence that would break inline embedding.

### 3. End-to-end smoke — `node tests/e2e/smoke.mjs`

Headless Chromium (Playwright) drives the real user journey against a local static server:

1. Welcome overlay → enter quietly.
2. **Render sanity:** the WebGL canvas is sampled pixel-by-pixel and must be >2 % lit with bright highlights — a black canvas fails the build.
3. HUD state (simulated date, selected body).
4. **Language switch** to Portuguese re-localizes live DOM.
5. Keyboard selection (`6` → Saturn).
6. **NASA panels** including the full offline-fallback path (the CI sandbox has no NASA connectivity — by design this exercises the embedded-sample degradation).
7. **Still export:** a real 1080p PNG download is intercepted and size-checked.
8. **Video recording:** ~2.5 s capture, download size-checked (MP4 in Chromium).
9. Quality preset changes and true-scale mode swap under an error listener.
10. Zero unexpected page errors overall (network failures are expected offline noise).

`SHOTS=1` additionally captures the README screenshots (Saturn hero, Earth + explore panel, capture panel, the Sun, mobile layout) — so the documentation imagery is *always reproducible from the current code*.

## Continuous integration

[`ci.yml`](../.github/workflows/ci.yml) runs all three layers on every push and pull request and uploads the built single-file bundles as a workflow artifact. [`deploy-pages.yml`](../.github/workflows/deploy-pages.yml) deploys `main` to GitHub Pages (one-time setup: Settings → Pages → Source: *GitHub Actions*).

## Governance

- **No runtime dependencies** — the dependency surface is the browser platform itself; the only dev dependency is Playwright.
- **Data honesty** — every number shown (positions, periods, distances) traces to JPL/NSSDC sources documented in [NASA_APIS.md](NASA_APIS.md); schematic visualizations (NEO flybys) are labeled as such in the UI.
- **Graceful degradation as policy** — every network call has a timeout, a cache, a rate-limit path and an embedded sample fallback; every remote image has a styled placeholder.
- **Accessibility as review criterion** — keyboard parity, ARIA labeling, focus management, reduced-motion support are tested manually per release.
- **Update cadence** — NASA endpoints drift (two of them died and one broke during this project's own research). The client isolates every endpoint in `js/nasa.js` with per-source fallbacks so failures stay contained and swappable.
