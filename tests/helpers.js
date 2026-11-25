import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { ROOT } from '../src/config.js';

// Временная папка внутри проекта (tmp/ исключена из git), чтобы не писать за пределы проекта.
export function makeTempDir(prefix = 't') {
  const base = path.join(ROOT, 'tmp');
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${prefix}-`));
}

export function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

// Минимальный валидный PDF с одной строкой латинского текста (для проверки извлечения текста).
export function makePdf(text) {
  const esc = text.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 18 Tf 50 100 Td (${esc}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// Тело multipart/form-data: fields — пары [имя, значение], files — {field, filename, type, data}.
export function multipart(fields = [], files = []) {
  const boundary = `----test${Math.random().toString(16).slice(2)}`;
  const parts = [];
  for (const [name, value] of fields) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    parts.push(Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`),
      f.data,
      Buffer.from('\r\n'),
    ]));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

// Минимальный ZIP без сжатия, с произвольными именами (в том числе вредными) — для проверки защиты при восстановлении.
export function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cdBuf, end]);
}

export function sha256OfDir(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full).replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

export { os };
