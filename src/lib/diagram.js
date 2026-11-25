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
  const rowH = 46;
  const top = 40;
  const boxX = 10;
  const boxW = 150;
  const lineX1 = boxX + boxW;
  const lineX2 = 430;
  const textX = 440;
  const height = top + pins.length * rowH + 20;
  let s = `<svg class="diagram" viewBox="0 0 860 ${height}" role="img" aria-label="${esc(`Распиновка: ${data.component || ''}`)}" xmlns="http://www.w3.org/2000/svg">`;
  s += `<rect x="${boxX}" y="${top - 16}" width="${boxW}" height="${pins.length * rowH + 12}" rx="10" fill="#f0f4ff" stroke="#0090ff" stroke-width="2"/>`;
  s += `<text x="${boxX + boxW / 2}" y="${top - 22}" text-anchor="middle" class="d-title">${esc(data.component || 'Разъём')}</text>`;
  pins.forEach((p, i) => {
    const y = top + i * rowH + rowH / 2 - 6;
    s += `<rect x="${boxX + boxW - 54}" y="${y - 15}" width="44" height="30" rx="6" fill="#ffffff" stroke="#0090ff"/>`;
    s += `<text x="${boxX + boxW - 32}" y="${y + 6}" text-anchor="middle" class="d-pin">${esc(p.pin ?? '')}</text>`;
    s += wireLine(lineX1, y, lineX2, y, p.wire);
    s += `<text x="${lineX1 + 12}" y="${y - 10}" class="d-small">${esc(p.wire || 'цвет не указан')}</text>`;
    const lines = wrap(p.signal, 46);
    lines.slice(0, 2).forEach((ln, k) => { s += `<text x="${textX}" y="${y - 2 + k * 16}" class="d-label">${esc(ln)}</text>`; });
    if (p.to) s += `<text x="${textX}" y="${y + 14 + (lines.length > 1 ? 14 : 0)}" class="d-small">→ ${esc(String(p.to).slice(0, 70))}</text>`;
  });
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
  const colW = 300;
  const boxW = 230;
  const boxH = 64;
  const gap = 58;
  const top = 46;
  const maxNodes = Math.max(1, ...paths.map((p) => (p.nodes ?? []).length));
  const height = top + maxNodes * (boxH + gap);
  const width = Math.max(1, paths.length) * colW + 20;
  let s = `<svg class="diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="Схема цепи" xmlns="http://www.w3.org/2000/svg">`;
  paths.forEach((path, ci) => {
    const cx = 20 + ci * colW + boxW / 2;
    const x = cx - boxW / 2;
    s += `<text x="${cx}" y="24" text-anchor="middle" class="d-title">${esc(path.label ?? '')}</text>`;
    const nodes = path.nodes ?? [];
    nodes.forEach((n, i) => {
      const y = top + i * (boxH + gap);
      if (i < nodes.length - 1) {
        s += wireLine(cx, y + boxH, cx, y + boxH + gap, n.wire);
        if (n.wire) s += `<text x="${cx + 12}" y="${y + boxH + gap / 2 + 5}" class="d-small">${esc(n.wire)}</text>`;
      }
      const st = KIND_STYLE[n.kind] ?? KIND_STYLE.connector;
      if (n.kind === 'ground') {
        s += `<line x1="${cx - 30}" y1="${y + 10}" x2="${cx + 30}" y2="${y + 10}" stroke="#222" stroke-width="4"/>`;
        s += `<line x1="${cx - 20}" y1="${y + 20}" x2="${cx + 20}" y2="${y + 20}" stroke="#222" stroke-width="4"/>`;
        s += `<line x1="${cx - 10}" y1="${y + 30}" x2="${cx + 10}" y2="${y + 30}" stroke="#222" stroke-width="4"/>`;
        s += `<text x="${cx}" y="${y + 54}" text-anchor="middle" class="d-label">${esc(n.name || 'Масса')}</text>`;
        return;
      }
      s += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="10" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2"/>`;
      s += `<text x="${x + 10}" y="${y + 16}" class="d-kind" fill="${st.stroke}">${esc(st.label)}</text>`;
      wrap(n.name, 28).slice(0, 2).forEach((ln, k) => { s += `<text x="${x + 10}" y="${y + 36 + k * 17}" class="d-label">${esc(ln)}</text>`; });
      if (n.pin) s += `<text x="${x + boxW - 8}" y="${y + 16}" text-anchor="end" class="d-small">конт. ${esc(n.pin)}</text>`;
    });
  });
  return raw(`${s}</svg>`);
}

export function renderDiagram(type, data) {
  return type === 'pinout' ? renderPinout(data) : renderCircuit(data);
}
