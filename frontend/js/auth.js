// =============================================
// auth.js - Gestió de Firebase Authentication
// =============================================

const auth = firebase.auth();

// Estat global
let currentUser = null;

// Escoltador d'estat d'autenticació
auth.onAuthStateChanged((user) => {
  currentUser = user;
  
  // Obtenim el nom de la pàgina actual (ex: "scan.html")
  const path = window.location.pathname;
  const page = path.split("/").pop();

  if (user) {
    // L'usuari ha iniciat sessió
    console.log("Sessió iniciada com:", user.email);
    
    // Si està a la pàgina de login, redirigeix a l'inici
    if (page === 'login.html') {
      window.location.href = 'index.html';
    }
  } else {
    // No hi ha sessió
    console.log("Cap sessió activa.");
    
    // Si està en una pàgina protegida, redirigeix al login
    const protectedPages = ['scan.html', 'result.html', 'profile.html'];
    if (protectedPages.includes(page)) {
      window.location.href = 'login.html';
    }
  }
});

/**
 * Retorna el token d'autenticació per enviar-lo a l'API Backend
 */
async function getAuthToken() {
  if (!currentUser) return null;
  return await currentUser.getIdToken();
}

/**
 * Tanca la sessió
 */
function logout() {
  auth.signOut().then(() => {
    localStorage.removeItem('touristtech_profile'); // Neteja cau
    window.location.href = 'login.html';
  }).catch((error) => {
    console.error("Error tancant sessió:", error);
  });
}

// Exposa les funcions globalment
window.touristAuth = {
  getAuthToken,
  logout,
  getCurrentUser: () => currentUser
};
