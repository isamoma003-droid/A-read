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
- **Categories**: admins keep a list of categories (Fiction, History, Children…, or 15 common ones in one click). Readers browse the library by category (`/?category=fiction`).
  - **Filing existing books**: under **Admin → Categories**, "Add books" picks books from the library (optionally only those without a category); the admin **Books** list also has a category picker per book.
  - **Automatic categories**: A-Read works out a book's category from the book itself, with no outside service. It reads the title, tags, description, chapter titles and text taken from across the book, and compares them with each category's name and keywords, the words typical of about 25 common categories (in English and Kiswahili, e.g. "Dini" or "Kilimo"), how the book is written (lots of dialogue reads like a story; short lines like poetry), and the books already filed under each category. Uploads where no category is chosen are filed automatically when the match is clear (marked *auto*). **Sort books automatically** suggests categories for books without one (or re-checks automatic picks) for the admin to review, change and apply.
- **Premium books**: admins pick books to sell, set a price, and choose which chapters stay locked (for example, "first 3 chapters free, lock the rest"). Readers see every chapter title, read the free ones, and pay once by M-Pesa to unlock the whole book on all their devices. The uploader and admins can always read everything.
- **Batch uploads** of up to 20 books at a time, up to 100 MB each, even on Cloudinary's free plan (large files are stored in parts).
  - **Uploads that don't get lost**: books keep uploading while the reader browses the rest of the app (a small card in the corner shows progress). The queue, the files themselves and the details form are kept in the browser (IndexedDB), so after a refresh, a closed tab or a dropped connection the uploads carry on by themselves. The browser asks before leaving mid-upload. Each file has an upload key, so a book that reached the server just before a refresh is never added twice; a file that had fully arrived is waited for rather than sent again (saves mobile data). Logging out stops and forgets the queue.
- **Author pages** (`/authors`, `/authors/:slug`): everyone named in a book's author line gets a page listing their books (co-authors such as "Jane Doe and John Roe", "Jane Doe & John Roe" or the Kiswahili "… na …" each get their own). Admins can write a short bio. Book pages link to their authors, and a library search also suggests matching authors.
- **Ratings and reviews**: readers give 1-5 stars and an optional review; the book page shows the average, a breakdown by stars and a "Finished it" mark for reviewers who read to the end. The uploader can't rate their own book. The library sorts by **Top rated** (a weighted score, so one 5-star review doesn't beat a hundred 4.5s). Admins remove reviews that break the rules.
- **Premium Pass**: besides unlocking one premium book, readers can pay once by M-Pesa to open *every* premium book for a set number of days (admins choose the price and length under **Admin → Premium**). It never renews by itself; buying again adds the days on the end. It's offered on `/premium`, in the top bar and next to every unlock button.
- **Featured shelf and related books**: admins put a book on the home page's **Featured** shelf for 7-90 days (a placement you can sell to authors and publishers). Each book page ends with "More by this author" and "You may also like" (same category or shared tags, best rated first).
- **Share** any book to WhatsApp, Telegram, Facebook, X, email or a copied link, with a title-and-cover preview.
- **Admin panel** (`/admin`): library stats, readers (remove accounts), book moderation, categories, premium books with what each has sold, and quotes. Super admins also choose roles and get the **System** tab.
- **Support popups + M-Pesa**: admins schedule a "support us" popup (start and end time, optional daily hours, audience, how often each reader sees it, and whether it closes itself after N seconds). The **Support** page (`/support`) takes M-Pesa payments by STK Push to your till, and admins see every payment and the total raised per popup.
- **Book quotes**: each time someone opens the app, a quote from a book appears. Every visitor sees each quote once before any comes back, and never two from the same book in a row. It starts with 42 classic quotes from 34 public-domain books; admins add their own (optionally linked to a book in the library, with a "Read this book" button).
- **Centred popups**: the support popup, the quote and the Share box all open in the middle of the screen, one at a time (a popup waits while another is open). Escape, the X or a click outside closes them. None appear inside the reader.
- **Super admin**: the accounts in `SUPER_ADMIN_EMAILS` run the whole system. They do everything admins do, and only they can change roles (reader, admin, super admin) or remove admins. **Admin → System** holds site settings (sign-ups open or closed, who can upload, the quote popup, an announcement at the top of every page) and a health check of every connected service.
- **ISA Tech Hub wake-up**: each time the app opens (or comes back after 5 minutes away), it calls `/api/system/wake`. That wakes the API, and the API wakes ISA Tech Hub (at most once a minute), so a reader paying by M-Pesa doesn't wait for a sleeping server.

