/* ── Cosmoscope · orbits.js ─────────────────────────────────────────
   Real planetary ephemeris: E.M. Standish, "Keplerian Elements for
   Approximate Positions of the Major Planets" (JPL SSD), Table 1,
   valid 1800–2050 AD. Heliocentric J2000 ecliptic coordinates.
   Scene frame: X = ecliptic x, Y = ecliptic north (z), Z = -ecliptic y
   (right-handed, Y-up for rendering).                                */

export const J2000_JD = 2451545.0;
export const AU_KM = 149597870.7;
export const DAY_MS = 86400000;

export function dateToJD(ms) {
  return 2440587.5 + ms / DAY_MS;
}
export function jdToCenturies(jd) {
  return (jd - J2000_JD) / 36525;
}

/* [a(au), e, I(deg), L(deg), longPeri(deg), longNode(deg)] and per-century rates */
export const KEPLER_ELEMENTS = {
  mercury: {
    base: [0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593],
    rate: [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  },
  venus: {
    base: [0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255],
    rate: [0.00000390, -0.00004107, -0.00078890, 58517.81538729, 0.00268329, -0.27769418],
  },
  earth: { /* Earth–Moon barycenter */
    base: [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
    rate: [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  },
  mars: {
    base: [1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    rate: [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  },
  jupiter: {
    base: [5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    rate: [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  },
  saturn: {
    base: [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    rate: [-0.00125060, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  },
  uranus: {
    base: [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503],
    rate: [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  },
  neptune: {
    base: [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    rate: [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  },
};

const DEG = Math.PI / 180;

export function solveKepler(M, e) {
  /* M, E in radians. Newton–Raphson, converges fast for e < 0.25 */
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 10; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

function wrapAngle(rad) {
  const twoPi = Math.PI * 2;
  return rad - twoPi * Math.floor((rad + Math.PI) / twoPi);
}

/* Heliocentric position of a planet in au, J2000 ecliptic frame.
   Returns [xEcl, yEcl, zEcl]. */
export function heliocentric(planetKey, T) {
  const el = KEPLER_ELEMENTS[planetKey];
  const a = el.base[0] + el.rate[0] * T;
  const e = el.base[1] + el.rate[1] * T;
  const I = (el.base[2] + el.rate[2] * T) * DEG;
  const L = (el.base[3] + el.rate[3] * T) * DEG;
  const lp = (el.base[4] + el.rate[4] * T) * DEG;
  const ln = (el.base[5] + el.rate[5] * T) * DEG;

  const w = lp - ln;             /* argument of perihelion */
  const M = wrapAngle(L - lp);   /* mean anomaly */
  const E = solveKepler(M, e);

  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(w), sw = Math.sin(w);
  const cI = Math.cos(I), sI = Math.sin(I);
  const cn = Math.cos(ln), sn = Math.sin(ln);

  const xEcl = (cw * cn - sw * sn * cI) * xp + (-sw * cn - cw * sn * cI) * yp;
  const yEcl = (cw * sn + sw * cn * cI) * xp + (-sw * sn + cw * cn * cI) * yp;
  const zEcl = (sw * sI) * xp + (cw * sI) * yp;
  return [xEcl, yEcl, zEcl];
}

/* Moon: simplified Keplerian orbit around Earth (good to ~a degree —
   plenty for visualization). a in au. */
const MOON = {
  a: 384400 / AU_KM,
  e: 0.0549,
  i: 5.145 * DEG,
  periodDays: 27.321661,
  nodePeriodYears: -18.6,   /* nodal regression */
  perigeePeriodYears: 8.85, /* apsidal precession */
  L0: 218.316 * DEG,        /* mean longitude at J2000 */
  P0: 83.353 * DEG,         /* mean longitude of perigee at J2000 */
  N0: 125.045 * DEG,        /* mean longitude of node at J2000 */
};

export function moonGeocentric(T) {
  const d = T * 36525; /* days since J2000 */
  const L = MOON.L0 + (2 * Math.PI / MOON.periodDays) * d;
  const P = MOON.P0 + (2 * Math.PI / (MOON.perigeePeriodYears * 365.25)) * d;
  const N = MOON.N0 + (2 * Math.PI / (MOON.nodePeriodYears * 365.25)) * d;
  const M = wrapAngle(L - P);
  const w = P - N;
  const E = solveKepler(M, MOON.e);
  const xp = MOON.a * (Math.cos(E) - MOON.e);
  const yp = MOON.a * Math.sqrt(1 - MOON.e * MOON.e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w);
  const cI = Math.cos(MOON.i), sI = Math.sin(MOON.i);
  const cn = Math.cos(N), sn = Math.sin(N);
  return [
    (cw * cn - sw * sn * cI) * xp + (-sw * cn - cw * sn * cI) * yp,
    (cw * sn + sw * cn * cI) * xp + (-sw * sn + cw * cn * cI) * yp,
    (sw * sI) * xp + (cw * sI) * yp,
  ];
}

/* ── Physical data ──────────────────────────────────────────────────
   Equatorial radii, obliquity and sidereal rotation from the NSSDC
   planetary fact sheets (nssdc.gsfc.nasa.gov/planetary/factsheet).
   Negative rotation = retrograde.                                   */
export const BODIES = [
  { key: 'sun',     glyph: '☉', radiusKm: 695700,   tiltDeg: 7.25,   rotHours: 609.12,  shaderId: 0 },
  { key: 'mercury', glyph: '☿', radiusKm: 2440.5,   tiltDeg: 0.034,  rotHours: 1407.6,  shaderId: 1 },
  { key: 'venus',   glyph: '♀', radiusKm: 6051.8,   tiltDeg: 177.36, rotHours: -5832.6, shaderId: 2 },
  { key: 'earth',   glyph: '⊕', radiusKm: 6378.137, tiltDeg: 23.44,  rotHours: 23.9345, shaderId: 3 },
  { key: 'moon',    glyph: '☾', radiusKm: 1738.1,   tiltDeg: 6.68,   rotHours: 655.72,  shaderId: 4, parent: 'earth' },
  { key: 'mars',    glyph: '♂', radiusKm: 3396.2,   tiltDeg: 25.19,  rotHours: 24.6229, shaderId: 5 },
  { key: 'jupiter', glyph: '♃', radiusKm: 71492,    tiltDeg: 3.13,   rotHours: 9.925,   shaderId: 6 },
  { key: 'saturn',  glyph: '♄', radiusKm: 60268,    tiltDeg: 26.73,  rotHours: 10.656,  shaderId: 7,
    /* NSSDC Saturnian Rings Fact Sheet: C-ring inner → A-ring outer */
    ringInnerKm: 74658, ringOuterKm: 136780 },
  { key: 'uranus',  glyph: '♅', radiusKm: 25559,    tiltDeg: 97.77,  rotHours: -17.24,  shaderId: 8 },
  { key: 'neptune', glyph: '♆', radiusKm: 24764,    tiltDeg: 28.32,  rotHours: 16.11,   shaderId: 9 },
];

export const BODY_INDEX = Object.fromEntries(BODIES.map((b, i) => [b.key, i]));

/* Sidereal orbital period in Earth years, from Kepler's third law */
export function orbitalPeriodYears(key) {
  if (key === 'sun') return 0;
  if (key === 'moon') return MOON.periodDays / 365.25;
  const a = KEPLER_ELEMENTS[key].base[0];
  return Math.pow(a, 1.5);
}

/* ── Scene scaling ──────────────────────────────────────────────────
   Scene unit: showcase mode puts Earth's orbit at 6 units and inflates
   radii on a square-root curve so every world is visible at once.
   True mode: 1 au = 6 units, radii to real proportion.             */
export const SCENE = {
  AU_UNITS: 6,
  showcaseDist(au) { return au <= 0 ? 0 : 6 * Math.pow(au, 0.55); },
  showcaseRadius(km) { return 0.05 * Math.sqrt(km / 6371); },
  trueDist(au) { return 6 * au; },
  trueRadius(km) { return 6 * (km / AU_KM); },
};

function scaleVec(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }

/* Ecliptic [x,y,z] → scene Y-up [x, z, -y] */
function toScene(v) { return [v[0], v[2], -v[1]]; }

/* Compute all body states for a given date.
   Returns array aligned with BODIES:
   { pos:[x,y,z] scene units, radius, spin (rad), distAu, ringInner, ringOuter } */
export function computeScene(dateMs, mode) {
  const T = jdToCenturies(dateToJD(dateMs));
  const showcase = mode !== 'true';
  const dist = showcase ? SCENE.showcaseDist : SCENE.trueDist;
  const radius = showcase ? SCENE.showcaseRadius : SCENE.trueRadius;
  const hours = (dateMs - Date.UTC(2000, 0, 1, 12)) / 3600000;

  const out = [];
  let earthScene = [0, 0, 0];
  let earthEcl = [0, 0, 0];

  for (const b of BODIES) {
    const spin = (b.rotHours ? (hours / b.rotHours) * 2 * Math.PI : 0) % (2 * Math.PI);
    if (b.key === 'sun') {
      out.push({ pos: [0, 0, 0], radius: showcase ? 0.62 : radius(b.radiusKm), spin, distAu: 0 });
      continue;
    }
    if (b.key === 'moon') {
      const g = moonGeocentric(T);
      const gAu = Math.hypot(g[0], g[1], g[2]);
      let moonScene;
      if (showcase) {
        /* keep the Moon outside a visibly-inflated Earth */
        const eR = radius(6378.137);
        const sep = eR * 3.4;
        moonScene = [
          earthScene[0] + toScene(g)[0] / gAu * sep,
          earthScene[1] + toScene(g)[1] / gAu * sep,
          earthScene[2] + toScene(g)[2] / gAu * sep,
        ];
      } else {
        const gs = toScene(scaleVec(g, SCENE.AU_UNITS));
        moonScene = [earthScene[0] + gs[0], earthScene[1] + gs[1], earthScene[2] + gs[2]];
      }
      const dSun = Math.hypot(earthEcl[0] + g[0], earthEcl[1] + g[1], earthEcl[2] + g[2]);
      out.push({ pos: moonScene, radius: radius(b.radiusKm), spin, distAu: dSun });
      continue;
    }
    const ecl = heliocentric(b.key, T);
    const dAu = Math.hypot(ecl[0], ecl[1], ecl[2]);
    const s = toScene(scaleVec(ecl, dist(dAu) / dAu));
    const st = { pos: s, radius: radius(b.radiusKm), spin, distAu: dAu };
    if (b.ringInnerKm) {
      const rr = showcase ? radius(b.radiusKm) / b.radiusKm : 6 / AU_KM;
      st.ringInner = b.ringInnerKm * (showcase ? radius(b.radiusKm) / b.radiusKm : rr);
      st.ringOuter = b.ringOuterKm * (showcase ? radius(b.radiusKm) / b.radiusKm : rr);
    }
    if (b.key === 'earth') { earthScene = s; earthEcl = ecl; }
    out.push(st);
  }
  return out;
}

/* Orbit path polyline for a planet (scene units), n segments.
   Sampled over one full period around the current date so paths follow
   the real (slowly precessing) ellipse. */
export function orbitPath(key, dateMs, mode, n = 180) {
  if (key === 'sun') return null;
  const pts = new Float32Array((n + 1) * 3);
  const showcase = mode !== 'true';
  const dist = showcase ? SCENE.showcaseDist : SCENE.trueDist;

  if (key === 'moon') {
    /* draw around current Earth position */
    const T0 = jdToCenturies(dateToJD(dateMs));
    const eEcl = heliocentric('earth', T0);
    const dAu = Math.hypot(eEcl[0], eEcl[1], eEcl[2]);
    const e = toScene(scaleVec(eEcl, dist(dAu) / dAu));
    const eR = showcase ? SCENE.showcaseRadius(6378.137) : 0;
    const periodMs = MOON.periodDays * DAY_MS;
    for (let i = 0; i <= n; i++) {
      const T = jdToCenturies(dateToJD(dateMs + (i / n) * periodMs));
      const g = moonGeocentric(T);
      let p;
      if (showcase) {
        const gAu = Math.hypot(g[0], g[1], g[2]);
        const sep = eR * 3.4;
        const gs = toScene(g);
        p = [e[0] + gs[0] / gAu * sep, e[1] + gs[1] / gAu * sep, e[2] + gs[2] / gAu * sep];
      } else {
        const gs = toScene(scaleVec(g, SCENE.AU_UNITS));
        p = [e[0] + gs[0], e[1] + gs[1], e[2] + gs[2]];
      }
      pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2];
    }
    return pts;
  }

  const periodMs = orbitalPeriodYears(key) * 365.25 * DAY_MS;
  for (let i = 0; i <= n; i++) {
    const T = jdToCenturies(dateToJD(dateMs + (i / n) * periodMs));
    const ecl = heliocentric(key, T);
    const dAu = Math.hypot(ecl[0], ecl[1], ecl[2]);
    const p = toScene(scaleVec(ecl, dist(dAu) / dAu));
    pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2];
  }
  return pts;
}

/* Distance Earth ↔ body in au, for the facts panel */
export function distanceFromEarthAu(key, dateMs) {
  const T = jdToCenturies(dateToJD(dateMs));
  if (key === 'earth') return 0;
  const e = heliocentric('earth', T);
  if (key === 'sun') return Math.hypot(e[0], e[1], e[2]);
  if (key === 'moon') {
    const g = moonGeocentric(T);
    return Math.hypot(g[0], g[1], g[2]);
  }
  const p = heliocentric(key, T);
  return Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
}
