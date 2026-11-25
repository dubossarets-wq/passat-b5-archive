// Рисование собственных схем (SVG) по фактам из seed/diagrams: распиновки и цепи.
import { esc, raw } from './html.js';

// Цвета проводов: русские, английские и немецкие (VW) обозначения.
const COLORS = [
  [/^(черн|black|sw$|bk$)/, '#222222'],
  [/^(коричн|brown|br$|bn$)/, '#7b4a12'],
  [/^(красн|red|ro$|rt$|rd$)/, '#d32f2f'],
  [/^(оранж|orange|or$|og$)/, '#f57c00'],
  [/^(желт|жёлт|yellow|ge$|ye$)/, '#f2c200'],
  [/^(зел|green|gn$)/, '#2e7d32'],
  [/^(син|blue|bl$|bu$)/, '#1565c0'],
  [/^(голуб|light ?blue|hbl$)/, '#4fb3e8'],
  [/^(фиолет|сирен|violet|purple|li$|vi$)/, '#7b1fa2'],
  [/^(сер|grey|gray|gr$|gy$)/, '#9e9e9e'],
  [/^(бел|white|ws$|wh$)/, '#ffffff'],
  [/^(роз|pink|rs$|pk$)/, '#ec407a'],
];

export function wireColors(text) {
  const parts = String(text ?? '').toLowerCase().replace(/ё/g, 'е').split(/[\s/\-+,]+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const c = COLORS.find(([re]) => re.test(p));
    if (c && !out.includes(c[1])) out.push(c[1]);
  }
  return out.slice(0, 2);
}

// Слишком длинный текст — на несколько строк.
function wrap(text, max) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function wireLine(x1, y1, x2, y2, colorText) {
  const cols = wireColors(colorText);
  const main = cols[0] ?? '#8b8d98';
  const dash = !cols.length ? ' stroke-dasharray="6 5"' : '';
  let s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${main}" stroke-width="6" stroke-linecap="round"${dash}/>`;
  if (main === '#ffffff') s = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#8b8d98" stroke-width="8" stroke-linecap="round"/>` + s;
  if (cols[1]) s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${cols[1]}" stroke-width="3" stroke-dasharray="10 10"/>`;
  return s;
}

/** Распиновка: слева разъём с номерами контактов, вправо — провода в цвет, сигнал и куда идёт. */
export function renderPinout(data) {
  const pins = data.pins ?? [];
  const W = 980;
  const boxX = 10;
  const boxW = 120;
  const lineX1 = boxX + boxW;
  const lineX2 = 400;
  const textX = 412;
  const maxChars = 62; // при ширине текста ~560 px
  // Высота строки зависит от длины подписи: 2 строки назначения + строка «куда идёт».
  const rows = pins.map((p) => {
    const sig = wrap(p.signal, maxChars).slice(0, 3);
    const to = p.to ? wrap(`→ ${p.to}`, maxChars + 12).slice(0, 2) : [];
    return { p, sig, to, h: Math.max(48, 18 + sig.length * 17 + to.length * 15) };
  });
  const titleLines = wrap(data.component || 'Разъём', 80);
  const top = 14 + titleLines.length * 22;
  const height = top + rows.reduce((a, r) => a + r.h, 0) + 16;
  let s = `<svg class="diagram" viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(`Распиновка: ${data.component || ''}`)}" xmlns="http://www.w3.org/2000/svg">`;
  titleLines.forEach((ln, k) => { s += `<text x="${boxX}" y="${20 + k * 22}" class="d-title">${esc(ln)}</text>`; });
  s += `<rect x="${boxX}" y="${top}" width="${boxW}" height="${height - top - 10}" rx="10" fill="#f0f4ff" stroke="#0090ff" stroke-width="2"/>`;
  let y0 = top;
  for (const r of rows) {
    const y = y0 + 26;
    s += `<rect x="${boxX + boxW - 54}" y="${y - 15}" width="44" height="30" rx="6" fill="#ffffff" stroke="#0090ff"/>`;
    s += `<text x="${boxX + boxW - 32}" y="${y + 6}" text-anchor="middle" class="d-pin">${esc(r.p.pin ?? '')}</text>`;
    s += wireLine(lineX1, y, lineX2, y, r.p.wire);
    s += `<text x="${lineX1 + 12}" y="${y - 10}" class="d-small">${esc(r.p.wire || 'цвет не указан')}</text>`;
    r.sig.forEach((ln, k) => { s += `<text x="${textX}" y="${y + 5 + k * 17}" class="d-label">${esc(ln)}</text>`; });
    r.to.forEach((ln, k) => { s += `<text x="${textX}" y="${y + 5 + r.sig.length * 17 + k * 15}" class="d-small">${esc(ln)}</text>`; });
    if (y0 > top) s += `<line x1="${textX}" y1="${y0}" x2="${W - 10}" y2="${y0}" stroke="#e0e1e6" stroke-width="1"/>`;
    y0 += r.h;
  }
  return raw(`${s}</svg>`);
}

