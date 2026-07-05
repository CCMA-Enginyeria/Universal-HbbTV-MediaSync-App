import { getActiveCue, parseVtt } from '../VttParser';

describe('VttParser', () => {
  describe('parseVtt', () => {
    it('parses cues with hours, multiline text, tags, and entities', () => {
      const cues = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:03.500
<v Narrator>Hello &amp; welcome</v>
to HbbTV

00:01:00,000 --> 00:01:02,250
Second &lt;cue&gt;
`);

      expect(cues).toEqual([
        { startTime: 1, endTime: 3.5, text: 'Hello & welcome\nto HbbTV' },
        { startTime: 60, endTime: 62.25, text: 'Second <cue>' },
      ]);
    });

    it('skips empty input and malformed cue timings', () => {
      expect(parseVtt('')).toEqual([]);
      expect(parseVtt(`WEBVTT

bad timing
Ignored

00:00:05.000 --> 00:00:06.000
Valid
`)).toEqual([{ startTime: 5, endTime: 6, text: 'Valid' }]);
    });
  });

  describe('getActiveCue', () => {
    const cues = [
      { startTime: 2, endTime: 4, text: 'First' },
      { startTime: 5, endTime: 8, text: 'Second' },
    ];

    it('returns the cue active at the requested time', () => {
      expect(getActiveCue(cues, 5.5)).toBe(cues[1]);
    });

    it('returns null outside cue bounds', () => {
      expect(getActiveCue(cues, 1)).toBeNull();
      expect(getActiveCue(cues, 4)).toBeNull();
      expect(getActiveCue([], 5)).toBeNull();
      expect(getActiveCue(cues, null)).toBeNull();
    });
  });
});