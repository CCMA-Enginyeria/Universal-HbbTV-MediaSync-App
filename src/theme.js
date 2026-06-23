/**
 * Design system.
 *
 * The base palette below is the white-label default. Brand-specific overrides
 * come from `src/brand/brand.config.js` (the `colors` field) and are merged on
 * top, so a fork only needs to change a few tokens there to restyle the app.
 */

import brand from './brand/brand.config';

const baseColors = {
  surface: '#0b1326',
  surfaceDim: '#0b1326',
  surfaceBright: '#31394d',
  surfaceContainerLowest: '#060e20',
  surfaceContainerLow: '#131b2e',
  surfaceContainer: '#171f33',
  surfaceContainerHigh: '#222a3d',
  surfaceContainerHighest: '#2d3449',
  onSurface: '#dae2fd',
  onSurfaceVariant: '#c7c4d7',
  inverseSurface: '#dae2fd',
  inverseOnSurface: '#283044',
  outline: '#908fa0',
  outlineVariant: '#464554',
  surfaceTint: '#c0c1ff',
  primary: '#c0c1ff',
  onPrimary: '#1000a9',
  primaryContainer: '#8083ff',
  onPrimaryContainer: '#0d0096',
  inversePrimary: '#494bd6',
  secondary: '#ddb7ff',
  onSecondary: '#490080',
  secondaryContainer: '#6f00be',
  onSecondaryContainer: '#d6a9ff',
  tertiary: '#89ceff',
  onTertiary: '#00344d',
  tertiaryContainer: '#009ada',
  onTertiaryContainer: '#002d43',
  error: '#ffb4ab',
  onError: '#690005',
  errorContainer: '#93000a',
  onErrorContainer: '#ffdad6',
  primaryFixed: '#e1e0ff',
  primaryFixedDim: '#c0c1ff',
  onPrimaryFixed: '#07006c',
  onPrimaryFixedVariant: '#2f2ebe',
  secondaryFixed: '#f0dbff',
  secondaryFixedDim: '#ddb7ff',
  onSecondaryFixed: '#2c0051',
  onSecondaryFixedVariant: '#6900b3',
  tertiaryFixed: '#c9e6ff',
  tertiaryFixedDim: '#89ceff',
  onTertiaryFixed: '#001e2f',
  onTertiaryFixedVariant: '#004c6e',
  background: '#0b1326',
  onBackground: '#dae2fd',
  surfaceVariant: '#2d3449',
};

// Merge brand overrides on top of the base palette.
export const colors = { ...baseColors, ...(brand.colors || {}) };

export const typography = {
  displayLg: {
    fontFamily: 'Inter',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 40,
    letterSpacing: -0.02,
  },
  headlineMd: {
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 32,
  },
  headlineSm: {
    fontFamily: 'Inter',
    fontSize: 20,
    fontWeight: '600',
    lineHeight: 28,
  },
  bodyLg: {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: '400',
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 20,
  },
  labelCaps: {
    fontFamily: 'Geist',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
    letterSpacing: 0.05,
  },
  statusSm: {
    fontFamily: 'Geist',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
};

export const radius = {
  sm: 4,
  DEFAULT: 8,
  md: 8,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const spacing = {
  base: 4,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  containerPadding: 16,
  gutter: 12,
};

export default {
  colors,
  typography,
  radius,
  spacing,
};
