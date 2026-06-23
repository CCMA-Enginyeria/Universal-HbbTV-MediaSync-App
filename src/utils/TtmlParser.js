/**
 * Parser de subtítols TTML (EBU-TT-D)
 *
 * Parseja XML TTML i retorna un array de cues amb el mateix format
 * que VttParser: { startTime, endTime, text }
 *
 * Suporta el perfil EBU-TT-D utilitzat habitualment en HbbTV/DVB.
 */

import { XMLParser } from 'fast-xml-parser';

const ttmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Preservar espais en el text dels subtítols
  trimValues: false,
  // Eliminar prefixos de namespace (tt:p → p, ttml:body → body)
  removeNSPrefix: true,
});

/**
 * Parseja un timestamp TTML a segons.
 * Formats suportats:
 *  - HH:MM:SS.mmm  (clock-time amb fraccions)
 *  - HH:MM:SS:FF    (clock-time amb frames, requereix frameRate)
 *  - HH:MM:SS       (sense fraccions)
 * @param {string} timestamp
 * @param {number} frameRate - Frames per segon (per defecte 25, estàndard EBU-TT-D)
 * @returns {number} temps en segons
 */
function parseTtmlTimestamp(timestamp, frameRate = 25) {
  if (!timestamp) return 0;
  const ts = timestamp.trim();

  // Format amb frames: HH:MM:SS:FF
  const frameMatch = ts.match(/^(\d+):(\d{2}):(\d{2}):(\d+)$/);
  if (frameMatch) {
    const hours = parseInt(frameMatch[1], 10);
    const minutes = parseInt(frameMatch[2], 10);
    const seconds = parseInt(frameMatch[3], 10);
    const frames = parseInt(frameMatch[4], 10);
    return hours * 3600 + minutes * 60 + seconds + frames / frameRate;
  }

  // Format amb fraccions o sense: HH:MM:SS.mmm o HH:MM:SS
  const clockMatch = ts.match(/^(\d+):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (clockMatch) {
    const hours = parseInt(clockMatch[1], 10);
    const minutes = parseInt(clockMatch[2], 10);
    const seconds = parseInt(clockMatch[3], 10);
    const frac = clockMatch[4] ? parseFloat('0.' + clockMatch[4]) : 0;
    return hours * 3600 + minutes * 60 + seconds + frac;
  }

  return 0;
}

/**
 * Extreu text pla d'un node TTML <p>, gestionant <span> i <br/> niuats
 * @param {*} node - Node parsejat (string, objecte o array)
 * @returns {string}
 */
function extractText(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();

  let text = '';

  // Text directe del node
  if (node['#text'] != null) {
    text += String(node['#text']);
  }

  // Processar <br/> com a salt de línia
  if (node.br != null) {
    text += '\n';
  }

  // Processar <span> niuats
  const spans = node.span;
  if (spans) {
    const spanArray = Array.isArray(spans) ? spans : [spans];
    for (const span of spanArray) {
      text += extractText(span);
    }
  }

  return text.trim();
}

/**
 * Parseja un document TTML XML i retorna un array de cues
 * @param {string} ttmlXml - Contingut XML TTML
 * @returns {Array<{startTime: number, endTime: number, text: string}>}
 */
export function parseTtml(ttmlXml) {
  if (!ttmlXml) return [];

  try {
    const parsed = ttmlParser.parse(ttmlXml);

    // Amb removeNSPrefix=true, el node arrel és sempre 'tt'
    const tt = parsed.tt || {};
    const body = tt.body || {};

    if (!body || Object.keys(body).length === 0) {
      // Log per depuració: mostrar les claus del document parsejat
      console.log('🔤 TTML parsed keys:', Object.keys(parsed));
      if (tt) console.log('🔤 TTML tt keys:', Object.keys(tt));
      return [];
    }

    // Obtenir frameRate del <tt> element (si n'hi ha)
    const frameRateStr = tt['@_frameRate'] || '';
    const frameRate = parseInt(frameRateStr, 10) || 25;

    // Navegar fins als <p> elements: body > div > p
    const divs = body.div || {};
    const divArray = Array.isArray(divs) ? divs : [divs];

    const cues = [];

    for (const div of divArray) {
      if (!div) continue;
      const paragraphs = div.p || [];
      const pArray = Array.isArray(paragraphs) ? paragraphs : [paragraphs];

      for (const p of pArray) {
        if (!p) continue;

        const begin = p['@_begin'] || '';
        const end = p['@_end'] || '';
        if (!begin || !end) continue;

        const startTime = parseTtmlTimestamp(begin, frameRate);
        const endTime = parseTtmlTimestamp(end, frameRate);
        const text = extractText(p);

        if (text) {
          cues.push({ startTime, endTime, text });
        }
      }
    }

    return cues;
  } catch (error) {
    console.error('❌ Error parsejant TTML:', error.message);
    return [];
  }
}
