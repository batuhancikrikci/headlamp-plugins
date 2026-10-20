/** Package name; also prefixes the plugin's DOM attributes and storage keys. */
export const PLUGIN_NAME = 'headlamp-plus';

/** Product name; change it here to rename the themes. */
export const PRODUCT_NAME = 'Headlamp Plus';

export const THEME_LIGHT = `${PRODUCT_NAME} Light`;
export const THEME_DARK = `${PRODUCT_NAME} Dark`;
/** The only themes users may pick; every other theme is hidden. */
export const PLUGIN_THEMES: readonly string[] = [THEME_LIGHT, THEME_DARK];

/** The UI language is locked to this locale. */
export const LOCKED_LANGUAGE = 'en';

/** Attribute set on elements hidden by the plugin. */
export const HIDDEN_ATTR = `data-${PLUGIN_NAME}-hidden`;
/** CSS variable holding the active theme's primary colour. */
export const PRIMARY_VAR = `--${PLUGIN_NAME}-primary`;
