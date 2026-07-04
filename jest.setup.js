jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }],
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: {
    PORTRAIT_UP: 'PORTRAIT_UP',
    LANDSCAPE: 'LANDSCAPE',
  },
  lockAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: 'StatusBar',
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return {
    MaterialIcons: ({ name, ...props }) => React.createElement(Text, props, name),
  };
});