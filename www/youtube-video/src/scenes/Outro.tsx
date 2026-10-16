import {fitText} from '@remotion/layout-utils';
import React, {useEffect, useState} from 'react';
import {
	AbsoluteFill,
	cancelRender,
	continueRender,
	delayRender,
	Img,
	OffthreadVideo,
	Sequence,
	staticFile,
	useCurrentFrame,
} from 'remotion';
import {fade} from '../anim';
import {OUTRO_FONT as fontFamily} from '../fonts';
import type {Strings} from '../i18n';
import {DURATION, T} from '../timeline';

const TAGLINE_LEFT = 930;
const TAGLINE_MAX_WIDTH = 1880 - TAGLINE_LEFT;
const TAGLINE_SIZE = 37;
const FEATHER =
	'linear-gradient(90deg, transparent, #000 40px, #000 calc(100% - 40px), transparent), linear-gradient(180deg, transparent, #000 18px, #000 calc(100% - 18px), transparent)';

/**
 * Logo animation from the original render. Only its English tagline is
 * covered with a clean background patch and redrawn in the target language.
 */
const LogoAnimation: React.FC<{s: Strings}> = ({s}) => {
	const frame = useCurrentFrame() + T.logo;
	const brightness = 1 - fade(frame, T.logoFadeOut, 15);
	// Measure once the font is loaded so long translations shrink to fit.
	const [fontSize, setFontSize] = useState<number | null>(null);
	const [handle] = useState(() => delayRender('Fitting tagline'));
	useEffect(() => {
		document.fonts
			.load(`400 ${TAGLINE_SIZE}px ${fontFamily}`)
			.then(() => {
				const fitted = fitText({text: s.tagline, withinWidth: TAGLINE_MAX_WIDTH, fontFamily, fontWeight: '400'});
				setFontSize(Math.min(TAGLINE_SIZE, fitted.fontSize));
				continueRender(handle);
			})
			.catch((err) => cancelRender(err));
	}, [handle, s.tagline]);
	if (fontSize === null) return null;
	return (
		<AbsoluteFill>
			<OffthreadVideo src={staticFile('original.mp4')} trimBefore={T.logo} muted />
			<AbsoluteFill style={{filter: `brightness(${brightness})`}}>
				<Img
					src={staticFile('outro-tagline-bg.png')}
					style={{
						position: 'absolute',
						left: 860,
						top: 722,
						// Feathered edges blend the still patch into the animated background.
						maskImage: FEATHER,
						maskComposite: 'intersect',
						WebkitMaskImage: FEATHER,
						WebkitMaskComposite: 'source-in',
					}}
				/>
				<div style={{opacity: fade(frame, T.tagline, 15)}}>
					<div style={{position: 'absolute', left: 901, top: 752, width: 4, height: 50, background: '#3d63e0'}} />
					<div
						style={{
							position: 'absolute',
							left: TAGLINE_LEFT,
							top: 777 - fontSize * 0.62,
							fontFamily,
							fontSize,
							color: '#aeb6cc',
							whiteSpace: 'nowrap',
							lineHeight: 1.2,
						}}
					>
						{s.tagline}
					</div>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

const EndCard: React.FC<{s: Strings}> = ({s}) => {
	const frame = useCurrentFrame() + T.endCard;
	const p = fade(frame, T.endCard, 10);
	return (
		<AbsoluteFill style={{background: '#000', alignItems: 'center', justifyContent: 'center'}}>
			<div
				style={{
					fontFamily,
					fontWeight: 600,
					fontSize: 188,
					lineHeight: '184px',
					color: '#fff',
					textAlign: 'center',
					opacity: p,
					filter: `blur(${(1 - p) * 8}px)`,
					marginTop: -16,
				}}
			>
				{s.endCard[0]}
				<br />
				{s.endCard[1]}
			</div>
		</AbsoluteFill>
	);
};

export const Outro: React.FC<{s: Strings}> = ({s}) => (
	<>
		<Sequence from={T.logo} durationInFrames={T.endCard - T.logo}>
			<LogoAnimation s={s} />
		</Sequence>
		<Sequence from={T.endCard} durationInFrames={DURATION - T.endCard}>
			<EndCard s={s} />
		</Sequence>
	</>
);
