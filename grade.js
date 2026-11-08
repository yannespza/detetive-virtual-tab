// Conferência das respostas por palavras-chave, tolerante a erros de digitação.
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (t) => norm(t).split(' ').filter(Boolean);

// distância de edição com troca de letras vizinhas (Damerau)
function dist(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
const sorted = (s) => [...s].sort().join('');
// grafia "pelo som": jelo = gelo, Sims = Simms, Holoway = Holloway
const sound = (w) => w.replace(/ph/g, 'f').replace(/(ch|sh)/g, 'x').replace(/qu/g, 'c').replace(/k/g, 'c').replace(/y/g, 'i').replace(/w/g, 'v')
  .replace(/z/g, 's').replace(/j([ei])/g, 'g$1').replace(/^h/, '').replace(/(.)\1+/g, '$1');

// a palavra digitada "bate" com a palavra-chave? (a chave pode ser só o começo da palavra)
function wordMatches(key, word, strict) {
  if (key[0] === '=') return word.startsWith(key.slice(1));   // chave exata, sem tolerância
  if (/^\d+$/.test(key)) return word === key || word.startsWith(key) && /^\d+[a-z]*$/.test(word) && word.replace(/[a-z]+$/, '') === key;
  if (word.startsWith(key)) return true;
  if (!strict) { const sk = sound(key), sw = sound(word); if (sw.startsWith(sk) && sk.length >= 3) return true; }
  const L = key.length;
  const tol = strict ? (L >= 6 ? 1 : 0) : (L <= 4 ? 0 : L <= 6 ? 1 : 2);
  for (const len of [L - 1, L, L + 1]) {
    if (len < 1 || len > word.length) continue;
    const piece = word.slice(0, len), dd = dist(key, piece);
    if (dd <= tol) return true;
    if (!strict && L >= 5) {
      if (len === L && sorted(piece) === sorted(key)) return true;           // letras trocadas de lugar
      if (L >= 6 && dd <= 2 && piece[0] === key[0]) return true;             // nome longo com 2 deslizes
    }
  }
  return false;
}
function hasKey(answerWords, key, strict) {
  const kw = key[0] === '=' ? ['=' + norm(key.slice(1))] : words(key); if (!kw.length) return false;
  for (let i = 0; i + kw.length <= answerWords.length; i++) {
    if (kw.every((k, j) => wordMatches(k, answerWords[i + j], strict))) return true;
  }
  return false;
}

export function grade(answer, item) {
  const aw = words(answer);
  if (!aw.length) return { st: 'wrong', msg: 'Sem resposta.' };
  if (!item || !item.need) return { st: 'manual' };
  if ((item.deny || []).some((k) => hasKey(aw, k, true))) return { st: 'wrong', msg: 'Errada ou com mais de uma opção.' };
  const hits = item.need.filter((g) => g.some((k) => hasKey(aw, k, false))).length;
  if (hits === item.need.length) return { st: 'ok', msg: 'Correta!' };
  if (hits > 0) return { st: 'partial', msg: 'Incompleta: faltou alguma coisa importante.' };
  return { st: 'wrong', msg: 'Errada.' };
}
