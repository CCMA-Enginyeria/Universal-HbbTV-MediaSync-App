import { SynchronizedTimeline } from '../CSSTSService';
import config from '../../utils/config';

describe('CSS-TS timeline configuration', () => {
  it('uses the HbbTV MPD period-relative timeline at 1000 ticks per second', () => {
    const timeline = new SynchronizedTimeline(
      config.MEDIA_SYNC.TIMELINE_SELECTOR,
      config.MEDIA_SYNC.TICK_RATE
    );
    timeline.setWallClock({ now: () => 738236864000 });
    timeline.updateControlTimestamp({
      contentTime: 1000,
      wallClockTime: 738236864000,
      timelineSpeedMultiplier: 0,
    });

    expect(config.MEDIA_SYNC.TIMELINE_SELECTOR).toBe(
      'urn:dvb:css:timeline:mpd:period:rel:1000'
    );
    expect(config.MEDIA_SYNC.TICK_RATE).toBe(1000);
    expect(timeline.getCurrentPositionSeconds()).toBe(1);
    expect(timeline.isPaused()).toBe(true);
  });
});