#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   notizie.mjs — la rassegna stampa

   Legge una ventina di feed (italiani e, se c'è chi traduce,
   anche i grandi americani), tiene ciò che parla di cinema con
   un soggetto riconoscibile, lo ordina in sezioni e lo scrive
   in data/notizie.json.

   La versione precedente teneva SOLO gli articoli che nominavano
   un film della tua libreria: usciva un muro fermo di dieci
   righe. Ora la libreria è un faro, non un filtro — illumina ciò
   che ti riguarda dentro una rassegna che copre tutto il cinema.

   Le sezioni:
     · apertura        la notizia del momento, con immagine
     · ultime          le ultime ore, in ordine di arrivo
     · temi            "se ne parla": stesso soggetto, più testate
     · radar           fuori dalla libreria, ma nei tuoi gusti
     · libreria        ciò che tocca i tuoi film
     · approfondimenti letture lunghe, analisi, interviste
     · curiosita       aneddoti, retroscena, classifiche
     · accaddeOggi     usciti oggi, dieci-settant'anni fa (TMDB)

   Chiave: TMDB_KEY (per trending e anniversari).

   La curatela — tradurre l'inglese, riscrivere titoli e sommari,
   dire perché una notizia conta — non passa da nessuna API a
   pagamento: la fa una routine di Claude Code ogni mattina, con
   l'account di chi usa l'app. Questo script prepara il lavoro
   (data/da-curare.json) e applica il risultato (data/curatela.json).
   Uso: node tools/notizie.mjs
   ══════════════════════════════════════════════════════════ */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API  = 'https://api.themoviedb.org/3';

/* ── le testate ──────────────────────────────────────────
   Italiane e americane. Le americane si leggono sempre, ma si
   mostrano solo una volta tradotte dalla curatela: in inglese
   non le vuoi leggere, e un titolo in inglese in mezzo agli
   altri fa solo rumore. */
const FONTI = [
  { nome: 'BadTaste',      url: 'https://www.badtaste.it/feed/',                  lingua: 'it', peso: 1.0 },
  { nome: 'MoviePlayer',   url: 'https://www.movieplayer.it/rss/news.xml',        lingua: 'it', peso: 1.0 },
  { nome: 'ScreenWeek',    url: 'https://www.screenweek.it/feed',                 lingua: 'it', peso: 0.9 },
  { nome: 'Everyeye',      url: 'https://cinema.everyeye.it/rss/news.xml',        lingua: 'it', peso: 0.8 },
  { nome: 'Cinefilos',     url: 'https://www.cinefilos.it/feed',                  lingua: 'it', peso: 0.9 },
  { nome: 'Cineblog',      url: 'https://www.cineblog.it/feed',                   lingua: 'it', peso: 0.8 },
  { nome: 'Ciak',          url: 'https://www.ciakmagazine.it/feed/',              lingua: 'it', peso: 1.0 },
  { nome: 'Fumettologica', url: 'https://fumettologica.it/feed/',                 lingua: 'it', peso: 0.6 },
  // Le firme che fanno le notizie, non che le riprendono.
  { nome: 'Variety',       url: 'https://variety.com/v/film/feed/',               lingua: 'en', peso: 1.3 },
  { nome: 'Deadline',      url: 'https://deadline.com/v/film/feed/',              lingua: 'en', peso: 1.3 },
  { nome: 'Hollywood Reporter', url: 'https://www.hollywoodreporter.com/c/movies/feed/', lingua: 'en', peso: 1.2 },
  { nome: 'IndieWire',     url: 'https://www.indiewire.com/c/film/feed/',         lingua: 'en', peso: 1.1 },
  { nome: '/Film',         url: 'https://www.slashfilm.com/feed/',                lingua: 'en', peso: 0.9 },
  { nome: 'The Guardian',  url: 'https://www.theguardian.com/film/rss',           lingua: 'en', peso: 1.1 }
];

const GIORNI   = 10;   // oltre, un articolo non è più notizia
const MEMORIA  = 14;   // per quanto conservo l'archivio (e la curatela già pagata)

/* ── chiavi ──────────────────────────────────────────── */
async function chiavi() {
  let env = '';
  try { env = await readFile(join(ROOT, '.env.local'), 'utf8'); } catch { /* nessun .env.local */ }
  const leggi = nome => {
    if (process.env[nome]) return process.env[nome];
    const m = env.match(new RegExp(`^\\s*${nome}\\s*=\\s*(.+?)\\s*$`, 'm'));
    return m ? m[1].replace(/^["']|["']$/g, '') : null;
  };
  return { tmdb: leggi('TMDB_KEY') };
}

let KEY = null;
async function tmdb(path, params = {}) {
  if (!KEY) return null;
  const url = new URL(API + path);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('language', 'it-IT');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.warn(`  ✗ TMDB ${res.status} su ${path}`); return null; }
    return await res.json();
  } catch (err) { console.warn(`  ✗ TMDB ${path}: ${err.message}`); return null; }
}

/* ── parsing RSS senza dipendenze ────────────────────── */
function ripulisci(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&hellip;/g, '…').replace(/&ndash;|&mdash;/g, '–')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const campo = (blocco, tag) => {
  const m = blocco.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? ripulisci(m[1]) : '';
};

/* L'immagine sta dove ogni testata decide di metterla: in
   media:content, in enclosure, o dentro l'HTML della descrizione. */
function immagineDi(b) {
  const media = b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i);
  if (media) return media[1];
  const enc = b.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i)
           || b.match(/<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i);
  if (enc) return enc[1];
  const grezzo = b.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
                  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const img = grezzo.match(/<img[^>]*src="(https?:[^"]+)"/i);
  if (img && !/\.(gif|svg)(\?|$)/i.test(img[1]) && !/pixel|tracker|1x1|spacer|emoji|badge/i.test(img[1])) return img[1];
  return null;
}

