'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFontFamily, normalizeConfig, DEFAULT_FONT_FAMILY } = require('../src/core');

test('font lists preserve order, quote family names and provide a system fallback', () => {
  assert.equal(normalizeFontFamily(), DEFAULT_FONT_FAMILY);
  assert.equal(normalizeConfig({}).fontFamily, '"Arial Narrow", Arial, sans-serif');
  assert.equal(normalizeFontFamily('Arial Narrow, Arial'), '"Arial Narrow", Arial, sans-serif');
  assert.equal(normalizeFontFamily('  "Arial Narrow" , Arial, Arial  '), '"Arial Narrow", Arial, sans-serif');
  assert.equal(normalizeFontFamily(['Arial Narrow', 'Arial']), '"Arial Narrow", Arial, sans-serif');
  assert.equal(normalizeFontFamily('Georgia\nserif'), 'Georgia, serif');
  assert.equal(normalizeFontFamily('Not Installed, Arial'), '"Not Installed", Arial, sans-serif');
});

test('empty or invalid font settings preserve the per-key FlexDesigner font', () => {
  for (const value of ['', ' , ', null, 42, {}, [null, 42]]) assert.equal(normalizeFontFamily(value), '');
  assert.equal(normalizeConfig({ fontFamily: '' }).fontFamily, '');
});
