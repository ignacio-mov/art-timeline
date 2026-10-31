const APP_VERSION = 'art-timeline-2026-10-31-3';
const currentVersion = new URLSearchParams(window.location.search).get('v');

if (currentVersion !== APP_VERSION) {
  const nextUrl = `${window.location.pathname}?v=${APP_VERSION}${window.location.hash}`;
  window.location.replace(nextUrl);
}

const FALLBACK_ARTWORKS = [
  { title: 'El Nacimiento de Venus', author: 'Sandro Botticelli', year: 1485, image: 'https://picsum.photos/id/1028/800/800' },
  { title: 'Mona Lisa', author: 'Leonardo da Vinci', year: 1503, image: 'https://picsum.photos/id/1025/800/800' },
  { title: 'Las Meninas', author: 'Diego Velázquez', year: 1656, image: 'https://picsum.photos/id/1074/800/800' },
  { title: 'La Joven de la Perla', author: 'Johannes Vermeer', year: 1665, image: 'https://picsum.photos/id/1062/800/800' }
];

const state = {
  rawArtworks: [],
  deck: [],
  timelineState: [],
  currentArtwork: null,
  isGameOver: false,
  highScore: Number(localStorage.getItem('art_timeline_record')) || 0
};

const timelineEl = document.getElementById('timeline');
const timelineWrapper = document.getElementById('timeline-wrapper');
const currentCardContainer = document.getElementById('current-card-container');
const deckArea = document.getElementById('deck-area');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const gameOverBanner = document.getElementById('game-over-banner');
const failedArtworkInfoEl = document.getElementById('failed-artwork-info');
const restartButton = document.getElementById('restart-button');
const lightboxOverlay = document.getElementById('lightbox-overlay');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxDetails = document.getElementById('lightbox-details');
const closeLightboxButton = document.getElementById('close-lightbox');
const statusPanel = document.getElementById('status-panel');
const statusText = document.getElementById('status-text');

function safeValue(value, fallback = 'Sin dato') {
  return value ?? fallback;
}

function formatYear(year) {
  return year < 0 ? `${Math.abs(year)} a.C.` : year;
}

function setStatus(message, type = 'info') {
  statusPanel.classList.remove('info', 'success', 'error');
  statusPanel.classList.add(type);
  statusText.textContent = message;
}

function openLightbox(art, isHidden = false) {
  lightboxImg.src = art.image;
  lightboxImg.alt = isHidden ? 'Obra a colocar' : art.title;

  if (isHidden) {
    lightboxTitle.textContent = 'Obra a colocar';
    lightboxDetails.textContent = 'Inserta la obra en el tiempo para descubrir sus datos reales';
  } else {
    lightboxTitle.textContent = art.title;
    lightboxDetails.textContent = `${art.author} — Año: ${formatYear(art.year)}`;
  }

  lightboxOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightboxOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

function scrollTimelineToView(forceStart = false) {
  const maxScroll = Math.max(0, timelineEl.scrollWidth - timelineWrapper.clientWidth);
  const targetLeft = forceStart ? 0 : (maxScroll > 0 ? maxScroll / 2 : 0);
  requestAnimationFrame(() => {
    timelineWrapper.scrollTo({
      left: targetLeft,
      behavior: 'auto'
    });
  });
}

function normalizeArtwork(item) {
  const title = safeValue(
    item.title?.value || item.title || item.paintingLabel?.value || item.paintingLabel || item.name,
    'Sin título'
  );
  const author = safeValue(
    item.author?.value || item.author || item.authorLabel?.value || item.authorLabel || item.artist || item.creator,
    'Anónimo'
  );

  let rawYear = item.year?.value || item.year || item.inception?.value || item.inception || item.date || 0;
  let year = Number.parseInt(rawYear, 10);

  if (Number.isNaN(year) && typeof rawYear === 'string') {
    const match = rawYear.match(/-?\d{1,4}/);
    year = match ? Number.parseInt(match[0], 10) : 0;
  }

  const image = safeValue(item.image?.value || item.image || item.img || item.url, '', '');

  return {
    title,
    author,
    year: Number.isNaN(year) ? 0 : year,
    image
  };
}

async function loadArtworkDataset() {
  if (state.rawArtworks.length > 0) return;

  try {
    const response = await fetch(`artworks.json?v=${APP_VERSION}`);
    if (!response.ok) throw new Error('No se halló artworks.json');

    const data = await response.json();
    let itemsList = [];

    if (data.results && data.results.bindings) {
      itemsList = data.results.bindings;
    } else if (Array.isArray(data)) {
      itemsList = data;
    } else {
      throw new Error('Formato de JSON no reconocido.');
    }

    state.rawArtworks = itemsList
      .map(normalizeArtwork)
      .filter((art) => art.year !== 0 && art.image !== '');

    if (state.rawArtworks.length === 0) {
      throw new Error('Sin elementos válidos.');
    }
  } catch (error) {
    console.warn('Aviso:', error.message, 'Usando datos de respaldo.');
    state.rawArtworks = FALLBACK_ARTWORKS;
  }
}

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function setScore() {
  scoreEl.textContent = Math.max(0, state.timelineState.length - 1);
}

function renderTimeline(forceStart = false) {
  timelineEl.innerHTML = '';

  if (!state.isGameOver) {
    timelineEl.appendChild(createDropzone(0));
  }

  state.timelineState.forEach((art, index) => {
    timelineEl.appendChild(createCardElement(art, false));
    if (!state.isGameOver) {
      timelineEl.appendChild(createDropzone(index + 1));
    }
  });

  scrollTimelineToView(forceStart);
}

function renderCurrentCard() {
  currentCardContainer.innerHTML = '';

  if (!state.currentArtwork) return;

  const card = createCardElement(state.currentArtwork, true);
  card.classList.add('deck-card');
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', 'artwork');
    event.dataTransfer.effectAllowed = 'move';
  });

  currentCardContainer.appendChild(card);
}

