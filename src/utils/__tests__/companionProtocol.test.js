import {
  buildAppMessage,
  buildInitMessage,
  buildPositionMessage,
  buildWebViewInjection,
  parseCompanionMessage,
} from '../companionProtocol';

describe('companion protocol', () => {
  it('builds versioned envelopes for every message kind', () => {
    const position = buildPositionMessage({
      positionSeconds: 12.5,
      positionMillis: 12500,
      exoPlayerPositionSeconds: 12.4,
      isPlaying: true,
      speed: 1,
      isLive: false,
      generatedAt: 1700000000000,
      formattedTime: '00:00:12',
    });

    expect(position).toMatchObject({ version: 1, type: 'position', positionSeconds: 12.5 });
    expect(buildAppMessage({ type: 'chat', payload: 1 })).toEqual({
      version: 1,
      type: 'app-message',
      message: { type: 'chat', payload: 1 },
    });
    expect(buildInitMessage('https://example.com/app')).toEqual({
      version: 1,
      type: 'init',
      contentId: 'https://example.com/app',
    });
  });

  it('parses both JSON strings and already decoded envelopes', () => {
    const envelope = { version: 1, type: 'sync-ack', receivedAt: 5 };

    expect(parseCompanionMessage(JSON.stringify(envelope))).toEqual(envelope);
    expect(parseCompanionMessage(envelope)).toEqual(envelope);
  });

  it('rejects foreign, malformed or unversioned messages', () => {
    expect(parseCompanionMessage('not json')).toBeNull();
    expect(parseCompanionMessage(null)).toBeNull();
    expect(parseCompanionMessage('"a string"')).toBeNull();
    expect(parseCompanionMessage({ type: 'position' })).toBeNull();
    expect(parseCompanionMessage({ version: 2, type: 'position' })).toBeNull();
    expect(parseCompanionMessage({ version: 1 })).toBeNull();
  });

  it('injects the payload as inert data, never as executable code', () => {
    const envelope = buildAppMessage({ type: 'x', payload: '</script>";window.pwned=1;//' });
    const snippet = buildWebViewInjection(envelope);
    const fakeWindow = {
      location: { origin: 'https://example.com' },
      postMessage: jest.fn(),
    };

    // eslint-disable-next-line no-new-func
    new Function('window', snippet)(fakeWindow);

    expect(fakeWindow.pwned).toBeUndefined();
    expect(JSON.parse(fakeWindow.postMessage.mock.calls[0][0])).toEqual(envelope);
    expect(fakeWindow.postMessage.mock.calls[0][1]).toBe('https://example.com');
    expect(snippet.endsWith('true;')).toBe(true);
  });

  it('still calls the deprecated __hbbtvSync entry point', () => {
    const envelope = buildInitMessage('https://example.com/app');
    const legacy = jest.fn();
    const fakeWindow = {
      location: { origin: 'null' },
      postMessage: jest.fn(),
      __hbbtvSync: legacy,
    };

    // eslint-disable-next-line no-new-func
    new Function('window', buildWebViewInjection(envelope))(fakeWindow);

    expect(legacy).toHaveBeenCalledWith(envelope);
    expect(fakeWindow.postMessage.mock.calls[0][1]).toBe('*');
  });

  it('escapes line separators that break older JS parsers', () => {
    const snippet = buildWebViewInjection(buildInitMessage('a\u2028b\u2029c'));

    expect(snippet).not.toContain('\u2028');
    expect(snippet).not.toContain('\u2029');
    expect(snippet).toContain('\\u2028');
  });

  it('round-trips through the injected literal', () => {
    const envelope = buildInitMessage('https://example.com/app?q=1&b="x"');
    const snippet = buildWebViewInjection(envelope);
    const literal = snippet.slice(snippet.indexOf('var m=') + 6, snippet.indexOf(';var o='));

    expect(JSON.parse(JSON.parse(literal))).toEqual(envelope);
  });
});