- **Required reading**: admins assign books to everyone or to chosen readers, with a due date and a note (optionally emailed). Readers get a Required reading list; admins see who has finished.
- **Accounts**: email sign-up with a confirmation link (sent through Brevo), or **Sign in with Google**.
- **Public catalogue + SEO**: anyone, including search engines, can browse the library, book pages and author pages. `/sitemap.xml` lists every book, every author and every category shelf, with the date each last changed, so a new author's page is picked up as soon as their first book is uploaded. Book and author pages carry structured data (schema.org `Book` with author, cover, price and star rating; `ProfilePage`/`Person` for authors) and a canonical address. Reading and listening need an account.
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
│   │   ├── models/        User, Book, Category, Section, Progress, Bookmark, Payment…
│   │   ├── routes/        auth, books (+ sections, audio, bookmarks), categories, progress, payments, admin, tts…
│   │   ├── services/
│   │   │   ├── extract/   PDF, EPUB and TXT → sections of sentences
│   │   │   ├── books.js   upload / cover / audiobook / delete
│   │   │   ├── narration.js  Google TTS background jobs
│   │   │   ├── premium.js     who can open which chapters; private file names for premium books
│   │   │   ├── categorize.js  works out a book's category from its own words
│   │   │   └── storage.js Cloudinary helpers
│   │   ├── app.js
│   │   └── server.js
│   └── test/              unit + API tests (node:test)
└── frontend/
    └── src/
        ├── api/           fetch client + React Query hooks
        ├── uploads/       the upload queue: runs in the background, saved in IndexedDB
        ├── pages/         Library, Upload, Book, Author(s), Premium, Reader, Login/Register
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
| `ADMIN_EMAILS` | Comma-separated emails that become admins (manage books, categories, premium books, quotes, popups, payments, readers) |
| `SUPER_ADMIN_EMAILS` | Comma-separated emails of super admins, who also manage admins and site settings. Set at least one: without a super admin, nobody can change roles |
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
   - `ISA_HUB_URL`: the Hub API's address, e.g. `https://isa-tech-hub-api.onrender.com`
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

