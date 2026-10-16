/**
 * Every text drawn by the video. Add a language by copying `en` and
 * registering a composition for it in Root.tsx.
 *
 * Feature bodies are split into chunks because each chunk is revealed at a
 * different moment; keep the leading spaces so the chunks join naturally.
 */
export type Strings = {
	tvTitle: string;
	tvSubtitle: string;
	tvEnabled: string;
	appName: string;
	availableServices: string;
	channel: (n: number) => string;
	channelShort: (n: number) => string;
	services: [badge: string, label: string][][];
	broadcaster: string;
	syncAudioLabel: string;
	audioTitle: string;
	audioBody: [string, string];
	videoTitle: string;
	videoBody: [string, string, string];
	webTitle: string;
	webBody: string;
	tagline: string;
	endCard: [string, string];
};

const en: Strings = {
	tvTitle: 'HbbTv 2.0',
	tvSubtitle: 'inter-device mediasync',
	tvEnabled: 'enabled',
	appName: 'Universal MediaSync',
	availableServices: 'Available services',
	channel: (n) => `Channel ${n}`,
	channelShort: (n) => `CH 0${n}`,
	services: [
		[
			['CA', 'Catalan audio'],
			['EN', 'English audio'],
			['AD', 'Audiodescription'],
			['SL', 'Sign Language'],
		],
		[
			['ES', 'Spanish audio'],
			['VO', 'Original audio'],
			['CC', 'Subtitles'],
		],
		[
			['3D', 'Binaural audio'],
			['DC', 'Director’s commentary'],
			['SL', 'Sign Language'],
		],
	],
	broadcaster: 'Broadcaster',
	syncAudioLabel: 'Synchronised audio',
	audioTitle: 'Synchronised audio...',
	audioBody: [
		'for alternative audio, like other languages,',
		' or complementary audio, like audio description or director’s commentary.',
	],
	videoTitle: 'Synchronised video...',
	videoBody: [
		'from sign language',
		' to alternative camera angles',
		' and any kind of complementary content.',
	],
	webTitle: 'Any web experience',
	webBody: 'from interactive information to immersive XR experiences.',
	tagline: 'Open source second-screen sync for broadcasters',
	endCard: ['3Cat Engineering', '2026'],
};

const ca: Strings = {
	tvTitle: 'HbbTv 2.0',
	tvSubtitle: 'sincronització entre dispositius',
	tvEnabled: 'activada',
	appName: 'Universal MediaSync',
	availableServices: 'Serveis disponibles',
	channel: (n) => `Canal ${n}`,
	channelShort: (n) => `CANAL 0${n}`,
	services: [
		[
			['CA', 'Àudio en català'],
			['EN', 'Àudio en anglès'],
			['AD', 'Audiodescripció'],
			['LS', 'Llengua de signes'],
		],
		[
			['ES', 'Àudio en castellà'],
			['VO', 'Àudio original'],
			['SUB', 'Subtítols'],
		],
		[
			['3D', 'Àudio binaural'],
			['CD', 'Comentaris del director'],
			['LS', 'Llengua de signes'],
		],
	],
	broadcaster: 'Radiodifusor',
	syncAudioLabel: 'Àudio sincronitzat',
	audioTitle: 'Àudio sincronitzat...',
	audioBody: [
		'per a àudio alternatiu, com altres idiomes,',
		' o àudio complementari, com l’audiodescripció o els comentaris del director.',
	],
	videoTitle: 'Vídeo sincronitzat...',
	videoBody: [
		'des de la llengua de signes',
		' fins a angles de càmera alternatius',
		' i qualsevol tipus de contingut complementari.',
	],
	webTitle: 'Qualsevol experiència web',
	webBody: 'des d’informació interactiva fins a experiències XR immersives.',
	tagline: 'Sincronització de segona pantalla de codi obert per a radiodifusors',
	endCard: ['3Cat Enginyeria', '2026'],
};

export const STRINGS = {en, ca} as const;
export type Lang = keyof typeof STRINGS;
