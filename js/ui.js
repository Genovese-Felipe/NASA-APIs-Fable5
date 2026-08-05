/* ── Cosmoscope · ui.js ─────────────────────────────────────────────
   DOM layer: panels, tabs, NASA data views, capture & settings
   wiring, toasts, lightbox, welcome & help overlays. The canvas is
   presentation; this panel tree is the accessible source of truth. */

import { t, setLang, getLang, LANGS } from './i18n.js';
import { BODIES, orbitalPeriodYears, distanceFromEarthAu, KEPLER_ELEMENTS, AU_KM } from './orbits.js';
import { captureStill, Recorder, supportedMimes, bestMime } from './capture.js';

const $ = (id) => document.getElementById(id);

export function toast(msg, type = '', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, ms - 400);
  setTimeout(() => el.remove(), ms);
}

function fmtNum(n, digits = 0) {
  return new Intl.NumberFormat(getLang(), { maximumFractionDigits: digits }).format(n);
}
function fmtDate(d, opts) {
  return new Intl.DateTimeFormat(getLang(), opts || { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(d);
}

function spinner() { return '<div class="spinner" role="status"></div>'; }
function offlineNote() {
  return `<p class="offline-note">📡 ${escapeHtml(t('toast.offline'))}</p>`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Remote images can be unreachable (offline, or the sandboxed artifact's
   CSP): swap failed <img> for a styled placeholder instead of a broken icon */
function wireImgFallback(root) {
  root.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = 'img-ph';
      ph.innerHTML = `<span aria-hidden="true">🛰</span><small>${escapeHtml(img.alt || '…')}</small>`;
      img.replaceWith(ph);
    }, { once: true });
  });
}

