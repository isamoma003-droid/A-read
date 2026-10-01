import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

// Browsers fire `beforeinstallprompt` when the app can be installed (PWA). Keep it so the
// button can show the install dialog later.
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

export default function InstallButton() {
  const [available, setAvailable] = useState(Boolean(deferredPrompt));

  useEffect(() => {
    const update = () => setAvailable(Boolean(deferredPrompt));
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);

  if (!available) return null;
  const install = async () => {
    const prompt = deferredPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    deferredPrompt = null;
    setAvailable(false);
  };
  return (
    <button type="button" className="icon-button" onClick={install} title="Install the A-Read app">
      <Download size={18} />
      <span className="sr-only">Install the A-Read app</span>
    </button>
  );
}
