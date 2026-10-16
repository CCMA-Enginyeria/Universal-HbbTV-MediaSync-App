import React from 'react';
import {Composition} from 'remotion';
import {STRINGS, type Lang} from './i18n';
import {DURATION, FPS} from './timeline';
import {MediaSyncVideo} from './Video';

export const RemotionRoot: React.FC = () => (
	<>
		{(Object.keys(STRINGS) as Lang[]).map((lang) => (
			<Composition
				key={lang}
				id={`MediaSync-${lang}`}
				component={MediaSyncVideo}
				durationInFrames={DURATION}
				fps={FPS}
				width={1920}
				height={1080}
				defaultProps={{lang}}
			/>
		))}
	</>
);
