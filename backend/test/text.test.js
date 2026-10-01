import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSection, countWords, paragraphsFromPlainText, splitSentences } from '../src/services/extract/text.js';

test('splitSentences splits on sentence boundaries', () => {
  assert.deepEqual(splitSentences('Hello there. How are you? I am fine!'), ['Hello there.', 'How are you?', 'I am fine!']);
});

test('splitSentences breaks very long runs into speakable pieces', () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const parts = splitSentences(long);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 400));
  assert.equal(parts.join(' '), long);
});

test('paragraphsFromPlainText joins hard-wrapped lines and de-hyphenates', () => {
  const text = 'First line of a\nwrapped para-\ngraph.\n\nSecond paragraph.';
  assert.deepEqual(paragraphsFromPlainText(text), ['First line of a wrapped paragraph.', 'Second paragraph.']);
});

test('paragraphsFromPlainText treats lines as paragraphs when there are no blank lines', () => {
  assert.deepEqual(paragraphsFromPlainText('One.\nTwo.\nThree.'), ['One.', 'Two.', 'Three.']);
});

test('buildSection counts words and sentences', () => {
  const section = buildSection({ title: '  Chapter  1 ', paragraphs: ['A cat sat. It slept.', 'The end.'] });
  assert.equal(section.title, 'Chapter 1');
  assert.deepEqual(section.paragraphs, [['A cat sat.', 'It slept.'], ['The end.']]);
  assert.equal(section.sentenceCount, 3);
  assert.equal(section.wordCount, 7);
  assert.equal(countWords("don't stop-me now"), 3);
});
