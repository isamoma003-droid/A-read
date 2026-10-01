import { extractEpub } from './epub.js';
import { extractPdf } from './pdf.js';
import { extractTxt } from './txt.js';
import { summarize } from './text.js';

const extractors = { pdf: extractPdf, epub: extractEpub, txt: extractTxt };

// Returns { metadata, sections, toc, cover?, stats } for a book file.
export async function extractBook(format, buffer, options = {}) {
  const extractor = extractors[format];
  if (!extractor) throw new Error(`Unsupported format: ${format}`);
  const result = await extractor(buffer, options);
  return { ...result, stats: summarize(result.sections) };
}
