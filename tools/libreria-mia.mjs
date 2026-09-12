#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════
   libreria-mia.mjs — porta il tuo stato personale nel repository

   I voti, i "visto", i film aggiunti dai trailer e dalle scoperte,
   i "non mi interessa": vivono nel browser e, se hai fatto
   l'accesso nell'app, nella tua riga di Supabase. La redazione
   del mattino però legge solo il repository. Questo script entra
   in Supabase esattamente come fa l'app — email e password, con la
   anon key pubblica — quindi vede la tua riga e nient'altro, e
   scrive data/libreria-mia.json.

   Cosa ci finisce: per ogni film visto/voto/lista/da rivedere, i
   dati dei film aggiunti da te, l'elenco degli scartati. Cosa NON
   ci finisce: le note, l'email, qualsiasi token.

   Uso: CINETECA_EMAIL=… CINETECA_PASSWORD=… node tools/libreria-mia.mjs
   Senza credenziali non fa niente e non tocca il file esistente.
   ══════════════════════════════════════════════════════════ */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TABELLA = 'cineteca_states';

const email = process.env.CINETECA_EMAIL;
const password = process.env.CINETECA_PASSWORD;
if (!email || !password) {
  console.log('Senza CINETECA_EMAIL e CINETECA_PASSWORD: salto, tengo data/libreria-mia.json com\'è.');
  process.exit(0);
}

/* URL e anon key stanno in js/cloud-config.js: una verità sola. */
const config = await readFile(join(ROOT, 'js', 'cloud-config.js'), 'utf8');
const URL_SB = config.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)?.[1];
const ANON   = config.match(/SUPABASE_ANON_KEY\s*=\s*["']([^"']+)["']/)?.[1];
if (!URL_SB || !ANON) { console.error('js/cloud-config.js non contiene SUPABASE_URL / SUPABASE_ANON_KEY.'); process.exit(1); }

async function chiama(path, opzioni = {}) {
  const res = await fetch(URL_SB + path, {
    ...opzioni,
    headers: { apikey: ANON, 'Content-Type': 'application/json', ...(opzioni.headers || {}) },
    signal: AbortSignal.timeout(20000)
  });
  const corpo = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${corpo?.msg || corpo?.error_description || corpo?.message || ''}`.trim());
  return corpo;
}

/* 1. accesso come dall'app */
const sessione = await chiama('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
const token = sessione.access_token;
const uid = sessione.user?.id;
if (!token || !uid) { console.error('Accesso riuscito ma senza sessione: risposta inattesa.'); process.exit(1); }

/* 2. la mia riga, e solo quella (le policy RLS non ne darebbero altre) */
const righe = await chiama(`/rest/v1/${TABELLA}?select=data,updated_at&user_id=eq.${uid}`, { headers: { Authorization: `Bearer ${token}` } });
const riga = righe?.[0];
if (!riga?.data) { console.log('Nessuna riga in cloud per questo utente: fai "Sincronizza ora" nell\'app. Non scrivo niente.'); process.exit(0); }
const stato = riga.data;

/* 3. solo quello che serve alla redazione */
const film = {};
for (const [id, u] of Object.entries(stato.movies || {})) {
  const voce = {
    seen: Boolean(u.seen), myRating: u.myRating || 0, rewatch: Boolean(u.rewatch), pronto: Boolean(u.pronto),
    rimosso: Boolean(u.rimosso), listaScelta: u.listaScelta || null, seenAt: u.seenAt || null, updatedAt: u.updatedAt || u.addedAt || null
  };
  film[id] = voce;
}
const extra = {};
for (const [id, x] of Object.entries(stato.extra || {})) {
  const { note, ...dati } = x;
  extra[id] = dati;
}
const scartati = Object.keys(stato.scartati || {});

/* Se non è cambiato niente, il file resta uguale e il workflow non
   fa un commit vuoto per il solo timestamp. */
const nuovo = { film, extra, scartati };
let vecchio = null;
try { vecchio = JSON.parse(await readFile(join(ROOT, 'data', 'libreria-mia.json'), 'utf8')); } catch { /* prima volta */ }
const uguale = vecchio && JSON.stringify({ film: vecchio.film, extra: vecchio.extra, scartati: vecchio.scartati }) === JSON.stringify(nuovo);

if (!uguale) {
  await writeFile(join(ROOT, 'data', 'libreria-mia.json'), JSON.stringify({
    aggiornato: new Date().toISOString(), sincronizzato: riga.updated_at || null, ...nuovo
  }, null, 2) + '\n');
}

const visti = Object.values(film).filter(u => u.seen && !u.rimosso).length;
const votati = Object.values(film).filter(u => u.myRating).length;
console.log(`✅ data/libreria-mia.json${uguale ? ' (invariato)' : ''} — ${Object.keys(film).length} film toccati, ${visti} visti, ${votati} con stelle, ${Object.keys(extra).length} aggiunti da te, ${scartati.length} scartati.`);
