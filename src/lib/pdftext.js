// Извлечение текста из PDF (pdf.js, на сервере). Сканы без текстового слоя вернут пустую строку —
// для них нужен OCR (этап 2).
import fs from 'node:fs';

let pdfjsPromise = null;
function pdfjs() {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

export async function extractPdfText(absPath, { maxPages = 3000 } = {}) {
  const { getDocument } = await pdfjs();
  const data = new Uint8Array(await fs.promises.readFile(absPath));
  const task = getDocument({
    data,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const chunks = [];
    const pages = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      chunks.push(content.items.map((it) => it.str ?? '').join(' '));
      page.cleanup();
    }
    return chunks.join('\n').replace(/[ \t]+/g, ' ').trim();
  } finally {
    await task.destroy();
  }
}