function leggiFeed(xml, fonte) {
  const blocchi = xml.split(/<item[\s>]/i).slice(1);
  return blocchi.map(b => {
    const data = campo(b, 'pubDate') || campo(b, 'dc:date') || campo(b, 'published');
    const categorie = [...b.matchAll(/<category[^>]*>([\s\S]*?)<\/category>/gi)]
      .map(m => ripulisci(m[1])).filter(Boolean).slice(0, 8);
    const pieno = campo(b, 'content:encoded');
    let sommario = campo(b, 'description');
    // Alcune testate mettono nella descrizione solo il titolo ripetuto.
    if (sommario.length < 40 && pieno) sommario = pieno.slice(0, 400);
    return {
      titolo: campo(b, 'title'),
      link: (b.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
      sommario: sommario.slice(0, 320),
      data: data && !isNaN(new Date(data)) ? new Date(data).toISOString() : null,
      immagine: immagineDi(b),
      categorie,
      fonte: fonte.nome,
      lingua: fonte.lingua,
      peso: fonte.peso
    };
  }).filter(x => x.titolo && x.link && /^https?:/.test(x.link));
}

/* ── la foto che il feed non dà ────────────────────────
   ScreenWeek e Cineblog non mettono immagini nel feed, ma la pagina
   dell'articolo ha sempre la sua og:image, pensata proprio per le
   anteprime. Costa una richiesta per articolo, solo per chi ne ha
   bisogno, e solo la prima volta. */
async function ogImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cineteca/2.0)' }, signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    /* Niente scorciatoie sulla lunghezza: le pagine dell'Hollywood
       Reporter pesano 600 kB e mettono og:image oltre il trecentomillesimo
       carattere. Tagliare a 250 kB voleva dire perdere ogni loro foto. */
    const html = (await res.text()).slice(0, 1200000);
    const m = html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
           || html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i);
    // Nei meta l'e commerciale arriva codificata, e un URL con &amp; non carica.
    const u = m ? m[1].replace(/&amp;|&#0*38;/gi, '&').replace(/&#0*(\d+);/g, (_, n) => String.fromCharCode(n)).trim() : null;
    return u && /^https?:/.test(u) ? u : null;
  } catch { return null; }
}

/* Quanto è larga un'immagine, leggendone solo l'intestazione: per
   l'apertura, che va a tutto schermo, una foto da 600 pixel viene
   sgranata e si vede. */
async function larghezza(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(8000) });
    const b = Buffer.from(await res.arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xD8) {                       // JPEG
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xC0 && m <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(m)) return b.readUInt16BE(i + 7);
        i += 2 + b.readUInt16BE(i + 2);
      }
      return null;
    }
    if (b[0] === 0x89 && b[1] === 0x50) return b.readUInt32BE(16);   // PNG
    if (b.slice(8, 12).toString() === 'WEBP') {                      // WebP
      const tipo = b.slice(12, 16).toString();
      if (tipo === 'VP8 ') return b.readUInt16LE(26) & 0x3FFF;
      if (tipo === 'VP8L') return 1 + (((b[21] | (b[22] << 8)) & 0x3FFF));
      if (tipo === 'VP8X') return 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
    }
    return null;
  } catch { return null; }
}

async function aLotti(lista, n, fn) {
  const coda = [...lista];
  await Promise.all(Array.from({ length: n }, async () => { while (coda.length) await fn(coda.shift()); }));
}

/* ── normalizzazione e alias dei titoli ──────────────── */
const ROMANI = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };

