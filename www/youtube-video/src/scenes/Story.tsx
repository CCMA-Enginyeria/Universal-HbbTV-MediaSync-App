import {fitText} from '@remotion/layout-utils';
import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {fade, glide, mix, place, pop} from '../anim';
import {Glasses, Headphones, Tower, VrHeadset, Waveform} from '../components/Icons';
import {OriginalInset} from '../components/OriginalInset';
import {Phone, SCREEN_H, SCREEN_W} from '../components/Phone';
import {Tv} from '../components/Tv';
import type {Strings} from '../i18n';
import {CHANNELS, COLORS, FONT, TILE_COLORS} from '../theme';
import {T} from '../timeline';

const text = (size: number, weight = 400, color = COLORS.ink): React.CSSProperties => ({
	fontFamily: FONT,
	fontSize: size,
	fontWeight: weight,
	color,
	whiteSpace: 'nowrap',
	lineHeight: 1,
});

/** Index of the channel shown at `frame`, or -1 before the first one. */
const channelAt = (frame: number) => {
	let index = -1;
	T.channels.forEach((start, i) => {
		if (frame >= start) index = i;
	});
	return index;
};

// ---------------------------------------------------------------- TV screen

const HbbTvScreen: React.FC<{frame: number; s: Strings}> = ({frame, s}) => {
	const line = (top: number, style: React.CSSProperties, opacity: number, value: string) => (
		<div style={{position: 'absolute', left: 0, right: 0, top, textAlign: 'center', opacity, ...style}}>
			{value}
		</div>
	);
	return (
		<>
			{line(158, text(108, 700, '#fff'), fade(frame, T.title, 8), s.tvTitle)}
			{line(331, text(72, 400, '#fff'), fade(frame, T.subtitle, 6), s.tvSubtitle)}
			{line(461, text(72, 400, COLORS.enabled), fade(frame, T.enabled, 6), s.tvEnabled)}
		</>
	);
};

const ChannelScreen: React.FC<{frame: number; index: number; s: Strings}> = ({frame, index, s}) => {
	const start = T.channels[index];
	const opacity = fade(frame, start + 2, index === 2 ? 10 : 6);
	return (
		<>
			<AbsoluteFill style={{background: CHANNELS[index].screen, opacity}}>
				<div style={{position: 'absolute', left: 0, right: 0, top: 240, textAlign: 'center', ...text(167, 700, '#fff')}}>
					{s.channel(index + 1)}
				</div>
				<div style={{position: 'absolute', left: 566, top: 477, width: 109, height: 6, background: '#fff'}} />
			</AbsoluteFill>
			<div style={{position: 'absolute', left: 37, top: 38, ...text(30, 700, '#fff')}}>{s.channelShort(index + 1)}</div>
		</>
	);
};

const TvScreen: React.FC<{frame: number; s: Strings}> = ({frame, s}) => {
	if (frame >= T.blank) return <OriginalInset />;
	const channel = channelAt(frame);
	if (channel >= 0) return <ChannelScreen frame={frame} index={channel} s={s} />;
	return <HbbTvScreen frame={frame} s={s} />;
};

// ------------------------------------------------------------- Phone screen

const HomeScreen: React.FC<{frame: number}> = ({frame}) => (
	<>
		{Array.from({length: 24}, (_, i) => {
			const p = pop(frame, T.firstTile + i * T.tileStep, 14);
			if (p <= 0) return null;
			const left = 29 + (i % 4) * 87.5;
			const top = 94 + Math.floor(i / 4) * 107;
			return (
				<div key={i} style={{position: 'absolute', left, top, width: 66, opacity: Math.min(1, p * 2)}}>
					<div
						style={{
							width: 66,
							height: 66,
							borderRadius: 15,
							background: TILE_COLORS[i % TILE_COLORS.length],
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							transform: `scale(${p})`,
							boxShadow: '0 3px 6px rgba(0,0,0,0.12)',
							...text(26, 700, '#fff'),
						}}
					>
						tv{i + 1}
					</div>
					<div style={{position: 'absolute', left: -20, right: -20, top: 78, textAlign: 'center', ...text(15, 400, '#333')}}>
						app tv{i + 1}
					</div>
				</div>
			);
		})}
	</>
);

