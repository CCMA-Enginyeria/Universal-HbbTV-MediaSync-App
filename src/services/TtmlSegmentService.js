/**
 * Servei de segments TTML per a streams DASH live i static (start-over)
 *
 * Gestiona el fetching continu de segments fMP4 que contenen subtítols TTML,
 * els demultiplexa i parseja, i manté un buffer de cues actualitzat.
 *
 * Suporta:
 * - Streams live (dynamic): segments basats en wall-clock
 * - Streams static: segments basats en positionSeconds
 * - presentationTimeOffset: mapeja timestamps TTML absoluts a presentation time
 *
 * Dissenyat per a SegmentTemplate amb $Number$ (perfil HbbTV/DVB).
 */

import { extractTtmlFromMp4 } from '../utils/TtmlDemuxer';
import { parseTtml } from '../utils/TtmlParser';

// Nombre de segments a mantenir al buffer (~2 minuts amb segments de 6s)
const MAX_BUFFER_SEGMENTS = 20;

class TtmlSegmentService {
  /**
   * @param {Object} config
   * @param {string} config.baseUrl - URL base per resoldre les plantilles de segment
   * @param {string} config.initTemplate - Plantilla d'inicialització
   * @param {string} config.mediaTemplate - Plantilla de media (ex: 'ttml/geo2-ttml-xxx-$Number$.m4s')
   * @param {number} config.timescale - Timescale del SegmentTemplate
   * @param {number} config.duration - Durada de segment en unitats de timescale
   * @param {number} config.startNumber - Número inicial de segment
   * @param {string} [config.availabilityStartTime] - ISO 8601 timestamp del MPD (per live)
   * @param {boolean} [config.isLive=true] - Si és un stream live (dynamic) o static
   * @param {number} [config.presentationTimeOffset=0] - PTO en segons per mapear timestamps
   */
  constructor(config) {
    this.baseUrl = config.baseUrl;
    this.initTemplate = config.initTemplate;
    this.mediaTemplate = config.mediaTemplate;
    this.timescale = config.timescale;
    this.duration = config.duration;
    this.startNumber = config.startNumber || 0;
    this.isLive = config.isLive !== false; // default true
    this.ptoSeconds = config.presentationTimeOffset || 0;

    // Per live: usar wall-clock relatiu a AST
    if (this.isLive && config.availabilityStartTime) {
      this.availabilityStartTime = new Date(config.availabilityStartTime).getTime() / 1000;
    } else {
      this.availabilityStartTime = null;
    }

    this.segmentDurationSeconds = this.duration / this.timescale;
    this._intervalId = null;
    this._lastFetchedSegment = -1;
    this._cueBuffer = []; // Array de { segmentNumber, cues: [] }
    this._onCuesUpdate = null;
    this._running = false;
    this._currentPosition = 0; // positionSeconds (per static)
  }

  /**
   * Calcula el número de segment actual
   * - Live: basat en wall-clock vs availabilityStartTime
   * - Static: basat en positionSeconds
   * @returns {number}
   */
  computeCurrentSegmentNumber() {
    if (this.isLive && this.availabilityStartTime) {
      const now = Date.now() / 1000;
      const elapsedSeconds = now - this.availabilityStartTime;
      if (elapsedSeconds < 0) return this.startNumber;
      return this.startNumber + Math.floor(elapsedSeconds / this.segmentDurationSeconds);
    }
    // Static: segment basat en position
    return this.startNumber + Math.floor(this._currentPosition / this.segmentDurationSeconds);
  }

  /**
   * Actualitza la posició de reproducció (per static/start-over).
   * Això provoca la descàrrega dels segments necessaris.
   * @param {number} positionSeconds
   */
  updatePosition(positionSeconds) {
    if (positionSeconds == null) return;
    const prevPosition = this._currentPosition;
    this._currentPosition = positionSeconds;

    // Per static: si la posició ha canviat significativament, fer poll
    if (!this.isLive) {
      const prevSegment = this.startNumber + Math.floor(prevPosition / this.segmentDurationSeconds);
      const newSegment = this.computeCurrentSegmentNumber();
      if (newSegment !== prevSegment) {
        this._poll();
      }
    }
  }

  /**
   * Construeix la URL d'un segment a partir del número
   */
  _buildSegmentUrl(segmentNumber) {
    const mediaPath = this.mediaTemplate.replace('$Number$', String(segmentNumber));
    return this._resolveUrl(mediaPath);
  }

