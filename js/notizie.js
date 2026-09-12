/* ══════════════════════════════════════════════════════════
   notizie.js — la rassegna

   Una rassegna vera ha un ordine di lettura: prima la cosa del
   giorno, poi le ultime ore, poi ciò di cui tutti parlano, poi
   le letture lunghe, le chicche, e in fondo quello che il tempo
   ha reso interessante. Ogni sezione ha una forma sua, perché
   l'occhio deve capire dove si trova senza leggere l'etichetta.
   ══════════════════════════════════════════════════════════ */

const Notizie = (() => {
  const root = document.getElementById('notizie');
  const LETTE = 'cineteca:notizie-lette';
  const TMDB = 'https://image.tmdb.org/t/p';
  let dati = null;
  let presentazioni = {};   // data/presentazioni.json: contesto e trama scritti dalla redazione
  let scoperte = null;      // data/scoperte.json: i dieci film di oggi per la cineteca virtuale
  // Le conferme aperte ("sicuro?") e le stelle in attesa: stato di
  // pagina, non di archivio, quindi vive qui e muore con il render.
  let conferma = null;      // tmdbId del trailer con la conferma aperta

  const lette = () => {
    try { return new Set(JSON.parse(localStorage.getItem(LETTE)) || []); }
    catch { return new Set(); }
  };
  const segna = links => {
    try { localStorage.setItem(LETTE, JSON.stringify([...links].slice(-400))); } catch { /* pazienza */ }
  };

  /* "2 h fa" è una notizia, "4 giorni fa" è un ricordo: il tempo
     va detto con la grana giusta per il momento. */
  const quando = iso => {
    if (!iso) return '';
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    if (min < 60)       return min <= 5 ? 'adesso' : `${min} min fa`;
    const h = Math.round(min / 60);
    if (h < 24)         return `${h} h fa`;
    const g = Math.round(h / 24);
    if (g === 1)        return 'ieri';
    if (g < 7)          return `${g} giorni fa`;
    return F.dataBreve(new Date(iso));
  };

  const GIORNI_SETTIMANA = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const oggiEsteso = () => {
    const d = new Date();
    return `${GIORNI_SETTIMANA[d.getDay()]} ${F.dataLunga(d)}`;
  };

  async function carica() {
    if (dati) return dati;
    const leggi = async (file, vuoto) => {
      try { const res = await fetch(`data/${file}?t=${Date.now()}`); return res.ok ? await res.json() : vuoto; }
      catch { return vuoto; }
    };
    [dati, presentazioni, scoperte] = await Promise.all([
      leggi('notizie.json', { notizie: [] }),
      leggi('presentazioni.json', {}),
      leggi('scoperte.json', null)
    ]);
    return dati;
  }

  /* ── pezzi comuni ─────────────────────────────────────── */
  const tit = n => n.it?.titolo || n.titolo;
  /* Certe testate aprono il sommario ripetendo il titolo parola per
     parola: letto sotto il titolo, è un balbettio. Via. */
  const som = n => {
    let s = n.it?.sommario || n.sommario || '';
    const t = tit(n).replace(/[.…]+$/, '');
    if (s.toLowerCase().startsWith(t.toLowerCase().slice(0, 30))) s = s.slice(t.length).replace(/^[\s.:–—-]+/, '');
    // Un sommario troncato a metà parola dal feed: chiudo alla frase intera.
    if (s.length > 170) { const k = s.lastIndexOf('. ', 170); s = (k > 60 ? s.slice(0, k + 1) : s.slice(0, 170).replace(/\s\S*$/, '') + '…'); }
    return s.replace(/^\p{Lu}[\p{Ll}]+\.\S*$/u, '').trim();
  };
  const imgTmdb = (path, size = 'w780') => path ? `${TMDB}/${size}/${String(path).replace(/^\/+/, '')}` : null;

  /* L'immagine dell'articolo; se manca, quella del film di cui parla;
     se manca anche quella, il volto della persona. E se la prima si
     rompe (link scaduto, testata che blocca), l'<img> passa da solo
     alla riserva invece di sparire e lasciare un buco. */
  const riserve = n => [
    imgTmdb(n.soggetti?.find(s => s.backdrop)?.backdrop),
    imgTmdb(n.soggetti?.find(s => s.poster)?.poster, 'w500'),
    imgTmdb(n.soggetti?.find(s => s.profilo)?.profilo, 'h632')
  ].filter(Boolean);
  const immagine = n => n.immagine || riserve(n)[0] || null;
  /* Se anche l'ultima riserva non carica, sparisce il riquadro, non
     solo la foto: un rettangolo grigio vuoto è peggio di una scheda
     di solo testo. */
  const RISERVA = `onerror="if(this.dataset.alt){const a=this.dataset.alt.split('|');this.src=a.shift();this.dataset.alt=a.join('|');}else{(this.closest('.ras-scheda-img,.ras-riga-img')||this).remove();}"`;
  const img = (n, src, extra = '') => {
    const alt = riserve(n).filter(u => u !== src).join('|');
    return `<img src="${F.esc(src)}" alt="" ${extra} data-alt="${F.esc(alt)}" ${RISERVA}>`;
  };

  const fonte = n => `<span class="ras-fonte">${F.esc(n.fonte)}</span><span class="ras-quando">${F.esc(quando(n.data))}</span>`;

  /* La riga "perché ti riguarda": dal curatore se c'è, altrimenti
     dal radar o dal legame con la libreria. */
  const perche = n => {
    if (n.it?.perche) return n.it.perche;
    if (n.radar) return n.radar;
    const mio = n.soggetti?.find(s => s.inLibreria);
    if (mio) return mio.lista === 'visto' ? `${mio.nome}: l'hai visto` : `${mio.nome}: ce l'hai in libreria`;
    return null;
  };

  /* I film della libreria citati diventano un tag che apre la scheda. */
  const tagFilm = n => (n.soggetti || []).filter(s => s.inLibreria && s.filmId).slice(0, 2)
    .map(s => `<button class="ras-tag ras-tag-film" data-open="${F.esc(s.filmId)}">${
      s.lista === 'cinema' ? '🎟️' : s.lista === 'visto' ? '✓' : '🛋️'} ${F.esc(s.nome)}</button>`).join('');

  const nuova = (n, viste) => viste.has(n.link) ? '' : ' is-nuova';

  /* ── i formati ─────────────────────────────────────────── */
  const apertura = (n, viste) => {
    const src = n.immagineGrande || immagine(n);
    const p = perche(n);
    return `<section class="ras-apertura${nuova(n, viste)}">
      <a class="ras-apertura-link" href="${F.esc(n.link)}" target="_blank" rel="noopener">
        ${src ? img(n, src, 'class="ras-apertura-img" loading="eager"') : ''}
        <span class="ras-apertura-testo">
          <span class="ras-kicker"><b>Apertura</b> ${fonte(n)}</span>
          <span class="ras-apertura-titolo">${F.esc(tit(n))}</span>
          ${som(n) ? `<span class="ras-apertura-sommario">${F.esc(som(n))}</span>` : ''}
          ${p ? `<span class="ras-perche">${F.esc(p)}</span>` : ''}
        </span>
      </a>
      ${tagFilm(n) ? `<div class="ras-tags">${tagFilm(n)}</div>` : ''}
    </section>`;
  };

  const scheda = (n, viste) => {
    const src = immagine(n);
    return `<a class="ras-scheda${nuova(n, viste)}" href="${F.esc(n.link)}" target="_blank" rel="noopener">
      <span class="ras-scheda-img">${src ? img(n, src, 'loading="lazy"') : ''}</span>
      <span class="ras-scheda-testo">
        <span class="ras-meta">${fonte(n)}</span>
        <b>${F.esc(tit(n))}</b>
      </span>
    </a>`;
  };

  const riga = (n, viste, { conPerche = true, conImg = true } = {}) => {
    const src = conImg ? immagine(n) : null;
    const p = conPerche ? perche(n) : null;
    return `<div class="ras-riga${nuova(n, viste)}">
      <a class="ras-riga-link" href="${F.esc(n.link)}" target="_blank" rel="noopener">
        ${src ? `<span class="ras-riga-img">${img(n, src, 'loading="lazy"')}</span>` : ''}
        <span class="ras-riga-testo">
          <b>${F.esc(tit(n))}</b>
          ${som(n) ? `<span class="ras-riga-sommario">${F.esc(som(n))}</span>` : ''}
          ${p ? `<span class="ras-perche">${F.esc(p)}</span>` : ''}
          <span class="ras-meta">${fonte(n)}</span>
        </span>
      </a>
      ${tagFilm(n) ? `<div class="ras-tags">${tagFilm(n)}</div>` : ''}
    </div>`;
  };

  const compatta = (n, viste) => `<a class="ras-compatta${nuova(n, viste)}" href="${F.esc(n.link)}" target="_blank" rel="noopener">
      <b>${F.esc(tit(n))}</b>
      <span class="ras-meta">${fonte(n)}</span>
    </a>`;

  const tema = (t, perLink, viste) => {
    const voci = t.link.map(l => perLink.get(l)).filter(Boolean);
    if (!voci.length) return '';
    const foto = imgTmdb(t.backdrop, 'w1280') || voci.map(v => v.immagine).find(Boolean) || imgTmdb(t.poster, 'w500')
      || imgTmdb(voci.flatMap(v => v.soggetti || []).find(s => s.profilo)?.profilo, 'h632');
    const etichetta = t.inLibreria
      ? (t.lista === 'cinema' ? '🎟️ in libreria' : t.lista === 'visto' ? '✓ l\'hai visto' : '🛋️ in libreria')
      : t.tipo === 'film' && t.anno ? t.anno : t.tipo === 'regista' ? 'regista' : t.tipo === 'attore' ? '' : '';
    return `<article class="ras-tema">
      <div class="ras-tema-testa">
        ${foto ? `<img class="ras-tema-img" src="${F.esc(foto)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
        <div class="ras-tema-titolo">
          <span class="ras-tema-nome">${F.esc(t.soggetto)}</span>
          <span class="ras-tema-meta">${t.quante} ${t.quante === 1 ? 'articolo' : 'articoli'} · ${t.testate} ${t.testate === 1 ? 'testata' : 'testate'}${etichetta ? ` · ${F.esc(etichetta)}` : ''}</span>
        </div>
        ${t.inLibreria && t.filmId ? `<button class="ras-tag ras-tag-film" data-open="${F.esc(t.filmId)}">Apri la scheda</button>` : ''}
      </div>
      <div class="ras-tema-voci">${voci.map(v => compatta(v, viste)).join('')}</div>
    </article>`;
  };

  const anniversario = a => {
    const img = imgTmdb(a.poster, 'w342');
    const dentro = `
      <span class="ras-anni-poster">${img ? `<img src="${F.esc(img)}" alt="" loading="lazy">` : ''}</span>
      <span class="ras-anni-quando">${a.anniFa} anni fa</span>
      <b>${F.esc(a.titolo)}</b>
      <span class="ras-anni-meta">${F.esc(a.anno)}${a.generi?.length ? ` · ${F.esc(a.generi.slice(0, 2).join(', '))}` : ''}${a.voto ? ` · ${a.voto}` : ''}</span>
      ${a.perche ? `<span class="ras-perche">${F.esc(a.perche)}</span>` : ''}`;
    return a.inLibreria && a.filmId
      ? `<button class="ras-anni" data-open="${F.esc(a.filmId)}">${dentro}</button>`
      : `<a class="ras-anni" href="https://www.themoviedb.org/movie/${a.tmdbId}" target="_blank" rel="noopener">${dentro}</a>`;
  };

  /* ── contesto e trama di un film che non hai ──────────────
     La redazione del mattino scrive per ogni trailer e per ogni
     proposta una riga di contesto ("il nuovo film di…", "l'atteso
     ritorno di…") e due o tre righe di trama. Finché non l'ha
     fatto, ci si arrangia con quello che TMDB dà: la riga la
     compone il codice da regia e cast, la trama è l'inizio della
     sinossi. Una card senza niente sotto il titolo non deve esistere. */
  const presentazione = t => presentazioni[`tmdb-${t.tmdbId}`] || null;

  const contestoDi = t => {
    const p = presentazione(t);
    if (p?.contesto) return p.contesto;
    if (t.perche) return t.perche;
    const pezzi = [];
    if (t.director) pezzi.push(`regia di ${t.director}`);
    const c = (t.cast || []).slice(0, 2);
    if (c.length) pezzi.push(`con ${c.join(' e ')}`);
    if (!pezzi.length && t.genres?.length) pezzi.push(`${t.genres.slice(0, 2).join(' e ').toLowerCase()}${t.countries?.[0] ? `, ${t.countries[0]}` : ''}`);
    return pezzi.length ? pezzi.join(' · ') : null;
  };

  const tramaDi = t => {
    const p = presentazione(t);
    if (p?.trama) return p.trama;
    if (!t.plot) return null;
    // Le prime due frasi, senza superare le 240 battute e senza spezzare una parola.
    const frasi = t.plot.split(/(?<=[.!?])\s+/);
    let out = frasi[0] || '';
    if (frasi[1] && (out + ' ' + frasi[1]).length <= 240) out += ' ' + frasi[1];
    if (out.length > 240) out = out.slice(0, 240).replace(/\s\S*$/, '') + '…';
    return out;
  };

  /* Il "no" a un trailer chiede conferma: è un film che magari non
     hai nemmeno guardato, e un tocco sbagliato lo farebbe sparire
     per sempre. La conferma sta nella card, al posto dei bottoni. */
  const chiediConferma = t => `<span class="ras-conferma">
      <span class="ras-conferma-testo">Sicuro? Non te lo ripropongo più.</span>
      <button class="ras-tag ras-tag-no" data-scarta="${t.tmdbId}">Sì, toglilo</button>
      <button class="ras-tag" data-annulla-conferma="${t.tmdbId}">No</button>
    </span>`;

  /* Le stelle in linea: appena dici "visto", il voto è a un tocco. */
  const stelle = (id, voto) => `<span class="ras-stelle" role="group" aria-label="Il tuo voto">
      ${[1,2,3,4,5].map(n => `<button class="star${n <= voto ? ' is-on' : ''}" data-stella="${n}" data-film="${F.esc(id)}" aria-label="${n} stelle">★</button>`).join('')}
      ${voto ? `<span class="ras-stelle-detto">votato</span>` : `<span class="ras-stelle-detto">quante stelle?</span>`}
    </span>`;

  /* Un trailer nuovo di un film che non hai: lo guardi e decidi tu
     dove va — al cinema, a casa, o da nessuna parte. */
  const trailer = t => {
    const id = Store.idDiTmdb(t.tmdbId);
    const dentro = Boolean(id);
    const quandoTrailer = quando(t.trailerPubblicato);
    const contesto = contestoDi(t);
    const trama = tramaDi(t);
    return `<article class="ras-trailer${dentro ? ' is-dentro' : ''}" data-tmdb="${t.tmdbId}">
      <a class="ras-trailer-poster" href="${F.esc(t.trailer)}" target="_blank" rel="noopener" aria-label="Guarda il trailer di ${F.esc(t.title)}">
        ${t.poster ? `<img src="${F.esc(imgTmdb(t.poster, 'w342'))}" alt="" loading="lazy">` : ''}
        <span class="ras-trailer-play">▶</span>
      </a>
      <div class="ras-trailer-testo">
        <span class="ras-trailer-quando">${F.esc(t.trailerTipo === 'Teaser' ? 'teaser' : 'trailer')} · ${F.esc(quandoTrailer)}${t.trailerLingua === 'it' ? ' · in italiano' : ''}</span>
        <b>${F.esc(t.title)}</b>
        <span class="ras-trailer-meta">${t.release ? F.esc(F.dataBreve(new Date(t.release + 'T00:00:00'))) + (t.releaseFonte !== 'IT' ? ' <i title="data non confermata per l\'Italia">≈</i>' : '') : 'data da definire'}${t.genres?.length ? ` · ${F.esc(t.genres.slice(0, 2).join(', '))}` : ''}${t.director ? ` · ${F.esc(t.director)}` : ''}</span>
        ${contesto ? `<span class="ras-perche">${F.esc(contesto)}</span>` : ''}
        ${trama ? `<span class="ras-trailer-trama">${F.esc(trama)}</span>` : ''}
        ${conferma === t.tmdbId ? chiediConferma(t) : `<span class="ras-trailer-azioni">
          <a class="ras-tag" href="${F.esc(t.trailer)}" target="_blank" rel="noopener">▶ Trailer</a>
          ${dentro
            ? `<button class="ras-tag ras-tag-film" data-open="${F.esc(id)}">✓ In libreria · apri</button>`
            : `<button class="ras-tag ras-tag-agg" data-aggiungi="${t.tmdbId}" data-lista="cinema">🎟️ Al cinema</button>
               <button class="ras-tag ras-tag-agg" data-aggiungi="${t.tmdbId}" data-lista="casa">🛋️ A casa</button>
               <button class="ras-tag ras-tag-no" data-conferma="${t.tmdbId}" title="Non mi interessa">✕ No</button>`}
        </span>`}
      </div>
    </article>`;
  };

  /* ── costruisci la cineteca ────────────────────────────────
     Dieci film già usciti, ogni giorno, che non hai in libreria:
     scelti fra i registi e gli attori che segui, i tuoi generi,
     i classici e quello che gira adesso. Tu dici solo tre cose —
     visto, da vedere, no — e la tua storia si riempie un film
     alla volta. Un "visto" chiede subito le stelle. */
  const scoperta = f => {
    const id = Store.idDiTmdb(f.tmdbId);
    const u = id ? Store.userState(id) : null;
    const dentro = Boolean(id) && !u?.rimosso;
    const anno = (f.release || '').slice(0, 4);
    const contesto = contestoDi(f);
    const trama = tramaDi(f);
    return `<article class="ras-trailer ras-scoperta${dentro ? ' is-dentro' : ''}" data-tmdb="${f.tmdbId}">
      <button class="ras-trailer-poster ras-scoperta-poster" ${dentro ? `data-open="${F.esc(id)}"` : `data-info="${f.tmdbId}"`} aria-label="${F.esc(f.title)}">
        ${f.poster ? `<img src="${F.esc(imgTmdb(f.poster, 'w342'))}" alt="" loading="lazy">` : ''}
      </button>
      <div class="ras-trailer-testo">
        <span class="ras-trailer-quando ras-scoperta-quando">${F.esc(f.categoria || 'da scoprire')}</span>
        <b>${F.esc(f.title)}</b>
        <span class="ras-trailer-meta">${anno ? F.esc(anno) : ''}${f.genres?.length ? ` · ${F.esc(f.genres.slice(0, 2).join(', '))}` : ''}${f.director ? ` · ${F.esc(f.director)}` : ''}${f.runtime ? ` · ${F.durata(f.runtime)}` : ''}${f.tmdbRating && f.tmdbVotes >= 50 ? ` · TMDB ${f.tmdbRating.toFixed(1)}` : ''}</span>
        ${contesto ? `<span class="ras-perche">${F.esc(contesto)}</span>` : ''}
        ${trama ? `<span class="ras-trailer-trama">${F.esc(trama)}</span>` : ''}
        <span class="ras-trailer-azioni">
          ${dentro
            ? (u.seen
                ? `${stelle(id, u.myRating)}<button class="ras-tag ras-tag-film" data-open="${F.esc(id)}">✓ Visto · apri</button>`
                : `<button class="ras-tag ras-tag-film" data-open="${F.esc(id)}">🛋️ Da vedere · apri</button>`)
            : `<button class="ras-tag ras-tag-agg ras-tag-visto" data-aggiungi="${f.tmdbId}" data-lista="visto">✓ Visto</button>
               <button class="ras-tag ras-tag-agg" data-aggiungi="${f.tmdbId}" data-lista="casa">🛋️ Da vedere</button>
               ${f.trailer ? `<a class="ras-tag" href="${F.esc(f.trailer)}" target="_blank" rel="noopener">▶ Trailer</a>` : ''}
               <button class="ras-tag ras-tag-no" data-scarta="${f.tmdbId}" title="Non mi interessa">✕ No</button>`}
        </span>
      </div>
    </article>`;
  };

  /* Chi resta da giudicare oggi: né in libreria, né scartato. Chi hai
     appena giudicato resta in pagina (le stelle vanno messe adesso),
     ma domani non c'è più. */
  const scoperteVive = () => (scoperte?.film || []).filter(f => !Store.scartato(f.tmdbId));
  const scopertePendenti = () => scoperteVive().filter(f => !Store.haFilm(f.tmdbId));

  const sezione = (kicker, sotto, corpo, cls = '') => corpo
    ? `<section class="ras-sezione ${cls}">
        <header class="ras-testa"><span class="ras-testa-kicker">${kicker}</span>${sotto ? `<span class="ras-testa-sotto">${F.esc(sotto)}</span>` : ''}</header>
        ${corpo}
      </section>` : '';

  /* ── la pagina ─────────────────────────────────────────── */
  async function render() {
    const d = await carica();
    const tutte = d.notizie || [];
    if (!tutte.length) {
      root.innerHTML = '<p class="empty">La rassegna è vuota: il prossimo aggiornamento la riempie.</p>';
      return;
    }

    const viste = lette();
    const perLink = new Map(tutte.map(n => [n.link, n]));
    const prendi = lista => (lista || []).map(l => perLink.get(l)).filter(Boolean);

    const ap = perLink.get(d.apertura);
    const ultime = prendi(d.ultime);
    const temi = (d.temi || []).filter(t => t.link.some(l => perLink.has(l)));
    const radar = prendi(d.radar);
    const libreria = prendi(d.libreria);
    const approfondimenti = prendi(d.approfondimenti);
    const curiosita = prendi(d.curiosita);
    const passato = prendi(d.passato);
    const altre = prendi(d.altre);
    const anni = d.accaddeOggi || [];
    // I trailer di film che hai scartato non tornano più.
    const trailerVivi = (d.trailer || []).filter(t => !Store.scartato(t.tmdbId));
    const scoperteOggi = scoperteVive();
    const pendenti = scopertePendenti();
    const nuove = tutte.filter(n => !viste.has(n.link)).length;

    root.innerHTML = `
      <header class="ras-masthead">
        <div>
          <span class="ras-masthead-nome">La rassegna</span>
          <span class="ras-masthead-data">${F.esc(oggiEsteso())}</span>
        </div>
        <span class="ras-masthead-stato">${nuove ? `<i class="ras-punto"></i>${nuove} ${nuove === 1 ? 'nuova' : 'nuove'} · ` : ''}aggiornata ${F.esc(quando(d.aggiornato))}</span>
      </header>

      ${ap ? apertura(ap, viste) : ''}

      ${sezione('Ultime ore', 'in ordine di arrivo',
        ultime.length ? `<div class="ras-scorri">${ultime.map(n => scheda(n, viste)).join('')}</div>` : '', 'ras-ultime')}

      ${sezione('Se ne parla', 'stesso soggetto, più testate',
        temi.length ? `<div class="ras-temi">${temi.map(t => tema(t, perLink, viste)).join('')}</div>` : '')}

      ${sezione('Trailer della settimana', 'film che non hai: guarda e decidi',
        trailerVivi.length ? `<div class="ras-trailer-griglia">${trailerVivi.map(trailer).join('')}</div>` : '', 'ras-trailer-sez')}

      ${sezione('Costruisci la cineteca', scoperteOggi.length
          ? `film già usciti che non hai in libreria · ${pendenti.length ? `${pendenti.length} da giudicare` : 'fatto per oggi'}`
          : 'film già usciti che non hai in libreria',
        scoperteOggi.length
          ? `<div class="ras-trailer-griglia">${scoperteOggi.map(scoperta).join('')}</div>${
              pendenti.length ? '' : `<p class="ras-fatto">Tutti giudicati. Domani te ne propongo altri dieci.</p>`}`
          : (scoperte ? `<p class="ras-fatto">Per oggi niente da giudicare: domani arrivano altri dieci film.</p>` : ''),
        'ras-scoperte-sez')}

      ${sezione('Nel tuo radar', 'film che non hai, ma che ti somigliano',
        radar.length ? `<div class="ras-righe">${radar.map(n => riga(n, viste)).join('')}</div>` : '', 'ras-radar')}

      ${sezione('I tuoi film', 'ciò che tocca la tua libreria',
        libreria.length ? `<div class="ras-righe">${libreria.map(n => riga(n, viste)).join('')}</div>` : '')}

      ${sezione('Approfondimenti', 'da leggere con calma',
        approfondimenti.length ? `<div class="ras-griglia-2">${approfondimenti.map(n => riga(n, viste, { conPerche: false })).join('')}</div>` : '')}

      ${sezione('Curiosità', 'retroscena e dettagli',
        curiosita.length ? `<div class="ras-righe ras-righe-strette">${curiosita.map(n => riga(n, viste, { conPerche: false })).join('')}</div>` : '')}

      ${sezione('Accadde oggi', anni[0]?.approssimato ? 'usciti in questi giorni, anni fa' : 'usciti oggi, anni fa',
        anni.length ? `<div class="ras-scorri ras-anni-fila">${anni.map(anniversario).join('')}</div>` : '')}

      ${sezione('Dal passato', 'classici, restauri, addii',
        passato.length ? `<div class="ras-righe ras-righe-strette">${passato.map(n => riga(n, viste, { conPerche: false })).join('')}</div>` : '')}

      ${sezione('E ancora', '',
        altre.length ? `<div class="ras-lista">${altre.map(n => compatta(n, viste)).join('')}</div>` : '')}

      <p class="nota ras-nota">Da ${F.esc((d.fonti || []).join(', '))}.${d.curatela
        ? ' Titoli e sommari riscritti in italiano da un redattore automatico; le fonti in inglese sono tradotte.'
        : ' Solo testate italiane, testi originali.'} Le immagini sono delle rispettive testate e di TMDB.</p>`;

    // Aprire la scheda vale come lettura, dopo qualche secondo.
    setTimeout(() => segna(new Set([...viste, ...tutte.map(n => n.link)])), 4000);
  }

  /* Il film di una proposta, ovunque stia: fra le scoperte o fra i trailer. */
  const filmDi = tmdbId => (scoperte?.film || []).find(x => x.tmdbId === tmdbId)
                        || (dati?.trailer || []).find(x => x.tmdbId === tmdbId) || null;

  root.addEventListener('click', e => {
    const apri = e.target.closest('[data-open]');
    if (apri) { e.preventDefault(); return Detail.open(apri.dataset.open); }

    /* Le stelle sulla card appena segnata "visto". */
    const stella = e.target.closest('[data-stella]');
    if (stella) { Store.setRating(stella.dataset.film, Number(stella.dataset.stella)); return render(); }

    /* "Sì, lo voglio": il film entra in libreria nella lista scelta,
       con un ripensamento a portata di mano per qualche secondo. */
    const agg = e.target.closest('[data-aggiungi]');
    if (agg && dati) {
      const t = filmDi(Number(agg.dataset.aggiungi));
      if (!t) return;
      const lista = agg.dataset.lista;
      const id = Store.aggiungi(t, lista);
      render();
      const dove = { cinema: 'da vedere al cinema', casa: 'da vedere a casa', visto: 'fra i film visti' }[lista];
      Avviso.mostra(`<b>${F.esc(t.title)}</b> aggiunto ${dove}${lista === 'visto' ? ' — dagli le stelle' : ''}`,
        'Annulla', () => { Store.disfaAggiunta(id); render(); });
      return;
    }

    /* "No": per i trailer prima si chiede, per le scoperte si toglie
       subito (sono dieci al giorno, una conferma a testa sarebbe una
       tortura) ma con l'annulla lì per sei secondi. */
    const chiedi = e.target.closest('[data-conferma]');
    if (chiedi) { conferma = Number(chiedi.dataset.conferma); return render(); }
    const no = e.target.closest('[data-annulla-conferma]');
    if (no) { conferma = null; return render(); }

    const scarta = e.target.closest('[data-scarta]');
    if (scarta) {
      const tmdbId = Number(scarta.dataset.scarta);
      const t = filmDi(tmdbId);
      conferma = null;
      Store.scarta(tmdbId);
      render();
      Avviso.mostra(`<b>${F.esc(t?.title || 'Film')}</b> non ti verrà più proposto`,
        'Annulla', () => { Store.riammetti(tmdbId); render(); });
      return;
    }

    /* La locandina di una proposta non ancora in libreria: apre TMDB. */
    const info = e.target.closest('[data-info]');
    if (info) { window.open(`https://www.themoviedb.org/movie/${info.dataset.info}?language=it-IT`, '_blank', 'noopener'); }
  });

  return { render };
})();