function normalizza(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function alias(titolo) {
  const base = normalizza(titolo);
  const varianti = new Set([base]);
  const tagliato = normalizza(titolo.split(/[:–—]| - /)[0]);
  if (tagliato.length >= 5) varianti.add(tagliato);
  for (const v of [...varianti]) {
    const parole = v.split(' ');
    const senzaParte = parole.filter(p => p !== 'part' && p !== 'parte').join(' ');
    if (senzaParte.length >= 5) varianti.add(senzaParte);
    for (const forma of [v, senzaParte]) {
      const p = forma.split(' ');
      const ultima = p.at(-1);
      if (ROMANI[ultima]) varianti.add([...p.slice(0, -1), ROMANI[ultima]].join(' '));
      const romano = Object.keys(ROMANI).find(k => ROMANI[k] === ultima);
      if (romano) varianti.add([...p.slice(0, -1), romano].join(' '));
      if (forma.includes(' part ')) varianti.add(forma.replace(' part ', ' parte '));
      if (forma.includes(' parte ')) varianti.add(forma.replace(' parte ', ' part '));
    }
  }
  // "il film", "the movie" in coda sono rumore delle testate
  for (const v of [...varianti]) {
    const s = v.replace(/\s+(il film|the movie|the film)$/, '');
    if (s.length >= 5) varianti.add(s);
  }
  return [...varianti].filter(v => v.length >= 5);
}

const paroleIntere = (testo, ago) => {
  const fuga = ago.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${fuga}([^\\p{L}\\p{N}]|$)`, 'u').test(testo);
};

/* Titoli troppo generici per essere cercati da soli nel testo:
   "Michael", "Obsession", "Mother" agganciano qualsiasi cosa. */
const GENERICI = new Set(['michael', 'mother', 'obsession', 'the movie', 'il film', 'the drama', 'couture', 'artificial', 'verity', 'mammina', 'hokum', 'clayface', 'odissea', 'elio', 'the batman', 'jumpers', 'backrooms', 'coppia', 'disclosure day', 'scary movie', 'la fine']);

/* ── il dizionario dei soggetti ───────────────────────────
   Chi vale la pena riconoscere in un titolo. Tre cerchi:
     1. la libreria (film, registi che segui, attori ricorrenti)
     2. il cinema di cui si parla adesso (trending, in sala, in
        arrivo — da TMDB, con locandine e generi)
     3. i tuoi gusti (registi e attori dei film che hai visto):
        quando spuntano su un film che NON hai, è il radar.      */
function libreria(movies) {
  const visti = movies.filter(m => m.lista === 'visto');
  const conteggio = (lista, chiave) => {
    const c = new Map();
    for (const m of lista) for (const k of chiave(m)) if (k) c.set(k, (c.get(k) || 0) + 1);
    return c;
  };
  const generiVisti = conteggio(visti, m => m.genres || []);
  const registiVisti = conteggio(visti, m => [m.director]);
  const attoriVisti  = conteggio(visti, m => (m.castDetail || []).slice(0, 6).map(c => c.name));

  const top = mappa => [...mappa.entries()].sort((a, b) => b[1] - a[1]);
  return {
    visti, generiVisti, registiVisti, attoriVisti,
    generiTop: top(generiVisti).slice(0, 4).map(([g]) => g),
    registiCari: top(registiVisti).filter(([, n]) => n >= 1).map(([r]) => r),
    attoriCari:  top(attoriVisti).filter(([, n]) => n >= 2).map(([a]) => a)
  };
}

function soggetti(movies, lib, trend) {
  const e = new Map();
  const aggiungi = (nome, tipo, extra = {}, varianti = null) => {
    if (!nome || nome.length < 4) return;
    const k = normalizza(nome);
    if (k.length < 4) return;
    const v = e.get(k) || { nome, tipo, alias: new Set([k]), compagni: new Set(), ...extra };
    for (const a of varianti || []) v.alias.add(a);
    Object.assign(v, extra);
    e.set(k, v);
    return v;
  };

  // 1. libreria
  for (const m of movies) {
    const v = aggiungi(m.title, 'film',
      { inLibreria: true, lista: m.lista, filmId: m.id, tmdbId: m.tmdbId, backdrop: m.backdrop, poster: m.poster,
        generi: m.genres || [], anno: (m.release || '').slice(0, 4) },
      alias(m.title));
    if (v) {
      if (m.originalTitle && m.originalTitle !== m.title) for (const a of alias(m.originalTitle)) v.alias.add(a);
      if (m.director) v.compagni.add(normalizza(m.director));
      for (const c of (m.castDetail || []).slice(0, 8)) v.compagni.add(normalizza(c.name));
    }
  }
  // 3. le persone dei tuoi gusti (regista visto almeno una volta, attore almeno due)
  for (const r of lib.registiCari) aggiungi(r, 'regista', { caro: true, visti: lib.registiVisti.get(r) });
  for (const a of lib.attoriCari)  aggiungi(a, 'attore',  { caro: true, visti: lib.attoriVisti.get(a) });

  // 2. il cinema di adesso
  for (const t of trend) {
    const gia = e.get(normalizza(t.title));
    if (gia) { gia.trend = true; gia.popolarita = t.popularity; if (!gia.backdrop) gia.backdrop = t.backdrop_path; continue; }
    const v = aggiungi(t.title, 'film',
      { trend: true, inLibreria: false, tmdbId: t.id, backdrop: t.backdrop_path, poster: t.poster_path,
        generiIds: t.genre_ids || [], popolarita: t.popularity, anno: (t.release_date || '').slice(0, 4),
        origine: t.origine },
      alias(t.title));
    if (v && t.original_title && t.original_title !== t.title) for (const a of alias(t.original_title)) v.alias.add(a);
  }
  return e;
}

/* Un titolo di una sola parola, o troppo generico, lo accetto
   solo se l'articolo nomina anche qualcuno di quel film. */
function pertinente(testo, v) {
  const colpito = [...v.alias].find(a => paroleIntere(testo, a));
  if (!colpito) return false;
  const debole = !/\s/.test(colpito.trim()) || GENERICI.has(colpito) || colpito.length <= 7;
  if (v.tipo !== 'film' || !debole) return true;
  return [...v.compagni].some(c => paroleIntere(testo, c));
}

/* ── generi TMDB → nomi italiani del catalogo ─────────── */
const GENERI_TMDB = { 28:'Azione', 12:'Avventura', 16:'Animazione', 35:'Commedia', 80:'Crime', 99:'Documentario',
  18:'Dramma', 10751:'Famiglia', 14:'Fantasy', 36:'Storia', 27:'Horror', 10402:'Musica', 9648:'Mistero',
  10749:'Romance', 878:'Fantascienza', 53:'Thriller', 10752:'Guerra', 37:'Western' };

/* ── classificazione per sezione (euristica) ─────────────
   Il curatore, se c'è, può correggerla. Ma le parole che le
   testate usano per dire "questo è un pezzo lungo" o "questa è
   una chicca" sono poche e sempre le stesse.                  */
const SPIE = {
  approfondimento: [
    'recensione', 'review', 'analisi', 'analysis', 'spiegat', 'spiegazione', 'explained', 'finale', 'ending',
    'significato', 'intervista', 'interview', 'retroscena', 'speciale', 'perché ', 'perche ', 'why ', 'come è nato',
    'making of', 'dietro le quinte', 'behind the scenes', 'oral history', 'saggio', 'essay', 'ritratto', 'profile',
    'la storia di', 'la storia vera', 'true story', 'cosa significa', 'cosa succede', 'what happens', 'breakdown',
    'guida', 'guide', 'ranking', 'tutti i film', 'in ordine', 'critica', 'critics', 'opinion', 'commento', 'editoriale'
  ],
  curiosita: [
    'curiosit', 'sapevat', 'sapevi', 'lo sapevi', 'easter egg', 'cameo', 'aneddot', 'trivia', 'fun fact',
    'things you', 'cose che', ' cose ', 'segret', 'secret', 'errori', 'goof', 'dettaglio', 'detail',
    'quiz', 'meme', 'virale', 'viral', 'improvvisat', 'improvis', 'scena tagliata', 'deleted scene',
    'nascosto', 'hidden', 'omaggio', 'citazione', 'reference', 'quanto costa', 'quanto guadagna', 'stipendio'
  ],
  passato: [
    'anni fa', 'years ago', 'anniversar', 'compie', 'turns ', 'cult', 'classico', 'classic', 'restaur', 'restor',
    'torna al cinema', 'torna in sala', 'riedizione', 're-release', 'rerelease', 'retrospettiv', 'retrospective',
    'capolavoro', 'masterpiece', 'dimenticat', 'forgotten', 'del 19', 'del 20', 'nel 19', 'in 19', 'from 19',
    'addio', 'è morto', 'morta', 'scompar', 'dies at', 'dead at', 'rip '
  ]
};

/* Le notizie "pesanti": se ti sfuggono cambiano i tuoi piani. */
const PESANTI = [
  'rinviat', 'rimandat', 'slitta', 'posticipat', 'anticipat', 'nuova data', "data d'uscita", 'data di uscita',
  'prevendit', 'al cinema dal', 'in sala dal', 'uscita italiana', 'trailer', 'teaser', 'prime immagini', 'first look',
  'annuncia', 'annunciato', 'confermato', 'confirmed', 'announces', 'oscar', 'candidatur', 'nomination', 'vince', 'wins',
  'premio', 'festival', 'venezia', 'venice', 'cannes', 'cancellat', 'cancel', 'sequel', 'box office', 'incasso', 'incassi',
  'record', 'delayed', 'release date', 'casting', 'cast', 'regia', 'to direct', 'dirigerà'
];

const SPIE_PREVENDITA = ['prevendit', 'biglietti disponibili', 'biglietti in vendita', 'acquista il biglietto', 'in prevendita', 'tickets on sale', 'presale'];

/* Volantinaggio e videogiochi fuori: non sono notizie di cinema. */
const RUMORE = ['sconto', 'scontat', 'offerta', 'offerte', 'risparmi', 'prezzo piu basso', 'minimo storico', 'coupon',
  'black friday', 'prime day', 'amazon', 'gamelife', 'bundle', 'in promozione', 'acquistalo', 'compralo', 'lo trovi a',
  'crollo del prezzo', 'preordina', 'deal', 'discount', 'sale ', 'coupon', 'giveaway', 'sweepstakes', 'codice sconto',
  'oroscopo', 'ricetta', 'gossip'];
const NON_CINEMA = ['videogioco', 'videogame', 'video game', 'ps5', 'ps4', 'xbox', 'nintendo', 'gameplay', 'remastered',
  'recensione del gioco', 'dlc', 'serie tv', 'tv series', 'della serie', 'la serie', 'serie per', 'serie hbo', 'serie netflix',
  'serie prime', 'serie disney', 'serie apple', 'serie sky', 'spider-noir', 'stagione 1', 'stagione 2', 'stagione 3',
  'season 1', 'season 2', 'season 3', 'episodio', 'stasera su rai', 'stasera su canale', 'stasera in tv', 'in tv',
  'episode', 'reality', 'grande fratello', 'sanremo', 'x factor', 'talent', 'fumetto', 'manga', 'anime', 'album', 'tour',
  'concerto', 'podcast', 'tv show', 'talk show', 'streaming numbers', 'ratings'];

function sezioneDi(a) {
  const t = normalizza(`${a.titolo} ${a.sommario} ${a.categorie.join(' ')}`);
  const conta = lista => lista.filter(p => t.includes(normalizza(p))).length;
  const punti = { approfondimento: conta(SPIE.approfondimento), curiosita: conta(SPIE.curiosita), passato: conta(SPIE.passato) };
  // Un pezzo lungo su un classico è "passato" prima che "approfondimento".
  if (punti.passato >= 1 && (a.soggetti.some(s => s.anno && Number(s.anno) <= new Date().getFullYear() - 8) || punti.passato >= 2)) return 'passato';
  if (punti.curiosita >= 1 && punti.curiosita >= punti.approfondimento) return 'curiosita';
  if (punti.approfondimento >= 1) return 'approfondimento';
  return 'notizia';
}

/* ── la curatela ──────────────────────────────────────────
   data/curatela.json: { "<link>": { titolo, sommario, perche, sezione } }
   La scrive la routine mattutina di Claude Code, leggendo
   data/da-curare.json che questo script prepara. Qui si applica:
   un articolo curato riceve titolo e sommario in italiano, la riga
   del "perché", e la sezione corretta ("scarta" lo elimina).    */
async function leggiCuratela() {
  try { return JSON.parse(await readFile(join(ROOT, 'data', 'curatela.json'), 'utf8')); }
  catch { return {}; }
}

function applicaCuratela(articoli, curatela) {
  let n = 0;
  for (const a of articoli) {
    const c = curatela[a.link];
    if (!c || a.curato) continue;
    a.it = { titolo: String(c.titolo || a.titolo).trim(), sommario: String(c.sommario || '').trim(), perche: String(c.perche || '').trim() };
    if (c.sezione === 'scarta') a.scarta = true;
    else if (['notizia', 'approfondimento', 'curiosita', 'passato'].includes(c.sezione)) a.sezione = c.sezione;
    a.curato = true;
    n++;
  }
  return n;
}

/* ── accadde oggi ─────────────────────────────────────────
   Usciti oggi, tanti anni fa. Non "i migliori film di sempre":
   quelli che hanno un anniversario proprio oggi, che è l'unica
   ragione per parlarne proprio oggi.                          */
async function accaddeOggi(movies, lib) {
  if (!KEY) return [];
  const oggi = new Date();
  const mm = String(oggi.getMonth() + 1).padStart(2, '0');
  const dd = String(oggi.getDate()).padStart(2, '0');
  const anni = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80];
  const trovati = [];
  for (const n of anni) {
    const y = oggi.getFullYear() - n;
    const r = await tmdb('/discover/movie', {
      'primary_release_date.gte': `${y}-${mm}-${dd}`, 'primary_release_date.lte': `${y}-${mm}-${dd}`,
      sort_by: 'vote_count.desc', 'vote_count.gte': 300, include_adult: 'false'
    });
    for (const f of (r?.results || []).slice(0, 2)) trovati.push({ ...f, anniFa: n });
  }
  // Se il giorno esatto è avaro, allargo alla settimana ma lo dico.
  let approssimato = false;
  if (trovati.length < 3) {
    approssimato = true;
    const da = new Date(oggi); da.setDate(da.getDate() - 3);
    const a  = new Date(oggi); a.setDate(a.getDate() + 3);
    const f = d => `${d.getMonth() + 1}`.padStart(2, '0') + '-' + `${d.getDate()}`.padStart(2, '0');
    for (const n of [10, 20, 25, 30, 40, 50]) {
      const y = oggi.getFullYear() - n;
      const r = await tmdb('/discover/movie', {
        'primary_release_date.gte': `${y}-${f(da)}`, 'primary_release_date.lte': `${y}-${f(a)}`,
        sort_by: 'vote_count.desc', 'vote_count.gte': 500, include_adult: 'false'
      });
      for (const x of (r?.results || []).slice(0, 1)) if (!trovati.some(t => t.id === x.id)) trovati.push({ ...x, anniFa: n });
    }
  }

  const inLib = new Map(movies.filter(m => m.tmdbId).map(m => [m.tmdbId, m]));
  return trovati
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 8)
    .map(f => {
      const mio = inLib.get(f.id);
      const generi = (f.genre_ids || []).map(g => GENERI_TMDB[g]).filter(Boolean);
      const tuoGenere = generi.find(g => lib.generiTop.includes(g));
      return {
        tmdbId: f.id, titolo: f.title, originale: f.original_title, anno: (f.release_date || '').slice(0, 4),
        anniFa: f.anniFa, data: f.release_date, poster: f.poster_path, backdrop: f.backdrop_path,
        voto: f.vote_average ? Number(f.vote_average.toFixed(1)) : null, votanti: f.vote_count,
        generi, trama: (f.overview || '').slice(0, 220), approssimato,
        inLibreria: !!mio, filmId: mio?.id || null,
        perche: mio ? (mio.lista === 'visto' ? 'ce l\'hai fra i visti' : 'ce l\'hai in libreria')
              : tuoGenere ? `${tuoGenere.toLowerCase()}, il tuo terreno` : null
      };
    });
}

/* ── i trailer della settimana ─────────────────────────────
   Il modo più onesto di scoprire un film è vederne il trailer
   prima che esca. Qui: i film sotto i riflettori (in arrivo, in
   sala, di tendenza) che NON hai in libreria e che hanno
   pubblicato un trailer negli ultimi dieci giorni. Con abbastanza
   dati da poterli aggiungere alla libreria con un tocco, e una
   riga che dice perché potrebbero piacerti — quando c'è un
   legame vero con quello che hai visto.                        */
const PAESI = { US:'USA', GB:'Regno Unito', IT:'Italia', FR:'Francia', DE:'Germania', ES:'Spagna', JP:'Giappone',
  KR:'Corea del Sud', CA:'Canada', AU:'Australia', IE:'Irlanda', MX:'Messico', BR:'Brasile', IN:'India', CN:'Cina',
  DK:'Danimarca', SE:'Svezia', NO:'Norvegia', FI:'Finlandia', NZ:'Nuova Zelanda', BE:'Belgio', NL:'Paesi Bassi', AT:'Austria', CH:'Svizzera', PL:'Polonia', AR:'Argentina' };

async function trailerDellaSettimana(movies, lib, trend) {
  if (!KEY) return [];
  const inLib = new Set(movies.map(m => m.tmdbId).filter(Boolean));
  const candidati = trend.filter(t => !inLib.has(t.id)).slice(0, 50);
  const limite = Date.now() - 10 * 86400000;
  const out = [];

  await aLotti(candidati, 5, async t => {
    const d = await tmdb(`/movie/${t.id}`, { append_to_response: 'videos,credits,release_dates', include_video_language: 'it,en,null' });
    if (!d) return;
    const video = (d.videos?.results || [])
      .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type) && v.published_at && new Date(v.published_at).getTime() >= limite)
      .sort((a, b) => (b.type === 'Trailer') - (a.type === 'Trailer') || (b.iso_639_1 === 'it') - (a.iso_639_1 === 'it') || new Date(b.published_at) - new Date(a.published_at))[0];
    if (!video) return;

    const regista = (d.credits?.crew || []).find(c => c.job === 'Director')?.name || null;
    const cast = (d.credits?.cast || []).slice(0, 8);
    const generi = (d.genres || []).map(g => g.name);
    const it = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'IT');
    // L'ultima data italiana in sala, non la prima: un classico che torna
    // al cinema ha una data nuova, ed è quella che conta.
    const uscitaIT = it?.release_dates?.filter(r => [2, 3].includes(r.type)).sort((a, b) => b.release_date.localeCompare(a.release_date))[0]?.release_date?.slice(0, 10) || null;
    const uscita = uscitaIT || d.release_date || null;
    // "In uscita" vuol dire adesso o presto: un film uscito a giugno con
    // un trailer nuovo è il trailer dell'home video, non una scoperta.
    if (uscita && new Date(uscita).getTime() < Date.now() - 21 * 86400000) return;

    // Il perché: un legame vero o niente. "Sotto i riflettori" non è un motivo.
    const motivi = [];
    const nR = regista && lib.registiVisti.get(regista);
    if (nR) motivi.push(`regia di ${regista}, di cui hai visto ${nR === 1 ? 'un film' : nR + ' film'}`);
    const attore = cast.find(c => (lib.attoriVisti.get(c.name) || 0) >= 2);
    if (attore) motivi.push(`c'è ${attore.name}, che hai visto ${lib.attoriVisti.get(attore.name)} volte`);
    const tuoi = generi.filter(g => lib.generiTop.includes(g));
    if (tuoi.length >= 2) motivi.push(`${tuoi.slice(0, 2).map(g => g.toLowerCase()).join(' e ')}: il tuo terreno`);
    else if (tuoi.length === 1 && generi.length <= 2) motivi.push(`${tuoi[0].toLowerCase()}, il tuo terreno`);

    out.push({
      tmdbId: d.id, imdbId: d.imdb_id || null, title: d.title, originalTitle: d.original_title,
      release: uscita, releaseFonte: uscitaIT ? 'IT' : 'globale',
      genres: generi, countries: (d.production_countries || []).map(c => PAESI[c.iso_3166_1] || c.name).slice(0, 3),
      runtime: d.runtime || null, plot: (d.overview || '').slice(0, 600), tagline: d.tagline || null,
      poster: d.poster_path, backdrop: d.backdrop_path, director: regista,
      cast: cast.slice(0, 5).map(c => c.name),
      castDetail: cast.map(c => ({ name: c.name, character: c.character, profile: c.profile_path })),
      tmdbRating: d.vote_average || null, tmdbVotes: d.vote_count || 0, popularity: d.popularity || 0,
      trailer: `https://www.youtube.com/watch?v=${video.key}`, youtube: video.key,
      trailerTipo: video.type, trailerLingua: video.iso_639_1, trailerPubblicato: video.published_at,
      origine: t.origine, perche: motivi[0] || null, motivi
    });
  });

  // Prima chi ha un motivo, poi per freschezza del trailer e popolarità.
  return out
    .sort((a, b) => (!!b.perche) - (!!a.perche) || new Date(b.trailerPubblicato) - new Date(a.trailerPubblicato) || b.popularity - a.popularity)
    .slice(0, 10);
}

