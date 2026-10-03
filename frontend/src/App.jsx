import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import AdminPage from './pages/AdminPage.jsx';
import AuthorPage from './pages/AuthorPage.jsx';
import AuthorsPage from './pages/AuthorsPage.jsx';
import BookPage from './pages/BookPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import { LoginPage, RegisterPage, VerifyEmailPage } from './pages/AuthPages.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import PremiumPage from './pages/PremiumPage.jsx';
import { PageLoader } from './components/Feedback.jsx';
import RequiredPage from './pages/RequiredPage.jsx';
import SupportPage from './pages/SupportPage.jsx';
import UploadPage from './pages/UploadPage.jsx';

// The reader pulls in pdf.js and epub.js, so it loads on demand.
const ReaderPage = lazy(() => import('./pages/ReaderPage.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route element={<Layout />}>
        {/* Public: anyone (and search engines) can browse the catalogue. */}
        <Route index element={<LibraryPage />} />
        <Route path="/books/:id" element={<BookPage />} />
        <Route path="/authors" element={<AuthorsPage />} />
        <Route path="/authors/:slug" element={<AuthorPage />} />
        <Route path="/library" element={<Navigate to="/" replace />} />
        <Route path="/support" element={<SupportPage />} />
        <Route path="/premium" element={<PremiumPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/required" element={<RequiredPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        {/* The reader is full-screen, outside the main layout. */}
        <Route
          path="/read/:id"
          element={
            <Suspense fallback={<PageLoader label="Opening reader…" />}>
              <ReaderPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}