export function initUI(app) {
  const { audio, nasa, state } = app;
  const recorder = new Recorder(app.engine.canvas);
  let recTimer = null;

  /* ═══ i18n application ═══ */
  function applyI18n() {
    document.documentElement.lang = getLang();
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', t(el.dataset.i18nTitle));
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    renderBodyList();
    renderBodyCard();
    renderHelp();
    renderWelcomeLangs();
    updatePlayButton();
    updateSpeedLabel();
    updateHint();
    updateAudioButton();
    $('lang').value = getLang();
  }

  /* language selector */
  const langSel = $('lang');
  for (const l of LANGS) {
    const o = document.createElement('option');
    o.value = l.code; o.textContent = l.name;
    langSel.appendChild(o);
  }
  langSel.addEventListener('change', () => {
    setLang(langSel.value);
    try { localStorage.setItem('cosmoscope.lang', langSel.value); } catch { /* fine */ }
    applyI18n();
  });

  function renderWelcomeLangs() {
    const box = $('welcome-langs');
    box.innerHTML = '';
    for (const l of LANGS) {
      const b = document.createElement('button');
      b.textContent = l.name;
      b.className = l.code === getLang() ? 'active' : '';
      b.addEventListener('click', () => {
        setLang(l.code);
        try { localStorage.setItem('cosmoscope.lang', l.code); } catch { /* fine */ }
        applyI18n();
      });
      box.appendChild(b);
    }
  }

  /* ═══ welcome overlay (audio consent gate) ═══ */
  $('welcome-start').addEventListener('click', () => enter(true));
  $('welcome-quiet').addEventListener('click', () => enter(false));
  function enter(withSound) {
    audio.start(withSound);
    updateAudioButton();
    const w = $('welcome');
    w.style.transition = 'opacity .5s';
    w.style.opacity = '0';
    setTimeout(() => { w.hidden = true; }, 500);
    app.engine.canvas.focus();
    if (withSound) audio.ui('open');
  }

  /* ═══ audio button ═══ */
  function updateAudioButton() {
    const b = $('btn-audio');
    b.textContent = audio.started && !audio.muted ? '🔊' : '🔇';
    const key = audio.started && !audio.muted ? 'audio.mute' : 'audio.enable';
    b.title = t(key);
    b.setAttribute('aria-label', t(key));
  }
  $('btn-audio').addEventListener('click', () => {
    if (!audio.started) audio.start(true);
    else audio.setMuted(!audio.muted);
    updateAudioButton();
    audio.ui('click');
  });

  /* ═══ fullscreen / help ═══ */
  $('btn-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  });
  $('btn-help').addEventListener('click', () => { $('help').hidden = false; audio.ui('open'); $('help-close').focus(); });
  $('help-close').addEventListener('click', () => { $('help').hidden = true; audio.ui('close'); });

  function renderHelp() {
    const rows = [
      ['k.drag', 'help.drag'], ['k.scroll', 'help.zoom'], ['k.click', 'help.click'],
      ['1–9,0', 'help.numbers'], ['Space', 'help.space'], [', / .', 'help.speed'],
      ['O F T', 'help.modes'], ['WASD', 'help.wasd'], ['L / P', 'help.toggles'],
      ['S / R', 'help.capture'], ['Esc', 'help.escape'],
    ];
    $('help-body').innerHTML = rows.map(([k, d]) => {
      const key = k.startsWith('k.') ? t(k) : k;
      return `<div><span class="k">${escapeHtml(key)}</span>${escapeHtml(t(d))}</div>`;
    }).join('');
  }

  /* ═══ panel & tabs ═══ */
  const panel = $('panel');
  const sections = document.querySelectorAll('#panel > section');
  let activeTab = 'explore';
  const onOpenTab = {};

  function openTab(name) {
    activeTab = name;
    panel.classList.remove('hidden');
    sections.forEach((s) => { s.hidden = s.dataset.tab !== name; });
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (onOpenTab[name]) onOpenTab[name]();
    audio.ui('open');
  }
  document.querySelectorAll('.rail-btn').forEach((b) => {
    b.addEventListener('click', () => {
      if (activeTab === b.dataset.tab && !panel.classList.contains('hidden')) {
        panel.classList.add('hidden');
        b.classList.remove('active');
        audio.ui('close');
      } else openTab(b.dataset.tab);
    });
  });
  $('panel-close').addEventListener('click', () => {
    panel.classList.add('hidden');
    document.querySelectorAll('.rail-btn').forEach((b) => b.classList.remove('active'));
    audio.ui('close');
  });

  /* ═══ explore tab ═══ */
  function renderBodyList() {
    const box = $('body-list');
    box.innerHTML = '';
    BODIES.forEach((b, i) => {
      const el = document.createElement('button');
      el.className = 'body-item' + (i === state.selected ? ' selected' : '');
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', String(i === state.selected));
      el.innerHTML = `<span class="g">${b.glyph}</span>${escapeHtml(t('body.' + b.key))}`;
      el.addEventListener('click', () => { app.actions.select(i, true); });
      box.appendChild(el);
    });
  }

  function renderBodyCard() {
    const i = state.selected;
    const b = BODIES[i];
    const card = $('body-card');
    if (!b) { card.hidden = true; return; }
    card.hidden = false;
    $('bc-name').textContent = `${b.glyph} ${t('body.' + b.key)}`;
    $('bc-blurb').textContent = t('blurb.' + b.key);
    $('bc-type').textContent = b.key === 'sun' ? t('type.star') : b.key === 'moon' ? t('type.moon') : t('type.planet');
    $('bc-radius').textContent = `${fmtNum(b.radiusKm)} ${t('unit.km')}`;
    const st = state.scene[i];
    $('bc-dist').textContent = b.key === 'sun' ? '—' : `${fmtNum(st ? st.distAu : 0, 2)} ${t('unit.au')}`;
    const py = orbitalPeriodYears(b.key);
    const fmt1 = (n) => new Intl.NumberFormat(getLang(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n);
    $('bc-year').textContent = b.key === 'sun' ? '—'
      : py < 1 ? `${fmt1(py * 365.25)} ${t('unit.days')}` : `${fmt1(py)} ${t('unit.years')}`;
    const rh = Math.abs(b.rotHours);
    $('bc-day').textContent = rh > 72
      ? `${fmtNum(rh / 24, 1)} ${t('unit.days')}` : `${fmtNum(rh, 1)} ${t('unit.hours')}`;
    const dAu = distanceFromEarthAu(b.key, state.simMs);
    $('bc-now').textContent = b.key === 'earth' ? '—'
      : dAu < 0.02 ? `${fmtNum(dAu * AU_KM)} ${t('unit.km')}` : `${fmtNum(dAu, 2)} ${t('unit.au')}`;
  }

  $('bc-goto').addEventListener('click', () => { app.actions.flyTo(state.selected); audio.ui('select'); });
  $('bc-listen').addEventListener('click', () => {
    const b = BODIES[state.selected];
    audio.sonify({
      periodYears: orbitalPeriodYears(b.key) || 0.07,
      radiusKm: b.radiusKm,
      ecc: b.key === 'sun' ? 0 : (KEPLER_ELEMENTS[b.key] ? KEPLER_ELEMENTS[b.key].base[1] : 0.05),
    });
  });
  $('btn-tour').addEventListener('click', () => {
    if (state.mode === 'tour') app.actions.setMode('orbit');
    else app.actions.setMode('tour');
    updateTourButton();
  });
  function updateTourButton() {
    $('btn-tour').textContent = state.mode === 'tour' ? t('tour.stop') : t('tour.start');
  }

  /* ═══ APOD ═══ */
  async function loadApod(date) {
    const box = $('apod-content');
    box.innerHTML = spinner();
    try {
      const { data, offline } = await nasa.apod(date);
      const item = Array.isArray(data) ? data[0] : data;
      let media;
      if (item.media_type === 'image') {
        const src = item.url || item.hdurl;
        media = `<a href="${escapeHtml(item.hdurl || item.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" loading="lazy"></a>`;
      } else {
        const thumb = item.thumbnail_url ? `<img src="${escapeHtml(item.thumbnail_url)}" alt="" loading="lazy">` : '';
        media = `${thumb}<p>${escapeHtml(t('apod.videoDay'))} <a href="https://apod.nasa.gov/apod/ap${(item.date || '').replaceAll('-', '').slice(2)}.html" target="_blank" rel="noopener">${escapeHtml(t('apod.openSite'))}</a></p>`;
      }
      box.innerHTML = `
        ${offline ? offlineNote() : ''}
        <figure>${media}
          <figcaption><b>${escapeHtml(item.title || '')}</b> · ${escapeHtml(item.date || '')}
          ${item.copyright ? `· ${escapeHtml(t('apod.copyright'))}: ${escapeHtml(item.copyright.trim())}` : ''}</figcaption>
        </figure>
        <p class="hint" style="user-select:text">${escapeHtml(item.explanation || '')}</p>`;
      wireImgFallback(box);
      if (item.date) $('apod-date').value = item.date;
    } catch (e) {
      box.innerHTML = `<p class="hint">${escapeHtml(e.kind === 'ratelimit' ? t('toast.rateLimit') : t('toast.apiError'))}</p>`;
      if (e.kind === 'ratelimit') toast(t('toast.rateLimit'), 'warn');
    }
  }
  $('apod-load').addEventListener('click', () => loadApod($('apod-date').value || undefined));
  $('apod-random').addEventListener('click', () => loadApod(nasa.randomApodDate()));
  onOpenTab.apod = () => { if (!$('apod-content').innerHTML) loadApod(); };

  /* ═══ NeoWs ═══ */
  async function loadNeo() {
    const box = $('neo-content');
    box.innerHTML = spinner();
    try {
      const { data, offline } = await nasa.neoFeed();
      const all = Object.values(data.near_earth_objects || {}).flat();
      all.sort((a, b) =>
        parseFloat(a.close_approach_data[0]?.miss_distance.kilometers || 1e12) -
        parseFloat(b.close_approach_data[0]?.miss_distance.kilometers || 1e12));
      state.neoData = all;
      app.actions.refreshNeoPoints();
      const rows = all.slice(0, 20).map((n) => {
        const ca = n.close_approach_data[0] || {};
        const dm = n.estimated_diameter?.meters || {};
        const missKm = parseFloat(ca.miss_distance?.kilometers || 0);
        const lunar = parseFloat(ca.miss_distance?.lunar || 0);
        const kmh = parseFloat(ca.relative_velocity?.kilometers_per_hour || 0);
        return `<div class="api-card">
          <b>${escapeHtml(n.name)}</b>
          <span class="badge ${n.is_potentially_hazardous_asteroid ? 'warn' : 'ok'}">${escapeHtml(n.is_potentially_hazardous_asteroid ? t('neo.hazardous') : t('neo.safe'))}</span>
          <div class="meta">${escapeHtml(t('neo.diameter'))}: ${fmtNum(dm.estimated_diameter_min || 0)}–${fmtNum(dm.estimated_diameter_max || 0)} ${t('unit.m')}
          · ${escapeHtml(t('neo.speed'))}: ${fmtNum(kmh)} ${t('unit.kmh')}<br>
          ${escapeHtml(t('neo.miss'))}: ${fmtNum(missKm)} ${t('unit.km')} (${escapeHtml(t('neo.lunar', { n: fmtNum(lunar, 1) }))})<br>
          ${escapeHtml(t('neo.when'))}: ${escapeHtml(ca.close_approach_date_full || '')}</div>
        </div>`;
      }).join('');
      box.innerHTML = `${offline ? offlineNote() : ''}
        <p class="hint">${escapeHtml(t('neo.count', { n: data.element_count ?? all.length }))}</p>${rows}`;
    } catch (e) {
      box.innerHTML = `<p class="hint">${escapeHtml(e.kind === 'ratelimit' ? t('toast.rateLimit') : t('toast.apiError'))}</p>`;
    }
  }
  $('neo-visualize').addEventListener('change', (e) => {
    state.neoVisualize = e.target.checked;
    app.actions.refreshNeoPoints();
  });
  onOpenTab.asteroids = () => { if (!$('neo-content').innerHTML) loadNeo(); };

  /* ═══ gallery helper ═══ */
  function galleryFromLibrary(box, result, emptyMsg) {
    const { data, offline } = result;
    const items = data.collection?.items?.filter((it) => nasa.thumbOf(it)) || [];
    if (!items.length) {
      box.innerHTML = `<p class="hint">${escapeHtml(emptyMsg || t('lib.none'))}</p>`;
      return;
    }
    box.innerHTML = (offline ? offlineNote() : '') + items.map((it, idx) => {
      const d = it.data[0] || {};
      return `<div class="shot" data-idx="${idx}" role="button" tabindex="0" aria-label="${escapeHtml(d.title || '')}">
        <img src="${escapeHtml(nasa.thumbOf(it))}" alt="${escapeHtml(d.title || '')}" loading="lazy"></div>`;
    }).join('');
    box.querySelectorAll('.shot').forEach((el) => {
      const open = () => {
        const it = items[+el.dataset.idx];
        const d = it.data[0] || {};
        const big = nasa.thumbOf(it).replace('~thumb', '~medium');
        openLightbox(big, `${d.title || ''}${d.date_created ? ' · ' + d.date_created.slice(0, 10) : ''}${d.description ? ' — ' + d.description.slice(0, 300) : ''}`);
      };
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    });
    wireImgFallback(box);
  }

  /* ═══ Mars rovers (served via Image Library — dedicated API retired) ═══ */
  async function loadMars() {
    const box = $('mars-content');
    box.innerHTML = spinner();
    try {
      const result = await nasa.marsPhotos($('rover-select').value);
      galleryFromLibrary(box, result);
      box.insertAdjacentHTML('afterbegin', `<p class="hint" style="grid-column:1/-1">${escapeHtml(t('mars.note'))}</p>`);
    } catch {
      box.innerHTML = `<p class="hint">${escapeHtml(t('toast.apiError'))}</p>`;
    }
  }
  $('mars-load').addEventListener('click', loadMars);
  $('rover-select').addEventListener('change', loadMars);
  onOpenTab.mars = () => { if (!$('mars-content').innerHTML) loadMars(); };

  /* ═══ EPIC ═══ */
  async function loadEpic() {
    const box = $('epic-content');
    box.innerHTML = spinner();
    try {
      const { data, offline } = await nasa.epic();
      const items = (data || []).slice(0, 10);
      if (!items.length) { box.innerHTML = `<p class="hint">${escapeHtml(t('lib.none'))}</p>`; return; }
      box.innerHTML = `${offline ? offlineNote() : ''}
        <figure><img id="epic-big" src="${escapeHtml(nasa.epicImageUrl(items[0]))}" alt="Earth from DSCOVR EPIC">
        <figcaption id="epic-cap">${escapeHtml(t('epic.taken', { date: items[0].date }))} · lat ${fmtNum(items[0].centroid_coordinates?.lat ?? 0, 1)}°, lon ${fmtNum(items[0].centroid_coordinates?.lon ?? 0, 1)}°</figcaption></figure>
        <div class="gallery">${items.map((it, i) =>
          `<div class="shot" data-i="${i}" role="button" tabindex="0"><img src="${escapeHtml(nasa.epicImageUrl(it))}" alt="" loading="lazy"></div>`).join('')}</div>`;
      box.querySelectorAll('.shot').forEach((el) => {
        el.addEventListener('click', () => {
          const it = items[+el.dataset.i];
          $('epic-big').src = nasa.epicImageUrl(it);
          $('epic-cap').textContent = `${t('epic.taken', { date: it.date })} · lat ${fmtNum(it.centroid_coordinates?.lat ?? 0, 1)}°, lon ${fmtNum(it.centroid_coordinates?.lon ?? 0, 1)}°`;
        });
      });
      wireImgFallback(box);
    } catch {
      box.innerHTML = `<p class="hint">${escapeHtml(t('toast.apiError'))}</p>`;
    }
  }
  $('epic-load').addEventListener('click', loadEpic);
  onOpenTab.earth = () => { if (!$('epic-content').innerHTML) loadEpic(); };

  /* ═══ DONKI ═══ */
  async function loadDonki() {
    const box = $('donki-content');
    box.innerHTML = spinner();
    try {
      const { data, offline } = await nasa.donki();
      const flares = data.flares || [], cmes = data.cmes || [];
      const score = nasa.activityScore(flares);
      app.actions.setActivity(score);
      const fmtT = (s) => {
        if (!s) return '';
        const d = new Date(s.replace('Z', ':00Z'));
        return isNaN(d) ? s : fmtDate(d);
      };
      const flareRows = flares.slice(-8).reverse().map((f) => `<div class="api-card">
        <b>${escapeHtml(f.classType || '?')}</b> <span class="badge ${(f.classType || '')[0] === 'X' ? 'warn' : 'info'}">${escapeHtml(t('donki.class'))}</span>
        <div class="meta">${escapeHtml(fmtT(f.peakTime || f.beginTime))}${f.sourceLocation ? ` · ${escapeHtml(t('donki.region'))}: ${escapeHtml(f.sourceLocation)}` : ''}</div></div>`).join('');
      const cmeRows = cmes.slice(-6).reverse().map((c) => {
        const a = (c.cmeAnalyses || []).find((x) => x.isMostAccurate) || (c.cmeAnalyses || [])[0] || {};
        return `<div class="api-card"><b>CME</b>
          <div class="meta">${escapeHtml(fmtT(c.startTime))}${a.speed ? ` · ${escapeHtml(t('donki.speed'))}: ${fmtNum(a.speed)} ${t('unit.kms')}` : ''}</div></div>`;
      }).join('');
      box.innerHTML = `${offline ? offlineNote() : ''}
        ${score > 0.5 ? `<p class="offline-note">${escapeHtml(t('donki.activeNote'))}</p>` : ''}
        <h3>${escapeHtml(t('donki.flares'))}</h3>${flareRows || `<p class="hint">${escapeHtml(t('donki.none'))}</p>`}
        <h3>${escapeHtml(t('donki.cmes'))}</h3>${cmeRows || `<p class="hint">${escapeHtml(t('donki.none'))}</p>`}`;
    } catch {
      box.innerHTML = `<p class="hint">${escapeHtml(t('toast.apiError'))}</p>`;
    }
  }
  $('donki-load').addEventListener('click', loadDonki);
  onOpenTab.weather = () => { if (!$('donki-content').innerHTML) loadDonki(); };

  /* ═══ Library (images + NASA sonification sounds) ═══ */
  let libMedia = 'image';
  const libSeg = document.createElement('div');
  libSeg.className = 'seg';
  libSeg.style.margin = '8px 0';
  libSeg.innerHTML = `<button type="button" class="active" data-m="image"></button><button type="button" data-m="audio"></button>`;
  $('lib-form').after(libSeg);
  function updateLibSeg() {
    libSeg.children[0].textContent = t('lib.images');
    libSeg.children[1].textContent = t('lib.sounds');
  }
  libSeg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    libMedia = b.dataset.m;
    libSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    doSearch();
  }));

  async function doSearch() {
    const q = $('lib-q').value.trim() || (libMedia === 'audio' ? 'sonification' : 'nebula');
    const box = $('lib-content');
    box.innerHTML = spinner();
    try {
      const result = await nasa.librarySearch(q, libMedia, 1);
      const total = result.data.collection?.metadata?.total_hits ?? 0;
      if (libMedia === 'image') {
        galleryFromLibrary(box, result);
        box.insertAdjacentHTML('afterbegin', `<p class="hint" style="grid-column:1/-1">${escapeHtml(t('lib.results', { n: fmtNum(total) }))}</p>`);
      } else {
        const items = result.data.collection?.items || [];
        if (!items.length) { box.innerHTML = `<p class="hint">${escapeHtml(t('lib.none'))}</p>`; return; }
        box.innerHTML = `<p class="hint" style="grid-column:1/-1">${escapeHtml(t('lib.results', { n: fmtNum(total) }))}</p>` +
          items.slice(0, 10).map((it, i) => {
            const d = it.data[0] || {};
            return `<div class="api-card" style="grid-column:1/-1" data-i="${i}">
              <b>${escapeHtml(d.title || 'NASA audio')}</b>
              <div class="meta">${escapeHtml((d.description || '').slice(0, 160))}</div>
              <div class="audio-slot" style="margin-top:6px"><button class="btn" data-play="${i}">▶ ${escapeHtml(t('ui.open'))}</button></div>
            </div>`;
          }).join('');
        box.querySelectorAll('[data-play]').forEach((btn) => btn.addEventListener('click', async () => {
          btn.disabled = true;
          const it = items[+btn.dataset.play];
          const url = await nasa.audioUrlOf(it);
          const slot = btn.parentElement;
          if (url) slot.innerHTML = `<audio controls crossorigin="anonymous" src="${escapeHtml(url)}" style="width:100%"></audio>`;
          else slot.innerHTML = `<p class="hint">${escapeHtml(t('toast.apiError'))}</p>`;
        }));
      }
    } catch {
      box.innerHTML = `<p class="hint">${escapeHtml(t('toast.apiError'))}</p>`;
    }
  }
  $('lib-form').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });
  onOpenTab.library = () => { updateLibSeg(); if (!$('lib-content').innerHTML) doSearch(); };

  /* ═══ lightbox ═══ */
  function openLightbox(src, caption) {
    $('lightbox-img').src = src;
    $('lightbox-img').alt = caption || '';
    $('lightbox-cap').textContent = caption || '';
    $('lightbox').hidden = false;
    $('lightbox-close').focus();
    audio.ui('open');
  }
  function closeLightbox() { $('lightbox').hidden = true; audio.ui('close'); }
  $('lightbox-close').addEventListener('click', closeLightbox);
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });

  /* ═══ capture tab ═══ */
  const mimes = supportedMimes();
  const fmtSel = $('rec-fmt');
  if (mimes.some((m) => m.startsWith('video/mp4'))) {
    const o = document.createElement('option'); o.value = 'mp4'; o.textContent = 'MP4 (H.264)';
    fmtSel.appendChild(o);
  }
  if (mimes.some((m) => m.startsWith('video/webm'))) {
    const o = document.createElement('option'); o.value = 'webm'; o.textContent = 'WebM (VP9/VP8)';
    fmtSel.appendChild(o);
  }
  function updateRecNote() {
    if (!recorder.supported) { $('rec-note').textContent = t('cap.unsupported'); $('btn-rec').disabled = true; return; }
    const best = bestMime('auto');
    $('rec-note').textContent = best && best.startsWith('video/mp4') ? t('cap.mp4ok') : t('cap.webmNote');
  }

  $('shot-fmt').addEventListener('change', () => {
    $('shot-quality-field').style.display = $('shot-fmt').value === 'image/png' ? 'none' : '';
  });

  $('btn-shot').addEventListener('click', async () => {
    const btn = $('btn-shot');
    btn.disabled = true;
    audio.ui('shutter');
    const res = $('shot-res').value;
    try {
      const { blob, name } = await captureStill(app.engine, app.lastFrame, {
        res,
        mime: $('shot-fmt').value,
        quality: parseFloat($('shot-quality').value),
        onProgress: (p) => {
          btn.textContent = t('cap.rendering', { res: res === 'screen' ? '' : res + 'px', pct: Math.round(p * 100) });
        },
      });
      const url = addDownload(blob, name);
      toast(t('cap.saved', { name }));
      void url;
    } catch (e) {
      toast(e.kind === 'toobig' ? t('cap.tooBig') : t('toast.apiError'), 'err');
      audio.ui('error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('cap.take');
    }
  });

  function addDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    const item = document.createElement('div');
    item.className = 'dl-item';
    const size = blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.round(blob.size / 1024) + ' KB';
    item.innerHTML = `<span>💾</span><a href="${url}" download="${escapeHtml(name)}">${escapeHtml(name)}</a><span class="hint">${size}</span>`;
    $('downloads').prepend(item);
    return url;
  }

  $('btn-rec').addEventListener('click', async () => {
    const btn = $('btn-rec');
    if (!recorder.recording) {
      try {
        const mime = recorder.start({
          preference: fmtSel.value,
          fps: parseInt($('rec-fps').value, 10),
          mbps: parseInt($('rec-quality').value, 10),
          audioEngine: audio,
        });
        btn.textContent = t('cap.stop');
        btn.classList.add('recording');
        $('rec-indicator').hidden = false;
        audio.ui('recStart');
        toast(t('cap.recStarted', { fmt: mime.split(';')[0] }));
        recTimer = setInterval(() => {
          const s = Math.floor(recorder.elapsed());
          $('rec-time').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        }, 500);
      } catch {
        toast(t('cap.unsupported'), 'err');
        audio.ui('error');
      }
    } else {
      try {
        const { blob, name } = await recorder.stop();
        addDownload(blob, name);
        toast(t('cap.recStopped'));
        audio.ui('recStop');
      } catch {
        toast(t('toast.apiError'), 'err');
      }
      btn.textContent = t('cap.record');
      btn.classList.remove('recording');
      $('rec-indicator').hidden = true;
      clearInterval(recTimer);
    }
  });
  onOpenTab.capture = updateRecNote;

  /* ═══ settings ═══ */
  const PRESETS = {
    low: { octaves: 3, softShadows: false, belt: false, bloom: false, grain: false, renderScale: 0.75 },
    medium: { octaves: 4, softShadows: true, belt: false, bloom: true, grain: true, renderScale: 1 },
    high: { octaves: 5, softShadows: true, belt: true, bloom: true, grain: true, renderScale: 1 },
    ultra: { octaves: 6, softShadows: true, belt: true, bloom: true, grain: true, renderScale: 1.5 },
  };
  function syncGraphicsUI() {
    const o = app.engine.opt;
    $('opt-bloom').checked = o.bloom;
    $('opt-softshadow').checked = o.softShadows;
    $('opt-belt').checked = o.belt;
    $('opt-grain').checked = o.grain;
    $('render-scale').value = o.renderScale;
    $('render-scale-val').textContent = o.renderScale.toFixed(2) + '×';
  }
  $('quality-seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $('quality-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    app.engine.setOptions(PRESETS[b.dataset.q]);
    app.engine.resize();
    syncGraphicsUI();
    audio.ui('click');
  }));
  for (const [id, key] of [['opt-bloom', 'bloom'], ['opt-softshadow', 'softShadows'], ['opt-belt', 'belt'], ['opt-grain', 'grain']]) {
    $(id).addEventListener('change', (e) => { app.engine.setOptions({ [key]: e.target.checked }); });
  }
  $('render-scale').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    $('render-scale-val').textContent = v.toFixed(2) + '×';
    app.engine.setOptions({ renderScale: v });
    app.engine.resize();
  });
  $('opt-labels').addEventListener('change', (e) => { state.showLabels = e.target.checked; });
  $('opt-orbits').addEventListener('change', (e) => { state.showOrbits = e.target.checked; });
  $('scale-seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    $('scale-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    app.actions.setScaleMode(b.dataset.s);
    audio.ui('click');
  }));
  $('vol-master').addEventListener('input', (e) => audio.setVolumes({ master: +e.target.value }));
  $('vol-music').addEventListener('input', (e) => audio.setVolumes({ music: +e.target.value }));
  $('vol-fx').addEventListener('input', (e) => audio.setVolumes({ fx: +e.target.value }));
  $('api-key').value = nasa.key === 'DEMO_KEY' ? '' : nasa.key;
  $('api-save').addEventListener('click', () => {
    nasa.setKey($('api-key').value);
    $('api-status').textContent = t('set.keySaved') + (nasa.key === 'DEMO_KEY' ? ' (DEMO_KEY)' : '');
    audio.ui('click');
  });

  /* ═══ time & camera HUD ═══ */
  function updatePlayButton() {
    $('play-icon').textContent = state.paused ? '▶' : '⏸';
    const key = state.paused ? 'time.play' : 'time.pause';
    $('btn-play').title = t(key);
    $('btn-play').setAttribute('aria-label', t(key));
  }
  function updateSpeedLabel() {
    $('speed-label').textContent = t('speed.s' + state.speedIdx);
    $('speed').setAttribute('aria-valuetext', t('speed.s' + state.speedIdx));
  }
  function updateHint() {
    $('hint-line').textContent = t(state.mode === 'free' ? 'hint.free' : 'hint.drag');
  }
  $('btn-play').addEventListener('click', () => { app.actions.togglePause(); audio.ui('click'); });
  $('btn-now').addEventListener('click', () => { app.actions.setNow(); audio.ui('click'); });
  $('speed').addEventListener('input', (e) => { app.actions.setSpeedIdx(parseInt(e.target.value, 10)); });
  $('cam-seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    app.actions.setMode(b.dataset.cam);
    audio.ui('click');
  }));

  /* ═══ escape key ═══ */
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightbox').hidden) closeLightbox();
      else if (!$('help').hidden) $('help-close').click();
      else if (!panel.classList.contains('hidden')) $('panel-close').click();
    }
  });

  /* ═══ hooks the app loop calls ═══ */
  const ui = {
    applyI18n,
    renderBodyCard,
    renderBodyList,
    updatePlayButton,
    updateSpeedLabel,
    updateHint,
    updateTourButton,
    toast,
    openTab,
    syncCamSeg() {
      $('cam-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.cam === state.mode));
      updateHint();
      updateTourButton();
    },
    setSimDateText(txt) { $('sim-date').textContent = txt; },
    setFps(v) { $('fps').textContent = v + ' fps'; },
    setSelChip() {
      const b = BODIES[state.selected];
      $('sel-name').textContent = t('body.' + b.key);
      $('sel-chip').firstChild.textContent = b.glyph + ' ';
    },
    setCamDist(txt) { $('cam-dist').textContent = txt; },
    fmtDate,
    fmtNum,
  };

  applyI18n();
  syncGraphicsUI();
  updateRecNote();
  return ui;
}
