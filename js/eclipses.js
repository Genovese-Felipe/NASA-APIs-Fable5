/* ── Cosmoscope · eclipses.js ───────────────────────────────────────
   Finds solar and lunar eclipses from first principles: geocentric
   Sun (JPL/Standish elements, Earth–Moon barycentre corrected, annual
   aberration) and Moon (ELP-2000/82, lunar.js), both in the equator
   and equinox of date. Solar eclipses use the Moon's shadow cones and
   a WGS-84 ellipsoid; lunar eclipses use Earth's shadow with Danjon's
   enlargement. Results are checked in tests/unit/eclipses.test.mjs
   against NASA's Five Millennium Canon (Espenak & Meeus).          */

import { heliocentric } from './orbits.js';
import { moonEclipticOfDate, moonJ2000Km, precessEcliptic, meanObliquity, gmstDeg, deltaT, jdFromMs } from './lunar.js';

const RAD = Math.PI / 180;
const AU = 149597870.7;
const R_SUN = 696000;            /* km — NASA canon value */
const EARTH_A = 6378.137;        /* WGS-84 equatorial radius, km */
const K_MOON = 0.2725076;        /* IAU lunar radius in Earth radii: penumbral contacts */
const K_UMBRA = 0.272281;        /* NASA's smaller k for umbral/antumbral contacts (mean limb valleys) */
const R_MOON = K_MOON * EARTH_A;     /* 1738.1 km */
const R_MOON_U = K_UMBRA * EARTH_A;  /* 1736.6 km */
const EARTH_F = 1 / 298.257223563;
const EARTH_B = EARTH_A * (1 - EARTH_F);
const EARTH_E2 = EARTH_F * (2 - EARTH_F);
const MU = 1 / (1 + 81.30056);   /* Moon mass fraction of the Earth–Moon system */
const SYNODIC = 29.530588861;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export const jdToMs = (jd) => (jd - 2440587.5) * 86400000;
export const dtSeconds = (jd) => deltaT(2000 + (jd - 2451545.0) / 365.25);

function eclToEq(lonDeg, latDeg, r, epsDeg) {
  const l = lonDeg * RAD, b = latDeg * RAD, e = epsDeg * RAD;
  const x = Math.cos(b) * Math.cos(l), y = Math.cos(b) * Math.sin(l), z = Math.sin(b);
  return [r * x, r * (Math.cos(e) * y - Math.sin(e) * z), r * (Math.sin(e) * y + Math.cos(e) * z)];
}

/* Geocentric apparent Sun and geometric Moon, equator of date, km. */
export function sunMoon(jdTT) {
  const T = (jdTT - 2451545.0) / 36525;
  const eps = meanObliquity(jdTT);
  /* Moon */
  const m = moonEclipticOfDate(jdTT);
  const M = eclToEq(m.lon, m.lat, m.dist, eps);
  /* Sun: Earth centre = barycentre − μ·Moon, all in J2000 ecliptic */
  const emb = heliocentric('earth', T);
  const msUT = jdToMs(jdTT - dtSeconds(jdTT) / 86400);
  const mk = moonJ2000Km(msUT);
  const ex = emb[0] * AU - MU * mk[0], ey = emb[1] * AU - MU * mk[1], ez = emb[2] * AU - MU * mk[2];
  const rS = Math.hypot(ex, ey, ez);
  const lonJ = Math.atan2(-ey, -ex) / RAD, latJ = Math.asin(-ez / rS) / RAD;
  const sd = precessEcliptic(lonJ, latJ, 2451545.0, jdTT);
  const aberr = -20.4898 / 3600 / (rS / AU);
  const S = eclToEq(sd.lon + aberr, sd.lat, rS, eps);
  return { S, M };
}

/* ── Earth model ── */
export function geodeticToEcef(latDeg, lonDeg) {
  const p = latDeg * RAD, l = lonDeg * RAD;
  const N = EARTH_A / Math.sqrt(1 - EARTH_E2 * Math.sin(p) ** 2);
  return [N * Math.cos(p) * Math.cos(l), N * Math.cos(p) * Math.sin(l), N * (1 - EARTH_E2) * Math.sin(p)];
}
function ecefToGeodetic(v) {
  const lon = Math.atan2(v[1], v[0]) / RAD;
  const lat = Math.atan2(v[2], (1 - EARTH_F) ** 2 * Math.hypot(v[0], v[1])) / RAD;
  return { lat, lon };
}
function eqToEcef(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * v[0] + s * v[1], -s * v[0] + c * v[1], v[2]];
}
function ecefToEq(v, theta) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}
const thetaAt = (jdTT) => gmstDeg(jdTT - dtSeconds(jdTT) / 86400) * RAD;

