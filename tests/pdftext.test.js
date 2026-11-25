import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractPdfText } from '../src/lib/pdftext.js';
import { makeTempDir, rmDir, makePdf } from './helpers.js';

test('текст извлекается из PDF с текстовым слоем', async () => {
  const dir = makeTempDir('pdf');
  try {
    const file = path.join(dir, 'a.pdf');
    fs.writeFileSync(file, makePdf('Timing chain tensioner (ARG)'));
    const text = await extractPdfText(file);
    assert.match(text, /Timing chain tensioner/);
  } finally {
    rmDir(dir);
  }
});

test('битый PDF даёт ошибку, а не зависание', async () => {
  const dir = makeTempDir('pdf');
  try {
    const file = path.join(dir, 'bad.pdf');
    fs.writeFileSync(file, 'это не PDF');
    await assert.rejects(() => extractPdfText(file));
  } finally {
    rmDir(dir);
  }
});
