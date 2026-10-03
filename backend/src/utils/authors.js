import { slugify } from './slug.js';

// Credits that file metadata often carries but that name nobody, so they get no author page.
const NOT_A_PERSON = new Set([
  'unknown',
  'unknown-author',
  'anonymous-author',
  'n-a',
  'none',
  'author',
  'admin',
  'administrator',
  'user',
  'owner',
  'microsoft-office-user',
]);

// Trims spaces and stray punctuation; a full stop stays only after an initial ("J. R. R.").
const tidy = (name) =>
  name
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:-]+|[\s,;:-]+$/g, '')
    .replace(/(\p{L}{2,})\.$/u, '$1')
    .slice(0, 120);

const words = (text) => text.split(' ').filter(Boolean).length;

// The people in a book's author line, each with the slug of their author page (/authors/:slug).
// "Jane Doe and John Roe", "Jane Doe & John Roe", "Jane Doe; John Roe", "Jane Doe, John Roe" and
// the Kiswahili "Jane Doe na John Roe" are two authors. "Doe, Jane" (surname first) and
// "Doe, J. R." stay one. Roles in brackets ("(editor)") and "et al." are dropped.
export function splitAuthors(credit) {
  const text = String(credit || '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\bet al\b\.?/gi, ' ')
    .replace(/^\s*by\s+/i, '')
    .trim();
  if (!text) return [];
  const names = [];
  for (const part of text.split(/\s*[;&]\s*|\s+(?:and|na)\s+/i)) {
    const pieces = part.split(',').map(tidy).filter(Boolean);
    // A comma between full names lists people; a comma before a single word is "Surname, Name".
    if (pieces.length > 1 && pieces.every((p) => words(p) >= 2)) names.push(...pieces);
    else names.push(tidy(part));
  }
  const seen = new Set();
  const authors = [];
  for (const name of names) {
    const slug = slugify(name);
    if (!slug || NOT_A_PERSON.has(slug) || seen.has(slug)) continue;
    seen.add(slug);
    authors.push({ name, slug });
  }
  return authors.slice(0, 10);
}
