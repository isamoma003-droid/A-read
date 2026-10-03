import { Fragment } from 'react';
import { Link } from 'react-router-dom';

// "Jane Doe and John Roe", each name linking to that author's page. Falls back to the plain
// author line when it names nobody in particular ("Unknown").
export default function AuthorLinks({ book }) {
  const authors = book.authors || [];
  if (!authors.length) return book.author;
  return authors.map((author, i) => (
    <Fragment key={author.slug}>
      {i > 0 && (i === authors.length - 1 ? ' and ' : ', ')}
      <Link to={`/authors/${encodeURIComponent(author.slug)}`} className="author-link">
        {author.name}
      </Link>
    </Fragment>
  ));
}

// Up to two initials for an author's badge: "Chinua Achebe" -> "CA".
export function initials(name) {
  const letters = String(name)
    .split(/[\s,]+/)
    .map((word) => word.match(/\p{L}/u)?.[0])
    .filter(Boolean);
  return (letters[0] || '?').toUpperCase() + (letters[1] || '').toUpperCase();
}
