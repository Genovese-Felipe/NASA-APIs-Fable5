# Contributing to Cosmoscope

Thanks for your interest! Cosmoscope is intentionally small and dependency-free — please keep it that way.

## Ground rules

1. **No runtime dependencies.** The browser platform (WebGL2, Web Audio, MediaRecorder, Intl, Fetch) is the framework. If a feature seems to need a library, open an issue first.
2. **No build step for development.** `python3 -m http.server` + edit + refresh must always work. The single-file bundler (`scripts/build-artifact.mjs`) is an output packager, not a compiler — it strips `import`/`export` lines textually, so keep imports single-line and top-level names unique across modules (the bundler enforces both).
3. **Every string through i18n.** UI text lives in `js/i18n.js`, in *all nine* languages. `node --test tests/unit/i18n.test.mjs` fails on missing keys, empty values, or placeholder drift. If you can't translate a language well, mark it clearly in your PR so a reviewer can.
4. **Every NASA call degrades gracefully.** New API integrations need: a timeout, a localStorage cache TTL, a rate-limit path, an embedded sample fallback, and a line in `docs/NASA_APIS.md`.
5. **Accessibility is not optional.** New controls need keyboard reachability, an ARIA label, and visible focus. Anything auto-moving needs to respect `prefers-reduced-motion`.

## Workflow

```bash
node --test tests/unit/*.test.mjs     # fast — run constantly
node scripts/build-artifact.mjs       # bundler doubles as a lint pass
node tests/e2e/smoke.mjs              # needs: npm i --no-save playwright && npx playwright install chromium
```

CI runs all three on every PR. A PR is mergeable when tests pass and the smoke run shows zero unexpected page errors.

## Code style

Match the existing code: vanilla ES2022 modules, 2-space indent, single quotes, no semicolon omission, comments only where the code can't speak (constraints, verified-against-reality notes, non-obvious math). GLSL lives in template literals inside `engine.js` with quality knobs as `#define`s.

## Commit messages

Imperative first line ≤ 72 chars, body explains *why*. Reference issues where relevant.
