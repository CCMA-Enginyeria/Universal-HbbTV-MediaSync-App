/**
 * Servei per parsejar fitxers MPD (MPEG-DASH)
 * 
 * Extreu informació d'àudios i subtítols disponibles dins d'un manifest MPD.
 * Utilitza fast-xml-parser per parsejar el XML.
 */

import { XMLParser } from 'fast-xml-parser';
import i18n from '../i18n';

/**
 * Comprova si un codi d'idioma pertany al rang d'ús privat d'ISO 639-2.
 * Els codis qaa–qtz estan reservats per a ús local o privat, de manera que
 * el seu significat és específic del contingut i no es pot inferir del codi.
 */
function isPrivateUseLanguage(iso) {
  return typeof iso === 'string' && /^q[a-t][a-z]$/i.test(iso);
}

/**
 * Obté el nom llegible d'un idioma a partir del codi ISO,
 * traduït a l'idioma actiu de l'app.
 */
function getLanguageName(iso, contentType) {
  if (!iso) {
    if (contentType === 'audio') return i18n.t('discovery.media.audioGeneric');
    if (contentType === 'video') return i18n.t('discovery.media.videoGeneric');
    return i18n.t('discovery.media.subtitleGeneric');
  }
  const code = iso.toLowerCase();
  // Codis d'ús privat (qaa–qtz): el significat depèn del contingut.
  if (isPrivateUseLanguage(code)) {
    return i18n.t('discovery.media.otherLang');
  }
  if (code === 'und') return i18n.t('discovery.media.undefinedLang');
  if (code === 'mis') return i18n.t('discovery.media.otherLang');
  const localized = i18n.t(`discovery.media.languages.${code}`, { defaultValue: '' });
  return localized || iso.toUpperCase();
}

/**
 * Assegura que un valor és un array
 */
function ensureArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Resol una URL relativa respecte a una URL base
 */
function resolveUrl(baseUrl, relativeUrl) {
  if (!relativeUrl) return null;
  // Si ja és absoluta, retornar-la directament
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  // Treure el fitxer final de la baseUrl per obtenir el directori
  const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  return baseDir + relativeUrl;
}

