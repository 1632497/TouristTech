// =============================================
// server.js - Backend de TouristTech
// Servidor Express que simula la Cloud Function
// =============================================

// Importem les dependències necessàries
const express = require('express');
const cors    = require('cors');
require('dotenv').config();   // Carrega variables del fitxer .env

const app  = express();
const PORT = process.env.PORT || 3000;

// --- Middlewares ---
// Servim els fitxers estàtics del frontend des del servidor
// Això permet accedir a l'app via http://localhost:3000
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// CORS permet que el frontend (obert des d'un altre port o fitxer) pugui parlar amb el backend
app.use(cors());

// Permet rebre JSON en el body de les peticions
// Augmentem el límit perquè les imatges en base64 poden ser grans
app.use(express.json({ limit: '10mb' }));

// =============================================
// RUTA DE PROVA - GET /
// Comprova que el servidor funciona
// =============================================
app.get('/', function (req, res) {
  res.json({
    status: 'ok',
    message: 'Servidor TouristTech funcionant correctament! 🚀',
    endpoints: [
      'POST /api/analyze - Analitza una imatge de menú'
    ]
  });
});

// =============================================
// RUTA PRINCIPAL - POST /api/analyze
// Reb la imatge i el perfil, retorna el menú analitzat
// =============================================
app.post('/api/analyze', function (req, res) {

  // Llegim el body de la petició
  const { image, language, restrictions } = req.body;

  // Validació bàsica: cal que hi hagi una imatge
  if (!image) {
    return res.status(400).json({
      error: 'Cal enviar una imatge en format base64'
    });
  }

  console.log('→ Nova petició d\'anàlisi rebuda');
  console.log('  · Idioma demanat:', language || 'ca');
  console.log('  · Restriccions:', restrictions || []);
  console.log('  · Mida imatge (base64):', image.length, 'caràcters');

  // -----------------------------------------------
  // SIMULACIÓ (MOCK) del processament de la IA
  //
  // En la versió real, aquí faríem:
  //   1. Pujar la imatge a Cloud Storage
  //   2. Cridar Cloud Vision API per extreure el text (OCR)
  //   3. Cridar Gemini (Vertex AI) per analitzar els plats
  //   4. Cridar Cloud Translation API per traduir
  //   5. Cridar Cloud Text-to-Speech per generar àudio
  //
  // Per ara, retornem dades de prova (mock data)
  // per poder demostrar el flux complet sense APIs reals
  // -----------------------------------------------

  // Simula un petit retard (com si processés de debò)
  setTimeout(function () {

    // Menú de prova (simulant un restaurant italià)
    const mockDishes = [
      {
        name:       'Pasta al pesto',
        translated: getTranslation(language, 'Pasta al pesto', 'Pesto pasta', 'Pâtes au pesto'),
        safe:       !restrictions.includes('gluten') && !restrictions.includes('vega'),
        warnings:   buildWarnings(restrictions, ['gluten'])
      },
      {
        name:       'Bistecca alla fiorentina',
        translated: getTranslation(language, 'Bistec a la florentina', 'Florentine steak', 'Bifteck florentin'),
        safe:       !restrictions.includes('vegetaria') && !restrictions.includes('vega'),
        warnings:   buildWarnings(restrictions, ['carn'])  // Carn -> afecta vegetarians/vegans
      },
      {
        name:       'Tiramisù',
        translated: getTranslation(language, 'Tiramisu', 'Tiramisu', 'Tiramisu'),
        safe:       !restrictions.includes('gluten') && !restrictions.includes('lactosa') && !restrictions.includes('vega'),
        warnings:   buildWarnings(restrictions, ['gluten', 'lactosa', 'ous'])
      },
      {
        name:       'Insalata Caprese',
        translated: getTranslation(language, 'Amanida Caprese', 'Caprese salad', 'Salade Caprese'),
        safe:       !restrictions.includes('lactosa') && !restrictions.includes('vega'),
        warnings:   buildWarnings(restrictions, ['lactosa'])
      },
      {
        name:       'Risotto ai funghi',
        translated: getTranslation(language, 'Risotto de bolets', 'Mushroom risotto', 'Risotto aux champignons'),
        safe:       !restrictions.includes('lactosa'),
        warnings:   buildWarnings(restrictions, ['lactosa'])
      }
    ];

    // Recomanació generada per l'AI (simulada)
    const mockRecommendation = '🍝 La Bistecca alla Fiorentina és l\'especialitat estrella d\'aquest restaurant, un clàssic de la cuina toscana que els locals sempre demanen. Si busques una experiència autèntica, no te la perdis!';

    // Text "original" detectat per OCR (simulat)
    const mockOriginalText =
      'MENÙ DEL GIORNO\n' +
      '-------------------\n' +
      'Pasta al pesto............€9\n' +
      'Bistecca alla fiorentina..€18\n' +
      'Insalata Caprese..........€7\n' +
      'Risotto ai funghi.........€12\n' +
      '-------------------\n' +
      'DOLCI\n' +
      'Tiramisù..................€5';

    // Construïm la resposta final
    const response = {
      success:        true,
      originalText:   mockOriginalText,
      dishes:         mockDishes,
      recommendation: mockRecommendation,
      language:       language,
      processedAt:    new Date().toISOString(),
      note:           'DEMO: Dades simulades. En producció, les APIs de GCP processarien la imatge real.'
    };

    console.log('← Resposta enviada amb', mockDishes.length, 'plats analitzats');
    res.json(response);

  }, 1500); // Simulem 1.5 segons de processament

});

// =============================================
// FUNCIONS AUXILIARS
// =============================================

// Retorna la traducció correcta segons l'idioma triat
function getTranslation(language, ca, en, fr) {
  if (language === 'en') return en;
  if (language === 'fr') return fr;
  return ca;  // Per defecte: català/castellà
}

// Comprova quins al·lèrgens d'un plat xoquen amb les restriccions de l'usuari
function buildWarnings(userRestrictions, dishAllergens) {
  const warnings = [];

  const allergenNames = {
    gluten:   'Gluten',
    lactosa:  'Làctics',
    ous:      'Ous',
    carn:     'Carn (no apte per vegetarians/vegans)',
    marisc:   'Marisc',
    fruits_secs: 'Fruits secs'
  };

  // Per cada al·lergen del plat, comprovem si l'usuari té restricció
  dishAllergens.forEach(function (allergen) {

    // Cas especial: si el plat té carn i l'usuari és vegetarià o vegà
    if (allergen === 'carn') {
      if (userRestrictions.includes('vegetaria') || userRestrictions.includes('vega')) {
        warnings.push(allergenNames['carn']);
      }
    }
    // Cas normal: si l'usuari té la restricció corresponent
    else if (userRestrictions.includes(allergen)) {
      warnings.push(allergenNames[allergen] || allergen);
    }
  });

  return warnings;
}

// =============================================
// INICIEM EL SERVIDOR
// =============================================
app.listen(PORT, function () {
  console.log('');
  console.log('🚀 Servidor TouristTech iniciat!');
  console.log('📡 Escoltant a: http://localhost:' + PORT);
  console.log('📋 Rutes disponibles:');
  console.log('   GET  http://localhost:' + PORT + '/');
  console.log('   POST http://localhost:' + PORT + '/api/analyze');
  console.log('');
  console.log('💡 Recorda: Les dades actuals són SIMULADES (mock)');
  console.log('   En producció, connectaríem les APIs de Google Cloud.');
  console.log('');
});
