import CSSCIIService from '../CSSCIIService';
import CSSWCService from '../CSSWCService';
import CSSTSService from '../CSSTSService';

describe('App2App pairing control frame', () => {
  it('is ignored by the CSS-CII parser', () => {
    const service = new CSSCIIService('ws://tv/cii');
    const onError = jest.fn();
    const onMessage = jest.fn();
    service.on('error', onError);
    service.on('message', onMessage);

    service.handleMessage('pairingcompleted');

    expect(onError).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
    expect(service.getContentId()).toBeNull();
  });

  it('is ignored by the CSS-WC parser', () => {
    const service = new CSSWCService('ws://tv/wc');
    const onError = jest.fn();
    const onSync = jest.fn();
    service.on('error', onError);
    service.on('sync', onSync);

    service.handleResponse('pairingcompleted');

    expect(onError).not.toHaveBeenCalled();
    expect(onSync).not.toHaveBeenCalled();
    expect(service.stats.responsesReceived).toBe(0);
  });

  it('is ignored by the CSS-TS parser', () => {
    const service = new CSSTSService('ws://tv/ts', 'urn:dvb:css:timeline:pts');
    const onError = jest.fn();
    const onTimestamp = jest.fn();
    service.on('error', onError);
    service.on('control-timestamp', onTimestamp);

    service.handleMessage('pairingcompleted');

    expect(onError).not.toHaveBeenCalled();
    expect(onTimestamp).not.toHaveBeenCalled();
    expect(service.isTimelineAvailable()).toBe(false);
  });
});