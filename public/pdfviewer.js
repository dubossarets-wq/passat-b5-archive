// Простой просмотрщик PDF на pdf.js: страницы друг под другом, страницы рисуются по мере прокрутки.
import * as pdfjsLib from '/vendor/pdfjs/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/build/pdf.worker.min.mjs';

const root = document.getElementById('pdf-pages');
const scroll = document.getElementById('pdf-scroll');
const info = document.getElementById('pdf-info');
const errBox = document.getElementById('pdf-error');
let zoom = 1;
let pdf = null;
let observer = null;
const rendered = new Map();

function fail(msg) {
  errBox.textContent = msg;
  errBox.hidden = false;
  info.textContent = '';
}

async function renderPage(canvas, n) {
  if (rendered.get(n) === zoom) return;
  rendered.set(n, zoom);
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const cssWidth = scroll.clientWidth * zoom;
  const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  page.cleanup();
}

async function layout() {
  observer?.disconnect();
  rendered.clear();
  root.textContent = '';
  root.style.width = `${zoom * 100}%`;
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) renderPage(e.target, Number(e.target.dataset.n)).catch(() => {});
    }
  }, { rootMargin: '600px 0px' });
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const v = page.getViewport({ scale: 1 });
    const c = document.createElement('canvas');
    c.dataset.n = String(n);
    c.width = 10;
    c.height = Math.round(10 * (v.height / v.width));
    root.appendChild(c);
    observer.observe(c);
  }
  info.textContent = `Страниц: ${pdf.numPages} · масштаб ${Math.round(zoom * 100)}%`;
}

async function main() {
  try {
    pdf = await pdfjsLib.getDocument({
      url: root.dataset.src,
      cMapUrl: '/vendor/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
      wasmUrl: '/vendor/pdfjs/wasm/',
    }).promise;
    await layout();
  } catch (e) {
    fail(`Не удалось открыть PDF: ${e.message || e}. Файл можно скачать кнопкой выше.`);
  }
}

document.getElementById('pdf-zoom-in').addEventListener('click', () => { if (pdf && zoom < 4) { zoom += 0.5; layout(); } });
document.getElementById('pdf-zoom-out').addEventListener('click', () => { if (pdf && zoom > 1) { zoom -= 0.5; layout(); } });

main();
