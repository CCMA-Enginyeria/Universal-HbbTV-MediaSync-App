import React from 'react';
import type {Placement} from '../anim';
import {COLORS} from '../theme';
import {ScreenToCanvas} from './OriginalInset';

export const TV_W = 1280;
export const TV_H = 715;
const SCREEN = {left: 19, top: 18, width: 1242, height: 677};

/** Flat TV with stand. Drawn at 1280 px wide, then scaled by `place`. */
export const Tv: React.FC<{
	place: Placement;
	opacity?: number;
	children?: React.ReactNode;
}> = ({place, opacity = 1, children}) => {
	const {x, y, scale} = place;
	const toCanvas = `translate(${-SCREEN.left}px, ${-SCREEN.top}px) scale(${1 / scale}) translate(${-x}px, ${-y}px)`;
	return (
		<div
			style={{
				position: 'absolute',
				left: 0,
				top: 0,
				width: TV_W,
				height: TV_H + 80,
				transformOrigin: '0 0',
				transform: `translate(${x}px, ${y}px) scale(${scale})`,
				opacity,
			}}
		>
			{/* Stand */}
			<div
				style={{
					position: 'absolute',
					left: TV_W / 2 - 135,
					top: TV_H + 40,
					width: 270,
					height: 24,
					borderRadius: '50%',
					background: 'linear-gradient(180deg, #4b4f53, #2b2f33)',
					boxShadow: '0 14px 30px rgba(0,0,0,0.18)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: TV_W / 2 - 38,
					top: TV_H - 4,
					width: 76,
					height: 56,
					background: 'linear-gradient(90deg, #2a2e31, #4a5356 50%, #2a2e31)',
				}}
			/>
			{/* Body */}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					height: TV_H,
					borderRadius: 24,
					background: 'linear-gradient(160deg, #3a3f44 0%, #23272b 40%, #2f3337 100%)',
					boxShadow: '0 40px 70px rgba(30,40,50,0.22), 0 8px 18px rgba(30,40,50,0.12)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					...SCREEN,
					borderRadius: 8,
					overflow: 'hidden',
					background: COLORS.screenDark,
				}}
			>
				<ScreenToCanvas.Provider value={toCanvas}>{children}</ScreenToCanvas.Provider>
			</div>
			{/* Power LED */}
			<div
				style={{
					position: 'absolute',
					left: TV_W / 2 - 3,
					top: TV_H - 12,
					width: 6,
					height: 6,
					borderRadius: 3,
					background: '#78cfb0',
				}}
			/>
		</div>
	);
};
