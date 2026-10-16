/**
 * Frame numbers (30 fps) of every beat, measured on the original render so the
 * localized version keeps the same cut and the original soundtrack.
 */
export const FPS = 30;
export const DURATION = 3996;

export const T = {
	// TV intro
	title: 15,
	subtitle: 30,
	enabled: 48,
	tvShrink: 138,
	phoneIn: 158,
	// Phone home screen
	firstTile: 252,
	tileStep: 8,
	appTile: 474,
	appIcon: 479,
	// Channels
	channels: [732, 822, 906],
	serviceStep: 6,
	// MPEG-DASH diagram
	toDiagram: 1008,
	broadcaster: 1062,
	dashBox: 1084,
	dashLine: 1088,
	dashCurves: 1090,
	segments: 1107,
	toFeatures: 1302,
	// Features
	blank: 1356,
	audio: 1362,
	audio1: 1386,
	audio2: 1512,
	clear: 1656,
	video: 1662,
	video1: 1686,
	video2: 1746,
	video3: 1818,
	web: 1935,
	headset: 1968,
	// Original footage and outro
	footage: 2288,
	logo: 3439,
	tagline: 3780,
	logoFadeOut: 3876,
	endCard: 3893,
} as const;
