import React from 'react';
import {COLORS} from '../theme';

const DARK = '#2b3436';

type IconProps = {style?: React.CSSProperties};

export const Tower: React.FC<IconProps> = ({style}) => (
	<svg viewBox="0 0 190 250" width={190} height={250} style={style}>
		<g fill="none" stroke={COLORS.teal} strokeWidth={10} strokeLinecap="round">
			<path d="M 66 36 A 40 40 0 0 0 66 94" />
			<path d="M 124 36 A 40 40 0 0 1 124 94" />
			<path d="M 42 12 A 74 74 0 0 0 42 118" />
			<path d="M 148 12 A 74 74 0 0 1 148 118" />
		</g>
		<circle cx={95} cy={65} r={15} fill={COLORS.teal} />
		<g fill="none" stroke={DARK} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round">
			<path d="M 95 82 L 42 240 M 95 82 L 148 240 M 30 242 H 160" />
			<path d="M 71 152 H 119 M 71 152 L 133 204 M 119 152 L 57 204 M 57 204 H 133" />
		</g>
	</svg>
);

export const Headphones: React.FC<IconProps> = ({style}) => (
	<svg viewBox="0 0 188 162" width={188} height={162} style={style}>
		<path d="M 24 104 V 92 A 70 70 0 0 1 164 92 V 104" fill="none" stroke={DARK} strokeWidth={20} />
		<path d="M 38 108 V 94 A 56 56 0 0 1 150 94 V 108" fill="none" stroke={COLORS.teal} strokeWidth={7} />
		<rect x={4} y={92} width={42} height={70} rx={15} fill={DARK} />
		<rect x={142} y={92} width={42} height={70} rx={15} fill={DARK} />
		<rect x={33} y={106} width={7} height={44} rx={3.5} fill={COLORS.teal} />
		<rect x={148} y={106} width={7} height={44} rx={3.5} fill={COLORS.teal} />
	</svg>
);

export const Glasses: React.FC<IconProps> = ({style}) => (
	<svg viewBox="0 0 204 110" width={204} height={110} style={style}>
		<g stroke={DARK} strokeWidth={10} strokeLinejoin="round" strokeLinecap="round">
			<path d="M 10 60 L 52 12 M 194 60 L 152 12" fill="none" />
			<path d="M 10 60 H 92 L 88 84 Q 84 104 64 104 H 38 Q 18 104 14 84 Z" fill="#b8d9db" />
			<path d="M 112 60 H 194 L 190 84 Q 186 104 166 104 H 140 Q 120 104 116 84 Z" fill="#b8d9db" />
			<path d="M 92 70 Q 102 62 112 70" fill="none" />
		</g>
		<rect x={42} y={0} width={30} height={13} rx={6.5} fill={COLORS.teal} />
		<rect x={132} y={0} width={30} height={13} rx={6.5} fill={COLORS.teal} />
	</svg>
);

export const VrHeadset: React.FC<IconProps> = ({style}) => (
	<svg viewBox="0 0 242 170" width={242} height={170} style={style}>
		<defs>
			<linearGradient id="vr-body" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stopColor="#ffffff" />
				<stop offset="1" stopColor="#c9cdd2" />
			</linearGradient>
			<linearGradient id="vr-visor" x1="0" y1="0" x2="1" y2="1">
				<stop offset="0" stopColor="#3a4955" />
				<stop offset="1" stopColor="#0d1216" />
			</linearGradient>
			<filter id="vr-blur">
				<feGaussianBlur stdDeviation={4} />
			</filter>
		</defs>
		<ellipse cx={121} cy={156} rx={92} ry={8} fill="rgba(40,50,60,0.18)" filter="url(#vr-blur)" />
		<path d="M 30 74 Q 30 10 121 10 Q 212 10 212 74" fill="none" stroke="#6b6e72" strokeWidth={16} />
		<rect x={6} y={62} width={26} height={44} rx={10} fill="#8d9196" />
		<rect x={210} y={62} width={26} height={44} rx={10} fill="#8d9196" />
		<path
			d="M 20 62 Q 20 46 40 46 H 202 Q 222 46 222 62 V 94 Q 222 122 196 126 Q 160 130 140 114 Q 121 102 102 114 Q 82 130 46 126 Q 20 122 20 94 Z"
			fill="url(#vr-body)"
			stroke="#c4c8cd"
			strokeWidth={2}
		/>
		<path
			d="M 36 62 H 206 V 92 Q 206 112 188 114 Q 160 117 142 104 Q 121 90 100 104 Q 82 117 54 114 Q 36 112 36 92 Z"
			fill="url(#vr-visor)"
		/>
		<path d="M 62 70 H 180" stroke="#6b7a85" strokeWidth={3} strokeLinecap="round" />
	</svg>
);

// Bar heights of the "synchronised audio" waveform, symmetric around the centre.
const WAVE = [10, 18, 26, 34, 22, 14, 30, 48, 62, 40, 24, 52, 74, 90, 66, 38, 80, 38, 66, 90, 74, 52, 24, 40, 62, 48, 30, 14, 22, 34, 26, 18, 10];

export const Waveform: React.FC<{frame: number; color?: string; style?: React.CSSProperties}> = ({
	frame,
	color = COLORS.teal,
	style,
}) => (
	<svg viewBox="0 0 300 160" width={300} height={160} style={style}>
		{WAVE.map((h, i) => {
			const height = h * 1.9 * (0.8 + 0.2 * Math.sin(frame * 0.35 + i * 1.3));
			return (
				<rect
					key={i}
					x={4 + i * 9}
					y={80 - height / 2}
					width={6}
					height={height}
					rx={3}
					fill={color}
				/>
			);
		})}
	</svg>
);
