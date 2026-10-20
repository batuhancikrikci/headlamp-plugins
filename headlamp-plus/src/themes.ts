import { registerAppTheme } from '@kinvolk/headlamp-plugin/lib';
import { THEME_DARK, THEME_LIGHT } from './config';

type AppTheme = Parameters<typeof registerAppTheme>[0];

// Headlamp's stock "light" and "dark" themes (0.45.0), unchanged apart from the name. Font and
// background defaults are left to Headlamp so its original look is kept.

export const lightTheme: AppTheme = {
  name: THEME_LIGHT,
  base: 'light',
  primary: '#414141',
  secondary: '#eff2f5',
  text: { primary: '#44444f' },
  link: { color: '#0072c9' },
  background: { muted: '#f5f5f5' },
  sidebar: {
    background: '#f0f0f0',
    color: '#605e5c',
    selectedBackground: '#f2e600',
    selectedColor: '#292827',
    actionBackground: '#414141',
  },
  navbar: { background: '#f0f0f0', color: '#292827' },
  buttonTextTransform: 'none',
  radius: 6,
};

export const darkTheme: AppTheme = {
  name: THEME_DARK,
  base: 'dark',
  primary: '#ffffff',
  secondary: '#1b1a19',
  text: { primary: '#faf9f8' },
  background: { default: '#292827', surface: '#313131', muted: '#333333' },
  navbar: { background: '#252423', color: '#faf9f8' },
  sidebar: {
    background: '#252423',
    color: '#cdcdcd',
    selectedBackground: '#f2e600',
    selectedColor: '#f2e600',
    actionBackground: '#1b1a19',
  },
  buttonTextTransform: 'none',
  radius: 6,
};
