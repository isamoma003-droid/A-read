import { buildSection, cleanText, countWords, paragraphsFromPlainText } from './text.js';

const WORDS_PER_CHUNK = 2500;
const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|final';
const NUMBERED_HEADING = new RegExp(
  `^(chapter|part|book|act|section|letter|canto)\\s+([0-9]+|[ivxlcdm]+|${NUMBER_WORDS})\\b`,
  'i',
);
const NAMED_HEADING = /^(prologue|epilogue|introduction|preface|foreword|afterword|interlude)\b/i;

export function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^\ufeff/, '');
  const invalid = (utf8.match(/�/g) || []).length;
  // Lots of replacement characters means it wasn't UTF-8; Windows-1252 is the usual suspect.
  if (invalid > 10 && invalid > utf8.length / 1000) return new TextDecoder('windows-1252').decode(buffer);
  return utf8;
}

// Drops the Project Gutenberg licence header/footer when present.
function stripGutenberg(text) {
  const start = text.match(/^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG.*$/im);
  const end = text.match(/^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG.*$/im);
  if (!start) return text;
  return text.slice(start.index + start[0].length, end ? end.index : undefined);
}

function isHeading(line, previousLine) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80 || (previousLine ?? '').trim()) return false;
  return NUMBERED_HEADING.test(trimmed) || NAMED_HEADING.test(trimmed);
}

function splitByHeadings(text) {
  const lines = text.split('\n');
  const chapters = [];
  let current = { title: '', lines: [] };
  lines.forEach((line, i) => {
    if (isHeading(line, lines[i - 1])) {
      chapters.push(current);
      current = { title: line.trim(), lines: [] };
      // A chapter title on the following line ("CHAPTER I.\nThe Beginning") joins the heading.
      const next = lines[i + 1]?.trim();
      if (next && next.length <= 80 && !/[.!?]["”’]?$/.test(next) && !lines[i + 2]?.trim()) {
        current.title += `: ${next}`;
        lines[i + 1] = '';
      }
    } else {
      current.lines.push(line);
    }
  });
  chapters.push(current);
  return chapters.map((c) => ({ title: c.title, text: c.lines.join('\n') }));
}

function chunkParagraphs(paragraphs) {
  const chunks = [];
  let current = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    current.push(paragraph);
    words += countWords(paragraph);
    if (words >= WORDS_PER_CHUNK) {
      chunks.push(current);
      current = [];
      words = 0;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export async function extractTxt(buffer, { language } = {}) {
  const text = stripGutenberg(cleanText(decodeText(buffer)));
  if (!text.trim()) throw new Error('The text file is empty');

  const chapters = splitByHeadings(text);
  const headed = chapters.filter((c) => c.title);
  let sections;

  if (headed.length >= 2) {
    sections = [];
    for (const chapter of chapters) {
      const paragraphs = paragraphsFromPlainText(chapter.text);
      // Skip a near-empty preamble before the first heading (title page, contents list).
      if (!chapter.title && countWords(paragraphs.join(' ')) < 50) continue;
      sections.push(buildSection({ title: chapter.title || 'Front matter', paragraphs, language }));
    }
  } else {
    const chunks = chunkParagraphs(paragraphsFromPlainText(text));
    sections = chunks.map((paragraphs, i) =>
      buildSection({ title: chunks.length > 1 ? `Part ${i + 1}` : 'Text', paragraphs, language }),
    );
  }

  return {
    metadata: {},
    sections,
    toc: sections.map((s, i) => ({ title: s.title, sectionIndex: i, depth: 0 })),
  };
}
