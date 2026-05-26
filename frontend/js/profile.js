// =============================================
// profile.js - Gestiona el perfil de l'usuari
// Desa les dades al localStorage del navegador
// =============================================

// Esperem que el DOM estigui carregat completament
document.addEventListener('DOMContentLoaded', function () {

  // --- Recuperem tots els elements del HTML ---
  const inputName     = document.getElementById('user-name');
  const selectLang    = document.getElementById('user-language');
  const btnSave       = document.getElementById('btn-save-profile');
  const errorMsg      = document.getElementById('error-msg');
  const savedMsg      = document.getElementById('saved-msg');

  // Tots els elements de restricció alimentària
  const restrictionLabels = document.querySelectorAll('.restriction-item');

  // --- Carreguem el perfil desat (si en tenim) ---
  loadSavedProfile();

  // --- Gestionem el clic a cada restricció alimentària ---
  restrictionLabels.forEach(function (label) {
    label.addEventListener('click', function () {
      // Busquem el checkbox dins d'aquest label
      const checkbox = label.querySelector('input[type="checkbox"]');
      const box = label.querySelector('.restriction-checkbox');

      // Alternem l'estat del checkbox
      checkbox.checked = !checkbox.checked;

      // Actualitzem la classe visual 'active'
      if (checkbox.checked) {
        label.classList.add('active');
        box.textContent = '✓';  // Mostrem una marca de verificació
      } else {
        label.classList.remove('active');
        box.textContent = '';   // Buidem la marca
      }
    });
  });

  // --- Botó de desar el perfil ---
  btnSave.addEventListener('click', function () {
    // Validació: el nom és obligatori
    if (inputName.value.trim() === '') {
      errorMsg.classList.add('visible');
      return;
    }
    errorMsg.classList.remove('visible');

    // Recollim les restriccions marcades
    const restrictions = [];
    document.querySelectorAll('.restriction-item input:checked').forEach(function (cb) {
      restrictions.push(cb.value);
    });

    // Creem l'objecte del perfil
    const userProfile = {
      name: inputName.value.trim(),
      language: selectLang.value,
      restrictions: restrictions
    };

    // Desem al localStorage (persisteix entre sessions)
    localStorage.setItem('touristtech_profile', JSON.stringify(userProfile));

    // Mostrem el missatge d'èxit
    savedMsg.style.display = 'block';
    setTimeout(function () {
      savedMsg.style.display = 'none';
    }, 3000);

    console.log('Perfil desat:', userProfile); // Per debugar
  });

  // --- Funció per carregar el perfil desat prèviament ---
  function loadSavedProfile() {
    const saved = localStorage.getItem('touristtech_profile');
    if (!saved) return; // Si no hi ha perfil, no fem res

    const profile = JSON.parse(saved);

    // Omplim el nom i l'idioma
    if (profile.name) inputName.value = profile.name;
    if (profile.language) selectLang.value = profile.language;

    // Marquem les restriccions que estaven actives
    if (profile.restrictions) {
      profile.restrictions.forEach(function (restriction) {
        const checkbox = document.querySelector('input[value="' + restriction + '"]');
        if (checkbox) {
          const label = checkbox.closest('.restriction-item');
          const box   = label.querySelector('.restriction-checkbox');
          checkbox.checked = true;
          label.classList.add('active');
          box.textContent = '✓';
        }
      });
    }
  }

});
