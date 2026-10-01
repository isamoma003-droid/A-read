import { useEffect } from 'react';

const SITE = 'A-Read';
const DEFAULT_DESCRIPTION = 'A-Read: a free library you can read on screen or listen to. Upload PDF, EPUB and TXT books.';

function setMeta(name, content) {
  let tag = document.head.querySelector(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

// Page title + meta description, so each page is labelled in tabs and in search results.
export function useDocumentTitle(title, description) {
  useEffect(() => {
    document.title = title ? `${title} · ${SITE}` : `${SITE}: read and listen to books`;
    setMeta('description', description || DEFAULT_DESCRIPTION);
  }, [title, description]);
}
