// Стеммер русского языка (алгоритм Snowball) и токенизация для поиска.
// Латиница, цифры и смешанные токены (коды P0102, номера VAG) не меняются, только нижний регистр.

const VOWELS = 'аеиоуыэюя';
const isVowel = (c) => VOWELS.includes(c);

const PERFECTIVE_1 = ['вшись', 'вши', 'в'];
const PERFECTIVE_2 = ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'];
const REFLEXIVE = ['ся', 'сь'];
const ADJECTIVE = ['ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом', 'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею'];
const PARTICIPLE_1 = ['ем', 'нн', 'вш', 'ющ', 'щ'];
const PARTICIPLE_2 = ['ивш', 'ывш', 'ующ'];
const VERB_1 = ['ете', 'йте', 'ешь', 'нно', 'ла', 'на', 'ли', 'ем', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'й', 'л', 'н'];
// Из оригинального Snowball убраны ен/ена/ено/ены: из-за них «замена» и «заменил» давали разные основы.
const VERB_2 = ['ейте', 'уйте', 'ила', 'ыла', 'ите', 'или', 'ыли', 'ило', 'ыло', 'ует', 'уют', 'ить', 'ыть', 'ишь', 'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ят', 'ит', 'ыт', 'ую', 'ю'];
const NOUN = ['иями', 'иям', 'иях', 'ями', 'ием', 'ией', 'ами', 'ией', 'ие', 'ье', 'еи', 'ии', 'ей', 'ой', 'ий', 'ям', 'ем', 'ам', 'ом', 'ах', 'ях', 'ию', 'ью', 'ия', 'ья', 'а', 'е', 'и', 'о', 'у', 'ы', 'ь', 'ю', 'я', 'ев', 'ов', 'й'];
const SUPERLATIVE = ['ейше', 'ейш'];
const DERIVATIONAL = ['ость', 'ост'];

const byLength = (arr) => [...arr].sort((a, b) => b.length - a.length);
const L = {
  p1: byLength(PERFECTIVE_1), p2: byLength(PERFECTIVE_2), refl: byLength(REFLEXIVE),
  adj: byLength(ADJECTIVE), part1: byLength(PARTICIPLE_1), part2: byLength(PARTICIPLE_2),
  v1: byLength(VERB_1), v2: byLength(VERB_2), noun: byLength(NOUN),
  sup: byLength(SUPERLATIVE), der: byLength(DERIVATIONAL),
};

// Отрезает окончание из списка в области rv; group1 требует перед окончанием «а» или «я».
function strip(word, rv, endings, needAYa) {
  for (const e of endings) {
    if (!word.endsWith(e)) continue;
    const start = word.length - e.length;
    if (start < rv) continue;
    if (needAYa) {
      const prev = word[start - 1];
      if (start - 1 < rv || (prev !== 'а' && prev !== 'я')) continue;
    }
    return word.slice(0, start);
  }
  return null;
}

function regions(word) {
  let rv = word.length;
  for (let i = 0; i < word.length; i++) {
    if (isVowel(word[i])) { rv = i + 1; break; }
  }
  const afterVN = (from) => {
    for (let i = from + 1; i < word.length; i++) {
      if (!isVowel(word[i]) && isVowel(word[i - 1])) return i + 1;
    }
    return word.length;
  };
  const r1 = afterVN(0);
  const r2 = afterVN(r1);
  return { rv, r1, r2 };
}

export function stemRu(input) {
  let w = input.replace(/ё/g, 'е');
  if (w.length < 3) return w;
  const { rv, r2 } = regions(w);
  let r;

  // Шаг 1
  r = strip(w, rv, L.p1, true) ?? strip(w, rv, L.p2, false);
  if (r != null) {
    w = r;
  } else {
    r = strip(w, rv, L.refl, false);
    if (r != null) w = r;

    // Причастие + прилагательное
    let a = strip(w, rv, L.adj, false);
    if (a != null) {
      w = a;
      const p = strip(w, rv, L.part2, false) ?? strip(w, rv, L.part1, true);
      if (p != null) w = p;
    } else {
      const v = strip(w, rv, L.v2, false) ?? strip(w, rv, L.v1, true);
      if (v != null) {
        w = v;
      } else {
        const n = strip(w, rv, L.noun, false);
        if (n != null) w = n;
      }
    }
  }

  // Шаг 2
  if (w.endsWith('и') && w.length - 1 >= rv) w = w.slice(0, -1);

  // Шаг 3: словообразовательные окончания в R2
  const d = strip(w, Math.max(rv, r2), L.der, false);
  if (d != null) w = d;

  // Шаг 4
  if (w.endsWith('нн') && w.length - 1 >= rv) {
    w = w.slice(0, -1);
  } else {
    const s = strip(w, rv, L.sup, false);
    if (s != null) {
      w = s;
      if (w.endsWith('нн')) w = w.slice(0, -1);
    } else if (w.endsWith('ь') && w.length - 1 >= rv) {
      w = w.slice(0, -1);
    }
  }
  return w;
}

const CYR = /^[а-яё]+$/;

export function stem(token) {
  let t = token.toLowerCase();
  if (!CYR.test(t)) return t;
  // Беглая гласная: «ремень» и «ремня» должны давать одну основу.
  if (t.length >= 5 && t.endsWith('ень')) t = t.slice(0, -3) + 'н';
  return stemRu(t);
}

export function tokenize(text) {
  return String(text ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

const FLEETING = /[бвгджзклмнпрстфхцчшщ](ок|ек|ец|ел)$/;

// Основа и, если у слова бывает беглая гласная (колодок/колодки, ошибок/ошибки, масел/масла),
// вторая основа без этой гласной. В индекс кладём обе, в запрос подставляем обе.
export function stemVariants(token) {
  const s = stem(token);
  if (s.length >= 5 && FLEETING.test(s)) return [s, s.slice(0, -2) + s.slice(-1)];
  return [s];
}

// Текст для индекса: основы слов через пробел.
export function indexText(text) {
  return tokenize(text).flatMap(stemVariants).join(' ');
}

// Нормализация номера детали: убрать всё, кроме букв и цифр, привести к верхнему регистру.
export function normPart(s) {
  return String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, '').toUpperCase();
}
