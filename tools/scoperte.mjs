#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   scoperte.mjs — la cineteca virtuale, dieci film al giorno

   La libreria racconta solo i film che hai messo su Notion. Ma
   di film ne hai visti molti di più, e finché non ci sono la
   redazione ragiona su un ritratto a metà. Qui, ogni giorno,
   dieci film già usciti che NON hai in libreria: dai registi e
   dagli attori che segui, dai tuoi generi, dai classici, da
   quello che gira adesso. Nell'app dici solo "visto", "da
   vedere" o "no", e la tua storia si riempie un film alla volta.

   Fa anche il secondo lavoro: prepara per la redazione del
   mattino (la routine di Claude Code) l'elenco dei film — trailer
   della settimana e scoperte — che aspettano una riga di contesto
   e qualche riga di trama (data/da-presentare.json). La redazione
   risponde con data/presentazioni.json, e l'app la legge.

   Uso: node tools/scoperte.mjs          (TMDB_KEY in ambiente o .env.local)
   Senza chiave non sceglie film nuovi, ma prepara comunque il
   lavoro sui trailer già raccolti.
   ══════════════════════════════════════════════════════════ */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API  = 'https://api.themoviedb.org/3';

const QUANTI   = 10;    // proposte al giorno
const RIPOSO   = 120;   // giorni prima che un film scartato dal caso possa tornare
const MEMORIA  = 90;    // giorni per cui una presentazione già scritta resta in archivio
const DA_PRESENTARE = 25;   // tetto per mattina: la routine deve finire in tempi umani
const GIORNO = 86400000;

const PAESI = { US:'USA', GB:'Regno Unito', IT:'Italia', FR:'Francia', DE:'Germania', ES:'Spagna', JP:'Giappone',
  KR:'Corea del Sud', CA:'Canada', AU:'Australia', IE:'Irlanda', MX:'Messico', BR:'Brasile', IN:'India', CN:'Cina',
  DK:'Danimarca', SE:'Svezia', NO:'Norvegia', FI:'Finlandia', NZ:'Nuova Zelanda', BE:'Belgio', NL:'Paesi Bassi', AT:'Austria', CH:'Svizzera', PL:'Polonia', AR:'Argentina' };

/* ── chiavi e rete ──────────────────────────────────────── */
async function chiavi() {
  let env = '';
  try { env = await readFile(join(ROOT, '.env.local'), 'utf8'); } catch { /* nessun .env.local */ }
  if (process.env.TMDB_KEY) return process.env.TMDB_KEY;
  const m = env.match(/^\s*TMDB_KEY\s*=\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}
const KEY = await chiavi();

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

async function leggi(file, vuoto) {
  try { return JSON.parse(await readFile(join(ROOT, 'data', file), 'utf8')); } catch { return vuoto; }
}

/* Il giorno è quello di Roma: i workflow girano più volte al giorno
   e la scelta deve restare la stessa finché non cambia la data,
   altrimenti la redazione scriverebbe presentazioni di film già
   rimpiazzati. */
const OGGI = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });

