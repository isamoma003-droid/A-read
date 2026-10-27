import { useEffect, useState } from 'react';
import { Download, Smartphone, X } from 'lucide-react';
import CenteredDialog from './CenteredDialog.jsx';

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

export function InstallModal({ open, onClose }) {
  const [pwaAvailable, setPwaAvailable] = useState(Boolean(deferredPrompt));

  useEffect(() => {
    const update = () => setPwaAvailable(Boolean(deferredPrompt));
    listeners.add(update);
    return () => listeners.delete(update);
  }, []);

  const installPwa = async () => {
    const prompt = deferredPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => null);
    deferredPrompt = null;
    setPwaAvailable(false);
    onClose?.();
  };

  return (
    <CenteredDialog open={open} onClose={onClose} labelledBy="install-app-title" className="install-modal">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h2 id="install-app-title" className="panel-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={20} /> Get A-Read App
        </h2>
        <button type="button" className="icon-button" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {pwaAvailable && (
          <div style={{ padding: '12px', background: 'var(--bg-subtle, rgba(0,0,0,0.03))', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>Option 1: Add Web App to Home Screen</h3>
            <p className="muted small" style={{ margin: '0 0 8px 0' }}>Install directly in your browser without downloading file packages.</p>
            <button type="button" className="button button-primary button-small" onClick={installPwa}>
              <Download size={15} /> Install Web App
            </button>
          </div>
        )}

        <div style={{ padding: '12px', background: 'var(--bg-subtle, rgba(0,0,0,0.03))', borderRadius: '8px' }}>
          <h3 style={{ margin: '0 0 4px 0', fontSize: '15px' }}>
            {pwaAvailable ? 'Option 2: Download Android APK' : 'Download Android App (.apk)'}
          </h3>
          <p className="muted small" style={{ margin: '0 0 8px 0' }}>Download and install the native Android APK directly on your Android phone.</p>
          <a
            href="/A-read.apk"
            download="A-read.apk"
            className="button button-primary button-small"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
          >
            <Download size={15} /> Download A-read.apk
          </a>
        </div>

        <div style={{ marginTop: '8px' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold' }}>How to install the APK on Android:</h4>
          <ol style={{ paddingLeft: '18px', margin: 0, fontSize: '13px', lineHeight: '1.5' }}>
            <li style={{ marginBottom: '6px' }}>
              Tap <strong>Download A-read.apk</strong> above.
            </li>
            <li style={{ marginBottom: '6px' }}>
              When finished, open <strong>A-read.apk</strong> from your phone's notification bar or <em>Downloads</em> folder.
            </li>
            <li style={{ marginBottom: '6px' }}>
              If Android blocks installation with <em>"For your security, your phone is not allowed to install unknown apps"</em>:
              <br />
              &bull; Tap <strong>Settings</strong> in the prompt.
              <br />
              &bull; Turn ON <strong>"Allow from this source"</strong> (or <em>Install unknown apps</em>).
            </li>
            <li>
              Go back and tap <strong>Install</strong>, then tap <strong>Open</strong> to enjoy A-Read!
            </li>
          </ol>
        </div>
      </div>
    </CenteredDialog>
  );
}

export default function InstallButton() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="button button-primary button-small install-button"
        onClick={() => setModalOpen(true)}
        title="Install the A-Read app or download the Android APK"
      >
        <Download size={18} />
        <span>Get App</span>
      </button>

      <InstallModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
