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
- **Support popups + M-Pesa**: admins schedule a "support us" popup (start and end time, optional daily hours, audience, how often each reader sees it, and whether it closes itself after N seconds). It sits in a corner and never blocks reading. The **Support** page (`/support`) takes M-Pesa payments by STK Push to your till, and admins see every payment and the total raised per popup.

- **Required reading**: admins assign books to everyone or to chosen readers, with a due date and a note (optionally emailed). Readers get a Required reading list; admins see who has finished.
- **Accounts**: email sign-up with a confirmation link (sent through Brevo), or **Sign in with Google**.
- **Public catalogue + SEO**: anyone, including search engines, can browse the library and book pages (`/sitemap.xml`, `/robots.txt`). Reading and listening need an account.
- **Installable app (PWA)**: add it to the home screen on Android, iOS and desktop.
- **Offline reading and listening**: books a reader opens are kept inside the app automatically (no download button, no files on the device the reader can access). The 10 most recently opened books can be read and listened to (narration, plus an audiobook once it has been played) with no connection, and progress syncs when the reader is back online. Original PDF/EPUB files up to 30 MB are kept for the page view. The device's own voice works offline only if a voice is installed locally.

Only the person who uploaded a book (or an admin) can edit it, delete it, or add audio.

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

Without this, everything else still works. Readers listen with their device's built-in voice, which is free, and the cloud narration panel is hidden.

### 5. (Optional) Email confirmation and Google sign-in

- **Brevo**: create an API key (SMTP & API → API Keys) and verify a sender address. Set `BREVO_API_KEY` and `EMAIL_FROM` (plus `EMAIL_FROM_NAME`). New email accounts must then click the confirmation link before they can sign in. Without these settings, accounts are active right away.
- **Google**: in the Google Cloud console create an OAuth client ID of type *Web application*. Add your frontend URLs (e.g. `https://a-read.vercel.app`, `http://localhost:5173`) as **Authorized JavaScript origins**, and set `GOOGLE_CLIENT_ID` on the backend. The "Continue with Google" button appears automatically.

### 6. (Optional) M-Pesa payments and support popups

The reader enters their phone number, gets the M-Pesa PIN prompt (STK Push), and the page confirms once they've paid. A-Read can send the prompt in two ways:

- **Through ISA Tech Hub (recommended).** The Hub is the one service that holds the ISA till's Daraja keys. It sends the prompt, settles the result with Safaricom, and tells A-Read by signed webhook. A-Read needs no Daraja settings at all.
- **Directly with Daraja**, using A-Read's own `MPESA_*` settings (below). This is how it worked before the Hub, and it's what A-Read falls back to when the three `ISA_HUB_*` settings aren't all set.

**Connect A-Read to ISA Tech Hub**

1. In the Hub dashboard, open **Platforms → Add platform**. Choose the till and set the webhook URL to `https://<this API>/api/payments/hub-webhook`. Copy the **API key** and **webhook secret** it shows once.
2. On A-Read's backend host, set:
   - `ISA_HUB_URL`: the Hub API's address, e.g. `https://isa-tech-hub.onrender.com`
   - `ISA_HUB_API_KEY`: `isa_sk_…`
   - `ISA_HUB_WEBHOOK_SECRET`: `whsec_…`

   Then redeploy. New payments now go through the Hub. Payments already in progress with Daraja still settle the old way.
3. In the Hub, press **Send test webhook** on A-Read's platform page (A-Read must answer 2xx), then make a KES 10 payment on `/support`. It shows up in both A-Read's **Admin → Payments** and the Hub's **Payments**.
4. Once a day has passed with no direct payments left pending, remove A-Read's `MPESA_*` keys (keep `MPESA_MIN_AMOUNT` / `MPESA_MAX_AMOUNT`, which set A-Read's own limits).

