import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/Feedback.jsx';

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Page not found"
      action={
        <Link to="/" className="button button-primary">
          Back to the library
        </Link>
      }
    >
      This page doesn't exist, or the book was removed.
    </EmptyState>
  );
}
