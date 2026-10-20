import { createTheme, ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SafeSlider, withColorPaletteOnly } from './SafeSlider';

/** A theme with the palette entry Headlamp adds: headerStyle.main is a font style, not a color. */
function headlampLikeTheme() {
  const theme = createTheme({ palette: { primary: { main: '#E40000' } } });
  Object.assign(theme.palette, {
    headerStyle: { main: { fontSize: '1.87rem', fontWeight: '700' } },
  });
  return theme;
}

describe('SafeSlider', () => {
  it("renders under Headlamp's theme (regression: charAt is not a function)", () => {
    render(
      <ThemeProvider theme={headlampLikeTheme()}>
        <SafeSlider aria-label="Temperature" min={0} max={2} step={0.05} value={0.7} />
      </ThemeProvider>
    );
    expect(screen.getByRole('slider', { name: 'Temperature' })).toBeTruthy();
  });

  it('drops only palette entries whose main is not a color', () => {
    const theme = headlampLikeTheme();
    const safe = withColorPaletteOnly(theme);
    const palette = safe.palette as unknown as Record<string, unknown>;
    expect(palette.headerStyle).toBeUndefined();
    expect(safe.palette.primary.main).toBe('#E40000');
    expect(safe.palette.mode).toBe(theme.palette.mode);
    expect(typeof safe.palette.getContrastText).toBe('function');
    expect(safe.typography).toBe(theme.typography);
  });
});
