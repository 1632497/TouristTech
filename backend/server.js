// =============================================
// server.js - Backend de TouristTech (Producció)
// Servidor Express que integra totes les APIs de GCP
// Pot funcionar com a backend local o com a alternativa
// a la Cloud Function per a desenvolupament.
// =============================================

'use strict';

const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
require('dotenv').config();

// GCP SDK imports
const { Storage }                  = require('@google-cloud/storage');
const vision                       = require('@google-cloud/vision');
const { TranslationServiceClient } = require('@google-cloud/translate').v3;
const textToSpeech                 = require('@google-cloud/text-to-speech');
const { VertexAI }                 = require('@google-cloud/vertexai');
const { Pool }                     = require('pg');

// Gemini prompt module (shared with Cloud Function)
const { buildGeminiPrompt } = require('./functions/processMenuImage/gemini_prompt');

// ─── Environment variables ───
const {
  PORT              = 3000,
  GCP_PROJECT_ID    = 'touristtech-prod',
  GCP_LOCATION      = 'us-central1',
  GCP_IMAGES_BUCKET = 'touristtech-menu-images',
  GCP_AUDIO_BUCKET  = 'touristtech-audio-output',
  GEMINI_MODEL      = 'gemini-2.0-flash-001',
  DB_HOST,
  DB_PORT           = '5432',
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  USE_MOCK          = 'false',  // Set to 'true' to use mock data (no GCP APIs)
} = process.env;

// ─── Express setup ───
const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ─── GCP Clients (only initialized if not in mock mode) ───
let storageClient, visionClient, translateClient, ttsClient, geminiModel, pool;

if (USE_MOCK !== 'true') {
  storageClient   = new Storage({ projectId: GCP_PROJECT_ID });
  visionClient    = new vision.ImageAnnotatorClient();
  translateClient = new TranslationServiceClient();
  ttsClient       = new textToSpeech.TextToSpeechClient();

  const vertexAI  = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION });
  geminiModel     = vertexAI.getGenerativeModel({ model: GEMINI_MODEL });

  if (DB_HOST) {
    pool = new Pool({
      host: DB_HOST, port: parseInt(DB_PORT, 10),
      database: DB_NAME, user: DB_USER, password: DB_PASSWORD,
      max: 5,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
}

// ─── Language mapping for TTS ───
const LANG_TO_TTS = {
  ca: 'ca-ES', es: 'es-ES', en: 'en-US', fr: 'fr-FR',
  de: 'de-DE', it: 'it-IT', pt: 'pt-PT', ja: 'ja-JP',
  zh: 'zh-CN', ar: 'ar-XA', ko: 'ko-KR', ru: 'ru-RU',
};


// =============================================
// RUTA: GET / — Health check
// =============================================
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Servidor TouristTech funcionant correctament! 🚀',
    mode: USE_MOCK === 'true' ? 'mock' : 'production',
    endpoints: [
      'POST /api/analyze  — Analitza una imatge de menú',
      'GET  /api/profile  — Obté el perfil de l\'usuari',
      'PUT  /api/profile  — Actualitza el perfil',
      'GET  /api/history  — Historial d\'escanejos',
    ],
  });
});


// =============================================
// RUTA: POST /api/analyze — Analitza una imatge de menú
// =============================================
app.post('/api/analyze', async (req, res) => {
  const { image, language, restrictions } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Cal enviar una imatge en format base64' });
  }

  console.log('→ Nova petició d\'anàlisi rebuda');
  console.log('  · Idioma:', language || 'ca');
  console.log('  · Restriccions:', restrictions || []);
  console.log('  · Mida imatge (base64):', image.length, 'caràcters');

  // ── MOCK MODE ──
  if (USE_MOCK === 'true') {
    return sendMockResponse(res, language, restrictions);
  }

  // ── PRODUCTION MODE ──
  try {
    // Step 1: Convert base64 to buffer for Vision API
    const imageBuffer = Buffer.from(image, 'base64');

    // Step 2: Cloud Vision OCR
    console.log('  [1/4] Cloud Vision OCR...');
    const [visionResult] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });
    const detections = visionResult.textAnnotations;
    const ocrText = (detections && detections.length > 0)
      ? detections[0].description
      : '';

    if (!ocrText || ocrText.trim().length === 0) {
      return res.status(422).json({
        error: 'No s\'ha pogut extreure text de la imatge. Prova amb una foto més clara.',
        originalText: '',
        dishes: [],
      });
    }

    console.log(`  [1/4] OCR: ${ocrText.slice(0, 150)}...`);

    // Step 3: Gemini analysis
    console.log('  [2/4] Gemini analysis...');
    const geminiResult = await callGemini(ocrText, restrictions || [], language || 'ca');
    console.log(`  [2/4] Gemini returned ${geminiResult.dishes.length} dishes`);

    // Step 4: Cloud Translation
    console.log('  [3/4] Translating...');
    const fullTranslatedText = await doTranslate(ocrText, language || 'ca');

    // Step 5: Cloud Text-to-Speech
    console.log('  [4/4] Generating TTS audio...');
    let audioUrl = '';
    try {
      const narration  = buildNarration(geminiResult, language || 'ca');
      const audioBuf   = await doTTS(narration, language || 'ca');
      const audioFile  = `audio/web/${Date.now()}.mp3`;
      audioUrl         = await uploadAudio(audioBuf, GCP_AUDIO_BUCKET, audioFile);
    } catch (ttsErr) {
      console.warn('  ⚠ TTS failed, skipping audio:', ttsErr.message);
    }

    // Build response
    const response = {
      success:        true,
      originalText:   ocrText,
      fullTranslatedText,
      dishes:         geminiResult.dishes,
      generalRecommendation: geminiResult.generalRecommendation || '',
      audioUrl,
      language,
      processedAt:    new Date().toISOString(),
    };

    console.log('← Resposta enviada amb', geminiResult.dishes.length, 'plats');
    res.json(response);

  } catch (err) {
    console.error('✗ Error en l\'anàlisi:', err);
    res.status(500).json({ error: 'Error processant la imatge: ' + err.message });
  }
});