/* First intersection of the line P0 + s·u with the ellipsoid (s ≥ 0). */
function hitEllipsoid(P0, u) {
  const k = EARTH_A / EARTH_B;
  const p = [P0[0], P0[1], P0[2] * k], d = [u[0], u[1], u[2] * k];
  const A = dot(d, d), Bq = 2 * dot(p, d), C = dot(p, p) - EARTH_A * EARTH_A;
  const disc = Bq * Bq - 4 * A * C;
  if (disc < 0) return null;
  const s = (-Bq - Math.sqrt(disc)) / (2 * A);
  if (s < 0) return null;
  return add(P0, mul(u, s));
}

/* ── solar geometry at one instant ── */
function solarGeom(jdTT) {
  const { S, M } = sunMoon(jdTT);
  const D = len(sub(S, M));
  const a = unit(sub(M, S));                 /* shadow axis, Moon → away from Sun */
  const s0 = -dot(M, a);                     /* Moon → fundamental plane through Earth's centre */
  const Pc = add(M, mul(a, s0));             /* axis point closest to Earth's centre */
  const north = unit(sub([0, 0, 1], mul(a, a[2])));
  const gamma = Math.sign(dot(Pc, north) || 1) * len(Pc) / EARTH_A;
  const L1 = (s) => R_MOON + s * (R_SUN + R_MOON) / D;  /* penumbra radius */
  const L2 = (s) => R_MOON_U - s * (R_SUN - R_MOON_U) / D;  /* umbra (+) / antumbra (−) */
  return { S, M, a, D, s0, Pc, gamma, L1, L2 };
}

function minimize(f, a, b, tol = 1e-7) {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
  while (b - a > tol) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}
function bisect(f, a, b, n = 50) {
  let fa = f(a);
  for (let i = 0; i < n; i++) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

/* Central-line point, local umbra radius and cross-track width at jdTT. */
function centralPoint(jdTT) {
  const g = solarGeom(jdTT);
  const hit = hitEllipsoid(g.M, g.a);
  if (!hit) return null;
  const s = dot(sub(hit, g.M), g.a);
  const th = thetaAt(jdTT);
  return { g, hit, s, l2: g.L2(s), ecef: eqToEcef(hit, th), th };
}

/* Duration of the central phase for an observer fixed on the ground. */
function centralDuration(jdG, ecefObs) {
  const f = (jd) => {
    const g = solarGeom(jd);
    const P = ecefToEq(ecefObs, thetaAt(jd));
    const o = sub(P, g.M);
    const s = dot(o, g.a);
    return len(sub(o, mul(g.a, s))) - Math.abs(g.L2(s));
  };
  if (f(jdG) > 0) return 0;
  const span = 12 / 1440;
  const t1 = bisect(f, jdG - span, jdG), t2 = bisect(f, jdG, jdG + span);
  return (t2 - t1) * 86400;
}

/* Ground track: central line with northern/southern limits. */
export function solarPath(jdG, stepMin = 2, spanH = 4) {
  const pts = [];
  for (let k = -spanH * 60; k <= spanH * 60; k += stepMin) {
    const jd = jdG + k / 1440;
    const c = centralPoint(jd);
    if (!c) continue;
    pts.push({ jd, c });
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const { jd, c } = pts[i];
    const nb = pts[Math.min(i + 1, pts.length - 1)].c, pb = pts[Math.max(i - 1, 0)].c;
    const track = unit(sub(nb.ecef, pb.ecef).every((x) => x === 0) ? [1, 0, 0] : sub(nb.ecef, pb.ecef));
    const N = unit(c.ecef);
    const cx = unit(cross(N, track));
    const aE = eqToEcef(c.g.a, c.th);
    /* the umbral footprint is the axis-aligned cylinder cut by the ground
       plane — an ellipse; its limits are that ellipse's support width
       perpendicular to the track */
    const w = sub(cx, mul(N, dot(aE, cx) / dot(aE, N)));
    const half = Math.abs(c.l2) * len(sub(w, mul(aE, dot(w, aE))));
    const lim = (sgn) => ecefToGeodetic(add(c.ecef, mul(cx, sgn * half)));
    out.push({
      jd, center: ecefToGeodetic(c.ecef), north: lim(1), south: lim(-1),
      widthKm: 2 * half, total: c.l2 > 0,
    });
  }
  return out;
}

/* Obscuration (fraction of the Sun's diameter covered) seen from a
   ground point; 0 when the Sun is below the horizon. */
export function localSolar(jdTT, ecefObs, cache, ignoreHorizon = false) {
  const sm = cache || sunMoon(jdTT);
  const P = ecefToEq(ecefObs, thetaAt(jdTT));
  const toS = sub(sm.S, P), toM = sub(sm.M, P);
  const up = unit(P);
  const alt = Math.asin(dot(unit(toS), up));
  if (!ignoreHorizon && alt < -0.0145) return { mag: 0, alt, total: false, annular: false };
  const ds = len(toS), dm = len(toM);
  const rs = Math.asin(R_SUN / ds), rm = Math.asin(R_MOON / dm), ru = Math.asin(R_MOON_U / dm);
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(toS, toM) / (ds * dm))));
  const mag = Math.max(0, (rs + rm - sep) / (2 * rs));
  return { mag, alt, total: ru > rs && sep < ru - rs, annular: ru < rs && sep < rs - ru };
}

