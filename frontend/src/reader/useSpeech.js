import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../utils/useLatest.js';

const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

export const speechSupported = Boolean(synth);

export function useBrowserVoices() {
  const [voices, setVoices] = useState(() => synth?.getVoices() ?? []);
  useEffect(() => {
    if (!synth) return undefined;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener('voiceschanged', update);
    return () => synth.removeEventListener('voiceschanged', update);
  }, []);
  return voices;
}

// The saved voice if it exists, otherwise the best-sounding voice for the book's language.
export function pickVoice(voices, voiceURI, language) {
  if (voiceURI) {
    const saved = voices.find((v) => v.voiceURI === voiceURI);
    if (saved) return saved;
  }
  const lang = (language || navigator.language || 'en').slice(0, 2).toLowerCase();
  const matches = voices.filter((v) => v.lang?.toLowerCase().startsWith(lang));
  return (
    matches.find((v) => /natural|neural|online|enhanced|premium/i.test(v.name)) ||
    matches.find((v) => v.default) ||
    matches[0] ||
    voices.find((v) => v.default) ||
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
    synth?.cancel();
    setPlaying(false);
  }, []);

  const playFrom = useCallback((start) => {
    if (!synth) return;
    const id = ++run.current;
    let failures = 0;
    synth.cancel();
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
      const utterance = new SpeechSynthesisUtterance(list[i]);
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang;
      }
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
              ? 'Your browser blocked speech. Press play to start.'
              : `Your device voice stopped working (${event.error}). Try another voice in reading settings.`,
          );
          return;
        }
        speak(i + 1);
      };
      current.current = utterance;
      synth.speak(utterance);
    };

    // Chrome sometimes drops a speak() issued in the same tick as cancel().
    setTimeout(() => speak(start), 60);
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
    synth?.cancel(); // clear speech left over from a previous page
    return () => {
      runs.current++;
      synth?.cancel();
    };
  }, []);

  return { supported: speechSupported, playing, error, playFrom, stop };
}
