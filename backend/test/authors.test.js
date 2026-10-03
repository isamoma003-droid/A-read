import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitAuthors } from '../src/utils/authors.js';

const names = (credit) => splitAuthors(credit).map((a) => a.name);
const slugs = (credit) => splitAuthors(credit).map((a) => a.slug);

test('one author, with a page address made from the name', () => {
  assert.deepEqual(splitAuthors('Chinua Achebe'), [{ name: 'Chinua Achebe', slug: 'chinua-achebe' }]);
  assert.deepEqual(slugs("Ngũgĩ wa Thiong'o"), ['ngugi-wa-thiong-o']);
  assert.deepEqual(names('  by   Margaret   Ogola. '), ['Margaret Ogola']);
});

test('several authors each get a page', () => {
  assert.deepEqual(names('Jane Doe and John Roe'), ['Jane Doe', 'John Roe']);
  assert.deepEqual(names('Jane Doe & John Roe; Ann Lee'), ['Jane Doe', 'John Roe', 'Ann Lee']);
  assert.deepEqual(names('Juma Hamisi na Amina Ali'), ['Juma Hamisi', 'Amina Ali']);
  assert.deepEqual(names('Jane Doe, John Roe, Ann Lee'), ['Jane Doe', 'John Roe', 'Ann Lee']);
});

test('surname-first names, roles and repeats', () => {
  assert.deepEqual(names('Doe, Jane'), ['Doe, Jane']);
  assert.deepEqual(names('Tolkien, J. R. R.'), ['Tolkien, J. R. R.']);
  assert.deepEqual(names('Jane Doe (editor) and Jane  Doe'), ['Jane Doe']);
  assert.deepEqual(names('Jane Doe et al.'), ['Jane Doe']);
  assert.deepEqual(names('Kim Na-young'), ['Kim Na-young']);
});

test('credits that name nobody get no page', () => {
  assert.deepEqual(splitAuthors(''), []);
  assert.deepEqual(splitAuthors(null), []);
  assert.deepEqual(names('Unknown'), []);
  assert.deepEqual(names('Microsoft Office User'), []);
  assert.deepEqual(names('!!!'), []);
});
