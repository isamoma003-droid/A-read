export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatHours(minutes) {
  if (!minutes) return '—';
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Typical silent reading ≈ 250 wpm, narration ≈ 155 wpm.
export const readingMinutes = (words) => words / 250;
export const listeningMinutes = (words) => words / 155;

export const formatNumber = (n) => (Number.isFinite(n) ? n.toLocaleString() : '0');

export const formatKes = (n) => `KES ${formatNumber(n)}`;

export function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function timeAgo(date) {
  const seconds = (Date.now() - new Date(date).getTime()) / 1000;
  const steps = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) {
      return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(value), unit);
    }
    value /= size;
  }
  return '';
}

export const FORMAT_LABELS = { pdf: 'PDF', epub: 'EPUB', txt: 'TXT' };
