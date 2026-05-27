'use strict';

/**
 * TouristTech — Cloud Function: processMenuImage
 * ------------------------------------------------
 * Trigger : Cloud Storage → google.storage.object.finalized event
 * Runtime : Node.js 20 (Gen2)
 * Timeout : 60 seconds
 *
 * Pipeline:
 *   1. Extract userId from uploaded file path metadata
 *   2. Fetch user dietary profile + language from Cloud SQL
 *   3. Cloud Vision API  → OCR raw text extraction
 *   4. Vertex AI (Gemini 1.5 Pro) → Structured JSON analysis with dietary filtering
 *   5. Cloud Translation API → Translate output to user's native language
 *   6. Cloud Text-to-Speech (WaveNet) → Generate MP3 audio narration
 *   7. Upload MP3 to Cloud Storage with signed URL (1h expiry)
 *   8. Persist structured result to Cloud SQL (scan_history)
 *
 * Authentication: Firebase Auth UID extracted from file path convention
 * Credentials: Application Default Credentials (ADC) — never hardcoded
 */

require('dotenv').config();

const { Storage }                    = require('@google-cloud/storage');
const vision                         = require('@google-cloud/vision');
const { TranslationServiceClient }   = require('@google-cloud/translate').v3;
const textToSpeech                   = require('@google-cloud/text-to-speech');
const { VertexAI }                   = require('@google-cloud/vertexai');
const { Pool }                       = require('pg');
const functions                      = require('@google-cloud/functions-framework');
const { buildGeminiPrompt }          = require('./gemini_prompt');

// ─────────────────────────────────────────────
// Environment variables (set in Cloud Function config or .env for local)
// ─────────────────────────────────────────────
const {
  GCP_PROJECT_ID,
  GCP_LOCATION        = 'us-central1',
  GCP_IMAGES_BUCKET   = 'touristtech-menu-images',
  GCP_AUDIO_BUCKET    = 'touristtech-audio-output',
  DB_HOST,
  DB_PORT             = '5432',
  DB_NAME,
  DB_USER,
  DB_PASSWORD,
  GEMINI_MODEL        = 'gemini-1.5-pro',
} = process.env;

// ─────────────────────────────────────────────
// GCP Clients (instantiated once per cold start)
// ─────────────────────────────────────────────
const storageClient   = new Storage({ projectId: GCP_PROJECT_ID });
const visionClient    = new vision.ImageAnnotatorClient();
const translateClient = new TranslationServiceClient();
const ttsClient       = new textToSpeech.TextToSpeechClient();
const vertexAI        = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION });
const geminiModel     = vertexAI.getGenerativeModel({ model: GEMINI_MODEL });

