import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProfile, categoryTerms, dictionaryEntriesFor, pickSections, stem, tokenize } from '../src/services/categorize.js';

test('words are compared lower-case and singular, without common words', () => {
  assert.equal(stem('stories'), 'story');
  assert.equal(stem('churches'), 'church');
  assert.equal(stem('novels'), 'novel');
  assert.equal(stem('glass'), 'glass');
  assert.equal(stem('virus'), 'virus');
  assert.deepEqual(tokenize('The Stories of the Churches, 1905'), ['story', 'church']);
  assert.deepEqual(tokenize('Hadithi za watoto na wazazi'), ['hadithi', 'watoto', 'wazazi']);
});

test('category names map to what A-Read knows, in English and Swahili', () => {
  assert.deepEqual(dictionaryEntriesFor('Novels').map((e) => e.name), ['Fiction']);
  assert.deepEqual(dictionaryEntriesFor('Dini').map((e) => e.name), ['Religion & Spirituality']);
  assert.deepEqual(dictionaryEntriesFor("Children's Books").map((e) => e.name), ['Children']);
  assert.deepEqual(dictionaryEntriesFor('Science & Technology').map((e) => e.name).sort(), ['Science & Nature', 'Technology & Computing']);
  assert.deepEqual(dictionaryEntriesFor('Club Picks'), []);
  const { terms, styles } = categoryTerms({ name: 'Mashairi', keywords: ['ngonjera'] });
  assert.ok(terms.has('poem') && terms.has('ngonjera') && terms.has('mashairi'));
  assert.deepEqual([...styles], ['verse']);
});

test('a text profile notices dialogue and short lines', () => {
  const story = buildProfile([[['“Come in,” she said.', 'He smiled.'], ['“Thank you,” he replied.']]]);
  assert.ok(story.dialogue > 0.5);
  assert.equal(story.terms.find(([t]) => t === 'smiled')?.[1], 1);
  const verse = buildProfile([[['The rain upon the roof'], ['a quiet song'], ['and then the night']]]);
  assert.equal(verse.shortLines, 1);
  assert.equal(verse.dialogue, 0);
  assert.deepEqual(buildProfile([]).terms, []);
});

test('samples are spread across the book and skip near-empty front matter', () => {
  const sections = Array.from({ length: 100 }, (_, index) => ({ index, wordCount: index < 3 ? 10 : 300 }));
  const picked = pickSections(sections);
  assert.ok(picked.length > 10 && picked.length <= 40);
  assert.ok(picked.every((i) => i >= 3), 'front matter skipped');
  assert.ok(Math.max(...picked) > 80, 'reaches the end of the book');
  assert.deepEqual(pickSections([{ index: 0, wordCount: 20 }]), [0]);
  assert.deepEqual(pickSections([{ index: 0, wordCount: 0 }]), []);
});
