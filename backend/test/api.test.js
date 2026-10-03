// End-to-end API tests. They need a MongoDB-compatible server:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test
// Cloudinary calls are stubbed, so no Cloudinary account is needed.
process.env.NODE_ENV ||= 'test'; // must be set before src/ modules load (they're imported in before())
process.env.ADMIN_EMAILS = 'alice@example.com';
process.env.SUPER_ADMIN_EMAILS = 'sam@example.com,sue@example.com';
process.env.CLOUDINARY_MAX_FILE_MB = '0.004'; // ~4 KB parts so the chunking path is exercised
process.env.FRONTEND_URL = 'https://a-read.example';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.INDEXNOW_KEY = 'test-indexnow-key-123';
Object.assign(process.env, {
  MPESA_CONSUMER_KEY: 'key',
  MPESA_CONSUMER_SECRET: 'secret',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'passkey',
  MPESA_TILL_NUMBER: '5551234',
  MPESA_CALLBACK_BASE_URL: 'https://api.a-read.example',
  MPESA_CALLBACK_SECRET: 'callback-secret',
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { makeEpub, makePdf } from './helpers.js';

const uri = process.env.MONGODB_URI_TEST;

describe('API', { skip: !uri && 'set MONGODB_URI_TEST to run API tests' }, () => {
  let server;
  let base;
  const uploads = [];
  const destroyed = [];
  const renamed = [];
  const announced = [];
  let renameFails = () => false;

  before(async () => {
    const { cloudinary } = await import('../src/config/cloudinary.js');
    cloudinary.config({ cloud_name: 'demo', api_key: 'key', api_secret: 'secret' });
    const fakeResult = (options) => ({
      secure_url: `https://res.cloudinary.com/demo/${options.resource_type}/upload/v1/${options.public_id}`,
      public_id: options.public_id,
      bytes: 123,
      format: 'x',
      duration: options.resource_type === 'video' ? 42.5 : undefined,
    });
    cloudinary.uploader.upload = (_path, options, done) => {
      uploads.push(options);
      done(undefined, fakeResult(options));
    };
    cloudinary.uploader.upload_stream = (options, done) => ({
      end: () => {
        uploads.push(options);
        done(undefined, fakeResult(options));
      },
    });
    cloudinary.uploader.destroy = async (publicId) => destroyed.push(publicId);
    cloudinary.uploader.rename = async (from, to, options) => {
      if (renameFails(from, to)) throw { error: { message: `Server error renaming ${from}` } };
      renamed.push({ from, to });
      return fakeResult({ public_id: to, resource_type: options.resource_type });
    };
    cloudinary.api.delete_resources_by_prefix = async (prefix) => destroyed.push(prefix);
    cloudinary.api.delete_folder = async () => {};

    // New and changed pages are announced to IndexNow; record them instead of calling out.
    const { setIndexNowTransport } = await import('../src/services/indexnow.js');
    setIndexNowTransport(async (url, { body }) => {
      announced.push(...JSON.parse(body).urlList);
      return { status: 202 };
    });

    const { connectDb } = await import('../src/config/db.js');
    const { createApp } = await import('../src/app.js');
    await connectDb(uri);
    await mongoose.connection.dropDatabase();
    server = createApp().listen(0);
    base = `http://127.0.0.1:${server.address().port}/api`;
  });

  after(async () => {
    server?.close();
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  });

  async function api(path, { token, method = 'GET', body, form } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  function bookForm(name, content, fields = {}) {
    const form = new FormData();
    form.append('file', new Blob([content]), name);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return form;
  }

  let alice;
  let bob;
  let txtBook;

  test('register, login and me', async () => {
    let res = await api('/auth/register', { method: 'POST', body: { name: 'Alice', email: 'Alice@Example.com', password: 'password1' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'alice@example.com');
    alice = res.body.token;

    res = await api('/auth/register', { method: 'POST', body: { name: 'Alice 2', email: 'alice@example.com', password: 'password1' } });
    assert.equal(res.status, 409);

    res = await api('/auth/register', { method: 'POST', body: { name: 'Bob', email: 'bob@example.com', password: 'short' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /8 characters/);

    res = await api('/auth/register', { method: 'POST', body: { name: 'Bob', email: 'bob@example.com', password: 'password2' } });
    bob = res.body.token;

    res = await api('/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'nope-nope' } });
    assert.equal(res.status, 401);
    res = await api('/auth/login', { method: 'POST', body: { email: 'alice@example.com', password: 'password1' } });
    assert.equal(res.status, 200);

    res = await api('/auth/me', { token: alice });
    assert.equal(res.body.user.name, 'Alice');
    assert.equal((await api('/auth/me', { token: 'garbage' })).status, 401);
  });

  test('upload a TXT book and read its sections', async () => {
    const text = 'CHAPTER 1\n\nIt was a dark night. Rain fell.\n\nCHAPTER 2\n\nMorning came.';
    const res = await api('/books', {
      token: alice,
      method: 'POST',
      form: bookForm('dark_night.txt', text, { author: 'A. Writer', tags: 'Mystery, classic' }),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    txtBook = res.body.book;
    assert.equal(txtBook.title, 'dark night');
    assert.equal(txtBook.format, 'txt');
    assert.equal(txtBook.sectionCount, 2);
    assert.deepEqual(txtBook.tags, ['mystery', 'classic']);
    assert.equal(txtBook.canEdit, true);
    assert.equal(txtBook.coverSource, 'none');
    assert.match(txtBook.file.publicId, /book\.txt$/);

    const sections = await api(`/books/${txtBook.id}/sections`, { token: bob });
    assert.deepEqual(sections.body.sections.map((s) => s.title), ['CHAPTER 1', 'CHAPTER 2']);
    const section = await api(`/books/${txtBook.id}/sections/0`, { token: bob });
    assert.deepEqual(section.body.section.paragraphs, [['It was a dark night.', 'Rain fell.']]);
    assert.equal((await api(`/books/${txtBook.id}/sections/9`, { token: bob })).status, 404);
    const offline = await api(`/books/${txtBook.id}/offline`, { token: bob });
    assert.equal(offline.body.sections.length, 2);
    assert.deepEqual(offline.body.sections[0], section.body.section);
    assert.equal((await api(`/books/${txtBook.id}/offline`)).status, 401);
  });

  test('rejects unsupported and broken files', async () => {
    let res = await api('/books', { token: alice, method: 'POST', form: bookForm('notes.docx', 'x') });
    assert.equal(res.status, 400);
    res = await api('/books', { token: alice, method: 'POST', form: bookForm('broken.epub', 'not a zip') });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /damaged/);
    res = await api('/books', { token: alice, method: 'POST', form: new FormData() });
    assert.equal(res.status, 400);
  });

  test('upload EPUB and PDF books with automatic covers', async () => {
    const epub = await makeEpub([{ title: 'One', paragraphs: ['Hello there.'] }], { title: 'Shiny Epub', author: 'E. Author' });
    let res = await api('/books', { token: bob, method: 'POST', form: bookForm('x.epub', epub) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.book.title, 'Shiny Epub');
    assert.equal(res.body.book.author, 'E. Author');
    assert.equal(res.body.book.coverSource, 'epub');
    assert.equal(res.body.book.toc[0].title, 'One');

    res = await api('/books', { token: bob, method: 'POST', form: bookForm('doc.pdf', makePdf([['Hello PDF.']], { title: 'Pdf Title' })) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.book.title, 'Pdf Title');
    assert.equal(res.body.book.coverSource, 'none');
    assert.equal(res.body.book.file.resourceType, 'raw');
    assert.match(res.body.book.file.publicId, /book\.pdf$/);
    assert.equal(res.body.book.file.parts, undefined);
  });

  test('large files are stored as parts under the per-file limit', async () => {
    const big = Array.from({ length: 400 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const res = await api('/books', { token: bob, method: 'POST', form: bookForm('big.txt', big) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { file } = res.body.book;
    assert.ok(file.parts.length >= 2);
    assert.deepEqual(file.parts.map((p) => p.publicId.split('.').pop()), file.parts.map((_, i) => `part${i}`));
    assert.equal(file.url, file.parts[0].url);
    const del = await api(`/books/${res.body.book.id}`, { token: bob, method: 'DELETE' });
    assert.equal(del.status, 204);
  });

  test('an upload sent again after a reload adds the book only once', async () => {
    const text = 'CHAPTER 1\n\nSent twice.';
    const send = (key, token = bob) => api('/books', { token, method: 'POST', form: bookForm('twice.txt', text, { uploadKey: key }) });

    // The page reloaded after the upload reached the server: the same key hands back the same book.
    let res = await send('key-reload-0001');
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const first = res.body.book;
    assert.equal(first.uploadKey, undefined, 'the key stays private');
    res = await send('key-reload-0001');
    assert.equal(res.status, 200);
    assert.equal(res.body.book.id, first.id);
    assert.equal(res.body.book.uploadedBy.name, 'Bob');

    // Both copies arrive at the same moment: still one book.
    const both = await Promise.all([send('key-at-once-0002'), send('key-at-once-0002')]);
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 201], JSON.stringify(both.map((r) => r.body)));
    assert.equal(both[0].body.book.id, both[1].body.book.id);
    const second = both[0].body.book;

    // The upload page asks which of its uploads already made it.
    res = await api('/books/uploads?keys=key-reload-0001,key-at-once-0002,key-never-sent-3,../bad', { token: bob });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.books).sort(), ['key-at-once-0002', 'key-reload-0001']);
    assert.equal(res.body.books['key-reload-0001'].id, first.id);
    // Keys belong to the person who uploaded: Alice's upload with Bob's key is a new book.
    assert.deepEqual((await api('/books/uploads?keys=key-reload-0001', { token: alice })).body.books, {});
    res = await send('key-reload-0001', alice);
    assert.equal(res.status, 201);
    assert.notEqual(res.body.book.id, first.id);
    const alices = res.body.book;
    assert.equal((await api('/books/uploads?keys=x')).status, 401);
    assert.equal((await send('no spaces allowed')).status, 400);

    for (const [book, token] of [[first, bob], [second, bob], [alices, alice]]) {
      assert.equal((await api(`/books/${book.id}`, { token, method: 'DELETE' })).status, 204);
    }
  });

  test('an upload cut off half-way (a reload, a closed tab) does not take the server down', async () => {
    const { port } = server.address();
    const boundary = '----a-read-test';
    await new Promise((resolve) => {
      const req = http.request({
        port,
        method: 'POST',
        path: '/api/books',
        headers: { authorization: `Bearer ${bob}`, 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': 10_000_000 },
      });
      req.on('error', () => resolve());
      req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cut.txt"\r\nContent-Type: text/plain\r\n\r\n`);
      req.write('x'.repeat(200_000), () => setTimeout(() => {
        req.destroy();
        resolve();
      }, 100));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await api('/health')).status, 200, 'still answering');
  });

  test('shared library lists, searches and filters every book', async () => {
    let res = await api('/books', { token: bob });
    assert.equal(res.body.total, 3);
    const txt = res.body.books.find((b) => b.id === txtBook.id);
    assert.equal(txt.canEdit, false);
    assert.equal(txt.uploadedBy.name, 'Alice');

    res = await api('/books?q=writer', { token: bob });
    assert.deepEqual(res.body.books.map((b) => b.id), [txtBook.id]);
    res = await api('/books?format=epub', { token: bob });
    assert.equal(res.body.books[0].format, 'epub');
    res = await api('/books?mine=true', { token: alice });
    assert.equal(res.body.total, 1);
    res = await api('/books?sort=title', { token: alice });
    assert.deepEqual(res.body.books.map((b) => b.title), ['dark night', 'Pdf Title', 'Shiny Epub']);
    assert.equal(res.body.books[0].sortTitle, undefined);
    res = await api('/books?tag=mystery', { token: alice });
    assert.equal(res.body.total, 1);
    res = await api('/books/tags', { token: alice });
    assert.deepEqual(res.body.tags.map((t) => t.tag).sort(), ['classic', 'mystery']);
    res = await api('/books?format=doc', { token: alice });
    assert.equal(res.status, 400);
  });

  test('share page serves link-preview tags and redirects to the app', async () => {
    const res = await fetch(`${base.replace('/api', '')}/share/books/${txtBook.id}`, { redirect: 'manual' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<meta property="og:title" content="dark night by A\. Writer">/);
    assert.match(html, new RegExp(`https://a-read\\.example/books/${txtBook.id}`));
    const missing = await fetch(`${base.replace('/api', '')}/share/books/nope`, { redirect: 'manual' });
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.get('location'), 'https://a-read.example');
  });

  test('admin panel API is admin-only', async () => {
    assert.equal((await api('/admin/stats', { token: bob })).status, 403);
    const stats = await api('/admin/stats', { token: alice });
    assert.equal(stats.status, 200);
    assert.equal(stats.body.users, 2);
    assert.equal(stats.body.books, 3);
    assert.equal(stats.body.formats.txt, 1);
    assert.ok(stats.body.words > 0, `words: ${stats.body.words}`);
    assert.ok(stats.body.storageBytes > 0);
    const users = (await api('/admin/users', { token: alice })).body.users;
    const bobUser = users.find((u) => u.email === 'bob@example.com');
    assert.equal(bobUser.books, 2);
    const me = users.find((u) => u.email === 'alice@example.com');
    assert.equal(me.role, 'admin');
    // Only super admins change roles (see the super admin test).
    const res = await api(`/admin/users/${bobUser.id}`, { token: alice, method: 'PATCH', body: { role: 'admin' } });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /super admin/);
  });

  test('guests can browse the catalogue but not read', async () => {
    let res = await api('/books');
    assert.equal(res.status, 200);
    assert.ok(res.body.total >= 3);
    assert.ok(res.body.books.every((b) => b.file === undefined && b.canEdit === false));
    res = await api(`/books/${txtBook.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.book.file, undefined);
    assert.equal((await api(`/books/${txtBook.id}/sections`)).status, 200);
    assert.equal((await api(`/books/${txtBook.id}/sections/0`)).status, 401);
    assert.equal((await api(`/books/${txtBook.id}`, { method: 'PATCH', body: { title: 'x' } })).status, 401);
    assert.equal((await api('/progress')).status, 401);
  });

  test('sitemaps list the main pages, every author and every book', async () => {
    const root = base.replace('/api', '');
    const get = async (path) => {
      const res = await fetch(`${root}${path}?origin=https://a-read.vercel.app`);
      return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
    };
    const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    let res = await get('/sitemap.xml');
    assert.equal(res.status, 200);
    assert.match(res.type, /xml/);
    assert.match(res.text, /<sitemapindex /);
    assert.deepEqual(locs(res.text), [
      'https://a-read.vercel.app/sitemaps/pages.xml',
      'https://a-read.vercel.app/sitemaps/authors-1.xml',
      'https://a-read.vercel.app/sitemaps/books-1.xml',
    ]);
    assert.match(res.text, /<lastmod>\d{4}-\d\d-\d\dT/);

    res = await get('/sitemaps/pages.xml');
    assert.deepEqual(locs(res.text), ['https://a-read.vercel.app/', 'https://a-read.vercel.app/authors']);

    res = await get('/sitemaps/authors-1.xml');
    assert.equal(res.status, 200);
    const authorPages = locs(res.text);
    assert.ok(authorPages.includes('https://a-read.vercel.app/authors/a-writer'), authorPages.join(' '));
    assert.ok(authorPages.includes('https://a-read.vercel.app/authors/e-author'));

    res = await get('/sitemaps/books-1.xml');
    assert.ok(locs(res.text).includes(`https://a-read.vercel.app/books/${txtBook.id}`));
    // Covers are listed for image search.
    assert.match(res.text, /<image:image><image:loc>https:\/\/res\.cloudinary\.com\/[^<]+<\/image:loc><\/image:image>/);

    for (const missing of ['/sitemaps/books-2.xml', '/sitemaps/books-0.xml', '/sitemaps/books.xml', '/sitemaps/pages-1.xml', '/sitemaps/x.xml']) {
      assert.equal((await get(missing)).status, 404, missing);
    }
    res = await get('/robots.txt');
    assert.match(res.text, /Sitemap: https:\/\/a-read\.vercel\.app\/sitemap\.xml/);
    res = await get('/indexnow-key.txt');
    assert.equal(res.text, 'test-indexnow-key-123');
  });

  test('everyone named as an author gets a page, announced to search engines', async () => {
    const { Book } = await import('../src/models/Book.js');
    const { backfillAuthors } = await import('../src/services/authors.js');
    const { flushIndexNow } = await import('../src/services/indexnow.js');
    const add = async (author) => {
      const res = await api('/books', { token: alice, method: 'POST', form: bookForm(`${author.length}.txt`, 'CHAPTER 1\n\nWords.', { author }) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.book;
    };
    await flushIndexNow();
    announced.length = 0;
    const one = await add('Chinua Achebe');
    const two = await add("Chinua Achebe and Ngũgĩ wa Thiong'o");
    const three = await add('Doe, Jane');
    assert.deepEqual(two.authors, [
      { name: 'Chinua Achebe', slug: 'chinua-achebe' },
      { name: "Ngũgĩ wa Thiong'o", slug: 'ngugi-wa-thiong-o' },
    ]);

    // New books and their authors' pages are announced together.
    await flushIndexNow();
    for (const page of [`/books/${one.id}`, `/books/${two.id}`, '/authors/chinua-achebe', '/authors/ngugi-wa-thiong-o', '/authors/doe-jane']) {
      assert.ok(announced.includes(`https://a-read.example${page}`), `${page} in ${announced.join(' ')}`);
    }

    // Anyone can browse the authors, search them and open one.
    let res = await api('/authors?q=achebe');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.authors.map((a) => [a.slug, a.name, a.books]), [['chinua-achebe', 'Chinua Achebe', 2]]);
    res = await api('/authors?sort=books&limit=1');
    assert.equal(res.body.authors[0].slug, 'chinua-achebe');
    assert.ok(res.body.total >= 4);
    assert.ok(res.body.pages >= 4);
    res = await api('/authors');
    const all = res.body.authors.map((a) => a.name);
    assert.deepEqual(all, [...all].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })), 'A to Z');
    res = await api('/authors/chinua-achebe');
    assert.deepEqual([res.body.author.name, res.body.author.books, res.body.author.bio], ['Chinua Achebe', 2, '']);
    res = await api('/books?author=chinua-achebe');
    assert.deepEqual(res.body.books.map((b) => b.id).sort(), [one.id, two.id].sort());
    assert.equal((await api('/authors/nobody-at-all')).status, 404);
    assert.equal((await api('/authors/bad%20slug!')).status, 400);

    // Admins write the bio on the author's page.
    assert.equal((await api('/authors/chinua-achebe', { token: bob, method: 'PUT', body: { bio: 'x' } })).status, 403);
    assert.equal((await api('/authors/nobody-at-all', { token: alice, method: 'PUT', body: { bio: 'x' } })).status, 404);
    res = await api('/authors/chinua-achebe', { token: alice, method: 'PUT', body: { bio: '  Nigerian novelist and poet.  ' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.author.bio, 'Nigerian novelist and poet.');
    assert.equal((await api('/authors/chinua-achebe')).body.author.bio, 'Nigerian novelist and poet.');

    // Editing the author line moves the book between pages.
    res = await api(`/books/${two.id}`, { token: alice, method: 'PATCH', body: { author: 'Chinua Achebe' } });
    assert.deepEqual(res.body.book.authors, [{ name: 'Chinua Achebe', slug: 'chinua-achebe' }]);
    assert.equal((await api('/authors/ngugi-wa-thiong-o')).status, 404);
    announced.length = 0;
    await flushIndexNow();
    assert.ok(announced.includes('https://a-read.example/authors/ngugi-wa-thiong-o'), 'the page that lost a book is announced too');

    // Books saved before author pages existed are set up at startup.
    await Book.collection.updateOne({ _id: new mongoose.Types.ObjectId(three.id) }, { $unset: { authors: '' } });
    assert.equal((await api('/authors/doe-jane')).status, 404);
    assert.equal(await backfillAuthors(), 1);
    assert.equal((await api('/authors/doe-jane')).body.author.name, 'Doe, Jane');
    assert.equal(await backfillAuthors(), 0);

    for (const book of [one, two, three]) await api(`/books/${book.id}`, { token: alice, method: 'DELETE' });
    assert.equal((await api('/authors/chinua-achebe')).status, 404);
  });

  test('only the uploader can edit a book', async () => {
    let res = await api(`/books/${txtBook.id}`, { token: bob, method: 'PATCH', body: { title: 'Hacked' } });
    assert.equal(res.status, 403);
    res = await api(`/books/${txtBook.id}`, { token: alice, method: 'PATCH', body: { title: 'A Dark Night', tags: ['Noir'] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.title, 'A Dark Night');
    assert.deepEqual(res.body.book.tags, ['noir']);
  });

  test('progress is saved per user and feeds continue reading', async () => {
    let res = await api(`/progress/${txtBook.id}`, { token: bob });
    assert.equal(res.body.progress, null);
    res = await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { sectionIndex: 1, sentenceIndex: 0, percent: 50 } });
    assert.equal(res.status, 200);
    res = await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { sectionIndex: 1, sentenceIndex: 2, percent: 60 } });
    assert.equal(res.body.progress.sentenceIndex, 2);
    res = await api('/progress', { token: bob });
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].book.title, 'A Dark Night');
    res = await api(`/books/${txtBook.id}`, { token: bob });
    assert.equal(res.body.book.progress.percent, 60);
    res = await api(`/progress/${txtBook.id}`, { token: alice });
    assert.equal(res.body.progress, null);
    res = await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { sectionIndex: -1 } });
    assert.equal(res.status, 400);
  });

  test('marking a book finished records completion', async () => {
    let res = await api(`/progress/${txtBook.id}`, { token: alice, method: 'PUT', body: { finished: true } });
    assert.equal(res.status, 200);
    assert.ok(res.body.progress.completedAt);
    assert.equal(res.body.progress.percent, 100);
    const first = res.body.progress.completedAt;
    res = await api(`/progress/${txtBook.id}`, { token: alice, method: 'PUT', body: { sectionIndex: 0, percent: 10 } });
    assert.equal(res.body.progress.completedAt, first, 'completion date is kept while re-reading');
    res = await api(`/books/${txtBook.id}`, { token: alice });
    assert.equal(res.body.book.finishedAt, first);
    res = await api(`/progress/${txtBook.id}`, { token: alice, method: 'PUT', body: { finished: false } });
    assert.equal(res.body.progress.completedAt, undefined);
  });

  test('readers rate and review books; the uploader cannot rate their own', async () => {
    const reviews = (token) => api(`/books/${txtBook.id}/reviews`, { token });
    const review = (token, body) => api(`/books/${txtBook.id}/reviews/mine`, { token, method: 'PUT', body });
    const rita = (await api('/auth/register', { method: 'POST', body: { name: 'Rita', email: 'rita@example.com', password: 'password8' } })).body.token;
    const before = (await api(`/books/${txtBook.id}`)).body.book;
    assert.equal(before.rating, null);

    let res = await reviews();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.summary, { average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    assert.deepEqual([res.body.reviews, res.body.mine, res.body.canReview], [[], null, false]);
    assert.equal((await review(undefined, { rating: 4 })).status, 401);
    assert.equal((await review(alice, { rating: 5 })).status, 403, 'Alice uploaded it');
    assert.equal((await reviews(alice)).body.canReview, false);
    assert.match((await review(bob, { rating: 6 })).body.error, /1 to 5 stars/);
    assert.equal((await review(bob, { rating: 3.5 })).status, 400);

    // Bob finished the book, so his review says so.
    await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { finished: true } });
    res = await review(bob, { rating: 4, text: '  Gripping from the first page.  ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.review.rating, res.body.review.text, res.body.review.finished, res.body.review.mine], [4, 'Gripping from the first page.', true, true]);
    assert.equal(res.body.summary.average, 4);
    // Stars without words count, but only reviews with words are listed.
    res = await review(rita, { rating: 5 });
    assert.deepEqual([res.body.summary.average, res.body.summary.count, res.body.summary.distribution[5]], [4.5, 2, 1]);
    res = await reviews();
    assert.deepEqual(res.body.reviews.map((r) => [r.user.name, r.rating, r.mine]), [['Bob', 4, false]]);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.reviews[0].user.email, undefined);
    res = await reviews(rita);
    assert.deepEqual([res.body.mine.rating, res.body.mine.text, res.body.mine.finished, res.body.canReview], [5, '', false, true]);

    // One review per reader: Bob changes his mind.
    res = await review(bob, { rating: 2, text: 'Slow in the middle.' });
    assert.deepEqual([res.body.summary.average, res.body.summary.count], [3.5, 2]);
    res = await api(`/books/${txtBook.id}`);
    assert.deepEqual(res.body.book.rating, { average: 3.5, count: 2 });
    assert.equal(res.body.book.updatedAt, before.updatedAt, "a review isn't a change to the book");
    res = await api('/books?sort=rating');
    assert.equal(res.body.books[0].id, txtBook.id, 'rated books come first');
    assert.deepEqual(res.body.books[0].rating, { average: 3.5, count: 2 });

    // Readers take their rating back; admins remove reviews that break the rules.
    res = await api(`/books/${txtBook.id}/reviews/mine`, { token: rita, method: 'DELETE' });
    assert.deepEqual([res.body.summary.average, res.body.summary.count], [2, 1]);
    const bobs = (await reviews()).body.reviews[0].id;
    assert.equal((await api(`/books/${txtBook.id}/reviews/${bobs}`, { token: bob, method: 'DELETE' })).status, 403);
    res = await api(`/books/${txtBook.id}/reviews/${bobs}`, { token: alice, method: 'DELETE' });
    assert.deepEqual(res.body.summary, { average: null, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    assert.equal((await api(`/books/${txtBook.id}`)).body.book.rating, null);
    assert.equal((await api(`/books/${txtBook.id}/reviews/${bobs}`, { token: alice, method: 'DELETE' })).status, 404);
    assert.equal((await api('/books/0123456789abcdef01234567/reviews')).status, 404);
    await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { finished: false } });

    // Removing an account takes its ratings with it.
    await review(rita, { rating: 1 });
    assert.equal((await api(`/books/${txtBook.id}`)).body.book.rating.count, 1);
    const ritaId = (await api('/auth/me', { token: rita })).body.user.id;
    assert.equal((await api(`/admin/users/${ritaId}`, { token: alice, method: 'DELETE' })).status, 204);
    assert.equal((await api(`/books/${txtBook.id}`)).body.book.rating, null);
  });

  test('book pages suggest more by the author and similar books; admins feature books', async () => {
    const add = async (author, tags) => {
      const res = await api('/books', { token: alice, method: 'POST', form: bookForm(`${tags}.txt`, 'CHAPTER 1\n\nWords.', { author, tags }) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.book;
    };
    const first = await add('Zed Writer', 'sea, adventure');
    const second = await add('Zed Writer', 'poetry');
    const closest = await add('Other One', 'sea, adventure');
    const close = await add('Other Two', 'adventure');
    const unrelated = await add('Other Three', 'cooking');

    let res = await api(`/books/${first.id}/related`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.byAuthor.map((b) => b.id), [second.id]);
    assert.deepEqual(res.body.similar.map((b) => b.id), [closest.id, close.id], 'most shared tags first');
    assert.ok(res.body.similar.every((b) => b.file === undefined), 'guests get catalogue entries');
    res = await api(`/books/${unrelated.id}/related`);
    assert.deepEqual([res.body.byAuthor, res.body.similar], [[], []]);
    assert.equal((await api('/books/0123456789abcdef01234567/related')).status, 404);

    // Admins put books on the home page's Featured shelf for a while.
    const feature = (book, days, token = alice) => api(`/admin/books/${book.id}/featured`, { token, method: 'PUT', body: { days } });
    assert.equal((await feature(close, 7, bob)).status, 403);
    assert.equal((await feature(close, 400)).status, 400);
    res = await feature(close, 7);
    assert.equal(res.status, 200);
    assert.ok(Math.abs(new Date(res.body.featuredUntil).getTime() - (Date.now() + 7 * 86_400_000)) < 60_000);
    res = await api('/books?featured=true');
    assert.deepEqual(res.body.books.map((b) => b.id), [close.id]);
    assert.ok(res.body.books[0].featuredUntil);
    assert.equal((await api(`/books/${first.id}`)).body.book.featuredUntil, null);
    res = await feature(close, 0);
    assert.equal(res.body.featuredUntil, null);
    assert.equal((await api('/books?featured=true')).body.total, 0);

    for (const book of [first, second, closest, close, unrelated]) await api(`/books/${book.id}`, { token: alice, method: 'DELETE' });
  });

  test('admins assign required reading and track completion', async () => {
    const emails = [];
    const { setEmailSender } = await import('../src/services/email.js');
    setEmailSender(async (m) => emails.push(m));
    try {
      let res = await api('/assignments', { token: bob, method: 'POST', body: { bookId: txtBook.id } });
      assert.equal(res.status, 403);
      res = await api('/assignments', {
        token: alice,
        method: 'POST',
        body: { bookId: txtBook.id, dueDate: '2000-01-01', note: 'Chapter 1 for Monday', everyone: true, notify: true },
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.emailed, 2);
      assert.match(emails[0].subject, /Required reading: A Dark Night/);
      const id = res.body.assignment.id;

      res = await api('/assignments/mine', { token: bob });
      assert.equal(res.body.assignments.length, 1);
      assert.equal(res.body.assignments[0].status, 'overdue');
      assert.equal(res.body.assignments[0].note, 'Chapter 1 for Monday');
      res = await api(`/books/${txtBook.id}`, { token: bob });
      assert.equal(res.body.book.requiredReading.id, id);

      await api(`/progress/${txtBook.id}`, { token: bob, method: 'PUT', body: { finished: true } });
      res = await api('/assignments/mine', { token: bob });
      assert.equal(res.body.assignments[0].status, 'finished');
      res = await api('/assignments', { token: alice });
      assert.equal(res.body.assignments[0].assigned, 2);
      assert.equal(res.body.assignments[0].finished, 1);
      res = await api(`/assignments/${id}/report`, { token: alice });
      assert.deepEqual(res.body.readers.map((r) => [r.name, r.status]), [['Bob', 'finished'], ['Alice', 'overdue']]);

      res = await api('/assignments', { token: alice, method: 'POST', body: { bookId: txtBook.id, everyone: false, userIds: [] } });
      assert.equal(res.status, 400);
      res = await api(`/assignments/${id}`, { token: alice, method: 'PATCH', body: { dueDate: null } });
      assert.equal(res.body.assignment.dueDate, undefined);
      assert.equal((await api(`/assignments/${id}`, { token: alice, method: 'DELETE' })).status, 204);
      assert.equal((await api('/assignments/mine', { token: bob })).body.assignments.length, 0);
    } finally {
      setEmailSender(null);
    }
  });

  test('bookmarks are private to their owner', async () => {
    let res = await api(`/books/${txtBook.id}/bookmarks`, {
      token: bob,
      method: 'POST',
      body: { sectionIndex: 0, sentenceIndex: 1, snippet: 'Rain fell.', note: 'nice' },
    });
    assert.equal(res.status, 201);
    const id = res.body.bookmark.id;
    res = await api(`/books/${txtBook.id}/bookmarks`, { token: alice });
    assert.equal(res.body.bookmarks.length, 0);
    res = await api(`/bookmarks/${id}`, { token: alice, method: 'DELETE' });
    assert.equal(res.status, 404);
    res = await api(`/bookmarks/${id}`, { token: bob, method: 'PATCH', body: { label: 'Rain' } });
    assert.equal(res.body.bookmark.label, 'Rain');
    res = await api(`/bookmarks/${id}`, { token: bob, method: 'DELETE' });
    assert.equal(res.status, 204);
  });

  test('attach and remove an audiobook', async () => {
    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('ID3fake')]), 'book.mp3');
    let res = await api(`/books/${txtBook.id}/audiobook`, { token: alice, method: 'POST', form });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book.audiobook.duration, 42.5);
    assert.equal(res.body.book.hasAudio, true);
    res = await api('/books?audio=audiobook', { token: alice });
    assert.equal(res.body.total, 1);
    res = await api(`/books/${txtBook.id}/audiobook`, { token: alice, method: 'DELETE' });
    assert.equal(res.body.book.audiobook, undefined);
  });

  test('generates cloud narration with sentence timings', async () => {
    const { setTtsClient } = await import('../src/services/narration.js');
    const requests = [];
    setTtsClient({
      synthesizeSpeech: async (request) => {
        requests.push(request);
        const marks = [...request.input.ssml.matchAll(/<mark name="(s\d+)"\/>/g)].map((m) => m[1]);
        // 4000 bytes at the 32 kbps fallback rate = 1 second of "audio" per request.
        return [{ audioContent: Buffer.alloc(4000), timepoints: marks.map((markName, i) => ({ markName, timeSeconds: i * 0.4 })) }];
      },
      listVoices: async () => [{ voices: [{ name: 'en-US-Neural2-F', ssmlGender: 'FEMALE', languageCodes: ['en-US'] }, { name: 'en-US-Chirp3-HD-Leda', languageCodes: ['en-US'] }] }],
    });
    try {
      let res = await api('/tts/voices?language=en', { token: alice });
      assert.deepEqual(res.body.voices.map((v) => v.name), ['en-US-Neural2-F']);

      res = await api(`/books/${txtBook.id}/narration`, { token: bob, method: 'POST', body: {} });
      assert.equal(res.status, 403);
      res = await api(`/books/${txtBook.id}/narration`, { token: alice, method: 'POST', body: { voice: 'bad voice' } });
      assert.equal(res.status, 400);
      res = await api(`/books/${txtBook.id}/narration`, { token: alice, method: 'POST', body: { voice: 'en-GB-Neural2-A' } });
      assert.equal(res.status, 202, JSON.stringify(res.body));
      assert.equal(res.body.narration.status, 'generating');
      assert.equal(res.body.narration.totalSections, 2);

      let status;
      for (let i = 0; i < 50; i++) {
        status = (await api(`/books/${txtBook.id}/narration`, { token: alice })).body;
        if (!status.running) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(status.narration.status, 'ready');
      assert.equal(status.narration.completedSections, 2);
      assert.equal(requests[0].voice.languageCode, 'en-GB');
      assert.deepEqual(requests[0].enableTimePointing, ['SSML_MARK']);

      const section = (await api(`/books/${txtBook.id}/sections/0`, { token: bob })).body.section;
      assert.deepEqual(section.narration.marks, [0, 0.4]);
      assert.equal(section.narration.duration, 1);
      assert.match(section.narration.url, /narration\/section-0000-[0-9a-f]{24}$/, 'narration audio gets an unguessable name');
      res = await api('/books?audio=narration', { token: bob });
      assert.equal(res.body.total, 1);

      res = await api(`/books/${txtBook.id}/narration?purge=true`, { token: alice, method: 'DELETE' });
      assert.equal(res.body.narration.status, 'none');
      const after = (await api(`/books/${txtBook.id}/sections/0`, { token: bob })).body.section;
      assert.equal(after.narration, undefined);
    } finally {
      setTtsClient(undefined);
    }
  });

  test('narration needs Google credentials', async () => {
    const res = await api(`/books/${txtBook.id}/narration`, { token: alice, method: 'POST', body: {} });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not configured/);
    const status = await api(`/books/${txtBook.id}/narration`, { token: bob });
    assert.equal(status.body.narration.status, 'none');
  });

  test('deleting a book removes its data and files', async () => {
    assert.equal((await api(`/books/${txtBook.id}`, { token: bob, method: 'DELETE' })).status, 403);
    assert.equal((await api(`/books/${txtBook.id}`, { token: alice, method: 'DELETE' })).status, 204);
    assert.equal((await api(`/books/${txtBook.id}`, { token: alice })).status, 404);
    assert.equal((await api(`/books/${txtBook.id}/sections/0`, { token: alice })).status, 404);
    assert.equal((await api('/progress', { token: bob })).body.items.length, 0);
    assert.ok(destroyed.some((p) => p.includes(`books/${txtBook.id}/`)));
    assert.equal((await api('/books/not-an-id', { token: alice })).status, 400);
  });

  test('admin can delete a user and their uploads', async () => {
    const users = (await api('/admin/users', { token: alice })).body.users;
    const bobUser = users.find((u) => u.email === 'bob@example.com');
    const res = await api(`/admin/users/${bobUser.id}?deleteBooks=true`, { token: alice, method: 'DELETE' });
    assert.equal(res.status, 204);
    assert.equal((await api('/auth/me', { token: bob })).status, 401);
    assert.equal((await api('/books', { token: alice })).body.total, 0);
  });

  test('email sign-ups must be confirmed before signing in', async () => {
    const emails = [];
    const { setEmailSender } = await import('../src/services/email.js');
    setEmailSender(async (m) => emails.push(m));
    try {
      assert.equal((await api('/auth/config')).body.emailVerification, true);
      let res = await api('/auth/register', { method: 'POST', body: { name: 'Carol', email: 'carol@example.com', password: 'password3' } });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { pending: true, email: 'carol@example.com' });
      assert.equal(emails.length, 1);
      assert.equal(emails[0].to.email, 'carol@example.com');

      res = await api('/auth/login', { method: 'POST', body: { email: 'carol@example.com', password: 'password3' } });
      assert.equal(res.status, 403);
      assert.equal(res.body.details.code, 'EMAIL_NOT_VERIFIED');

      // Signing up again (e.g. lost email) re-sends instead of failing.
      res = await api('/auth/register', { method: 'POST', body: { name: 'Carol', email: 'carol@example.com', password: 'password4' } });
      assert.equal(res.status, 201);
      await api('/auth/resend-verification', { method: 'POST', body: { email: 'carol@example.com' } });
      assert.equal(emails.length, 3);
      res = await api('/auth/resend-verification', { method: 'POST', body: { email: 'nobody@example.com' } });
      assert.equal(res.status, 200);
      assert.equal(emails.length, 3);

      const oldToken = new URL(emails[1].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      const token = new URL(emails[2].text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      assert.match(emails[2].text, /^Welcome/);
      assert.equal((await api('/auth/verify-email', { method: 'POST', body: { token: oldToken } })).status, 400);
      res = await api('/auth/verify-email', { method: 'POST', body: { token } });
      assert.equal(res.status, 200);
      assert.equal(res.body.user.email, 'carol@example.com');
      assert.equal((await api('/auth/verify-email', { method: 'POST', body: { token } })).status, 400, 'links are single-use');

      res = await api('/auth/login', { method: 'POST', body: { email: 'carol@example.com', password: 'password4' } });
      assert.equal(res.status, 200);
      res = await api('/auth/register', { method: 'POST', body: { name: 'Carol', email: 'carol@example.com', password: 'password5' } });
      assert.equal(res.status, 409);
    } finally {
      setEmailSender(null);
    }
  });

  test('sign in with Google creates or links accounts', async () => {
    const { setGoogleVerifier } = await import('../src/routes/auth.js');
    setGoogleVerifier(async (credential) => {
      if (credential === 'bad-credential-xxxxxxxxx') throw new Error('invalid');
      const [sub, email, verified] = credential.split('|');
      return { sub, email, email_verified: verified === 'yes', name: 'Dee Google' };
    });
    assert.equal((await api('/auth/config')).body.googleClientId, 'test-client-id.apps.googleusercontent.com');
    let res = await api('/auth/google', { method: 'POST', body: { credential: 'bad-credential-xxxxxxxxx' } });
    assert.equal(res.status, 401);
    res = await api('/auth/google', { method: 'POST', body: { credential: 'g-1|dee@example.com|no|padding-padding' } });
    assert.equal(res.status, 401);
    res = await api('/auth/google', { method: 'POST', body: { credential: 'g-1|Dee@Example.com|yes|padding-padding' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'dee@example.com');
    assert.equal(res.body.user.google, true);
    res = await api('/auth/login', { method: 'POST', body: { email: 'dee@example.com', password: 'whatever1' } });
    assert.match(res.body.error, /Google sign-in/);
    // An existing email account is linked rather than duplicated.
    res = await api('/auth/google', { method: 'POST', body: { credential: 'g-2|carol@example.com|yes|padding-padding' } });
    assert.equal(res.body.user.email, 'carol@example.com');
    assert.equal(res.body.user.google, true);
    assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'carol@example.com', password: 'password4' } })).status, 200);
  });
  let carol;

  test('admins schedule promotion popups for chosen audiences and hours', async () => {
    carol = (await api('/auth/login', { method: 'POST', body: { email: 'carol@example.com', password: 'password4' } })).body.token;
    const hour = 3600 * 1000;
    const iso = (offset) => new Date(Date.now() + offset).toISOString();
    const body = { title: 'Keep A-Read free', message: 'Chip in via M-Pesa', startsAt: iso(-hour), endsAt: iso(hour), amounts: [50, 200] };

    assert.equal((await api('/promotions', { token: carol, method: 'POST', body })).status, 403);
    assert.equal((await api('/promotions', { method: 'POST', body })).status, 401);
    let res = await api('/promotions', { token: alice, method: 'POST', body: { ...body, endsAt: iso(-2 * hour) } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /after the start/);
    res = await api('/promotions', { token: alice, method: 'POST', body: { ...body, dailyFrom: '08:00' } });
    assert.match(res.body.error, /both daily/);

    res = await api('/promotions', { token: alice, method: 'POST', body: { ...body, autoCloseSeconds: 20, frequency: 'day' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const promo = res.body.promotion;
    assert.equal(promo.state, 'live');
    assert.equal(promo.audience, 'everyone');

    // Guests and readers both see it, with only the fields the popup needs.
    res = await api('/promotions/active');
    assert.equal(res.body.promotion.id, promo.id);
    assert.equal(res.body.promotion.autoCloseSeconds, 20);
    assert.equal(res.body.promotion.frequency, 'day');
    assert.equal(res.body.promotion.purpose, undefined);
    assert.equal((await api('/promotions/active', { token: carol })).body.promotion.id, promo.id);

    // Readers only.
    await api(`/promotions/${promo.id}`, { token: alice, method: 'PATCH', body: { audience: 'users' } });
    assert.equal((await api('/promotions/active')).body.promotion, null);
    assert.equal((await api('/promotions/active', { token: carol })).body.promotion.id, promo.id);

    // Daily hours that exclude the current Kenya time hide it.
    const { minutesInZone } = await import('../src/utils/time.js');
    const now = minutesInZone(new Date(), 'Africa/Nairobi');
    const hhmm = (m) => `${String(Math.floor(((m + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((m + 1440) % 1440) % 60).padStart(2, '0')}`;
    res = await api(`/promotions/${promo.id}`, { token: alice, method: 'PATCH', body: { dailyFrom: hhmm(now + 60), dailyTo: hhmm(now + 120) } });
    assert.equal(res.body.promotion.state, 'off-hours');
    assert.equal((await api('/promotions/active', { token: carol })).body.promotion, null);
    await api(`/promotions/${promo.id}`, { token: alice, method: 'PATCH', body: { dailyFrom: hhmm(now - 60), dailyTo: hhmm(now + 60) } });
    assert.equal((await api('/promotions/active', { token: carol })).body.promotion.id, promo.id);
    res = await api(`/promotions/${promo.id}`, { token: alice, method: 'PATCH', body: { dailyFrom: null, dailyTo: null, paused: true } });
    assert.equal(res.body.promotion.dailyFrom, undefined);
    assert.equal(res.body.promotion.state, 'paused');
    assert.equal((await api('/promotions/active', { token: carol })).body.promotion, null);

    // Future ones wait for their start time.
    res = await api('/promotions', { token: alice, method: 'POST', body: { ...body, title: 'Later', startsAt: iso(hour), endsAt: iso(2 * hour) } });
    assert.equal(res.body.promotion.state, 'scheduled');
    assert.equal((await api('/promotions/active')).body.promotion, null);

    const list = await api('/promotions', { token: alice });
    assert.deepEqual(list.body.promotions.map((p) => p.state).sort(), ['paused', 'scheduled']);
    assert.equal(list.body.timeZone, 'Africa/Nairobi');
    assert.equal((await api('/promotions', { token: carol })).status, 403);
    assert.equal((await api(`/promotions/${res.body.promotion.id}`, { token: alice, method: 'DELETE' })).status, 204);
  });

  test('M-Pesa STK payments settle through the callback or a status check', async () => {
    const { Payment } = await import('../src/models/Payment.js');
    const { setMpesaTransport } = await import('../src/services/mpesa.js');
    const calls = [];
    let pushFails = false;
    let queryResult = { status: 500, json: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' } };
    let next = 0;
    setMpesaTransport(async (url, { body }) => {
      calls.push({ url, body });
      if (url.includes('/oauth/')) return { status: 200, json: { access_token: 'token', expires_in: '3599' } };
      if (url.includes('/stkpushquery/')) return queryResult;
      if (pushFails) return { status: 400, json: { errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid Amount' } };
      next++;
      return { status: 200, json: { ResponseCode: '0', CheckoutRequestID: `ws_CO_${next}`, MerchantRequestID: `m_${next}`, CustomerMessage: 'Success' } };
    });
    const callback = (checkoutId, resultCode, items = []) =>
      api('/payments/mpesa/callback/callback-secret', {
        method: 'POST',
        body: { Body: { stkCallback: { MerchantRequestID: 'm', CheckoutRequestID: checkoutId, ResultCode: resultCode, ResultDesc: 'desc', CallbackMetadata: { Item: items } } } },
      });

    let res = await api('/payments/config');
    assert.deepEqual(res.body, { enabled: true, method: 'till', number: '5551234', accountReference: null, minAmount: 10, maxAmount: 150000 });

    res = await api('/payments/stk', { method: 'POST', body: { phone: '0812 000 000', amount: 100 } });
    assert.equal(res.status, 400);
    res = await api('/payments/stk', { method: 'POST', body: { phone: '0712345678', amount: 5 } });
    assert.match(res.body.error, /smallest amount is KES 10/);

    // A reader pays from a promotion: the purpose comes from the promotion, not the browser.
    const promo = (
      await api('/promotions', {
        token: alice,
        method: 'POST',
        body: { title: 'Premium', purpose: 'premium', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString() },
      })
    ).body.promotion;
    res = await api('/payments/stk', { token: carol, method: 'POST', body: { phone: '+254 712 345 678', amount: 150, promotionId: promo.id, purpose: 'hacked' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const paid = res.body.payment;
    assert.equal(paid.status, 'pending');
    const push = calls.find((c) => c.url.endsWith('/mpesa/stkpush/v1/processrequest'));
    assert.equal(push.url, 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
    assert.equal(push.body.TransactionType, 'CustomerBuyGoodsOnline');
    assert.equal(push.body.BusinessShortCode, '174379');
    assert.equal(push.body.PartyB, '5551234');
    assert.equal(push.body.PhoneNumber, '254712345678');
    assert.equal(push.body.Amount, 150);
    assert.equal(push.body.CallBackURL, 'https://api.a-read.example/api/payments/mpesa/callback/callback-secret');
    assert.equal(Buffer.from(push.body.Password, 'base64').toString(), `174379passkey${push.body.Timestamp}`);

    // One prompt at a time per phone.
    res = await api('/payments/stk', { method: 'POST', body: { phone: '0712345678', amount: 50 } });
    assert.equal(res.status, 429);

    // Wrong secret: ignored. Right secret: settled with the receipt.
    assert.equal((await api('/payments/mpesa/callback/wrong-secret-xx', { method: 'POST', body: {} })).status, 404);
    res = await callback('ws_CO_1', 0, [
      { Name: 'Amount', Value: 150 },
      { Name: 'MpesaReceiptNumber', Value: 'TJK1ABC234' },
      { Name: 'PhoneNumber', Value: 254712345678 },
    ]);
    assert.deepEqual(res.body, { ResultCode: 0, ResultDesc: 'Accepted' });
    res = await api(`/payments/${paid.id}`);
    assert.equal(res.body.payment.status, 'paid');
    assert.equal(res.body.payment.receipt, 'TJK1ABC234');
    assert.equal(res.body.payment.message, 'Payment received');
    const carolId = (await api('/auth/me', { token: carol })).body.user.id;
    assert.equal(await Payment.hasPaid(carolId, 'premium', 100), true);
    assert.equal(await Payment.hasPaid(carolId, 'premium', 200), false);
    assert.equal(await Payment.hasPaid(carolId, 'donation'), false);

    // A guest cancels on the phone.
    res = await api('/payments/stk', { method: 'POST', body: { phone: '0722000111', amount: 50 } });
    const cancelled = res.body.payment;
    await callback('ws_CO_2', 1032);
    res = await api(`/payments/${cancelled.id}`);
    assert.equal(res.body.payment.status, 'failed');
    assert.match(res.body.payment.message, /cancelled/);

    // The callback never arrives: after 20 s the status endpoint asks Daraja itself.
    res = await api('/payments/stk', { method: 'POST', body: { phone: '0733000222', amount: 75 } });
    const lost = res.body.payment;
    assert.equal((await api(`/payments/${lost.id}`)).body.payment.status, 'pending');
    assert.equal(calls.filter((c) => c.url.includes('/stkpushquery/')).length, 0);
    await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(lost.id) }, { $set: { createdAt: new Date(Date.now() - 30_000) } });
    assert.equal((await api(`/payments/${lost.id}`)).body.payment.status, 'pending');
    assert.equal(calls.filter((c) => c.url.includes('/stkpushquery/')).length, 1);
    queryResult = { status: 200, json: { ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' } };
    await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(lost.id) }, { $set: { checkedAt: new Date(Date.now() - 60_000) } });
    assert.equal((await api(`/payments/${lost.id}`)).body.payment.status, 'paid');
    // A late callback still fills in the receipt.
    await callback('ws_CO_3', 0, [{ Name: 'Amount', Value: 75 }, { Name: 'MpesaReceiptNumber', Value: 'TJK9LATE00' }]);
    assert.equal((await api(`/payments/${lost.id}`)).body.payment.receipt, 'TJK9LATE00');

    // Daraja refuses the request.
    pushFails = true;
    res = await api('/payments/stk', { method: 'POST', body: { phone: '0744000333', amount: 60 } });
    assert.equal(res.status, 502);

    // Admin view.
    assert.equal((await api('/payments', { token: carol })).status, 403);
    res = await api('/payments', { token: alice });
    assert.equal(res.body.payments.length, 4);
    assert.equal(res.body.totals.amount, 225);
    assert.equal(res.body.totals.count, 2);
    assert.deepEqual(res.body.totals.byPurpose, { premium: { amount: 150, count: 1 }, donation: { amount: 75, count: 1 } });
    const first = res.body.payments.find((p) => p.receipt === 'TJK1ABC234');
    assert.equal(first.user.name, 'Carol');
    assert.equal(first.promotion.title, 'Premium');
    assert.equal((await api('/payments?status=failed', { token: alice })).body.payments.length, 2);
    assert.equal((await api('/promotions', { token: alice })).body.promotions.find((p) => p.id === promo.id).raised, 150);
    setMpesaTransport(null);
  });

  test('with ISA Tech Hub configured, payments go through the Hub and settle by signed webhook', async () => {
    const { env } = await import('../src/config/env.js');
    const { Payment } = await import('../src/models/Payment.js');
    const { clearHubConfig, setHubClient } = await import('../src/services/hub.js');

    // A stand-in for the Hub's /v1 API.
    const hubPayments = new Map();
    const received = [];
    let nextId = 0;
    let hubDown = false;
    const fakeHub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const send = (status, body) => {
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== 'Bearer isa_sk_test') return send(401, { error: 'Invalid API key' });
        if (hubDown) return send(503, { error: 'Unavailable' });
        if (req.method === 'GET' && req.url === '/v1/config') {
          return send(200, {
            platform: { id: 'p1', name: 'A-Read', slug: 'a-read' },
            till: { kind: 'till', payNumber: '5557777', accountNumber: null, environment: 'production', active: true },
          });
        }
        if (req.method === 'POST' && req.url === '/v1/payments') {
          const body = JSON.parse(raw);
          received.push({ body, idempotencyKey: req.headers['idempotency-key'] });
          if (body.phone === '254799000999') return send(409, { error: 'A payment request was just sent to this phone.' });
          const payment = { id: `hub_${++nextId}`, reference: body.reference, amount: body.amount, status: 'pending', receipt: null, message: 'Waiting' };
          hubPayments.set(payment.id, payment);
          return send(201, { payment, replayed: false });
        }
        const match = /^\/v1\/payments\/(.+)$/.exec(req.url);
        if (req.method === 'GET' && match && hubPayments.has(match[1])) return send(200, { payment: hubPayments.get(match[1]) });
        send(404, { error: 'Not found' });
      });
    });
    await new Promise((resolve) => fakeHub.listen(0, '127.0.0.1', resolve));

    // Before the Hub is set up, Admin → Payments says so (this test server uses direct Daraja).
    let setup = await api('/payments/setup', { token: alice });
    assert.equal(setup.body.mode, 'daraja');
    assert.deepEqual(setup.body.hub.missing, ['ISA_HUB_URL', 'ISA_HUB_API_KEY', 'ISA_HUB_WEBHOOK_SECRET']);
    assert.equal((await api('/payments/setup', { token: carol })).status, 403);

    const saved = { ...env.hub };
    Object.assign(env.hub, { url: `http://127.0.0.1:${fakeHub.address().port}`, apiKey: 'isa_sk_test', webhookSecret: 'whsec_test' });
    setHubClient(null);
    clearHubConfig();

    const webhook = async (type, payment, secret = 'whsec_test') => {
      const raw = JSON.stringify({ id: `evt_${type}`, type, createdAt: new Date().toISOString(), data: { payment } });
      const t = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
      const res = await fetch(`${base}/payments/hub-webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'isa-signature': `t=${t},v1=${v1}`, 'isa-event': type },
        body: raw,
      });
      return res.status;
    };

    try {
      setup = await api('/payments/setup', { token: alice });
      assert.equal(setup.body.mode, 'hub');
      assert.equal(setup.body.hub.reachable, true);
      assert.equal(setup.body.hub.platform.name, 'A-Read');
      assert.equal(setup.body.hub.till.payNumber, '5557777');
      assert.match(setup.body.webhookUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/payments\/hub-webhook$/);

      // A wrong key is explained in plain words.
      env.hub.apiKey = 'isa_sk_wrong';
      setHubClient(null);
      setup = await api('/payments/setup', { token: alice });
      assert.equal(setup.body.hub.reachable, false);
      assert.match(setup.body.hub.error, /rejected ISA_HUB_API_KEY/);
      env.hub.apiKey = 'isa_sk_test';
      setHubClient(null);

      // The till to pay from the M-Pesa menu now comes from the Hub.
      let res = await api('/payments/config');
      assert.deepEqual(res.body, { enabled: true, method: 'till', number: '5557777', accountReference: null, minAmount: 10, maxAmount: 150000 });

      // A reader pays from a promotion: A-Read's own id is the Hub reference and idempotency key.
      const promo = (
        await api('/promotions', {
          token: alice,
          method: 'POST',
          body: { title: 'Supporters', purpose: 'supporter', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 3600e3).toISOString() },
        })
      ).body.promotion;
      res = await api('/payments/stk', { token: carol, method: 'POST', body: { phone: '0711 222 333', amount: 200, promotionId: promo.id } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const first = res.body.payment;
      assert.equal(first.status, 'pending');
      assert.deepEqual(received[0].body, {
        phone: '254711222333',
        amount: 200,
        reference: first.id,
        purpose: 'supporter',
        description: 'Support A-Read',
        metadata: { promotion: promo.id, reader: 'signed-in' },
      });
      assert.equal(received[0].idempotencyKey, first.id);
      const stored = await Payment.findById(first.id);
      assert.equal(stored.provider, 'hub');
      assert.equal(stored.hubPaymentId, 'hub_1');
      assert.equal(stored.checkoutRequestId, undefined, 'A-Read no longer talks to Safaricom itself');

      // Only correctly signed webhooks count.
      const paid = { ...hubPayments.get('hub_1'), status: 'paid', receipt: 'TJH1PAID00', paidAt: new Date().toISOString(), message: 'Payment received' };
      assert.equal(await webhook('payment.paid', paid, 'whsec_wrong'), 400);
      assert.equal((await api(`/payments/${first.id}`)).body.payment.status, 'pending');
      assert.equal(await webhook('payment.paid', paid), 204);
      assert.equal(await webhook('payment.paid', paid), 204, 'redelivery is harmless');
      res = await api(`/payments/${first.id}`);
      assert.equal(res.body.payment.status, 'paid');
      assert.equal(res.body.payment.receipt, 'TJH1PAID00');
      const carolId = (await api('/auth/me', { token: carol })).body.user.id;
      assert.equal(await Payment.hasPaid(carolId, 'supporter', 200), true);
      assert.equal(await webhook('ping', undefined), 204, "the dashboard's test webhook is acknowledged");

      // No webhook yet: the payer's page asks the Hub, which knows the payment failed.
      res = await api('/payments/stk', { method: 'POST', body: { phone: '0711 444 555', amount: 50 } });
      const second = res.body.payment;
      hubPayments.set('hub_2', { ...hubPayments.get('hub_2'), status: 'failed', resultCode: 1032, message: 'The payment was cancelled on the phone' });
      res = await api(`/payments/${second.id}`);
      assert.equal(res.body.payment.status, 'failed');
      assert.equal(res.body.payment.message, 'The payment was cancelled on the phone');

      // A late success still wins; an amount M-Pesa disagrees with is held for review.
      assert.equal(await webhook('payment.paid', { ...hubPayments.get('hub_2'), status: 'paid', receipt: 'TJH2LATE00', message: 'Payment received' }), 204);
      assert.equal((await api(`/payments/${second.id}`)).body.payment.status, 'paid');
      res = await api('/payments/stk', { method: 'POST', body: { phone: '0711 666 777', amount: 300 } });
      const third = res.body.payment;
      assert.equal(await webhook('payment.disputed', { ...hubPayments.get('hub_3'), status: 'disputed', paidAmount: 30, message: 'M-Pesa reported a different amount; held for review' }), 204);
      res = await api(`/payments/${third.id}`);
      assert.equal(res.body.payment.status, 'disputed');
      assert.match(res.body.payment.message, /no need to pay again/);
      assert.equal((await api('/payments?status=disputed', { token: alice })).body.payments.length, 1);

      // The Hub says the phone is busy, or can't be reached.
      res = await api('/payments/stk', { method: 'POST', body: { phone: '0799 000 999', amount: 50 } });
      assert.equal(res.status, 429);
      hubDown = true;
      res = await api('/payments/stk', { method: 'POST', body: { phone: '0711 888 999', amount: 50 } });
      assert.equal(res.status, 502);
      assert.match(res.body.error, /couldn't reach M-Pesa/);
      setup = await api('/payments/setup', { token: alice });
      assert.match(setup.body.hub.error, /HTTP 503/);
    } finally {
      Object.assign(env.hub, saved);
      setHubClient(null);
      clearHubConfig();
      fakeHub.close();
    }

    // Without the Hub settings the webhook route is closed.
    assert.equal((await fetch(`${base}/payments/hub-webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  });

  let freeBook;

  test('admins manage categories and books are filed under them', async () => {
    const create = (body, token = alice) => api('/categories', { token, method: 'POST', body });
    assert.equal((await create({ name: 'Fiction' }, carol)).status, 403);
    assert.equal((await create({ name: 'Fiction' }, null)).status, 401);
    let res = await create({ name: 'Science & Nature', description: 'How the world works' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const science = res.body.category;
    assert.equal(science.slug, 'science-nature');
    assert.equal(science.books, 0);
    const fiction = (await create({ name: 'Fiction' })).body.category;
    res = await create({ name: ' fiction ' });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already a category/);
    assert.equal((await create({ name: '!!!' })).status, 400);

    // Uploaders pick a category from the list.
    res = await api('/books', { token: carol, method: 'POST', form: bookForm('story.txt', 'CHAPTER 1\n\nOnce upon a time.', { category: fiction.id }) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const story = res.body.book;
    assert.deepEqual(story.category, { id: fiction.id, name: 'Fiction', slug: 'fiction' });
    res = await api('/books', { token: carol, method: 'POST', form: bookForm('facts.txt', 'Water boils.', { category: '0123456789abcdef01234567' }) });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /no longer exists/);
    res = await api('/books', { token: carol, method: 'POST', form: bookForm('facts.txt', 'Water boils at 100 degrees.') });
    freeBook = res.body.book;
    assert.equal(freeBook.category, null);
    res = await api(`/books/${freeBook.id}`, { token: carol, method: 'PATCH', body: { category: science.id } });
    assert.equal(res.body.book.category.slug, 'science-nature');

    // Anyone can browse by category.
    res = await api('/books?category=science-nature');
    assert.deepEqual(res.body.books.map((b) => b.id), [freeBook.id]);
    assert.equal(res.body.books[0].category.name, 'Science & Nature');
    assert.equal((await api('/books?category=nope')).body.total, 0);
    res = await api('/categories');
    assert.deepEqual(res.body.categories.map((c) => [c.name, c.books]), [['Fiction', 1], ['Science & Nature', 1]]);

    // Renaming changes the link but keeps the books.
    res = await api(`/categories/${science.id}`, { token: alice, method: 'PATCH', body: { name: 'Science' } });
    assert.equal(res.body.category.slug, 'science');
    assert.equal(res.body.category.books, 1);
    assert.equal((await api('/books?category=science')).body.total, 1);
    assert.equal((await api(`/categories/${science.id}`, { token: alice, method: 'PATCH', body: { name: 'FICTION' } })).status, 409);

    // A book can leave its category; deleting a category keeps its books in the library.
    res = await api(`/books/${freeBook.id}`, { token: carol, method: 'PATCH', body: { category: null } });
    assert.equal(res.body.book.category, null);
    assert.equal((await api(`/categories/${fiction.id}`, { token: carol, method: 'DELETE' })).status, 403);
    assert.equal((await api(`/categories/${fiction.id}`, { token: alice, method: 'DELETE' })).status, 204);
    res = await api(`/books/${story.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.book.category, null);
    assert.deepEqual((await api('/categories')).body.categories.map((c) => c.name), ['Science']);
  });

  test('premium books lock the chapters an admin picks until the reader pays', async () => {
    const { Book } = await import('../src/models/Book.js');
    const { Section } = await import('../src/models/Section.js');
    const { setMpesaTransport } = await import('../src/services/mpesa.js');
    const erin = (await api('/auth/register', { method: 'POST', body: { name: 'Erin', email: 'erin@example.com', password: 'password6' } })).body.token;

    // Carol uploads a book big enough to be stored in parts.
    const chapters = ['One', 'Two', 'Three', 'Four'].map((title) => ({
      title,
      paragraphs: [`Chapter ${title} begins.`, crypto.randomBytes(1500).toString('hex')],
    }));
    let res = await api('/books', { token: carol, method: 'POST', form: bookForm('paid.epub', await makeEpub(chapters, { title: 'Paid Book' })) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const book = res.body.book;
    assert.equal(book.sectionCount, 4);
    assert.ok(book.file.parts.length > 1);
    assert.equal(book.premium, null);
    assert.equal(book.unlocked, true);
    // Files stored before private names existed: an audiobook and narration for chapters 1 and 3.
    const folder = `a-read/books/${book.id}`;
    const legacy = (publicId) => ({ url: `https://res.cloudinary.com/demo/video/upload/v1/${publicId}`, publicId });
    await Book.updateOne({ _id: book.id }, { $set: { audiobook: { ...legacy(`${folder}/audiobook-abc`), resourceType: 'video', duration: 60 } } });
    for (const index of [0, 2]) {
      const narration = { ...legacy(`${folder}/narration/section-000${index}`), voice: 'en-US-Neural2-F', duration: 3, marks: [0] };
      await Section.updateOne({ book: book.id, index }, { $set: { narration } });
    }

    // Only admins set the price and the locked chapters.
    const premium = (body, token = alice) => api(`/admin/books/${book.id}/premium`, { token, method: 'PUT', body });
    assert.deepEqual((await api(`/admin/books/${book.id}/premium`, { token: alice })).body.premium, { enabled: false, price: null, lockedSections: [], updatedAt: null });
    assert.equal((await premium({ enabled: true, price: 200, lockedSections: [2, 3] }, carol)).status, 403);
    assert.match((await premium({ enabled: true, price: 200, lockedSections: [] })).body.error, /at least one chapter/);
    assert.match((await premium({ enabled: true, lockedSections: [2] })).body.error, /Set the price/);
    assert.match((await premium({ enabled: true, price: 5, lockedSections: [2] })).body.error, /lowest price is KES 10/);
    assert.match((await premium({ enabled: true, price: 200, lockedSections: [2, 9] })).body.error, /part 10/);
    res = await premium({ enabled: true, price: 200, lockedSections: [3, 2, 3] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.premium.enabled, true);
    assert.equal(res.body.premium.price, 200);
    assert.deepEqual(res.body.premium.lockedSections, [2, 3]);

    // The original file, the audiobook and the locked chapters' narration move to unguessable names.
    const stored = await Book.findById(book.id);
    assert.match(stored.file.publicId, /\/book-[0-9a-f]{24}\.epub$/);
    assert.ok(stored.file.parts.every((part, i) => part.publicId === `${stored.file.publicId}.part${i}`));
    assert.equal(stored.file.url, stored.file.parts[0].url);
    assert.match(stored.audiobook.publicId, /audiobook-abc-[0-9a-f]{24}$/);
    const narrated = await Section.find({ book: book.id, index: { $in: [0, 2] } }).sort({ index: 1 });
    assert.equal(narrated[0].narration.publicId, `${folder}/narration/section-0000`, 'free chapters stay where they are');
    assert.match(narrated[1].narration.publicId, /narration\/section-0002-[0-9a-f]{24}$/);
    const moves = renamed.length;
    assert.equal((await premium({ enabled: true, price: 200, lockedSections: [2, 3] })).status, 200);
    assert.equal(renamed.length, moves, 'files are only moved once');

    // A reader sees which chapters are locked, but can't open them, the file or the audiobook.
    res = await api(`/books/${book.id}`, { token: erin });
    assert.deepEqual(res.body.book.premium, { price: 200, lockedSections: [2, 3] });
    assert.equal(res.body.book.unlocked, false);
    assert.equal(res.body.book.file, undefined);
    assert.deepEqual(res.body.book.audiobook, { duration: 60 });
    assert.deepEqual((await api(`/books/${book.id}/sections`, { token: erin })).body.sections.map((s) => s.locked), [false, false, true, true]);
    assert.equal((await api(`/books/${book.id}/sections/1`, { token: erin })).status, 200);
    res = await api(`/books/${book.id}/sections/2`, { token: erin });
    assert.equal(res.status, 402);
    assert.deepEqual(res.body.details, { code: 'PREMIUM_LOCKED', price: 200 });
    res = await api(`/books/${book.id}/offline`, { token: erin });
    assert.deepEqual(res.body.sections.map((s) => Boolean(s.locked)), [false, false, true, true]);
    assert.deepEqual(res.body.sections[2].paragraphs, []);
    assert.equal(res.body.sections[2].narration, undefined);
    assert.equal(res.body.sections[0].narration.publicId, `${folder}/narration/section-0000`);
    res = await api('/books?access=premium', { token: erin });
    assert.deepEqual(res.body.books.map((b) => [b.id, b.unlocked, b.file]), [[book.id, false, undefined]]);
    assert.ok((await api('/books?access=free')).body.books.some((b) => b.id === freeBook.id));
    assert.deepEqual((await api(`/books/${book.id}/sections`)).body.sections.map((s) => s.locked), [false, false, true, true]);
    await api(`/progress/${book.id}`, { token: erin, method: 'PUT', body: { sectionIndex: 1, percent: 30 } });
    const shelf = (await api('/progress', { token: erin })).body.items.find((item) => item.book.id === book.id).book;
    assert.equal(shelf.audiobook, undefined, 'continue reading never hands out the audiobook');
    assert.equal(shelf.hasAudio, true);

    // The uploader and admins can always read everything.
    for (const token of [carol, alice]) {
      res = await api(`/books/${book.id}`, { token });
      assert.equal(res.body.book.unlocked, true);
      assert.ok(res.body.book.file.url);
      assert.equal((await api(`/books/${book.id}/sections/2`, { token })).status, 200);
    }

    // Erin pays the book's price by M-Pesa.
    const calls = [];
    let pushes = 0;
    let onQuery = async () => {};
    setMpesaTransport(async (url, { body }) => {
      calls.push({ url, body });
      if (url.includes('/oauth/')) return { status: 200, json: { access_token: 'token', expires_in: '3599' } };
      if (url.includes('/stkpushquery/')) {
        await onQuery(body);
        return { status: 500, json: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' } };
      }
      pushes++;
      const id = pushes === 1 ? 'ws_CO_book' : `ws_CO_book_${pushes}`;
      return { status: 200, json: { ResponseCode: '0', CheckoutRequestID: id, MerchantRequestID: 'm_book' } };
    });
    let payment;
    try {
      res = await api('/payments/stk', { method: 'POST', body: { phone: '0712000001', bookId: book.id } });
      assert.equal(res.status, 401);
      res = await api('/payments/stk', { token: erin, method: 'POST', body: { phone: '0712000001', bookId: freeBook.id } });
      assert.match(res.body.error, /free to read/);
      res = await api('/payments/stk', { token: carol, method: 'POST', body: { phone: '0712000001', bookId: book.id } });
      assert.equal(res.status, 409, 'the uploader can already read it');
      res = await api('/payments/stk', { token: erin, method: 'POST', body: { phone: '0712000001', bookId: book.id, amount: 10 } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      payment = res.body.payment;
      assert.equal(payment.amount, 200, 'the price comes from the book, not the browser');
      const push = calls.find((c) => c.url.endsWith('/processrequest'));
      assert.equal(push.body.Amount, 200);
      assert.equal(push.body.TransactionDesc, 'A-Read book');
      // Asking again (another phone, or after a reload) while that prompt is open picks it back up.
      res = await api('/payments/stk', { token: erin, method: 'POST', body: { phone: '0712000009', bookId: book.id } });
      assert.equal(res.status, 200);
      assert.equal(res.body.resumed, true);
      assert.equal(res.body.payment.id, payment.id, 'no second charge');
      assert.equal(calls.filter((c) => c.url.endsWith('/processrequest')).length, 1);

      // Two unlock requests at the very same moment (two tabs or phones) still make one payment.
      const fay = (await api('/auth/register', { method: 'POST', body: { name: 'Fay', email: 'fay@example.com', password: 'password5' } })).body.token;
      const both = await Promise.all(
        ['0712000101', '0712000102'].map((phone) => api('/payments/stk', { token: fay, method: 'POST', body: { phone, bookId: book.id } })),
      );
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);
      assert.equal(both[0].body.payment.id, both[1].body.payment.id);
      // A prompt that never got an answer stops blocking after five minutes: a new one can be sent.
      const { Payment } = await import('../src/models/Payment.js');
      const stuck = both[0].body.payment.id;
      await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(stuck) }, { $set: { createdAt: new Date(Date.now() - 6 * 60_000) } });
      res = await api('/payments/stk', { token: fay, method: 'POST', body: { phone: '0712000103', bookId: book.id } });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.notEqual(res.body.payment.id, stuck);
      assert.equal((await Payment.findById(stuck)).status, 'failed');

      // M-Pesa's "paid" landing while we decide to give up on a slow payment is never overwritten.
      const late = res.body.payment.id;
      await Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(late) }, { $set: { createdAt: new Date(Date.now() - 6 * 60_000) } });
      onQuery = () => Payment.collection.updateOne({ _id: new mongoose.Types.ObjectId(late) }, { $set: { status: 'paid', receipt: 'TJKLATE999' } });
      res = await api('/payments/stk', { token: fay, method: 'POST', body: { phone: '0712000104', bookId: book.id } });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal((await Payment.findById(late)).status, 'paid');
      assert.equal((await api(`/books/${book.id}/sections/2`, { token: fay })).status, 200, 'Fay paid, so the book is open');
      onQuery = async () => {};

      // While M-Pesa's amount for an earlier payment is being checked, no new prompt is sent.
      const gus = (await api('/auth/register', { method: 'POST', body: { name: 'Gus', email: 'gus@example.com', password: 'password4' } })).body.token;
      const gusId = (await api('/auth/me', { token: gus })).body.user.id;
      await Payment.create({ user: gusId, book: book.id, purpose: 'book', phone: '254712000105', amount: 200, status: 'disputed', provider: 'hub' });
      res = await api('/payments/stk', { token: gus, method: 'POST', body: { phone: '0712000105', bookId: book.id } });
      assert.equal(res.status, 409);
      assert.match(res.body.error, /no need to pay again/);

      // A database with several waiting unlock payments from before the one-at-a-time rule keeps the
      // newest waiting and gets the rule.
      const { ensureUnlockIndex } = await import('../src/services/premium.js');
      await Payment.collection.dropIndex('one_pending_unlock');
      const legacy = [6, 3].map((minutes) => ({
        user: new mongoose.Types.ObjectId(gusId), book: new mongoose.Types.ObjectId(freeBook.id), purpose: 'book', phone: '254712000106',
        amount: 50, status: 'pending', provider: 'daraja', createdAt: new Date(Date.now() - minutes * 60_000),
      }));
      const { insertedIds } = await Payment.collection.insertMany(legacy);
      assert.equal(await ensureUnlockIndex(), 1);
      assert.equal((await Payment.findById(insertedIds[0])).status, 'failed', 'the older one');
      assert.equal((await Payment.findById(insertedIds[1])).status, 'pending', 'the newest keeps waiting');
      assert.ok((await Payment.collection.indexes()).some((i) => i.name === 'one_pending_unlock'));
      await Payment.deleteMany({ _id: { $in: Object.values(insertedIds) } });
      assert.equal((await api(`/books/${book.id}/sections/2`, { token: erin })).status, 402, 'locked until M-Pesa confirms');
      await api('/payments/mpesa/callback/callback-secret', {
        method: 'POST',
        body: {
          Body: {
            stkCallback: {
              MerchantRequestID: 'm_book',
              CheckoutRequestID: 'ws_CO_book',
              ResultCode: 0,
              ResultDesc: 'Paid',
              CallbackMetadata: { Item: [{ Name: 'Amount', Value: 200 }, { Name: 'MpesaReceiptNumber', Value: 'TJKBOOK001' }] },
            },
          },
        },
      });
      assert.equal((await api(`/payments/${payment.id}`)).body.payment.status, 'paid');
    } finally {
      setMpesaTransport(null);
    }

    // Paid: every chapter, the file and the audiobook open for Erin (and only for Erin).
    res = await api(`/books/${book.id}`, { token: erin });
    assert.equal(res.body.book.unlocked, true);
    assert.ok(res.body.book.file.url);
    assert.ok(res.body.book.audiobook.url);
    assert.deepEqual((await api(`/books/${book.id}/sections`, { token: erin })).body.sections.map((s) => s.locked), [false, false, false, false]);
    assert.equal((await api(`/books/${book.id}/sections/2`, { token: erin })).status, 200);
    assert.equal((await api('/books?access=premium', { token: erin })).body.books[0].unlocked, true);
    assert.equal((await api(`/books/${book.id}`)).body.book.unlocked, false);
    assert.equal((await api('/payments/stk', { token: erin, method: 'POST', body: { phone: '0712000002', bookId: book.id } })).status, 409);

    // Admins see what each premium book has sold.
    res = await api('/admin/premium', { token: alice });
    assert.deepEqual(res.body.books.find((b) => b.id === book.id).sales, { amount: 400, count: 2 }, 'Erin and Fay');
    assert.equal((await api('/admin/premium', { token: erin })).status, 403);
    res = await api('/payments?purpose=book', { token: alice });
    const erinsPayment = res.body.payments.find((p) => p.id === payment.id);
    assert.deepEqual([erinsPayment.book.title, erinsPayment.status], ['Paid Book', 'paid']);
    assert.ok(res.body.payments.every((p) => p.purpose === 'book'));
    assert.deepEqual(res.body.totals.byPurpose.book, { amount: 400, count: 2 });
    assert.equal((await api('/admin/stats', { token: alice })).body.premium, 1);

    // Turning premium off frees the book for everyone and keeps the settings for later.
    res = await premium({ enabled: false });
    assert.deepEqual(res.body.premium, { ...res.body.premium, enabled: false, price: 200, lockedSections: [2, 3] });
    res = await api(`/books/${book.id}`);
    assert.equal(res.body.book.premium, null);
    assert.equal(res.body.book.unlocked, true);
    assert.equal((await api('/books?access=premium')).body.total, 0);
    assert.ok((await api('/admin/premium', { token: alice })).body.books.some((b) => b.id === book.id && !b.premium.enabled));

    // While it was free, everyone was given the file and audiobook URLs, so turning premium back on
    // moves them again, even though their names already look private.
    const freeCopy = (await api(`/books/${book.id}`, { token: erin })).body.book;
    let fresh = await Book.findById(book.id);
    const handedOut = { file: fresh.file.publicId, audiobook: fresh.audiobook.publicId };
    // A rename that fails part-way (here the audiobook) leaves the book free and consistent…
    renameFails = (from) => from === handedOut.audiobook;
    res = await premium({ enabled: true });
    assert.equal(res.status, 502);
    fresh = await Book.findById(book.id);
    assert.equal(fresh.premium.enabled, false);
    const movedFile = fresh.file.publicId;
    assert.notEqual(movedFile, handedOut.file, 'the file move that succeeded is recorded');
    assert.ok(renamed.some((r) => r.to === `${movedFile}.part0`), 'and the database matches where the file is now');
    assert.equal(fresh.audiobook.publicId, handedOut.audiobook);
    // …and trying again finishes the job.
    renameFails = () => false;
    res = await premium({ enabled: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    fresh = await Book.findById(book.id);
    assert.notEqual(fresh.audiobook.publicId, handedOut.audiobook);
    assert.match(fresh.audiobook.publicId, /audiobook-abc-[0-9a-f]{24}$/);
    assert.notEqual(fresh.file.url, freeCopy.file.url, 'the URL handed out while free no longer works');
    // Locking one more chapter moves only that chapter's narration (chapter 0's audio was public).
    const chapterZero = (await Section.findOne({ book: book.id, index: 0 })).narration.publicId;
    res = await premium({ lockedSections: [0, 2, 3], enabled: true });
    assert.equal(res.status, 200);
    assert.notEqual((await Section.findOne({ book: book.id, index: 0 })).narration.publicId, chapterZero);

    // An older PDF whose cover is drawn from the PDF itself needs its own cover first.
    await Book.updateOne({ _id: freeBook.id }, { $set: { coverSource: 'pdf' } });
    res = await api(`/admin/books/${freeBook.id}/premium`, { token: alice, method: 'PUT', body: { enabled: true, price: 50, lockedSections: [0] } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /Upload a cover image/);
    await Book.updateOne({ _id: freeBook.id }, { $set: { coverSource: 'none' } });
    await premium({ enabled: false });
  });

  test('a Premium Pass opens every premium book until it runs out', async () => {
    const { Payment } = await import('../src/models/Payment.js');
    const { setMpesaTransport } = await import('../src/services/mpesa.js');
    const register = async (name) =>
      (await api('/auth/register', { method: 'POST', body: { name, email: `${name.toLowerCase()}@example.com`, password: 'password9' } })).body.token;
    const pia = await register('Pia');
    const quinn = await register('Quinn');
    // The book from the test before, premium again (its price and locked chapters were kept).
    const premiumBook = (await api('/books?q=Paid Book')).body.books[0];
    const setPremium = (enabled) => api(`/admin/books/${premiumBook.id}/premium`, { token: alice, method: 'PUT', body: { enabled } });
    assert.equal((await setPremium(true)).status, 200);
    const pass = (token) => api('/payments/pass', { token });
    const buy = (token, phone, extra = {}) => api('/payments/stk', { token, method: 'POST', body: { phone, pass: true, ...extra } });
    const paid = (checkoutId, receipt) =>
      api('/payments/mpesa/callback/callback-secret', {
        method: 'POST',
        body: {
          Body: {
            stkCallback: {
              MerchantRequestID: 'm_pass',
              CheckoutRequestID: checkoutId,
              ResultCode: 0,
              ResultDesc: 'Paid',
              CallbackMetadata: { Item: [{ Name: 'Amount', Value: 300 }, { Name: 'MpesaReceiptNumber', Value: receipt }] },
            },
          },
        },
      });

    let res = await pass();
    assert.deepEqual(res.body, { onSale: false, price: null, days: null, premiumBooks: 1, activeUntil: null, active: false });
    assert.match((await buy(pia, '0712000201')).body.error, /not on sale/);
    assert.equal((await buy(undefined, '0712000201')).status, 401);

    // Admins put it on sale.
    const setPass = (body, token = alice) => api('/admin/pass', { token, method: 'PUT', body });
    assert.equal((await setPass({ enabled: true, price: 300 }, pia)).status, 403);
    assert.match((await setPass({ enabled: true })).body.error, /Set the price/);
    assert.match((await setPass({ enabled: true, price: 5 })).body.error, /lowest price/);
    assert.match((await setPass({ enabled: true, price: 300, days: 400 })).body.error, /at most a year/);
    res = await setPass({ enabled: true, price: 300, days: 30 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.pass, { enabled: true, price: 300, days: 30, sales: { amount: 0, count: 0 }, holders: 0 });
    assert.deepEqual((await api('/system/config')).body.pass, { price: 300, days: 30 });
    assert.equal((await api(`/books/${premiumBook.id}`, { token: pia })).body.book.unlocked, false);

    const calls = [];
    let pushes = 0;
    setMpesaTransport(async (url, { body }) => {
      calls.push({ url, body });
      if (url.includes('/oauth/')) return { status: 200, json: { access_token: 'token', expires_in: '3599' } };
      if (url.includes('/stkpushquery/')) return { status: 500, json: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' } };
      pushes++;
      return { status: 200, json: { ResponseCode: '0', CheckoutRequestID: `ws_CO_pass_${pushes}`, MerchantRequestID: 'm_pass' } };
    });
    try {
      // The price and length come from the admins, not the browser.
      res = await buy(pia, '0712000201', { amount: 10 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const first = res.body.payment;
      assert.equal(first.amount, 300);
      const push = calls.find((c) => c.url.endsWith('/processrequest'));
      assert.deepEqual([push.body.Amount, push.body.TransactionDesc], [300, 'A-Read pass']);
      assert.equal((await Payment.findById(first.id)).days, 30);
      // Asking again while the prompt is open follows the same payment.
      res = await buy(pia, '0712000209');
      assert.deepEqual([res.status, res.body.resumed, res.body.payment.id], [200, true, first.id]);
      // Two requests at the same moment still make one payment.
      const both = await Promise.all(['0712000301', '0712000302'].map((phone) => buy(quinn, phone)));
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 201]);
      assert.equal(both[0].body.payment.id, both[1].body.payment.id);

      // Paid: every premium book opens for Pia, and only for her.
      await paid('ws_CO_pass_1', 'TJKPASS001');
      res = await pass(pia);
      assert.equal(res.body.active, true);
      const until = new Date(res.body.activeUntil).getTime();
      assert.ok(Math.abs(until - (Date.now() + 30 * 86_400_000)) < 60_000, res.body.activeUntil);
      res = await api(`/books/${premiumBook.id}`, { token: pia });
      assert.equal(res.body.book.unlocked, true);
      assert.ok(res.body.book.file.url);
      assert.equal((await api(`/books/${premiumBook.id}/sections/2`, { token: pia })).status, 200);
      assert.equal((await api('/books?access=premium', { token: pia })).body.books[0].unlocked, true);
      assert.equal((await api(`/books/${premiumBook.id}/sections/2`, { token: quinn })).status, 402);

      // Buying again before it runs out adds the days on the end.
      res = await buy(pia, '0712000201');
      assert.equal(res.status, 201, JSON.stringify(res.body));
      await paid('ws_CO_pass_3', 'TJKPASS002');
      res = await pass(pia);
      assert.ok(Math.abs(new Date(res.body.activeUntil).getTime() - (until + 30 * 86_400_000)) < 60_000);

      res = await api('/admin/pass', { token: alice });
      assert.deepEqual([res.body.pass.sales, res.body.pass.holders], [{ amount: 600, count: 2 }, 1]);
      res = await api('/payments?purpose=pass', { token: alice });
      assert.equal(res.body.totals.byPurpose.pass.amount, 600);

      // Once it runs out, the book locks again.
      const piaId = (await api('/auth/me', { token: pia })).body.user.id;
      await Payment.updateMany({ user: piaId, purpose: 'pass' }, { $set: { paidAt: new Date(Date.now() - 61 * 86_400_000) } });
      res = await pass(pia);
      assert.deepEqual([res.body.active, Boolean(res.body.activeUntil)], [false, true]);
      assert.equal((await api(`/books/${premiumBook.id}/sections/2`, { token: pia })).status, 402);
      assert.equal((await api('/admin/pass', { token: alice })).body.pass.holders, 0);

      // While M-Pesa's amount for an earlier pass payment is checked, no new prompt is sent.
      await Payment.updateOne({ user: piaId, purpose: 'pass' }, { $set: { status: 'disputed' } });
      assert.match((await buy(pia, '0712000201')).body.error, /no need to pay again/);
    } finally {
      setMpesaTransport(null);
    }

    // Taking it off sale stops new passes (ones bought keep their time).
    res = await setPass({ enabled: false });
    assert.deepEqual([res.body.pass.enabled, res.body.pass.price], [false, 300]);
    assert.equal((await api('/system/config')).body.pass, null);
    assert.match((await buy(quinn, '0712000301')).body.error, /not on sale/);
    await setPremium(false);
  });

  let sam;

  test('super admins manage roles and site settings', async () => {
    let res = await api('/auth/register', { method: 'POST', body: { name: 'Sam', email: 'sam@example.com', password: 'password7' } });
    sam = res.body.token;
    assert.equal(res.body.user.role, 'superadmin', 'SUPER_ADMIN_EMAILS makes the account a super admin');
    res = await api('/auth/login', { method: 'POST', body: { email: 'sam@example.com', password: 'password7' } });
    assert.equal(res.body.user.role, 'superadmin');

    // Super admins pass every admin check.
    assert.equal((await api('/admin/stats', { token: sam })).status, 200);
    assert.equal((await api('/admin/premium', { token: sam })).status, 200);

    // Roles: only super admins change them, never their own.
    const users = (await api('/admin/users', { token: sam })).body.users;
    const id = (email) => users.find((u) => u.email === email).id;
    assert.equal((await api(`/admin/users/${id('sam@example.com')}`, { token: sam, method: 'PATCH', body: { role: 'user' } })).status, 400);
    res = await api(`/admin/users/${id('carol@example.com')}`, { token: sam, method: 'PATCH', body: { role: 'admin' } });
    assert.equal(res.body.user.role, 'admin');
    assert.equal((await api(`/admin/users/${id('alice@example.com')}`, { token: carol, method: 'PATCH', body: { role: 'user' } })).status, 403);
    // Admins remove readers, but only a super admin removes an admin.
    assert.equal((await api(`/admin/users/${id('carol@example.com')}`, { token: alice, method: 'DELETE' })).status, 403);
    res = await api(`/admin/users/${id('carol@example.com')}`, { token: sam, method: 'PATCH', body: { role: 'user' } });
    assert.equal(res.body.user.role, 'user');
    assert.equal((await api('/admin/stats', { token: carol })).status, 403);

    // System status and settings are for super admins only.
    assert.equal((await api('/system/status', { token: alice })).status, 403);
    assert.equal((await api('/system/settings', { token: alice, method: 'PUT', body: { signupsOpen: false } })).status, 403);
    res = await api('/system/status', { token: sam });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.services.find((s) => s.id === 'database').ok, true);
    assert.equal(res.body.counts.superAdmins, 1);
    assert.deepEqual((await api('/system/config')).body, { signupsOpen: true, uploads: 'everyone', quotesEnabled: true, announcement: '', pass: null });

    const settings = { signupsOpen: false, uploads: 'admins', quotesEnabled: false, announcement: '  Maintenance tonight at 10 pm  ' };
    res = await api('/system/settings', { token: sam, method: 'PUT', body: settings });
    assert.deepEqual(res.body.settings, { ...settings, announcement: 'Maintenance tonight at 10 pm', pass: null });
    assert.equal((await api('/system/config')).body.announcement, 'Maintenance tonight at 10 pm');

    // Closed sign-ups: new accounts are refused (by email or Google), except configured admins.
    res = await api('/auth/register', { method: 'POST', body: { name: 'Newbie', email: 'newbie@example.com', password: 'password8' } });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /sign-ups are closed/);
    assert.equal((await api('/auth/google', { method: 'POST', body: { credential: 'g-9|newbie@example.com|yes|padding-padding' } })).status, 403);
    res = await api('/auth/register', { method: 'POST', body: { name: 'Sue', email: 'sue@example.com', password: 'password9' } });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'superadmin');
    assert.equal((await api('/auth/login', { method: 'POST', body: { email: 'erin@example.com', password: 'password6' } })).status, 200, 'members still sign in');

    // Uploads limited to admins.
    res = await api('/books', { token: carol, method: 'POST', form: bookForm('nope.txt', 'Not today.') });
    assert.equal(res.status, 403);
    assert.match(res.body.error, /Only admins/);
    res = await api('/books', { token: alice, method: 'POST', form: bookForm('admin-only.txt', 'Admins can still add books.') });
    assert.equal(res.status, 201);

    res = await api('/system/settings', { token: sam, method: 'PUT', body: { signupsOpen: true, uploads: 'everyone', quotesEnabled: true, announcement: '' } });
    assert.deepEqual(res.body.settings, { signupsOpen: true, uploads: 'everyone', quotesEnabled: true, announcement: '', pass: null });
    assert.equal((await api('/system/settings', { token: sam, method: 'PUT', body: { uploads: 'nobody' } })).status, 400);

    // Accounts listed in SUPER_ADMIN_EMAILS are promoted at startup too.
    const { User } = await import('../src/models/User.js');
    const { syncConfiguredRoles } = await import('../src/services/roles.js');
    await User.updateOne({ email: 'sue@example.com' }, { $set: { role: 'user' } });
    assert.equal(await syncConfiguredRoles(), 1);
    assert.equal((await User.findOne({ email: 'sue@example.com' })).role, 'superadmin');
  });

  test('closed sign-ups also stop accounts that were never confirmed', async () => {
    const { setEmailSender } = await import('../src/services/email.js');
    const emails = [];
    setEmailSender(async (m) => emails.push(m));
    try {
      // Signed up while open, link not clicked yet.
      assert.equal((await api('/auth/register', { method: 'POST', body: { name: 'Bot', email: 'bot@example.com', password: 'password0' } })).status, 201);
      const link = new URL(emails.at(-1).text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
      await api('/system/settings', { token: sam, method: 'PUT', body: { signupsOpen: false } });
      let res = await api('/auth/register', { method: 'POST', body: { name: 'Bot', email: 'bot@example.com', password: 'password0' } });
      assert.equal(res.status, 403);
      const sent = emails.length;
      assert.equal((await api('/auth/resend-verification', { method: 'POST', body: { email: 'bot@example.com' } })).status, 200);
      assert.equal(emails.length, sent, 'no new link while sign-ups are closed');
      assert.equal((await api('/auth/verify-email', { method: 'POST', body: { token: link } })).status, 403);
      assert.equal((await api('/auth/google', { method: 'POST', body: { credential: 'g-7|bot@example.com|yes|padding-padding' } })).status, 403);
      // Open again: the same link works.
      await api('/system/settings', { token: sam, method: 'PUT', body: { signupsOpen: true } });
      res = await api('/auth/verify-email', { method: 'POST', body: { token: link } });
      assert.equal(res.status, 200);
    } finally {
      setEmailSender(null);
      await api('/system/settings', { token: sam, method: 'PUT', body: { signupsOpen: true } });
    }
  });

  test('book quotes appear once each and never from the same book twice in a row', async () => {
    const { seedClassicQuotes, removeDuplicateQuotes } = await import('../src/services/quotes.js');
    const { CLASSIC_QUOTES } = await import('../src/data/classicQuotes.js');
    const { Quote } = await import('../src/models/Quote.js');
    // A first start that fails part-way tries again next time.
    const insertMany = Quote.insertMany;
    Quote.insertMany = async () => {
      throw new Error('connection lost');
    };
    await assert.rejects(seedClassicQuotes(), /connection lost/);
    Quote.insertMany = insertMany;
    assert.equal(await seedClassicQuotes(), CLASSIC_QUOTES.length, 'the classics fill an empty list on first start');
    assert.equal(await seedClassicQuotes(), 0, 'and only once');

    // A visitor opens the app once per quote: every quote shows once, books never repeat back to back.
    let seen = [];
    let lastBook = null;
    const shown = [];
    for (let i = 0; i < CLASSIC_QUOTES.length; i++) {
      const res = await api('/quotes/next', { method: 'POST', body: { seen, lastBook } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { quote, reset } = res.body;
      assert.equal(reset, false, `round ended early at ${i}`);
      assert.notEqual(quote.bookKey, lastBook, `quote ${i} came from the same book as the one before`);
      shown.push(quote);
      seen.push(quote.id);
      lastBook = quote.bookKey;
    }
    assert.equal(new Set(shown.map((q) => q.id)).size, CLASSIC_QUOTES.length, 'no quote repeats in a round');
    let res = await api('/quotes/next', { method: 'POST', body: { seen, lastBook } });
    assert.equal(res.body.reset, true, 'once every quote has been seen, a new round starts');
    assert.notEqual(res.body.quote.bookKey, lastBook);
    assert.equal(typeof res.body.quote.text, 'string');
    assert.ok(res.body.quote.bookTitle);

    // Admins manage the list; readers can't.
    assert.equal((await api('/quotes', { token: carol })).status, 403);
    assert.equal((await api('/quotes', { token: carol, method: 'POST', body: { text: 'Hi', bookTitle: 'X' } })).status, 403);
    assert.match((await api('/quotes', { token: alice, method: 'POST', body: { text: 'No book given.' } })).body.error, /Which book/);
    res = await api('/quotes', { token: alice, method: 'POST', body: { text: 'Water boils at 100 degrees.', bookId: freeBook.id } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const linked = res.body.quote;
    assert.equal(linked.bookTitle, freeBook.title, 'a library book gives its title');
    assert.equal(linked.book.id, freeBook.id);
    res = await api(`/quotes/${linked.id}`, { token: alice, method: 'PATCH', body: { enabled: false } });
    assert.equal(res.body.quote.enabled, false);
    // Only that quote is left unseen, but it's switched off: a new round starts instead.
    res = await api('/quotes/next', { method: 'POST', body: { seen, lastBook } });
    assert.notEqual(res.body.quote.id, linked.id);
    assert.equal((await api('/quotes', { token: sam })).body.quotes.length, CLASSIC_QUOTES.length + 1);
    assert.equal((await api(`/quotes/${linked.id}`, { token: alice, method: 'DELETE' })).status, 204);

    // A deleted classic can be brought back.
    await api(`/quotes/${shown[0].id}`, { token: alice, method: 'DELETE' });
    assert.equal((await api('/quotes/classics', { token: alice, method: 'POST' })).body.added, 1);
    // A double click (two imports at once) still adds each missing quote only once.
    const gone = (await api('/quotes', { token: alice })).body.quotes.slice(0, 3);
    for (const q of gone) await api(`/quotes/${q.id}`, { token: alice, method: 'DELETE' });
    const both = await Promise.all([1, 2].map(() => api('/quotes/classics', { token: alice, method: 'POST' })));
    assert.equal(both[0].body.added + both[1].body.added, 3);
    assert.equal((await api('/quotes', { token: alice })).body.quotes.length, CLASSIC_QUOTES.length);
    res = await api('/quotes', { token: alice, method: 'POST', body: { text: CLASSIC_QUOTES[0].text, bookTitle: 'Somewhere else' } });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already in the list/);
    // A database with duplicates from before the unique rule keeps the oldest of each.
    await Quote.collection.dropIndex('text_1');
    const copy = (await Quote.findOne({ text: CLASSIC_QUOTES[1].text }).lean());
    await Quote.collection.insertOne({ ...copy, _id: new mongoose.Types.ObjectId(), createdAt: new Date() });
    assert.equal(await removeDuplicateQuotes(), 1);
    assert.equal(await Quote.countDocuments({ text: CLASSIC_QUOTES[1].text }), 1);
    assert.equal((await Quote.findOne({ text: CLASSIC_QUOTES[1].text })).id, String(copy._id));
    await Quote.createIndexes();

    // A super admin can switch the popup off.
    await api('/system/settings', { token: sam, method: 'PUT', body: { quotesEnabled: false } });
    assert.equal((await api('/quotes/next', { method: 'POST', body: {} })).body.quote, null);
    await api('/system/settings', { token: sam, method: 'PUT', body: { quotesEnabled: true } });
  });

  test('opening the app wakes ISA Tech Hub', async () => {
    const { env } = await import('../src/config/env.js');
    const { hubWaking, resetHubWake } = await import('../src/services/hub.js');
    assert.deepEqual((await api('/system/wake')).body, { ok: true, hub: 'off' }, 'nothing to wake without the Hub settings');

    let hits = 0;
    let answer = 200;
    const fakeHub = http.createServer((req, res) => {
      if (req.url === '/v1/config') hits++;
      res.writeHead(answer, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer === 200 ? { platform: { name: 'A-Read' }, till: { kind: 'till', payNumber: '5557777', active: true } } : { error: 'Invalid API key' }));
    });
    await new Promise((resolve) => fakeHub.listen(0, '127.0.0.1', resolve));
    const saved = { ...env.hub };
    Object.assign(env.hub, { url: `http://127.0.0.1:${fakeHub.address().port}`, apiKey: 'isa_sk_test', webhookSecret: 'whsec_test' });
    try {
      resetHubWake();
      let res = await api('/system/wake');
      assert.equal(res.status, 202);
      assert.equal(res.body.hub, 'waking');
      await hubWaking();
      assert.equal(hits, 1);
      // Opened again a moment later: the Hub is awake, so it isn't asked again.
      assert.equal((await api('/system/wake')).body.hub, 'awake');
      assert.equal(hits, 1);
      res = await api('/system/status', { token: sam });
      assert.equal(res.body.hub.enabled, true);
      assert.equal(res.body.hub.last.ok, true);

      // A Hub that refuses the key is reported to super admins in plain words.
      resetHubWake();
      answer = 401;
      await api('/system/wake');
      await hubWaking();
      res = await api('/system/status', { token: sam });
      assert.equal(res.body.hub.last.ok, false);
      assert.match(res.body.hub.last.error, /rejected ISA_HUB_API_KEY/);
      await api('/system/wake');
      assert.equal(hits, 2, 'a failed wake is retried after a pause, not on every open');

      // While the Hub is asleep or briefly down, readers keep the payment form (the prompt itself
      // reports an outage); a refused key means payments aren't set up.
      const { clearHubConfig } = await import('../src/services/hub.js');
      clearHubConfig();
      answer = 503;
      assert.equal((await api('/payments/config')).body.enabled, true);
      clearHubConfig();
      answer = 401;
      assert.equal((await api('/payments/config')).body.enabled, false);
    } finally {
      Object.assign(env.hub, saved);
      resetHubWake();
      fakeHub.close();
    }
  });

  test('admins file existing books, and A-Read works out categories from the books themselves', async () => {
    const repeat = (sentences, times) => Array.from({ length: times }, (_, i) => sentences[i % sentences.length]).join(' ');
    const history = repeat(
      [
        'The empire sent a colonial army across the river in the early years of the century.',
        'Historians still argue about the treaty that ended the long war between the two kingdoms.',
        'The rebellion against the colonial government grew after the battle at the fort.',
        'Independence came only after decades of resistance, and the old dynasty never returned.',
      ],
      40,
    );
    const faith = repeat(
      [
        'We pray to God each morning and give thanks for His grace and mercy.',
        'The gospel teaches that faith and prayer bring the believer closer to the Lord.',
        'In church the congregation sang a psalm before the sermon on salvation.',
        'Scripture reminds us that the Holy Spirit guides those who worship in truth.',
      ],
      40,
    );
    const novel = repeat(
      [
        '“Where have you been?” she whispered, staring at the door.',
        '“Nowhere,” he replied with a shrug, and smiled at the stranger by the fire.',
        'She laughed, then glanced at the dark window and sighed.',
        '“You never tell me anything,” she cried, and he nodded slowly.',
      ],
      40,
    );
    const bees = repeat(
      [
        'The bees left the hive at dawn to gather nectar from the acacia flowers.',
        'A strong colony needs a healthy queen, plenty of comb and a dry hive box.',
        'When the swarm settled on the branch, the keeper smoked the bees gently and moved them.',
        'Harvest the honey only when most of the comb is capped with wax.',
      ],
      40,
    );
    const upload = async (name, text, fields = {}) => {
      const res = await api('/books', { token: carol, method: 'POST', form: bookForm(name, `CHAPTER 1\n\n${text}`, fields) });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      return res.body.book;
    };

    // Common categories in one click (Science already covers "Science & Nature").
    let res = await api('/categories/starters', { token: alice });
    assert.ok(res.body.starters.includes('History'));
    assert.ok(!res.body.starters.includes('Science & Nature'));
    assert.equal((await api('/categories/starters', { token: carol })).status, 403);
    res = await api('/categories/starters', { token: alice, method: 'POST', body: { names: ['History', 'Religion & Spirituality', 'Fiction'] } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.categories.map((c) => c.name).sort(), ['Fiction', 'History', 'Religion & Spirituality']);
    assert.equal((await api('/categories/starters', { token: alice, method: 'POST', body: { names: ['Astrology'] } })).status, 400);
    const categories = Object.fromEntries((await api('/categories')).body.categories.map((c) => [c.name, c]));

    // Uploads without a category are sorted from their own text, even with an unhelpful title.
    const longRoad = await upload('the_long_road.txt', history);
    assert.equal(longRoad.category?.name, 'History');
    assert.equal(longRoad.categorySource, 'auto');
    assert.equal(longRoad.textProfile, undefined, 'the text summary stays on the server');
    const morning = await upload('morning_light.txt', faith);
    assert.equal(morning.category?.name, 'Religion & Spirituality');
    const evening = await upload('the_evening.txt', novel);
    assert.equal(evening.category?.name, 'Fiction');
    // Chosen at upload: kept, and counted as a person's choice.
    const chosen = await upload('chosen.txt', faith, { category: categories.History.id });
    assert.equal(chosen.category.name, 'History');
    assert.equal(chosen.categorySource, 'manual');
    assert.equal((await api(`/books/${longRoad.id}`)).body.book.textProfile, undefined);

    // Editing other details keeps an automatic pick; choosing a category makes it a person's choice.
    res = await api(`/books/${evening.id}`, { token: carol, method: 'PATCH', body: { title: 'The Evening' } });
    assert.equal(res.body.book.categorySource, 'auto');

    // Filing existing books by hand, in bulk (an admin's choice counts as manual).
    const club = (await api('/categories', { token: alice, method: 'POST', body: { name: 'Club Picks' } })).body.category;
    const hives = await upload('hives_one.txt', bees);
    const hives2 = await upload('hives_two.txt', bees.split(' ').reverse().join(' '));
    assert.equal((await api('/categories/books', { token: carol, method: 'PUT', body: { assignments: [{ bookId: hives.id, categoryId: club.id }] } })).status, 403);
    res = await api('/categories/books', {
      token: alice,
      method: 'PUT',
      body: { assignments: [{ bookId: hives.id, categoryId: club.id }, { bookId: hives2.id, categoryId: club.id }, { bookId: evening.id, categoryId: null }] },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.updated, 3);
    assert.equal((await api(`/books/${hives.id}`)).body.book.categorySource, 'manual');
    assert.equal((await api(`/books/${evening.id}`)).body.book.category, null);
    res = await api('/categories/books', { token: alice, method: 'PUT', body: { assignments: [{ bookId: hives.id, categoryId: '0123456789abcdef01234567' }] } });
    assert.equal(res.status, 400);
    assert.ok((await api('/books?category=none')).body.books.some((b) => b.id === evening.id));
    assert.ok(!(await api('/books?category=none')).body.books.some((b) => b.id === hives.id));

    // Suggestions: nothing changes until applied, and A-Read learns from the books already filed.
    const third = await upload('notes_from_the_hill.txt', repeat(bees.split('. '), 30), {});
    assert.notEqual(third.category?.name, 'History');
    await api('/categories/books', { token: alice, method: 'PUT', body: { assignments: [{ bookId: third.id, categoryId: null }] } });
    assert.equal((await api('/categories/suggest', { token: carol, method: 'POST', body: {} })).status, 403);
    res = await api('/categories/suggest', { token: alice, method: 'POST', body: { scope: 'uncategorized' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const suggestionFor = (id) => res.body.suggestions.find((s) => s.book.id === id)?.suggestion;
    assert.equal(suggestionFor(evening.id).category.name, 'Fiction');
    assert.ok(suggestionFor(evening.id).reasons.length > 0);
    assert.equal(suggestionFor(third.id).category?.name, 'Club Picks', 'learned from the two filed bee books');
    assert.match(suggestionFor(third.id).reasons.join(' '), /similar to 2 books/);
    assert.equal((await api(`/books/${evening.id}`)).body.book.category, null, 'suggesting changes nothing');
    res = await api('/categories/suggest', { token: alice, method: 'POST', body: { scope: 'auto' } });
    assert.ok(res.body.suggestions.every((s) => s.book.categorySource === 'auto'));
    assert.ok(res.body.suggestions.some((s) => s.book.id === longRoad.id));

    // Keywords steer the sorting.
    res = await api(`/categories/${club.id}`, { token: alice, method: 'PATCH', body: { keywords: 'Beekeeping,  hive , beekeeping' } });
    assert.deepEqual(res.body.category.keywords, ['beekeeping', 'hive']);

    // Deleting a category un-files its books completely.
    await api(`/categories/${club.id}`, { token: alice, method: 'DELETE' });
    const after = (await api(`/books/${hives.id}`)).body.book;
    assert.equal(after.category, null);
    assert.equal(after.categorySource, undefined);
  });
});
