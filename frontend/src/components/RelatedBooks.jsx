import { Link } from 'react-router-dom';
import { useRelated } from '../api/queries.js';
import BookCard from './BookCard.jsx';

// Shelves under a book: more by its author, then books like it.
export default function RelatedBooks({ book }) {
  const { data } = useRelated(book.id);
  if (!data) return null;
  const author = book.authors?.length === 1 ? book.authors[0] : null;
  return (
    <>
      {data.byAuthor.length > 0 && (
        <section className="related">
          <div className="library-header">
            <h2 className="section-title">More by {author ? author.name : 'these authors'}</h2>
            {author && (
              <Link to={`/authors/${encodeURIComponent(author.slug)}`} className="small">
                All books
              </Link>
            )}
          </div>
          <div className="shelf">
            {data.byAuthor.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}
      {data.similar.length > 0 && (
        <section className="related">
          <h2 className="section-title">You may also like</h2>
          <div className="shelf">
            {data.similar.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
