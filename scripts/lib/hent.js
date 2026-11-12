// Felles hjelpefunksjoner for oppdateringsscriptet: HTTP-henting og tekstuttrekk.

const UA = 'bompenge-kalkulator/1.0 (dataoppdatering)';

export async function hent(url, { headers = {}, forsok = 3, timeoutMs = 30000 } = {}) {
  let sisteFeil;
  for (let i = 0; i < forsok; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'X-Client': 'bompenge-kalkulator', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      sisteFeil = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw sisteFeil;
}

export async function hentJson(url, opts = {}) {
  const tekst = await hent(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  return JSON.parse(tekst);
}

const ENTITETER = {
  nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', apos: "'",
  aring: 'å', Aring: 'Å', oslash: 'ø', Oslash: 'Ø', aelig: 'æ', AElig: 'Æ',
  ndash: '–', mdash: '—', eacute: 'é', laquo: '«', raquo: '»',
};

export function dekodEntiteter(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (n in ENTITETER ? ENTITETER[n] : m));
}

/** Gjør HTML om til «celle|celle|celle»-tekst som er enkel å lese med regex. */
export function tilTekst(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<[^>]+>/g, '|');
  t = dekodEntiteter(t).replace(/\s+/g, ' ');
  return t.replace(/(\|\s*)+/g, '|');
}

/** «25,60», «kr 22,00», «11.20», «38 kr» -> tall. Returnerer null hvis det ikke er et tall. */
export function tall(s) {
  if (s == null) return null;
  const m = String(s).replace(/\s/g, '').match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  return Number(m[0].replace(',', '.'));
}

export const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

/** Normaliserer stasjonsnavn for sammenligning på tvers av kilder. */
export function normNavn(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b(e|rv|fv|kv)\.?\s*\d+\b/g, ' ')
    .replace(/[^a-zæøå0-9]+/g, ' ')
    .replace(/\b(veien|vegen|veg|vei)\b/g, 'v')
    .trim();
}

/** Kjører oppgaver med begrenset samtidighet. */
export async function parallelt(elementer, grense, fn) {
  const ut = new Array(elementer.length);
  let neste = 0;
  async function arbeider() {
    while (neste < elementer.length) {
      const i = neste++;
      ut[i] = await fn(elementer[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(grense, elementer.length) }, arbeider));
  return ut;
}
