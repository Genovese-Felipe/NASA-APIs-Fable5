/* ── Cosmoscope · lunar.js ──────────────────────────────────────────
   The Moon from the truncated ELP-2000/82 lunar theory as published
   in J. Meeus, "Astronomical Algorithms" (2nd ed.), chapter 47:
   ~10" in longitude and ~4" in latitude — enough to predict eclipses
   to within a minute or so. Also: ΔT (TT − UT), ecliptic precession
   (Meeus 21.7), obliquity and Greenwich mean sidereal time.        */

const D2R = Math.PI / 180;
const ARCSEC = D2R / 3600;

/* Table 47.A — D, M, M', F, Σl (1e-6 °), Σr (1e-3 km) */
const LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
];

/* Table 47.B — D, M, M', F, Σb (1e-6 °) */
const B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
];

function norm360(x) { x %= 360; return x < 0 ? x + 360 : x; }

/* Geocentric Moon, mean ecliptic & equinox OF DATE (no nutation).
   jdTT: Julian Ephemeris Day. Returns { lon, lat } in degrees, dist km. */
export function moonEclipticOfDate(jdTT) {
  const T = (jdTT - 2451545.0) / 36525;
  const T2 = T * T, T3 = T2 * T, T4 = T3 * T;
  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2 + T3 / 538841 - T4 / 65194000);
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2 + T3 / 545868 - T4 / 113065000);
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000);
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2 + T3 / 69699 - T4 / 14712000);
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2 - T3 / 3526000 + T4 / 863310000);
  const A1 = norm360(119.75 + 131.849 * T);
  const A2 = norm360(53.09 + 479264.290 * T);
  const A3 = norm360(313.45 + 481266.484 * T);
  const E = 1 - 0.002516 * T - 0.0000074 * T2;
  const E2 = E * E;

  let sl = 0, sr = 0, sb = 0;
  for (const [d, m, mp, f, cl, cr] of LR) {
    const arg = (d * D + m * M + mp * Mp + f * F) * D2R;
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E2);
    sl += cl * e * Math.sin(arg);
    sr += cr * e * Math.cos(arg);
  }
  for (const [d, m, mp, f, cb] of B) {
    const arg = (d * D + m * M + mp * Mp + f * F) * D2R;
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E2);
    sb += cb * e * Math.sin(arg);
  }
  sl += 3958 * Math.sin(A1 * D2R) + 1962 * Math.sin((Lp - F) * D2R) + 318 * Math.sin(A2 * D2R);
  sb += -2235 * Math.sin(Lp * D2R) + 382 * Math.sin(A3 * D2R)
      + 175 * Math.sin((A1 - F) * D2R) + 175 * Math.sin((A1 + F) * D2R)
      + 127 * Math.sin((Lp - Mp) * D2R) - 115 * Math.sin((Lp + Mp) * D2R);

  return {
    lon: norm360(Lp + sl / 1e6),
    lat: sb / 1e6,
    dist: 385000.56 + sr / 1000,
  };
}

/* Ecliptic precession between two epochs (Meeus 21.7). Angles in degrees. */
export function precessEcliptic(lonDeg, latDeg, jdFrom, jdTo) {
  const T = (jdFrom - 2451545.0) / 36525;
  const t = (jdTo - jdFrom) / 36525;
  const eta = ((47.0029 - 0.06603 * T + 0.000598 * T * T) * t
    + (-0.03302 + 0.000598 * T) * t * t + 0.000060 * t * t * t) * ARCSEC;
  const Pi = 174.876384 * D2R + ((3289.4789 * T + 0.60622 * T * T)
    - (869.8089 + 0.50491 * T) * t + 0.03536 * t * t) * ARCSEC;
  const p = ((5029.0966 + 2.22226 * T - 0.000042 * T * T) * t
    + (1.11113 - 0.000042 * T) * t * t - 0.000006 * t * t * t) * ARCSEC;
  const lam = lonDeg * D2R, bet = latDeg * D2R;
  const A = Math.cos(eta) * Math.cos(bet) * Math.sin(Pi - lam) - Math.sin(eta) * Math.sin(bet);
  const Bv = Math.cos(bet) * Math.cos(Pi - lam);
  const C = Math.cos(eta) * Math.sin(bet) + Math.sin(eta) * Math.cos(bet) * Math.sin(Pi - lam);
  return {
    lon: norm360((p + Pi - Math.atan2(A, Bv)) / D2R),
    lat: Math.asin(Math.max(-1, Math.min(1, C))) / D2R,
  };
}

