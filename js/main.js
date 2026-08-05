/* ── Cosmoscope · main.js ───────────────────────────────────────────
   Boot + simulation clock + camera + input + render loop.          */

import { Engine, mat4Perspective, mat4View, mat4Mul } from './engine.js';
import { BODIES, BODY_INDEX, computeScene, orbitPath, SCENE } from './orbits.js';
import { t, setLang, detectLang } from './i18n.js';
import { AudioEngine } from './audio.js';
import { NasaClient } from './nasa.js';
import { initUI, toast } from './ui.js';

const SPEEDS = [1, 60, 600, 3600, 21600, 86400, 259200, 604800, 2629800, 15778800, 31557600];
const TAU = Math.PI * 2;

const PATH_COLORS = {
  mercury: [0.62, 0.58, 0.55], venus: [0.9, 0.78, 0.5], earth: [0.35, 0.62, 1.0],
  moon: [0.6, 0.6, 0.65], mars: [0.9, 0.45, 0.25], jupiter: [0.85, 0.7, 0.5],
  saturn: [0.9, 0.8, 0.55], uranus: [0.5, 0.85, 0.85], neptune: [0.4, 0.55, 1.0],
};

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* small vector helpers */
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  lerp: (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k],
};
const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

function boot() {
  setLang(detectLang());
  const canvas = document.getElementById('scene');

  let engine;
  try {
    engine = new Engine(canvas);
  } catch (e) {
    const div = document.createElement('div');
    div.className = 'noscript';
    div.textContent = 'Cosmoscope needs WebGL2, which this browser does not provide. ' + e.message;
    document.body.appendChild(div);
    document.getElementById('welcome').hidden = true;
    return;
  }

  const audio = new AudioEngine();
  const nasa = new NasaClient();

  const state = {
    simMs: Date.now(),
    paused: false,
    speedIdx: 5,
    selected: BODY_INDEX.earth,
    mode: 'orbit',                 /* orbit | free | tour */
    scaleMode: 'showcase',
    showLabels: true,
    showOrbits: true,
    scene: [],
    activityTarget: 0,
    activity: 0,
    neoData: [],
    neoVisualize: false,
    neoRel: [],
  };

  /* camera state */
  const cam = {
    theta: 0.8, phi: 1.15, dist: 1.2,
    vTheta: 0, vPhi: 0,
    pos: [0, 6, 26],
    free: { pos: [0, 3, 9], yaw: Math.PI, pitch: -0.2 },
    flight: null,                  /* {t0, dur, fromPos, fromLook} */
    look: [0, 0, 0],
  };
  const tour = { seq: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], i: 0, phase: 'fly', tPhase: 0 };
  const keys = new Set();

  state.scene = computeScene(state.simMs, state.scaleMode);

  /* deep link: #mars etc. */
  const hashKey = location.hash.replace('#', '');
  if (BODY_INDEX[hashKey] !== undefined) state.selected = BODY_INDEX[hashKey];

  /* ── actions shared with the UI layer ── */
  const app = {
    engine, audio, nasa, state,
    lastFrame: null,
    actions: {
      select(i, fly = false) {
        state.selected = i;
        history.replaceState(null, '', '#' + BODIES[i].key);
        ui.renderBodyList();
        ui.renderBodyCard();
        ui.setSelChip();
        audio.ui('select');
        if (fly || state.mode !== 'free') app.actions.flyTo(i);
      },
      flyTo(i) {
        state.selected = i;
        if (state.mode === 'free') state.mode = 'orbit';
        const st = state.scene[i];
        cam.dist = Math.max(st.radius * 5.5, st.radius + 0.02);
        /* arrive on the sunlit side, offset for three-quarter lighting */
        if (i !== 0) {
          const sunDir = v3.norm(v3.scale(st.pos, -1));
          cam.theta = Math.atan2(sunDir[2], sunDir[0]) + 0.55;
          cam.phi = 1.15;
        }
        cam.flight = {
          t0: performance.now(),
          dur: reduceMotion ? 1 : 1700,
          fromPos: cam.pos.slice(),
          fromLook: cam.look.slice(),
        };
        ui.syncCamSeg();
      },
      setMode(m) {
        if (m === 'free') {
          cam.free.pos = cam.pos.slice();
          const fwd = v3.norm(v3.sub(cam.look, cam.pos));
          cam.free.yaw = Math.atan2(fwd[0], -fwd[2]);
          cam.free.pitch = Math.asin(Math.max(-1, Math.min(1, fwd[1])));
        }
        if (m === 'tour') {
          tour.i = 0; tour.phase = 'fly'; tour.tPhase = performance.now();
          app.actions.select(tour.seq[0], true);
        }
        state.mode = m;
        ui.syncCamSeg();
      },
      togglePause() { state.paused = !state.paused; ui.updatePlayButton(); },
      setNow() { state.simMs = Date.now(); refreshPaths(true); ui.renderBodyCard(); },
      setSpeedIdx(i) {
        state.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i));
        document.getElementById('speed').value = state.speedIdx;
        ui.updateSpeedLabel();
      },
      setScaleMode(m) {
        state.scaleMode = m;
        state.scene = computeScene(state.simMs, m);
        const st = state.scene[state.selected];
        cam.dist = Math.max(st.radius * 5.5, st.radius + 0.02);
        refreshPaths(true);
      },
      setActivity(x) { state.activityTarget = x; },
      refreshNeoPoints() {
        state.neoRel = [];
        if (!state.neoVisualize || !state.neoData.length) return;
        for (const n of state.neoData.slice(0, 40)) {
          /* deterministic pseudo-random direction from the object id */
          let h = 2166136261;
          for (const c of String(n.id)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
          const a = ((h >>> 0) % 6283) / 1000;
          const b = (((h >>> 11) % 2000) / 1000 - 1) * 0.35;
          const lunar = parseFloat(n.close_approach_data?.[0]?.miss_distance?.lunar || 100);
          state.neoRel.push({ dir: [Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)], lunar });
        }
      },
    },
  };

  const ui = initUI(app);
  ui.setSelChip();

  /* ── orbit paths ── */
  let pathsAtMs = 0;
  function refreshPaths(force) {
    if (!force && Math.abs(state.simMs - pathsAtMs) < 45 * 86400000) return;
    pathsAtMs = state.simMs;
    const paths = [];
    for (const b of BODIES) {
      if (b.key === 'sun') continue;
      const pts = orbitPath(b.key, state.simMs, state.scaleMode, b.key === 'moon' ? 96 : 180);
      paths.push({
        points: pts, color: PATH_COLORS[b.key], alpha: b.key === 'moon' ? 0.18 : 0.26,
        /* the Moon's path is Earth-relative; the engine translates it live */
        anchor: b.key === 'moon' ? BODY_INDEX.earth : undefined,
      });
    }
    engine.setPaths(paths);
  }
  refreshPaths(true);

  /* ── labels ── */
  const labelLayer = document.getElementById('labels');
  const labels = BODIES.map((b, i) => {
    const el = document.createElement('div');
    el.className = 'body-label';
    el.textContent = t('body.' + b.key);
    el.addEventListener('click', () => app.actions.select(i, true));
    labelLayer.appendChild(el);
    return el;
  });

  /* ── input: pointer orbit/zoom/pick, pinch, keyboard ── */
  let pointers = new Map();
  let dragInfo = null;
  let pinchDist = 0;

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      dragInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
      canvas.classList.add('dragging');
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchDist = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1 && dragInfo) {
      dragInfo.moved += Math.abs(dx) + Math.abs(dy);
      if (state.mode === 'free') {
        cam.free.yaw -= dx * 0.0035;
        cam.free.pitch = Math.max(-1.5, Math.min(1.5, cam.free.pitch - dy * 0.0035));
      } else {
        if (state.mode === 'tour') app.actions.setMode('orbit');
        cam.vTheta = -dx * 0.0042;
        cam.vPhi = -dy * 0.0042;
        cam.theta += cam.vTheta;
        cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi + cam.vPhi));
        cam.flight = null;
      }
    } else if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
      if (pinchDist > 0) zoomBy(Math.pow(pinchDist / d, 1.5));
      pinchDist = d;
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    canvas.classList.remove('dragging');
    if (dragInfo && pointers.size === 0) {
      const dt = performance.now() - dragInfo.t;
      if (dragInfo.moved < 6 && dt < 400 && app.lastFrame) {
        const idx = engine.pick(e.clientX, e.clientY, app.lastFrame);
        if (idx >= 0) app.actions.select(idx, true);
      }
      dragInfo = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function zoomBy(f) {
    if (state.mode === 'free') {
      const fwd = freeFwd();
      cam.free.pos = v3.add(cam.free.pos, v3.scale(fwd, (1 - f) * v3.len(cam.free.pos) * 0.5));
    } else {
      const st = state.scene[state.selected];
      cam.dist = Math.max(st.radius * 1.35, Math.min(900, cam.dist * f));
      cam.flight = null;
    }
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0011));
  }, { passive: false });

  const DIGIT_MAP = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9, 9: 4 };
  window.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (/^[0-9]$/.test(e.key)) { app.actions.select(DIGIT_MAP[e.key], true); return; }
    switch (k) {
      case ' ': e.preventDefault(); app.actions.togglePause(); break;
      case ',': app.actions.setSpeedIdx(state.speedIdx - 1); break;
      case '.': app.actions.setSpeedIdx(state.speedIdx + 1); break;
      case 'o': app.actions.setMode('orbit'); break;
      case 'f': app.actions.setMode('free'); break;
      case 't': app.actions.setMode(state.mode === 'tour' ? 'orbit' : 'tour'); break;
      case 'l': {
        const cb = document.getElementById('opt-labels');
        cb.checked = !cb.checked; state.showLabels = cb.checked; break;
      }
      case 'p': {
        const cb = document.getElementById('opt-orbits');
        cb.checked = !cb.checked; state.showOrbits = cb.checked; break;
      }
      case 's':
        /* S is also "fly backward" in free mode — never fire a
           multi-second ray-traced export from a flight key */
        if (state.mode !== 'free' && !e.repeat) document.getElementById('btn-shot').click();
        break;
      case 'r':
        if (!e.repeat) document.getElementById('btn-rec').click();
        break;
      case 'h': case '?': {
        const help = document.getElementById('help');
        help.hidden = !help.hidden; break;
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  function freeFwd() {
    const { yaw, pitch } = cam.free;
    return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  }

  /* ── context loss ── */
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    toast(t('toast.contextLost'), 'warn');
  });
  canvas.addEventListener('webglcontextrestored', () => {
    const opt = { ...engine.opt };
    engine = new Engine(canvas);
    engine.setOptions(opt);
    app.engine = engine;
    engine.resize();
    refreshPaths(true);
  });

  /* ── resize ── */
  const doResize = () => engine.resize();
  window.addEventListener('resize', doResize);
  doResize();

  if (reduceMotion) engine.setOptions({ grain: false });

  /* ── main loop ── */
  let lastT = performance.now();
  let fpsFrames = 0, fpsT = lastT, hudT = 0;

  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;

    /* simulation clock */
    if (!state.paused) state.simMs += dt * 1000 * SPEEDS[state.speedIdx];
    state.scene = computeScene(state.simMs, state.scaleMode);
    refreshPaths(false);

    /* tour sequencing */
    if (state.mode === 'tour') {
      const st = state.scene[state.selected];
      cam.theta += dt * 0.07;
      cam.dist = Math.max(st.radius * 5.0, cam.dist);
      if (tour.phase === 'fly' && !cam.flight) {
        tour.phase = 'dwell'; tour.tPhase = now;
        const b = BODIES[tour.seq[tour.i]];
        toast(`${b.glyph} ${t('body.' + b.key)} — ${t('blurb.' + b.key)}`, '', 7000);
      } else if (tour.phase === 'dwell' && now - tour.tPhase > (reduceMotion ? 12000 : 9000)) {
        tour.i = (tour.i + 1) % tour.seq.length;
        tour.phase = 'fly';
        app.actions.select(tour.seq[tour.i], true);
        state.mode = 'tour';       /* select() may keep mode; ensure */
      }
    }

    /* camera */
    const prevPos = cam.pos.slice();
    const selSt = state.scene[state.selected];
    const target = selSt.pos;
    if (state.mode === 'free') {
      const fwd = freeFwd();
      const right = v3.norm(v3.cross(fwd, [0, 1, 0]));
      const speed = (keys.has('shift') ? 6 : 1.6) * Math.max(0.02, v3.len(cam.free.pos) * 0.25) * dt;
      if (keys.has('w')) cam.free.pos = v3.add(cam.free.pos, v3.scale(fwd, speed));
      if (keys.has('s')) cam.free.pos = v3.sub(cam.free.pos, v3.scale(fwd, speed));
      if (keys.has('a')) cam.free.pos = v3.sub(cam.free.pos, v3.scale(right, speed));
      if (keys.has('d')) cam.free.pos = v3.add(cam.free.pos, v3.scale(right, speed));
      if (keys.has('q')) cam.free.pos[1] -= speed;
      if (keys.has('e')) cam.free.pos[1] += speed;
      /* keep out of body interiors */
      for (const st of state.scene) {
        const d = v3.sub(cam.free.pos, st.pos);
        const l = v3.len(d);
        if (l < st.radius * 1.05) cam.free.pos = v3.add(st.pos, v3.scale(v3.norm(d), st.radius * 1.05));
      }
      cam.pos = cam.free.pos.slice();
      cam.look = v3.add(cam.pos, freeFwd());
    } else {
      /* orbit inertia */
      if (!dragInfo) {
        cam.theta += cam.vTheta; cam.vTheta *= 0.92;
        cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi + cam.vPhi));
        cam.vPhi *= 0.92;
      }
      const sp = Math.sin(cam.phi), r = cam.dist;
      const desired = [
        target[0] + r * sp * Math.cos(cam.theta),
        target[1] + r * Math.cos(cam.phi),
        target[2] + r * sp * Math.sin(cam.theta),
      ];
      if (cam.flight) {
        const k = ease(Math.min(1, (now - cam.flight.t0) / cam.flight.dur));
        cam.pos = v3.lerp(cam.flight.fromPos, desired, k);
        cam.look = v3.lerp(cam.flight.fromLook, target, k);
        if (k >= 1) cam.flight = null;
      } else {
        cam.pos = desired;
        cam.look = target.slice();
      }
    }

    /* basis */
    let fwd = v3.norm(v3.sub(cam.look, cam.pos));
    let right = v3.cross(fwd, [0, 1, 0]);
    if (v3.len(right) < 1e-4) right = [1, 0, 0];
    right = v3.norm(right);
    const up = v3.cross(right, fwd);

    /* matrices */
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    const fovY = 50 * Math.PI / 180;
    let nearest = Infinity;
    for (const st of state.scene) nearest = Math.min(nearest, v3.len(v3.sub(cam.pos, st.pos)) - st.radius);
    const near = Math.max(1e-5, nearest * 0.2);
    const vp = mat4Mul(mat4Perspective(fovY, w / h, near, 5000), mat4View(cam.pos, right, up, fwd));

    /* solar activity easing */
    state.activity += (state.activityTarget - state.activity) * Math.min(1, dt * 0.7);

    /* bodies → engine frame */
    const bodies = state.scene.map((st, i) => {
      const b = BODIES[i];
      const tilt = b.tiltDeg * Math.PI / 180;
      return {
        pos: st.pos, radius: st.radius,
        axis: [Math.sin(tilt), Math.cos(tilt), 0],
        spin: st.spin, shaderId: b.shaderId,
        ringInner: st.ringInner || 0, ringOuter: st.ringOuter || 0,
      };
    });

    /* NEO flyby points around Earth (skip the upload when inactive) */
    if (state.neoVisualize && state.neoRel.length) {
      const e = state.scene[BODY_INDEX.earth];
      const arr = new Float32Array(state.neoRel.length * 3);
      state.neoRel.forEach((nrel, i) => {
        const d = e.radius * (2.2 + Math.log10(1 + nrel.lunar) * 2.4);
        arr[i * 3] = e.pos[0] + nrel.dir[0] * d;
        arr[i * 3 + 1] = e.pos[1] + nrel.dir[1] * d;
        arr[i * 3 + 2] = e.pos[2] + nrel.dir[2] * d;
      });
      engine.setPoints(arr);
    } else if (engine.pointCount > 0) {
      engine.setPoints(new Float32Array(0));
    }

    const dist = state.scaleMode === 'true' ? SCENE.trueDist : SCENE.showcaseDist;
    const frameData = {
      camPos: cam.pos, right, up, fwd, fovY, vp,
      timeSec: now / 1000,
      sunActivity: state.activity,
      bodies,
      beltInner: dist(2.2), beltOuter: dist(3.25),
      showOrbits: state.showOrbits,
      showPoints: state.neoVisualize,
    };
    app.lastFrame = frameData;
    if (!engine.exporting) engine.render(frameData);

    /* labels */
    for (let i = 0; i < BODIES.length; i++) {
      const el = labels[i];
      if (!state.showLabels) { el.style.display = 'none'; continue; }
      const st = state.scene[i];
      const p = st.pos;
      const cx = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
      const cy = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
      const cw = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
      const camD = v3.len(v3.sub(cam.pos, p));
      if (cw <= 0 || camD < st.radius * 4) { el.style.display = 'none'; continue; }
      const sx = (cx / cw * 0.5 + 0.5) * w;
      const sy = (1 - (cy / cw * 0.5 + 0.5)) * h;
      if (sx < -60 || sx > w + 60 || sy < 20 || sy > h + 40) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
      const name = t('body.' + BODIES[i].key);
      if (el.textContent !== name) el.textContent = name;
      el.classList.toggle('selected', i === state.selected);
    }

    /* audio spatial cues */
    if (audio.started) {
      const sunD = v3.len(cam.pos);
      const sunR = state.scene[0].radius;
      audio.setSunProximity(Math.min(1, (sunR * 7) / Math.max(sunD, 0.001)));
      const vel = v3.len(v3.sub(cam.pos, prevPos)) / Math.max(dt, 1e-3);
      audio.setSpeed(Math.min(1, vel / (v3.len(cam.pos) * 2 + 4)));
    }

    /* HUD at 4 Hz */
    fpsFrames++;
    if (now - fpsT > 1000) {
      ui.setFps(fpsFrames);
      fpsFrames = 0; fpsT = now;
    }
    if (now - hudT > 250) {
      hudT = now;
      ui.setSimDateText(ui.fmtDate(new Date(state.simMs), {
        dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC',
      }));
      const selD = v3.len(v3.sub(cam.pos, target)) - selSt.radius;
      ui.setCamDist(`Δ ${ui.fmtNum(Math.max(0, selD), 2)}`);
      if (!document.getElementById('body-card').hidden) ui.renderBodyCard();
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* start pulled back, then glide to Earth for a cinematic opening */
  cam.pos = [10, 14, 46];
  cam.look = [0, 0, 0];
  app.actions.flyTo(state.selected);
  cam.flight.dur = reduceMotion ? 1 : 3200;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
