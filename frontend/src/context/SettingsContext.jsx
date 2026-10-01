import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'a-read-settings';

export const DEFAULT_SETTINGS = {
  theme: 'system', // system | light | dark | sepia
  fontSize: 20, // px, text view
  lineHeight: 1.7,
  fontFamily: 'serif', // serif | sans
  rate: 1, // playback speed for every audio source
  voiceURI: '', // browser voice; empty = best match for the book language
  autoScroll: true,
  pdfZoom: 1,
};

function load() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const SettingsContext = createContext(null);

const systemDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(load);
  const [prefersDark, setPrefersDark] = useState(systemDark);

  const update = useCallback((patch) => setSettings((current) => ({ ...current, ...patch })), []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Not persisted; fine.
    }
  }, [settings]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  // "system" follows the OS; the resolved theme is exposed on <html data-theme>.
  const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = useMemo(() => ({ settings, update, theme }), [settings, update, theme]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings must be used inside <SettingsProvider>');
  return context;
}
