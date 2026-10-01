import { useState } from 'react';

function hash(text) {
  let h = 0;
  for (const char of text) h = (h * 31 + char.codePointAt(0)) >>> 0;
  return h;
}

// Shows the Cloudinary cover, or a generated typographic cover when there is none.
export default function BookCover({ book, size = 'medium' }) {
  const [failed, setFailed] = useState(false);
  const url = book.cover?.url;
  if (url && !failed) {
    return (
      <div className={`cover cover-${size}`}>
        <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      </div>
    );
  }
  const h = hash(book.title || '');
  const hue = h % 360;
  const style = {
    '--cover-a': `hsl(${hue} 38% 32%)`,
    '--cover-b': `hsl(${(hue + 40) % 360} 42% 22%)`,
  };
  return (
    <div className={`cover cover-${size} cover-generated`} style={style} aria-hidden="true">
      <span className="cover-title">{book.title}</span>
      {book.author && <span className="cover-author">{book.author}</span>}
    </div>
  );
}
