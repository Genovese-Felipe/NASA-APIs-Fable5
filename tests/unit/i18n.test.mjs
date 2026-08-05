/* Unit tests: every language ships the complete key set. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, STRINGS, t, setLang, getLang } from '../../js/i18n.js';

test('LANGS and STRINGS agree', () => {
  const codes = LANGS.map((l) => l.code);
  assert.equal(new Set(codes).size, codes.length, 'duplicate language codes');
  assert.deepEqual(codes.sort(), Object.keys(STRINGS).sort());
  assert.ok(codes.length >= 9, 'at least 9 languages');
});

test('every language has exactly the English key set', () => {
  const enKeys = Object.keys(STRINGS.en).sort();
  assert.ok(enKeys.length > 100, 'expected a substantial key set');
  for (const [code, table] of Object.entries(STRINGS)) {
    const keys = Object.keys(table).sort();
    const missing = enKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !enKeys.includes(k));
    assert.deepEqual(missing, [], `${code} missing keys`);
    assert.deepEqual(extra, [], `${code} extra keys`);
  }
});

test('no empty translations', () => {
  for (const [code, table] of Object.entries(STRINGS)) {
    for (const [k, v] of Object.entries(table)) {
      assert.ok(typeof v === 'string' && v.length > 0, `${code}.${k} empty`);
    }
  }
});

test('placeholders survive translation', () => {
  const phOf = (s) => (s.match(/\{[a-z]+\}/g) || []).sort();
  for (const [code, table] of Object.entries(STRINGS)) {
    for (const k of Object.keys(STRINGS.en)) {
      assert.deepEqual(phOf(table[k]), phOf(STRINGS.en[k]), `${code}.${k} placeholder mismatch`);
    }
  }
});

test('t() interpolates and falls back', () => {
  setLang('en');
  assert.equal(t('neo.lunar', { n: 5 }), '5× Moon distance');
  assert.equal(t('nonexistent.key'), 'nonexistent.key');
  setLang('pt');
  assert.equal(getLang(), 'pt');
  assert.ok(t('body.moon') === 'Lua');
  setLang('xx');                       /* unknown → keeps current */
  assert.equal(getLang(), 'pt');
  setLang('en');
});
