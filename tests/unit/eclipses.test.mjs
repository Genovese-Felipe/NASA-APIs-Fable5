/* Every solar and lunar eclipse of 2026–2030, computed from first
   principles, checked against NASA's Five Millennium Canon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findEclipses } from '../../js/eclipses.js';

const nasa = JSON.parse(readFileSync(new URL('../fixtures/nasa-eclipses-2026-2030.json', import.meta.url), 'utf8'));
const ours = findEclipses(Date.UTC(2026, 0, 1), Date.UTC(2031, 0, 1));
const TYPE = { total: 'T', annular: 'A', hybrid: 'H', partial: 'P', penumbral: 'N' };
const secs = (s) => { const m = /(\d+)m(\d+)s/.exec(s); return m ? +m[1] * 60 + +m[2] : 0; };
const match = (kind, n) => {
  const td = Date.parse(`${n.date}T${n.td}Z`);
  const o = ours.find((e) => e.kind === kind && Math.abs(e.tdMs - td) < 86400000);
  assert.ok(o, `${kind} eclipse of ${n.date} not found`);
  return { o, dt: (o.tdMs - td) / 1000 };
};

test('finds exactly the eclipses NASA lists for 2026–2030', () => {
  assert.equal(ours.filter((e) => e.kind === 'solar').length, nasa.solar.length);
  assert.equal(ours.filter((e) => e.kind === 'lunar').length, nasa.lunar.length);
});

for (const n of nasa.solar) {
  test(`solar ${n.date} (${n.type}) matches NASA`, () => {
    const { o, dt } = match('solar', n);
    assert.equal(TYPE[o.type], n.type);
    assert.ok(Math.abs(dt) < 90, `greatest eclipse off by ${dt} s`);
    assert.ok(Math.abs(o.gamma - n.gamma) < 0.002, `gamma ${o.gamma} vs ${n.gamma}`);
    assert.ok(Math.abs(o.magnitude - n.magnitude) < 0.004, `magnitude ${o.magnitude} vs ${n.magnitude}`);
    assert.ok(Math.abs(o.ge.lat - n.lat) < 1, `lat ${o.ge.lat} vs ${n.lat}`);
    assert.ok(Math.abs(o.ge.lon - n.lon) < 1, `lon ${o.ge.lon} vs ${n.lon}`);
    if (n.duration) assert.ok(Math.abs(o.durationS - secs(n.duration)) < 3, `duration ${o.durationS} vs ${n.duration}`);
  });
}

for (const n of nasa.lunar) {
  test(`lunar ${n.date} (${n.type}) matches NASA`, () => {
    const { o, dt } = match('lunar', n);
    assert.equal(TYPE[o.type], n.type);
    assert.ok(Math.abs(dt) < 90, `greatest eclipse off by ${dt} s`);
    assert.ok(Math.abs(o.gamma - n.gamma) < 0.002, `gamma ${o.gamma} vs ${n.gamma}`);
    assert.ok(Math.abs(o.umbral - n.umbral) < 0.004, `umbral ${o.umbral} vs ${n.umbral}`);
    assert.ok(Math.abs(o.penumbral - n.penumbral) < 0.004, `penumbral ${o.penumbral} vs ${n.penumbral}`);
    if (n.parMin) assert.ok(Math.abs(o.durParS / 60 - n.parMin) < 2, `partial ${o.durParS / 60} vs ${n.parMin} min`);
    if (n.totMin) assert.ok(Math.abs(o.durTotS / 60 - n.totMin) < 2, `total ${o.durTotS / 60} vs ${n.totMin} min`);
  });
}

test('2026 Aug 12: greatest eclipse off Iceland, 294 km path', () => {
  const n = nasa.solar.find((e) => e.date === '2026-08-12');
  const { o } = match('solar', n);
  assert.ok(Math.abs(o.ge.lat - n.lat) < 0.3 && Math.abs(o.ge.lon - n.lon) < 0.5, JSON.stringify(o.ge));
  assert.ok(Math.abs(o.widthKm - n.widthKm) / n.widthKm < 0.03, `width ${o.widthKm}`);
});

test('outside the fixture years: classic eclipses, hybrids and historic ΔT', () => {
  const find = (y, m, d) => findEclipses(Date.UTC(y, m - 1, d - 1), Date.UTC(y, m - 1, d + 1)).find((e) => e.kind === 'solar');
  /* NASA: type, central duration (s), greatest-eclipse lat/lon */
  for (const [date, type, dur, lat, lon] of [
    [[1973, 6, 30], 'total', 424, 18.5, 5.7],
    [[2013, 11, 3], 'hybrid', 100, 3.5, -11.7],
    [[2017, 8, 21], 'total', 160, 37.0, -87.7],
    [[2023, 4, 20], 'hybrid', 76, -9.6, 125.8],
    [[2024, 4, 8], 'total', 268, 25.3, -104.1],
  ]) {
    const e = find(...date);
    assert.ok(e, `eclipse ${date} not found`);
    assert.equal(e.type, type, `${date}`);
    assert.ok(Math.abs(e.durationS - dur) < 4, `${date}: ${e.durationS} s vs ${dur}`);
    assert.ok(Math.abs(e.ge.lat - lat) < 0.5 && Math.abs(e.ge.lon - lon) < 0.5, `${date}: ${JSON.stringify(e.ge)}`);
  }
});
