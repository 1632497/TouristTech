// =============================================
// profile.js - Gestiona el perfil de l'usuari amb Firebase API
// =============================================

document.addEventListener('DOMContentLoaded', function () {
  const inputName     = document.getElementById('user-name');
  const selectLang    = document.getElementById('user-language');
  const btnSave       = document.getElementById('btn-save-profile');
  const errorMsg      = document.getElementById('error-msg');
  const savedMsg      = document.getElementById('saved-msg');
  const restrictionItems = document.querySelectorAll('.restriction-item');

  // Inicialitza l'estat visual en fer clic als labels
  restrictionItems.forEach(item => {
    const label = item.querySelector('.restriction-label');
    const checkbox = item.querySelector('input[type="checkbox"]');
    const box = item.querySelector('.restriction-checkbox');
    const select = item.querySelector('.severity-select');

    label.addEventListener('click', function () {
      checkbox.checked = !checkbox.checked;
      if (checkbox.checked) {
        label.classList.add('active');
        box.textContent = '✓';
        select.style.display = 'block';
      } else {
        label.classList.remove('active');
        box.textContent = '';
        select.style.display = 'none';
      }
    });
  });

  // Carrega el perfil des de l'API al iniciar
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) return;

    let profile = null;

    try {
      const res = await fetch(`${BACKEND_URL}/api/profile?userId=${user.uid}`);
      if (res.ok) profile = await res.json();
    } catch (e) {
      console.error('Error carregant perfil des del servidor:', e);
    }

    if (!profile || !profile.restrictions || profile.restrictions.length === 0) {
      const cached = localStorage.getItem(`touristtech_profile_${user.uid}`) || localStorage.getItem('touristtech_profile');
      if (cached) {
        try {
          profile = JSON.parse(cached);
        } catch (e) {
          console.warn('Perfil local invàlid:', e);
        }
      }
    }

    if (profile) applyProfileToForm(profile);
  });

  function applyProfileToForm(profile) {
    if (profile.name) inputName.value = profile.name;
    if (profile.language) selectLang.value = profile.language;

    restrictionItems.forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      const label = item.querySelector('.restriction-label');
      const box = item.querySelector('.restriction-checkbox');
      const select = item.querySelector('.severity-select');

      checkbox.checked = false;
      label.classList.remove('active');
      box.textContent = '';
      select.style.display = 'none';
    });

    const restrictions = normalizeProfileRestrictions(profile.restrictions);
    restrictions.forEach(r => {
      const cb = document.querySelector(`input[value="${r.restriction_type}"]`);
      if (!cb) return;

      const item = cb.closest('.restriction-item');
      const label = item.querySelector('.restriction-label');
      const box = item.querySelector('.restriction-checkbox');
      const select = item.querySelector('.severity-select');

      cb.checked = true;
      label.classList.add('active');
      box.textContent = '✓';
      select.style.display = 'block';
      if (r.severity) select.value = r.severity;
    });
  }

  function normalizeProfileRestrictions(restrictions = []) {
    return restrictions.map(r => {
      if (typeof r === 'string') {
        return { restriction_type: r.toUpperCase(), severity: 'PREFERENCE' };
      }
      return {
        restriction_type: (r.restriction_type || r.type || '').toUpperCase(),
        severity: r.severity || 'PREFERENCE',
      };
    }).filter(r => r.restriction_type);
  }

  // Desar el perfil
  btnSave.addEventListener('click', async function () {
    const user = firebase.auth().currentUser;
    if (!user) {
      errorMsg.textContent = "Has d'iniciar sessió per desar el perfil.";
      errorMsg.classList.add('visible');
      return;
    }

    if (inputName.value.trim() === '') {
      errorMsg.textContent = "Introdueix el teu nom.";
      errorMsg.classList.add('visible');
      return;
    }
    errorMsg.classList.remove('visible');

    const restrictions = [];
    document.querySelectorAll('.restriction-item input:checked').forEach(cb => {
      const select = cb.closest('.restriction-item').querySelector('.severity-select');
      restrictions.push({
        type: cb.value,
        severity: select.value || 'PREFERENCE',
        notes: ''
      });
    });

    const userProfile = {
      userId: user.uid,
      name: inputName.value.trim(),
      language: selectLang.value,
      restrictions: restrictions
    };

    btnSave.disabled = true;
    btnSave.textContent = 'Desant...';

    try {
      const res = await fetch(`${BACKEND_URL}/api/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await user.getIdToken()}`
        },
        body: JSON.stringify(userProfile)
      });

      if (!res.ok) throw new Error('Error al desar el perfil');

      // També ho desem al localStorage com a cau ràpid
      const cacheProfile = {
        name: userProfile.name,
        language: userProfile.language,
        restrictions: normalizeProfileRestrictions(restrictions),
      };
      localStorage.setItem(`touristtech_profile_${user.uid}`, JSON.stringify(cacheProfile));
      localStorage.setItem('touristtech_profile', JSON.stringify({
        name: cacheProfile.name,
        language: cacheProfile.language,
        restrictions: cacheProfile.restrictions.map(r => r.restriction_type.toLowerCase()),
      }));

      savedMsg.style.display = 'block';
      setTimeout(() => { savedMsg.style.display = 'none'; }, 3000);
    } catch (err) {
      errorMsg.textContent = "Error de connexió al desar el perfil.";
      errorMsg.classList.add('visible');
    } finally {
      btnSave.disabled = false;
      btnSave.innerHTML = '💾 Desar perfil';
    }
  });
});
