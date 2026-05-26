# TouristTech 🍽️ - Guia Multilingüe i Assistent Gastronòmic

Aplicació web que analitza fotos de menús de restaurant, els tradueix a l'idioma de l'usuari i detecta al·lèrgens automàticament.

## 🗂️ Estructura del projecte

```
hackathon/
├── frontend/           → Interfície d'usuari (HTML + CSS + JS pla)
│   ├── index.html      → Pantalla de benvinguda
│   ├── profile.html    → Configuració del perfil dietètic
│   ├── scan.html       → Càrrega de la foto del menú
│   ├── result.html     → Resultats: traducció + al·lèrgens
│   ├── css/style.css   → Tots els estils de l'app
│   └── js/
│       ├── profile.js  → Desa/carrega el perfil (localStorage)
│       ├── scan.js     → Envia la imatge al backend
│       └── result.js   → Pinta els resultats + text-to-speech
│
└── backend/            → Servidor API (Node.js + Express)
    ├── server.js       → API REST amb dades simulades (mock)
    ├── package.json    → Dependències
    └── .env.example    → Plantilla de variables d'entorn
```

## 🚀 Com executar el projecte

### Pas 1: Iniciar el backend

```bash
cd backend
npm install
node server.js
```

El servidor s'iniciarà a `http://localhost:3000`

### Pas 2: Obrir el frontend

Obre simplement el fitxer `frontend/index.html` al navegador (doble clic).

> ⚠️ **Nota**: Per evitar errors CORS amb `fetch()`, es recomana usar una extensió com "Live Server" de VS Code o executar:
> ```bash
> # Si tens Python instal·lat:
> cd frontend
> python -m http.server 8080
> # Després obre http://localhost:8080
> ```

## 🔄 Flux de l'aplicació (versió demo)

```
[Usuari] → Configura perfil (restriccions + idioma)
         → Puja foto del menú
         → Frontend envia imatge (base64) + perfil → Backend (POST /api/analyze)
         → Backend retorna: plats traduïts + alertes al·lèrgens + recomanació
         → Frontend mostra resultat + opció text-to-speech
```

## ⚙️ Endpoints de l'API

### `GET /`
Comprova que el servidor funciona.

**Resposta:**
```json
{
  "status": "ok",
  "message": "Servidor TouristTech funcionant correctament! 🚀"
}
```

### `POST /api/analyze`
Analitza una imatge de menú.

**Body (JSON):**
```json
{
  "image": "base64_de_la_imatge",
  "language": "ca",
  "restrictions": ["gluten", "lactosa"]
}
```

**Resposta:**
```json
{
  "success": true,
  "originalText": "Text extret per OCR...",
  "dishes": [
    {
      "name": "Pasta al pesto",
      "translated": "Pasta amb pesto",
      "safe": false,
      "warnings": ["Gluten"]
    }
  ],
  "recommendation": "Recomanació de l'AI...",
  "language": "ca"
}
```

## 🏗️ Arquitectura prevista (Google Cloud Platform)

```
App Mòbil
    ↓ (puja foto)
Cloud Storage
    ↓ (dispara event)
Cloud Function
    ├── Cloud SQL        → Llegeix perfil d'usuari
    ├── Cloud Vision API → Extreu text de la imatge (OCR)
    ├── Vertex AI Gemini → Analitza plats + filtra al·lèrgens
    ├── Cloud Translation→ Tradueix al idioma de l'usuari
    └── Text-to-Speech   → Genera àudio mp3
         ↓
     Resposta a l'app
```

## ⚠️ Estat actual (primera mentoria)

| Funcionalitat | Estat |
|---|---|
| Frontend (UI) | ✅ Implementat |
| Perfil d'usuari (localStorage) | ✅ Implementat |
| Càrrega d'imatge | ✅ Implementat |
| Backend Express (API mock) | ✅ Implementat |
| Text-to-speech (Web API) | ✅ Implementat |
| Cloud Vision API (OCR real) | 🔜 Per implementar |
| Vertex AI / Gemini | 🔜 Per implementar |
| Cloud Translation API | 🔜 Per implementar |
| Cloud SQL (base de dades) | 🔜 Per implementar |
| Cloud Storage (pujar imatges) | 🔜 Per implementar |

## 👥 Tecnologies usades

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express.js
- **Emmagatzematge local**: localStorage / sessionStorage
- **Àudio**: Web Speech API (SpeechSynthesis)
- **Futur - GCP**: Cloud Functions, Cloud Vision, Vertex AI, Cloud Translation, Text-to-Speech, Cloud Storage, Cloud SQL
