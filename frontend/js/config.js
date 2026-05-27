// =============================================
// config.js - Configuració global del Frontend
// =============================================

// Perfil i historial: servidor Express local
const BACKEND_URL = 'http://localhost:3000';

// Anàlisi de menú: Cloud Function (producció GCP)
const ANALYZE_URL = 'https://analyze-wfjeu2p77a-uc.a.run.app';

// Configuració de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCa9ggQjFgZp0L-4L9ECs9wAsUJiKbbaYg",
  authDomain: "touristtech-fa0e1.firebaseapp.com",
  projectId: "touristtech-fa0e1",
  storageBucket: "touristtech-fa0e1.firebasestorage.app",
  messagingSenderId: "833912939509",
  appId: "1:833912939509:web:f309838bfdc326c6ec76bc",
  measurementId: "G-HV3C56YNDZ"
};

// Inicialitzem Firebase App
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
} else {
  console.error("Firebase SDK no s'ha carregat. Comprova l'script al HTML.");
}