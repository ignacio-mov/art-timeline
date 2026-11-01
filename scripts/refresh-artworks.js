import { request as httpsRequest } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const configUrl = new URL('./refresh-artworks.config.json', import.meta.url);
const datasetUrl = new URL('../artworks.json', import.meta.url);

export function validateConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Refresh config must be a JSON object');
  }

  const allowedKeys = ['candidateLimit', 'artworkLimit', 'labelLanguages'];
  const unknownKeys = Object.keys(config).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown refresh config option(s): ${unknownKeys.join(', ')}`);
  }

  for (const key of ['candidateLimit', 'artworkLimit']) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) {
      throw new Error(`Refresh config "${key}" must be a positive integer`);
    }
  }
  if (config.artworkLimit > config.candidateLimit) {
    throw new Error('Refresh config "artworkLimit" cannot exceed "candidateLimit"');
  }
  if (
    !Array.isArray(config.labelLanguages)
    || config.labelLanguages.length === 0
    || config.labelLanguages.some((language) => (
      typeof language !== 'string'
      || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)
    ))
  ) {
    throw new Error('Refresh config "labelLanguages" must be a non-empty array of language codes');
  }

  return config;
}

async function loadConfig() {
  const contents = await readFile(configUrl, 'utf8');
  return validateConfig(JSON.parse(contents));
}

export function buildCandidateQuery(config) {
  return `
SELECT ?painting ?sitelinks WHERE {
  ?painting wdt:P31 wd:Q3305213;
    wikibase:sitelinks ?sitelinks.
}
ORDER BY DESC(?sitelinks)
LIMIT ${config.candidateLimit}
`;
}

function requiredValue(binding, field, rowIndex) {
  const value = binding[field]?.value?.trim();
  if (!value) {
    throw new Error(`Wikidata result ${rowIndex} is missing ${field}`);
  }
  return value;
}

export function toArtwork(binding, rowIndex, language) {
  const year = Number(requiredValue(binding, 'year', rowIndex));
  if (!Number.isInteger(year) || year === 0) {
    throw new Error(`Wikidata result ${rowIndex} has an invalid year`);
  }

  const image = requiredValue(binding, 'image', rowIndex);
  let imageUrl;
  try {
    imageUrl = new URL(image);
  } catch {
    throw new Error(`Wikidata result ${rowIndex} has an invalid image URL`);
  }
  if (!['http:', 'https:'].includes(imageUrl.protocol)) {
    throw new Error(`Wikidata result ${rowIndex} has an invalid image URL`);
  }

  const paintingLabel = requiredValue(binding, 'paintingLabel', rowIndex);
  const authorLabel = requiredValue(binding, 'authorLabel', rowIndex);

  return {
    painting: requiredValue(binding, 'painting', rowIndex),
    creator: requiredValue(binding, 'author', rowIndex),
    paintingLabel,
    authorLabel,
    labels: {
      [language]: {
        title: paintingLabel,
        author: authorLabel
      }
    },
    year: String(year),
    image,
    sitelinks: requiredValue(binding, 'sitelinks', rowIndex)
  };
}

export function addArtworkLanguage(artworks, bindings, language) {
  const artworksByCreator = new Map(artworks.map((artwork) => [
    `${artwork.painting}\u0000${artwork.creator}`,
    artwork
  ]));
  const seenCreators = new Set();

  bindings.forEach((binding, rowIndex) => {
    const painting = requiredValue(binding, 'painting', rowIndex);
    const creator = requiredValue(binding, 'author', rowIndex);
    const creatorKey = `${painting}\u0000${creator}`;
    const artwork = artworksByCreator.get(creatorKey);
    if (!artwork) {
      throw new Error(`Wikidata returned an unexpected artwork for language "${language}"`);
    }
    if (seenCreators.has(creatorKey)) {
      throw new Error(`Wikidata returned duplicate artwork labels for language "${language}"`);
    }

    artwork.labels[language] = {
      title: requiredValue(binding, 'paintingLabel', rowIndex),
      author: requiredValue(binding, 'authorLabel', rowIndex)
    };
    seenCreators.add(creatorKey);
  });
}

export function buildArtworkQuery(candidates, config, language = config.labelLanguages[0]) {
  const includeCreators = candidates.length > 0 && candidates.every(({ creator }) => creator);
  const values = candidates
    .map(({ id, creator, sitelinks }) => (
      includeCreators
        ? `(wd:${id} wd:${creator} ${sitelinks})`
        : `(wd:${id} ${sitelinks})`
    ))
    .join('\n    ');
  const valueVariables = includeCreators
    ? '(?painting ?author ?sitelinks)'
    : '(?painting ?sitelinks)';

  return `
