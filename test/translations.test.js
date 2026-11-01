import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [spanish, english, html] = await Promise.all([
  readFile(new URL('../locales/es.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../locales/en.json', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('translation catalogs contain matching keys', () => {
  assert.deepEqual(Object.keys(spanish).sort(), Object.keys(english).sort());
});

test('every HTML translation reference exists in both catalogs', () => {
  const keys = [...html.matchAll(/data-i18n(?:-aria-label|-content)?="([^"]+)"/g)]
    .map((match) => match[1]);

  for (const key of keys) {
    assert.ok(key in spanish, `Missing Spanish translation: ${key}`);
    assert.ok(key in english, `Missing English translation: ${key}`);
  }
});
