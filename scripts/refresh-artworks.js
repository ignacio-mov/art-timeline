import { request as httpsRequest } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';

const configUrl = new URL('./refresh-artworks.config.json', import.meta.url);
const datasetUrl = new URL('../artworks.json', import.meta.url);

function validateConfig(config) {
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

function buildCandidateQuery(config) {
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

function toArtwork(binding, rowIndex) {
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

  return {
    painting: requiredValue(binding, 'painting', rowIndex),
    paintingLabel: requiredValue(binding, 'paintingLabel', rowIndex),
    authorLabel: requiredValue(binding, 'authorLabel', rowIndex),
    year: String(year),
    image,
    sitelinks: requiredValue(binding, 'sitelinks', rowIndex)
  };
}

function buildArtworkQuery(candidates, config) {
  const values = candidates
    .map(({ id, sitelinks }) => `(wd:${id} ${sitelinks})`)
    .join('\n    ');

  return `
SELECT ?painting ?paintingLabel ?authorLabel (YEAR(?inception) AS ?year) ?image ?sitelinks WHERE {
  VALUES (?painting ?sitelinks) {
    ${values}
  }
  ?painting wdt:P170 ?author;
    wdt:P571 ?inception;
    wdt:P18 ?image.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${config.labelLanguages.join(',')}". }
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

async function main() {
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

  const bindings = await fetchBindings(buildArtworkQuery(candidates, config));
  if (bindings.length === 0) {
    throw new Error('Wikidata query returned no complete artwork records');
  }

  const artworks = bindings.map(toArtwork);
  await writeFile(datasetUrl, `${JSON.stringify(artworks, null, 2)}\n`);
  console.log(`Wrote ${artworks.length} artwork records to artworks.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
