import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { RefreshCw } from 'lucide-react';

export default function AppUpdateButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!Capacitor.isNativePlatform()) return null;

  const checkForUpdate = async () => {
    setBusy(true);
    setMessage('');
    try {
      const latest = await CapacitorUpdater.getLatest();
      if (latest.error) throw new Error(latest.message || 'Could not check for updates.');
      if (!latest.url) {
        setMessage(latest.message || 'A-read is up to date.');
        return;
      }

      const bundle = await CapacitorUpdater.download({
        url: latest.url,
        version: latest.version,
        ...(latest.checksum ? { checksum: latest.checksum } : {}),
        ...(latest.sessionKey ? { sessionKey: latest.sessionKey } : {}),
        ...(latest.manifest ? { manifest: latest.manifest } : {}),
      });
      await CapacitorUpdater.set({ id: bundle.id });
      await CapacitorUpdater.reload();
    } catch (error) {
      setMessage(error.message || 'Could not install the update. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="app-update-control">
      <button
        type="button"
        className="button button-ghost button-small app-update-button"
        onClick={checkForUpdate}
        disabled={busy}
        title="Check for an A-Read app update"
      >
        <RefreshCw size={15} aria-hidden="true" className={busy ? 'spin' : undefined} />
        <span>{busy ? 'Checking…' : 'Update'}</span>
      </button>
      {message && <span className="app-update-message" role="status">{message}</span>}
    </span>
  );
}
