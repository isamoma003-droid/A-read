import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../utils/useLatest.js';

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

export const speechSupported = Boolean(synth);

export function useBrowserVoices() {
  const [voices, setVoices] = useState(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return undefined;
    const update = () => {
      const v = synth.getVoices();
      if (v.length > 0) setVoices(v);
    };
    update();
    synth.addEventListener('voiceschanged', update);
    // On Android WebView or Chrome, voices load asynchronously
    const timer = setInterval(update, 500);
    const timeout = setTimeout(() => clearInterval(timer), 3000);

    return () => {
      synth.removeEventListener('voiceschanged', update);
      clearInterval(timer);
      clearTimeout(timeout);
    };
  }, []);
  return voices;
}

// The saved voice if it exists, otherwise the best-sounding voice for the book's language.
// Offline, only voices installed on the device (localService) can speak.
export function pickVoice(voices, voiceURI, language, { offline = false } = {}) {
  let usable = offline ? voices.filter((v) => v.localService) : voices;
  if (!usable || usable.length === 0) usable = voices;
  if (voiceURI) {
    const saved = usable.find((v) => v.voiceURI === voiceURI);
    if (saved) return saved;
  }
  const lang = (language || (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en').slice(0, 2).toLowerCase();
  const matches = usable.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return (
    matches.find((v) => /natural|neural|online|enhanced|premium/i.test(v.name)) ||
    matches.find((v) => v.default) ||
    matches[0] ||
    usable.find((v) => v.default) ||
    usable[0] ||
    null
  );
}

// Reads sentences one utterance at a time with the Web Speech API. Speaking per sentence gives
// exact highlighting and avoids browsers cutting off long utterances.
export function useSpeechPlayer({ sentences, rate, voice, onSentence, onEnd }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(null);
  const run = useRef(0);
  const current = useRef(null); // keeps the utterance alive (Chrome GC bug drops its events)
  const latest = useLatest({ sentences, rate, voice, onSentence, onEnd });

  const stop = useCallback(() => {
    run.current++;
    current.current = null;
    if (synth) {
      try {
        synth.cancel();
      } catch {
        // ignore
      }
    }
    setPlaying(false);
  }, []);

  const playFrom = useCallback((start) => {
    if (!synth) return;
    const id = ++run.current;
    let failures = 0;
    try {
      if (synth.paused) synth.resume();
      synth.cancel();
    } catch {
      // ignore
    }
    setError(null);
    setPlaying(true);

    const speak = (i) => {
      if (id !== run.current) return;
      const { sentences: list, rate: speed, voice: chosen, onSentence: report, onEnd: finished } = latest.current;
      if (i >= list.length) {
        run.current++;
        setPlaying(false);
        finished?.();
        return;
      }
      report?.(i);
      const text = list[i];
      if (!text || !text.trim()) {
        speak(i + 1);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      if (chosen) {
        utterance.voice = chosen;
      }
      utterance.lang = chosen?.lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US') || 'en-US';
      utterance.rate = speed;
      utterance.onend = () => {
        failures = 0;
        speak(i + 1);
      };
      utterance.onerror = (event) => {
        if (event.error === 'interrupted' || event.error === 'canceled') return;
        failures++;
        // One bad sentence is skipped; repeated failures mean the voice itself is broken.
        if (event.error === 'not-allowed' || failures >= 2) {
          run.current++;
          setPlaying(false);
          setError(
            event.error === 'not-allowed'
              ? 'Your browser or device blocked speech. Tap play again or check system text-to-speech settings.'
              : `Your device voice stopped working (${event.error}). Try another voice in reading settings.`,
          );
          return;
        }
        speak(i + 1);
      };
      current.current = utterance;
      try {
        if (synth.paused) synth.resume();
        synth.speak(utterance);
      } catch (e) {
        console.warn('SpeechSynthesis error:', e);
      }
    };

    // On Chrome/Android, issue speak in current or next microtask
    speak(start);
  }, [latest]);

  // Chrome's network voices stall after ~15 s of continuous speech unless nudged.
  useEffect(() => {
    if (!playing || !synth || voice?.localService !== false) return undefined;
    const timer = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [playing, voice]);

  useEffect(() => {
    const runs = run;
    try {
      synth?.cancel(); // clear speech left over from a previous page
    } catch {
      // ignore
    }
    return () => {
      runs.current++;
      try {
        synth?.cancel();
      } catch {
        // ignore
      }
    };
  }, []);

  return { supported: speechSupported, playing, error, playFrom, stop };
}
