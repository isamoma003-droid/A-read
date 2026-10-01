import { Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward } from 'lucide-react';
import { Spinner } from '../components/Feedback.jsx';
import { formatDuration } from '../utils/format.js';

const SPEEDS = [0.75, 0.9, 1, 1.15, 1.25, 1.5, 1.75, 2];
const MODE_LABELS = { device: 'Device voice', narration: 'Narration', audiobook: 'Audiobook' };

export default function AudioBar({
  modes,
  mode,
  onModeChange,
  playing,
  waiting,
  onToggle,
  onPrev,
  onNext,
  rate,
  onRate,
  status,
  error,
  audiobook,
  disabledReason,
}) {
  const isAudiobook = mode === 'audiobook';
  return (
    <div className="audio-bar" role="region" aria-label="Audio player">
      <div className="audio-bar-inner">
        {modes.length > 1 ? (
          <div className="segmented" role="tablist" aria-label="Audio source">
            {modes.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'active' : ''} onClick={() => onModeChange(m)}>
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        ) : (
          <span className="audio-mode-label">{MODE_LABELS[modes[0]] || 'Audio'}</span>
        )}

        <div className="audio-controls">
          <button type="button" className="icon-button" onClick={onPrev} disabled={Boolean(disabledReason)} title={isAudiobook ? 'Back 30 seconds' : 'Previous sentence'}>
            {isAudiobook ? <RotateCcw size={20} /> : <SkipBack size={20} />}
            <span className="sr-only">{isAudiobook ? 'Back 30 seconds' : 'Previous sentence'}</span>
          </button>
          <button
            type="button"
            className="play-button"
            onClick={onToggle}
            disabled={Boolean(disabledReason)}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
          >
            {waiting ? <Spinner size={22} /> : playing ? <Pause size={24} /> : <Play size={24} />}
            <span className="sr-only">{playing ? 'Pause' : 'Play'}</span>
          </button>
          <button type="button" className="icon-button" onClick={onNext} disabled={Boolean(disabledReason)} title={isAudiobook ? 'Forward 30 seconds' : 'Next sentence'}>
            {isAudiobook ? <RotateCw size={20} /> : <SkipForward size={20} />}
            <span className="sr-only">{isAudiobook ? 'Forward 30 seconds' : 'Next sentence'}</span>
          </button>
        </div>

        <div className="audio-status">
          {isAudiobook && audiobook ? (
            <div className="seek">
              <span>{formatDuration(audiobook.time)}</span>
              <input
                type="range"
                min={0}
                max={audiobook.duration || 0}
                step={1}
                value={Math.min(audiobook.time, audiobook.duration || 0)}
                onChange={(e) => audiobook.seek(Number(e.target.value))}
                aria-label="Seek"
              />
              <span>{formatDuration(audiobook.duration)}</span>
            </div>
          ) : (
            <span className="muted small">{error || disabledReason || status}</span>
          )}
          {isAudiobook && (error || disabledReason) && <span className="muted small">{error || disabledReason}</span>}
        </div>

        <label className="speed" title="Playback speed">
          <span className="sr-only">Playback speed</span>
          <select value={rate} onChange={(e) => onRate(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
