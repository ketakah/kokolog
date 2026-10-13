export const THEME_STORAGE_KEY = 'kokolog:theme';
export const THEME_PREFERENCES = Object.freeze(['system', 'light', 'dark']);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : 'system';
}

export function resolveTheme(preference, systemPrefersDark) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return normalized;
}

export class ThemeManager {
  constructor(settingsRepository, environment = globalThis) {
    this.settings = settingsRepository;
    this.environment = environment;
    this.preference = 'system';
    this.mediaQuery = null;
    this.handleSystemThemeChange = () => this.apply();
  }

  getPreference() {
    return this.preference;
  }

  getForcedTheme() {
    const value = new URLSearchParams(
      this.environment.location?.search || '',
    ).get('scoutTheme');
    return ['light', 'dark'].includes(value) ? value : null;
  }

  apply() {
    const forcedTheme = this.getForcedTheme();
    const resolved = forcedTheme || resolveTheme(
      this.preference,
      Boolean(this.mediaQuery?.matches),
    );
    this.environment.document?.documentElement.setAttribute(
      'data-theme',
      resolved,
    );
    return resolved;
  }

  mirrorPreference() {
    try {
      this.environment.localStorage?.setItem(
        THEME_STORAGE_KEY,
        this.preference,
      );
    } catch (error) {
      console.warn('テーマ設定をlocalStorageへ同期できませんでした。', error);
    }
  }

  async initialize() {
    if (typeof this.environment.matchMedia === 'function') {
      this.mediaQuery = this.environment.matchMedia(
        '(prefers-color-scheme: dark)',
      );
      this.mediaQuery.addEventListener?.(
        'change',
        this.handleSystemThemeChange,
      );
    }
    return this.refresh();
  }

  async refresh() {
    this.preference = normalizeThemePreference(
      await this.settings.get('theme', 'system'),
    );
    this.mirrorPreference();
    this.apply();
    return this.preference;
  }

  async setPreference(preference) {
    const normalized = normalizeThemePreference(preference);
    if (normalized !== preference) {
      throw new Error('テーマ設定が正しくありません。');
    }
    await this.settings.set('theme', normalized);
    this.preference = normalized;
    this.mirrorPreference();
    this.apply();
    return normalized;
  }

  destroy() {
    this.mediaQuery?.removeEventListener?.(
      'change',
      this.handleSystemThemeChange,
    );
  }
}
