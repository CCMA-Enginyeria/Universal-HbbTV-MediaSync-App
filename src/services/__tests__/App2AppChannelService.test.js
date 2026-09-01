import App2AppChannelService, { buildAppChannelUrl } from '../App2AppChannelService';

/** Minimal WebSocket double capturing what the service sends. */
function createSocket(service) {
  const socket = {
    readyState: 1, // WebSocket.OPEN
    sent: [],
    send: jest.fn(function (data) { socket.sent.push(data); }),
    close: jest.fn(),
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
  service.ws = socket;
  service.isConnected = true;
  return socket;
}

describe('buildAppChannelUrl', () => {
  it('joins the App2App base URL with the prefixed channel name', () => {
    expect(buildAppChannelUrl('ws://tv:7681/hbbtv/', 'hbbtv-sync'))
      .toBe('ws://tv:7681/hbbtv/hbbtv-sync-app');
  });

  it('returns null without a base URL or prefix', () => {
    expect(buildAppChannelUrl(null, 'hbbtv-sync')).toBeNull();
    expect(buildAppChannelUrl('ws://tv:7681/hbbtv', '')).toBeNull();
  });
});

describe('App2AppChannelService', () => {
  let service;

  beforeEach(() => {
    service = new App2AppChannelService('ws://tv:7681/hbbtv/hbbtv-sync-app');
  });

  afterEach(() => {
    service.removeAllListeners();
  });

  it('treats the pairing control frame as transport metadata', () => {
    const onMessage = jest.fn();
    const onPaired = jest.fn();
    service.on('message', onMessage);
    service.on('paired', onPaired);

    service.handleMessage('pairingcompleted');

    expect(onMessage).not.toHaveBeenCalled();
    expect(onPaired).toHaveBeenCalledTimes(1);
    expect(service.isPaired).toBe(true);
  });

  it('queues messages until the channel is paired and flushes them afterwards', () => {
    const socket = createSocket(service);

    service.send('chat.message', { text: 'hola' });
    expect(socket.send).not.toHaveBeenCalled();

    service.handleMessage('pairingcompleted');

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.sent[0]);
    expect(sent).toEqual({
      version: 1,
      type: 'chat.message',
      id: null,
      payload: { text: 'hola' },
    });
  });

  it('emits parsed messages and caches retained state', () => {
    const onMessage = jest.fn();
    service.on('message', onMessage);
    service.handleMessage('pairingcompleted');

    service.handleMessage(JSON.stringify({
      version: 1, type: 'location', id: null, payload: { location: 'lleida' }, retained: true,
    }));
    service.handleMessage(JSON.stringify({
      version: 1, type: 'chat.reply', id: null, payload: { text: 'hi' },
    }));

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(service.getRetainedState('location')).toEqual({ location: 'lleida' });
    expect(service.getRetainedState('chat.reply')).toBeNull();
  });

  it('ignores malformed frames', () => {
    const onMessage = jest.fn();
    service.on('message', onMessage);
    service.handleMessage('pairingcompleted');

    service.handleMessage('not json');
    service.handleMessage(JSON.stringify({ version: 1, payload: 1 }));

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('resolves a request when the response carries the same correlation id', async () => {
    const socket = createSocket(service);
    service.handleMessage('pairingcompleted');

    const pending = service.request('chat.message', { text: 'hola' });
    const sent = JSON.parse(socket.sent[0]);
    expect(sent.type).toBe('chat.message');
    expect(typeof sent.id).toBe('string');

    service.handleMessage(JSON.stringify({
      version: 1, type: 'chat.message', id: sent.id, payload: { text: 'resposta' },
    }));

    await expect(pending).resolves.toMatchObject({ payload: { text: 'resposta' } });
    expect(service.pendingRequests.size).toBe(0);
  });

  it('rejects pending requests when the channel closes', async () => {
    createSocket(service);
    service.handleMessage('pairingcompleted');
    const pending = service.request('chat.message');

    service.close();

    await expect(pending).rejects.toThrow('App2App channel: closed');
    expect(service.isPaired).toBe(false);
  });
});
