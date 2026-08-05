/* Unit tests: Keplerian ephemeris sanity + scene invariants. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  J2000_JD, AU_KM, dateToJD, jdToCenturies, solveKepler, heliocentric,
  moonGeocentric, BODIES, BODY_INDEX, orbitalPeriodYears, computeScene,
  orbitPath, distanceFromEarthAu, KEPLER_ELEMENTS,
} from '../../js/orbits.js';

const J2000_MS = Date.UTC(2000, 0, 1, 12);

test('date → Julian date roundtrip at J2000 epoch', () => {
  assert.ok(Math.abs(dateToJD(J2000_MS) - J2000_JD) < 1e-6);
  assert.equal(jdToCenturies(J2000_JD), 0);
});

test('Kepler solver satisfies E - e·sinE = M', () => {
  for (const [M, e] of [[0.3, 0.0167], [2.9, 0.2056], [-1.4, 0.0934], [3.0, 0.24]]) {
    const E = solveKepler(M, e);
    assert.ok(Math.abs(E - e * Math.sin(E) - M) < 1e-8, `M=${M} e=${e}`);
  }
});

test('Standish Table 1 spot checks (verified against JPL SSD)', () => {
  assert.equal(KEPLER_ELEMENTS.mercury.base[0], 0.38709927);
  assert.equal(KEPLER_ELEMENTS.earth.base[1], 0.01671123);
  assert.equal(KEPLER_ELEMENTS.neptune.base[0], 30.06992276);
  assert.equal(KEPLER_ELEMENTS.jupiter.rate[3], 3034.74612775);
  assert.equal(KEPLER_ELEMENTS.saturn.base[5], 113.66242448);
});

test('heliocentric distances stay within known perihelion/aphelion bounds', () => {
  const bounds = {
    mercury: [0.30, 0.47], venus: [0.71, 0.73], earth: [0.98, 1.02],
    mars: [1.38, 1.67], jupiter: [4.95, 5.46], saturn: [9.0, 10.13],
    uranus: [18.28, 20.10], neptune: [29.8, 30.34],
  };
  /* sweep 60 years around today */
  for (let k = -30; k <= 30; k += 3) {
    const T = jdToCenturies(dateToJD(Date.now() + k * 365.25 * 86400000));
    for (const [key, [lo, hi]] of Object.entries(bounds)) {
      const [x, y, z] = heliocentric(key, T);
      const r = Math.hypot(x, y, z);
      assert.ok(r > lo && r < hi, `${key} at T=${T.toFixed(2)}: r=${r}`);
    }
  }
});

test('Earth is near perihelion distance in early January', () => {
  const T = jdToCenturies(dateToJD(Date.UTC(2026, 0, 3)));
  const r = Math.hypot(...heliocentric('earth', T));
  assert.ok(Math.abs(r - 0.9833) < 0.002, `r=${r}`);
});

test('Earth orbital period ≈ 1 year, Mercury ≈ 88 days', () => {
  assert.ok(Math.abs(orbitalPeriodYears('earth') - 1) < 0.01);
  assert.ok(Math.abs(orbitalPeriodYears('mercury') * 365.25 - 88) < 1);
  assert.ok(Math.abs(orbitalPeriodYears('neptune') - 164.8) < 1.5);
});

test('Moon stays at ~384,400 km from Earth', () => {
  for (let k = 0; k < 28; k += 2) {
    const T = jdToCenturies(dateToJD(Date.now() + k * 86400000));
    const r = Math.hypot(...moonGeocentric(T)) * AU_KM;
    assert.ok(r > 356000 && r < 407000, `day ${k}: ${r} km`);
  }
});

test('computeScene returns a full body set with sane values', () => {
  for (const mode of ['showcase', 'true']) {
    const scene = computeScene(Date.now(), mode);
    assert.equal(scene.length, BODIES.length);
    for (let i = 0; i < scene.length; i++) {
      const st = scene[i];
      assert.ok(st.radius > 0, `${BODIES[i].key} radius`);
      assert.ok(st.pos.every(Number.isFinite), `${BODIES[i].key} pos finite`);
    }
    /* Sun at origin; Saturn carries ring radii beyond its surface */
    assert.deepEqual(scene[0].pos, [0, 0, 0]);
    const sat = scene[BODY_INDEX.saturn];
    assert.ok(sat.ringInner > sat.radius && sat.ringOuter > sat.ringInner);
    /* Moon offset from Earth is small but nonzero */
    const e = scene[BODY_INDEX.earth], m = scene[BODY_INDEX.moon];
    const d = Math.hypot(e.pos[0] - m.pos[0], e.pos[1] - m.pos[1], e.pos[2] - m.pos[2]);
    assert.ok(d > e.radius && d < 5, `moon offset ${d}`);
  }
});

test('true-scale mode preserves real proportions', () => {
  const scene = computeScene(Date.now(), 'true');
  const e = scene[BODY_INDEX.earth];
  const dSun = Math.hypot(...e.pos);
  /* Earth ~1 au = 6 units; radius ratio matches reality (~1/23455) */
  assert.ok(Math.abs(dSun - 6) < 0.15, `earth dist ${dSun}`);
  const ratio = dSun / e.radius;
  assert.ok(Math.abs(ratio - AU_KM / 6378.137) / (AU_KM / 6378.137) < 0.05, `ratio ${ratio}`);
});

test('orbit paths are closed-ish loops of the requested size', () => {
  const pts = orbitPath('mars', Date.now(), 'showcase', 120);
  assert.equal(pts.length, 121 * 3);
  const first = [pts[0], pts[1], pts[2]];
  const last = [pts.at(-3), pts.at(-2), pts.at(-1)];
  const gap = Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]);
  const size = Math.hypot(first[0], first[1], first[2]);
  assert.ok(gap < size * 0.05, `gap ${gap} vs size ${size}`);
});

test('distanceFromEarthAu behaves', () => {
  assert.equal(distanceFromEarthAu('earth', Date.now()), 0);
  const sun = distanceFromEarthAu('sun', Date.now());
  assert.ok(sun > 0.98 && sun < 1.02);
  const moon = distanceFromEarthAu('moon', Date.now());
  assert.ok(moon > 0.002 && moon < 0.003);
  const mars = distanceFromEarthAu('mars', Date.now());
  assert.ok(mars > 0.35 && mars < 2.7);
});
