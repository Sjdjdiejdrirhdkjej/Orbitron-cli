import kleur from 'kleur';

/**
 * Orbitron TUI Themes
 * Lightweight theme system — four built-in palettes applied via kleur's chainable API.
 */

export const THEMES = {
  default: {
    name: 'default',
    label: 'Cyan',
    description: 'Classic cyan-on-dark Orbitron palette',
    prompt: 'cyan',
    assistant: 'green',
    user: 'cyan',
    system: 'yellow',
    error: 'red',
    warning: 'yellow',
    muted: 'gray',
    accent: 'cyan',
    bold: 'bold',
  },
  forest: {
    name: 'forest',
    label: 'Forest',
    description: 'Muted greens and warm whites on dark',
    prompt: 'green',
    assistant: 'green',
    user: 'magenta',
    system: 'yellow',
    error: 'red',
    warning: 'yellow',
    muted: 'gray',
    accent: 'green',
    bold: 'bold',
  },
  solarized: {
    name: 'solarized',
    label: 'Solarized',
    description: 'Solarized dark — warm grays and cyan accents',
    prompt: 'cyan',
    assistant: 'green',
    user: 'blue',
    system: 'yellow',
    error: 'red',
    warning: 'yellow',
    muted: 'gray',
    accent: 'cyan',
    bold: 'bold',
  },
  mono: {
    name: 'mono',
    label: 'Mono',
    description: 'Monochrome — white on black, no colour noise',
    prompt: 'white',
    assistant: 'white',
    user: 'white',
    system: 'gray',
    error: 'white',
    warning: 'gray',
    muted: 'gray',
    accent: 'white',
    bold: 'bold',
  },
};

export const THEME_NAMES = Object.keys(THEMES);

function resolveStyle(name, fallback = (text) => text) {
  return typeof kleur[name] === 'function' ? kleur[name] : fallback;
}

export function getTheme(name) {
  const theme = THEMES[name] ?? THEMES.default;
  return {
    ...theme,
    prompt: resolveStyle(theme.prompt, kleur.cyan),
    assistant: resolveStyle(theme.assistant, kleur.green),
    user: resolveStyle(theme.user, kleur.cyan),
    system: resolveStyle(theme.system, kleur.yellow),
    error: resolveStyle(theme.error, kleur.red),
    warning: resolveStyle(theme.warning, kleur.yellow),
    muted: resolveStyle(theme.muted, kleur.gray),
    accent: resolveStyle(theme.accent, kleur.cyan),
    bold: resolveStyle(theme.bold, kleur.bold),
  };
}
