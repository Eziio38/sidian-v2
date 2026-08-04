"use client";

import { useEffect, useState } from "react";

import styles from "./attachment-preview-dialog.module.css";

type PdfDocumentPreviewProps = {
  url: string;
  name: string;
  source?: Blob;
};

type PdfPreviewState =
  | { status: "loading"; pages: string[] }
  | { status: "ready"; pages: string[] }
  | { status: "error"; pages: string[] };

export function PdfDocumentPreview({
  url,
  name,
  source,
}: PdfDocumentPreviewProps) {
  const [state, setState] = useState<PdfPreviewState>({
    status: "loading",
    pages: [],
  });

  useEffect(() => {
    let cancelled = false;
    let loadingTask:
      | ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>
      | undefined;

    async function renderPdf() {
      setState({ status: "loading", pages: [] });
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const data = new Uint8Array(
          source
            ? await source.arrayBuffer()
            : await (await fetch(url)).arrayBuffer(),
        );
        loadingTask = pdfjs.getDocument({ data });
        const pdf = await loadingTask.promise;
        const renderedPages: string[] = [];
        const pixelRatio =
          typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
        const scale = Math.min(2.4, Math.max(1.5, pixelRatio * 1.25));

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("canvas_unavailable");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          renderedPages.push(canvas.toDataURL("image/png"));
        }

        if (!cancelled) {
          setState({ status: "ready", pages: renderedPages });
        }
      } catch {
        if (!cancelled) {
          setState({ status: "error", pages: [] });
        }
      }
    }

    void renderPdf();
    return () => {
      cancelled = true;
      void loadingTask?.destroy();
    };
  }, [source, url]);

  return (
    <div
      className={styles.pdfPreview}
      data-testid="pdf-document-preview"
      data-status={state.status}
      aria-busy={state.status === "loading"}
    >
      {state.status === "loading" ? (
        <p className={styles.pdfStatus} role="status">
          Préparation de la facture…
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className={styles.pdfStatus} role="alert">
          Impossible d’afficher cette facture.
        </p>
      ) : null}
      {state.pages.map((page, index) => (
        // eslint-disable-next-line @next/next/no-img-element -- rendu PDF local
        <img
          key={`${name}-${index + 1}`}
          src={page}
          alt={`${name}, page ${index + 1}`}
          className={styles.pdfPage}
        />
      ))}
    </div>
  );
}
