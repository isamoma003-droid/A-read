import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickQuote } from '../src/services/quotes.js';

// A seeded random number generator, so every run tries the same sequences.
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31;
  };
}

const make = (books) =>
  Object.entries(books).flatMap(([book, count]) => Array.from({ length: count }, (_, i) => ({ _id: `${book}${i}`, bookKey: book })));

// Plays `rounds` full rounds and checks the rules on every pick.
function play(quotes, { rounds = 3, seed = 1 } = {}) {
  const random = seeded(seed);
  let seen = [];
  let last = null;
  const picks = [];
  for (let i = 0; i < quotes.length * rounds; i++) {
    const { quote, reset, keep } = pickQuote(quotes, { seen, lastBook: last?.bookKey, random });
    if (reset) seen = keep;
    assert.ok(!seen.includes(quote._id), `${quote._id} repeated within a round`);
    picks.push(quote);
    seen.push(quote._id);
    last = quote;
  }
  return picks;
}

test('every quote is shown once per round, never two from the same book in a row', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const picks = play(make({ a: 3, b: 2, c: 2, d: 1, e: 1 }), { seed });
    for (let i = 1; i < picks.length; i++) assert.notEqual(picks[i].bookKey, picks[i - 1].bookKey, `seed ${seed}, pick ${i}`);
    // The first round shows all nine.
    assert.equal(new Set(picks.slice(0, 9).map((q) => q._id)).size, 9);
  }
});

test('a book with many quotes is spread out instead of saved for the end', () => {
  // 3 of 5 quotes come from one book: the only order that works is a ? a ? a.
  for (let seed = 1; seed <= 25; seed++) {
    const picks = play(make({ a: 3, b: 1, c: 1 }), { rounds: 1, seed });
    assert.deepEqual(picks.map((q) => q.bookKey).filter((_, i) => i % 2 === 0), ['a', 'a', 'a']);
  }
});

test('when only the last book has quotes left, the others start over but its seen quotes stay seen', () => {
  const quotes = make({ a: 4, b: 1 });
  const { quote, reset, keep } = pickQuote(quotes, { seen: ['a0', 'b0', 'a1'], lastBook: 'a' });
  assert.equal(reset, true);
  assert.equal(quote.bookKey, 'b');
  assert.deepEqual(keep.sort(), ['a0', 'a1']);
});

test("a book with most of the quotes shows every one of them before any repeats", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const picks = play(make({ a: 6, b: 2 }), { rounds: 2, seed });
    const fromA = picks.filter((q) => q.bookKey === 'a').map((q) => q._id);
    // a's quotes alternate with b's; all six of a's come up before any of them repeats.
    assert.ok(fromA.length >= 6);
    assert.equal(new Set(fromA.slice(0, 6)).size, 6, `seed ${seed}: ${fromA.join(',')}`);
  }
});

test('with quotes from a single book, they still never repeat within a round', () => {
  const picks = play(make({ only: 3 }), { rounds: 1 });
  assert.equal(new Set(picks.map((q) => q._id)).size, 3);
});

test('no quotes, no pick', () => {
  assert.deepEqual(pickQuote([], {}), { quote: null, reset: false, keep: [] });
});