Admins create popups under **Admin → Popups** (with a live preview) and see payments under **Admin → Payments**. Each payment records a **purpose**: `donation` by default, a name set on the popup (e.g. `premium`), or `book` when it unlocks a premium book. To unlock a paid feature later, check `await Payment.hasPaid(userId, 'premium', minAmount)` on the backend. The purpose (and a book's price) always comes from what the admin set up, never from the browser.

### 6b. Premium books

Under **Admin → Premium**, search for a book, set the price in KES (within `MPESA_MIN_AMOUNT`–`MPESA_MAX_AMOUNT`) and tick the chapters to lock. PDFs are split by page, so a PDF with an outline lists its top-level chapters with their page ranges. "Keep the first N free" locks everything after a free preview. Admins also reach this from a book's page (**Premium settings**).

- **What readers get.** The library and book page show a crown and the price; locked chapters show a lock in the contents. Opening one shows the unlock box: the reader enters their M-Pesa number, confirms the PIN prompt, and the book unlocks as soon as M-Pesa (directly or through ISA Tech Hub) confirms. Audio skips locked chapters.
- **What the server enforces.** Locked chapters' text and narration are never sent (`402` from `/api/books/:id/sections/:index`, and empty in the offline download). The original PDF/EPUB file and the audiobook contain every chapter, so they are only sent to readers who can open the whole book; until then the reader uses the text view.
- **Private file addresses.** Cloudinary URLs are public. When a book becomes premium, A-Read renames its original file, its audiobook and its locked chapters' narration on Cloudinary to unguessable names (new narration and audiobooks get them from the start). If Cloudinary can't be reached, the book is not made premium and the admin sees why.
- **Turning premium off** frees the book for everyone and keeps the price and chapters for next time. Readers who paid keep access if it is turned back on.
- **Premium Pass.** At the top of **Admin → Premium**, set a price and a number of days (1-366) and press **Put on sale**. A reader who buys it can open every premium book, including ones made premium later, until it runs out; buying again before then adds the days on the end. Pass payments show under **Admin → Payments** with the purpose `pass`, and the panel shows what passes have sold and how many readers hold one now. **Stop selling** takes it off sale; passes already bought last their full time.

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

**Sharing and SEO on Vercel.** `frontend/api/` holds four small Vercel Functions, routed by `frontend/vercel.json`:

- `/share/books/:id` returns Open Graph tags (title, author, cover) so WhatsApp and other apps show a preview, then opens the book page.
- `/sitemap.xml` is a sitemap index pointing at `/sitemaps/pages.xml` (home, `/authors`, each category), `/sitemaps/authors-1.xml` (every author page) and `/sitemaps/books-1.xml` (every book page, with its cover for image search). Each file holds up to 10,000 addresses; `-2`, `-3`… follow as the library grows.
- `/robots.txt` points crawlers at the sitemap.
- `/indexnow-key.txt` serves the IndexNow key (see below).

All of them read `VITE_API_URL` to reach the backend. On Render's free plan the backend sleeps, so the first preview or sitemap fetch after a quiet period can be slow (a sitemap file then answers "try again shortly" rather than an empty list).

**Getting authors and books into Google.**

1. In [Google Search Console](https://search.google.com/search-console), add your site (e.g. `https://a-read.vercel.app`) and verify it.
2. Under **Sitemaps**, submit `https://<your-site>/sitemap.xml` once. Search Console then shows the pages, authors and books sitemaps separately, with how many of each are indexed.
3. That's all for new uploads: every new book and every new author appears in the sitemap straight away with a fresh `lastmod`, and Google rereads sitemaps on its own schedule (Google retired its "ping" address in 2023; an accurate sitemap is now the way to tell it about new pages). To hurry one page along, paste its address into Search Console's **URL inspection** and press **Request indexing**.
4. Optional, for Bing (which also feeds DuckDuckGo, Yahoo and ChatGPT search), Yandex and other IndexNow engines: set `INDEXNOW_KEY` on the backend (any made-up 8-128 character string) and make sure `FRONTEND_URL` is the live `https://` site. Each upload, edit or deletion then announces the book's page and its authors' pages within seconds.

**Reading position.** The reader saves the section, sentence, EPUB location and audiobook time (debounced, and again when the tab is hidden). The library's "Continue reading" row comes from this.

## Tests

```bash
npm test     # unit tests: text splitting, PDF/EPUB/TXT extraction, SSML chunking
MONGODB_URI_TEST=mongodb://127.0.0.1:27017/a-read-test npm test   # also runs the API tests
```

The API tests drive the real Express app against a real database, with Cloudinary and Google stubbed out. They cover auth, uploads of all three formats, search and filters, permissions, progress, bookmarks, audiobooks, narration jobs, deletion, support popups, M-Pesa payments, both direct (Daraja is stubbed) and through ISA Tech Hub (a stand-in Hub server), categories, premium books (locking, file renaming, unlocking by payment), the Premium Pass (buying, stacking, running out), super admin roles and site settings, book quotes (no repeats, a different book each time), waking ISA Tech Hub, upload keys (a re-sent upload is added once, even when both copies arrive together), an upload cut off half-way, author pages and sitemaps, IndexNow announcements, ratings and reviews, related books and the Featured shelf. **Use a throwaway database:** the tests drop it.

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
| `GET /api/books?q=&format=&audio=&tag=&category=&author=&access=free\|premium&featured=&mine=&sort=recent\|title\|author\|rating&page=` | Library search & filters (`category` is the slug, or `none` for books without one; `author` is an author page's slug) |
| `POST /api/books` (multipart: `file`, optional `cover`, `title`, `author`, `description`, `language`, `tags`, `category`, `uploadKey`) | Upload a book. Sending the same `uploadKey` again returns the book already added instead of a copy |
| `GET /api/books/uploads?keys=` | Which of my upload keys already reached the library (used after a reload) |
| `GET /api/books/:id/related` (public) | More by the same authors, and similar books |
| `GET /api/books/:id/reviews` (public), `PUT / DELETE /api/books/:id/reviews/mine` (`rating` 1-5, `text`), `DELETE /api/books/:id/reviews/:reviewId` (admin) | Ratings and reviews |
| `GET /api/authors?q=&sort=name\|books\|recent&page=` (public), `GET /api/authors/:slug` (public), `PUT /api/authors/:slug` (admin; `bio`) | Authors and their pages |
| `GET / PATCH / DELETE /api/books/:id` | Book details, edit, delete |
| `PUT /api/books/:id/cover` (multipart `cover`) | Replace the cover |
| `GET /api/books/:id/sections`, `GET /api/books/:id/sections/:index` | Table of sections (each with `locked`); one section's text + narration timings (`402` while locked) |
| `POST / DELETE /api/books/:id/audiobook` (multipart `audio`) | Attach / remove an audiobook |
| `GET / POST / DELETE /api/books/:id/narration` (`?purge=true` deletes audio) | Cloud narration status, start/resume, stop |
| `GET /api/tts/status`, `GET /api/tts/voices?language=en` | Narration availability and voices |
| `GET /api/progress`, `GET / PUT /api/progress/:bookId` | Continue reading; per-book position |
| `GET /api/admin/stats`, `GET /api/admin/users?q=`, `PATCH / DELETE /api/admin/users/:id` | Admin only: stats, readers, account removal (`?deleteBooks=true`). Changing a role, or removing an admin, needs a super admin |
| `GET /api/categories` (public), `POST /api/categories`, `PATCH / DELETE /api/categories/:id` (`name`, `description`, `keywords`) | Categories with book counts; admin only to change |
| `GET / POST /api/categories/starters` | Admin only: common categories not in the library yet; add some |
| `POST /api/categories/suggest` (`scope`: `uncategorized` \| `auto` \| `all`) | Admin only: a suggested category for each book, worked out from the book (changes nothing) |
| `PUT /api/categories/books` (`assignments: [{ bookId, categoryId \| null }]`) | Admin only: file books under categories in bulk |
| `POST /api/quotes/next` (public; body `seen`, `lastBook`) | The quote to show now: not seen yet, from a different book than the last |
| `GET / POST /api/quotes`, `PATCH / DELETE /api/quotes/:id`, `POST /api/quotes/classics` | Admin only: manage quotes; add the built-in classics back |
| `GET /api/system/config` (public), `GET /api/system/wake` (public) | Site settings the app needs; wake the API and ISA Tech Hub |
| `GET /api/system/status`, `PUT /api/system/settings` | Super admin only: service health and counts; change site settings |
| `GET /api/admin/premium`, `GET / PUT /api/admin/books/:id/premium` (`enabled`, `price`, `lockedSections`) | Admin only: premium books and sales; one book's price and locked chapters |
| `GET / PUT /api/admin/pass` (`enabled`, `price`, `days`) | Admin only: the Premium Pass and what it has sold |
| `PUT /api/admin/books/:id/featured` (`days`, 0 to stop) | Admin only: the home page's Featured shelf |
| `GET /api/payments/pass` (public) | The Premium Pass: on sale or not, price, days, and until when the signed-in reader has it |
| `GET /share/books/:id` (public) | Link-preview page that redirects to the book |
| `GET /sitemap.xml`, `GET /sitemaps/:file`, `GET /robots.txt`, `GET /indexnow-key.txt` (public) | Search engines |
| `GET / POST /api/books/:id/bookmarks`, `PATCH / DELETE /api/bookmarks/:id` | Private bookmarks |
| `GET /api/promotions/active` (public) | The support popup to show this visitor now, if any |
| `GET / POST /api/promotions`, `PATCH / DELETE /api/promotions/:id` | Admin only: schedule, edit, pause and delete popups |
| `GET /api/payments/config` (public), `POST /api/payments/stk` (public; with `bookId` it unlocks a premium book for the signed-in reader at the book's price; with `pass: true` it buys the Premium Pass at the admins' price), `GET /api/payments/:id` (public) | M-Pesa settings, start an STK Push, poll its status |
| `POST /api/payments/hub-webhook` | ISA Tech Hub's signed webhook (`ISA-Signature` header) |
| `POST /api/payments/mpesa/callback/:secret` | Safaricom's result callback (direct Daraja only) |
| `GET /api/payments?status=` | Admin only: payments and totals |

## Ideas borrowed from other book platforms

What A-Read now does, and where the idea comes from:

| Feature | Seen on | Why it helps readers | Why it helps the library |
| --- | --- | --- | --- |
| Uploads that survive refreshes and keep going in the background | Google Drive, Wattpad | Nothing is lost on a flaky connection | More books get added; less mobile data wasted re-sending |
| Author pages with bios | Goodreads, Amazon Author Central | Find everything by a writer | Each author is a page Google can show for a search of their name |
| Ratings and reviews, "Top rated" | Goodreads, Amazon, Google Play Books | Pick good books quickly | Social proof sells premium books; reviews are fresh text for search engines, and star ratings can appear in Google results |
| Premium Pass (every premium book for N days) | Scribd/Everand, Kindle Unlimited, Storytel | One price for the whole premium shelf | Recurring income alongside single-book sales |
| Featured shelf | Amazon sponsored listings, Okadabooks | Curated picks on the home page | Placements can be sold to authors and publishers |
| "More by this author", "You may also like" | Amazon, Goodreads | Something to read next | More pages read per visit; more premium books seen |

**Recommended next**, in rough order of value for effort:

1. **Follow an author** (Wattpad, Amazon): readers follow an author page and get an email (Brevo is already set up) when a new book of theirs is uploaded. Brings readers back.
2. **Want to read shelf** (Goodreads, Kobo wishlist): a one-tap list per reader, with an email when a wished-for premium book is discounted.
3. **Limited-time discounts** on premium books (Kobo deals): a sale price with an end date, shown as a countdown. Urgency lifts sales.
4. **Reading streaks and yearly goals** (Goodreads Reading Challenge, Kindle insights): reading progress is already tracked; a goal and a streak keep readers coming back.
5. **Revenue share for authors** (Okadabooks, Smashwords): let authors sell their own books, the platform keeping a commission. Needs payouts (M-Pesa B2C) and author verification.
6. **Gift a book or a pass** (Kindle, Audible): pay for someone else by phone number.
7. **Server-rendered book and author pages for crawlers**: Google runs the app's JavaScript before indexing, but serving the title, description and structured data in the first HTML response (a Vercel Function, like the share page) makes indexing faster and helps other search engines and AI assistants.

## Limitations

- **Scanned PDFs** are images of pages with no text layer, so they can be viewed but not read aloud (unless you attach an audiobook). OCR is not included.
- **Device voices** depend on the browser and OS. Chrome, Edge and Safari have good voices; some Linux browsers have none.
- **Audiobook audio** isn't synced to the text: you get one timeline for the whole file.
- **Narration jobs** run inside the API process. For heavy use, move them to a job queue (e.g. BullMQ).
- **Premium files** are protected by unguessable Cloudinary addresses, not signed or expiring URLs, so a reader who unlocked a book could share its file link. Offline copies saved on a device before a book became premium stay on that device.
- The login token is kept in `localStorage`. That's simple and works across domains, but an HttpOnly cookie is stronger against XSS if you host the frontend and API on the same domain.