function createCardElement(art, isHidden = false) {
  const card = document.createElement('div');
  card.className = isHidden ? 'card deck-card' : 'card timeline-card';

  const title = isHidden ? 'Obra a colocar' : art.title;
  const author = isHidden ? 'Inserta en el tiempo' : art.author;
  const year = isHidden ? '????' : formatYear(art.year);
  const imageLabel = isHidden ? 'Ampliar imagen de la obra a colocar' : `Ampliar imagen de ${art.title}`;

  card.innerHTML = `
    <div class="card-img-container" title="Haz clic para ampliar" tabindex="0" aria-label="${imageLabel}">
      <img src="${art.image}" alt="${title}">
    </div>
    <div class="card-info">
      <div class="card-title" title="${title}">${title}</div>
      <div class="card-author" title="${author}">${author}</div>
      <div class="card-year">${year}</div>
    </div>
  `;

  const imgContainer = card.querySelector('.card-img-container');
  const activateLightbox = (event) => {
    if (event) event.preventDefault();
    openLightbox(art, isHidden);
  };

  imgContainer.addEventListener('click', activateLightbox);
  imgContainer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activateLightbox();
    }
  });

  return card;
}

function createDropzone(index) {
  const zone = document.createElement('div');
  zone.className = 'dropzone';
  zone.dataset.index = String(index);
  zone.setAttribute('role', 'button');
  zone.setAttribute('tabindex', '0');
  zone.setAttribute('aria-label', `Insertar obra en la posición ${index}`);

  const handleDrop = (event) => {
    event.preventDefault();
    zone.classList.remove('drag-over');
    handlePlacement(Number.parseInt(zone.dataset.index, 10));
  };

  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', handleDrop);
  zone.addEventListener('click', () => handlePlacement(Number.parseInt(zone.dataset.index, 10)));
  zone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handlePlacement(Number.parseInt(zone.dataset.index, 10));
    }
  });

  return zone;
}

