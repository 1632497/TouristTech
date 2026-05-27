// =============================================
// scan.js - Gestiona la càrrega i enviament de la imatge amb Auth
// =============================================

let selectedFile = null;

document.addEventListener('DOMContentLoaded', function () {
  const fileInput      = document.getElementById('file-input');
  const uploadZone     = document.getElementById('upload-zone');
  const imagePreview   = document.getElementById('image-preview');
  const fileNameLabel  = document.getElementById('file-name-label');
  const btnAnalyze     = document.getElementById('btn-analyze');
  const errorMsg       = document.getElementById('error-msg');
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText    = document.getElementById('loading-text');
  const profileSummary = document.getElementById('profile-summary');

  // Llegeix perfil del backend i mostra
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) {
      profileSummary.innerHTML = 'ℹ️ Cal iniciar sessio. <a href="login.html">Inicia sessio</a>';
      return;
    }

    try {
      const res = await fetch(`${BACKEND_URL}/api/profile?userId=${user.uid}`);
      if (res.ok) {
        const profile = await res.json();
        showProfileSummary(profileSummary, profile);
        
        // Actualitza localStorage com a fallback temporal
        localStorage.setItem(`touristtech_profile_${user.uid}`, JSON.stringify(profile));
        localStorage.setItem('touristtech_profile', JSON.stringify({
          name: profile.name,
          language: profile.language,
          restrictions: (profile.restrictions || []).map(r =>
            (r.restriction_type || r.type || r).toLowerCase()
          ),
        }));
        return;
      }

      // Si backend no troba el perfil o retorna error, fem fallback local
      const cachedProfile = localStorage.getItem(`touristtech_profile_${user.uid}`);
      if (cachedProfile) {
        showProfileSummary(profileSummary, JSON.parse(cachedProfile));
      } else {
        showProfileSummary(profileSummary, null);
      }
    } catch (err) {
      const cachedProfile = localStorage.getItem(`touristtech_profile_${user.uid}`);
      if (cachedProfile) {
        showProfileSummary(profileSummary, JSON.parse(cachedProfile));
      } else {
        showProfileSummary(profileSummary, null);
      }
    }
  });

  fileInput.addEventListener('change', function () {
    const file = fileInput.files[0];
    if (!file) return;

    selectedFile = file;
    fileNameLabel.textContent = file.name;

    const reader = new FileReader();
    reader.onload = function (event) {
      imagePreview.src = event.target.result;
      imagePreview.style.display = 'block';
      uploadZone.classList.add('has-image');
    };
    reader.readAsDataURL(file);

    btnAnalyze.disabled = false;
    errorMsg.classList.remove('visible');
  });

  btnAnalyze.addEventListener('click', async function () {
    if (!selectedFile) {
      errorMsg.classList.add('visible');
      return;
    }
    errorMsg.classList.remove('visible');

    const user = firebase.auth().currentUser;
    if (!user) {
      errorMsg.textContent = 'Cal iniciar sessió.';
      errorMsg.classList.add('visible');
      return;
    }

    const profileRaw = localStorage.getItem(`touristtech_profile_${user.uid}`) || localStorage.getItem('touristtech_profile');
    const userProfile = profileRaw ? JSON.parse(profileRaw) : { language: 'ca', restrictions: [] };
    const restrictions = Array.isArray(userProfile.restrictions)
      ? userProfile.restrictions.map(r => (typeof r === 'string' ? r : (r.restriction_type || r.type || '')).toLowerCase()).filter(Boolean)
      : [];

    loadingOverlay.classList.add('visible');

    try {
      loadingText.textContent = 'Preparant la imatge...';
      const imageBase64 = await convertToBase64(selectedFile);

      loadingText.textContent = 'Enviant al servidor...';
      const token = await user.getIdToken();
      const response = await fetch(`${ANALYZE_URL}/api/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image: imageBase64,
          language: userProfile.language || 'ca',
          restrictions,
        })
      });

      loadingText.textContent = 'Analitzant amb IA...';
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Error: ${response.status}`);
      }

      const result = await response.json();
      sessionStorage.setItem('touristtech_result', JSON.stringify(result));
      window.location.href = 'result.html';

    } catch (error) {
      console.error('Error:', error);
      loadingOverlay.classList.remove('visible');
      errorMsg.textContent = `❌ ${error.message}`;
      errorMsg.classList.add('visible');
    }
  });

  function convertToBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function showProfileSummary(element, profile) {
    if (!profile) {
      element.innerHTML = 'ℹ️ No tens perfil. <a href="profile.html">Crea\'l ara</a>';
      return;
    }

    let text = `<strong>${profile.name || 'Usuari'}</strong>`;
    text += ` · Idioma: ${(profile.language || 'ca').toUpperCase()}`;

    if (profile.restrictions && profile.restrictions.length > 0) {
      const list = profile.restrictions.map(r => r.restriction_type || r.type || r).join(', ');
      text += `<br/>Restriccions: <span style="font-size:0.75rem">${list}</span>`;
    } else {
      text += '<br/>Sense restriccions';
    }

    element.innerHTML = text;
  }
});