// ─────────────────────────────────────────────
// Cloud SQL connection pool (shared across invocations)
// ─────────────────────────────────────────────
const pool = new Pool({
  host:     DB_HOST,
  port:     parseInt(DB_PORT, 10),
  database: DB_NAME,
  user:     DB_USER,
  password: DB_PASSWORD,
  max:      5,
  ssl:      process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ─────────────────────────────────────────────
// Language code to TTS locale mapping
// ─────────────────────────────────────────────
const LANGUAGE_TO_TTS_LOCALE = {
  ca: 'ca-ES', es: 'es-ES', en: 'en-US', fr: 'fr-FR',
  de: 'de-DE', it: 'it-IT', pt: 'pt-PT', ja: 'ja-JP',
  zh: 'zh-CN', ar: 'ar-XA', ko: 'ko-KR', ru: 'ru-RU',
};

// ═══════════════════════════════════════════════════════════════════════
// MAIN CLOUD FUNCTION (Cloud Storage trigger)
// ═══════════════════════════════════════════════════════════════════════
functions.cloudEvent('processMenuImage', async (cloudEvent) => {
  const startTime = Date.now();
  const data      = cloudEvent.data;
  const bucket    = data.bucket;
  const name      = data.name;  // e.g. uploads/<userId>/<timestamp>.jpg

  console.log(`[TouristTech] ▶ New image detected: gs://${bucket}/${name}`);

  // ── Extract userId from file path convention: uploads/<userId>/filename ──
  const pathParts = name.split('/');
  if (pathParts.length < 2) {
    console.error('[TouristTech] ✗ Unexpected file path format, cannot resolve userId.');
    return;
  }
  const userId = pathParts[1];
  const imageGcsUrl = `gs://${bucket}/${name}`;

  // ── Create a placeholder row in scan_history ──
  let historyId;
  try {
    historyId = await createHistoryRow(userId, imageGcsUrl);
  } catch (err) {
    console.error('[TouristTech] ✗ Failed to create history row:', err.message);
    return;
  }

  try {
    // ────────────────────────────────────────────────────────────────
    // STEP 1: Fetch user profile from Cloud SQL
    // ────────────────────────────────────────────────────────────────
    console.log(`[TouristTech] Step 1/6: Fetching profile for userId: ${userId}`);
    const profile = await getUserProfile(userId);
    if (!profile) {
      throw new Error(`No user profile found for userId: ${userId}`);
    }

    const nativeLanguage = profile.native_language || 'en';
    const restrictions   = [
      ...(profile.dietary_restrictions || []),
      ...(profile.allergies || []),
    ].filter(Boolean);

    console.log(`[TouristTech]   Language: ${nativeLanguage}, Restrictions: [${restrictions.join(', ')}]`);

    // ────────────────────────────────────────────────────────────────
    // STEP 2: Cloud Vision API → OCR
    // ────────────────────────────────────────────────────────────────
    console.log('[TouristTech] Step 2/6: Running Cloud Vision OCR...');
    const ocrText = await extractTextWithVision(imageGcsUrl);

    if (!ocrText || ocrText.trim().length === 0) {
      console.warn('[TouristTech] ⚠ Vision API returned no text (empty menu / bad photo)');
      await updateHistoryStatus(historyId, 'error', {
        error_message: 'No text could be extracted from the image. Please try a clearer photo.',
      });
      return;
    }

    console.log(`[TouristTech]   OCR text (first 200 chars): ${ocrText.slice(0, 200)}`);
    await updateHistoryStatus(historyId, 'processing', { ocr_raw_text: ocrText });

    // ────────────────────────────────────────────────────────────────
    // STEP 3: Vertex AI Gemini → Structured dish analysis
    // ────────────────────────────────────────────────────────────────
    console.log('[TouristTech] Step 3/6: Analyzing with Gemini...');
    const geminiResult = await analyzeWithGemini(ocrText, restrictions, nativeLanguage);

    console.log(`[TouristTech]   Gemini returned ${geminiResult.dishes.length} dishes`);
    await updateHistoryStatus(historyId, 'processing', {
      gemini_result: JSON.stringify(geminiResult),
    });

    // ────────────────────────────────────────────────────────────────
    // STEP 4: Cloud Translation API → Translate full text
    // ────────────────────────────────────────────────────────────────
    console.log(`[TouristTech] Step 4/6: Translating to ${nativeLanguage}...`);
    const fullTranslatedText = await translateText(ocrText, nativeLanguage);

    await updateHistoryStatus(historyId, 'processing', {
      translated_text: fullTranslatedText,
    });

    // ────────────────────────────────────────────────────────────────
    // STEP 5: Cloud Text-to-Speech → Generate MP3 narration
    // ────────────────────────────────────────────────────────────────
    console.log('[TouristTech] Step 5/6: Generating TTS audio...');
    const audioNarration = buildAudioNarration(geminiResult, nativeLanguage);
    const audioBuffer    = await synthesizeSpeech(audioNarration, nativeLanguage);

    // ────────────────────────────────────────────────────────────────
    // STEP 6: Upload MP3 + build signed URL
    // ────────────────────────────────────────────────────────────────
    console.log('[TouristTech] Step 6/6: Uploading audio...');
    const audioFileName = `audio/${userId}/${historyId}.mp3`;
    const audioSignedUrl = await uploadAudioWithSignedUrl(
      audioBuffer, GCP_AUDIO_BUCKET, audioFileName
    );

    console.log(`[TouristTech]   Audio signed URL generated (1h expiry)`);

    // ── Build final response JSON ──
    const resultJson = {
      userId,
      originalLanguage: 'auto',
      targetLanguage:   nativeLanguage,
      dishes:           geminiResult.dishes,
      audioUrl:         audioSignedUrl,
      fullTranslatedText,
      generalRecommendation: geminiResult.generalRecommendation || '',
      originalText:     ocrText,
      processedAt:      new Date().toISOString(),
    };

    // ── Persist final result to Cloud SQL ──
    await updateHistoryStatus(historyId, 'done', {
      translated_text:  fullTranslatedText,
      audio_gcs_url:    `gs://${GCP_AUDIO_BUCKET}/${audioFileName}`,
      audio_public_url: audioSignedUrl,
      source_language:  'auto',
      target_language:  nativeLanguage,
      result_json:      JSON.stringify(resultJson),
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[TouristTech] ✅ Processing complete for historyId: ${historyId} (${elapsed}s)`);

  } catch (err) {
    console.error('[TouristTech] ✗ Error during processing:', err);
    await updateHistoryStatus(historyId, 'error', {
      error_message: err.message,
    }).catch(() => {});
  }
});


// ═══════════════════════════════════════════════════════════════════════
// HELPER: Fetch user profile from Cloud SQL
// ═══════════════════════════════════════════════════════════════════════
async function getUserProfile(userId) {
  const query = `
    SELECT u.id, u.display_name, u.email,
           p.native_language, p.dietary_restrictions, p.allergies, p.extra_notes
    FROM   users u
    LEFT JOIN user_preferences p ON p.user_id = u.id
    WHERE  u.id = $1 OR u.firebase_uid = $1
    LIMIT  1
  `;
  const result = await pool.query(query, [userId]);
  return result.rows[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Insert a new scan_history row (status = pending)
// ═══════════════════════════════════════════════════════════════════════
async function createHistoryRow(userId, imageGcsUrl) {
  // First resolve the internal user UUID from firebase_uid or direct id
  const userQuery = `SELECT id FROM users WHERE id::text = $1 OR firebase_uid = $1 LIMIT 1`;
  const userResult = await pool.query(userQuery, [userId]);

  if (userResult.rows.length === 0) {
    throw new Error(`User not found: ${userId}`);
  }

  const internalUserId = userResult.rows[0].id;

  const query = `
    INSERT INTO scan_history (user_id, image_url, status)
    VALUES ($1, $2, 'pending')
    RETURNING id
  `;
  const result = await pool.query(query, [internalUserId, imageGcsUrl]);
  return result.rows[0].id;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Update scan_history row with partial data
// ═══════════════════════════════════════════════════════════════════════
async function updateHistoryStatus(historyId, status, fields = {}) {
  const setClauses = ['status = $2'];
  const values     = [historyId, status];
  let idx          = 3;

  for (const [col, val] of Object.entries(fields)) {
    setClauses.push(`${col} = $${idx}`);
    values.push(val);
    idx++;
  }

  const query = `
    UPDATE scan_history
    SET    ${setClauses.join(', ')}, updated_at = NOW()
    WHERE  id = $1
  `;
  await pool.query(query, values);
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Cloud Vision API → OCR text extraction
// ═══════════════════════════════════════════════════════════════════════
async function extractTextWithVision(gcsUri) {
  const [result] = await visionClient.textDetection({
    image: { source: { imageUri: gcsUri } },
  });

  const detections = result.textAnnotations;
  if (!detections || detections.length === 0) {
    return '';
  }
  // First annotation contains the full concatenated text
  return detections[0].description || '';
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Vertex AI Gemini → Structured dish analysis
// ═══════════════════════════════════════════════════════════════════════
async function analyzeWithGemini(ocrText, restrictions, nativeLanguage) {
  const { systemInstruction, userPrompt } = buildGeminiPrompt(
    ocrText, restrictions, nativeLanguage
  );

  const request = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      maxOutputTokens: 2048,
      temperature:     0.2,
      responseMimeType: 'application/json',
    },
  };

  const result   = await geminiModel.generateContent(request);
  const response = result.response;
  const rawText  = response?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned an empty response');
  }

  // Parse the JSON response — Gemini should return pure JSON
  let parsed;
  try {
    // Strip any accidental markdown fences if present
    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error('[TouristTech] Failed to parse Gemini JSON:', rawText.slice(0, 500));
    throw new Error(`Gemini returned invalid JSON: ${parseErr.message}`);
  }

  // Validate structure
  if (!parsed.dishes || !Array.isArray(parsed.dishes)) {
    throw new Error('Gemini response missing "dishes" array');
  }

  // Normalize each dish to ensure required fields exist
  parsed.dishes = parsed.dishes.map(dish => ({
    originalName:   dish.originalName   || 'Unknown',
    translatedName: dish.translatedName || dish.originalName || 'Unknown',
    ingredients:    Array.isArray(dish.ingredients) ? dish.ingredients : [],
    safetyStatus:   ['SAFE', 'WARNING', 'DANGER'].includes(dish.safetyStatus)
                      ? dish.safetyStatus : 'WARNING',
    safetyReason:   dish.safetyReason   || '',
    isLocalSpecialty: Boolean(dish.isLocalSpecialty),
    recommendation: dish.recommendation || '',
  }));

  return parsed;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Cloud Translation API v3 → translate text
// ═══════════════════════════════════════════════════════════════════════
async function translateText(text, targetLanguage) {
  const parent = `projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}`;

  const [response] = await translateClient.translateText({
    parent,
    contents:           [text],
    mimeType:           'text/plain',
    targetLanguageCode: targetLanguage,
  });

  return response.translations?.[0]?.translatedText || text;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Build audio narration text from Gemini result
// ═══════════════════════════════════════════════════════════════════════
function buildAudioNarration(geminiResult, language) {
  let narration = '';

  // General recommendation first
  if (geminiResult.generalRecommendation) {
    narration += geminiResult.generalRecommendation + '. ';
  }

  // Then each dish
  if (geminiResult.dishes && geminiResult.dishes.length > 0) {
    geminiResult.dishes.forEach((dish, i) => {
      narration += `${dish.translatedName}. `;

      if (dish.safetyStatus === 'DANGER') {
        narration += `Attention: ${dish.safetyReason}. `;
      } else if (dish.safetyStatus === 'WARNING') {
        narration += `Caution: ${dish.safetyReason}. `;
      } else {
        narration += 'Safe for you. ';
      }

      if (dish.isLocalSpecialty) {
        narration += 'This is a local specialty. ';
      }
    });
  }

  return narration || 'No dishes were detected in this menu.';
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Cloud Text-to-Speech → synthesize audio (WaveNet)
// ═══════════════════════════════════════════════════════════════════════
async function synthesizeSpeech(text, languageCode) {
  // Map to TTS locale
  const ttsLocale = LANGUAGE_TO_TTS_LOCALE[languageCode] || `${languageCode}-${languageCode.toUpperCase()}`;

  // Truncate text to TTS limit (5000 bytes)
  const truncatedText = text.length > 4500
    ? text.slice(0, 4500) + '...'
    : text;

  const [response] = await ttsClient.synthesizeSpeech({
    input:       { text: truncatedText },
    voice:       {
      languageCode: ttsLocale,
      ssmlGender:   'NEUTRAL',
      // Prefer WaveNet for higher quality, fall back to Standard
      name:         `${ttsLocale}-Wavenet-A`,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate:  0.95,
      pitch:         0,
    },
  });

  return response.audioContent;
}

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Upload audio to Cloud Storage with signed URL (1h expiry)
// ═══════════════════════════════════════════════════════════════════════
async function uploadAudioWithSignedUrl(audioBuffer, bucketName, destFileName) {
  const bucket = storageClient.bucket(bucketName);
  const file   = bucket.file(destFileName);

  // Upload the MP3 file
  await file.save(audioBuffer, {
    metadata:  { contentType: 'audio/mpeg' },
    resumable: false,
  });

  // Generate a signed URL with 1-hour expiry
  const [signedUrl] = await file.getSignedUrl({
    version: 'v4',
    action:  'read',
    expires: Date.now() + 60 * 60 * 1000, // 1 hour
  });

  return signedUrl;
}
