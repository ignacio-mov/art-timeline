import {
  formatYear,
  getArtworkAuthor,
  getArtworkTitle,
  isTimelineComplete,
  isTimelineOrdered,
  normalizeArtwork
} from './game-logic.js';
import { validateGameConfig } from './game-config.js';

const VERSION_CHECK_RESOURCES = [
  'index.html',
  'script.js',
  'game-logic.js',
  'styles.css',
  'artworks.json',
  'game-config.json',
  'locales/es.json',
  'locales/en.json'
];
let translations = {};
let deployedResourceVersions;
let gameConfigPromise;
let updateCheckerStarted = false;

async function loadTranslations() {
  const entries = await Promise.all(['es', 'en'].map(async (language) => {
    const resource = `locales/${language}.json`;
    const response = await fetch(resource);
    if (!response.ok) {
      throw new Error(`No se pudo cargar ${resource}: HTTP ${response.status}`);
    }

    const catalog = await response.json();
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)
      || Object.values(catalog).some((message) => typeof message !== 'string')) {
      throw new Error(`El catálogo ${resource} no es válido`);
    }

    return [language, catalog];
  }));

  return Object.fromEntries(entries);
}

function loadGameConfig() {
  if (!gameConfigPromise) {
    gameConfigPromise = (async () => {
      const response = await fetch('game-config.json');
      if (!response.ok) {
        throw new Error(`No se pudo cargar game-config.json: HTTP ${response.status}`);
      }
      return validateGameConfig(await response.json());
    })();
  }

  return gameConfigPromise.catch((error) => {
    gameConfigPromise = undefined;
    throw error;
  });
}

async function getDeployedResourceVersions() {
  const entries = await Promise.all(VERSION_CHECK_RESOURCES.map(async (resource) => {
    const url = new URL(resource, document.baseURI);
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`No se pudo comprobar ${resource}: HTTP ${response.status}`);
    }

    const version = response.headers.get('ETag') || response.headers.get('Last-Modified');
    if (!version) {
      throw new Error(`El servidor no proporcionó un validador para ${resource}`);
    }

    return [resource, version];
  }));

  return Object.fromEntries(entries);
}

async function checkForDeployedUpdates(intervalMs) {
  try {
    const latestVersions = await getDeployedResourceVersions();

    if (deployedResourceVersions && VERSION_CHECK_RESOURCES.some(
      (resource) => latestVersions[resource] !== deployedResourceVersions[resource]
    )) {
      window.location.reload();
      return;
    }

    deployedResourceVersions = latestVersions;
  } catch (error) {
    console.warn('No se pudo comprobar si hay una versión nueva.', error);
  } finally {
    window.setTimeout(() => checkForDeployedUpdates(intervalMs), intervalMs);
  }
}

const FALLBACK_ARTWORKS = [
  { title: 'El Nacimiento de Venus', author: 'Sandro Botticelli', year: 1485, image: 'https://picsum.photos/id/1028/800/800' },
  { title: 'Mona Lisa', author: 'Leonardo da Vinci', year: 1503, image: 'https://picsum.photos/id/1025/800/800' },
  { title: 'Las Meninas', author: 'Diego Velázquez', year: 1656, image: 'https://picsum.photos/id/1074/800/800' },
  { title: 'La Joven de la Perla', author: 'Johannes Vermeer', year: 1665, image: 'https://picsum.photos/id/1062/800/800' }
];

const state = {
  language: ['es', 'en'].includes(localStorage.getItem('art_timeline_language'))
    ? localStorage.getItem('art_timeline_language')
    : 'es',
  rawArtworks: [],
  deck: [],
  timelineState: [],
  currentArtwork: null,
  isGameOver: false,
  practiceMode: false,
  completedGame: false,
  failedArtwork: null,
  statusKey: 'initialStatus',
  statusParams: {},
  statusType: 'info',
  skippedArtworkCount: 0,
  highScore: Number(localStorage.getItem('art_timeline_record')) || 0
};