/* ═══════════════════════════════ main ═══════════════════ */
const { tmdb: tmdbKey } = await chiavi();
KEY = tmdbKey;
if (!KEY) console.warn('⚠ Senza TMDB_KEY: niente trending, niente anniversari.');
const curatela = await leggiCuratela();
console.log(`Curatela in archivio: ${Object.keys(curatela).length} articoli.`);

const catalogo = JSON.parse(await readFile(join(ROOT, 'data', 'movies.json'), 'utf8'));
const movies = catalogo.movies;
const lib = libreria(movies);

/* Il cinema di cui si parla adesso, secondo TMDB. */
const trend = [];
if (KEY) {
  const aggiungi = (lista, origine) => { for (const t of lista || []) if (!trend.some(x => x.id === t.id)) trend.push({ ...t, origine }); };
  aggiungi((await tmdb('/trending/movie/week'))?.results?.slice(0, 40), 'trending');
  aggiungi((await tmdb('/movie/now_playing', { region: 'IT' }))?.results?.slice(0, 30), 'in sala');
  aggiungi((await tmdb('/movie/upcoming',    { region: 'IT' }))?.results?.slice(0, 30), 'in arrivo');
  aggiungi((await tmdb('/movie/upcoming',    { region: 'US', page: '1' }))?.results?.slice(0, 20), 'in arrivo');
  console.log(`Sotto i riflettori (TMDB): ${trend.length} film.`);
}
/* E le persone di cui si parla: senza, "Robert Pattinson a Venezia"
   entra solo se Pattinson è già fra i tuoi attori. */
