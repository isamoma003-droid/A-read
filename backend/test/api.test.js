// End-to-end API tests. They need a MongoDB-compatible server:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test
// Cloudinary calls are stubbed, so no Cloudinary account is needed.
process.env.NODE_ENV ||= 'test'; // must be set before src/ modules load (they're imported in before())
process.env.ADMIN_EMAILS = 'alice@example.com';
process.env.CLOUDINARY_MAX_FILE_MB = '0.004'; // ~4 KB parts so the chunking path is exercised
process.env.FRONTEND_URL = 'https://a-read.example';

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import mongoose from 'mongoose';
import { makeEpub, makePdf } from './helpers.js';

const uri = process.env.MONGODB_URI_TEST;

describe('API', { skip: !uri && 'set MONGODB_URI_TEST to run API tests' }, () => {
  let server;
  let base;
  const uploads = [];
  const destroyed = [];

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
    cloudinary.api.delete_resources_by_prefix = async (prefix) => destroyed.push(prefix);
    cloudinary.api.delete_folder = async () => {};

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
    assert.equal((await api(`/admin/users/${me.id}`, { token: alice, method: 'PATCH', body: { role: 'user' } })).status, 400);
    let res = await api(`/admin/users/${bobUser.id}`, { token: alice, method: 'PATCH', body: { role: 'admin' } });
    assert.equal(res.body.user.role, 'admin');
    res = await api(`/admin/users/${bobUser.id}`, { token: alice, method: 'PATCH', body: { role: 'user' } });
    assert.equal(res.body.user.role, 'user');
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
      assert.match(section.narration.url, /narration\/section-0000$/);
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
});