  /**
   * Resol una URL relativa respecte a la baseUrl
   */
  _resolveUrl(relativePath) {
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
      return relativePath;
    }
    const baseDir = this.baseUrl.substring(0, this.baseUrl.lastIndexOf('/') + 1);
    return baseDir + relativePath;
  }

  /**
   * Descarrega un segment com a ArrayBuffer usant XMLHttpRequest.
   * XHR amb responseType='arraybuffer' funciona fiablement a React Native.
   */
  _fetchBinary(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 10000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ status: xhr.status, data: xhr.response });
        } else {
          resolve({ status: xhr.status, data: null });
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Timeout'));
      xhr.send();
    });
  }

  /**
   * Descarrega i processa un segment TTML.
   * Aplica presentationTimeOffset per convertir timestamps absoluts a presentation time.
   */
  async _fetchAndParseSegment(segmentNumber) {
    const url = this._buildSegmentUrl(segmentNumber);
    try {
      const { status, data } = await this._fetchBinary(url);
      if (status === 404) {
        return [];
      }
      if (!data) {
        throw new Error(`HTTP ${status}`);
      }
      const ttmlXml = extractTtmlFromMp4(data);
      if (!ttmlXml) {
        return [];
      }
      const rawCues = parseTtml(ttmlXml);
      if (rawCues.length === 0) return [];

      // Aplicar PTO: convertir timestamps absoluts a presentation time
      const cues = this.ptoSeconds > 0
        ? rawCues.map(c => ({
            startTime: c.startTime - this.ptoSeconds,
            endTime: c.endTime - this.ptoSeconds,
            text: c.text,
          }))
        : rawCues;

      console.log(`🔤 Segment #${segmentNumber}: ${cues.length} cues (pres. time: ${cues[0].startTime.toFixed(1)}s → ${cues[cues.length - 1].endTime.toFixed(1)}s)`);
      return cues;
    } catch (error) {
      console.warn(`⚠️ Error segment TTML #${segmentNumber}:`, error.message);
      return [];
    }
  }

  /**
   * Fa una iteració de polling: descarrega els segments nous i actualitza el buffer
   */
  async _poll() {
    if (!this._running) return;

    const currentSegment = this.computeCurrentSegmentNumber();
    // Començar 1 segment enrere per tenir context, o des del darrer descarregat + 1
    const startFrom = this._lastFetchedSegment < 0
      ? currentSegment - 1
      : this._lastFetchedSegment + 1;

    // No re-descarregar segments ja obtinguts
    const effectiveStart = Math.max(startFrom, this.startNumber);
    if (effectiveStart > currentSegment) return;

    let updated = false;
    for (let n = effectiveStart; n <= currentSegment; n++) {
      if (!this._running) return;
      const cues = await this._fetchAndParseSegment(n);
      if (cues.length > 0) {
        this._cueBuffer.push({ segmentNumber: n, cues });
        updated = true;
      }
      this._lastFetchedSegment = n;
    }

    // Netejar segments antics del buffer
    while (this._cueBuffer.length > MAX_BUFFER_SEGMENTS) {
      this._cueBuffer.shift();
    }

    // Notificar amb tots els cues combinats
    if (updated && this._onCuesUpdate) {
      const allCues = this._cueBuffer.flatMap(entry => entry.cues);
      this._onCuesUpdate(allCues);
    }
  }

  /**
   * Inicia el polling de segments TTML
   * @param {function} onCuesUpdate - Callback amb Array<{startTime, endTime, text}>
   */
  start(onCuesUpdate) {
    if (this._running) this.stop();

    this._running = true;
    this._onCuesUpdate = onCuesUpdate;
    this._lastFetchedSegment = -1;
    this._cueBuffer = [];

    const mode = this.isLive ? 'LIVE (wall-clock)' : `STATIC (position=${this._currentPosition.toFixed(1)}s)`;
    console.log(`🔤 TtmlSegmentService iniciat [${mode}]:
  - baseUrl: ${this.baseUrl}
  - mediaTemplate: ${this.mediaTemplate}
  - segmentDuration: ${this.segmentDurationSeconds}s
  - PTO: ${this.ptoSeconds}s
  - startNumber: ${this.startNumber}
  - currentSegment: ${this.computeCurrentSegmentNumber()}`);

    // Primera iteració immediata
    this._poll();

    // Polling periòdic (per live principalment; per static es fa via updatePosition)
    if (this.isLive) {
      const pollIntervalMs = this.segmentDurationSeconds * 1000;
      this._intervalId = setInterval(() => this._poll(), pollIntervalMs);
    }
  }

  /**
   * Atura el polling de segments
   */
  stop() {
    this._running = false;
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._onCuesUpdate = null;
    this._cueBuffer = [];
    this._lastFetchedSegment = -1;
    console.log('🔤 TtmlSegmentService aturat');
  }
}

export default TtmlSegmentService;
