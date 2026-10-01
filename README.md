# A-Read

A shared book library where people upload books and then **read them on screen or listen to them**.

- **Upload** PDF, EPUB or TXT files. A-Read extracts the text and chapters and stores the file in Cloudinary.
- **Read** in a clean text view with adjustable size, font, line spacing and light/sepia/dark themes, or in the original page layout (PDF pages, paginated EPUB).
- **Listen** three ways:
  - **Device voice**: the browser reads the book aloud for free (Web Speech API).
  - **Cloud narration**: natural Google Cloud Text-to-Speech voices, generated once per book and stored in Cloudinary.
  - **Audiobook**: attach your own recording (MP3, M4A, M4B, OGG, WAV, FLAC).
- **Follow along**: the sentence being spoken is highlighted and kept in view (device voice and cloud narration).
- **Pick up where you left off**: reading and listening position is saved per user, plus private bookmarks with notes.
- **Library**: covers (from the PDF's first page, the EPUB's own cover, an upload, or generated), search, format/audio/tag filters, and sorting.
- **Batch uploads** of up to 20 books at a time, up to 100 MB each, even on Cloudinary's free plan (large files are stored in parts).
- **Share** any book to WhatsApp, Telegram, Facebook, X, email or a copied link, with a title-and-cover preview.
- **Admin panel** (`/admin`): library stats, user management (promote/demote admins, delete accounts), and book moderation.

Everyone with an account sees the whole library. Only the person who uploaded a book (or an admin) can edit it, delete it, or add audio.

## Tech stack

| Part | Stack |
| --- | --- |
| `backend/` | Node.js 22, Express 5, MongoDB (Mongoose), Cloudinary, JWT auth, pdf.js / JSZip for text extraction, Google Cloud Text-to-Speech |
| `frontend/` | React 19, Vite, React Router, TanStack Query, react-pdf, epub.js, lucide icons |

```
A-Read/
├── backend/
│   ├── src/
│   │   ├── config/        env, MongoDB, Cloudinary
│   │   ├── models/        User, Book, Section, Progress, Bookmark
│   │   ├── routes/        auth, books (+ sections, audio, bookmarks), progress, tts
│   │   ├── services/
│   │   │   ├── extract/   PDF, EPUB and TXT → sections of sentences
│   │   │   ├── books.js   upload / cover / audiobook / delete
│   │   │   ├── narration.js  Google TTS background jobs
│   │   │   └── storage.js Cloudinary helpers
│   │   ├── app.js
│   │   └── server.js
│   └── test/              unit + API tests (node:test)
└── frontend/
    └── src/
        ├── api/           fetch client + React Query hooks
        ├── pages/         Library, Upload, Book, Reader, Login/Register
        ├── reader/        text/PDF/EPUB views, audio bar, speech & audio hooks
        └── styles/
```

## Getting started

### 1. Prerequisites

- **Node.js 22.13+** (`nvm use` picks it up from `.nvmrc`)
- **MongoDB**: a local server (`mongodb://127.0.0.1:27017/a-read`) or a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster
- **Cloudinary** account (the free plan is fine to start)
- *Optional:* a **Google Cloud** project for cloud narration

### 2. Install

```bash
npm run install:all          # installs backend/ and frontend/
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env   # optional, only needed in production
```

### 3. Configure `backend/.env`

| Variable | What to put there |
| --- | --- |
| `MONGODB_URI` | Your MongoDB connection string |
| `JWT_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CLOUDINARY_URL` | Cloudinary Dashboard → **API Keys** → copy the `cloudinary://…` environment variable |
| `ADMIN_EMAILS` | Comma-separated emails that can edit or delete any book |
| `CLIENT_ORIGIN` | The frontend URL(s) allowed by CORS (default `http://localhost:5173`) |
| `FRONTEND_URL` | Optional. Where shared links send people (defaults to the first `CLIENT_ORIGIN`) |

**Cloudinary setting you must change:** new Cloudinary accounts block PDF delivery by default. Open **Settings → Security** and turn on **"Allow delivery of PDF and ZIP files"**, or the PDF page view won't load.

Cloudinary plans cap the size of each stored file (free plan: 10 MB for PDFs and other raw files, 100 MB for audio). A-Read stores books larger than `CLOUDINARY_MAX_FILE_MB` as several parts, so `MAX_BOOK_MB` (default 100) can be higher than your plan's per-file limit. Audiobooks are stored as one file, so keep `MAX_AUDIO_MB` within your plan's video limit. If you're on a paid plan, raise `CLOUDINARY_MAX_FILE_MB` to store books in one piece.

### 4. (Optional) Enable Google Cloud narration

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and enable the **Cloud Text-to-Speech API** (billing must be enabled; there is a monthly free tier).
2. Create a **service account**, then add a **JSON key** and download it, e.g. to `backend/service-account.json`. That filename is git-ignored, so never commit the key.
3. In `backend/.env`, set `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`. Optionally also set `GOOGLE_TTS_DEFAULT_VOICE` (e.g. `en-US-Neural2-F`) and the `NARRATION_MAX_CHARS` cost guard.

Without this, everything else still works. Readers use their device voice, and the narration panel explains that cloud narration isn't set up.