const AppLaunch: React.FC<{frame: number}> = ({frame}) => {
	if (frame < T.appIcon) {
		return (
			<>
				<div
					style={{
						position: 'absolute',
						left: 122,
						top: 269,
						width: 141,
						height: 141,
						borderRadius: 28,
						background: '#fff',
						boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
					}}
				>
					<Img src={staticFile('logo.png')} style={{width: 120}} />
				</div>
				<div style={{position: 'absolute', left: 0, right: 0, top: 440, textAlign: 'center', ...text(22, 700, '#222')}}>
					app_universal_mediasync
				</div>
			</>
		);
	}
	const scale = mix(0.45, 1, pop(frame, T.appIcon, 15));
	return (
		<Img
			src={staticFile('app-icon.png')}
			style={{
				position: 'absolute',
				left: 34,
				top: 231,
				width: 312,
				height: 312,
				borderRadius: 70,
				transform: `scale(${scale})`,
				boxShadow: '0 12px 28px rgba(10,20,50,0.25)',
			}}
		/>
	);
};

const ChannelApp: React.FC<{frame: number; index: number; s: Strings}> = ({frame, index, s}) => {
	const {accent} = CHANNELS[index];
	const first = T.channels[index] + (index === 0 ? 12 : 10);
	return (
		<AbsoluteFill style={{background: COLORS.appBg}}>
			<div style={{position: 'absolute', left: 0, top: 0, width: SCREEN_W, height: 65, background: 'linear-gradient(180deg, #edf8f6, #dfeee9)'}} />
			<div style={{position: 'absolute', left: 0, top: SCREEN_H - 35, width: SCREEN_W, height: 35, background: '#c1d4dc'}} />
			<Img src={staticFile('logo.png')} style={{position: 'absolute', left: 18, top: 92, width: 46}} />
			<div style={{position: 'absolute', left: 77, top: 100, ...text(23, 700, '#1f2326')}}>{s.appName}</div>
			<div style={{position: 'absolute', left: 20, top: 156, width: 345, height: 1.5, background: COLORS.divider}} />
			<div style={{position: 'absolute', left: 20, top: 194, ...text(37, 700, accent)}}>{s.channel(index + 1)}</div>
			<div style={{position: 'absolute', left: 20, top: 251, ...text(17, 400, COLORS.muted)}}>{s.availableServices}</div>
			{s.services[index].map(([badge, label], i) => {
				const opacity = fade(frame, first + i * T.serviceStep, 6);
				const top = 319 + i * 93;
				return (
					<div key={i} style={{opacity, transform: `translateY(${(1 - opacity) * 10}px)`}}>
						<div
							style={{
								position: 'absolute',
								left: 20,
								top,
								width: 48,
								height: 48,
								borderRadius: 6,
								background: accent,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								...text(badge.length > 2 ? 16 : 20, 700, '#fff'),
							}}
						>
							{badge}
						</div>
						<div style={{position: 'absolute', left: 83, top: top + 12, ...text(25, 700, '#1f2326')}}>{label}</div>
						<div style={{position: 'absolute', left: 20, top: top + 70, width: 345, height: 1.5, background: COLORS.divider}} />
					</div>
				);
			})}
		</AbsoluteFill>
	);
};

const SyncAudioApp: React.FC<{frame: number; s: Strings}> = ({frame, s}) => (
	<AbsoluteFill style={{background: COLORS.mint}}>
		<div style={{position: 'absolute', left: 0, top: SCREEN_H - 38, width: SCREEN_W, height: 38, background: '#c8dde0'}} />
		<Img src={staticFile('logo.png')} style={{position: 'absolute', left: 133, top: 170, width: 120}} />
		<Waveform frame={frame} style={{position: 'absolute', left: 43, top: 354}} />
		<div style={{position: 'absolute', left: 0, right: 0, top: 585, textAlign: 'center', ...text(30, 700, COLORS.teal)}}>
			{s.syncAudioLabel}
		</div>
	</AbsoluteFill>
);

// ------------------------------------------------------------------ Diagram

const DASH_LINES = {
	feed: 'M 495 540 L 642 540',
	tv: 'M 962 540 C 1070 540 1080 274 1226 274',
	phone: 'M 962 540 C 1110 540 1190 760 1386 760',
};

