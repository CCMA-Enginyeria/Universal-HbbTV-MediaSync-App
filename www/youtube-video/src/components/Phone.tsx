import React from 'react';
import type {Placement} from '../anim';
import {COLORS, FONT} from '../theme';
import {ScreenToCanvas} from './OriginalInset';

export const PHONE_W = 410;
export const PHONE_H = 800;
const INSET = 12;
export const SCREEN_W = PHONE_W - INSET * 2;
export const SCREEN_H = PHONE_H - INSET * 2;

export const StatusBar: React.FC = () => (
	<>
		<div
			style={{
				position: 'absolute',
				left: 28,
				top: 22,
				fontFamily: FONT,
				fontWeight: 700,
				fontSize: 18,
				color: '#1c1c1c',
			}}
		>
			9:41
		</div>
		<div
			style={{
				position: 'absolute',
				left: 140,
				top: 16,
				width: 106,
				height: 27,
				borderRadius: 14,
				background: '#16171c',
			}}
		/>
		<div
			style={{
				position: 'absolute',
				left: 333,
				top: 26,
				width: 24,
				height: 11,
				borderRadius: 3,
				border: '2px solid #1c1c1c',
				boxSizing: 'border-box',
				padding: 1.5,
			}}
		>
			<div style={{width: '100%', height: '100%', background: '#1c1c1c', borderRadius: 1}} />
		</div>
		<div
			style={{
				position: 'absolute',
				left: 133,
				top: 758,
				width: 120,
				height: 4,
				borderRadius: 2,
				background: '#2a2d30',
			}}
		/>
	</>
);

/**
 * Smartphone mock-up drawn at 410×800 and scaled/rotated around its centre.
 * Children are laid out in screen coordinates (386×776).
 */
export const Phone: React.FC<{
	place: Placement;
	rotation?: number;
	opacity?: number;
	screen?: string;
	statusBar?: boolean;
	children?: React.ReactNode;
}> = ({place, rotation = 0, opacity = 1, screen = COLORS.wallpaper, statusBar = true, children}) => {
	const {x, y, scale} = place;
	const cx = (PHONE_W * scale) / 2;
	const cy = (PHONE_H * scale) / 2;
	const transform = `translate(${x + cx}px, ${y + cy}px) rotate(${rotation}deg) translate(${-cx}px, ${-cy}px) scale(${scale})`;
	const toCanvas = `translate(${-INSET}px, ${-INSET}px) scale(${1 / scale}) translate(${cx}px, ${cy}px) rotate(${-rotation}deg) translate(${-(x + cx)}px, ${-(y + cy)}px)`;
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: PHONE_W,
				height: PHONE_H,
				transformOrigin: '0 0',
				transform,
				opacity,
				borderRadius: 70,
				background: 'linear-gradient(145deg, #4a4e54 0%, #1d1f23 30%, #16171c 70%, #3a3d42 100%)',
				boxShadow: '0 40px 60px rgba(30,40,50,0.22), 0 6px 14px rgba(30,40,50,0.15)',
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: INSET,
					top: INSET,
					width: SCREEN_W,
					height: SCREEN_H,
					borderRadius: 58,
					overflow: 'hidden',
					background: screen,
				}}
			>
				<ScreenToCanvas.Provider value={toCanvas}>{children}</ScreenToCanvas.Provider>
				{statusBar ? <StatusBar /> : null}
			</div>
		</div>
	);
};
