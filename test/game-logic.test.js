import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatYear,
  isTimelineComplete,
  isTimelineOrdered,
  normalizeArtwork
} from '../game-logic.js';

const baseUrl = 'https://example.test/games/art-timeline/';

test('formats BCE years and leaves CE years unchanged', () => {
  assert.equal(formatYear(-450), '450 a.C.');
  assert.equal(formatYear(1889), 1889);
  assert.equal(formatYear(0), 0);
});

test('normalizes labeled dataset fields and upgrades Wikimedia file URLs', () => {
  const artwork = normalizeArtwork({
    paintingLabel: { value: 'La noche estrellada' },
    authorLabel: { value: 'Vincent van Gogh' },
    year: { value: '1889' },
    image: {
      value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Starry_Night.jpg'
    }
  }, baseUrl);

  assert.deepEqual(artwork, {
    title: 'La noche estrellada',
    author: 'Vincent van Gogh',
    year: 1889,
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Starry_Night.jpg?width=900'
  });
});

test('normalizes alternate fields, negative dates, and relative image URLs', () => {
  const artwork = normalizeArtwork({
    name: 'Ancient artwork',
    creator: 'Unknown artist',
    date: 'c. -450',
    img: 'images/artwork.jpg'
  }, baseUrl);

  assert.deepEqual(artwork, {
    title: 'Ancient artwork',
    author: 'Unknown artist',
    year: -450,
    image: 'https://example.test/games/art-timeline/images/artwork.jpg'
  });
});

test('uses fallback labels and a zero year for missing or invalid values', () => {
  assert.deepEqual(normalizeArtwork({ year: 'unknown' }, baseUrl), {
    title: 'Sin título',
    author: 'Anónimo',
    year: 0,
    image: ''
  });
});

test('accepts chronological timelines, including works with equal years', () => {
  assert.equal(isTimelineOrdered([{ year: -450 }, { year: 1503 }, { year: 1503 }]), true);
  assert.equal(isTimelineOrdered([]), true);
});

test('rejects timelines with a work placed out of chronological order', () => {
  assert.equal(isTimelineOrdered([{ year: 1503 }, { year: 1485 }]), false);
});

test('completes the game after every artwork has been placed', () => {
  assert.equal(isTimelineComplete([{ year: 1485 }, { year: 1503 }], 2), true);
  assert.equal(isTimelineComplete([{ year: 1485 }], 2), false);
});

test('the bundled artwork dataset contains normalizable entries', async () => {
  const datasetUrl = new URL('../artworks.json', import.meta.url);
  const dataset = JSON.parse(await readFile(datasetUrl, 'utf8'));

  assert.ok(Array.isArray(dataset));
  assert.ok(dataset.length > 0);

  const usableArtworks = dataset
    .map((item) => normalizeArtwork(item, baseUrl))
    .filter((artwork) => artwork.year !== 0 && artwork.image !== '');

  assert.ok(usableArtworks.length > 0);
  assert.ok(usableArtworks.every((artwork) => (
    typeof artwork.title === 'string'
    && typeof artwork.author === 'string'
    && Number.isInteger(artwork.year)
    && artwork.image.startsWith('http')
  )));
});
