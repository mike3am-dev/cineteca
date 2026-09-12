/* ══════════════════════════════════════════════════════════
   store.js — catalogo + stato personale (localStorage)

   Il catalogo arriva da data/movies.json (arricchito con TMDB)
   con fallback a data/seed.json (export da Notion).
   Lo stato personale — visto, preferito, voto, note — vive
   solo nel browser ed è la fonte di verità dell'app.
   ══════════════════════════════════════════════════════════ */

const Store = (() => {
  const KEY = 'cineteca:v1';

  let catalog = [];
  let state = { movies: {}, updatedAt: null };
  const listeners = new Set();

  /* ── persistenza ─────────────────────────────────────── */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) state = { ...state, ...JSON.parse(raw) };
    } catch (err) {
      console.warn('Stato locale illeggibile, riparto da zero.', err);
    }
  }

  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Salvataggio fallito (quota o modalità privata).', err);
    }
    listeners.forEach(fn => fn());
  }

  /* ── stato per singolo film ──────────────────────────── */
  const blank = () => ({
    seen: false, fav: false, myRating: 0, note: '',
    rewatch: false,          // visto al cinema, aspetto che esca per rivederlo
    pronto: false,           // ce l'ho a portata di mano: si guarda quando voglio
    rimosso: false,          // tolto dalla libreria: non mi interessa più
    listaScelta: null,       // sposto io dove sta: 'cinema' | 'casa' | null
    addedAt: null, seenAt: null
  });

  /* Valore di partenza del film: quelli dell'archivio nascono già visti.
     Deve valere anche alla prima modifica, altrimenti mettere una stella
     a un film visto lo farebbe tornare "da vedere". */
  function predefinito(id) {
    const m = catalog.find(x => x.id === id);
    return { ...blank(), seen: m?.lista === 'visto', rewatch: Boolean(m?.rivedere) };
  }

  function userState(id) {
    return { ...predefinito(id), ...(state.movies[id] || {}) };
  }

  function patch(id, changes) {
    const next = { ...userState(id), ...changes };
    if (!next.addedAt) next.addedAt = new Date().toISOString();
    // Serve a fondere due dispositivi: a parità di film vince il più recente.
    next.updatedAt = new Date().toISOString();
    state.movies[id] = next;
    save();
    return next;
  }

  /* ── azioni ──────────────────────────────────────────── */
  const toggleSeen = id => {
    const seen = !userState(id).seen;
    return patch(id, { seen, seenAt: seen ? new Date().toISOString() : null });
  };
  const toggleFav = id => patch(id, { fav: !userState(id).fav });
  const togglePronto = id => patch(id, { pronto: !userState(id).pronto });
  const rimuovi      = id => patch(id, { rimosso: true });
  const ripristina   = id => patch(id, { rimosso: false });
  /* Sposta un film fra cinema e divano senza toccare il catalogo. */
  const spostaIn     = (id, lista) => patch(id, { listaScelta: lista });

  /* Segnare "da rivedere" implica averlo visto. */
  const toggleRewatch = id => {
    const u = userState(id);
    return patch(id, { rewatch: !u.rewatch, seen: u.rewatch ? u.seen : true });
  };
  const setRating = (id, myRating) => patch(id, { myRating });
  const setNote   = (id, note)     => patch(id, { note });

  /* ── catalogo ────────────────────────────────────────── */

  /** Rilegge il catalogo da disco/rete senza toccare lo stato personale. */
  async function refresh() {
    let data = null;
    for (const url of ['data/movies.json', 'data/seed.json']) {
      try {
        const res = await fetch(`${url}?t=${Date.now()}`);
        if (!res.ok) continue;
        data = await res.json();
        break;
      } catch (err) { /* provo la sorgente successiva */ }
    }
    if (!data) throw new Error('Nessun catalogo caricabile (data/movies.json o data/seed.json).');

    catalog = (data.movies || []).map(m => ({
      ...m,
      genres:    m.genres    || [],
      countries: m.countries || [],
      cast:      m.cast      || [],
      releaseDate: m.release ? new Date(`${m.release}T00:00:00`) : null
    }));
    return { enriched: Boolean(data.enrichedAt), enrichedAt: data.enrichedAt || null, source: data.generatedFrom };
  }

  /* Fino alla v2 il valore di partenza "visto" non veniva applicato
     quando si creava il record: mettere una stella a un film
     dell'archivio lo faceva tornare "da vedere". Qui li recupero. */
  function riparaArchivio() {
    if (state.schema >= 2) return;
    let riparati = 0;
    for (const m of catalog) {
      const r = state.movies[m.id];
      if (m.lista === 'visto' && r && r.seen === false && !r.seenAt) {
        r.seen = true;
        riparati++;
      }
    }
    state.schema = 2;
    if (riparati) console.info(`Ripristinati ${riparati} film dell'archivio tornati per errore fra i "da vedere".`);
    save();
  }

  async function init() {
    load();
    const info = await refresh();
    riparaArchivio();
    return info;
  }

  /* film = dati catalogo + stato personale, sempre uniti.
     Lo spostamento manuale ha la precedenza sulla lista del catalogo,
     e i film che hai tolto non compaiono da nessuna parte. */
  function conStato(m) {
    const user = userState(m.id);
    return { ...m, lista: user.listaScelta || m.lista, user };
  }
  /* ── i film aggiunti da te ───────────────────────────────
     Dal trailer alla libreria con un tocco: il film non sta nel
     catalogo del sito, sta nel tuo stato (e quindi si sincronizza
     come tutto il resto). Ha la stessa forma di un film del catalogo
     perché il resto dell'app non deve accorgersi della differenza. */
  const extra = () => Object.values(state.extra || {}).map(x => ({
    ...x, genres: x.genres || [], countries: x.countries || [], cast: x.cast || [],
    releaseDate: x.release ? new Date(`${x.release}T00:00:00`) : null, extra: true
  }));

  /* lista: 'cinema' | 'casa' | 'visto'. "Visto" è un film che entra
     direttamente fra quelli già guardati — la cineteca virtuale si
     costruisce così, un film alla volta — e per l'app è un film da
     casa con la spunta: dove l'avresti visto non conta più. */
  function aggiungi(film, lista) {
    const id = `tmdb-${film.tmdbId}`;
    const visto = lista === 'visto';
    const dove = visto ? 'casa' : lista;
    state.extra = state.extra || {};
    if (!state.extra[id]) {
      const { perche, motivi, origine, youtube, trailerTipo, trailerLingua, trailerPubblicato, contesto, fonte, categoria, proposto, ...dati } = film;
      state.extra[id] = { ...dati, id, lista: dove, addedAt: new Date().toISOString() };
    }
    // Se l'avevi scartato e ora lo vuoi, il ripensamento vince.
    if ((state.scartati || {})[id]) delete state.scartati[id];
    patch(id, visto
      ? { listaScelta: dove, rimosso: false, seen: true, seenAt: new Date().toISOString() }
      : { listaScelta: dove, rimosso: false });
    return id;
  }
  /* L'"annulla" di un'aggiunta appena fatta: il film aggiunto da te
     sparisce del tutto, come se non fosse mai entrato — così una
     proposta torna proponibile. Per un film del catalogo, che non si
     può cancellare, resta il vecchio "tolto dalla libreria". */
  function disfaAggiunta(id) {
    if ((state.extra || {})[id]) { delete state.extra[id]; delete state.movies[id]; save(); }
    else rimuovi(id);
  }
  const haFilm = tmdbId => catalog.some(m => m.tmdbId === tmdbId) || Boolean((state.extra || {})[`tmdb-${tmdbId}`]);
  const idDiTmdb = tmdbId => catalog.find(m => m.tmdbId === tmdbId)?.id || ((state.extra || {})[`tmdb-${tmdbId}`] ? `tmdb-${tmdbId}` : null);

  /* ── i film che non ti interessano ───────────────────────
     Un "no" detto a un trailer o a una proposta vale per sempre:
     quel film non torna né fra i trailer né fra le scoperte. È
     stato personale come il resto, quindi viaggia con la sincronia. */
  const scarta    = tmdbId => { state.scartati = state.scartati || {}; state.scartati[`tmdb-${tmdbId}`] = new Date().toISOString(); save(); };
  const riammetti = tmdbId => { if ((state.scartati || {})[`tmdb-${tmdbId}`]) { delete state.scartati[`tmdb-${tmdbId}`]; save(); } };
  const scartato  = tmdbId => Boolean((state.scartati || {})[`tmdb-${tmdbId}`]);
  const quantiScartati = () => Object.keys(state.scartati || {}).length;

  const all = () => [...catalog, ...extra()].map(conStato).filter(m => !m.user.rimosso);
  /* Compresi quelli tolti: serve solo a poterli ripescare. */
  const tutti = () => [...catalog, ...extra()].map(conStato);
  const byId = id => tutti().find(m => m.id === id) || null;

  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  /* ── ponte verso il cloud ────────────────────────────────
     Il sync non deve conoscere la struttura interna: gli do
     lo stato grezzo e un modo per rimpiazzarlo o fonderlo. */

  const stato = () => JSON.parse(JSON.stringify(state));

  /** Quanti film hai davvero toccato: serve al cloud per non
      sovrascrivere un archivio pieno con uno vuoto. */
  const quantiToccati = () => Object.keys(state.movies || {}).length;

  /** Fonde uno stato remoto con quello locale, film per film:
      a parità di titolo vince la modifica più recente. */
  function fondi(remoto) {
    if (!remoto || !remoto.movies) return false;
    let cambiato = false;

    for (const [id, loro] of Object.entries(remoto.movies)) {
      const mio = state.movies[id];
      if (!mio) { state.movies[id] = loro; cambiato = true; continue; }

      const quandoLoro = Date.parse(loro.updatedAt || loro.addedAt || 0) || 0;
      const quandoMio  = Date.parse(mio.updatedAt  || mio.addedAt  || 0) || 0;
      if (quandoLoro > quandoMio) { state.movies[id] = loro; cambiato = true; }
    }

    // Anche i film aggiunti a mano viaggiano fra i dispositivi.
    for (const [id, loro] of Object.entries(remoto.extra || {})) {
      if (!(state.extra || {})[id]) { state.extra = state.extra || {}; state.extra[id] = loro; cambiato = true; }
    }
    // E i "no": un film scartato su un dispositivo sparisce anche sugli altri.
    for (const [id, quando] of Object.entries(remoto.scartati || {})) {
      if (!(state.scartati || {})[id]) { state.scartati = state.scartati || {}; state.scartati[id] = quando; cambiato = true; }
    }

    if (remoto.schema > (state.schema || 0)) state.schema = remoto.schema;
    if (cambiato) save();
    return cambiato;
  }

  return { init, refresh, all, tutti, byId, userState, aggiungi, disfaAggiunta, haFilm, idDiTmdb,
           scarta, riammetti, scartato, quantiScartati,
           toggleSeen, toggleFav, toggleRewatch, togglePronto, rimuovi, ripristina, spostaIn, setRating, setNote, subscribe,
           stato, fondi, quantiToccati, riparaArchivio };
})();
