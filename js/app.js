/* ══════════════════════════════════════════════════════════
   app.js — filtri, griglia, hero, avvio
   ══════════════════════════════════════════════════════════ */

(() => {
  const $ = sel => document.querySelector(sel);

  const grid    = $('#grid');
  const heroEl  = $('#hero');
  const countEl = $('#count');
  const emptyEl = $('#empty');
  const qInput  = $('#q');

  const filtro = { q: '', status: 'cinema', sort: 'release', verso: 1, layout: 'grid' };
  let meta = {};

  /* ── selezione e ordinamento ─────────────────────────── */
  function visibili() {
    const q = filtro.q.toLowerCase().trim();

    /* Tre gruppi che non si sovrappongono: dove lo devo vedere,
       oppure l'ho già visto e non importa più dove.
       Quando cerchi, però, i gruppi si aprono: cercare "chastain"
       e non trovare Mammina perché sta in un'altra scheda è assurdo. */
    let films = Store.all().filter(m => {
      if (!q) {
        if (filtro.status === 'seen') { if (!m.user.seen) return false; }
        else if (m.user.seen || m.lista !== filtro.status) return false;
        return true;
      }

      return [m.title, m.originalTitle, m.director, m.plot,
              ...m.genres, ...m.countries,
              ...m.cast.map(c => typeof c === 'string' ? c : c.name)]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });

    const ordini = {
      release:  (a, b) => (a.releaseDate?.getTime() ?? Infinity) - (b.releaseDate?.getTime() ?? Infinity),
      title:    (a, b) => a.title.localeCompare(b.title, 'it'),
      rating:   (a, b) => (b.tmdbRating || 0) - (a.tmdbRating || 0),
      rt:       (a, b) => (b.rtScore ?? -1) - (a.rtScore ?? -1),
      myRating: (a, b) => (b.user.myRating || 0) - (a.user.myRating || 0),
      pronto:   (a, b) => (b.user.pronto === true) - (a.user.pronto === true)
                       || (a.releaseDate?.getTime() ?? Infinity) - (b.releaseDate?.getTime() ?? Infinity),
      runtime:  (a, b) => (b.runtime || 0) - (a.runtime || 0),
      added:    (a, b) => String(b.user.addedAt || '').localeCompare(String(a.user.addedAt || ''))
    };
    /* Il verso moltiplica il confronto: -1 legge lo stesso criterio
       dalla fine. Un solo interruttore per tutti gli ordinamenti,
       invece di raddoppiare le voci dell'elenco. */
    const criterio = ordini[filtro.sort] || ordini.release;
    films.sort((a, b) => criterio(a, b) * filtro.verso);

    // Quelli che hai segnato pronti restano sempre in testa: sono
    // la risposta a "cosa guardo stasera", e non è una questione
    // di ordine ma di urgenza — quindi il verso non li tocca.
    if (!q) films.sort((a, b) => (b.user.pronto === true) - (a.user.pronto === true));
    return films;
  }

  /* ── card ────────────────────────────────────────────── */
  /* Angolo in basso a destra: quando esce. Ce l'hanno tutti i film.
     L'ambra resta riservata all'imminenza, così mantiene un senso. */
  function badgeUscita(m) {
    /* Su un film già visto la data non serve più: "USCITO" o "GIÀ
       PASSATO" dicono una cosa che sai. Serve invece sapere se l'hai
       già giudicato. Le stelle piene lo dicono a colpo d'occhio, e
       dove non ce ne sono c'è un film che aspetta un voto. */
    if (m.user.seen) {
      const v = m.user.myRating;
      return v
        ? { testo: '★'.repeat(v), voto: true }
        : { testo: 'DA VOTARE', davotare: true };
    }
    // Il popcorn dice già che si può guardare: "uscito" sarebbe una ripetizione.
    if (m.user.pronto && !m.user.seen) return null;
    const g = F.giorniA(m.releaseDate);
    if (g === null) return { testo: 'TBA', hot: false };
    if (g === 0)    return { testo: 'OGGI', hot: true };
    if (g > 0)      return { testo: `${g}G`, hot: g <= 30 };
    // Già uscito: cambia cosa è utile sapere a seconda della lista.
    if (m.lista === 'casa') return { testo: 'USCITO', hot: false };
    // Nelle multisala la tenitura vera è di circa dieci settimane:
    // oltre, dire "in sala" sarebbe una bugia.
    if (g >= -70) return { testo: 'IN SALA', live: true };
    return { testo: 'GIÀ PASSATO', hot: false };
  }

  /* Angolo in alto a destra: un voto solo, scelto per quanto ci si
     può contare — non per quale capita di avere per primo.

     La regola vecchia era "Rotten Tomatoes, altrimenti TMDB", e
     mostrava numeri che sembravano autorevoli e non lo erano: su Deep
     Water diceva TMDB 7.1, media di 462 persone, mentre settemila
     utenti IMDb dicevano 5.5 e la critica 53. Su Hopper diceva 7.3,
     ricavato da nove voti in croce.

     L'ordine ora è questo, dal più solido al più fragile:
       · Rotten Tomatoes — decine di critici, giudizio sì/no
       · Metacritic      — media pesata degli stessi critici
       · IMDb            — pubblico, ordini di grandezza più votanti
       · TMDB            — pubblico, pochi votanti e mano generosa
     e sotto una manciata di voti non si mostra niente: meglio un
     angolo vuoto di un numero che non regge.

     Colore solo sulle due scale da cento della critica, dove le
     soglie vogliono dire qualcosa. Una media da uno a dieci del
     pubblico resta neutra: non c'è un "sei in pagella". */
  const VOTI_MINIMI = { imdb: 250, tmdb: 50 };

  function badgeVoto(m) {
    if (m.rtScore != null)
      return { testo: `🍅 ${m.rtScore}%`, cls: m.rtScore >= 60 ? 'badge-score' : 'badge-rotten' };

    // Soglie di Metacritic: 61 promosso, sotto 40 bocciato.
    if (m.metascore != null)
      return { testo: `MC ${m.metascore}`,
               cls: m.metascore >= 61 ? 'badge-score'
                  : m.metascore >= 40 ? 'badge-neutro' : 'badge-rotten' };

    if (m.imdbRating && (m.imdbVotes || 0) >= VOTI_MINIMI.imdb)
      return { testo: `IMDb ${m.imdbRating.toFixed(1)}`, cls: 'badge-neutro' };

    if (m.tmdbRating && (m.tmdbVotes || 0) >= VOTI_MINIMI.tmdb)
      return { testo: `TMDB ${m.tmdbRating.toFixed(1)}`, cls: 'badge-neutro' };

    return null;
  }

  function card(m) {
    const img = F.poster(m);
    const uscita = badgeUscita(m);
    const voto = badgeVoto(m);
    const prev = F.prevendita(m);
    // Popcorn: lo decidi tu, non lo deduco dalla data.
    const pronto = m.user.pronto && !m.user.seen;

    return `<div class="card">
      <button class="poster" data-open="${F.esc(m.id)}" aria-label="Apri ${F.esc(m.title)}">
        ${img
          ? `<img src="${img}" alt="Locandina di ${F.esc(m.title)}" loading="lazy">`
          : `<span class="poster-fallback"><b>${F.esc(m.title)}</b><span>${F.esc(F.dataBreve(m.releaseDate))}</span></span>`}
        <span class="poster-top">
          ${m.user.rewatch
            ? '<span class="badge badge-rewatch">↻ DA RIVEDERE</span>'
            : m.user.seen ? '<span class="badge badge-seen">VISTO</span>' : '<span></span>'}
          ${voto ? `<span class="badge ${voto.cls}">${F.esc(voto.testo)}</span>` : ''}
        </span>
        ${prev ? `<span class="poster-prev">
          <span class="badge badge-prev${prev.urgente ? ' is-urgente' : ''}">${
            prev.urgente ? '<i class="live-dot"></i>' : '🎫 '}${F.esc(prev.breve)}</span>
        </span>` : ''}
        ${pronto ? '<span class="poster-pronto"><span class="badge badge-pronto">🍿 PRONTO</span></span>' : ''}
        ${uscita ? `<span class="poster-bottom">
          <span class="badge ${uscita.voto ? 'badge-mio' : uscita.davotare ? 'badge-davotare'
            : uscita.live ? 'badge-live' : uscita.hot ? 'badge-hot' : 'badge-soon'}">${
            uscita.live ? '<i class="live-dot"></i>' : ''}${F.esc(uscita.testo)}</span>
        </span>` : ''}
      </button>
      <div class="card-meta">
        <h3>${F.esc(m.title)}</h3>
        <p>${F.esc(F.dataBreve(m.releaseDate))}${
          m.releaseFonte === 'US' || m.releaseFonte === 'globale'
            ? '<span class="stimata" title="Data non ancora confermata per l\'Italia">≈</span>' : ''
          } · ${F.esc(m.genres[0] || '—')}${F.durata(m.runtime) ? ` · ${F.durata(m.runtime)}` : ''}</p>
      </div>
    </div>`;
  }

  /* ── hero: il prossimo film che esce ─────────────────── */
  let prossimo = null;

  /* Solo le cifre, una volta al secondo: ridisegnare tutto l'hero
     ogni secondo farebbe sfarfallare l'immagine di sfondo. */
  function tickCountdown() {
    const box = heroEl.querySelector('.hero-count');
    if (!box || !prossimo) return;
    const cd = F.countdown(prossimo.releaseDate);
    if (!cd.length) return;

    // Scaduto: il film è uscito, la libreria va ricalcolata.
    if (cd.every(c => c.v === 0)) { render(); return; }

    box.innerHTML = cd.map(c =>
      `<span class="cd"><b>${String(c.v).padStart(2, '0')}</b><i>${c.l[0]}</i></span>`).join('');
  }

  function renderHero() {
    const next = Store.all()
      .filter(m => m.lista === 'cinema' && !m.user.seen && (F.giorniA(m.releaseDate) ?? -1) >= 0)
      .sort((a, b) => a.releaseDate - b.releaseDate)[0];

    prossimo = next || null;
    if (!next) { heroEl.hidden = true; return; }
    heroEl.hidden = false;

    const bg = F.backdrop(next) || F.poster(next, 'w780');
    heroEl.innerHTML = `
      ${bg ? `<img class="hero-bg" src="${bg}" alt="">` : ''}
      <button class="hero-inner" data-open="${F.esc(next.id)}">
        <span class="hero-kicker">Prossima uscita</span>
        <h1>${F.esc(next.title)}</h1>
        <p class="hero-sub">${F.esc(F.dataLunga(next.releaseDate))}${
          next.director ? ` · ${F.esc(next.director)}` : ''}</p>
        <div class="hero-count">
          ${F.countdown(next.releaseDate).map(c =>
            `<span class="cd"><b>${String(c.v).padStart(2, '0')}</b><i>${c.l[0]}</i></span>`).join('')}
        </div>
      </button>
      ${next.trailer ? `<a class="hero-trailer" href="${F.esc(next.trailer)}" target="_blank" rel="noopener"
        aria-label="Trailer"><svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8V4z"/></svg></a>` : ''}`;
  }

  /* ── render principale ───────────────────────────────── */
  function render() {
    const films = visibili();
    const tot = Store.all().length;

    grid.className = `grid${filtro.layout === 'list' ? ' is-list' : ''}`;
    grid.innerHTML = films.map(card).join('');
    emptyEl.hidden = films.length > 0;

    const cercando = filtro.q.trim().length > 0;
    const etichetta = { cinema: 'da vedere al cinema', casa: 'da vedere a casa', seen: 'già visti' };
    countEl.textContent = cercando
      ? `${films.length} ${films.length === 1 ? 'risultato' : 'risultati'} in tutta la libreria`
      : `${films.length} film ${etichetta[filtro.status]} · ${tot} in libreria`;

    // L'hero ha senso solo sulla lista del cinema, e non mentre cerchi.
    heroEl.hidden = cercando || filtro.status !== 'cinema';
    if (!heroEl.hidden) renderHero();
    if ($('#view-perte').classList.contains('is-active')) PerTe.render();
    if ($('#view-stats').classList.contains('is-active')) Stats.render();
  }

  /* ── passare da una lista all'altra ───────────────────
     Le tre liste stanno in fila, nell'ordine della barra. Ci si
     arriva toccando o scorrendo col dito: è lo stesso movimento,
     quindi è lo stesso codice.

     Cambiare lista non deve spostare la barra sotto il dito: segno
     dov'era prima, ridisegno, e riporto lo scroll dove serve perché
     resti allo stesso punto dello schermo. */
  const LISTE = ['cinema', 'casa', 'seen'];

  function cambiaLista(status, verso = 0) {
    if (status === filtro.status) return;

    const barra = $('#filter-status');
    const prima = barra.getBoundingClientRect().top;

    filtro.status = status;
    syncChips('#filter-status', 'status');
    render();

    const scarto = barra.getBoundingClientRect().top - prima;
    if (scarto) window.scrollBy(0, scarto);

    // Col dito la lista entra dal lato da cui l'hai chiamata.
    if (verso) {
      const griglia = $('#grid');
      griglia.classList.remove('entra-da-destra', 'entra-da-sinistra');
      void griglia.offsetWidth;                       // riavvia l'animazione
      griglia.classList.add(verso > 0 ? 'entra-da-destra' : 'entra-da-sinistra');
    }
  }

  /* ── eventi ──────────────────────────────────────────── */
  document.addEventListener('click', e => {
    const open = e.target.closest('[data-open]');
    if (open) return Detail.open(open.dataset.open);

    const status = e.target.closest('[data-status]');
    if (status) return cambiaLista(status.dataset.status);

    const layout = e.target.closest('[data-layout]');
    if (layout) { filtro.layout = layout.dataset.layout; syncChips('#layout', 'layout'); return render(); }

    /* Un nome toccato è una domanda sola: "e di questo, cosa ho?".
       La ricerca la sa già rispondere — cerca anche fra regia e cast —
       quindi non serve una vista nuova: basta portarcela. */
    const persona = e.target.closest('[data-persona]');
    if (persona) {
      if (Detail.isOpen()) Detail.close();
      qInput.value = persona.dataset.persona;
      filtro.q = persona.dataset.persona;
      mostraVista('library');
      render();
      return;
    }

    const tab = e.target.closest('[data-view]');
    if (tab) mostraVista(tab.dataset.view);
  });

  function mostraVista(nome) {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.view === nome));
    document.querySelectorAll('.view').forEach(v =>
      v.classList.toggle('is-active', v.id === `view-${nome}`));
    if (nome === 'stats')   Stats.render();
    if (nome === 'perte')   PerTe.render();
    if (nome === 'notizie') Notizie.render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function syncChips(container, attr) {
    document.querySelectorAll(`${container} [data-${attr}]`).forEach(el =>
      el.classList.toggle('is-active', el.dataset[attr] === filtro[attr === 'layout' ? 'layout' : 'status']));
  }

  /* ── sfogliare le liste col dito ──────────────────────
     Tre liste in fila si sfogliano come pagine: trascina a sinistra
     per la successiva, a destra per la precedente.

     Un gesto va riconosciuto per quello che è, non appena si muove
     qualcosa. Quattro cose lo distinguono da uno scroll o da un tap:
     dev'essere lungo, più orizzontale che verticale, abbastanza
     rapido, e non deve partire dai bordi — quelli sono del sistema,
     che ci fa "indietro" e Control Center. */
  const vistaLibreria = $('#view-library');
  let gesto = null;

  vistaLibreria.addEventListener('touchstart', e => {
    gesto = null;
    if (e.touches.length !== 1 || Detail.isOpen()) return;

    const t = e.touches[0];
    if (t.clientX < 28 || t.clientX > window.innerWidth - 28) return;
    // Dove si scorre già in orizzontale per conto proprio, il gesto non è mio.
    if (e.target.closest('input, select, textarea, [data-scorre]')) return;

    gesto = { x: t.clientX, y: t.clientY, quando: Date.now() };
  }, { passive: true });

  vistaLibreria.addEventListener('touchend', e => {
    if (!gesto) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - gesto.x;
    const dy = t.clientY - gesto.y;
    const durata = Date.now() - gesto.quando;
    gesto = null;

    if (durata > 800) return;                      // troppo lento: stavi leggendo
    if (Math.abs(dx) < 60) return;                 // troppo corto: era un tocco
    if (Math.abs(dx) < Math.abs(dy) * 1.6) return; // troppo storto: stavi scorrendo

    const i = LISTE.indexOf(filtro.status);
    const j = dx < 0 ? i + 1 : i - 1;
    // Ai due capi ci si ferma: la fila non gira su se stessa, altrimenti
    // dall'ultima lista si finirebbe alla prima senza capire perché.
    if (j < 0 || j >= LISTE.length) return;

    cambiaLista(LISTE[j], dx < 0 ? 1 : -1);
  }, { passive: true });

  qInput.addEventListener('input', () => { filtro.q = qInput.value; render(); });
  /* Come si chiama il verso, criterio per criterio. Dire "crescente"
     e "decrescente" è corretto e non serve a niente: quello che vuoi
     sapere è se in cima trovi i film vecchi o quelli nuovi. */
  const VERSI = {
    release:  ['dai più vecchi', 'dai più nuovi'],
    title:    ['A → Z', 'Z → A'],
    rating:   ['dai voti alti', 'dai voti bassi'],
    rt:       ['dai voti alti', 'dai voti bassi'],
    myRating: ['dai voti alti', 'dai voti bassi'],
    runtime:  ['dai più lunghi', 'dai più corti'],
    added:    ['dalle ultime aggiunte', 'dalle prime aggiunte']
  };
  /* Sul telefono i tre comandi stanno su una riga sola: lì la parola
     da sola basta, la freccia dice il resto. */
  const VERSI_CORTI = {
    release:  ['vecchi', 'nuovi'],
    title:    ['A → Z', 'Z → A'],
    rating:   ['alti', 'bassi'],
    rt:       ['alti', 'bassi'],
    myRating: ['alti', 'bassi'],
    runtime:  ['lunghi', 'corti'],
    added:    ['ultime', 'prime']
  };

  const versoEl = $('#verso');

  function syncVerso() {
    // Con i "pronti prima" il verso non ha presa: quei film restano in
    // testa comunque, quindi l'interruttore mentirebbe. Si nasconde.
    const voci = VERSI[filtro.sort];
    versoEl.hidden = !voci;
    if (!voci) return;

    const giu = filtro.verso === 1;
    const corte = VERSI_CORTI[filtro.sort];
    versoEl.innerHTML = `<span class="verso-freccia">${giu ? '↓' : '↑'}</span><span class="verso-lungo">${F.esc(voci[giu ? 0 : 1])}</span><span class="verso-corto">${F.esc(corte[giu ? 0 : 1])}</span>`;
    versoEl.setAttribute('aria-label', `Ordine: ${voci[giu ? 0 : 1]}. Tocca per invertirlo.`);
  }

  $('#sort').addEventListener('change', e => {
    filtro.sort = e.target.value;
    // Ogni criterio riparte dal suo verso naturale: passando a
    // "titolo" ci si aspetta la A in cima, non la Z perché prima si
    // guardavano i film dal più recente.
    filtro.verso = 1;
    syncVerso();
    render();
  });

  versoEl.addEventListener('click', () => {
    filtro.verso = -filtro.verso;
    syncVerso();
    render();
  });

  syncVerso();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && Detail.isOpen()) return Detail.close();
    if (e.key === '/' && document.activeElement !== qInput) { e.preventDefault(); qInput.focus(); }
  });

  /* Ogni modifica allo stato personale ridisegna la libreria. */
  Store.subscribe(render);

  function aggiornaFooter() {
    if (!meta.enriched) {
      $('#footer-meta').textContent = 'Catalogo base da Notion — lancia tools/enrich.mjs per locandine, voti e statistiche';
      return;
    }
    // Cito OMDb solo se i suoi voti sono davvero nel catalogo.
    const conOmdb = Store.all().some(m => m.rtScore != null || m.imdbRating);
    $('#footer-meta').textContent =
      `Dati aggiornati al ${new Date(meta.enrichedAt).toLocaleDateString('it-IT')} · `
      + (conOmdb ? 'fonti TMDB e OMDb' : 'fonte TMDB');
  }

  /* Riapertura dell'app: il catalogo può contenere voti pubblicati
     nel frattempo, quindi lo rileggo invece di fidarmi di quello in memoria. */
  async function riprendi() {
    try {
      meta = await Store.refresh();
      render();
      aggiornaFooter();
    } catch (err) {
      console.warn('Catalogo non ricaricabile, tengo quello già in memoria.', err);
      render();
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) riprendi();
  });

  /* ── avvio ───────────────────────────────────────────── */
  Store.init()
    .then(info => {
      meta = info;
      render();
      aggiornaFooter();
      Novita.render(Store.all());
      setInterval(tickCountdown, 1000);
    })
    .catch(err => {
      console.error(err);
      grid.innerHTML = `<p class="empty">${F.esc(err.message)}<br><br>
        Se hai aperto il file con doppio clic: serve un server locale.<br>
        Nella cartella del progetto lancia <code>python3 -m http.server 8080</code></p>`;
    });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
