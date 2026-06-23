/**
 * Parser de fitxers WebVTT
 * 
 * Parseja text VTT i proporciona utilitats per trobar el cue actiu
 * a un temps donat.
 */

/**
 * Parseja un timestamp VTT a segons
 * Formats: HH:MM:SS.mmm o MM:SS.mmm
 * @param {string} timestamp
 * @returns {number} temps en segons
 */
function parseTimestamp(timestamp) {
  const parts = timestamp.trim().split(':');
  let hours = 0, minutes = 0, seconds = 0;

  if (parts.length === 3) {
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
    seconds = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0], 10);
    seconds = parseFloat(parts[1]);
  }

  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Neteja tags HTML/VTT del text d'un cue
 * @param {string} text
 * @returns {string}
 */
function cleanCueText(text) {
  return text
    .replace(/<[^>]+>/g, '') // Treure tags HTML/VTT
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Parseja un fitxer WebVTT i retorna un array de cues
 * @param {string} vttText - Contingut del fitxer VTT
 * @returns {Array<{startTime: number, endTime: number, text: string}>}
 */
export function parseVtt(vttText) {
  if (!vttText) return [];

  const cues = [];
  // Normalitzar salts de línia
  const lines = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let i = 0;
  // Saltar capçalera WEBVTT i metadades
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Buscar línia amb timestamp (conté -->)
    if (line.includes('-->')) {
      const match = line.match(
        /(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/
      );

      if (match) {
        const startTime = parseTimestamp(match[1].replace(',', '.'));
        const endTime = parseTimestamp(match[2].replace(',', '.'));

        // Recollir línies de text fins a línia buida o fi de fitxer
        const textLines = [];
        i++;
        while (i < lines.length && lines[i].trim() !== '') {
          textLines.push(lines[i]);
          i++;
        }

        const text = cleanCueText(textLines.join('\n'));
        if (text) {
          cues.push({ startTime, endTime, text });
        }
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * Troba el cue actiu a un temps donat
 * @param {Array<{startTime: number, endTime: number, text: string}>} cues
 * @param {number} timeSeconds - Temps actual en segons
 * @returns {{startTime: number, endTime: number, text: string} | null}
 */
export function getActiveCue(cues, timeSeconds) {
  if (!cues || cues.length === 0 || timeSeconds == null) return null;

  // Cerca lineal (els cues estan ordenats)
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    if (timeSeconds >= cue.startTime && timeSeconds < cue.endTime) {
      return cue;
    }
    // Optimització: si el temps és anterior al primer cue, sortir
    if (cue.startTime > timeSeconds) break;
  }

  return null;
}