const DottedPath: React.FC<{d: string; progress: number; frame: number; id: string}> = ({d, progress, frame, id}) => (
	<>
		<mask id={id} maskUnits="userSpaceOnUse">
			<path d={d} pathLength={1} stroke="#fff" strokeWidth={24} fill="none" strokeDasharray="1 1" strokeDashoffset={1 - progress} />
		</mask>
		<g mask={`url(#${id})`}>
			<path d={d} stroke="#d6e8e3" strokeWidth={8} fill="none" strokeLinecap="round" />
			<path
				d={d}
				stroke={COLORS.teal}
				strokeWidth={7}
				fill="none"
				strokeLinecap="round"
				strokeDasharray="0 23"
				strokeDashoffset={-frame * 1.2}
			/>
		</g>
	</>
);

const Diagram: React.FC<{frame: number; s: Strings}> = ({frame, s}) => {
	if (frame < T.broadcaster || frame >= T.toFeatures + 14) return null;
	const out = 1 - fade(frame, T.toFeatures, 12);
	const segment = Math.floor((frame - T.segments) / (20 / 3)) % 5;
	const boxIn = fade(frame, T.dashBox, 12);
	return (
		<AbsoluteFill style={{opacity: out}}>
			<div style={{opacity: fade(frame, T.broadcaster, 12)}}>
				<Tower style={{position: 'absolute', left: 210, top: 368}} />
				<div style={{position: 'absolute', left: 125, width: 400, top: 668, textAlign: 'center', ...text(44, 700, '#2a2d30')}}>
					{s.broadcaster}
				</div>
			</div>
			<svg width={1920} height={1080} style={{position: 'absolute', left: 0, top: 0}}>
				<DottedPath id="feed" d={DASH_LINES.feed} progress={glide(frame, T.dashLine, 10)} frame={frame} />
				<DottedPath id="tv" d={DASH_LINES.tv} progress={glide(frame, T.dashCurves, 10)} frame={frame} />
				<DottedPath id="phone" d={DASH_LINES.phone} progress={glide(frame, T.dashCurves, 10)} frame={frame} />
			</svg>
			<div
				style={{
					position: 'absolute',
					left: 651,
					top: 441,
					width: 308,
					height: 197,
					boxSizing: 'border-box',
					background: '#fff',
					border: '2px solid #b8d6cf',
					borderRadius: 6,
					boxShadow: '0 8px 20px rgba(0,0,0,0.06)',
					opacity: boxIn,
					transform: `scale(${mix(0.92, 1, boxIn)})`,
				}}
			>
				{Array.from({length: 5}, (_, i) => {
					const active = frame < T.segments || i === segment;
					return (
						<div
							key={i}
							style={{
								position: 'absolute',
								left: 57 + i * 40,
								top: 33,
								width: 30,
								height: 42,
								borderRadius: 2,
								background: active ? '#137b64' : COLORS.tealLight,
							}}
						/>
					);
				})}
				<div style={{position: 'absolute', left: 0, right: 0, top: 114, textAlign: 'center', ...text(40, 700, '#1f2326')}}>
					MPEG-DASH
				</div>
			</div>
		</AbsoluteFill>
	);
};

// ----------------------------------------------------------------- Features

type Chunk = {value: string; at: number};

// Headings keep the original 85 px unless a translation needs more room.
const TITLE_MAX_WIDTH = 1920 - 855 - 50;
const titleSize = (title: string) =>
	Math.min(85, fitText({text: title, withinWidth: TITLE_MAX_WIDTH, fontFamily: FONT, fontWeight: 700}).fontSize);

const Feature: React.FC<{frame: number; title: string; titleAt: number; chunks: Chunk[]}> = ({frame, title, titleAt, chunks}) => (
	<>
		<div style={{position: 'absolute', left: 855, top: 303, width: 90, height: 6, background: COLORS.teal}} />
		<div style={{position: 'absolute', left: 855, top: 357, opacity: fade(frame, titleAt, 6), ...text(titleSize(title), 700, COLORS.teal)}}>
			{title}
		</div>
		<div
			style={{
				position: 'absolute',
				left: 855,
				top: 478,
				width: 880,
				fontFamily: FONT,
				fontSize: 52,
				lineHeight: '68px',
				color: COLORS.ink,
			}}
		>
			{chunks.map((chunk, i) => (
				<span key={i} style={{opacity: fade(frame, chunk.at, 8)}}>
					{chunk.value}
				</span>
			))}
		</div>
	</>
);