/* Mean obliquity of the ecliptic of date (Meeus 22.2), degrees. */
export function meanObliquity(jdTT) {
  const T = (jdTT - 2451545.0) / 36525;
  return 23.439291111 - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
}

/* Greenwich mean sidereal time (Meeus 12.4), degrees. jdUT: UT1 Julian Day. */
export function gmstDeg(jdUT) {
  const T = (jdUT - 2451545.0) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jdUT - 2451545.0)
    + 0.000387933 * T * T - T * T * T / 38710000);
}

/* ΔT = TT − UT in seconds. Observed values 1990–2025 (IERS); elsewhere
   the Espenak–Meeus piecewise polynomials (NASA, "Polynomial Expressions
   for Delta T"). 2025–2050 eases from the observed ≈69 s plateau into the
   2050–2150 expression so the curve is continuous in value and slope.  */
const DT_TABLE = [
  [1990, 56.86], [1995, 60.78], [2000, 63.83], [2005, 64.69], [2010, 66.07],
  [2015, 67.64], [2020, 69.36], [2025, 69.20],
];
const dtFar = (year) => { const u = (year - 1820) / 100; return -20 + 32 * u * u; };
const dt2050 = (year) => dtFar(year) - 0.5628 * (2150 - year);
export function deltaT(year) {
  let t, u;
  if (year >= 1990 && year <= 2025) {
    for (let i = 0; i < DT_TABLE.length - 1; i++) {
      const [y0, v0] = DT_TABLE[i], [y1, v1] = DT_TABLE[i + 1];
      if (year <= y1) return v0 + (v1 - v0) * (year - y0) / (y1 - y0);
    }
  }
  if (year > 2025 && year < 2050) {
    const s = (year - 2025) / 25;
    return 69.2 + (dt2050(2050) - 69.2) * s * s;
  }
  if (year >= 2050 && year <= 2150) return dt2050(year);
  if (year > 2150 || year < -500) return dtFar(year);
  if (year >= 1986) { t = year - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (year >= 1961) { t = year - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (year >= 1941) { t = year - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (year >= 1920) { t = year - 1920; return 21.20 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3; }
  if (year >= 1900) { t = year - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (year >= 1860) { t = year - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
  if (year >= 1800) {
    t = year - 1800;
    return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4
      + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7;
  }
  if (year >= 1700) { t = year - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t ** 2 + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
  if (year >= 1600) { t = year - 1600; return 120 - 0.9808 * t - 0.01532 * t ** 2 + t ** 3 / 7129; }
  if (year >= 500) {
    u = (year - 1000) / 100;
    return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4
      - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6;
  }
  u = year / 100;
  return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4
    + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6;
}

export function jdFromMs(ms) { return 2440587.5 + ms / 86400000; }
export function yearOfMs(ms) { return 1970 + ms / 31557600000; }

/* Geocentric Moon in the J2000 ecliptic frame, as a vector in km.
   ms: UTC epoch milliseconds (ΔT applied internally). */
export function moonJ2000Km(ms) {
  const jdUT = jdFromMs(ms);
  const jdTT = jdUT + deltaT(yearOfMs(ms)) / 86400;
  const m = moonEclipticOfDate(jdTT);
  const p = precessEcliptic(m.lon, m.lat, jdTT, 2451545.0);
  const lo = p.lon * D2R, la = p.lat * D2R;
  return [m.dist * Math.cos(la) * Math.cos(lo), m.dist * Math.cos(la) * Math.sin(lo), m.dist * Math.sin(la)];
}