function analyseSolar(jdNear) {
  /* true syzygy can sit up to ≈0.59 d from the mean phase: search ±0.9 d */
  const jdG = minimize((jd) => Math.abs(solarGeom(jd).gamma), jdNear - 0.9, jdNear + 0.9);
  const g = solarGeom(jdG);
  const gAbs = Math.abs(g.gamma);
  const l1 = g.L1(g.s0) / EARTH_A, l2 = g.L2(g.s0) / EARTH_A;
  /* Earth's outline in the fundamental plane is an ellipse squashed along
     the projected pole: stretch the axis offset's north component by 1/ρ */
  const north = unit(sub([0, 0, 1], mul(g.a, g.a[2])));
  const yN = dot(g.Pc, north) / EARTH_A, xE = Math.sqrt(Math.max(0, gAbs * gAbs - yN * yN));
  const rho = Math.sqrt(1 - EARTH_E2 * (1 - g.a[2] * g.a[2]));
  if (Math.hypot(xE, yN / rho) > 1 + l1) return null;
  const res = { kind: 'solar', jdTT: jdG, gamma: g.gamma };
  const c = centralPoint(jdG);
  if (c) {
    const ge = ecefToGeodetic(c.ecef);
    const ls = localSolar(jdG, c.ecef);
    const P = c.hit;
    const dm = len(sub(g.M, P)), ds = len(sub(g.S, P));
    res.magnitude = (R_MOON_U / dm) / (R_SUN / ds);
    res.ge = ge;
    res.sunAltDeg = ls.alt / RAD;
    res.durationS = centralDuration(jdG, c.ecef);
    const near = solarPath(jdG, 1, 1 / 60);
    const mid = near.find((p) => Math.abs(p.jd - jdG) < 1e-9);
    res.widthKm = mid ? mid.widthKm : 0;
    /* hybrid stretches can be seconds long at the very ends of the path:
       sample the track and also its exact first and last instants */
    const onEarth = (jd) => (centralPoint(jd) ? 1 : -1);
    const tBeg = bisect(onEarth, jdG - 0.2, jdG), tEnd = bisect(onEarth, jdG, jdG + 0.2);
    const edge = 1 / 86400;
    const totalAt = solarPath(jdG, 4, 4).map((p) => p.total);
    for (const jd of [tBeg + edge, tEnd - edge]) {
      const ce = centralPoint(jd);
      if (ce) totalAt.push(ce.l2 > 0);
    }
    const allT = totalAt.every(Boolean), allA = totalAt.every((t) => !t);
    res.type = allT ? 'total' : allA ? 'annular' : 'hybrid';
  } else {
    /* partial: magnitude at the point of Earth closest to the axis */
    /* greatest eclipse: the point of Earth's surface closest to the axis,
       where the Sun sits on the horizon — magnitude measured right there */
    const P = mul(unit(g.Pc), EARTH_A);
    const ecef = eqToEcef(P, thetaAt(jdG));
    res.ge = ecefToGeodetic(ecef);
    res.magnitude = localSolar(jdG, geodeticToEcef(res.ge.lat, res.ge.lon), null, true).mag;
    res.type = gAbs < 1 + Math.abs(l2) ? (l2 > 0 ? 'total' : 'annular') : 'partial';
    res.durationS = 0;
  }
  return res;
}

/* ── lunar eclipses ── */
function lunarGeom(jdTT) {
  const { S, M } = sunMoon(jdTT);
  const dm = len(M), ds = len(S);
  const anti = mul(unit(S), -1);
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(anti, unit(M)))));
  const pim = Math.asin(EARTH_A / dm), pis = Math.asin(EARTH_A / ds);
  const ss = Math.asin(R_SUN / ds), sm = Math.asin(K_MOON * EARTH_A / dm);
  /* Danjon: Earth's radius enlarged by the atmosphere, 1/85 of the
     parallax, on a mean radius that accounts for Earth's flattening */
  const enl = (1 + 1 / 85) * (1 - EARTH_F / 2);
  const rhoU = enl * pim - ss + pis, rhoP = enl * pim + ss + pis;
  const north = unit(sub([0, 0, 1], mul(anti, anti[2])));
  const sign = Math.sign(dot(unit(M), north) || 1);
  return { M, anti, sep, sm, rhoU, rhoP, gamma: sign * Math.sin(sep) * dm / EARTH_A };
}

