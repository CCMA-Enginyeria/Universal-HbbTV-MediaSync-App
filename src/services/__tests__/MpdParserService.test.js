import mpdParserService from '../MpdParserService';

function mockFetchXml(xml, response = {}) {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(xml),
    ...response,
  }));
}

describe('MpdParserService', () => {
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.resetAllMocks();
    delete global.fetch;
  });

  it('extracts audio, subtitle, video, and VOD metadata from a static MPD', async () => {
    mockFetchXml(`<MPD type="static" mediaPresentationDuration="PT1H2M3.5S">
  <BaseURL>media/</BaseURL>
  <Period>
    <AdaptationSet contentType="audio" lang="en" codecs="mp4a.40.2">
      <Representation id="a-low" bandwidth="64000" />
      <Representation id="a-high" bandwidth="128000" />
    </AdaptationSet>
    <AdaptationSet contentType="text" lang="ca" mimeType="text/vtt" label="Catalan subtitles">
      <Representation id="s1"><BaseURL>subs/ca.vtt</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="video" lang="en">
      <Representation id="v-low" bandwidth="500000" codecs="avc1.4d401f" width="640" height="360" />
      <Representation id="v-high" bandwidth="1500000" codecs="avc1.640028" width="1920" height="1080" />
    </AdaptationSet>
  </Period>
</MPD>`);

    const result = await mpdParserService.parseMpd('https://example.test/live/manifest.mpd');

    expect(global.fetch).toHaveBeenCalledWith('https://example.test/live/manifest.mpd');
    expect(result.durationSeconds).toBe(3723.5);
    expect(result.isLive).toBe(false);
    expect(result.mpdType).toBe('static');
    expect(result.audios).toEqual([
      {
        text: 'English (AAC)',
        iso: 'en',
        codec: 'mp4a.40.2',
        bandwidth: 128000,
        representationId: 'a-high',
        role: '',
        audioTrackIndex: 0,
      },
    ]);
    expect(result.subtitles).toEqual([
      {
        text: 'Catalan subtitles',
        iso: 'ca',
        url: 'https://example.test/live/media/subs/ca.vtt',
        format: 'vtt',
      },
    ]);
    expect(result.videos).toEqual([
      {
        text: 'English (1920x1080)',
        iso: 'en',
        url: 'https://example.test/live/manifest.mpd',
        codec: 'avc1.640028',
        bandwidth: 1500000,
        representationId: 'v-high',
        role: 'main',
        width: 1920,
        height: 1080,
        videoTrackIndex: 0,
      },
    ]);
  });

  it('detects audio description, private-use languages, and segmented TTML subtitles', async () => {
    mockFetchXml(`<MPD type="dynamic" availabilityStartTime="2026-07-04T10:00:00Z" minimumUpdatePeriod="PT5S" timeShiftBufferDepth="PT30S" suggestedPresentationDelay="PT3S">
  <Period>
    <BaseURL>period/</BaseURL>
    <AdaptationSet contentType="audio" lang="qaa" codecs="ec-3">
      <Role value="description" />
      <Representation id="ad" bandwidth="96000" />
    </AdaptationSet>
    <AdaptationSet mimeType="application/mp4" codecs="stpp" lang="qaz">
      <SegmentTemplate initialization="init.mp4" media="seg-$Number$.m4s" timescale="1000" duration="2000" startNumber="7" presentationTimeOffset="5000" />
      <Representation id="ttml" />
    </AdaptationSet>
  </Period>
</MPD>`);

    const result = await mpdParserService.parseMpd('https://example.test/manifest.mpd');

    expect(result.isLive).toBe(true);
    expect(result.durationSeconds).toBeNull();
    expect(result.availabilityStartTime).toBe('2026-07-04T10:00:00Z');
    expect(result.minimumUpdatePeriod).toBe('PT5S');
    expect(result.timeShiftBufferDepth).toBe('PT30S');
    expect(result.suggestedPresentationDelay).toBe('PT3S');
    expect(result.audios).toEqual([
      expect.objectContaining({
        text: 'Audio description (Dolby)',
        iso: 'qaa',
        codec: 'ec-3',
        role: 'description',
      }),
    ]);
    expect(result.subtitles).toEqual([
      {
        text: 'Other',
        iso: 'qaz',
        url: 'https://example.test/manifest.mpd',
        format: 'ttml',
        segmented: true,
        segmentTemplate: {
          initialization: 'init.mp4',
          media: 'seg-$Number$.m4s',
          timescale: 1000,
          duration: 2000,
          startNumber: 7,
          presentationTimeOffset: 5,
        },
        baseUrl: 'https://example.test/period/',
      },
    ]);
  });

  it('returns an empty result for invalid manifests and HTTP failures', async () => {
    mockFetchXml('<notMPD />');
    await expect(mpdParserService.parseMpd('https://example.test/not-mpd.xml')).resolves.toMatchObject({
      audios: [],
      subtitles: [],
      videos: [],
      availabilityStartTime: null,
      mpdType: 'static',
      isLive: false,
      durationSeconds: null,
    });

    global.fetch = jest.fn(() => Promise.resolve({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: jest.fn(),
    }));

    await expect(mpdParserService.parseMpd('https://example.test/missing.mpd')).resolves.toMatchObject({
      audios: [],
      subtitles: [],
      videos: [],
      isLive: false,
      durationSeconds: null,
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});