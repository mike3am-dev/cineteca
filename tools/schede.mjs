#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   schede.mjs — prepara il lavoro della redazione sui film

   Per ogni film della libreria la scheda vuole due cose che i
   dati di TMDB non danno: una trama vera — non due righe in
   croce, e per certi film nemmeno quelle — e un "ti piacerà
   perché" che parli da cinefilo: richiami, vibes, parentele,
   non "avventura è il tuo terreno".

   Le scrive la redazione del mattino (la routine di Claude Code),
   che legge data/da-redigere.json e produce data/schede.json.
   Questo script prepara il primo: i film che non hanno ancora una
   scheda, con tutto quello che serve per scriverla, e il ritratto
   del lettore per i richiami personali.

   Uso: node tools/schede.mjs
   ══════════════════════════════════════════════════════════ */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const QUANTI = 20;   // per mattina: la routine deve finire in tempi umani
const ORDINE = { cinema: 0, casa: 1, visto: 2 };

const catalogo = JSON.parse(await readFile(join(ROOT, 'data', 'movies.json'), 'utf8'));
const movies = catalogo.movies;

let schede = {};
try { schede = JSON.parse(await readFile(join(ROOT, 'data', 'schede.json'), 'utf8')); } catch { /* prima volta */ }

/* Il ritratto: da cosa hai visto. Serve alla redazione per dire
   "ha le stesse vibes di X" con un X che hai davvero guardato. */
const visti = movies.filter(m => m.lista === 'visto');
const conta = (lista, chiave) => {
  const c = new Map();
  for (const m of lista) for (const k of chiave(m)) if (k) c.set(k, (c.get(k) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]);
};
const ritratto = {
  generi:  conta(visti, m => m.genres || []).slice(0, 6).map(([g, n]) => `${g} (${n})`),
  registi: conta(visti, m => [m.director]).slice(0, 12).map(([r, n]) => n > 1 ? `${r} (${n})` : r),
  attori:  conta(visti, m => (m.castDetail || []).slice(0, 6).map(c => c.name)).filter(([, n]) => n >= 2).slice(0, 12).map(([a, n]) => `${a} (${n})`),
  filmVisti: visti.map(m => `${m.title}${m.release ? ' (' + m.release.slice(0, 4) + ')' : ''}${m.director ? ', ' + m.director : ''}`)
};

/* Chi aspetta una scheda: chi non ce l'ha, o ce l'ha scritta con
   dati che nel frattempo sono cambiati (trama arrivata dopo). */
const impronta = m => `${m.title}|${(m.plot || '').length}|${m.director || ''}`;
const daFare = movies
  // Senza "dopo" è una scheda della prima versione, prima che la
  // redazione guardasse anche fuori dalla libreria: va riscritta.
  .filter(m => !schede[m.id] || schede[m.id].impronta !== impronta(m) || !Array.isArray(schede[m.id].dopo))
  // Prima quelli al cinema (è lì che serve decidere in fretta), poi
  // quelli da vedere a casa, per ultimi i visti.
  .sort((a, b) => ORDINE[a.lista] - ORDINE[b.lista] || (a.release || '').localeCompare(b.release || ''))
  .slice(0, QUANTI)
  .map(m => ({
    id: m.id, tmdbId: m.tmdbId || null, imdbId: m.imdbId || null,
    titolo: m.title, titoloOriginale: m.originalTitle || null,
    anno: (m.release || '').slice(0, 4) || null, uscitaItalia: m.release || null,
    lista: m.lista, regia: m.director || null, generi: m.genres || [], paesi: m.countries || [],
    durata: m.runtime || null, tagline: m.tagline || null,
    cast: (m.castDetail || []).slice(0, 8).map(c => c.character ? `${c.name} (${c.character})` : c.name),
    tramaTmdb: m.plot || null,
    impronta: impronta(m)
  }));

await writeFile(join(ROOT, 'data', 'da-redigere.json'), JSON.stringify({
  preparato: new Date().toISOString(),
  ritratto,
  film: daFare
}, null, 2) + '\n');

/* Le schede di film usciti dalla libreria non servono più. */
const vivi = new Set(movies.map(m => m.id));
const potate = Object.fromEntries(Object.entries(schede).filter(([id]) => vivi.has(id)));
if (Object.keys(potate).length !== Object.keys(schede).length)
  await writeFile(join(ROOT, 'data', 'schede.json'), JSON.stringify(potate, null, 2) + '\n');

console.log(`✅ data/da-redigere.json — ${daFare.length} film da redigere (${Object.keys(potate).length} schede già scritte, ${movies.length} film in libreria).`);
daFare.slice(0, 6).forEach(f => console.log(`   · ${f.titolo}${f.tramaTmdb ? '' : ' — SENZA TRAMA'}`));
