/**
 * Wire format shared by every companion transport (Chrome Custom Tabs verified
 * postMessage channel and in-app WebViews). Both sides exchange versioned JSON
 * envelopes so a companion page can use the very same client code regardless of
 * how the app reached it.
 */

export const PROTOCOL_VERSION = 1;

/** Build the timeline envelope sent to the companion page on every feed tick. */
export const buildPositionMessage = (pos) => ({
  version: PROTOCOL_VERSION,
  type: 'position',
  positionSeconds: pos.positionSeconds,
  positionMillis: pos.positionMillis,
  exoPlayerPositionSeconds: pos.exoPlayerPositionSeconds,
  isPlaying: pos.isPlaying,
  speed: pos.speed,
  isLive: pos.isLive,
  // When the position was valid (device wall clock). The web player uses it to
  // compensate the feed latency so it locks to where the TV IS now, not where
  // it was when we sampled it.
  generatedAt: pos.generatedAt,
  formattedTime: pos.formattedTime,
});

/** Wrap an App2App message so the page can tell it apart from position updates. */
export const buildAppMessage = (message) => ({
  version: PROTOCOL_VERSION,
  type: 'app-message',
  message,
});

/** First envelope sent once a transport is ready, so the page knows its content. */
export const buildInitMessage = (contentId) => ({
  version: PROTOCOL_VERSION,
  type: 'init',
  contentId,
});

/** Parse an incoming companion message; returns null when it is not ours. */
export const parseCompanionMessage = (raw) => {
  let envelope = raw;
  if (typeof raw === 'string') {
    try {
      envelope = JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }
  if (!envelope || typeof envelope !== 'object') return null;
  if (envelope.version !== PROTOCOL_VERSION) return null;
  if (typeof envelope.type !== 'string') return null;
  return envelope;
};

// Line separators are valid JSON but were illegal inside JS string literals
// before ES2019, and older JS engines still choke on them.
const escapeForScript = (json) =>
  json.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/**
 * Build the snippet injected into a WebView to deliver an envelope. The payload
 * travels as an escaped string literal (never as an inline object literal) so a
 * TV-controlled `app-message` body can never inject code into the page.
 */
export const buildWebViewInjection = (envelope) => {
  const literal = escapeForScript(JSON.stringify(JSON.stringify(envelope)));
  return (
    `(function(){var m=${literal};` +
    // Opaque origins (data:/about:blank) report "null", which is not a valid
    // postMessage target.
    "var o=window.location.origin;" +
    "try{window.postMessage(m,(o&&o!=='null')?o:'*');}catch(e){}" +
    // Deprecated entry point kept so companion pages written against the old
    // injection API keep working.
    'try{if(window.__hbbtvSync)window.__hbbtvSync(JSON.parse(m));}catch(e){}' +
    '})(); true;'
  );
};