A-Read keeps its own record of each payment (`provider: "hub"`, plus the Hub's payment id), so `Payment.hasPaid` and the per-popup totals work exactly as before. A payment the Hub holds as **disputed** (M-Pesa reported a different amount) shows as *Under review* in Admin → Payments, and the payer is told not to pay again.

**Or connect Daraja directly**

1. On [developer.safaricom.co.ke](https://developer.safaricom.co.ke/) create an app with **M-Pesa Express** and note its Consumer Key and Secret.
2. **Sandbox first:** set `MPESA_ENV=sandbox`, `MPESA_SHORTCODE=174379` and the sandbox passkey from the M-Pesa Express simulator. Leave `MPESA_TILL_NUMBER` empty (the sandbox short code is a Paybill).
3. **Go live** with your till: Safaricom gives you production keys and a passkey. Set `MPESA_ENV=production`, `MPESA_TILL_NUMBER` to the till customers pay, and `MPESA_SHORTCODE` to its **store (head office) number**, which is the number the passkey belongs to. With a Paybill instead, leave the till empty and put the Paybill in `MPESA_SHORTCODE`.
4. Set `MPESA_CALLBACK_BASE_URL` to the API's public **HTTPS** address and `MPESA_CALLBACK_SECRET` to a long random string. Safaricom posts each result to `/api/payments/mpesa/callback/<secret>`. It can't reach `localhost`, so for local testing use a tunnel such as `ngrok http 5000`. If a callback gets lost, the payment page asks Daraja for the status itself after 20 seconds.

Until all of these are set, the Support page only shows the till number (when `MPESA_TILL_NUMBER` is set) for paying from the M-Pesa menu. Payments made that way aren't recorded in A-Read.

Admins create popups under **Admin → Popups** (with a live preview) and see payments under **Admin → Payments**. Each payment records a **purpose**: `donation` by default, or a name set on the popup (e.g. `premium`). To unlock a paid feature later, check `await Payment.hasPaid(userId, 'premium', minAmount)` on the backend. The purpose always comes from the admin's popup, never from the browser.

### 7. Run it

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

**Sharing and SEO on Vercel.** `frontend/api/` holds three small Vercel Functions, routed by `frontend/vercel.json`:

- `/share/books/:id` returns Open Graph tags (title, author, cover) so WhatsApp and other apps show a preview, then opens the book page.
- `/sitemap.xml` lists the library and every book for Google.
- `/robots.txt` points crawlers at the sitemap.

All three read `VITE_API_URL` to reach the backend. After deploying, submit `https://<your-site>/sitemap.xml` in Google Search Console. On Render's free plan the backend sleeps, so the first preview or sitemap fetch after a quiet period can be slow.

**Reading position.** The reader saves the section, sentence, EPUB location and audiobook time (debounced, and again when the tab is hidden). The library's "Continue reading" row comes from this.

## Tests

```bash
npm test     # unit tests: text splitting, PDF/EPUB/TXT extraction, SSML chunking
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test   # also runs the API tests
```

The API tests drive the real Express app against a real database, with Cloudinary and Google stubbed out. They cover auth, uploads of all three formats, search and filters, permissions, progress, bookmarks, audiobooks, narration jobs, deletion, support popups and M-Pesa payments, both direct (Daraja is stubbed) and through ISA Tech Hub (a stand-in Hub server). **Use a throwaway database:** the tests drop it.

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
| `GET /api/promotions/active` (public) | The support popup to show this visitor now, if any |
| `GET / POST /api/promotions`, `PATCH / DELETE /api/promotions/:id` | Admin only: schedule, edit, pause and delete popups |
| `GET /api/payments/config` (public), `POST /api/payments/stk` (public), `GET /api/payments/:id` (public) | M-Pesa settings, start an STK Push, poll its status |
| `POST /api/payments/hub-webhook` | ISA Tech Hub's signed webhook (`ISA-Signature` header) |
| `POST /api/payments/mpesa/callback/:secret` | Safaricom's result callback (direct Daraja only) |
| `GET /api/payments?status=` | Admin only: payments and totals |

## Limitations

- **Scanned PDFs** are images of pages with no text layer, so they can be viewed but not read aloud (unless you attach an audiobook). OCR is not included.
- **Device voices** depend on the browser and OS. Chrome, Edge and Safari have good voices; some Linux browsers have none.
- **Audiobook audio** isn't synced to the text: you get one timeline for the whole file.
- **Narration jobs** run inside the API process. For heavy use, move them to a job queue (e.g. BullMQ).
- The login token is kept in `localStorage`. That's simple and works across domains, but an HttpOnly cookie is stronger against XSS if you host the frontend and API on the same domain.