const timelineEl = document.getElementById('timeline');
const timelineWrapper = document.getElementById('timeline-wrapper');
const currentCardContainer = document.getElementById('current-card-container');
const deckArea = document.getElementById('deck-area');
const howToPlayEl = document.getElementById('how-to-play');
const dismissInstructionsButton = document.getElementById('dismiss-instructions');
const scoreEl = document.getElementById('score');
const highScoreEl = document.getElementById('high-score');
const gameOverBanner = document.getElementById('game-over-banner');
const failedArtworkInfoEl = document.getElementById('failed-artwork-info');
const restartButton = document.getElementById('restart-button');
const practiceButton = document.getElementById('practice-button');
const lightboxOverlay = document.getElementById('lightbox-overlay');
const lightboxImg = document.getElementById('lightbox-img');
const lightboxTitle = document.getElementById('lightbox-title');
const lightboxDetails = document.getElementById('lightbox-details');
const closeLightboxButton = document.getElementById('close-lightbox');
const statusPanel = document.getElementById('status-panel');
const statusText = document.getElementById('status-text');
const languageSelect = document.getElementById('language-select');
let lightboxReturnFocus;
let lightboxArtwork;
let lightboxIsHidden = false;

function translate(key, params = {}) {
  const message = translations[state.language]?.[key] ?? translations.es?.[key] ?? key;
  return message.replace(/\{(\w+)\}/g, (match, name) => String(params[name] ?? match));
}

function artworkTitle(artwork) {
  return getArtworkTitle(artwork, state.language);
}

function artworkAuthor(artwork) {
  return getArtworkAuthor(artwork, state.language);
}

function applyTranslations() {
  document.documentElement.lang = state.language;
  document.title = translate('pageTitle');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', translate(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-content]').forEach((element) => {
    element.setAttribute('content', translate(element.dataset.i18nContent));
  });
  languageSelect.value = state.language;
}

if (sessionStorage.getItem('art_timeline_instructions_dismissed') === 'true') {
  howToPlayEl.hidden = true;
}
const translationsPromise = loadTranslations().then((catalog) => {
  translations = catalog;
  applyTranslations();
  return catalog;
});

function setStatus(message, type = 'info', params = {}) {
  state.statusKey = message;
  state.statusParams = params;
  state.statusType = type;
  statusPanel.classList.remove('info', 'success', 'error');
  statusPanel.classList.add(type);
  statusText.textContent = translate(message, params);
}

function openLightbox(art, isHidden = false) {
  lightboxReturnFocus = document.activeElement;
  lightboxArtwork = art;
  lightboxIsHidden = isHidden;
  renderLightboxLanguage();
  lightboxOverlay.classList.add('active');
  lightboxOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  closeLightboxButton.focus();
}

function renderLightboxLanguage() {
  const art = lightboxArtwork;
  if (!art) return;

  lightboxImg.src = art.image;
  lightboxImg.alt = lightboxIsHidden ? translate('hiddenArtwork') : artworkTitle(art);

  if (lightboxIsHidden) {
    lightboxTitle.textContent = translate('hiddenArtwork');
    lightboxDetails.textContent = translate('hiddenArtworkDetails');
  } else {
    lightboxTitle.textContent = artworkTitle(art);
    lightboxDetails.textContent = `${artworkAuthor(art)} — ${translate('yearLabel', { year: formatYear(art.year, state.language) })}`;
  }
}

