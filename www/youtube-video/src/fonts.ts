import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

/**
 * Figtree (SIL OFL) is bundled in public/fonts instead of loaded from Google
 * Fonts, so rendering works offline and behind proxies the browser ignores.
 */
export const OUTRO_FONT = 'Figtree';

const faces = [
	['Figtree-latin.woff2', 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'],
	['Figtree-latin-ext.woff2', 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF'],
] as const;

const handle = delayRender('Loading Figtree');
Promise.all(
	faces.map(([file, unicodeRange]) =>
		new FontFace(OUTRO_FONT, `url(${staticFile(`fonts/${file}`)}) format('woff2')`, {
			weight: '300 900',
			unicodeRange,
		})
			.load()
			.then((face) => document.fonts.add(face)),
	),
)
	.then(() => continueRender(handle))
	.catch((err) => cancelRender(err));
