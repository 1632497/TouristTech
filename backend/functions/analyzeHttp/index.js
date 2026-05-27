'use strict';

const functions = require('@google-cloud/functions-framework');
const { Storage } = require('@google-cloud/storage');
const vision = require('@google-cloud/vision');
const { TranslationServiceClient } = require('@google-cloud/translate').v3;
const textToSpeech = require('@google-cloud/text-to-speech');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { buildGeminiPrompt } = require('./gemini_prompt');

const {
  GCP_PROJECT_ID = 'touristtech-fa0e1',
  GCP_LOCATION = 'us-central1',
  GCP_AUDIO_BUCKET = 'touristtech-audio-output',
  GEMINI_MODEL = 'gemini-2.0-flash',
  GEMINI_API_KEY,
} = process.env;

const storageClient = new Storage({ projectId: GCP_PROJECT_ID });
const visionClient = new vision.ImageAnnotatorClient();
const translateClient = new TranslationServiceClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

const LANG_TO_TTS = {
  ca: 'ca-ES', es: 'es-ES', en: 'en-US', fr: 'fr-FR',
  de: 'de-DE', it: 'it-IT', pt: 'pt-PT', ja: 'ja-JP',
  zh: 'zh-CN', ar: 'ar-XA', ko: 'ko-KR', ru: 'ru-RU',
};

function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

functions.http('analyze', async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  const path = req.path || '/';
  const isHealth = req.method === 'GET' && (path === '/' || path === '/api/health');
  const isAnalyze = req.method === 'POST' && (path === '/' || path === '/api/analyze');

  if (isHealth) {
    return res.json({
      status: 'ok',
      message: 'TouristTech Cloud Function funcionant correctament',
      endpoints: ['POST /api/analyze', 'GET /api/health'],
    });
  }

  if (!isAnalyze) {
    return res.status(404).json({ error: 'Ruta no trobada' });
  }

  const { image, language = 'ca', restrictions = [] } = req.body || {};

  if (!image) {
    return res.status(400).json({ error: 'Cal enviar una imatge en format base64' });
  }

  try {
    const imageBuffer = Buffer.from(image, 'base64');

    const [visionResult] = await visionClient.textDetection({
      image: { content: imageBuffer },
    });
    const detections = visionResult.textAnnotations;
    const ocrText = (detections && detections.length > 0) ? detections[0].description : '';

    if (!ocrText || ocrText.trim().length === 0) {
      return res.status(422).json({
        error: 'No s\'ha pogut extreure text de la imatge. Prova amb una foto més clara.',
        originalText: '',
        dishes: [],
      });
    }

    const geminiResult = await callGemini(ocrText, restrictions, language);
    const fullTranslatedText = await doTranslate(ocrText, language);

    let audioUrl = '';
    try {
      const narration = buildNarration(geminiResult);
      const audioBuf = await doTTS(narration, language);
      audioUrl = await uploadAudio(audioBuf, `audio/web/${Date.now()}.mp3`);
    } catch (ttsErr) {
      console.warn('TTS failed, skipping audio:', ttsErr.message);
    }

    return res.json({
      success: true,
      originalText: ocrText,
      fullTranslatedText,
      dishes: geminiResult.dishes,
      generalRecommendation: geminiResult.generalRecommendation || '',
      audioUrl,
      language,
      processedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Error en l\'anàlisi:', err);
    return res.status(500).json({ error: 'Error processant la imatge: ' + err.message });
  }
});

async function callGemini(ocrText, restrictions, language) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY no configurada. Crea una API key a https://aistudio.google.com/apikey');
  }

  const { systemInstruction, userPrompt } = buildGeminiPrompt(ocrText, restrictions, language);
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent(userPrompt);
  const rawText = result.response?.text?.();
  if (!rawText) throw new Error('Gemini returned empty response');

  const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.dishes || !Array.isArray(parsed.dishes)) {
    throw new Error('Gemini response missing "dishes" array');
  }

  parsed.dishes = parsed.dishes.map(d => ({
    originalName: d.originalName || 'Unknown',
    translatedName: d.translatedName || d.originalName || 'Unknown',
    ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
    safetyStatus: ['SAFE', 'WARNING', 'DANGER'].includes(d.safetyStatus) ? d.safetyStatus : 'WARNING',
    safetyReason: d.safetyReason || '',
    isLocalSpecialty: Boolean(d.isLocalSpecialty),
    recommendation: d.recommendation || '',
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

async function uploadAudio(buffer, fileName) {
  const bucket = storageClient.bucket(GCP_AUDIO_BUCKET);
  const file = bucket.file(fileName);
  await file.save(buffer, { metadata: { contentType: 'audio/mpeg' }, resumable: false });
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4', action: 'read', expires: Date.now() + 60 * 60 * 1000,
  });
  return signedUrl;
}
