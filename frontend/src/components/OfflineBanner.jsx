import { WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOnline } from '../offline/useOnline.js';

export default function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} aria-hidden="true" /> You're offline. <Link to="/">Books you've opened recently</Link> still work, and your
      progress syncs when you reconnect.
    </div>
  );
}
