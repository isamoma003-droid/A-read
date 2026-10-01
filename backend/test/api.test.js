// End-to-end API tests. They need a MongoDB-compatible server:
//   MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test
// Cloudinary calls are stubbed, so no Cloudinary account is needed.
process.env.NODE_ENV ||= 'test'; // must be set before src/ modules load (they're imported in before())
process.env.ADMIN_EMAILS = 'alice@example.com';
process.env.CLOUDINARY_MAX_FILE_MB = '0.004'; // ~4 KB parts so the chunking path is exercised
process.env.FRONTEND_URL = 'https://a-read.example';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

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

  test('sitemap lists the home page and every book', async () => {
    const res = await fetch(`${base.replace('/api', '')}/sitemap.xml?origin=https://a-read.vercel.app`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /xml/);
    const xml = await res.text();
    assert.match(xml, /<loc>https:\/\/a-read\.vercel\.app\/<\/loc>/);
    assert.match(xml, new RegExp(`<loc>https://a-read\\.vercel\\.app/books/${txtBook.id}</loc>`));
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
});
