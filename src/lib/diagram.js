// Цвет провода по его названию — для цветной отметки в таблице распиновки.
// Понимает русские, английские и немецкие (VW) обозначения.
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
