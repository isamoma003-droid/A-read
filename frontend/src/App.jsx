import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import BookPage from './pages/BookPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import { LoginPage, RegisterPage } from './pages/AuthPages.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import { PageLoader } from './components/Feedback.jsx';
import UploadPage from './pages/UploadPage.jsx';

// The reader pulls in pdf.js and epub.js, so it loads on demand.
const ReaderPage = lazy(() => import('./pages/ReaderPage.jsx'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
        <Route element={<Layout />}>
          <Route index element={<LibraryPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/books/:id" element={<BookPage />} />
          <Route path="/library" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