function handlePlacement(insertedIndex) {
  if (state.isGameOver || !state.currentArtwork) return;

  const tempTimeline = [...state.timelineState];
  tempTimeline.splice(insertedIndex, 0, state.currentArtwork);

  const isCorrect = tempTimeline.every((item, index) => index === 0 || item.year >= tempTimeline[index - 1].year);

  if (isCorrect) {
    const previous = tempTimeline[insertedIndex - 1];
    const next = tempTimeline[insertedIndex + 1];
    const relation = previous && next
      ? `entre ${previous.title} (${formatYear(previous.year)}) y ${next.title} (${formatYear(next.year)})`
      : previous
        ? `después de ${previous.title} (${formatYear(previous.year)})`
        : `antes que todas las obras actuales`;

    setStatus(`¡Correcto! ${state.currentArtwork.title} queda ${relation}.`, 'success');

    state.timelineState = tempTimeline;
    renderTimeline();
    loadNextArtwork();
  } else {
    const before = state.timelineState[insertedIndex - 1];
    const after = state.timelineState[insertedIndex];

    let hint = 'Está fuera de orden con la secuencia actual.';
    if (before && state.currentArtwork.year < before.year) {
      hint = `Está demasiado tarde. Debería ir antes de ${before.title} (${formatYear(before.year)}).`;
    } else if (after && state.currentArtwork.year > after.year) {
      hint = `Está demasiado pronto. Debería ir después de ${after.title} (${formatYear(after.year)}).`;
    } else if (before && after) {
      hint = `Debería ir entre ${before.title} (${formatYear(before.year)}) y ${after.title} (${formatYear(after.year)}).`;
    }

    setStatus(`No va ahí: ${hint}`, 'error');
    state.timelineState.push(state.currentArtwork);
    state.timelineState.sort((a, b) => a.year - b.year);
    handleGameOver(state.currentArtwork);
  }
}

function loadNextArtwork() {
  if (state.deck.length === 0) {
    state.currentArtwork = null;
    currentCardContainer.innerHTML = '';
    state.isGameOver = true;
    deckArea.style.display = 'none';
    setScore();
    const hasWon = state.timelineState.length === state.rawArtworks.length + 1;

    if (hasWon) {
      const finalScore = Math.max(0, state.timelineState.length - 1);
      if (finalScore > state.highScore) {
        state.highScore = finalScore;
        localStorage.setItem('art_timeline_record', String(state.highScore));
        highScoreEl.textContent = String(state.highScore);
      }

      failedArtworkInfoEl.innerHTML = '¡Lo has conseguido! Has ordenado correctamente la cronología completa.';
      document.getElementById('final-score').textContent = finalScore;
      document.getElementById('final-high-score').textContent = state.highScore;
      gameOverBanner.classList.add('active');
      setStatus('¡Cronología completa! Has ganado.', 'success');
      renderTimeline(true);
    }
    return;
  }

  state.currentArtwork = state.deck.pop();
  renderCurrentCard();
  setScore();
  setStatus('Siguiente obra: colócala en su posición correcta.', 'info');
}

function handleGameOver(failedCard) {
  state.isGameOver = true;
  const currentScore = Math.max(0, state.timelineState.length - 2);

  if (currentScore > state.highScore) {
    state.highScore = currentScore;
    localStorage.setItem('art_timeline_record', String(state.highScore));
    highScoreEl.textContent = String(state.highScore);
  }

  deckArea.style.display = 'none';

  const formattedYear = formatYear(failedCard.year);
  failedArtworkInfoEl.innerHTML = `
    Colocaste mal: <strong>${failedCard.title}</strong> (${failedCard.author}) — Año real: <span>${formattedYear}</span>
  `;

  document.getElementById('final-score').textContent = currentScore;
  document.getElementById('final-high-score').textContent = state.highScore;
  gameOverBanner.classList.add('active');

  renderTimeline(true);
}

async function initGame() {
  state.isGameOver = false;
  highScoreEl.textContent = String(state.highScore);
  gameOverBanner.classList.remove('active');
  deckArea.style.display = 'flex';
  setStatus('Coloca la obra en su sitio histórico.', 'info');

  await loadArtworkDataset();

  state.deck = shuffleArray(state.rawArtworks);
  state.timelineState = [state.deck.pop()];
  state.currentArtwork = null;

  loadNextArtwork();
  renderTimeline(true);
}

restartButton.addEventListener('click', initGame);
closeLightboxButton.addEventListener('click', closeLightbox);
lightboxOverlay.addEventListener('click', (event) => {
  if (event.target === lightboxOverlay) {
    closeLightbox();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && lightboxOverlay.classList.contains('active')) {
    closeLightbox();
  }
});

initGame();
