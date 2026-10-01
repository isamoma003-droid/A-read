import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildSection, cleanText } from './text.js';

// Groups pdf.js text items into lines, then lines into paragraphs using vertical gaps.
function pageParagraphs(items) {
  const lines = [];
  let current = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform[5];
    const height = Math.abs(item.height || item.transform[3]) || 10;
    if (!current || (Math.abs(y - current.y) > height * 0.5 && current.text.trim())) {
      if (current?.text.trim()) lines.push(current);
      current = { text: '', y, height };
    }
    current.text += item.str;
    if (item.hasEOL) {
      if (current.text.trim()) lines.push(current);
      current = null;
    }
  }
  if (current?.text.trim()) lines.push(current);
  if (!lines.length) return [];

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = Math.abs(lines[i - 1].y - lines[i].y);
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const typicalGap = gaps.length ? gaps[Math.floor((gaps.length - 1) / 2)] : 0;

  const paragraphs = [];
  let paragraph = '';
  lines.forEach((line, i) => {
    const text = cleanText(line.text).trim();
    const gap = i > 0 ? Math.abs(lines[i - 1].y - line.y) : 0;
    const newParagraph = i > 0 && typicalGap > 0 && gap > typicalGap * 1.4;
    if (newParagraph && paragraph) {
      paragraphs.push(paragraph);
      paragraph = '';
    }
    if (!paragraph) paragraph = text;
    else if (/\p{L}-$/u.test(paragraph) && /^\p{Ll}/u.test(text)) paragraph = paragraph.slice(0, -1) + text;
    else paragraph += ` ${text}`;
  });
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs;
}

async function readOutline(doc) {
  const outline = await doc.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const toc = [];
  async function walk(items, depth) {
    for (const item of items) {
      try {
        let dest = item.dest;
        if (typeof dest === 'string') dest = await doc.getDestination(dest);
        if (Array.isArray(dest) && dest[0]) {
          const ref = dest[0];
          const pageIndex = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
          toc.push({ title: (item.title || '').trim() || `Page ${pageIndex + 1}`, sectionIndex: pageIndex, depth });
        }
      } catch {
        // Ignore broken outline entries.
      }
      if (item.items?.length && depth < 3) await walk(item.items, depth + 1);
    }
  }
  await walk(outline, 0);
  return toc;
}

export async function extractPdf(buffer, { language } = {}) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy();
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected', { cause: err });
    throw new Error('This PDF file is damaged or not a real PDF', { cause: err });
  }

  try {
    const meta = await doc.getMetadata().catch(() => null);
    const info = meta?.info || {};
    const sections = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      sections.push(buildSection({ title: `Page ${pageNumber}`, paragraphs: pageParagraphs(content.items), language }));
      page.cleanup();
    }
    return {
      metadata: {
        title: typeof info.Title === 'string' ? info.Title.trim() : '',
        author: typeof info.Author === 'string' ? info.Author.trim() : '',
      },
      sections,
      toc: await readOutline(doc),
    };
  } finally {
    await loadingTask.destroy();
  }
}
