/* ══════════════════════════════════════════════════════════
   libreria.mjs — la libreria come la vedi tu, non come sta su Notion

   Il catalogo (data/movies.json) viene dall'export di Notion. Ma
   la libreria vera è quella dell'app: i film che hai aggiunto dai
   trailer e dalle scoperte, quelli che hai segnato visti, le
   stelle, quelli che hai tolto. Tutto questo vive nel tuo stato
   personale (browser + Supabase), e tools/libreria-mia.mjs lo
   porta nel repository in data/libreria-mia.json.

   Qui c'è la funzione che li fonde: chi prepara il lavoro della
   redazione (schede, rassegna, scoperte) la usa per ragionare
   sulla libreria completa. Se il file manca, il catalogo passa
   intatto: il ponte è un miglioramento, non una dipendenza.
   ══════════════════════════════════════════════════════════ */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function leggiLibreriaMia(root) {
  try { return JSON.parse(await readFile(join(root, 'data', 'libreria-mia.json'), 'utf8')); }
  catch { return null; }
}

/* Lo stato personale ha la precedenza sul catalogo: "visto" batte la
   lista di Notion, lo spostamento manuale pure, e un film tolto non
   c'è più. I film aggiunti da te si accodano con la stessa forma di
   quelli del catalogo, così nessuno a valle deve distinguerli. */
export function applicaLibreriaMia(movies, mia) {
  if (!mia) return movies;
  const stato = mia.film || {};
  const listaDi = (u, base) => u.seen ? 'visto' : (u.listaScelta || (base === 'visto' ? 'casa' : base));
  const out = [];

  for (const m of movies) {
    const u = stato[m.id];
    if (!u) { out.push(m); continue; }
    if (u.rimosso) continue;
    out.push({ ...m, lista: listaDi(u, m.lista), voto: u.myRating || null, rivedere: Boolean(u.rewatch || m.rivedere) });
  }

  for (const [id, x] of Object.entries(mia.extra || {})) {
    const u = stato[id] || {};
    if (u.rimosso || out.some(m => m.id === id)) continue;
    out.push({
      ...x, id, source: 'app',
      genres: x.genres || [], countries: x.countries || [], cast: x.cast || [], castDetail: x.castDetail || [],
      lista: listaDi(u, x.lista || 'casa'), voto: u.myRating || null, rivedere: Boolean(u.rewatch)
    });
  }
  return out;
}

/* Un film visto, in una riga, per il ritratto del lettore: titolo,
   anno, regia e — quando ci sono — le stelle che gli hai dato. */
export const rigaVisto = m =>
  `${m.title}${m.release ? ' (' + m.release.slice(0, 4) + ')' : ''}${m.director ? ', ' + m.director : ''}${m.voto ? ' · ' + '★'.repeat(m.voto) : ''}`;