// Emmagatzematge local quan no hi ha Cloud SQL configurat
const MOCK_PROFILES_FILE = path.join(__dirname, 'data', 'mock-profiles.json');

function normalizeRestrictions(restrictions = []) {
  return restrictions.map(r => {
    if (typeof r === 'string') {
      return { restriction_type: r.toUpperCase(), severity: 'PREFERENCE', notes: null };
    }
    return {
      restriction_type: (r.restriction_type || r.type || '').toUpperCase(),
      severity: (r.severity || 'PREFERENCE').toUpperCase(),
      notes: r.notes || null,
    };
  }).filter(r => r.restriction_type);
}

function loadMockProfiles() {
  try {
    if (fs.existsSync(MOCK_PROFILES_FILE)) {
      return JSON.parse(fs.readFileSync(MOCK_PROFILES_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('No s\'han pogut carregar perfils locals:', err.message);
  }
  return {};
}

function saveMockProfiles(profiles) {
  fs.mkdirSync(path.dirname(MOCK_PROFILES_FILE), { recursive: true });
  fs.writeFileSync(MOCK_PROFILES_FILE, JSON.stringify(profiles, null, 2), 'utf8');
}

function formatMockProfile(profile) {
  return {
    name: profile.name || 'Usuari',
    language: profile.language || 'ca',
    restrictions: normalizeRestrictions(profile.restrictions || []),
  };
}

const mockProfiles = loadMockProfiles();

// =============================================
// RUTA: GET /api/profile?userId=...
// =============================================
app.get('/api/profile', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (!pool) {
    const profile = mockProfiles[userId] || { name: 'Demo', language: 'ca', restrictions: [] };
    return res.json(formatMockProfile(profile));
  }

  try {
    const userQ = await pool.query(
      'SELECT id, display_name, native_language, email FROM users WHERE id::text = $1 OR firebase_uid = $1 LIMIT 1',
      [userId]
    );
    if (userQ.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const user = userQ.rows[0];

    const restrictionsQ = await pool.query(
      'SELECT restriction_type, severity, notes FROM dietary_profiles WHERE user_id = $1',
      [user.id]
    );

    res.json({
      id:          user.id,
      name:        user.display_name,
      email:       user.email,
      language:    user.native_language,
      restrictions: restrictionsQ.rows,
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: err.message });
  }
});


// =============================================
// RUTA: PUT /api/profile
// =============================================
app.put('/api/profile', async (req, res) => {
  const { userId, name, language, restrictions } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (!pool) {
    mockProfiles[userId] = formatMockProfile({ name, language, restrictions });
    saveMockProfiles(mockProfiles);
    return res.json({ success: true, mode: 'local' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert user
    await client.query(`
      INSERT INTO users (firebase_uid, email, display_name, native_language)
      VALUES ($1, $1 || '@touristtech.app', $2, $3)
      ON CONFLICT (firebase_uid) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        native_language = EXCLUDED.native_language
    `, [userId, name || 'User', language || 'ca']);

    // Get user internal id
    const userQ = await client.query(
      'SELECT id FROM users WHERE firebase_uid = $1', [userId]
    );
    const internalId = userQ.rows[0].id;

    // Clear existing restrictions and re-insert
    await client.query('DELETE FROM dietary_profiles WHERE user_id = $1', [internalId]);

    if (restrictions && restrictions.length > 0) {
      for (const r of restrictions) {
        const rType    = (r.type || r).toString().toUpperCase();
        const severity = (r.severity || 'PREFERENCE').toUpperCase();
        const notes    = r.notes || null;

        await client.query(`
          INSERT INTO dietary_profiles (user_id, restriction_type, severity, notes)
          VALUES ($1, $2::restriction_type, $3::restriction_severity, $4)
          ON CONFLICT (user_id, restriction_type) DO UPDATE SET
            severity = EXCLUDED.severity, notes = EXCLUDED.notes
        `, [internalId, rType, severity, notes]);
      }
    }

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error updating profile:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});


// =============================================
// RUTA: GET /api/history?userId=...
// =============================================
app.get('/api/history', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  if (!pool) return res.json([]);

  try {
    const result = await pool.query(`
      SELECT id, image_url, result_json, status, created_at
      FROM scan_history
      WHERE user_id IN (SELECT id FROM users WHERE id::text = $1 OR firebase_uid = $1)
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: err.message });
  }
});


// =============================================
// GCP API HELPERS (Production mode)
// =============================================

async function callGemini(ocrText, restrictions, language) {
  const { systemInstruction, userPrompt } = buildGeminiPrompt(ocrText, restrictions, language);

  const result = await geminiModel.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2, responseMimeType: 'application/json' },
  });

  const rawText = result.response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned empty response');

  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.dishes || !Array.isArray(parsed.dishes)) {
    throw new Error('Gemini response missing "dishes" array');
  }

  parsed.dishes = parsed.dishes.map(d => ({
    originalName:    d.originalName   || 'Unknown',
    translatedName:  d.translatedName || d.originalName || 'Unknown',
    ingredients:     Array.isArray(d.ingredients) ? d.ingredients : [],
    safetyStatus:    ['SAFE','WARNING','DANGER'].includes(d.safetyStatus) ? d.safetyStatus : 'WARNING',
    safetyReason:    d.safetyReason   || '',
    isLocalSpecialty: Boolean(d.isLocalSpecialty),
    recommendation:  d.recommendation || '',
  }));

  return parsed;
}

async function doTranslate(text, targetLang) {
  const parent = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}`;
  const [resp] = await translateClient.translateText({
    parent, contents: [text], mimeType: 'text/plain', targetLanguageCode: targetLang,
  });
  return resp.translations?.[0]?.translatedText || text;
}

function buildNarration(geminiResult) {
  let text = '';
  if (geminiResult.generalRecommendation) text += geminiResult.generalRecommendation + '. ';
  (geminiResult.dishes || []).forEach(d => {
    text += `${d.translatedName}. `;
    if (d.safetyStatus === 'DANGER') text += `Atenció: ${d.safetyReason}. `;
    else if (d.safetyStatus === 'WARNING') text += `Precaució: ${d.safetyReason}. `;
    else text += 'Segur per a tu. ';
    if (d.isLocalSpecialty) text += 'Especialitat local. ';
  });
  return text || 'No s\'han detectat plats.';
}

async function doTTS(text, lang) {
  const locale = LANG_TO_TTS[lang] || `${lang}-${lang.toUpperCase()}`;
  const truncated = text.length > 4500 ? text.slice(0, 4500) + '...' : text;
  const [resp] = await ttsClient.synthesizeSpeech({
    input: { text: truncated },
    voice: { languageCode: locale, ssmlGender: 'NEUTRAL' },
    audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
  });
  return resp.audioContent;
}

async function uploadAudio(buffer, bucketName, fileName) {
  const bucket = storageClient.bucket(bucketName);
  const file = bucket.file(fileName);
  await file.save(buffer, { metadata: { contentType: 'audio/mpeg' }, resumable: false });
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000,
  });
  return signedUrl;
}


// =============================================
// MOCK DATA (when USE_MOCK=true or no GCP credentials)
// =============================================
function sendMockResponse(res, language, restrictions) {
  setTimeout(() => {
    const rest = restrictions || [];

    const mockDishes = [
      {
        originalName: 'Pasta al pesto',
        translatedName: getMockTranslation(language, 'Pasta amb pesto', 'Pesto pasta', 'Pâtes au pesto'),
        ingredients: ['pasta (gluten)', 'basil', 'pine nuts', 'parmesan (lactose)', 'olive oil', 'garlic'],
        safetyStatus: (rest.includes('gluten') || rest.includes('GLUTEN')) ? 'DANGER'
                    : (rest.includes('lactosa') || rest.includes('LACTOSE') || rest.includes('fruits_secs') || rest.includes('NUTS')) ? 'WARNING'
                    : 'SAFE',
        safetyReason: rest.includes('gluten') || rest.includes('GLUTEN') ? 'Contains gluten (pasta)' : '',
        isLocalSpecialty: false,
        recommendation: 'Classic Italian pasta dish.',
      },
      {
        originalName: 'Bistecca alla fiorentina',
        translatedName: getMockTranslation(language, 'Bistec a la florentina', 'Florentine steak', 'Bifteck florentin'),
        ingredients: ['beef', 'olive oil', 'rosemary', 'salt', 'pepper'],
        safetyStatus: (rest.includes('vegetaria') || rest.includes('VEGETARIAN') || rest.includes('vega') || rest.includes('VEGAN')) ? 'DANGER' : 'SAFE',
        safetyReason: (rest.includes('vegetaria') || rest.includes('VEGETARIAN')) ? 'Contains meat' : '',
        isLocalSpecialty: true,
        recommendation: 'Iconic Tuscan specialty! A must-try.',
      },
      {
        originalName: 'Tiramisù',
        translatedName: 'Tiramisú',
        ingredients: ['mascarpone (lactose)', 'eggs', 'sugar', 'coffee', 'ladyfingers (gluten)', 'cocoa'],
        safetyStatus: (rest.includes('gluten') || rest.includes('GLUTEN') || rest.includes('lactosa') || rest.includes('LACTOSE') || rest.includes('EGGS')) ? 'DANGER' : 'SAFE',
        safetyReason: 'Contains gluten, lactose, and eggs.',
        isLocalSpecialty: true,
        recommendation: 'Classic Italian dessert.',
      },
      {
        originalName: 'Insalata Caprese',
        translatedName: getMockTranslation(language, 'Amanida Caprese', 'Caprese salad', 'Salade Caprese'),
        ingredients: ['tomatoes', 'mozzarella (lactose)', 'basil', 'olive oil'],
        safetyStatus: (rest.includes('lactosa') || rest.includes('LACTOSE') || rest.includes('vega') || rest.includes('VEGAN')) ? 'WARNING' : 'SAFE',
        safetyReason: rest.includes('lactosa') || rest.includes('LACTOSE') ? 'Contains mozzarella (dairy)' : '',
        isLocalSpecialty: false,
        recommendation: 'Light and fresh option.',
      },
      {
        originalName: 'Risotto ai funghi',
        translatedName: getMockTranslation(language, 'Risotto de bolets', 'Mushroom risotto', 'Risotto aux champignons'),
        ingredients: ['arborio rice', 'mushrooms', 'butter (lactose)', 'parmesan (lactose)', 'onion', 'white wine (alcohol)'],
        safetyStatus: (rest.includes('lactosa') || rest.includes('LACTOSE')) ? 'WARNING'
                    : (rest.includes('ALCOHOL') || rest.includes('alcohol')) ? 'WARNING'
                    : 'SAFE',
        safetyReason: 'May contain dairy and traces of alcohol from white wine.',
        isLocalSpecialty: false,
        recommendation: 'Rich and comforting dish.',
      },
    ];

    const response = {
      success: true,
      originalText: 'MENÙ DEL GIORNO\n-------------------\nPasta al pesto............€9\nBistecca alla fiorentina..€18\nInsalata Caprese..........€7\nRisotto ai funghi.........€12\n-------------------\nDOLCI\nTiramisù..................€5',
      fullTranslatedText: 'Menú del dia: Pasta amb pesto, Bistec a la florentina, Amanida Caprese, Risotto de bolets, Tiramisú',
      dishes: mockDishes,
      generalRecommendation: '⭐ La Bistecca alla Fiorentina és l\'especialitat estrella d\'aquest restaurant, un clàssic de la cuina toscana!',
      audioUrl: '',
      language,
      processedAt: new Date().toISOString(),
      note: 'DEMO: Dades simulades. Activa USE_MOCK=false per connectar les APIs de GCP.',
    };

    console.log('← Resposta MOCK enviada amb', mockDishes.length, 'plats');
    res.json(response);
  }, 1500);
}

function getMockTranslation(lang, ca, en, fr) {
  if (lang === 'en') return en;
  if (lang === 'fr') return fr;
  return ca;
}


// =============================================
// INICIEM EL SERVIDOR
// =============================================
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 Servidor TouristTech iniciat!');
  console.log(`📡 Escoltant a: http://localhost:${PORT}`);
  console.log(`🔧 Mode: ${USE_MOCK === 'true' ? 'MOCK (dades simulades)' : 'PRODUCCIÓ (APIs GCP)'}`);
  console.log('');
  console.log('📋 Rutes disponibles:');
  console.log(`   GET  http://localhost:${PORT}/api/health`);
  console.log(`   POST http://localhost:${PORT}/api/analyze`);
  console.log(`   GET  http://localhost:${PORT}/api/profile?userId=...`);
  console.log(`   PUT  http://localhost:${PORT}/api/profile`);
  console.log(`   GET  http://localhost:${PORT}/api/history?userId=...`);
  console.log('');
});
