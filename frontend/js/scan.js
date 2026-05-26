// =============================================
// scan.js - Gestiona la càrrega i enviament de la imatge
// Envia la foto al backend i redirigeix a result.html
// =============================================

// URL del nostre servidor Express local
// En producció, aquí posem la URL de Cloud Functions
const BACKEND_URL = 'http://localhost:3000';

// Variables globals
let selectedFile = null;  // El fitxer d'imatge seleccionat

// Esperem que el DOM estigui carregat
document.addEventListener('DOMContentLoaded', function () {

  // --- Recuperem els elements del HTML ---
  const fileInput      = document.getElementById('file-input');
  const uploadZone     = document.getElementById('upload-zone');
  const imagePreview   = document.getElementById('image-preview');
  const fileNameLabel  = document.getElementById('file-name-label');
  const btnAnalyze     = document.getElementById('btn-analyze');
  const errorMsg       = document.getElementById('error-msg');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText    = document.getElementById('loading-text');
  const profileSummary = document.getElementById('profile-summary');

  // --- Mostrem el resum del perfil de l'usuari ---
  showProfileSummary(profileSummary);

  // --- Quan l'usuari selecciona un fitxer ---
  fileInput.addEventListener('change', function () {
    const file = fileInput.files[0]; // Agafem el primer fitxer
    if (!file) return;

    selectedFile = file;

    // Mostrem el nom del fitxer
    fileNameLabel.textContent = file.name;

    // Mostrem la previsualització de la imatge
    const reader = new FileReader();
    reader.onload = function (event) {
      imagePreview.src = event.target.result;
      imagePreview.style.display = 'block';
      uploadZone.classList.add('has-image');
    };
    reader.readAsDataURL(file);

    // Activem el botó d'analitzar
    btnAnalyze.disabled = false;
    errorMsg.classList.remove('visible');
  });

  // --- Botó d'analitzar: envia la imatge al backend ---
  btnAnalyze.addEventListener('click', async function () {

    // Validació: cal haver seleccionat una imatge
    if (!selectedFile) {
      errorMsg.classList.add('visible');
      return;
    }
    errorMsg.classList.remove('visible');

    // Llegim el perfil de l'usuari del localStorage
    const profileRaw = localStorage.getItem('touristtech_profile');
    const userProfile = profileRaw ? JSON.parse(profileRaw) : { language: 'ca', restrictions: [] };

    // Mostrem la pantalla de càrrega
    loadingOverlay.classList.add('visible');

    try {
      // --- Pas 1: Convertim la imatge a base64 ---
      loadingText.textContent = 'Preparant la imatge...';
      const imageBase64 = await convertToBase64(selectedFile);

      // --- Pas 2: Enviem la imatge i el perfil al backend ---
      loadingText.textContent = 'Enviant al servidor...';
      const response = await fetch(BACKEND_URL + '/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image: imageBase64,
          language: userProfile.language || 'ca',
          restrictions: userProfile.restrictions || []
        })
      });

      // --- Pas 3: Llegim la resposta ---
      loadingText.textContent = 'Analitzant amb IA...';

      if (!response.ok) {
        throw new Error('Error del servidor: ' + response.status);
      }

      const result = await response.json();
      console.log('Resposta del backend:', result);

      // --- Pas 4: Desem el resultat al sessionStorage i redirigim ---
      sessionStorage.setItem('touristtech_result', JSON.stringify(result));
      window.location.href = 'result.html';

    } catch (error) {
      // Si hi ha un error, l'amaguem i mostrem el missatge d'error
      console.error('Error en l\'anàlisi:', error);
      loadingOverlay.classList.remove('visible');
      errorMsg.textContent = '❌ Error connectant al servidor. Prova de nou.';
      errorMsg.classList.add('visible');
    }
  });

  // --- Funció auxiliar: converteix un fitxer a base64 ---
  function convertToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        // Treiem el prefix "data:image/jpeg;base64," i quedem-nos amb el contingut
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // --- Funció per mostrar el perfil actiu de l'usuari ---
  function showProfileSummary(element) {
    const profileRaw = localStorage.getItem('touristtech_profile');

    if (!profileRaw) {
      element.innerHTML = 'ℹ️ No tens perfil configurat. <a href="profile.html" style="color:var(--color-primary);">Crea\'l ara</a>';
      return;
    }

    const profile = JSON.parse(profileRaw);
    const restrictionNames = {
      gluten:      'Sense gluten',
      lactosa:     'Sense lactosa',
      vegetaria:   'Vegetarià/a',
      vega:        'Vegà/a',
      fruits_secs: 'Al·lèrgia fruits secs',
      marisc:      'Al·lèrgia marisc'
    };

    let text = '<strong>' + (profile.name || 'Usuari') + '</strong>';
    text += ' · Idioma: ' + profile.language.toUpperCase();

    if (profile.restrictions && profile.restrictions.length > 0) {
      const restrictionList = profile.restrictions.map(function (r) {
        return restrictionNames[r] || r;
      }).join(', ');
      text += '<br/>Restriccions: ' + restrictionList;
    } else {
      text += '<br/>Sense restriccions alimentàries';
    }

    element.innerHTML = text;
  }

});
