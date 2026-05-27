// =============================================
// result.js - Mostra els resultats amb el nou schema
// =============================================

document.addEventListener('DOMContentLoaded', function () {
  const noResultsMsg      = document.getElementById('no-results-msg');
  const resultsContainer  = document.getElementById('results-container');
  const dishesList        = document.getElementById('dishes-list');
  const originalText      = document.getElementById('original-text');
  const recommendationText= document.getElementById('recommendation-text');
  const resultSubtitle    = document.getElementById('result-subtitle');
  const audioCard         = document.getElementById('audio-card');
  const audioPlayer       = document.getElementById('audio-player');
  const audioSource       = document.getElementById('audio-source');

  const resultRaw = sessionStorage.getItem('touristtech_result');

  if (!resultRaw) {
    noResultsMsg.style.display = 'block';
    return;
  }

  const result = JSON.parse(resultRaw);
  resultsContainer.style.display = 'block';

  const dishCount = result.dishes ? result.dishes.length : 0;
  resultSubtitle.textContent = dishCount + ' plats analitzats';

  if (result.generalRecommendation) {
    recommendationText.textContent = result.generalRecommendation;
  } else {
    recommendationText.textContent = 'No hi ha recomanacions especials.';
  }

  if (result.originalText) {
    originalText.textContent = result.originalText;
  }

  if (result.dishes && result.dishes.length > 0) {
    result.dishes.forEach(dish => {
      dishesList.appendChild(createDishCard(dish));
    });
  } else {
    dishesList.innerHTML = '<p class="text-small">No s\'han detectat plats.</p>';
  }

  // Activa el reproductor d'àudio si hi ha URL (GCP Cloud TTS)
  if (result.audioUrl) {
    audioCard.style.display = 'block';
    audioSource.src = result.audioUrl;
    audioPlayer.load();
  }
});

function createDishCard(dish) {
  const card = document.createElement('div');
  
  if (dish.safetyStatus === 'SAFE') {
    card.className = 'dish-card safe';
  } else if (dish.safetyStatus === 'DANGER') {
    card.className = 'dish-card danger';
  } else {
    card.className = 'dish-card warning';
  }

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'flex-start';

  const nameEl = document.createElement('p');
  nameEl.className = 'dish-name';
  nameEl.innerHTML = dish.translatedName + (dish.isLocalSpecialty ? ' ⭐' : '');
  
  header.appendChild(nameEl);
  card.appendChild(header);

  const originalEl = document.createElement('p');
  originalEl.className = 'dish-original';
  originalEl.textContent = '🌍 Original: ' + dish.originalName;
  card.appendChild(originalEl);

  if (dish.ingredients && dish.ingredients.length > 0) {
    const ingEl = document.createElement('p');
    ingEl.className = 'dish-ingredients text-small';
    ingEl.style.marginBottom = '8px';
    ingEl.innerHTML = `<strong>Ingredients:</strong> ${dish.ingredients.join(', ')}`;
    card.appendChild(ingEl);
  }

  if (dish.recommendation) {
    const recEl = document.createElement('p');
    recEl.className = 'text-small';
    recEl.style.fontStyle = 'italic';
    recEl.style.marginBottom = '8px';
    recEl.textContent = dish.recommendation;
    card.appendChild(recEl);
  }

  const badgesEl = document.createElement('div');
  
  if (dish.safetyStatus === 'SAFE') {
    badgesEl.innerHTML += '<span class="dish-badge badge-safe">✅ Segur</span>';
  } else if (dish.safetyStatus === 'WARNING') {
    badgesEl.innerHTML += `<span class="dish-badge badge-warning">⚠️ Precaució</span>`;
  } else if (dish.safetyStatus === 'DANGER') {
    badgesEl.innerHTML += `<span class="dish-badge badge-danger">🚫 Evitar</span>`;
  }

  if (dish.safetyReason) {
    const reasonEl = document.createElement('span');
    reasonEl.className = 'text-small';
    reasonEl.style.display = 'block';
    reasonEl.style.marginTop = '4px';
    reasonEl.style.color = dish.safetyStatus === 'DANGER' ? 'var(--color-danger)' : 'var(--color-warning)';
    reasonEl.textContent = dish.safetyReason;
    badgesEl.appendChild(reasonEl);
  }

  card.appendChild(badgesEl);
  return card;
}

window.toggleOriginalText = function() {
  const box = document.getElementById('original-text-box');
  const icon = document.getElementById('toggle-icon');
  if (box.style.display === 'none') {
    box.style.display = 'block';
    icon.textContent = '▲ Amagar';
  } else {
    box.style.display = 'none';
    icon.textContent = '▼ Mostrar';
  }
};
