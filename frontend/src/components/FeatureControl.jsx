import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client.js';
import { keys } from '../api/queries.js';
import { ErrorMessage } from './Feedback.jsx';

const CHOICES = [
  [0, 'Not featured'],
  [7, 'Feature for 7 days'],
  [14, 'Feature for 14 days'],
  [30, 'Feature for 30 days'],
  [90, 'Feature for 90 days'],
];

// Admins: put a book on the home page's Featured shelf for a while (for example a paid placement
// for its author or publisher).
export default function FeatureControl({ book }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const change = async (days) => {
    setBusy(true);
    setError(null);
    try {
      const { featuredUntil } = await api(`/admin/books/${book.id}/featured`, { method: 'PUT', body: { days } });
      queryClient.setQueryData(keys.book(book.id), (old) => (old ? { ...old, featuredUntil } : old));
      queryClient.invalidateQueries({ queryKey: ['books'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="feature-control">
      <label className="checkbox">
        <Sparkles size={16} aria-hidden="true" />
        <select value="" disabled={busy} onChange={(e) => e.target.value !== '' && change(Number(e.target.value))} aria-label="Featured shelf">
          <option value="">{book.featuredUntil ? `Featured until ${new Date(book.featuredUntil).toLocaleDateString()}` : 'Featured shelf…'}</option>
          {CHOICES.filter(([days]) => days || book.featuredUntil).map(([days, label]) => (
            <option key={days} value={days}>
              {days ? label : 'Take off the Featured shelf'}
            </option>
          ))}
        </select>
      </label>
      <ErrorMessage error={error} />
    </div>
  );
}
