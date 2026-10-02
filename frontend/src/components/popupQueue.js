import { useEffect, useSyncExternalStore } from 'react';

// Popups (support, book quote, share) appear one at a time in the centre of the screen. Each one
// joins this queue when it has something to show and takes its turn when it reaches the front.
let queue = [];
const listeners = new Set();

function update(next) {
  queue = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * True while it's this popup's turn. `wanted` says it has something to show; `first` lets a popup
 * the reader opened themselves (Share) go ahead of ones that are waiting.
 */
export function usePopupTurn(id, wanted, { first = false } = {}) {
  useEffect(() => {
    if (!wanted) return undefined;
    if (!queue.includes(id)) update(first ? [id, ...queue] : [...queue, id]);
    return () => update(queue.filter((x) => x !== id));
  }, [id, wanted, first]);
  return useSyncExternalStore(subscribe, () => queue[0] === id);
}
