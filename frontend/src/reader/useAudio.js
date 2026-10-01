import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../utils/useLatest.js';

// Index of the last sentence whose start time is <= t (marks are ascending).
export function findSentence(marks, t) {
  let lo = 0;
  let hi = marks.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (marks[mid] <= t + 0.05) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Owns one <audio> element (created in an effect, kept in a ref) and its play state.
function useAudioElement({ src, rate, startAt, onTime, onEnded, onDuration }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const handlers = useLatest({ onTime, onEnded, onDuration });

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audioRef.current = audio;
    const listeners = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      ended: () => handlers.current.onEnded?.(),
      timeupdate: () => handlers.current.onTime?.(audio.currentTime),
      durationchange: () => handlers.current.onDuration?.(audio.duration || 0),
      error: () => {
        if (audio.getAttribute('src')) setError('The audio file could not be loaded.');
        setPlaying(false);
      },
    };
    for (const [event, listener] of Object.entries(listeners)) audio.addEventListener(event, listener);
    return () => {
      for (const [event, listener] of Object.entries(listeners)) audio.removeEventListener(event, listener);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audioRef.current = null;
    };
  }, [handlers]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    if (src) {
      audio.src = src;
      if (startAt) audio.currentTime = startAt;
    } else {
      audio.removeAttribute('src');
    }
    // startAt only applies when a new file is loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.defaultPlaybackRate = rate; // survives src changes
    audio.playbackRate = rate;
  }, [rate, src]);

  const play = useCallback((fromTime) => {
    const audio = audioRef.current;
    if (!audio?.getAttribute('src')) return;
    setError(null);
    // Setting currentTime before metadata loads is allowed: it becomes the start position.
    if (fromTime !== undefined) audio.currentTime = fromTime;
    audio.play().catch((err) => {
      if (err.name !== 'AbortError') setError(err.name === 'NotAllowedError' ? 'Press play to start audio.' : err.message);
    });
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const seek = useCallback((time) => {
    const audio = audioRef.current;
    if (!audio) return 0;
    const target = Math.max(0, Math.min(time, audio.duration || time));
    audio.currentTime = target;
    return target;
  }, []);

  const currentTime = useCallback(() => audioRef.current?.currentTime || 0, []);

  return { playing, error, play, pause, seek, currentTime };
}

// Cloud narration for one section: plays its MP3 and reports the sentence being spoken.
export function useNarrationPlayer({ narration, rate, onSentence, onEnd }) {
  const latest = useLatest({ narration, onSentence });
  const lastIndex = useRef(-1);
  const url = narration?.url;

  const onTime = useCallback(
    (time) => {
      const marks = latest.current.narration?.marks;
      if (!marks?.length) return;
      const index = findSentence(marks, time);
      if (index !== lastIndex.current) {
        lastIndex.current = index;
        latest.current.onSentence?.(index);
      }
    },
    [latest],
  );

  const audio = useAudioElement({ src: url, rate, onTime, onEnded: onEnd });

  useEffect(() => {
    lastIndex.current = -1;
  }, [url]);

  const { play } = audio;
  const playFrom = useCallback(
    (sentence) => {
      const marks = latest.current.narration?.marks || [];
      lastIndex.current = sentence;
      play(marks[sentence] ?? 0);
    },
    [latest, play],
  );

  return { playing: audio.playing, error: audio.error, playFrom, stop: audio.pause, available: Boolean(url) };
}

// A single uploaded audiobook file with its own timeline.
export function useAudiobookPlayer({ url, initialTime = 0, rate }) {
  const [time, setTime] = useState(initialTime);
  const [duration, setDuration] = useState(0);
  const audio = useAudioElement({ src: url, rate, startAt: initialTime, onTime: setTime, onDuration: setDuration });

  const { seek: seekAudio, currentTime, play } = audio;
  const seek = useCallback((t) => setTime(seekAudio(t)), [seekAudio]);
  const skip = useCallback((delta) => seek(currentTime() + delta), [seek, currentTime]);

  return {
    playing: audio.playing,
    error: audio.error,
    time,
    duration,
    available: Boolean(url),
    play: useCallback(() => play(), [play]),
    stop: audio.pause,
    seek,
    skip,
  };
}