const persone = [];
if (KEY) {
  for (const p of [1, 2, 3]) for (const x of (await tmdb('/person/popular', { page: String(p) }))?.results || [])
    if (x.known_for_department === 'Acting' || x.known_for_department === 'Directing') persone.push(x);
  for (const x of (await tmdb('/trending/person/week'))?.results || []) if (!persone.some(p => p.id === x.id)) persone.push(x);
}
const sorvegliati = soggetti(movies, lib, trend);
for (const p of persone) {
  const k = normalizza(p.name);
  if (k.length < 6 || sorvegliati.has(k)) continue;
  sorvegliati.set(k, { nome: p.name, tipo: p.known_for_department === 'Directing' ? 'regista' : 'attore',
                       alias: new Set([k]), compagni: new Set(), popolare: true, profilo: p.profile_path });
}
console.log(`Soggetti riconoscibili: ${sorvegliati.size} (libreria ${[...sorvegliati.values()].filter(v => v.inLibreria).length}, persone care ${[...sorvegliati.values()].filter(v => v.caro).length}, sotto i riflettori ${[...sorvegliati.values()].filter(v => v.trend && !v.inLibreria).length}).`);

/* ── lettura dei feed ─────────────────────────────────── */
const fontiAttive = FONTI;
const articoli = [];
await Promise.all(fontiAttive.map(async f => {
  try {
    const res = await fetch(f.url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cineteca/2.0)' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.warn(`  ✗ ${f.nome}: HTTP ${res.status}`); return; }
    const trovati = leggiFeed(await res.text(), f);
    articoli.push(...trovati);
    console.log(`  ✓ ${f.nome}: ${trovati.length} articoli, ${trovati.filter(x => x.immagine).length} con immagine`);
  } catch (err) { console.warn(`  ✗ ${f.nome}: ${err.message}`); }
}));

