import {Easing, interpolate, spring} from 'remotion';
import {FPS} from './timeline';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

/** 0 → 1 linear ramp starting at `start`. */
export const fade = (frame: number, start: number, duration = 6) =>
	interpolate(frame, [start, start + duration], [0, 1], clamp);

/** 0 → 1 eased ramp without overshoot, used for layout moves. */
export const glide = (frame: number, start: number, duration = 30) =>
	interpolate(frame, [start, start + duration], [0, 1], {
		...clamp,
		easing: Easing.bezier(0.33, 1, 0.68, 1),
	});

/** Bouncy 0 → 1 spring, used for elements that pop in. */
export const pop = (frame: number, start: number, damping = 12) =>
	spring({frame: frame - start, fps: FPS, config: {damping, stiffness: 180}});

export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export type Placement = {x: number; y: number; scale: number};

/** Interpolates between placements; each step is [startFrame, duration, target]. */
export const place = (
	frame: number,
	initial: Placement,
	steps: [number, number, Placement][],
): Placement => {
	let current = initial;
	for (const [start, duration, target] of steps) {
		const t = glide(frame, start, duration);
		if (t <= 0) break;
		current = {
			x: mix(current.x, target.x, t),
			y: mix(current.y, target.y, t),
			scale: mix(current.scale, target.scale, t),
		};
	}
	return current;
};
