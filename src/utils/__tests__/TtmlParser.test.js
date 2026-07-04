import { parseTtml } from '../TtmlParser';

describe('TtmlParser', () => {
  let consoleLogSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('parses namespaced TTML with nested spans and line breaks', () => {
    const cues = parseTtml(`<?xml version="1.0" encoding="UTF-8"?>
<tt:tt xmlns:tt="http://www.w3.org/ns/ttml">
  <tt:body>
    <tt:div>
      <tt:p begin="00:00:01.500" end="00:00:03.000">
        <tt:span>Hello</tt:span><tt:br/><tt:span>world</tt:span>
      </tt:p>
    </tt:div>
  </tt:body>
</tt:tt>`);

    expect(cues).toEqual([
      { startTime: 1.5, endTime: 3, text: 'Hello\nworld' },
    ]);
  });

  it('parses frame-based timestamps with the document frame rate', () => {
    const cues = parseTtml(`<tt xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:frameRate="50">
  <body>
    <div>
      <p begin="00:00:10:25" end="00:00:12:00">Frame timed cue</p>
    </div>
  </body>
</tt>`);

    expect(cues).toEqual([
      { startTime: 10.5, endTime: 12, text: 'Frame timed cue' },
    ]);
  });

  it('returns an empty array for empty or unsupported TTML input', () => {
    expect(parseTtml('')).toEqual([]);
    expect(parseTtml('<tt><head /></tt>')).toEqual([]);
    expect(parseTtml('<not-ttml />')).toEqual([]);
  });

  it('skips paragraphs without complete timing or text', () => {
    const cues = parseTtml(`<tt>
  <body>
    <div>
      <p begin="00:00:01.000">Missing end</p>
      <p begin="00:00:02.000" end="00:00:03.000"></p>
      <p begin="00:00:04.000" end="00:00:05.000">Visible</p>
    </div>
  </body>
</tt>`);

    expect(cues).toEqual([
      { startTime: 4, endTime: 5, text: 'Visible' },
    ]);
  });
});