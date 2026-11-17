/* ── Cosmoscope · eclipselab.js ─────────────────────────────────────
   The Eclipses panel and the Eclipse Lab map. Everything shown is
   computed in the browser by eclipses.js: the live shadow over a
   world map with a day/night terminator, the central path and its
   limits, a maximum-eclipse field, the Sun and Moon disks seen from
   the greatest-eclipse point, and the Moon inside Earth's shadow.  */

import { t, getLang } from './i18n.js';
import { findEclipses, solarPath, localSolar, geodeticToEcef, sunMoon, jdToMs, dtSeconds, solarDiskView, lunarShadowView, axisGround, moonAltitude } from './eclipses.js';
import { WORLD_LAND, WORLD_BORDERS, decodePath } from './worldmap.js';
import { download } from './capture.js';

const GRID = 2;                       /* field resolution, degrees */
const GW = 360 / GRID, GH = 180 / GRID;

export function initEclipseLab(app, { toast }) {
  const byId = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let all = null;
  let showPast = false;

  /* ── formatting ── */
  const fmtUT = (ms, withTime = true) => new Intl.DateTimeFormat(getLang(), withTime
    ? { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }
    : { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(ms)) + (withTime ? ' UT' : '');
  const fmtClock = (ms) => new Date(ms).toISOString().slice(11, 19) + ' UT';
  const fmtDur = (s) => {
    if (!s) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = Math.round(s % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(r).padStart(2, '0')}s`;
  };
  const fmtLatLon = (p) => `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lon).toFixed(1)}°${p.lon >= 0 ? 'E' : 'W'}`;
  const num = (v, d) => new Intl.NumberFormat(getLang(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  const rel = (ms) => {
    const days = Math.round((ms - Date.now()) / 86400000);
    const rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto' });
    if (Math.abs(days) < 60) return rtf.format(days, 'day');
    if (Math.abs(days) < 730) return rtf.format(Math.round(days / 30.44), 'month');
    return rtf.format(Math.round(days / 365.25), 'year');
  };
  const nameOf = (e) => t(`ecl.n.${e.kind}.${e.type}`);
  const typeClass = (e) => ({ total: 'tot', annular: 'ann', hybrid: 'hyb', partial: 'par', penumbral: 'pen' }[e.type]);

  /* ── the list ── */
  function compute() {
    if (all) return all;
    const now = Date.now(), year = 365.25 * 86400000;
    all = findEclipses(now - 4 * year, now + 12 * year);
    return all;
  }

  function factsOf(e) {
    if (e.kind === 'solar') {
      const rows = [[t('ecl.magnitude'), num(e.magnitude, 3)]];
      if (e.durationS) rows.push([t(e.type === 'annular' ? 'ecl.annularity' : 'ecl.totality'), fmtDur(e.durationS)]);
      if (e.widthKm) rows.push([t('ecl.width'), `${num(e.widthKm, 0)} ${t('unit.km')}`]);
      rows.push([t('ecl.where'), fmtLatLon(e.ge)]);
      if (e.sunAltDeg !== undefined) rows.push([t('ecl.sunAlt'), `${num(e.sunAltDeg, 0)}°`]);
      rows.push([t('ecl.gamma'), num(e.gamma, 4)]);
      return rows;
    }
    const rows = [[t('ecl.umbral'), num(e.umbral, 3)], [t('ecl.penumbral'), num(e.penumbral, 3)]];
    if (e.durTotS) rows.push([t('ecl.totalPhase'), fmtDur(e.durTotS)]);
    if (e.durParS) rows.push([t('ecl.partialPhase'), fmtDur(e.durParS)]);
    rows.push([t('ecl.gamma'), num(e.gamma, 4)]);
    return rows;
  }

  function renderList() {
    const box = byId('ecl-list');
    if (!box) return;
    const list = compute();
    const now = Date.now();
    const shown = showPast ? list.filter((e) => e.utMs < now).reverse() : list.filter((e) => e.utMs >= now);
    box.innerHTML = shown.slice(0, 24).map((e) => `
      <article class="ecl-card ${typeClass(e)}" data-k="${list.indexOf(e)}">
        <div class="ecl-top"><span class="ecl-ico" aria-hidden="true">${e.kind === 'solar' ? '🌑' : '🌕'}</span>
          <b>${esc(nameOf(e))}</b><span class="badge info">${esc(rel(e.utMs))}</span></div>
        <div class="meta">${esc(t('ecl.greatest'))}: ${esc(fmtUT(e.utMs))}</div>
        <dl class="ecl-facts">${factsOf(e).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <div class="row gap"><button class="btn primary" data-act="map">${esc(t('ecl.map'))}</button>
          <button class="btn" data-act="watch">${esc(t('ecl.watch'))}</button></div>
      </article>`).join('') + `<p class="hint">✔ ${esc(t('ecl.verified'))}</p>`;
    box.querySelectorAll('.ecl-card').forEach((card) => {
      const e = list[+card.dataset.k];
      card.querySelector('[data-act="map"]').addEventListener('click', () => openLab(e));
      card.querySelector('[data-act="watch"]').addEventListener('click', () => watch(e));
    });
  }

  function openPanel() {
    const box = byId('ecl-list');
    if (all) { renderList(); return; }
    box.innerHTML = `<div class="spinner" role="status"></div><p class="hint" style="text-align:center">${esc(t('ecl.computing'))}</p>`;
    setTimeout(renderList, 30);
  }

  byId('ecl-seg').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    showPast = b.dataset.v === 'past';
    byId('ecl-seg').querySelectorAll('button').forEach((x) => {
      x.classList.toggle('active', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    renderList();
    app.audio.ui('click');
  }));
  document.querySelector('.rail-btn[data-tab="eclipses"]').addEventListener('click', openPanel);

  /* ── jump into the 3D scene ── */
  function watch(e) {
    const lead = e.kind === 'solar' ? 40 * 60000 : Math.max(30 * 60000, (e.durParS || e.durPenS) * 500);
    app.actions.jumpTo({ ms: e.utMs - lead, bodyKey: e.kind === 'solar' ? 'earth' : 'moon', speedIdx: 1, scale: 'true' });
    toast(t(e.kind === 'solar' ? 'ecl.jumped' : 'ecl.jumpedLunar', { date: fmtUT(e.utMs) }), '', 6500);
    app.audio.ui('select');
  }

  /* ── Eclipse Lab: map ── */
  const lab = byId('ecl-lab');
  const map = byId('ecl-map'), mctx = map.getContext('2d');
  const disk = byId('ecl-disk'), dctx = disk.getContext('2d');
  const slider = byId('ecl-time');
  const field = document.createElement('canvas');
  field.width = GW; field.height = GH;
  const fctx = field.getContext('2d');
  const fimg = fctx.createImageData(GW, GH);
  const grid = [];
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) grid.push(geodeticToEcef(90 - (j + 0.5) * GRID, -180 + (i + 0.5) * GRID));
  }
  let cur = null, path = [], maxField = null, view = 'live', playing = false, raf = 0, range = [0, 0];

  const X = (lon) => (lon + 180) / 360 * map.width;
  const Y = (lat) => (90 - lat) / 180 * map.height;

  /* land rings unwrapped across the antimeridian and drawn three times */
  const landPaths = WORLD_LAND.map(decodePath).map((pts) => {
    const out = [];
    let off = 0, prev = null;
    for (const [lon, lat] of pts) {
      if (prev !== null && lon + off - prev > 180) off -= 360;
      else if (prev !== null && lon + off - prev < -180) off += 360;
      out.push([lon + off, lat]);
      prev = lon + off;
    }
    return out;
  });
  const borderPaths = WORLD_BORDERS.map(decodePath);

  function drawBase() {
    const W = map.width, H = map.height;
    mctx.fillStyle = '#0a1426';
    mctx.fillRect(0, 0, W, H);
    mctx.strokeStyle = 'rgba(127,212,255,0.08)';
    mctx.lineWidth = 1;
    for (let lon = -150; lon <= 150; lon += 30) { mctx.beginPath(); mctx.moveTo(X(lon), 0); mctx.lineTo(X(lon), H); mctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { mctx.beginPath(); mctx.moveTo(0, Y(lat)); mctx.lineTo(W, Y(lat)); mctx.stroke(); }
    mctx.fillStyle = '#20314f';
    for (const shift of [-360, 0, 360]) {
      mctx.beginPath();
      for (const ring of landPaths) {
        ring.forEach(([lon, lat], k) => (k ? mctx.lineTo : mctx.moveTo).call(mctx, X(lon + shift), Y(lat)));
        mctx.closePath();
      }
      mctx.fill('evenodd');
    }
  }

  function strokeLines(lines, style, width) {
    mctx.strokeStyle = style;
    mctx.lineWidth = width;
    for (const pts of lines) {
      mctx.beginPath();
      let prev = null;
      for (const [lon, lat] of pts) {
        if (prev === null || Math.abs(lon - prev) > 180) mctx.moveTo(X(lon), Y(lat));
        else mctx.lineTo(X(lon), Y(lat));
        prev = lon;
      }
      mctx.stroke();
    }
  }

  function computeField(jd) {
    const d = fimg.data;
    const sm = sunMoon(jd);
    for (let k = 0; k < grid.length; k++) {
      let r = 0, g = 0, b = 0, a = 0;
      if (cur.kind === 'solar') {
        const v = view === 'max' ? maxField[k] : localSolar(jd, grid[k], sm);
        const mag = view === 'max' ? v : v.mag;
        if (view === 'live' && v.alt < 0) { r = 2; g = 4; b = 14; a = 150; }
        if (mag > 0) {
          const central = view === 'live' ? (v.total || v.annular) : mag >= 0.999;
          if (central) { r = 255; g = 250; b = 230; a = 250; }
          else { r = 255; g = 120 - 60 * mag; b = 40; a = 40 + 175 * mag; }
        }
      } else {
        const alt = moonAltitude(jd, grid[k], sm);
        if (alt < 0) { r = 2; g = 4; b = 14; a = 165; }
        else { r = 127; g = 212; b = 255; a = 26; }
      }
      d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = a;
    }
    fctx.putImageData(fimg, 0, 0);
  }

  function buildMaxField() {
    maxField = new Float32Array(grid.length);
    const [a, b] = range;
    for (let m = a; m <= b; m += 4) {
      const jd = cur.jdTT + m / 1440;
      const sm = sunMoon(jd);
      for (let k = 0; k < grid.length; k++) {
        const v = localSolar(jd, grid[k], sm);
        if (v.mag > maxField[k]) maxField[k] = v.total || v.annular ? 1 : Math.min(0.998, v.mag);
      }
    }
  }

  function drawMap(jd) {
    drawBase();
    computeField(jd);
    mctx.imageSmoothingEnabled = true;
    mctx.imageSmoothingQuality = 'high';
    mctx.drawImage(field, 0, 0, map.width, map.height);
    strokeLines(landPaths.map((r) => r.map(([lon, lat]) => [((lon + 540) % 360) - 180, lat])), 'rgba(170,200,240,0.35)', 1);
    strokeLines(borderPaths, 'rgba(170,200,240,0.18)', 0.8);
    if (cur.kind === 'solar' && path.length) {
      strokeLines([path.map((p) => [p.north.lon, p.north.lat]), path.map((p) => [p.south.lon, p.south.lat])], 'rgba(255,196,107,0.9)', 1.6);
      strokeLines([path.map((p) => [p.center.lon, p.center.lat])], 'rgba(255,240,200,0.95)', 2.4);
    }
    const ge = cur.kind === 'solar' ? cur.ge : cur.zenith;
    star(X(ge.lon), Y(ge.lat));
    if (cur.kind === 'solar') {
      const g = axisGround(jd);
      if (g) {
        mctx.fillStyle = '#ff6b81';
        mctx.beginPath(); mctx.arc(X(g.lon), Y(g.lat), 7, 0, Math.PI * 2); mctx.fill();
      }
    }
    drawLegend();
  }

  function star(x, y) {
    mctx.save();
    mctx.translate(x, y);
    mctx.fillStyle = '#ffc46b';
    mctx.strokeStyle = '#05070f';
    mctx.lineWidth = 2;
    mctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 6 : 15, a = -Math.PI / 2 + i * Math.PI / 5;
      mctx[i ? 'lineTo' : 'moveTo'](r * Math.cos(a), r * Math.sin(a));
    }
    mctx.closePath(); mctx.stroke(); mctx.fill();
    mctx.restore();
  }

  function drawLegend() {
    const items = cur.kind === 'solar'
      ? [['rgba(255,240,200,0.95)', t('ecl.legendCentral')], ['rgba(255,110,40,0.75)', t('ecl.legendPartial')],
         ['rgba(2,4,14,0.9)', t('ecl.legendNight')], ['#ffc46b', `★ ${t('ecl.greatest')}`]]
      : [['rgba(127,212,255,0.35)', t('ecl.legendMoonUp')], ['rgba(2,4,14,0.9)', t('ecl.legendNight')], ['#ffc46b', `★ ${t('ecl.greatest')}`]];
    const W = map.width, H = map.height;
    mctx.font = '22px system-ui, sans-serif';
    let x = 24;
    const y = H - 26;
    mctx.fillStyle = 'rgba(5,7,15,0.72)';
    const total = items.reduce((s, [, l]) => s + mctx.measureText(l).width + 60, 0);
    mctx.fillRect(12, y - 26, Math.min(W - 24, total + 8), 40);
    for (const [c, label] of items) {
      mctx.fillStyle = c;
      mctx.fillRect(x, y - 14, 26, 16);
      mctx.fillStyle = '#e8eefc';
      mctx.fillText(label, x + 34, y);
      x += mctx.measureText(label).width + 60;
    }
  }

  /* ── side diagram ── */
  function drawDisk(jd) {
    const W = disk.width, H = disk.height;
    dctx.fillStyle = '#05070f';
    dctx.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2;
    if (cur.kind === 'solar') {
      const v = solarDiskView(jd, geodeticToEcef(cur.ge.lat, cur.ge.lon));
      const k = (W * 0.27) / v.rs;
      const grad = dctx.createRadialGradient(cx, cy, 0, cx, cy, v.rs * k);
      grad.addColorStop(0, '#fff6d8'); grad.addColorStop(0.8, '#ffd27a'); grad.addColorStop(1, '#f39a3a');
      const covered = localSolar(jd, geodeticToEcef(cur.ge.lat, cur.ge.lon), null, true);
      if (covered.total) {
        dctx.strokeStyle = 'rgba(220,235,255,0.55)';
        for (let i = 0; i < 40; i++) {
          const a = i / 40 * Math.PI * 2, r0 = v.rs * k, r1 = r0 * (1.4 + 0.5 * Math.sin(i * 7.3));
          dctx.beginPath(); dctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
          dctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); dctx.stroke();
        }
      }
      dctx.fillStyle = grad;
      dctx.beginPath(); dctx.arc(cx, cy, v.rs * k, 0, Math.PI * 2); dctx.fill();
      dctx.fillStyle = '#0b0d16';
      dctx.beginPath(); dctx.arc(cx - v.dx * k, cy - v.dy * k, v.rm * k, 0, Math.PI * 2); dctx.fill();
      label(`${t('ecl.fromHere')} · ${num(Math.max(0, covered.mag), 3)}`);
      if (v.alt < 0) { dctx.fillStyle = 'rgba(5,7,15,0.7)'; dctx.fillRect(0, 0, W, H); }
    } else {
      const v = lunarShadowView(jd);
      const k = (W * 0.42) / v.rhoP;
      dctx.fillStyle = 'rgba(127,140,170,0.16)';
      dctx.beginPath(); dctx.arc(cx, cy, v.rhoP * k, 0, Math.PI * 2); dctx.fill();
      dctx.fillStyle = 'rgba(40,24,30,0.9)';
      dctx.beginPath(); dctx.arc(cx, cy, v.rhoU * k, 0, Math.PI * 2); dctx.fill();
      const mx = cx - v.dx * k, my = cy - v.dy * k;
      const dist = Math.hypot(v.dx, v.dy);
      const inUmbra = Math.max(0, Math.min(1, (v.rhoU + v.sm - dist) / (2 * v.sm)));
      const inPen = Math.max(0, Math.min(1, (v.rhoP + v.sm - dist) / (2 * v.sm)));
      const lit = 1 - 0.35 * inPen;
      const r = Math.round(230 * lit - 60 * inUmbra), g = Math.round(225 * lit - 175 * inUmbra), b = Math.round(215 * lit - 190 * inUmbra);
      dctx.fillStyle = `rgb(${Math.max(r, 90)},${Math.max(g, 22)},${Math.max(b, 14)})`;
      dctx.beginPath(); dctx.arc(mx, my, v.sm * k, 0, Math.PI * 2); dctx.fill();
      label(t('ecl.shadowView'));
    }
    function label(s) {
      dctx.fillStyle = '#93a0bd';
      dctx.font = '20px system-ui, sans-serif';
      dctx.textAlign = 'center';
      dctx.fillText(s, cx, H - 18);
      dctx.textAlign = 'left';
    }
  }

  function setTimeFromSlider() {
    const jd = cur.jdTT + (+slider.value) / 1440;
    byId('ecl-clock').textContent = fmtClock(jdToMs(jd - dtSeconds(jd) / 86400));
    drawMap(jd);
    drawDisk(jd);
  }

  function openLab(e) {
    cur = e;
    stop();
    byId('ecl-lab-title').textContent = `${nameOf(e)} · ${fmtUT(e.utMs, false)}`;
    byId('ecl-lab-facts').innerHTML = [[t('ecl.greatest'), fmtUT(e.utMs)], ...factsOf(e)]
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    const half = e.kind === 'solar' ? 200 : Math.ceil(e.durPenS / 120 + 25);
    range = [-half, half];
    slider.min = -half; slider.max = half; slider.value = 0;
    path = e.kind === 'solar' ? solarPath(e.jdTT, 2, 4) : [];
    maxField = null;
    view = 'live';
    syncViewSeg();
    byId('ecl-view').hidden = e.kind !== 'solar';
    lab.hidden = false;
    byId('ecl-lab-close').focus();
    setTimeFromSlider();
    app.audio.ui('open');
  }

  function syncViewSeg() {
    byId('ecl-view').querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === view);
      b.setAttribute('aria-pressed', String(b.dataset.v === view));
    });
  }
  byId('ecl-view').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.v;
    if (view === 'max' && !maxField) buildMaxField();
    syncViewSeg();
    setTimeFromSlider();
  }));

  function stop() {
    playing = false;
    cancelAnimationFrame(raf);
    byId('ecl-play').textContent = `▶ ${t('ecl.play')}`;
  }
  function tick() {
    if (!playing) return;
    let v = +slider.value + (range[1] - range[0]) / 600;
    if (v > range[1]) v = range[0];
    slider.value = v;
    setTimeFromSlider();
    raf = requestAnimationFrame(tick);
  }
  byId('ecl-play').addEventListener('click', () => {
    if (playing) { stop(); return; }
    playing = true;
    byId('ecl-play').textContent = `⏸ ${t('ecl.pause')}`;
    raf = requestAnimationFrame(tick);
  });
  slider.addEventListener('input', () => { stop(); setTimeFromSlider(); });

  function closeLab() { stop(); lab.hidden = true; app.audio.ui('close'); }
  byId('ecl-lab-close').addEventListener('click', closeLab);
  lab.addEventListener('click', (ev) => { if (ev.target === lab) closeLab(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !lab.hidden) closeLab(); });
  byId('ecl-watch').addEventListener('click', () => { const e = cur; closeLab(); watch(e); });

  byId('ecl-save').addEventListener('click', () => {
    const out = document.createElement('canvas');
    out.width = map.width; out.height = map.height + 70;
    const o = out.getContext('2d');
    o.fillStyle = '#05070f'; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(map, 0, 70);
    o.fillStyle = '#e8eefc'; o.font = 'bold 30px system-ui, sans-serif';
    o.fillText(`${byId('ecl-lab-title').textContent} — ${byId('ecl-clock').textContent}`, 24, 46);
    o.fillStyle = '#93a0bd'; o.font = '20px system-ui, sans-serif';
    o.textAlign = 'right'; o.fillText('Cosmoscope', out.width - 24, 46);
    out.toBlob((blob) => {
      const d = new Date(cur.utMs).toISOString().slice(0, 10);
      download(blob, `cosmoscope-eclipse-${d}.png`);
    }, 'image/png');
    app.audio.ui('shutter');
  });

  return {
    refresh() { if (all && !byId('ecl-list').closest('section').hidden) renderList(); if (cur && !lab.hidden) openLab(cur); },
    list: () => compute(),
    openLab,
  };
}
