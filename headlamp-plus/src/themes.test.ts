import {
  darkTheme as stockDark,
  lightTheme as stockLight,
} from '@kinvolk/headlamp-plugin/lib/components/App/defaultAppThemes';
import { THEME_DARK, THEME_LIGHT } from './config';
import { darkTheme, lightTheme } from './themes';

describe('themes', () => {
  it('match Headlamp stock themes apart from the name', () => {
    expect(lightTheme).toEqual({ ...stockLight, name: THEME_LIGHT, base: 'light' });
    expect(darkTheme).toEqual({ ...stockDark, name: THEME_DARK });
  });
});