/* ── archivio: la curatela già fatta non si ripaga ────── */
let archivio = [];
let segnalazioniVecchie = [];
try {
  const vecchio = JSON.parse(await readFile(join(ROOT, 'data', 'notizie.json'), 'utf8'));
  archivio = vecchio.notizie || [];
  segnalazioniVecchie = vecchio.segnalazioniPrevendita || [];
} catch { /* prima esecuzione */ }
const gia = new Map(archivio.map(n => [n.link, n]));

/* ── selezione ────────────────────────────────────────── */
const limite = Date.now() - GIORNI * 86400000;
const tenuti = [];
const vistiLink = new Set();

for (const a of articoli) {
  if (vistiLink.has(a.link)) continue;
  vistiLink.add(a.link);
  if (a.data && new Date(a.data).getTime() < limite) continue;

  const testo = normalizza(`${a.titolo} ${a.sommario} ${a.categorie.join(' ')}`);
  const soloTitolo = normalizza(a.titolo);
  if (RUMORE.some(p => testo.includes(normalizza(p)))) continue;
  if (NON_CINEMA.some(p => soloTitolo.includes(normalizza(p)))) continue;

  // Chi c'è dentro. Nel titolo pesa di più: è lì che sta la notizia.
  const citati = [];
  for (const v of sorvegliati.values()) {
    if (!pertinente(testo, v)) continue;
    const inTitolo = [...v.alias].some(x => paroleIntere(soloTitolo, x));
    citati.push({ v, inTitolo });
  }

  /* Cosa entra:
     · qualunque articolo con un soggetto riconosciuto nel titolo
     · dalle testate straniere anche senza (sono già filtrate per cinema)
       purché nel sommario compaia qualcuno
     Il resto è rumore: cronaca, tv, cose che non riguardano un film. */
  const forti = citati.filter(c => c.inTitolo);
  const parlaDiPrevendite = SPIE_PREVENDITA.some(p => testo.includes(p));

  /* Senza un soggetto riconosciuto l'articolo può entrare lo stesso,
     ma solo se parla chiaramente di un film (trailer, uscita, festival,
     recensione…) e non di tv: una rassegna che conosce solo i titoli
     del dizionario è una rassegna che si perde metà del cinema. */
  const parolaPesante = PESANTI.some(p => soloTitolo.includes(normalizza(p)));
  const sembraCinema = parolaPesante || /\bfilm\b|\bcinema\b|\bregist|\bcast\b|\bsala\b|\bpellicol/.test(testo);
  if (!forti.length && !citati.length && !sembraCinema) continue;
  if (!forti.length && NON_CINEMA.some(p => testo.includes(normalizza(p)))) continue;

  const principale = (forti.find(c => c.v.inLibreria) || forti.find(c => c.v.tipo === 'film') || forti[0] || citati[0])?.v
    || { nome: null, tipo: 'nessuno' };
  const inLibreria = citati.some(c => c.v.inLibreria);

  /* Il radar: un film che NON hai, ma dove compare qualcuno dei
     tuoi, o che vive nei tuoi generi. */
  let radar = null;
  if (!inLibreria) {
    const persona = citati.find(c => c.v.caro);
    if (persona) {
      const p = persona.v;
      radar = p.tipo === 'regista'
        ? `regia di ${p.nome}, di cui hai visto ${p.visti === 1 ? 'un film' : p.visti + ' film'}`
        : `c'è ${p.nome}, che hai visto ${p.visti} volte`;
    } else if (principale.tipo === 'film' && principale.trend) {
      const generi = (principale.generiIds || []).map(g => GENERI_TMDB[g]).filter(Boolean);
      const tuoi = generi.filter(g => lib.generiTop.includes(g));
      // Un genere in comune non basta: "dramma" ce l'ha mezzo cinema.
      if (tuoi.length >= 2)
        radar = `${tuoi.map(g => g.toLowerCase()).join(' e ')}: il tuo terreno`;
    }
  }

  const soggettiOut = [...new Map(citati.map(c => [c.v.nome, c])).values()].slice(0, 5).map(c => ({
    nome: c.v.nome, tipo: c.v.tipo, inTitolo: c.inTitolo, inLibreria: !!c.v.inLibreria,
    lista: c.v.lista || null, filmId: c.v.filmId || null, tmdbId: c.v.tmdbId || null,
    backdrop: c.v.backdrop || null, poster: c.v.poster || null, profilo: c.v.profilo || null,
    trend: !!c.v.trend, anno: c.v.anno || null
  }));

  const eta = (Date.now() - new Date(a.data || Date.now()).getTime()) / 3600000;   // ore
  const rilievo = (principale.inLibreria ? 6 : principale.trend ? 4 : principale.nome ? 2 : 0.5)
    + forti.length + (parolaPesante ? 3 : 0) + (parlaDiPrevendite ? 5 : 0)
    + (a.immagine ? 1 : 0) + (a.peso - 1) * 3 + (radar ? 2 : 0)
    + Math.max(0, 3 - eta / 12);   // le ultime 36 ore contano di più

  const prima = gia.get(a.link);
  tenuti.push({
    ...a,
    soggetti: soggettiOut,
    soggetto: principale.nome, soggettoTipo: principale.tipo,
    inLibreria, radar, prevendite: parlaDiPrevendite, rilievo: Number(rilievo.toFixed(1)),
    sezione: null,
    vistoIl: prima?.vistoIl || new Date().toISOString(),
    it: prima?.it || null, curato: prima?.curato || false, scarta: prima?.scarta || false
  });
}
for (const a of tenuti) a.sezione = gia.get(a.link)?.curato ? gia.get(a.link).sezione : sezioneDi(a);

