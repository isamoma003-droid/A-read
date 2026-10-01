import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { ErrorMessage, Spinner } from '../components/Feedback.jsx';
import { usePdfSource } from '../utils/bookFile.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();

export default function PdfView({ file, pageNumber, pageCount, onPageChange, zoom, onZoom, caption }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(700);
  const { source, error } = usePdfSource(file);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.min(entry.contentRect.width - 16, 900)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="pdf-view" ref={wrap}>
      <div className="page-toolbar">
        <button type="button" className="icon-button" onClick={() => onPageChange(pageNumber - 1)} disabled={pageNumber <= 1} title="Previous page">
          <ChevronLeft size={18} />
          <span className="sr-only">Previous page</span>
        </button>
        <span className="page-count">
          Page {pageNumber} of {pageCount}
        </span>
        <button type="button" className="icon-button" onClick={() => onPageChange(pageNumber + 1)} disabled={pageNumber >= pageCount} title="Next page">
          <ChevronRight size={18} />
          <span className="sr-only">Next page</span>
        </button>
        <span className="toolbar-divider" />
        <button type="button" className="icon-button" onClick={() => onZoom(Math.max(0.5, zoom - 0.1))} title="Zoom out">
          <Minus size={16} />
          <span className="sr-only">Zoom out</span>
        </button>
        <span className="page-count">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button" onClick={() => onZoom(Math.min(2.5, zoom + 0.1))} title="Zoom in">
          <Plus size={16} />
          <span className="sr-only">Zoom in</span>
        </button>
      </div>
      {error && <ErrorMessage>Could not download this PDF: {error.message}</ErrorMessage>}
      {!source && !error && <Spinner label="Downloading PDF…" />}
      {source && (
      <Document
        file={source}
        className="pdf-document"
        loading={<Spinner label="Loading PDF…" />}
        error={
          <ErrorMessage>
            The PDF couldn't be loaded. If you run this server, make sure &quot;Allow delivery of PDF and ZIP files&quot; is
            on in your Cloudinary security settings.
          </ErrorMessage>
        }
      >
        <Page pageNumber={pageNumber} width={Math.max(200, width * zoom)} renderAnnotationLayer={false} loading={<Spinner />} />
      </Document>
      )}
      {caption}
    </div>
  );
}
