import { ListChecks } from 'lucide-react';
import { useMyAssignments } from '../api/queries.js';
import { AssignmentCard } from '../components/RequiredShelf.jsx';
import { EmptyState, ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { useDocumentTitle } from '../utils/useDocumentTitle.js';

export default function RequiredPage() {
  const { data, isPending, error } = useMyAssignments();
  useDocumentTitle('Required reading');
  const open = (data || []).filter((a) => a.status !== 'finished');
  const done = (data || []).filter((a) => a.status === 'finished');

  return (
    <div className="narrow-wide">
      <header className="page-header">
        <h1 className="section-title">Required reading</h1>
        <p className="muted">Books you've been asked to read. Finish a book to tick it off, or mark it finished from its page.</p>
      </header>
      {isPending && <Spinner label="Loading…" />}
      <ErrorMessage error={error} />
      {data && data.length === 0 && (
        <EmptyState icon={ListChecks} title="Nothing assigned">
          When an admin assigns a book to you, it shows up here with its due date.
        </EmptyState>
      )}
      {open.length > 0 && (
        <section>
          <h2 className="subheading">To read ({open.length})</h2>
          <div className="assignment-grid">
            {open.map((item) => (
              <AssignmentCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {done.length > 0 && (
        <section>
          <h2 className="subheading">Finished ({done.length})</h2>
          <div className="assignment-grid">
            {done.map((item) => (
              <AssignmentCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
