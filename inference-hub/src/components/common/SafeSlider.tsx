import { Slider, SliderProps } from '@mui/material';
import { Theme, ThemeProvider } from '@mui/material/styles';
import React from 'react';

/**
 * Returns the theme without palette entries whose `main` is not a color string.
 *
 * MUI's Slider computes a lighten()/darken()/alpha() style for every palette entry that has a
 * `main` field. Headlamp's theme has `palette.headerStyle.main`, which is a font style object,
 * so a plain Slider crashes with "charAt is not a function". Other MUI components (Switch, Alert,
 * Badge) also require `light` or `contrastText` and are not affected.
 */
export function withColorPaletteOnly(theme: Theme): Theme {
  const palette = Object.fromEntries(
    Object.entries(theme.palette).filter(([, value]) => {
      const main = (value as { main?: unknown } | null | undefined)?.main;
      return main === undefined || typeof main === 'string';
    })
  ) as Theme['palette'];
  return { ...theme, palette };
}

/** MUI Slider that renders under Headlamp's theme (see withColorPaletteOnly). */
export function SafeSlider(props: SliderProps) {
  return (
    <ThemeProvider theme={withColorPaletteOnly}>
      <Slider {...props} />
    </ThemeProvider>
  );
}