function analyseLunar(jdNear) {
  const jdG = minimize((jd) => lunarGeom(jd).sep, jdNear - 0.9, jdNear + 0.9);
  const g = lunarGeom(jdG);
  const pen = (g.rhoP + g.sm - g.sep) / (2 * g.sm);
  const umb = (g.rhoU + g.sm - g.sep) / (2 * g.sm);
  if (pen <= 0) return null;
  const contact = (fn) => {
    if (fn(jdG) >= 0) return 0;
    const t1 = bisect(fn, jdG - 0.3, jdG), t2 = bisect(fn, jdG, jdG + 0.3);
    return (t2 - t1) * 86400;
  };
  const th = thetaAt(jdG);
  const zen = ecefToGeodetic(eqToEcef(unit(g.M), th));
  return {
    kind: 'lunar', jdTT: jdG, gamma: g.gamma,
    type: umb >= 1 ? 'total' : umb > 0 ? 'partial' : 'penumbral',
    umbral: umb, penumbral: pen,
    durPenS: contact((jd) => { const q = lunarGeom(jd); return q.sep - (q.rhoP + q.sm); }),
    durParS: contact((jd) => { const q = lunarGeom(jd); return q.sep - (q.rhoU + q.sm); }),
    durTotS: contact((jd) => { const q = lunarGeom(jd); return q.sep - (q.rhoU - q.sm); }),
    zenith: { lat: Math.asin(unit(g.M)[2]) / RAD, lon: zen.lon },
  };
}

/* All eclipses between two UTC instants, sorted by time. */
export function findEclipses(fromMs, toMs) {
  const jd0 = jdFromMs(fromMs), jd1 = jdFromMs(toMs);
  const k0 = Math.floor((jd0 - 2451550.09766) / SYNODIC) - 1;
  const out = [];
  for (let k = k0; ; k++) {
    const jdNew = 2451550.09766 + SYNODIC * k;
    if (jdNew > jd1 + 30) break;
    for (const [jdApprox, fn] of [[jdNew, analyseSolar], [jdNew + SYNODIC / 2, analyseLunar]]) {
      const e = fn(jdApprox);
      if (!e) continue;
      e.utMs = jdToMs(e.jdTT - dtSeconds(e.jdTT) / 86400);
      e.tdMs = jdToMs(e.jdTT);
      if (e.utMs >= fromMs && e.utMs <= toMs) out.push(e);
    }
  }
  return out.sort((a, b) => a.jdTT - b.jdTT);
}

/* ── views for the Eclipse Lab ── */

/* Sun and Moon disks as seen from a ground point: angular radii and
   the Moon's offset from the Sun (radians; x east, y north). */
export function solarDiskView(jdTT, ecefObs) {
  const sm = sunMoon(jdTT);
  const P = ecefToEq(ecefObs, thetaAt(jdTT));
  const toS = sub(sm.S, P), toM = sub(sm.M, P);
  const s = unit(toS), mu = unit(toM);
  const e1 = unit(cross([0, 0, 1], s)), e2 = cross(s, e1);
  const k = 1 / dot(mu, s);
  return {
    rs: Math.asin(R_SUN / len(toS)), rm: Math.asin(R_MOON_U / len(toM)),
    dx: dot(mu, e1) * k, dy: dot(mu, e2) * k, alt: Math.asin(dot(s, unit(P))),
  };
}

/* The Moon against Earth's shadow, seen from Earth's centre. */
export function lunarShadowView(jdTT) {
  const g = lunarGeom(jdTT);
  const e1 = unit(cross([0, 0, 1], g.anti)), e2 = cross(g.anti, e1);
  const mu = unit(g.M), k = 1 / dot(mu, g.anti);
  return { rhoU: g.rhoU, rhoP: g.rhoP, sm: g.sm, dx: dot(mu, e1) * k, dy: dot(mu, e2) * k };
}

/* Where the shadow axis meets the ground right now (null if it misses). */
export function axisGround(jdTT) {
  const c = centralPoint(jdTT);
  return c ? { ...ecefToGeodetic(c.ecef), total: c.l2 > 0 } : null;
}

/* Moon altitude (radians) from a ground point; pass sunMoon(jd) as cache. */
export function moonAltitude(jdTT, ecefObs, cache) {
  const sm = cache || sunMoon(jdTT);
  const P = ecefToEq(ecefObs, thetaAt(jdTT));
  return Math.asin(dot(unit(sub(sm.M, P)), unit(P)));
}
