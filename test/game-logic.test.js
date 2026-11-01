import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatYear,
  getArtworkAuthor,
  getArtworkTitle,
  isTimelineComplete,
  isTimelineOrdered,
  normalizeArtwork
} from '../game-logic.js';
import { validateGameConfig } from '../game-config.js';
import {
  addArtworkLanguage,
  buildArtworkQuery,
  toArtwork,
  validateConfig as validateRefreshConfig
} from '../scripts/refresh-artworks.js';

const baseUrl = 'https://example.test/games/art-timeline/';

test('formats BCE years and leaves CE years unchanged', () => {
  assert.equal(formatYear(-450), '450 a.C.');
  assert.equal(formatYear(-450, 'en'), '450 BCE');
  assert.equal(formatYear(1889), 1889);
  assert.equal(formatYear(1889, 'en'), 1889);
  assert.equal(formatYear(0), 0);
});

test('validates the game config and rejects invalid settings', () => {
  assert.deepEqual(validateGameConfig({
    updateCheckIntervalMs: 300000,
    wikimediaImageWidth: 900
  }), {
    updateCheckIntervalMs: 300000,
    wikimediaImageWidth: 900
  });
  assert.throws(() => validateGameConfig({
    updateCheckIntervalMs: 0,
    wikimediaImageWidth: 900
  }), /updateCheckIntervalMs/);
  assert.throws(() => validateGameConfig({
    updateCheckIntervalMs: 300000,
    wikimediaImageWidth: 900,
    imageWidth: 500
  }), /Unknown game config option/);
});

test('the checked-in game config contains valid settings', async () => {
  const configUrl = new URL('../game-config.json', import.meta.url);
  const config = JSON.parse(await readFile(configUrl, 'utf8'));

  assert.deepEqual(validateGameConfig(config), config);
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

test('uses the configured width for Wikimedia file URLs', () => {
  const artwork = normalizeArtwork({
    image: 'https://commons.wikimedia.org/wiki/Special:FilePath/Artwork.jpg'
  }, baseUrl, 1200);

  assert.equal(
    artwork.image,
    'https://commons.wikimedia.org/wiki/Special:FilePath/Artwork.jpg?width=1200'
  );
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

test('normalizes and selects artwork labels in the requested language', () => {
  const artwork = normalizeArtwork({
    paintingLabel: 'La noche estrellada',
    authorLabel: 'Vincent van Gogh',
    labels: {
      es: { title: 'La noche estrellada', author: 'Vincent van Gogh' },
      en: { title: 'The Starry Night', author: 'Vincent van Gogh' }
    },
    year: '1889'
  }, baseUrl, 900, 'en');

  assert.equal(artwork.title, 'The Starry Night');
  assert.equal(getArtworkTitle(artwork, 'en'), 'The Starry Night');
  assert.equal(getArtworkTitle(artwork, 'fr'), 'La noche estrellada');
  assert.equal(getArtworkAuthor(artwork, 'en'), 'Vincent van Gogh');
});

test('refresh config fetches individual languages and stores their labels together', () => {
  const config = validateRefreshConfig({
    candidateLimit: 10,
    artworkLimit: 5,
    labelLanguages: ['es', 'en']
  });
  const spanishBinding = {
    painting: { value: 'http://www.wikidata.org/entity/Q1' },
    author: { value: 'http://www.wikidata.org/entity/Q2' },
    paintingLabel: { value: 'Obra' },
    authorLabel: { value: 'Artista' },
    year: { value: '1900' },
    image: { value: 'https://example.test/image.jpg' },
    sitelinks: { value: '25' }
  };
  const artwork = toArtwork(spanishBinding, 0, config.labelLanguages[0]);

  assert.match(buildArtworkQuery([{ id: 'Q1', sitelinks: '25' }], config, 'en'), /wikibase:language "en"/);
  assert.match(
    buildArtworkQuery([{ id: 'Q1', creator: 'Q2', sitelinks: '25' }], config, 'en'),
    /VALUES \(\?painting \?author \?sitelinks\)/
  );
  assert.deepEqual(artwork.labels.es, { title: 'Obra', author: 'Artista' });
  addArtworkLanguage([artwork], [{
    ...spanishBinding,
    paintingLabel: { value: 'Artwork' },
    authorLabel: { value: 'Artist' }
  }], 'en');
  assert.deepEqual(artwork.labels.en, { title: 'Artwork', author: 'Artist' });
  assert.equal(artwork.paintingLabel, 'Obra');
  assert.equal(artwork.authorLabel, 'Artista');
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

test('the bundled artwork dataset contains valid, normalizable entries', async () => {
  const datasetUrl = new URL('../artworks.json', import.meta.url);
  const dataset = JSON.parse(await readFile(datasetUrl, 'utf8'));

  assert.ok(Array.isArray(dataset));
  assert.ok(dataset.length > 0);

  dataset.forEach((item, index) => {
    assert.equal(typeof item.paintingLabel, 'string', `artwork ${index} has no title`);
    assert.ok(item.paintingLabel.trim(), `artwork ${index} has an empty title`);
    assert.equal(typeof item.authorLabel, 'string', `artwork ${index} has no author`);
    assert.ok(item.authorLabel.trim(), `artwork ${index} has an empty author`);

    const artwork = normalizeArtwork(item, baseUrl);
    assert.notEqual(artwork.year, 0, `artwork ${index} has no valid year`);
    assert.ok(artwork.image, `artwork ${index} has no image URL`);
    assert.ok(
      ['http:', 'https:'].includes(new URL(artwork.image).protocol),
      `artwork ${index} has an invalid image URL`
    );
  });
});
