import fs from 'node:fs';
import path from 'node:path';
import yauzl from 'yauzl';
import { pipeline } from 'node:stream/promises';
import { makeTempDir } from './helpers.js';

// Достаёт один файл из ZIP во временную папку проекта (для проверок в тестах).
export function extractForTest(zipFile, name) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on('entry', (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (e2, rs) => {
          if (e2) return reject(e2);
          const out = path.join(makeTempDir('zipx'), path.basename(name));
          pipeline(rs, fs.createWriteStream(out)).then(() => { zip.close(); resolve(out); }, reject);
        });
      });
      zip.on('end', () => reject(new Error(`В архиве нет ${name}`)));
      zip.readEntry();
    });
  });
}