function closeLightbox() {
  lightboxOverlay.classList.remove('active');
  lightboxOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (lightboxReturnFocus instanceof HTMLElement && lightboxReturnFocus.isConnected) {
    lightboxReturnFocus.focus();
  }
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

async function loadArtworkDataset(wikimediaImageWidth) {
  if (state.rawArtworks.length > 0) return;

  try {
    const response = await fetch('artworks.json');
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
      .map((item) => normalizeArtwork(item, window.location.href, wikimediaImageWidth, state.language))
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
  const activeDropzone = document.activeElement?.classList.contains('dropzone')
    ? Number.parseInt(document.activeElement.dataset.index, 10)
    : null;
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

  if (activeDropzone !== null) {
    const focusIndex = Math.min(activeDropzone, state.timelineState.length);
    timelineEl.querySelector(`[data-index="${focusIndex}"]`)?.focus({ preventScroll: true });
  }
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

function skipCurrentArtwork(art) {
  if (state.isGameOver || state.currentArtwork !== art) return;

  state.currentArtwork = null;
  state.skippedArtworkCount += 1;
  loadNextArtwork();

  if (!state.isGameOver) {
    setStatus('skippedArtwork', 'info', { title: artworkTitle(art), artwork: art });
  }
}

function createCardElement(art, isHidden = false) {
  const card = document.createElement('div');
  card.className = isHidden ? 'card deck-card' : 'card timeline-card';
  const title = isHidden ? translate('hiddenArtwork') : artworkTitle(art);
  const author = isHidden ? translate('placeHiddenArtwork') : artworkAuthor(art);
  const imgContainer = document.createElement('div');
  imgContainer.className = 'card-img-container';
  imgContainer.title = translate('enlarge');
  imgContainer.tabIndex = 0;
  imgContainer.setAttribute('role', 'button');
  imgContainer.setAttribute('aria-haspopup', 'dialog');
  imgContainer.setAttribute('aria-label', isHidden
    ? translate('enlargeHiddenArtwork')
    : translate('enlargeArtwork', { title: artworkTitle(art) }));

  const image = document.createElement('img');
  image.alt = title;
  image.loading = isHidden ? 'eager' : 'lazy';
  image.addEventListener('error', () => {
    imgContainer.classList.add('image-unavailable');
    const fallback = document.createElement('span');
    fallback.className = 'image-fallback';
    fallback.textContent = translate('unavailableImage');
    fallback.setAttribute('role', 'img');
    fallback.setAttribute('aria-label', translate('unavailableImageOf', { title: artworkTitle(art) }));
    imgContainer.replaceChildren(fallback);

    if (isHidden && state.currentArtwork === art) {
      skipCurrentArtwork(art);
    } else {
      imgContainer.removeAttribute('role');
      imgContainer.removeAttribute('tabindex');
      imgContainer.removeAttribute('aria-haspopup');
      imgContainer.removeAttribute('aria-label');
      imgContainer.removeAttribute('title');
    }
  }, { once: true });

  image.src = art.image;
  imgContainer.appendChild(image);

  const info = document.createElement('div');
  info.className = 'card-info';
  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.title = title;
  titleEl.textContent = title;
  const authorEl = document.createElement('div');
  authorEl.className = 'card-author';
  authorEl.title = author;
  authorEl.textContent = author;
  const yearEl = document.createElement('div');
  yearEl.className = 'card-year';
  yearEl.textContent = isHidden ? '????' : String(formatYear(art.year, state.language));
  info.append(titleEl, authorEl, yearEl);
  card.append(imgContainer, info);

  const activateLightbox = (event) => {
    if (imgContainer.classList.contains('image-unavailable')) return;
    if (event) event.preventDefault();
    imgContainer.focus();
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
  const previous = state.timelineState[index - 1];
  const next = state.timelineState[index];
  const visibleLabel = document.createElement('span');
  const accessibleLabel = previous && next
    ? translate('between', {
      first: artworkTitle(previous),
      firstYear: formatYear(previous.year, state.language),
      second: artworkTitle(next),
      secondYear: formatYear(next.year, state.language)
    })
    : previous
      ? translate('after', {
        title: artworkTitle(previous),
        year: formatYear(previous.year, state.language)
      })
      : translate('before', {
        title: artworkTitle(next),
        year: formatYear(next.year, state.language)
      });
  visibleLabel.textContent = previous && next
    ? translate('betweenYears', {
      first: formatYear(previous.year, state.language),
      second: formatYear(next.year, state.language)
    })
    : previous
      ? translate('afterYear', { year: formatYear(previous.year, state.language) })
      : translate('beforeYear', { year: formatYear(next.year, state.language) });
  zone.setAttribute('aria-label', translate('insert', { position: accessibleLabel }));
  zone.appendChild(visibleLabel);

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

  const isCorrect = isTimelineOrdered(tempTimeline);

  if (isCorrect) {
    const previous = tempTimeline[insertedIndex - 1];
    const next = tempTimeline[insertedIndex + 1];
    const relation = previous && next
      ? translate('between', {
        first: artworkTitle(previous),
        firstYear: formatYear(previous.year, state.language),
        second: artworkTitle(next),
        secondYear: formatYear(next.year, state.language)
      })
      : previous
        ? translate('after', {
          title: artworkTitle(previous),
          year: formatYear(previous.year, state.language)
        })
        : translate('beforeAll');

    setStatus('correct', 'success', {
      title: artworkTitle(state.currentArtwork),
      position: relation
    });

    state.timelineState = tempTimeline;
    renderTimeline();
    loadNextArtwork();
  } else {
    const artwork = state.currentArtwork;
    const correctPosition = getCorrectPosition(artwork, state.timelineState);

    if (state.practiceMode) {
      state.timelineState.splice(correctPosition.index, 0, artwork);
      renderTimeline();
      loadNextArtwork();
      setStatus('practiceCorrection', 'success', {
        title: artworkTitle(artwork),
        position: correctPosition.description
      });
    } else {
      const before = state.timelineState[insertedIndex - 1];
      const after = state.timelineState[insertedIndex];
      let hint = translate('outOfOrder');
      if (before && artwork.year < before.year) {
        hint = translate('tooLate', {
          title: artworkTitle(before),
          year: formatYear(before.year, state.language)
        });
      } else if (after && artwork.year > after.year) {
        hint = translate('tooEarly', {
          title: artworkTitle(after),
          year: formatYear(after.year, state.language)
        });
      } else if (before && after) {
        hint = translate('shouldBeBetween', {
          first: artworkTitle(before),
          firstYear: formatYear(before.year, state.language),
          second: artworkTitle(after),
          secondYear: formatYear(after.year, state.language)
        });
      }

      setStatus('wrongPlacement', 'error', { hint });
      state.timelineState.splice(correctPosition.index, 0, artwork);
      handleGameOver(artwork);
    }
  }
}

function getCorrectPosition(artwork, timeline) {
  const index = timeline.findIndex((art) => art.year > artwork.year);
  const resolvedIndex = index === -1 ? timeline.length : index;
  const previous = timeline[resolvedIndex - 1];
  const next = timeline[resolvedIndex];
  const description = previous && next
    ? translate('between', {
      first: artworkTitle(previous),
      firstYear: formatYear(previous.year, state.language),
      second: artworkTitle(next),
      secondYear: formatYear(next.year, state.language)
    })
    : previous
      ? translate('after', {
        title: artworkTitle(previous),
        year: formatYear(previous.year, state.language)
      })
      : next
        ? translate('before', {
          title: artworkTitle(next),
          year: formatYear(next.year, state.language)
        })
        : translate('anyPosition');

  return { index: resolvedIndex, description };
}

function loadNextArtwork() {
  if (state.deck.length === 0) {
    state.currentArtwork = null;
    currentCardContainer.innerHTML = '';
    state.isGameOver = true;
    deckArea.style.display = 'none';
    setScore();
    const hasWon = isTimelineComplete(state.timelineState, state.rawArtworks.length)
      || state.timelineState.length + state.skippedArtworkCount === state.rawArtworks.length;

    if (hasWon) {
      const finalScore = Math.max(0, state.timelineState.length - 1);
      state.completedGame = true;
      if (!state.practiceMode && finalScore > state.highScore) {
        state.highScore = finalScore;
        localStorage.setItem('art_timeline_record', String(state.highScore));
        highScoreEl.textContent = String(state.highScore);
      }

      document.getElementById('final-score').textContent = finalScore;
      document.getElementById('final-high-score').textContent = state.highScore;
      gameOverBanner.classList.add('active');
      practiceButton.hidden = true;
      renderGameOverMessage();
      setStatus('winStatus', 'success');
      renderTimeline(true);
      restartButton.focus();
    }
    return;
  }

  state.currentArtwork = state.deck.pop();
  renderCurrentCard();
  setScore();
  setStatus(
    state.practiceMode
      ? 'practiceStatus'
      : 'nextArtworkStatus',
    'info'
  );
}

function handleGameOver(failedCard) {
  state.isGameOver = true;
  state.failedArtwork = failedCard;
  const currentScore = Math.max(0, state.timelineState.length - 2);

  if (currentScore > state.highScore) {
    state.highScore = currentScore;
    localStorage.setItem('art_timeline_record', String(state.highScore));
    highScoreEl.textContent = String(state.highScore);
  }

  deckArea.style.display = 'none';

  document.getElementById('final-score').textContent = currentScore;
  document.getElementById('final-high-score').textContent = state.highScore;
  gameOverBanner.classList.add('active');
  practiceButton.hidden = false;
  renderGameOverMessage();

  renderTimeline(true);
  restartButton.focus();
}

function renderGameOverMessage() {
  if (state.failedArtwork) {
    const artwork = state.failedArtwork;
    const correctPosition = getCorrectPosition(
      artwork,
      state.timelineState.filter((art) => art !== artwork)
    );
    const prefix = document.createTextNode(translate('failedArtwork'));
    const title = document.createElement('strong');
    title.textContent = artworkTitle(artwork);
    const details = document.createTextNode(translate('failedArtworkDetails', {
      author: artworkAuthor(artwork),
      year: formatYear(artwork.year, state.language),
      position: correctPosition.description
    }));
    failedArtworkInfoEl.replaceChildren(prefix, title, details);
    return;
  }

  const score = Math.max(0, state.timelineState.length - 1);
  failedArtworkInfoEl.textContent = state.skippedArtworkCount
    ? translate('skippedSummary', { score, skipped: state.skippedArtworkCount })
    : state.practiceMode
      ? translate('practiceSummary', { score })
      : translate('winSummary');
}

async function initGame() {
  state.isGameOver = false;
  state.practiceMode = false;
  highScoreEl.textContent = String(state.highScore);
  gameOverBanner.classList.remove('active');
  practiceButton.hidden = true;
  deckArea.style.display = 'flex';
  state.completedGame = false;
  state.failedArtwork = null;
  setStatus('initialGameStatus', 'info');

  const config = await loadGameConfig();
  if (!updateCheckerStarted) {
    updateCheckerStarted = true;
    void checkForDeployedUpdates(config.updateCheckIntervalMs);
  }
  await loadArtworkDataset(config.wikimediaImageWidth);

  state.deck = shuffleArray(state.rawArtworks);
  state.timelineState = [state.deck.pop()];
  state.currentArtwork = null;
  state.skippedArtworkCount = 0;

  loadNextArtwork();
  renderTimeline(true);
}

function reportInitializationError(error) {
  console.error('No se pudo iniciar el juego.', error);
  if (translations[state.language]?.initError) {
    setStatus('initError', 'error');
  } else {
    statusPanel.classList.remove('info', 'success');
    statusPanel.classList.add('error');
    statusText.textContent = error.message;
  }
}

restartButton.addEventListener('click', () => {
  void initGame().catch(reportInitializationError);
});
practiceButton.addEventListener('click', () => {
  state.practiceMode = true;
  state.isGameOver = false;
  state.failedArtwork = null;
  state.completedGame = false;
  state.currentArtwork = null;
  gameOverBanner.classList.remove('active');
  practiceButton.hidden = true;
  deckArea.style.display = 'flex';
  renderTimeline(true);
  loadNextArtwork();
  timelineEl.querySelector('.dropzone')?.focus();
});
languageSelect.addEventListener('change', () => {
  state.language = languageSelect.value;
  localStorage.setItem('art_timeline_language', state.language);
  if (!Object.keys(translations).length) return;

  applyTranslations();
  renderTimeline();
  renderCurrentCard();

  if (gameOverBanner.classList.contains('active')) {
    renderGameOverMessage();
  }

  if (state.completedGame) {
    setStatus('winStatus', 'success');
  } else if (state.failedArtwork) {
    setStatus('wrongPlacement', 'error', { hint: translate('outOfOrder') });
  } else if (state.statusKey === 'skippedArtwork' && state.statusParams.artwork) {
    const artwork = state.statusParams.artwork;
    setStatus('skippedArtwork', 'info', { title: artworkTitle(artwork), artwork });
  } else if (state.currentArtwork) {
    const isPlacementFeedback = ['correct', 'practiceCorrection'].includes(state.statusKey);
    setStatus(
      isPlacementFeedback
        ? (state.practiceMode ? 'practiceStatus' : 'nextArtworkStatus')
        : state.statusKey,
      isPlacementFeedback ? 'info' : state.statusType,
      isPlacementFeedback ? {} : state.statusParams
    );
  } else {
    setStatus(state.statusKey, state.statusType, state.statusParams);
  }

  if (lightboxOverlay.classList.contains('active')) {
    renderLightboxLanguage();
  }
});
dismissInstructionsButton.addEventListener('click', () => {
  howToPlayEl.hidden = true;
  sessionStorage.setItem('art_timeline_instructions_dismissed', 'true');
});
closeLightboxButton.addEventListener('click', closeLightbox);
lightboxOverlay.addEventListener('click', (event) => {
  if (event.target === lightboxOverlay) {
    closeLightbox();
  }
});
document.addEventListener('keydown', (event) => {
  if (!lightboxOverlay.classList.contains('active')) return;

  if (event.key === 'Escape') {
    closeLightbox();
  } else if (event.key === 'Tab') {
    event.preventDefault();
    closeLightboxButton.focus();
  }
});

async function startGame() {
  await translationsPromise;
  await initGame();
}

void startGame().catch(reportInitializationError);
