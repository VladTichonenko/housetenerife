'use strict';

/**
 * Vision: описание входящего фото через OpenRouter (GPT-4.1 и др.).
 */

const { chatCompletions, AI_MODEL } = require('./ai-client');
const { normalizeSalesLang } = require('./sales-localization');

const MAX_BASE64_CHARS = Math.min(
  12_000_000,
  Math.max(500_000, parseInt(process.env.PHOTO_VISION_MAX_BASE64, 10) || 6_000_000)
);
const VISION_TIMEOUT_MS = Math.min(
  120000,
  Math.max(15000, parseInt(process.env.PHOTO_VISION_TIMEOUT_MS, 10) || 60000)
);

function visionSystemPrompt(lang) {
  const code = normalizeSalesLang(lang);
  if (code === 'es') {
    return `Eres analista inmobiliario de House Tenerife. Describe la foto en español (4–8 frases cortas) para el chat de ventas.
Incluye: tipo de inmueble/espacio, estilo, estado, posibles zonas/vistas, si parece listing profesional o foto de cliente, y 1–2 preguntas útiles.
Si no es inmobiliario — dilo y sugiere volver a vivienda/inversión. Sin inventar dirección ni precio exacto.`;
  }
  if (code === 'de') {
    return `Du bist Immobilienanalyst bei House Tenerife. Beschreibe das Foto auf Deutsch (4–8 kurze Sätze) für den Verkaufschat.
Enthalten: Objekttyp, Stil, Zustand, mögliche Lage/Ausblick, Profi-Listing oder Kundenfoto, 1–2 sinnvolle Fragen.
Wenn nicht immobilienbezogen — sag es und lenke zurück zu Wohnen/Investment. Keine erfundene Adresse/Preis.`;
  }
  if (code === 'fr') {
    return `Tu es analyste immobilier chez House Tenerife. Décris la photo en français (4–8 phrases courtes) pour le chat commercial.
Inclure: type de bien, style, état, zone/vue possible, listing pro ou photo client, 1–2 questions utiles.
Si hors immobilier — dis-le et ramène à habitation/investissement. Pas d’adresse/prix inventés.`;
  }
  if (code === 'pl') {
    return `Jesteś analitykiem nieruchomości House Tenerife. Opisz zdjęcie po polsku (4–8 krótkich zdań) na chat sprzedażowy.
Uwzględnij: typ obiektu, styl, stan, możliwą lokalizację/widok, listing profesjonalny czy zdjęcie klienta, 1–2 pytania.
Jeśli nie o nieruchomościach — napisz i wróć do mieszkania/inwestycji. Bez wymyślonego adresu/ceny.`;
  }
  if (code === 'nl') {
    return `Je bent vastgoedanalist bij House Tenerife. Beschrijf de foto in het Nederlands (4–8 korte zinnen) voor de saleschat.
Vermeld: type object, stijl, staat, mogelijke zone/uitzicht, professionele listing of klantfoto, 1–2 nuttige vragen.
Als het geen vastgoed is — zeg dat en stuur terug naar wonen/investering. Geen verzonnen adres/prijs.`;
  }
  if (code === 'en') {
    return `You are a House Tenerife real-estate analyst. Describe the photo in English (4–8 short sentences) for the sales chat.
Include: property/space type, style, condition, possible area/views, professional listing vs client photo, 1–2 useful questions.
If not real-estate related — say so and steer back to living/investment. Do not invent address or exact price.`;
  }
  return `Ты аналитик недвижимости House Tenerife. Опиши фото по-русски (4–8 коротких фраз) для WhatsApp-продаж.
Укажи: тип объекта/пространства, стиль, состояние, возможные район/вид, профессиональный листинг или фото клиента, 1–2 полезных вопроса.
Если не про недвижимость — скажи и верни к жилью/инвестициям. Не выдумывай адрес и точную цену.`;
}

function userVisionText(lang, caption) {
  const code = normalizeSalesLang(lang);
  const cap = String(caption || '').trim();
  const base =
    code === 'es'
      ? 'El cliente envió esta foto en WhatsApp.'
      : code === 'de'
        ? 'Der Kunde hat dieses Foto in WhatsApp gesendet.'
        : code === 'en'
          ? 'The client sent this photo on WhatsApp.'
          : code === 'nl'
            ? 'De klant stuurde deze foto via WhatsApp.'
            : code === 'pl'
              ? 'Klient wysłał to zdjęcie na WhatsApp.'
              : code === 'fr'
                ? 'Le client a envoyé cette photo sur WhatsApp.'
                : 'Клиент прислал это фото в WhatsApp.';
  if (!cap) return `${base} Подписи нет — опиши по изображению.`;
  return `${base}\nПодпись / caption: «${cap}»`;
}

/**
 * @param {{ mimetype?: string, data?: string }} media - from msg.downloadMedia()
 * @param {string} [caption]
 * @param {string} [lang]
 * @returns {Promise<string|null>}
 */
async function describePhotoWithVision(media, caption = '', lang = 'ru') {
  if (!media?.data) return null;
  const mime = String(media.mimetype || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';
  if (!/^image\//i.test(mime)) {
    console.warn('📷 Vision: не image/* —', mime);
    return null;
  }
  const b64 = String(media.data).replace(/\s+/g, '');
  if (b64.length > MAX_BASE64_CHARS) {
    console.warn(`📷 Vision: фото слишком большое (${b64.length} chars) — пропускаю`);
    return null;
  }

  const dataUrl = `data:${mime};base64,${b64}`;
  const model = process.env.AI_VISION_MODEL || process.env.AI_MODEL || AI_MODEL;

  try {
    const response = await chatCompletions(
      {
        model,
        temperature: 0.35,
        max_tokens: 500,
        messages: [
          { role: 'system', content: visionSystemPrompt(lang) },
          {
            role: 'user',
            content: [
              { type: 'text', text: userVisionText(lang, caption) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      },
      { purpose: 'chat', timeout: VISION_TIMEOUT_MS, label: 'vision' }
    );
    const text = response.data?.choices?.[0]?.message?.content;
    const out = String(text || '').trim();
    return out || null;
  } catch (e) {
    console.warn('📷 Vision error:', e.response?.status || e.message);
    return null;
  }
}

/**
 * Скачать медиа из WhatsApp-сообщения и описать.
 * @param {object} msg
 * @param {string} [caption]
 * @param {string} [lang]
 */
async function describeIncomingWhatsAppPhoto(msg, caption = '', lang = 'ru') {
  if (!msg?.hasMedia && msg?.type !== 'image') return null;
  try {
    const media = await msg.downloadMedia();
    if (!media?.data) {
      console.warn('📷 downloadMedia пусто');
      return null;
    }
    console.log(
      `📷 Vision: скачано ${media.mimetype || '?'}, base64≈${String(media.data).length}`
    );
    return describePhotoWithVision(media, caption, lang);
  } catch (e) {
    console.warn('📷 downloadMedia:', e.message);
    return null;
  }
}

function formatPhotoUserLine(caption, visionText) {
  const cap = String(caption || '').trim();
  const vision = String(visionText || '').trim();
  if (vision && cap) {
    return `[фото] ${cap}\n[описание фото] ${vision}`;
  }
  if (vision) return `[фото без подписи]\n[описание фото] ${vision}`;
  if (cap) return `[фото] ${cap}`;
  return '[фото] (не удалось распознать изображение — ответь коротко и спроси, что на фото / какой объект ищут)';
}

module.exports = {
  describePhotoWithVision,
  describeIncomingWhatsAppPhoto,
  formatPhotoUserLine,
};
