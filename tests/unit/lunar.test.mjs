/* Lunar theory and time scales against Meeus' worked examples. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { moonEclipticOfDate, precessEcliptic, gmstDeg, deltaT } from '../../js/lunar.js';

test('Moon matches Meeus example 47.a (1992 Apr 12, 0h TD)', () => {
  const m = moonEclipticOfDate(2448724.5);
  assert.ok(Math.abs(m.lon - 133.162655) * 3600 < 0.05, `lon ${m.lon}`);
  assert.ok(Math.abs(m.lat - -3.229126) * 3600 < 0.05, `lat ${m.lat}`);
  assert.ok(Math.abs(m.dist - 368409.7) < 0.5, `dist ${m.dist}`);
});

test('Greenwich mean sidereal time matches Meeus example 12.b', () => {
  assert.ok(Math.abs(gmstDeg(2446896.30625) - 128.737873) < 1e-6);
});

test('ecliptic precession matches Meeus example 21.c to under 1"', () => {
  const p = precessEcliptic(149.48194, 1.76549, 2451545.0, 1643074.5);
  assert.ok(Math.abs(p.lon - 118.704) * 3600 < 1);
  assert.ok(Math.abs(p.lat - 1.6152) * 3600 < 1);
});

test('ΔT follows the observed record', () => {
  assert.ok(Math.abs(deltaT(2000) - 63.83) < 0.01);
  assert.ok(Math.abs(deltaT(2020) - 69.36) < 0.01);
  const d26 = deltaT(2026.5);
  assert.ok(d26 > 68 && d26 < 72, `2026: ${d26}`);
});

test('ΔT matches the historical record and has no jumps between segments', () => {
  /* Espenak–Meeus reference values */
  for (const [y, v] of [[1900, -2.79], [1950, 29.07], [1970, 40.2], [1975, 45.45], [1700, 8.83], [1800, 13.72]]) {
    assert.ok(Math.abs(deltaT(y) - v) < 0.3, `${y}: ${deltaT(y)} vs ${v}`);
  }
  /* (the published 500–1600 and 1600–1700 segments themselves differ by 0.25 s at 1600) */
  for (const y of [1700, 1800, 1860, 1900, 1920, 1941, 1961, 1986, 1990, 2025, 2050, 2150]) {
    const jump = Math.abs(deltaT(y + 1e-6) - deltaT(y - 1e-6));
    assert.ok(jump < 0.2, `ΔT step of ${jump.toFixed(2)} s at ${y}`);
  }
});
