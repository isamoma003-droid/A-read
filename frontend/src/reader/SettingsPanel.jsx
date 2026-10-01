import { useSettings } from '../context/SettingsContext.jsx';
import { pickVoice, speechSupported, useBrowserVoices } from './useSpeech.js';

const THEMES = [
  ['light', 'Light'],
  ['sepia', 'Sepia'],
  ['dark', 'Dark'],
  ['system', 'Auto'],
];

export default function SettingsPanel({ language }) {
  const { settings, update } = useSettings();
  const voices = useBrowserVoices();
  const lang = (language || navigator.language || 'en').slice(0, 2).toLowerCase();
  const matching = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  const others = voices.filter((v) => !v.lang?.toLowerCase().startsWith(lang));
  const active = pickVoice(voices, settings.voiceURI, language);

  return (
    <div className="settings-panel">
      <fieldset className="setting">
        <legend>Theme</legend>
        <div className="theme-swatches">
          {THEMES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`swatch swatch-${value} ${settings.theme === value ? 'active' : ''}`}
              onClick={() => update({ theme: value })}
              aria-pressed={settings.theme === value}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="setting">
        <span>
          Text size <strong>{settings.fontSize}px</strong>
        </span>
        <input type="range" min={14} max={32} step={1} value={settings.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
      </label>

      <label className="setting">
        <span>
          Line spacing <strong>{settings.lineHeight.toFixed(1)}</strong>
        </span>
        <input type="range" min={1.3} max={2.2} step={0.1} value={settings.lineHeight} onChange={(e) => update({ lineHeight: Number(e.target.value) })} />
      </label>

      <fieldset className="setting">
        <legend>Font</legend>
        <div className="segmented">
          <button type="button" className={settings.fontFamily === 'serif' ? 'active' : ''} onClick={() => update({ fontFamily: 'serif' })}>
            Serif
          </button>
          <button type="button" className={settings.fontFamily === 'sans' ? 'active' : ''} onClick={() => update({ fontFamily: 'sans' })}>
            Sans
          </button>
        </div>
      </fieldset>

      <label className="setting checkbox">
        <input type="checkbox" checked={settings.autoScroll} onChange={(e) => update({ autoScroll: e.target.checked })} />
        Keep the spoken sentence in view
      </label>

      <label className="setting">
        <span>Device voice</span>
        {speechSupported ? (
          <select value={settings.voiceURI} onChange={(e) => update({ voiceURI: e.target.value })}>
            <option value="">Automatic{active ? ` (${active.name})` : ''}</option>
            {matching.length > 0 && (
              <optgroup label="Book language">
                {matching.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}
                  </option>
                ))}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other languages">
                {others.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} · {v.lang}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          <small className="muted">This browser has no built-in text-to-speech.</small>
        )}
        <small className="muted">Voices come from your device and differ between browsers.</small>
      </label>
    </div>
  );
}
