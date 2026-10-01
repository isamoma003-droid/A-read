import { CalendarClock, CheckCircle2, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useMyAssignments } from '../api/queries.js';
import BookCover from './BookCover.jsx';
import { ProgressBar } from './Feedback.jsx';

export function dueLabel(dueDate) {
  if (!dueDate) return 'No due date';
  const due = new Date(dueDate);
  const days = Math.round((due.setHours(23, 59, 59, 999) - Date.now()) / 86400000);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days < 14) return `Due in ${days} days`;
  return `Due ${new Date(dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

export function AssignmentCard({ item }) {
  const finished = item.status === 'finished';
  return (
    <Link to={`/books/${item.book.id}`} className={`assignment-card status-${item.status}`}>
      <BookCover book={item.book} size="small" />
      <div className="assignment-body">
        <strong className="assignment-title">{item.book.title}</strong>
        {item.book.author && <span className="muted small">{item.book.author}</span>}
        <span className="assignment-due">
          {finished ? <CheckCircle2 size={14} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}
          {finished ? 'Finished' : dueLabel(item.dueDate)}
        </span>
        {item.note && <span className="assignment-note">{item.note}</span>}
        {!finished && <ProgressBar value={item.percent} label={`${Math.round(item.percent)}% read`} />}
      </div>
    </Link>
  );
}

// Library section: the reader's unfinished required reading.
export default function RequiredShelf() {
  const { data } = useMyAssignments();
  const open = (data || []).filter((a) => a.status !== 'finished');
  if (!open.length) return null;
  return (
    <section className="required-shelf">
      <div className="library-header">
        <h2 className="section-title">Required reading</h2>
        <Link to="/required" className="see-all">
          See all <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <div className="assignment-grid">
        {open.slice(0, 4).map((item) => (
          <AssignmentCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