### 5. Run it

```bash
npm run dev:backend    # API on http://localhost:5000
npm run dev:frontend   # app on http://localhost:5173 (proxies /api to :5000)
```

Open http://localhost:5173, create an account and upload a book.

## How it works

**Ingestion.** On upload, the backend extracts text before uploading anything, so a broken file fails fast:

- **PDF**: one section per page (pdf.js). Lines are grouped into paragraphs by vertical spacing, and the PDF outline becomes the table of contents. The cover is the first page, rendered by Cloudinary (`pg_1`).
- **EPUB**: one section per spine document. The table of contents comes from the EPUB 3 nav or the EPUB 2 NCX, and metadata and the embedded cover are extracted.
- **TXT**: split on chapter headings (`Chapter 1`, `PART II`, `Prologue`…) or into ~2,500-word parts. Encodings are detected and Project Gutenberg boilerplate is stripped.

Each section is stored as a list of sentences (split with `Intl.Segmenter`) plus paragraph boundaries. The text view, the browser voice and cloud narration all share the same sentence numbering, which is what makes highlighting exact.

**Cloud narration.** A background job turns each section into an MP3. The SSML puts a `<mark>` before every sentence, so Google returns each sentence's start time. Those times drive the highlight. Requests are chunked under Google's 5,000-byte limit and the audio is joined per section. Jobs survive a stop and can be **resumed** (sections already done with the same voice are skipped). If the server restarts mid-job, the book shows "Interrupted" and can be resumed.

**Sharing.** Share links point at the API (`https://<api>/share/books/<id>`). That page carries Open Graph tags (title, author, cover), so WhatsApp and other apps show a preview, and then redirects to the book in the app. Visitors who aren't logged in are taken to it after logging in or signing up. On Render's free plan the first preview after the server sleeps can time out; sharing again works.

**Reading position.** The reader saves the section, sentence, EPUB location and audiobook time (debounced, and again when the tab is hidden). The library's "Continue reading" row comes from this.

## Tests

```bash
npm test     # unit tests: text splitting, PDF/EPUB/TXT extraction, SSML chunking
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test   # also runs the API tests
```

The API tests drive the real Express app against a real database, with Cloudinary and Google stubbed out. They cover auth, uploads of all three formats, search and filters, permissions, progress, bookmarks, audiobooks, narration jobs and deletion. **Use a throwaway database:** the tests drop it.

```bash
npm run lint   # frontend ESLint (React hooks rules)
```

## Deploying

**One server (simplest).** Build the frontend and let Express serve it:

```bash
npm run build                                # creates frontend/dist
SERVE_CLIENT=true NODE_ENV=production npm start
```

**Separate hosting.** Deploy `backend/` to any Node host (Render, Railway, Fly.io…) and `frontend/dist` to a static host (Netlify, Vercel, Cloudflare Pages). Set `VITE_API_URL=https://your-api.example.com/api` before building the frontend, and `CLIENT_ORIGIN=https://your-frontend.example.com` on the backend. Configure the static host to serve `index.html` for all routes.

## API overview

All endpoints except register/login need `Authorization: Bearer <token>`.

| Method & path | Purpose |
| --- | --- |
| `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me` | Accounts |
| `GET /api/books?q=&format=&audio=&tag=&mine=&sort=&page=` | Library search & filters |
| `POST /api/books` (multipart: `file`, optional `cover`, `title`, `author`, `description`, `language`, `tags`) | Upload a book |
| `GET / PATCH / DELETE /api/books/:id` | Book details, edit, delete |
| `PUT /api/books/:id/cover` (multipart `cover`) | Replace the cover |
| `GET /api/books/:id/sections`, `GET /api/books/:id/sections/:index` | Table of sections; one section's text + narration timings |
| `POST / DELETE /api/books/:id/audiobook` (multipart `audio`) | Attach / remove an audiobook |
| `GET / POST / DELETE /api/books/:id/narration` (`?purge=true` deletes audio) | Cloud narration status, start/resume, stop |
| `GET /api/tts/status`, `GET /api/tts/voices?language=en` | Narration availability and voices |
| `GET /api/progress`, `GET / PUT /api/progress/:bookId` | Continue reading; per-book position |
| `GET /api/admin/stats`, `GET /api/admin/users?q=`, `PATCH / DELETE /api/admin/users/:id` | Admin only: stats, roles, account removal (`?deleteBooks=true`) |
| `GET /share/books/:id` (public) | Link-preview page that redirects to the book |
| `GET / POST /api/books/:id/bookmarks`, `PATCH / DELETE /api/bookmarks/:id` | Private bookmarks |

## Limitations

- **Scanned PDFs** are images of pages with no text layer, so they can be viewed but not read aloud (unless you attach an audiobook). OCR is not included.
- **Device voices** depend on the browser and OS. Chrome, Edge and Safari have good voices; some Linux browsers have none.
- **Audiobook audio** isn't synced to the text: you get one timeline for the whole file.
- **Narration jobs** run inside the API process. For heavy use, move them to a job queue (e.g. BullMQ).
- The login token is kept in `localStorage`. That's simple and works across domains, but an HttpOnly cookie is stronger against XSS if you host the frontend and API on the same domain.
