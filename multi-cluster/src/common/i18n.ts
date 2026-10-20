/**
 * Text helper. The plugins are English only: `t('text', { param })` keeps the familiar call
 * shape but only fills in `{{param}}` placeholders and loads no locale files.
 *
 * The hook is deliberately not called `useTranslation`: the Headlamp plugin build rewrites
 * every `useTranslation()` call to set up plugin locales.
 */

type Options = Record<string, unknown>;

/** Replaces `{{name}}` placeholders with the given values; unknown placeholders are kept. */
export function interpolate(text: string, options?: Options): string {
  if (!options) return text;
  return text.replace(/{{\s*(\w+)\s*}}/g, (match, name) =>
    options[name] === undefined ? match : String(options[name])
  );
}

/** Formats an English text; usable outside React components. */
export const t = (key: string, options?: Options): string => interpolate(key, options);

/** Returns the text formatter, for use in React components. */
export function useText() {
  return { t };
}