/* Chi è arrivato senza foto la va a cercare nella propria pagina.
   Chi c'era già in archivio e non l'ha trovata nemmeno allora, non
   la ritenta: era già stato chiesto. */
const senzaFoto = tenuti.filter(a => !a.immagine && !a.fotoCercata).slice(0, 60);
let trovate = 0;
await aLotti(senzaFoto, 6, async a => {
  const u = await ogImage(a.link);
  a.fotoCercata = true;
  if (u && !/\.svg(\?|$)|logo|placeholder|default/i.test(u)) { a.immagine = u; trovate++; }
});
if (senzaFoto.length) console.log(`Foto cercate nelle pagine: ${trovate}/${senzaFoto.length} trovate.`);

/* Le notizie in archivio ancora fresche restano (un feed tiene poco). */
const attive = new Set(fontiAttive.map(f => f.nome));
for (const n of archivio) {
  if (vistiLink.has(n.link) || !attive.has(n.fonte)) continue;
  if (new Date(n.data || n.vistoIl).getTime() < Date.now() - MEMORIA * 86400000) continue;
  if (n.lingua === 'en' && !n.it) continue;
  if (!Array.isArray(n.soggetti)) continue;   // forma vecchia dell'archivio
  tenuti.push({ ...n, rilievo: Math.max(0, (n.rilievo || 0) - 2) });
}

/* ── la curatela: applico quella fatta, preparo quella da fare ── */
const applicati = applicaCuratela(tenuti, curatela);
if (applicati) console.log(`Curatela applicata a ${applicati} articoli.`);

/* Quello che aspetta un redattore: prima le americane (senza
   traduzione non si vedono), poi le italiane più rilevanti. */
const daCurare = tenuti
  .filter(a => !a.curato && !a.scarta)
  .sort((a, b) => (b.lingua === 'en') - (a.lingua === 'en') || b.rilievo - a.rilievo)
  .slice(0, 90)
  .map(a => ({
    link: a.link, fonte: a.fonte, lingua: a.lingua, data: a.data,
    titolo: a.titolo, sommario: a.sommario, sezioneProvvisoria: a.sezione,
    soggetti: a.soggetti.map(s => s.nome + (s.inLibreria ? ' (in libreria' + (s.lista === 'visto' ? ', visto' : '') + ')' : '')),
    radar: a.radar
  }));
await writeFile(join(ROOT, 'data', 'da-curare.json'), JSON.stringify({
  preparato: new Date().toISOString(),
  gusti: { generi: lib.generiTop, registi: lib.registiCari.slice(0, 10), attori: lib.attoriCari.slice(0, 10) },
  articoli: daCurare
}, null, 2) + '\n');
console.log(`Da curare: ${daCurare.length} articoli (${daCurare.filter(a => a.lingua === 'en').length} in inglese).`);

// Senza traduzione, un articolo in inglese non ha niente da mostrare.
const finali = tenuti.filter(a => !a.scarta && (a.lingua === 'it' || a.it));

/* Stessa notizia su più testate: tengo la migliore, ma ricordo
   quante la raccontano — è il segnale che "se ne parla". */
const impronte = new Map();
for (const n of [...finali].sort((a, b) => b.rilievo - a.rilievo)) {
  const chiave = normalizza(n.it?.titolo || n.titolo).split(' ').filter(w => w.length > 3).slice(0, 6).sort().join(' ');
  const gia = impronte.get(chiave);
  if (!gia) impronte.set(chiave, n);
  else { gia.riprese = (gia.riprese || 0) + 1; gia.rilievo += 1; }
}
const uniche = [...impronte.values()];
const eta = n => new Date(n.data || n.vistoIl).getTime();
const ore = n => (Date.now() - eta(n)) / 3600000;

/* ── le sezioni ───────────────────────────────────────── */
const ordinaPerRilievo = l => [...l].sort((a, b) => b.rilievo - a.rilievo || eta(b) - eta(a));
const usati = new Set();
const prendi = (lista, n) => { const out = []; for (const x of ordinaPerRilievo(lista)) { if (usati.has(x.link)) continue; out.push(x); usati.add(x.link); if (out.length >= n) break; } return out; };

// Apertura: la più rilevante delle ultime 48 ore, con immagine.
const apertura = prendi(uniche.filter(n => ore(n) <= 48 && n.immagine && n.sezione === 'notizia'), 1)[0]
              || prendi(uniche.filter(n => ore(n) <= 72 && n.immagine), 1)[0] || null;

/* L'apertura va a tutto schermo: la sua foto deve reggere. In
   ordine: la foto dell'articolo se è larga almeno mille pixel, la
   og:image della pagina se lo è, il fondale TMDB del film (sempre
   grande), e solo in ultimo la foto piccola. */
if (apertura) {
  const fondale = apertura.soggetti.find(x => x.backdrop)?.backdrop;
  let scelta = null;
  if (apertura.immagine && ((await larghezza(apertura.immagine)) || 0) >= 1000) scelta = apertura.immagine;
  if (!scelta) { const og = await ogImage(apertura.link); if (og && og !== apertura.immagine && ((await larghezza(og)) || 0) >= 1000) scelta = og; }
  if (!scelta && fondale) scelta = `https://image.tmdb.org/t/p/w1280${fondale}`;
  apertura.immagineGrande = scelta || apertura.immagine || null;
}

// Ultime ore: le più fresche, in ordine di arrivo.
const ultime = [...uniche].filter(n => ore(n) <= 36 && !usati.has(n.link) && n.sezione === 'notizia')
  .sort((a, b) => eta(b) - eta(a)).slice(0, 8);
ultime.forEach(n => usati.add(n.link));

