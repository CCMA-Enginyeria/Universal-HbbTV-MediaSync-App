/**
 * Demuxer de TTML dins de contenidors fMP4 (ISO BMFF)
 *
 * Extreu el contingut XML TTML del box 'mdat' d'un segment fMP4.
 * Els segments DASH amb codec 'stpp' encapsulen documents TTML
 * dins del payload del media data box.
 *
 * Compatible amb React Native (Hermes): no depèn de TextDecoder.
 */

/**
 * Normalitza l'entrada a Uint8Array.
 * Accepta ArrayBuffer, Uint8Array, o Buffer de Node/RN.
 */
function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  // Buffer de Node.js / React Native polyfill
  if (data && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/**
 * Llegeix un enter de 32 bits big-endian
 */
function readUint32(bytes, offset) {
  return (
    ((bytes[offset] & 0xff) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff)
  ) >>> 0;
}

/**
 * Llegeix un tipus de box ISO BMFF (4 bytes ASCII)
 */
function readBoxType(bytes, offset) {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

/**
 * Cerca un box per tipus dins d'un byte array.
 * Retorna { offset, size } del primer box trobat o null.
 */
function findBox(bytes, type) {
  let offset = 0;
  const len = bytes.length;

  while (offset < len - 8) {
    const size = readUint32(bytes, offset);
    const boxType = readBoxType(bytes, offset + 4);

    if (size < 8) break;
    if (offset + size > len) break;

    if (boxType === type) {
      return { offset, size };
    }

    offset += size;
  }

  return null;
}

/**
 * Decodifica bytes UTF-8 a string sense dependre de TextDecoder.
 * Gestiona caràcters multi-byte (accents, emojis, etc.)
 */
function decodeUtf8(bytes) {
  // Si TextDecoder existeix (RN >= 0.76 amb Hermes), usar-lo
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8').decode(bytes);
    } catch (e) {
      // Fallback a decodificació manual
    }
  }

  // Decodificació manual UTF-8
  const len = bytes.length;
  const chars = [];
  let i = 0;

  while (i < len) {
    const byte1 = bytes[i];
    if (byte1 < 0x80) {
      chars.push(byte1);
      i += 1;
    } else if ((byte1 & 0xe0) === 0xc0) {
      const byte2 = bytes[i + 1] || 0;
      chars.push(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
      i += 2;
    } else if ((byte1 & 0xf0) === 0xe0) {
      const byte2 = bytes[i + 1] || 0;
      const byte3 = bytes[i + 2] || 0;
      chars.push(((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f));
      i += 3;
    } else if ((byte1 & 0xf8) === 0xf0) {
      const byte2 = bytes[i + 1] || 0;
      const byte3 = bytes[i + 2] || 0;
      const byte4 = bytes[i + 3] || 0;
      let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
      // Surrogate pair per a codepoints > 0xFFFF
      if (codePoint > 0xffff) {
        codePoint -= 0x10000;
        chars.push(0xd800 + (codePoint >> 10));
        chars.push(0xdc00 + (codePoint & 0x3ff));
      } else {
        chars.push(codePoint);
      }
      i += 4;
    } else {
      i += 1; // Skip invalid byte
    }
  }

  // Convertir en blocs per evitar stack overflow amb strings grans
  const CHUNK = 8192;
  let result = '';
  for (let j = 0; j < chars.length; j += CHUNK) {
    result += String.fromCharCode.apply(null, chars.slice(j, j + CHUNK));
  }
  return result;
}

/**
 * Extreu el contingut TTML XML d'un segment fMP4
 * @param {ArrayBuffer|Uint8Array|Buffer} data - Contingut binari del segment .m4s
 * @returns {string|null} - Document TTML XML o null si no es troba
 */
export function extractTtmlFromMp4(data) {
  const bytes = toUint8Array(data);
  if (!bytes || bytes.length === 0) return null;

  const mdatBox = findBox(bytes, 'mdat');
  if (!mdatBox) {
    console.warn('⚠️ No s\'ha trobat box mdat al segment fMP4');
    return null;
  }

  // El payload del mdat comença després de la capçalera (8 bytes: size + type)
  const payloadOffset = mdatBox.offset + 8;
  const payloadSize = mdatBox.size - 8;

  if (payloadSize <= 0) return null;

  const payload = bytes.subarray(payloadOffset, payloadOffset + payloadSize);
  const xmlText = decodeUtf8(payload).trim();

  // Validació bàsica: ha de semblar XML
  if (!xmlText.startsWith('<')) {
    console.warn('⚠️ El contingut del mdat no sembla XML TTML');
    return null;
  }

  return xmlText;
}