/* Caso deterministico: stesso giorno, stessa estrazione. */
function casoDel(seme) {
  let h = 1779033703 ^ seme.length;
  for (let i = 0; i < seme.length; i++) { h = Math.imul(h ^ seme.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
const caso = casoDel(OGGI);
const mescola = lista => { const a = [...lista]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(caso() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ── il ritratto del lettore, dalla libreria ──────────── */
const catalogo = await leggi('movies.json', { movies: [] });
const movies = catalogo.movies;
const visti = movies.filter(m => m.lista === 'visto');
const conteggio = (lista, chiave) => {
  const c = new Map();
  for (const m of lista) for (const k of chiave(m)) if (k) c.set(k, (c.get(k) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};
const generiVisti  = conteggio(visti, m => m.genres || []);
const registiVisti = conteggio(visti, m => [m.director]);
const attoriVisti  = conteggio(visti, m => (m.castDetail || []).slice(0, 6).map(c => c.name));
const lib = {
  generiTop:   generiVisti.slice(0, 4).map(([g]) => g),
  registiCari: registiVisti.map(([r]) => r),
  attoriCari:  attoriVisti.filter(([, n]) => n >= 2).map(([a]) => a),
  registi: new Map(registiVisti), attori: new Map(attoriVisti)
};

const notizie = await leggi('notizie.json', { trailer: [] });
const trailer = notizie.trailer || [];
const precedente = await leggi('scoperte.json', null);
const presentazioni = await leggi('presentazioni.json', {});

/* ── la scelta del giorno ────────────────────────────────── */
const soglia = new Date(Date.now() - 45 * GIORNO).toISOString().slice(0, 10);   // uscito da abbastanza da essere anche a casa
const storico = Object.fromEntries(Object.entries(precedente?.storico || {})
  .filter(([, giorno]) => (Date.now() - Date.parse(giorno)) / GIORNO < RIPOSO));
const persone = { ...(precedente?.persone || {}) };   // nome → id TMDB, per non ricercarli ogni giorno

async function scegli() {
  const esclusi = new Set([
    ...movies.map(m => m.tmdbId).filter(Boolean),
    ...trailer.map(t => t.tmdbId),
    ...Object.keys(storico).map(Number)
  ]);
  const buono = r => r && !esclusi.has(r.id) && r.poster_path && !r.adult && r.release_date && r.release_date <= soglia && !r.video;

  const secchi = { persone: [], generi: [], classici: [], popolari: [] };
  const visto = new Set();
  // La categoria è l'etichetta corta sulla card; la fonte la frase intera.
  const CATEGORIE = { persone: 'qualcuno che segui', generi: 'il tuo genere', classici: 'un classico', popolari: 'di tendenza' };
  const metti = (secchio, risultati, fonte, minimoVoti = 100) => {
    for (const r of risultati || []) {
      if (!buono(r) || visto.has(r.id) || (r.vote_count || 0) < minimoVoti) continue;
      visto.add(r.id);
      secchi[secchio].push({ id: r.id, fonte, categoria: CATEGORIE[secchio], popolarita: r.popularity || 0 });
    }
  };

  // 1. Le persone che segui. Prima i registi (un regista è una scelta,
  //    un attore capita), poi gli attori ricorrenti.
  const cari = [
    ...lib.registiCari.slice(0, 8).map(n => ({ nome: n, tipo: 'regista' })),
    ...lib.attoriCari.slice(0, 8).map(n => ({ nome: n, tipo: 'attore' }))
  ];
  for (const p of mescola(cari).slice(0, 8)) {
    if (!persone[p.nome]) {
      const s = await tmdb('/search/person', { query: p.nome });
      const trovato = (s?.results || []).find(x => x.name === p.nome) || s?.results?.[0];
      if (trovato) persone[p.nome] = trovato.id;
    }
    if (!persone[p.nome]) continue;
    const d = await tmdb('/discover/movie', {
      with_people: String(persone[p.nome]), sort_by: 'vote_count.desc', 'vote_count.gte': '200',
      'primary_release_date.lte': soglia, include_adult: 'false', page: '1'
    });
    const fonte = p.tipo === 'regista'
      ? `regia di ${p.nome}, che segui`
      : `c'è ${p.nome}, che hai visto ${lib.attori.get(p.nome)} volte`;
    metti('persone', (d?.results || []).slice(0, 8), fonte, 200);
  }

  // 2. I tuoi generi, dal meglio votato: qui ci stanno i film che
  //    "tutti hanno visto" e che nella libreria non ci sono.
  const generi = new Map(((await tmdb('/genre/movie/list'))?.genres || []).map(g => [g.name, g.id]));
  for (const g of lib.generiTop) {
    const id = generi.get(g);
    if (!id) continue;
    const d = await tmdb('/discover/movie', {
      with_genres: String(id), sort_by: 'vote_average.desc', 'vote_count.gte': '1500',
      'primary_release_date.lte': soglia, include_adult: 'false', page: String(1 + Math.floor(caso() * 5))
    });
    metti('generi', (d?.results || []).slice(0, 10), `${g.toLowerCase()}: il tuo terreno`, 1500);
  }

  // 3. I classici e 4. quello che gira adesso.
  metti('classici', ((await tmdb('/movie/top_rated', { page: String(1 + Math.floor(caso() * 10)) }))?.results || []), 'un classico che ti manca', 2000);
  metti('popolari', ((await tmdb('/movie/popular', { page: String(1 + Math.floor(caso() * 2)) }))?.results || []), 'se ne parla adesso', 300);

  // Le quote: più persone e generi (sono le scelte più mirate), poi il resto.
  const quote = { persone: 4, generi: 3, classici: 2, popolari: 1 };
  const scelti = [];
  for (const [k, n] of Object.entries(quote)) scelti.push(...mescola(secchi[k]).slice(0, n));
  // Se un secchio era corto, si riempie dagli altri.
  if (scelti.length < QUANTI) {
    const presi = new Set(scelti.map(s => s.id));
    const resto = mescola(Object.values(secchi).flat().filter(s => !presi.has(s.id)));
    scelti.push(...resto.slice(0, QUANTI - scelti.length));
  }
  return mescola(scelti.slice(0, QUANTI));
}
/* Il film per intero, nella stessa forma dei trailer: così l'app lo
   aggiunge alla libreria con lo stesso codice. */
async function dettaglio(scelto) {
  const d = await tmdb(`/movie/${scelto.id}`, { append_to_response: 'credits,videos,release_dates', include_video_language: 'it,en,null' });
  if (!d) return null;
  const regista = (d.credits?.crew || []).find(c => c.job === 'Director')?.name || null;
  const cast = (d.credits?.cast || []).slice(0, 8);
  const generi = (d.genres || []).map(g => g.name);
  const it = (d.release_dates?.results || []).find(r => r.iso_3166_1 === 'IT');
  const uscitaIT = it?.release_dates?.filter(r => [2, 3].includes(r.type)).sort((a, b) => a.release_date.localeCompare(b.release_date))[0]?.release_date?.slice(0, 10) || null;
  const video = (d.videos?.results || [])
    .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser'].includes(v.type))
    .sort((a, b) => (b.type === 'Trailer') - (a.type === 'Trailer') || (b.iso_639_1 === 'it') - (a.iso_639_1 === 'it'))[0];

  // Il legame vero con la libreria, se c'è, batte il motivo generico dell'estrazione.
  const motivi = [];
  const nR = regista && lib.registi.get(regista);
  if (nR) motivi.push(`regia di ${regista}, di cui hai visto ${nR === 1 ? 'un film' : nR + ' film'}`);
  const attore = cast.find(c => (lib.attori.get(c.name) || 0) >= 2);
  if (attore) motivi.push(`c'è ${attore.name}, che hai visto ${lib.attori.get(attore.name)} volte`);
  motivi.push(scelto.fonte);

  return {
    tmdbId: d.id, imdbId: d.imdb_id || null, title: d.title, originalTitle: d.original_title,
    release: uscitaIT || d.release_date || null, releaseFonte: uscitaIT ? 'IT' : 'globale',
    genres: generi, countries: (d.production_countries || []).map(c => PAESI[c.iso_3166_1] || c.name).slice(0, 3),
    runtime: d.runtime || null, plot: (d.overview || '').slice(0, 600), tagline: d.tagline || null,
    poster: d.poster_path, backdrop: d.backdrop_path, director: regista,
    cast: cast.slice(0, 5).map(c => c.name),
    castDetail: cast.map(c => ({ name: c.name, character: c.character, profile: c.profile_path })),
    tmdbRating: d.vote_average || null, tmdbVotes: d.vote_count || 0, popularity: d.popularity || 0,
    trailer: video ? `https://www.youtube.com/watch?v=${video.key}` : null,
    fonte: scelto.fonte, categoria: scelto.categoria, perche: motivi[0], motivi, proposto: OGGI
  };
}

let film, giorno = OGGI;
if (precedente?.giorno === OGGI && precedente.film?.length) {
  film = precedente.film;
  console.log(`Scoperte di oggi già estratte (${film.length}): le tengo.`);
} else if (KEY) {
  const scelti = await scegli();
  film = (await Promise.all(scelti.map(dettaglio))).filter(Boolean);
  for (const f of film) storico[f.tmdbId] = OGGI;
  console.log(`Scoperte del ${OGGI}: ${film.length} film.`);
  film.forEach(f => console.log(`   · ${f.title} (${(f.release || '').slice(0, 4)}) — ${f.fonte}`));
} else {
  film = precedente?.film || [];
  giorno = precedente?.giorno || OGGI;
  console.log('Senza TMDB_KEY: nessuna estrazione nuova, tengo le scoperte precedenti.');
}

await writeFile(join(ROOT, 'data', 'scoperte.json'), JSON.stringify({
  aggiornato: new Date().toISOString(), giorno, film, storico, persone
}, null, 2) + '\n');

/* ── il lavoro per la redazione ─────────────────────────── */
const impronta = f => `${f.title}|${(f.plot || '').length}|${f.director || ''}`;
const candidati = [
  ...trailer.map(t => ({ ...t, origine: 'trailer' })),
  ...film.map(f => ({ ...f, origine: 'scoperta' }))
];
const daPresentare = candidati
  .filter(f => { const p = presentazioni[`tmdb-${f.tmdbId}`]; return !p || p.impronta !== impronta(f); })
  .slice(0, DA_PRESENTARE)
  .map(f => ({
    id: `tmdb-${f.tmdbId}`, tmdbId: f.tmdbId, imdbId: f.imdbId || null,
    origine: f.origine, titolo: f.title, titoloOriginale: f.originalTitle || null,
    anno: (f.release || '').slice(0, 4) || null, uscitaItalia: f.release || null,
    regia: f.director || null, generi: f.genres || [], paesi: f.countries || [],
    durata: f.runtime || null, tagline: f.tagline || null,
    cast: (f.castDetail || []).slice(0, 6).map(c => c.character ? `${c.name} (${c.character})` : c.name),
    tramaTmdb: f.plot || null, motivi: f.motivi || [], impronta: impronta(f)
  }));

await writeFile(join(ROOT, 'data', 'da-presentare.json'), JSON.stringify({
  preparato: new Date().toISOString(),
  ritratto: {
    generi:  generiVisti.slice(0, 6).map(([g, n]) => `${g} (${n})`),
    registi: registiVisti.slice(0, 12).map(([r, n]) => n > 1 ? `${r} (${n})` : r),
    attori:  attoriVisti.filter(([, n]) => n >= 2).slice(0, 12).map(([a, n]) => `${a} (${n})`),
    filmVisti: visti.map(m => `${m.title}${m.release ? ' (' + m.release.slice(0, 4) + ')' : ''}${m.director ? ', ' + m.director : ''}`)
  },
  film: daPresentare
}, null, 2) + '\n');

/* Le presentazioni si potano da sole: quelle di film non più in
   pagina restano un po' (un trailer può tornare), poi se ne vanno. */
const vivi = new Set(candidati.map(f => `tmdb-${f.tmdbId}`));
const potate = Object.fromEntries(Object.entries(presentazioni)
  .filter(([id, p]) => vivi.has(id) || (Date.now() - Date.parse(p.scritta || 0)) / GIORNO < MEMORIA));
if (Object.keys(potate).length !== Object.keys(presentazioni).length)
  await writeFile(join(ROOT, 'data', 'presentazioni.json'), JSON.stringify(potate, null, 2) + '\n');

console.log(`✅ data/scoperte.json — ${film.length} film del giorno · data/da-presentare.json — ${daPresentare.length} da presentare (${Object.keys(potate).length} presentazioni in archivio).`);
