import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyTimepoints, buildSsmlChunks, escapeSsml, fillMissingMarks } from '../src/services/ssml.js';

test('escapeSsml escapes XML special characters', () => {
  assert.equal(escapeSsml(`Tom & "Jerry" <3 'it'`), 'Tom &amp; &quot;Jerry&quot; &lt;3 &apos;it&apos;');
});

test('buildSsmlChunks marks every sentence and adds paragraph breaks', () => {
  const [chunk, ...rest] = buildSsmlChunks([['One.', 'Two.'], ['Three.']]);
  assert.equal(rest.length, 0);
  assert.equal(
    chunk.ssml,
    '<speak><mark name="s0"/>One. <mark name="s1"/>Two. <break time="450ms"/><mark name="s2"/>Three. </speak>',
  );
  assert.equal(chunk.firstSentence, 0);
  assert.equal(chunk.lastSentence, 2);
});

test('buildSsmlChunks keeps every request under the byte limit and numbering continuous', () => {
  const paragraphs = Array.from({ length: 30 }, (_, p) => Array.from({ length: 5 }, (_, s) => `Paragraph ${p} sentence ${s} is here.`));
  const chunks = buildSsmlChunks(paragraphs, 600);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => Buffer.byteLength(c.ssml) <= 600));
  assert.ok(chunks.every((c) => !c.ssml.startsWith('<speak><break')));
  chunks.forEach((c, i) => {
    if (i > 0) assert.equal(c.firstSentence, chunks[i - 1].lastSentence + 1);
  });
  assert.equal(chunks.at(-1).lastSentence, 149);
});

test('timepoints become per-sentence start times across chunks', () => {
  const marks = new Array(4).fill(null);
  applyTimepoints(marks, [{ markName: 's0', timeSeconds: 0 }, { markName: 's1', timeSeconds: 1.5 }], 0);
  applyTimepoints(marks, [{ markName: 's3', timeSeconds: 0.25 }], 3);
  assert.deepEqual(fillMissingMarks(marks), [0, 1.5, 1.5, 3.25]);
});
