import { extractTtmlFromMp4 } from '../TtmlDemuxer';

function makeBox(type, payload) {
  const payloadBytes = Buffer.from(payload, 'utf8');
  const bytes = Buffer.alloc(payloadBytes.length + 8);
  bytes.writeUInt32BE(bytes.length, 0);
  bytes.write(type, 4, 4, 'ascii');
  payloadBytes.copy(bytes, 8);
  return bytes;
}

describe('TtmlDemuxer', () => {
  let consoleWarnSpy;

  beforeEach(() => {
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('extracts TTML XML from an mdat box', () => {
    const xml = '<tt><body><div><p begin="00:00:01.000" end="00:00:02.000">Hola món</p></div></body></tt>';
    const segment = Buffer.concat([makeBox('free', 'skip'), makeBox('mdat', xml)]);

    expect(extractTtmlFromMp4(segment)).toBe(xml);
  });

  it('accepts Uint8Array and ArrayBuffer input', () => {
    const xml = '<tt>Text</tt>';
    const segment = makeBox('mdat', xml);

    expect(extractTtmlFromMp4(new Uint8Array(segment))).toBe(xml);
    expect(extractTtmlFromMp4(segment.buffer.slice(segment.byteOffset, segment.byteOffset + segment.byteLength))).toBe(xml);
  });

  it('returns null when there is no valid XML TTML payload', () => {
    expect(extractTtmlFromMp4(null)).toBeNull();
    expect(extractTtmlFromMp4(Buffer.alloc(0))).toBeNull();
    expect(extractTtmlFromMp4(makeBox('free', '<tt />'))).toBeNull();
    expect(extractTtmlFromMp4(makeBox('mdat', 'not xml'))).toBeNull();
  });
});