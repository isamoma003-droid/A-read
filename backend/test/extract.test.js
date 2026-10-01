import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractBook } from '../src/services/extract/index.js';
import { makeEpub, makePdf } from './helpers.js';

test('extracts chapters from a TXT file with chapter headings', async () => {
  const text = [
    'My Book',
    '',
    'CHAPTER I.',
    'The Start',
    '',
    'It was a dark night. The rain fell.',
    '',
    'CHAPTER II.',
    '',
    'Morning came. Birds sang.',
  ].join('\n');
  const { sections, toc, stats } = await extractBook('txt', Buffer.from(text));
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, 'CHAPTER I.: The Start');
  assert.deepEqual(sections[0].paragraphs, [['It was a dark night.', 'The rain fell.']]);
  assert.equal(sections[1].title, 'CHAPTER II.');
  assert.equal(toc.length, 2);
  assert.equal(stats.sectionCount, 2);
});

test('chunks a TXT file without headings into parts', async () => {
  const paragraph = Array.from({ length: 100 }, () => 'word').join(' ') + '.';
  const text = Array.from({ length: 60 }, () => paragraph).join('\n\n');
  const { sections } = await extractBook('txt', Buffer.from(text));
  assert.equal(sections.length, 3);
  assert.equal(sections[0].title, 'Part 1');
});

test('decodes UTF-16 and strips Project Gutenberg boilerplate', async () => {
  const text = 'Licence blah\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\nHello world.\n\n*** END OF THE PROJECT GUTENBERG EBOOK X ***\nMore licence';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  const { sections } = await extractBook('txt', utf16);
  assert.deepEqual(sections.flatMap((s) => s.paragraphs.flat()), ['Hello world.']);
});

test('rejects an empty TXT file', async () => {
  await assert.rejects(extractBook('txt', Buffer.from('   \n  ')), /empty/);
});

test('extracts metadata, chapters, toc and cover from an EPUB', async () => {
  const epub = await makeEpub([
    { title: 'Opening', paragraphs: ['First sentence. Second sentence.', 'Another paragraph.'] },
    { title: 'Closing &amp; End', paragraphs: ['Goodbye.'] },
  ]);
  const result = await extractBook('epub', epub);
  assert.equal(result.metadata.title, 'Test EPUB');
  assert.equal(result.metadata.author, 'Tester');
  assert.equal(result.metadata.language, 'en');
  assert.equal(result.metadata.description, 'A test book.');
  assert.equal(result.sections.length, 2);
  assert.equal(result.sections[0].title, 'Opening');
  assert.equal(result.sections[0].href, 'text/ch1.xhtml');
  assert.deepEqual(result.sections[0].paragraphs, [['Opening'], ['First sentence.', 'Second sentence.'], ['Another paragraph.']]);
  assert.equal(result.sections[1].title, 'Closing & End');
  assert.deepEqual(result.toc, [
    { title: 'Opening', sectionIndex: 0, depth: 0 },
    { title: 'Closing & End', sectionIndex: 1, depth: 0 },
  ]);
  assert.equal(result.cover.mediaType, 'image/png');
});

test('rejects a file that is not an EPUB', async () => {
  await assert.rejects(extractBook('epub', Buffer.from('not a zip')), /damaged/);
});

test('extracts one section per PDF page with paragraphs', async () => {
  const pdf = makePdf([
    ['Page one has a line', 'that continues here.', '', 'A new paragraph.'],
    ['Second page.'],
    [],
  ]);
  const result = await extractBook('pdf', pdf);
  assert.equal(result.metadata.title, 'Test PDF');
  assert.equal(result.metadata.author, 'Tester');
  assert.equal(result.sections.length, 3);
  assert.equal(result.sections[0].title, 'Page 1');
  assert.deepEqual(result.sections[0].paragraphs, [['Page one has a line that continues here.'], ['A new paragraph.']]);
  assert.deepEqual(result.sections[1].paragraphs, [['Second page.']]);
  assert.deepEqual(result.sections[2].paragraphs, []);
  assert.equal(result.stats.sectionCount, 3);
});