const Features: React.FC<{frame: number; s: Strings}> = ({frame, s}) => {
	if (frame >= T.audio && frame < T.clear) {
		return (
			<Feature
				frame={frame}
				title={s.audioTitle}
				titleAt={T.audio}
				chunks={[
					{value: s.audioBody[0], at: T.audio1},
					{value: s.audioBody[1], at: T.audio2},
				]}
			/>
		);
	}
	if (frame >= T.video && frame < T.web) {
		return (
			<Feature
				frame={frame}
				title={s.videoTitle}
				titleAt={T.video}
				chunks={[
					{value: s.videoBody[0], at: T.video1},
					{value: s.videoBody[1], at: T.video2},
					{value: s.videoBody[2], at: T.video3},
				]}
			/>
		);
	}
	if (frame >= T.web) {
		return <Feature frame={frame} title={s.webTitle} titleAt={T.web} chunks={[{value: s.webBody, at: T.web}]} />;
	}
	return null;
};

const Accessory: React.FC<{frame: number}> = ({frame}) => {
	const appear = (start: number) => {
		const p = pop(frame, start, 14);
		return {opacity: Math.min(1, p * 1.5), transform: `scale(${mix(0.6, 1, p)})`};
	};
	if (frame >= T.audio1 && frame < T.audio2) {
		return <Headphones style={{position: 'absolute', left: 562, top: 680, ...appear(T.audio1)}} />;
	}
	if (frame >= T.audio2 && frame < T.clear) {
		return <Glasses style={{position: 'absolute', left: 553, top: 712, ...appear(T.audio2)}} />;
	}
	if (frame >= T.headset) {
		return <VrHeadset style={{position: 'absolute', left: 550, top: 690, ...appear(T.headset)}} />;
	}
	return null;
};

// -------------------------------------------------------------------- Story

export const Story: React.FC<{s: Strings}> = ({s}) => {
	const frame = useCurrentFrame();

	const tv = place(frame, {x: 320, y: 145, scale: 1}, [
		[T.tvShrink, 18, {x: 800, y: 300, scale: 0.66}],
		[T.toDiagram, 30, {x: 1230, y: 110, scale: 0.459}],
		[T.toFeatures + 3, 30, {x: 130, y: 110, scale: 0.459}],
	]);
	const phone = place(frame, {x: 220, y: 140, scale: 1}, [
		[T.toDiagram, 30, {x: 1390, y: 560, scale: 0.5}],
		[T.toFeatures + 3, 30, {x: 290, y: 560, scale: 0.5}],
	]);
	const rotation = -90 * (glide(frame, T.video3, 15) - glide(frame, T.web, 15));

	const channel = channelAt(frame);
	const ownAudioUi = frame >= T.audio && frame < T.clear;
	let phoneScreen: React.ReactNode;
	if (frame >= T.blank && !ownAudioUi) phoneScreen = <OriginalInset />;
	else if (ownAudioUi) phoneScreen = <SyncAudioApp frame={frame} s={s} />;
	else if (channel >= 0) phoneScreen = <ChannelApp frame={frame} index={channel} s={s} />;
	else if (frame >= T.appTile) phoneScreen = <AppLaunch frame={frame} />;
	else phoneScreen = <HomeScreen frame={frame} />;

	return (
		<AbsoluteFill style={{background: 'radial-gradient(ellipse 75% 85% at 50% 40%, #f7f8fa 0%, #eef1f4 55%, #dfe3e7 100%)'}}>
			<Diagram frame={frame} s={s} />
			<Tv place={tv}>
				<TvScreen frame={frame} s={s} />
			</Tv>
			{frame >= T.phoneIn ? (
				<Phone
					place={phone}
					rotation={rotation}
					opacity={fade(frame, T.phoneIn, 10)}
					statusBar={!(frame >= T.blank && !ownAudioUi)}
				>
					{phoneScreen}
				</Phone>
			) : null}
			<Features frame={frame} s={s} />
			<Accessory frame={frame} />
		</AbsoluteFill>
	);
};
