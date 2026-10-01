// Builds SSML requests for Google Cloud TTS. Every sentence is preceded by <mark name="s{i}"/>
// so the API returns the time each sentence starts, which drives follow-along highlighting.

export const MAX_SSML_BYTES = 4800; // Google's limit is 5000 bytes per request.
const PARAGRAPH_BREAK = '<break time="450ms"/>';

export function escapeSsml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const bytes = (text) => Buffer.byteLength(text, 'utf8');

// paragraphs: string[][] (sentences per paragraph). Returns [{ ssml, firstSentence, lastSentence }].
export function buildSsmlChunks(paragraphs, maxBytes = MAX_SSML_BYTES) {
  const open = '<speak>';
  const close = '</speak>';
  const chunks = [];
  let body = '';
  let first = 0;
  let index = 0;

  const flush = () => {
    if (body) chunks.push({ ssml: `${open}${body}${close}`, firstSentence: first, lastSentence: index - 1 });
    body = '';
    first = index;
  };

  for (const paragraph of paragraphs) {
    paragraph.forEach((sentence, i) => {
      const lead = i === 0 && body ? PARAGRAPH_BREAK : '';
      const piece = `${lead}<mark name="s${index}"/>${escapeSsml(sentence)} `;
      if (body && bytes(open + body + piece + close) > maxBytes) flush();
      body += body ? piece : piece.replace(PARAGRAPH_BREAK, '');
      index++;
    });
  }
  flush();
  return chunks;
}

// Converts Google timepoints into one start time per sentence, offset by the chunk start.
export function applyTimepoints(marks, timepoints, offsetSeconds) {
  for (const point of timepoints || []) {
    const match = /^s(\d+)$/.exec(point.markName || '');
    if (match) marks[Number(match[1])] = offsetSeconds + Number(point.timeSeconds || 0);
  }
}

// Sentences without a timepoint (rare) inherit the previous sentence's start time.
export function fillMissingMarks(marks) {
  let last = 0;
  return marks.map((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) last = value;
    return last;
  });
}
