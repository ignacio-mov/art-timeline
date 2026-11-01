export function formatYear(year, language = 'es') {
  if (year >= 0) return year;
  return language === 'en' ? `${Math.abs(year)} BCE` : `${Math.abs(year)} a.C.`;
}

export function getArtworkTitle(artwork, language = 'es') {
  return artwork.labels?.[language]?.title
    || Object.values(artwork.labels ?? {}).find((labels) => labels.title)?.title
    || artwork.title;
}

export function getArtworkAuthor(artwork, language = 'es') {
  return artwork.labels?.[language]?.author
    || Object.values(artwork.labels ?? {}).find((labels) => labels.author)?.author
    || artwork.author;
}

export function normalizeArtwork(item, baseUrl, wikimediaImageWidth = 900, language = 'es') {
  const safeValue = (value, fallback = 'Sin dato') => value ?? fallback;
  const localizedLabels = item.labels && typeof item.labels === 'object' && !Array.isArray(item.labels)
    ? Object.fromEntries(Object.entries(item.labels).map(([code, labels]) => [
      code,
      {
        title: typeof labels?.title === 'string' ? labels.title : '',
        author: typeof labels?.author === 'string' ? labels.author : ''
      }
    ]))
    : {};
  const selectedLabels = localizedLabels[language];
  const title = safeValue(
    selectedLabels?.title
      || item.title?.value
      || item.title
      || item.paintingLabel?.value
      || item.paintingLabel
      || item.name,
    'Sin título'
  );
  const author = safeValue(
    selectedLabels?.author
      || item.author?.value
      || item.author
      || item.authorLabel?.value
      || item.authorLabel
      || item.artist
      || item.creator,
    'Anónimo'
  );

  const rawYear = item.year?.value || item.year || item.inception?.value || item.inception || item.date || 0;
  let year = Number.parseInt(rawYear, 10);

  if (Number.isNaN(year) && typeof rawYear === 'string') {
    const match = rawYear.match(/-?\d{1,4}/);
    year = match ? Number.parseInt(match[0], 10) : 0;
  }

  const rawImage = item.image?.value || item.image || item.img || item.url || '';
  const image = typeof rawImage === 'string' ? rawImage.trim() : '';
  const imageUrl = image ? new URL(image, baseUrl) : null;

  if (
    imageUrl
    && imageUrl.hostname === 'commons.wikimedia.org'
    && imageUrl.pathname.startsWith('/wiki/Special:FilePath/')
  ) {
    imageUrl.protocol = 'https:';
    imageUrl.searchParams.set('width', String(wikimediaImageWidth));
  }

  return {
    title,
    author,
    ...(Object.keys(localizedLabels).length > 0 ? { labels: localizedLabels } : {}),
    year: Number.isNaN(year) ? 0 : year,
    image: imageUrl?.href ?? ''
  };
}

export function isTimelineOrdered(artworks) {
  return artworks.every((artwork, index) => (
    index === 0 || artwork.year >= artworks[index - 1].year
  ));
}

export function isTimelineComplete(artworks, totalArtworkCount) {
  return artworks.length === totalArtworkCount;
}