const KIND_STYLE = {
  power: { fill: '#ffe9e9', stroke: '#d32f2f', label: 'питание' },
  fuse: { fill: '#fff6dd', stroke: '#b26a00', label: 'предохранитель' },
  relay: { fill: '#eef2ff', stroke: '#3f51b5', label: 'реле' },
  switch: { fill: '#eef2ff', stroke: '#3f51b5', label: 'выключатель' },
  ecu: { fill: '#e6f4ff', stroke: '#0090ff', label: 'блок управления' },
  connector: { fill: '#f5f5f5', stroke: '#8b8d98', label: 'разъём' },
  sensor: { fill: '#e8f7ee', stroke: '#2e7d32', label: 'датчик' },
  load: { fill: '#f3e8ff', stroke: '#7b1fa2', label: 'потребитель' },
  ground: { fill: '#f5f5f5', stroke: '#222222', label: 'масса' },
};

/** Цепь: каждая «дорожка» — колонка узлов сверху вниз, между ними провода в цвет. */
export function renderCircuit(data) {
  const paths = data.paths ?? [];
  const colW = 360;
  const boxW = 310;
  const gap = 56;
  const charsPerLine = 36;
  // Высота блока зависит от длины названия (до 4 строк).
  const layout = paths.map((p) => {
    const label = wrap(p.label ?? '', 34).slice(0, 3);
    const nodes = (p.nodes ?? []).map((n) => {
      const lines = n.kind === 'ground' ? [] : wrap(n.name, charsPerLine).slice(0, 4);
      return { n, lines, h: n.kind === 'ground' ? 64 : 30 + lines.length * 18 };
    });
    return { label, nodes };
  });
  const top = 16 + Math.max(1, ...layout.map((l) => l.label.length)) * 22;
  const colHeight = (l) => l.nodes.reduce((a, x) => a + x.h + gap, 0);
  const height = top + Math.max(80, ...layout.map(colHeight));
  const width = Math.max(1, paths.length) * colW + 10;
  let s = `<svg class="diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="Схема цепи" xmlns="http://www.w3.org/2000/svg">`;
  layout.forEach((col, ci) => {
    const x = 10 + ci * colW;
    const cx = x + boxW / 2;
    col.label.forEach((ln, k) => { s += `<text x="${x}" y="${22 + k * 22}" class="d-title">${esc(ln)}</text>`; });
    let y = top;
    col.nodes.forEach(({ n, lines, h: bh }, i) => {
      if (i < col.nodes.length - 1) {
        s += wireLine(cx, y + bh, cx, y + bh + gap, n.wire);
        if (n.wire) s += `<text x="${cx + 12}" y="${y + bh + gap / 2 + 5}" class="d-small">${esc(n.wire)}</text>`;
      }
      const st = KIND_STYLE[n.kind] ?? KIND_STYLE.connector;
      if (n.kind === 'ground') {
        s += `<line x1="${cx - 30}" y1="${y + 10}" x2="${cx + 30}" y2="${y + 10}" stroke="#222" stroke-width="4"/>`;
        s += `<line x1="${cx - 20}" y1="${y + 20}" x2="${cx + 20}" y2="${y + 20}" stroke="#222" stroke-width="4"/>`;
        s += `<line x1="${cx - 10}" y1="${y + 30}" x2="${cx + 10}" y2="${y + 30}" stroke="#222" stroke-width="4"/>`;
        s += `<text x="${cx}" y="${y + 54}" text-anchor="middle" class="d-label">${esc(String(n.name || 'Масса').slice(0, 40))}</text>`;
      } else {
        s += `<rect x="${x}" y="${y}" width="${boxW}" height="${bh}" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2"/>`;
        s += `<text x="${x + 10}" y="${y + 17}" class="d-kind" fill="${st.stroke}">${esc(st.label)}</text>`;
        if (n.pin) s += `<text x="${x + boxW - 8}" y="${y + 17}" text-anchor="end" class="d-small">конт. ${esc(String(n.pin).slice(0, 24))}</text>`;
        lines.forEach((ln, k) => { s += `<text x="${x + 10}" y="${y + 37 + k * 18}" class="d-label">${esc(ln)}</text>`; });
      }
      y += bh + gap;
    });
  });
  return raw(`${s}</svg>`);
}

export function renderDiagram(type, data) {
  return type === 'pinout' ? renderPinout(data) : renderCircuit(data);
}