SELECT ?painting ?author ?paintingLabel ?authorLabel (YEAR(?inception) AS ?year) ?image ?sitelinks WHERE {
  VALUES ${valueVariables} {
    ${values}
  }
  ?painting wdt:P170 ?author;
    wdt:P571 ?inception;
    wdt:P18 ?image.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${language}". }
}
ORDER BY DESC(?sitelinks)
LIMIT ${config.artworkLimit}
`;
}

function fetchBindings(query) {
  const endpoint = new URL('https://query.wikidata.org/sparql');

  return new Promise((resolve, reject) => {
    const request = httpsRequest(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/sparql-results+json',
        'Content-Type': 'application/sparql-query; charset=UTF-8',
        'User-Agent': 'art-timeline-dataset-refresh/1.0'
      }
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Wikidata query failed: HTTP ${response.statusCode}`));
          return;
        }

        let result;
        try {
          result = JSON.parse(body);
        } catch (error) {
          reject(new Error(`Wikidata returned invalid JSON: ${error.message}`));
          return;
        }
        const bindings = result.results?.bindings;
        if (!Array.isArray(bindings)) {
          reject(new Error('Wikidata query returned an invalid response'));
          return;
        }
        resolve(bindings);
      });
    });

    request.setTimeout(120_000, () => {
      request.destroy(new Error('Wikidata query timed out'));
    });
    request.on('error', reject);
    request.write(query);
    request.end();
  });
}

export async function refreshArtworkDataset() {
  const config = await loadConfig();
  const candidateBindings = await fetchBindings(buildCandidateQuery(config));
  const candidates = candidateBindings.map((binding, index) => {
    const painting = requiredValue(binding, 'painting', index);
    const match = painting.match(/^http:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/);
    const sitelinks = requiredValue(binding, 'sitelinks', index);
    if (!match || !/^\d+$/.test(sitelinks)) {
      throw new Error(`Wikidata candidate ${index} has invalid identifiers`);
    }
    return { id: match[1], sitelinks };
  });
  if (candidates.length === 0) {
    throw new Error('Wikidata query returned no artwork candidates');
  }

  const primaryLanguage = config.labelLanguages[0];
  const primaryBindings = await fetchBindings(buildArtworkQuery(candidates, config, primaryLanguage));
  if (primaryBindings.length === 0) {
    throw new Error('Wikidata query returned no complete artwork records');
  }

  const artworks = primaryBindings.map((binding, index) => toArtwork(binding, index, primaryLanguage));

  for (const language of config.labelLanguages.slice(1)) {
    const localizedBindings = await fetchBindings(buildArtworkQuery(
      artworks.map((artwork) => {
        const match = artwork.painting.match(/^http:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/);
        const creatorMatch = artwork.creator.match(/^http:\/\/www\.wikidata\.org\/entity\/(Q\d+)$/);
        if (!match || !creatorMatch) {
          throw new Error(`Wikidata artwork has invalid identifiers: ${artwork.painting}`);
        }
        return { id: match[1], creator: creatorMatch[1], sitelinks: artwork.sitelinks };
      }),
      { ...config, artworkLimit: artworks.length },
      language
    ));
    addArtworkLanguage(artworks, localizedBindings, language);
  }

  await writeFile(datasetUrl, `${JSON.stringify(artworks, null, 2)}\n`);
  console.log(`Wrote ${artworks.length} artwork records with ${config.labelLanguages.join(', ')} labels to artworks.json`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  refreshArtworkDataset().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
