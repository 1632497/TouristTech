'use strict';

const RESTRICTION_LABELS = {
  GLUTEN:     'Gluten (wheat, barley, rye, oats)',
  LACTOSE:    'Lactose / Dairy products (milk, cheese, cream, butter)',
  NUTS:       'Tree nuts and peanuts',
  SHELLFISH:  'Shellfish and crustaceans',
  EGGS:       'Eggs and egg-based products',
  SOY:        'Soy and soy-based products',
  PORK:       'Pork and pork-derived products',
  ALCOHOL:    'Alcohol and alcohol-based sauces',
  VEGETARIAN: 'Vegetarian (no meat, no fish)',
  VEGAN:      'Vegan (no animal products at all)',
  HALAL:      'Halal dietary laws (no pork, no alcohol, halal-slaughtered meat)',
  KOSHER:     'Kosher dietary laws (no pork, no shellfish, no mixing meat and dairy)',
};

const SUPPORTED_RESTRICTIONS = Object.keys(RESTRICTION_LABELS);

function buildSystemInstruction(restrictions, nativeLanguage) {
  const restrictionsList = restrictions.length > 0 ? restrictions.join(', ') : 'none';
  return `You are a dietary safety assistant for tourists. You will receive raw text extracted from a restaurant menu (possibly in any language) and a user's dietary profile.
Analyze each dish and return ONLY a valid JSON object. No explanations, no markdown, no preamble. Just the raw JSON.
User dietary restrictions: ${restrictionsList}
User native language: ${nativeLanguage}`;
}

function buildUserPrompt(ocrText, restrictions, nativeLanguage) {
  const restrictionsList = restrictions.length > 0 ? restrictions.join(', ') : 'none';
  return `Menu text:
${ocrText}
---

User dietary restrictions: ${restrictionsList}
User native language: ${nativeLanguage}

Analyze every dish in this menu. For each dish:
1. Identify the original dish name exactly as written on the menu.
2. Translate the dish name to the user's native language (${nativeLanguage}).
3. Infer the most likely ingredients based on common recipes and the dish name.
4. Cross-reference the ingredients with the user's dietary restrictions.
5. Assign a safety status:
   - "SAFE" if no conflict with any restriction
   - "WARNING" if a possible but uncertain conflict exists (e.g. "may contain traces")
   - "DANGER" if the dish clearly violates a restriction
6. Provide a safety reason explaining why the dish has that status.
7. Identify if the dish is a local specialty or traditional dish of the region.
8. Give a brief recommendation for the user about this dish.

Return ONLY a valid JSON object with this exact schema (no markdown fences, no preamble, no trailing text):

{
  "dishes": [
    {
      "originalName": "string — dish name as written on the menu",
      "translatedName": "string — dish name translated to ${nativeLanguage}",
      "ingredients": ["string — list of inferred ingredients"],
      "safetyStatus": "SAFE | WARNING | DANGER",
      "safetyReason": "string — explanation of safety assessment",
      "isLocalSpecialty": true or false,
      "recommendation": "string — brief recommendation for the user"
    }
  ],
  "generalRecommendation": "string — overall recommendation considering all safe dishes and local specialties"
}`;
}

function enrichRestrictions(restrictionCodes) {
  return restrictionCodes.map(code => {
    const upper = code.toUpperCase();
    const label = RESTRICTION_LABELS[upper];
    return label ? `${upper}: ${label}` : upper;
  });
}

function buildGeminiPrompt(ocrText, restrictions = [], nativeLanguage = 'en') {
  const enriched = enrichRestrictions(restrictions);
  return {
    systemInstruction: buildSystemInstruction(enriched, nativeLanguage),
    userPrompt: buildUserPrompt(ocrText, enriched, nativeLanguage),
  };
}

module.exports = {
  buildGeminiPrompt,
  buildSystemInstruction,
  buildUserPrompt,
  enrichRestrictions,
  RESTRICTION_LABELS,
  SUPPORTED_RESTRICTIONS,
};
