import { Settings } from '../models/Settings.js';

// Settings are read on sign-up, upload and every app open, so keep them for a few seconds.
// (Other server instances pick up a change within CACHE_MS.)
const CACHE_MS = 15_000;
let cache = null;

export async function getSettings() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const value = (await Settings.findById('system')) ?? new Settings();
  cache = { value, at: Date.now() };
  return value;
}

export async function updateSettings(changes, user) {
  const value = await Settings.findOneAndUpdate(
    { _id: 'system' },
    { $set: { ...changes, ...(user ? { updatedBy: user._id } : {}) } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true },
  );
  cache = { value, at: Date.now() };
  return value;
}

export const clearSettingsCache = () => {
  cache = null;
};

// What every visitor's app needs to know.
export const publicSettings = (s) => ({
  signupsOpen: s.signupsOpen,
  uploads: s.uploads,
  quotesEnabled: s.quotesEnabled,
  announcement: s.announcement,
});