// Se ne parla: stesso soggetto su più articoli (e più testate).
const perSoggetto = new Map();
for (const n of uniche) {
  if (ore(n) > 7 * 24) continue;
  const s = n.soggetti.find(x => x.tipo === 'film' && x.inTitolo) || n.soggetti.find(x => x.inTitolo);
  if (!s) continue;
  if (!perSoggetto.has(s.nome)) perSoggetto.set(s.nome, { s, voci: [] });
  perSoggetto.get(s.nome).voci.push(n);
}
const temi = [...perSoggetto.values()]
  .map(({ s, voci }) => ({ s, voci: ordinaPerRilievo(voci), testate: new Set(voci.map(v => v.fonte)).size }))
  .filter(t => t.voci.length >= 2)
  .sort((a, b) => (b.testate * 2 + b.voci.length) - (a.testate * 2 + a.voci.length) || eta(b.voci[0]) - eta(a.voci[0]))
  .slice(0, 8)
  .map(t => {
    const voci = t.voci.filter(v => !usati.has(v.link) || v.link === apertura?.link).slice(0, 4);
    voci.forEach(v => usati.add(v.link));
    const s = t.s;
    return { soggetto: s.nome, tipo: s.tipo, inLibreria: s.inLibreria, lista: s.lista, filmId: s.filmId,
             tmdbId: s.tmdbId, backdrop: s.backdrop, poster: s.poster, anno: s.anno,
             quante: t.voci.length, testate: t.testate, link: voci.map(v => v.link) };
  })
  .filter(t => t.link.length);

const radar          = prendi(uniche.filter(n => n.radar), 6);
const libreriaVoci   = prendi(uniche.filter(n => n.inLibreria), 8);
const approfondimenti = prendi(uniche.filter(n => n.sezione === 'approfondimento'), 6);
const curiosita       = prendi(uniche.filter(n => n.sezione === 'curiosita'), 6);
const passato         = prendi(uniche.filter(n => n.sezione === 'passato'), 4);
const altre           = prendi(uniche.filter(n => ore(n) <= 5 * 24), 10);

const anniversari = await accaddeOggi(movies, lib);
const trailerSettimana = await trailerDellaSettimana(movies, lib, trend);

/* ── segnalazioni di prevendita (le legge novita.js) ──── */
const senzaPrevendita = new Map(
  movies.filter(m => m.lista === 'cinema' && !m.prevendita && (!m.release || new Date(m.release) > new Date()))
        .map(m => [normalizza(m.title), m]));
const segnalazioni = [];
for (const n of uniche.filter(x => x.prevendite)) {
  for (const c of n.soggetti) {
    if (c.tipo !== 'film') continue;
    const m = senzaPrevendita.get(normalizza(c.nome));
    if (!m || segnalazioni.some(s => s.id === m.id)) continue;
    segnalazioni.push({ id: m.id, film: m.title, uscita: m.release, titolo: n.it?.titolo || n.titolo, fonte: n.fonte, link: n.link });
  }
}

/* ── scrittura ────────────────────────────────────────── */
const tutteLeSezioni = new Set([apertura?.link, ...ultime, ...temi.flatMap(t => t.link), ...radar, ...libreriaVoci,
  ...approfondimenti, ...curiosita, ...passato, ...altre].map(x => typeof x === 'string' ? x : x?.link).filter(Boolean));
const notizieOut = uniche
  .filter(n => tutteLeSezioni.has(n.link) || ore(n) <= MEMORIA * 24)   // l'archivio resta per non ripagare la curatela
  .map(n => ({
    link: n.link, titolo: n.titolo, sommario: n.sommario, fonte: n.fonte, lingua: n.lingua, data: n.data,
    immagine: n.immagine, categorie: n.categorie, soggetti: n.soggetti, soggetto: n.soggetto, soggettoTipo: n.soggettoTipo,
    sezione: n.sezione, inLibreria: n.inLibreria, radar: n.radar, prevendite: n.prevendite, rilievo: n.rilievo,
    riprese: n.riprese || 0, vistoIl: n.vistoIl, it: n.it, curato: n.curato,
    immagineGrande: n.immagineGrande || null, fotoCercata: !!n.fotoCercata
  }));

await writeFile(join(ROOT, 'data', 'notizie.json'), JSON.stringify({
  aggiornato: new Date().toISOString(),
  curatela: Object.keys(curatela).length > 0,
  fonti: fontiAttive.map(f => f.nome),
  segnalazioniPrevendita: segnalazioni.length ? segnalazioni : segnalazioniVecchie.filter(s => senzaPrevendita.has(normalizza(s.film))),
  apertura: apertura?.link || null,
  ultime: ultime.map(n => n.link),
  temi,
  radar: radar.map(n => n.link),
  libreria: libreriaVoci.map(n => n.link),
  approfondimenti: approfondimenti.map(n => n.link),
  curiosita: curiosita.map(n => n.link),
  passato: passato.map(n => n.link),
  altre: altre.map(n => n.link),
  accaddeOggi: anniversari,
  trailer: trailerSettimana,
  notizie: notizieOut
}, null, 2) + '\n');

/* La curatela si pota da sola: un link sparito dai feed e
   dall'archivio non tornerà, non serve conservarne la riscrittura. */
const vivi = new Set(tenuti.map(a => a.link));
const potata = Object.fromEntries(Object.entries(curatela).filter(([l]) => vivi.has(l)));
if (Object.keys(potata).length !== Object.keys(curatela).length)
  await writeFile(join(ROOT, 'data', 'curatela.json'), JSON.stringify(potata, null, 2) + '\n');

console.log(`\n✅ data/notizie.json — ${uniche.length} notizie su ${articoli.length} articoli letti da ${fontiAttive.length} testate.`);
console.log(`   apertura ${apertura ? '✓' : '—'} · ultime ${ultime.length} · temi ${temi.length} · radar ${radar.length} · libreria ${libreriaVoci.length} · approfondimenti ${approfondimenti.length} · curiosità ${curiosita.length} · passato ${passato.length} · accadde oggi ${anniversari.length} · trailer ${trailerSettimana.length}`);
trailerSettimana.slice(0, 5).forEach(t => console.log(`   trailer: ${t.title} (${t.release || '—'})${t.perche ? ' → ' + t.perche : ''}`));
if (apertura) console.log(`\n★ Apertura: [${apertura.fonte}] ${(apertura.it?.titolo || apertura.titolo).slice(0, 90)}`);
temi.slice(0, 5).forEach(t => console.log(`   se ne parla: ${t.soggetto} — ${t.quante} articoli, ${t.testate} testate${t.inLibreria ? ' · in libreria' : ''}`));
radar.slice(0, 4).forEach(n => console.log(`   radar: ${(n.it?.titolo || n.titolo).slice(0, 60)} → ${n.radar}`));
if (segnalazioni.length) {
  console.log('\n🎫 POSSIBILI PREVENDITE — da verificare e registrare a mano:');
  segnalazioni.forEach(s => console.log(`  · ${s.film} (esce ${s.uscita})\n      [${s.fonte}] ${s.titolo.slice(0, 70)}\n      ${s.link}`));
}
