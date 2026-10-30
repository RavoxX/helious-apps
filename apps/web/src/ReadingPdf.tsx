import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
export function ReadingPdf({ bytes, label }: { bytes: Uint8Array; label: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let closed = false;
    setError('');
    setBusy(true);
    setPdf(null);
    setPage(1);
    const task = getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      useWasm: false,
      disableFontFace: true,
      useSystemFonts: true,
      enableXfa: false,
      maxImageSize: 16_000_000,
      canvasMaxAreaInBytes: 16_000_000,
      verbosity: 0,
    });
    void task.promise
      .then((document) => {
        if (closed) return;
        if (document.numPages > 500) {
          setError('PDF previews are limited to 500 pages. Download this file to read it.');
          void task.destroy();
          return;
        }
        setPdf(document);
      })
      .catch(() => {
        if (!closed) {
          setError(
            'Unable to preview this PDF. Encrypted or unsupported files can be downloaded instead.',
          );
          setBusy(false);
        }
      });
    return () => {
      closed = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let closed = false;
    let render: RenderTask | undefined;
    setBusy(true);
    setError('');
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (closed || !canvas.current) return;
        const size = documentPage.getViewport({ scale: 1 });
        const scale = Math.min(
          1.5,
          1400 / Math.max(size.width, 1),
          Math.sqrt(4_000_000 / Math.max(size.width * size.height, 1)),
        );
        const viewport = documentPage.getViewport({ scale });
        if (
          !Number.isFinite(viewport.width) ||
          !Number.isFinite(viewport.height) ||
          viewport.width < 1 ||
          viewport.height < 1
        )
          throw new Error('Invalid page geometry');
        const target = canvas.current;
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        render = documentPage.render({ canvas: target, viewport });
        await render.promise;
        if (!closed) setBusy(false);
        documentPage.cleanup();
      })
      .catch(() => {
        if (!closed) {
          setError('This PDF page could not be rendered. Download the original instead.');
          setBusy(false);
        }
      });
    return () => {
      closed = true;
      render?.cancel();
    };
  }, [pdf, page]);
  return (
    <div className="reading-pdf" aria-label={`PDF viewer ${label}`}>
      <div className="reading-pdf-controls">
        <button
          type="button"
          disabled={!pdf || busy || page <= 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous page
        </button>
        <span>
          Page {page}
          {pdf ? ` of ${pdf.numPages}` : ''}
        </span>
        <button
          type="button"
          disabled={!pdf || busy || page >= pdf.numPages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next page
        </button>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          {busy && <p role="status">Rendering PDF page…</p>}
          <canvas ref={canvas} role="img" aria-label={`${label}, page ${page}`} />
        </>
      )}
    </div>
  );
}
