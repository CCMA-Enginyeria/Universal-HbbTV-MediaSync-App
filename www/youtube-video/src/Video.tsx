import React from 'react';
import {AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile} from 'remotion';
import {STRINGS, type Lang} from './i18n';
import {Outro} from './scenes/Outro';
import {Story} from './scenes/Story';
import {T} from './timeline';

export type VideoProps = {lang: Lang};

export const MediaSyncVideo: React.FC<VideoProps> = ({lang}) => {
	const s = STRINGS[lang];
	return (
		<AbsoluteFill style={{background: '#000'}}>
			<Sequence durationInFrames={T.footage}>
				<Story s={s} />
			</Sequence>
			{/* Event footage, the UHD Spain article and the store badges: no text to localize. */}
			<Sequence from={T.footage} durationInFrames={T.logo - T.footage}>
				<OffthreadVideo src={staticFile('original.mp4')} trimBefore={T.footage} muted />
			</Sequence>
			<Outro s={s} />
			<Audio src={staticFile('original.mp4')} />
		</AbsoluteFill>
	);
};
