import React, {createContext, useContext} from 'react';
import {AbsoluteFill, OffthreadVideo, staticFile} from 'remotion';

/**
 * CSS transform that maps the coordinate space of a device screen back to the
 * 1920×1080 canvas. Devices provide it so their screens can show the original
 * render's pixels at exactly the same canvas position, even while the device
 * moves, scales or rotates.
 */
export const ScreenToCanvas = createContext<string>('none');

/**
 * Shows the original render (same frame) clipped to the enclosing device
 * screen. Used for photographic content that has no text: broadcast footage,
 * the sign language interpreter, the eclipse and the XR planets.
 */
export const OriginalInset: React.FC = () => {
	const transform = useContext(ScreenToCanvas);
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: 1920,
				height: 1080,
				transformOrigin: '0 0',
				transform,
			}}
		>
			<AbsoluteFill>
				<OffthreadVideo src={staticFile('original.mp4')} muted />
			</AbsoluteFill>
		</div>
	);
};
