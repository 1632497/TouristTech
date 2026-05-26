// =============================================
// result.js - Mostra els resultats de l'anàlisi
// Llegeix el resultat del sessionStorage i el pinta
// =============================================

// Referència global per al text-to-speech
let speechSynthesisUtterance = null;
let isPlaying = false;

// Quan el DOM estigui llest
document.addEventListener('DOMContentLoaded', function () {

  // --- Recuperem els elements del HTML ---
  const noResultsMsg      = document.getElementById('no-results-msg');
  const resultsContainer  = document.getElementById('results-container');
  const dishesList        = document.getElementById('dishes-list');
  const originalText      = document.getElementById('original-text');
  const recommendationText = document.getElementById('recommendation-text');
  const resultSubtitle    = document.getElementById('result-subtitle');
  const btnAudio          = document.getElementById('btn-audio');
  const audioLabel        = document.getElementById('audio-label');

  // --- Llegim el resultat del sessionStorage ---
  const resultRaw = sessionStorage.getItem('touristtech_result');

  // Si no hi ha resultat, mostrem el missatge d'error
  if (!resultRaw) {
    noResultsMsg.style.display = 'block';
    return;
  }

  // Convertim de JSON a objecte JavaScript
  const result = JSON.parse(resultRaw);
  console.log('Mostrant resultat:', result);

  // Mostrem el contenidor de resultats
  resultsContainer.style.display = 'block';

  // --- Actualitzem el subtítol de la capçalera ---
  const dishCount = result.dishes ? result.dishes.length : 0;
  resultSubtitle.textContent = dishCount + ' plats analitzats';

  // --- Mostrem la recomanació de l'AI ---
  if (result.recommendation) {
    recommendationText.textContent = result.recommendation;
  } else {
    recommendationText.textContent = 'No s\'han detectat recomanacions especials.';
  }

  // --- Mostrem el text original detectat ---
  if (result.originalText) {
    originalText.textContent = result.originalText;
  }

  // --- Pintem les targetes de cada plat ---
  if (result.dishes && result.dishes.length > 0) {
    result.dishes.forEach(function (dish) {
      const dishCard = createDishCard(dish);
      dishesList.appendChild(dishCard);
    });
  } else {
    dishesList.innerHTML = '<p class="text-small">No s\'han detectat plats.</p>';
  }

  // --- Botó de text-to-speech ---
  btnAudio.addEventListener('click', function () {
    if (isPlaying) {
      // Aturem la lectura
      window.speechSynthesis.cancel();
      isPlaying = false;
      audioLabel.textContent = 'Llegir resultats en veu alta';
      btnAudio.classList.remove('playing');
    } else {
      // Preparem el text a llegir
      const textToRead = buildAudioText(result);

      // Creem la síntesi de veu
      speechSynthesisUtterance = new SpeechSynthesisUtterance(textToRead);

      // Triem l'idioma del perfil de l'usuari
      const profileRaw = localStorage.getItem('touristtech_profile');
      const profile = profileRaw ? JSON.parse(profileRaw) : {};
      speechSynthesisUtterance.lang = getLanguageCode(profile.language || 'ca');
      speechSynthesisUtterance.rate = 0.9;  // Velocitat de lectura

      // Quan acabi la lectura, restaurem el botó
      speechSynthesisUtterance.onend = function () {
        isPlaying = false;
        audioLabel.textContent = 'Llegir resultats en veu alta';
        btnAudio.classList.remove('playing');
      };

      // Iniciem la lectura
      window.speechSynthesis.speak(speechSynthesisUtterance);
      isPlaying = true;
      audioLabel.textContent = 'Aturar la lectura';
      btnAudio.classList.add('playing');
    }
  });

});

// --- Funció per crear una targeta de plat ---
function createDishCard(dish) {
  const card = document.createElement('div');

  // Determinem el color de la targeta segons si és segur o no
  if (dish.safe) {
    card.className = 'dish-card safe';
  } else if (dish.warnings && dish.warnings.length > 0) {
    card.className = 'dish-card danger';
  } else {
    card.className = 'dish-card';
  }

  // Nom traduït del plat
  const nameEl = document.createElement('p');
  nameEl.className = 'dish-name';
  nameEl.textContent = dish.translated;

  // Nom original del plat
  const originalEl = document.createElement('p');
  originalEl.className = 'dish-original';
  originalEl.textContent = '🌍 Original: ' + dish.name;

  // Etiquetes d'estat (segur / advertències)
  const badgesEl = document.createElement('div');

  if (dish.safe) {
    badgesEl.innerHTML += '<span class="dish-badge badge-safe">✅ Segur per a tu</span>';
  }

  // Mostrem cada advertència d'al·lèrgen
  if (dish.warnings && dish.warnings.length > 0) {
    dish.warnings.forEach(function (warning) {
      badgesEl.innerHTML += '<span class="dish-badge badge-danger">🚫 ' + warning + '</span>';
    });
  }

  // Muntem la targeta
  card.appendChild(nameEl);
  card.appendChild(originalEl);
  card.appendChild(badgesEl);

  return card;
}

// --- Funció per construir el text que es llegirà en veu alta ---
function buildAudioText(result) {
  let text = 'Resum del menú. ';

  if (result.recommendation) {
    text += 'Recomanació: ' + result.recommendation + '. ';
  }

  if (result.dishes) {
    text += 'Plats analitzats: ';
    result.dishes.forEach(function (dish) {
      text += dish.translated + '. ';
      if (!dish.safe && dish.warnings && dish.warnings.length > 0) {
        text += 'Atenció: conté ' + dish.warnings.join(' i ') + '. ';
      }
    });
  }

  return text;
}

// --- Funció per obtenir el codi d'idioma pel text-to-speech ---
function getLanguageCode(lang) {
  const codes = {
    ca: 'ca-ES',
    es: 'es-ES',
    en: 'en-US',
    fr: 'fr-FR',
    de: 'de-DE',
    it: 'it-IT',
    pt: 'pt-PT',
    ja: 'ja-JP',
    zh: 'zh-CN',
    ar: 'ar-SA'
  };
  return codes[lang] || 'ca-ES';
}

// --- Funció per mostrar/amagar el text original (cridat des del HTML) ---
function toggleOriginalText() {
  const box = document.getElementById('original-text-box');
  const icon = document.getElementById('toggle-icon');

  if (box.style.display === 'none') {
    box.style.display = 'block';
    icon.textContent = '▲ Amagar';
  } else {
    box.style.display = 'none';
    icon.textContent = '▼ Mostrar';
  }
}