class MpdParserService {
  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
    });
  }

  /**
   * Fa fetch i parseja un fitxer MPD
   * @param {string} mpdUrl - URL del fitxer MPD
   * @returns {Promise<{audios: Array, subtitles: Array}>}
   */
  async parseMpd(mpdUrl) {
    try {
      const response = await fetch(mpdUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const xmlText = await response.text();
      const parsed = this.parser.parse(xmlText);

      const mpd = parsed.MPD;
      if (!mpd) {
        throw new Error('Format MPD invàlid: no s\'ha trobat el node MPD');
      }

      // Obtenir BaseURL global si existeix
      const globalBaseUrl = mpd.BaseURL || '';
      const effectiveBaseUrl = globalBaseUrl
        ? resolveUrl(mpdUrl, globalBaseUrl)
        : mpdUrl;

      const periods = ensureArray(mpd.Period);
      const audios = [];
      const subtitles = [];
      const videos = [];

      for (const period of periods) {
        const periodBaseUrl = period.BaseURL
          ? resolveUrl(effectiveBaseUrl, period.BaseURL)
          : effectiveBaseUrl;

        const adaptationSets = ensureArray(period.AdaptationSet);

        for (const as of adaptationSets) {
          const mimeType = (as['@_mimeType'] || '').toLowerCase();
          const contentType = (as['@_contentType'] || '').toLowerCase();
          const lang = as['@_lang'] || null;

          const isAudio = contentType === 'audio' || mimeType.startsWith('audio/');
          const isVideo = contentType === 'video' || mimeType.startsWith('video/');
          const isSubtitle =
            contentType === 'text' ||
            mimeType.includes('ttml') ||
            mimeType.includes('vtt') ||
            mimeType.includes('subtitle') ||
            mimeType.includes('application/mp4') && this._hasSubtitleCodec(as);

          if (isAudio) {
            this._extractAudio(as, lang, periodBaseUrl, audios);
          } else if (isVideo) {
            this._extractVideo(as, lang, periodBaseUrl, mpdUrl, videos);
          } else if (isSubtitle) {
            this._extractSubtitle(as, lang, periodBaseUrl, mpdUrl, subtitles);
          }
        }
      }

      // Propagar informació del MPD per a streams live
      const availabilityStartTime = mpd['@_availabilityStartTime'] || null;
      const mpdType = mpd['@_type'] || 'static'; // 'dynamic' per live, 'static' per VOD
      const minimumUpdatePeriod = mpd['@_minimumUpdatePeriod'] || null;
      const timeShiftBufferDepth = mpd['@_timeShiftBufferDepth'] || null;
      const suggestedPresentationDelay = mpd['@_suggestedPresentationDelay'] || null;
      const isLive = mpdType === 'dynamic';

      // Durada total del contingut (només VOD). Ve com a durada ISO 8601
      // (p. ex. "PT1H30M45S"); la convertim a segons per a la barra informativa.
      const durationSeconds = isLive
        ? null
        : this._parseIso8601Duration(mpd['@_mediaPresentationDuration']);

      if (isLive) {
        console.log(`📡 MPD Live detectat: AST=${availabilityStartTime}, updatePeriod=${minimumUpdatePeriod}`);
      }

      console.log(`📦 MPD parseged: ${audios.length} àudios, ${subtitles.length} subtítols, ${videos.length} vídeos (${mpdType})`);
      return {
        audios, subtitles, videos,
        availabilityStartTime,
        mpdType,
        isLive,
        minimumUpdatePeriod,
        timeShiftBufferDepth,
        suggestedPresentationDelay,
        durationSeconds,
      };
    } catch (error) {
      console.error('❌ Error parsejant MPD:', error.message);
      return { audios: [], subtitles: [], videos: [], availabilityStartTime: null, mpdType: 'static', isLive: false, durationSeconds: null };
    }
  }

  /**
   * Converteix una durada ISO 8601 (p. ex. "PT1H30M45.5S") a segons.
   * Retorna null si el valor no existeix o no és vàlid.
   */
  _parseIso8601Duration(value) {
    if (!value || typeof value !== 'string') return null;
    const match = value.match(
      /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
    );
    if (!match) return null;
    const [, years, months, days, hours, minutes, seconds] = match;
    const total =
      (parseFloat(years) || 0) * 31536000 +
      (parseFloat(months) || 0) * 2592000 +
      (parseFloat(days) || 0) * 86400 +
      (parseFloat(hours) || 0) * 3600 +
      (parseFloat(minutes) || 0) * 60 +
      (parseFloat(seconds) || 0);
    return total > 0 ? total : null;
  }

  /**
   * Comprova si un AdaptationSet té un codec de subtítols
   */
  _hasSubtitleCodec(as) {
    const codecs = (as['@_codecs'] || '').toLowerCase();
    return codecs.includes('stpp') || codecs.includes('wvtt');
  }

  /**
   * Extreu informació d'àudio d'un AdaptationSet
   */
  _extractAudio(as, lang, baseUrl, audios) {
    const representations = ensureArray(as.Representation);
    const asBaseUrl = as.BaseURL ? resolveUrl(baseUrl, as.BaseURL) : baseUrl;
    const codecs = as['@_codecs'] || '';

    // Llegir <Label> element (fill, no atribut)
    const labelEl = as.Label;
    const label = typeof labelEl === 'string' ? labelEl
      : (labelEl?.['#text'] || as['@_label'] || '');

    // Llegir <Role> element per diferenciar main/supplementary/etc.
    const roleEl = as.Role;
    const rawRole = roleEl?.['@_value'] || '';

    // Llegir <Accessibility> per detectar audiodescripció.
    // La detecció es basa en els elements <Accessibility>/<Role> del manifest,
    // no en el codi d'idioma (els codis qaa–qtz són d'ús privat).
    const accessEl = as.Accessibility;
    const isAccessibility = !!accessEl;
    const isAudioDescription = rawRole === 'description' || isAccessibility;
    // Normalitzar el role perquè la UI (getAudioLabel) el pugui interpretar.
    const role = isAudioDescription ? 'description' : rawRole;

    // Agafar la representació amb més bandwidth (millor qualitat)
    let bestRep = representations[0];
    for (const rep of representations) {
      const bw = parseInt(rep['@_bandwidth'] || '0', 10);
      const bestBw = parseInt(bestRep?.['@_bandwidth'] || '0', 10);
      if (bw > bestBw) bestRep = rep;
    }

    if (!bestRep) return;

    const repCodecs = bestRep['@_codecs'] || codecs;
    const bandwidth = parseInt(bestRep['@_bandwidth'] || '0', 10);
    const repId = bestRep['@_id'] || '';

    // Determinar text descriptiu
    let text = label || (isAudioDescription ? i18n.t('discovery.media.audioDescription') : getLanguageName(lang, 'audio'));
    // Afegir info de codec si és rellevant
    const codecShort = repCodecs.includes('ec-3') ? 'Dolby' :
                       repCodecs.includes('ac-3') ? 'AC3' :
                       repCodecs.includes('mp4a') ? 'AAC' : '';
    if (codecShort && !text.includes(codecShort)) {
      text = `${text} (${codecShort})`;
    }

    audios.push({
      text,
      iso: lang,
      codec: repCodecs,
      bandwidth,
      representationId: repId,
      role,
      audioTrackIndex: audios.length,
    });
  }

  /**
   * Extreu informació de vídeo d'un AdaptationSet
   */
  _extractVideo(as, lang, baseUrl, mpdUrl, videos) {
    const representations = ensureArray(as.Representation);
    const codecs = as['@_codecs'] || '';

    // Llegir <Role> element per diferenciar main/sign/alternate
    const roleEl = as.Role;
    const role = roleEl?.['@_value'] || 'main';

    // Llegir <Accessibility> per detectar llengua de signes
    const accessEl = as.Accessibility;
    const isSign = role === 'sign' || !!accessEl;

    // Llegir <Label>
    const labelEl = as.Label;
    const label = typeof labelEl === 'string' ? labelEl
      : (labelEl?.['#text'] || as['@_label'] || '');

    // Agafar la representació amb més bandwidth (millor qualitat)
    let bestRep = representations[0];
    for (const rep of representations) {
      const bw = parseInt(rep['@_bandwidth'] || '0', 10);
      const bestBw = parseInt(bestRep?.['@_bandwidth'] || '0', 10);
      if (bw > bestBw) bestRep = rep;
    }

    if (!bestRep) return;

    const repCodecs = bestRep['@_codecs'] || codecs;
    const bandwidth = parseInt(bestRep['@_bandwidth'] || '0', 10);
    const repId = bestRep['@_id'] || '';
    const width = parseInt(bestRep['@_width'] || as['@_width'] || '0', 10);
    const height = parseInt(bestRep['@_height'] || as['@_height'] || '0', 10);

    // Determinar text descriptiu
    let text = label;
    if (!text) {
      if (isSign) {
        text = i18n.t('discovery.media.signLanguage');
      } else if (role !== 'main') {
        text = `${i18n.t('discovery.media.videoGeneric')} (${role})`;
      } else {
        text = getLanguageName(lang, 'video') || i18n.t('discovery.media.videoGeneric');
      }
    }
    if (width && height) {
      text = `${text} (${width}x${height})`;
    }

    videos.push({
      text,
      iso: lang,
      url: mpdUrl,
      codec: repCodecs,
      bandwidth,
      representationId: repId,
      role,
      width,
      height,
      videoTrackIndex: videos.length,
    });
  }

  /**
   * Extreu informació de subtítols d'un AdaptationSet
   */
  _extractSubtitle(as, lang, baseUrl, mpdUrl, subtitles) {
    const representations = ensureArray(as.Representation);
    const asBaseUrl = as.BaseURL ? resolveUrl(baseUrl, as.BaseURL) : baseUrl;
    const mimeType = (as['@_mimeType'] || '').toLowerCase();
    const label = as['@_label'] || '';

    for (const rep of representations) {
      const repBaseUrl = rep.BaseURL
        ? resolveUrl(asBaseUrl, rep.BaseURL)
        : null;

      // Determinar format
      let format = 'unknown';
      const repMime = (rep['@_mimeType'] || mimeType).toLowerCase();
      const codecs = (rep['@_codecs'] || as['@_codecs'] || '').toLowerCase();
      if (repMime.includes('vtt') || codecs.includes('wvtt')) {
        format = 'vtt';
      } else if (repMime.includes('ttml') || codecs.includes('stpp')) {
        format = 'ttml';
      }

      // Comprovar si és TTML segmentat (SegmentTemplate)
      const segTemplate = rep.SegmentTemplate || as.SegmentTemplate;
      if (format === 'ttml' && segTemplate && segTemplate['@_media']) {
        const text = label || getLanguageName(lang, 'subtitle');
        const tmplTimescale = parseInt(segTemplate['@_timescale'] || '1', 10);
        const tmplPto = parseInt(segTemplate['@_presentationTimeOffset'] || '0', 10);
        subtitles.push({
          text,
          iso: lang,
          url: mpdUrl,
          format,
          segmented: true,
          segmentTemplate: {
            initialization: segTemplate['@_initialization'] || '',
            media: segTemplate['@_media'] || '',
            timescale: tmplTimescale,
            duration: parseInt(segTemplate['@_duration'] || '1', 10),
            startNumber: parseInt(segTemplate['@_startNumber'] || '0', 10),
            presentationTimeOffset: tmplPto / tmplTimescale, // en segons
          },
          baseUrl: asBaseUrl,
        });
        continue;
      }

      // Determinar URL per subtítols no segmentats
      let url = repBaseUrl;
      if (!url && segTemplate) {
        const media = segTemplate['@_media'] || '';
        const init = segTemplate['@_initialization'] || '';
        url = resolveUrl(asBaseUrl, init || media);
      }

      // Si no tenim URL directa, no podem fer-ne res al mòbil
      if (!url) continue;

      const text = label || getLanguageName(lang, 'subtitle');

      subtitles.push({
        text,
        iso: lang,
        url,
        format,
      });
    }
  }
}

export default new MpdParserService();
