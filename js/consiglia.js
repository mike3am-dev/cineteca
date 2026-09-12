/* ══════════════════════════════════════════════════════════
   consiglia.js — il consigliere

   Costruisce un profilo di gusto dai film già visti e lo usa
   per due cose: ordinare la coda di quelli che hai in lista,
   e spiegare *perché* un titolo dovrebbe interessarti.

   Nessun modello, nessuna chiamata di rete: solo i dati che
   hai già in casa. La spiegazione conta quanto il punteggio —
   un consiglio che non sai giustificare non è un consiglio.
   ══════════════════════════════════════════════════════════ */

const Consiglia = (() => {

  /* Il gradimento di un film visto, da -1 a +1.
     Le tue stelle pesano il doppio della critica: è la tua libreria. */
  function gradimento(m) {
    const critica = (() => {
      const v = [m.rtScore, m.metascore, m.imdbRating ? m.imdbRating * 10 : null].filter(x => x != null);
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length / 100 : null;   // 0..1
    })();

    if (m.user.myRating) {
      const mio = (m.user.myRating - 3) / 2;                                     // -1..+1
      return critica == null ? mio : mio * 0.7 + (critica - 0.6) * 0.75;
    }
    // Senza il tuo voto resta un segnale debole: l'hai visto, quindi ti interessava.
    return critica == null ? 0.15 : (critica - 0.62) * 0.8;
  }

  /* Somma i gradimenti per ogni chiave (genere, regista, attore…). */
  function pesa(visti, estrai) {
    const peso = new Map();
    for (const m of visti) {
      const g = gradimento(m);
      for (const k of estrai(m)) {
        if (!k) continue;
        const p = peso.get(k) || { punti: 0, film: [] };
        p.punti += g;
        p.film.push(m);
        peso.set(k, p);
      }
    }
    return peso;
  }

  /* ── il profilo ──────────────────────────────────────── */
  function profilo(visti) {
    return {
      generi:  pesa(visti, m => m.genres),
      registi: pesa(visti, m => [m.director]),
      attori:  pesa(visti, m => (m.castDetail || []).slice(0, 6).map(c => c.name)),
      paesi:   pesa(visti, m => m.countries),
      durata:  (() => {
        const d = visti.filter(m => m.runtime);
        return d.length ? d.reduce((s, m) => s + m.runtime, 0) / d.length : null;
      })(),
      // Quanto ti discosti dalla critica: se sistematicamente voti sopra o sotto.
      scarto: (() => {
        const con = visti.filter(m => m.user.myRating && (m.rtScore != null || m.metascore != null));
        if (!con.length) return null;
        const d = con.map(m => {
          const c = [m.rtScore, m.metascore].filter(x => x != null);
          return (m.user.myRating / 5 * 100) - (c.reduce((a, b) => a + b, 0) / c.length);
        });
        return Math.round(d.reduce((a, b) => a + b, 0) / d.length);
      })()
    };
  }

  /* ── punteggio e motivazione di un candidato ─────────── */
  /* I due piatti restano separati fino alla fine: `punti` è il saldo,
     ma chi deve decidere se un film ha comunque delle ragioni a favore
     (l'anti-consiglio, più sotto) ha bisogno di leggere il solo lato
     positivo. Sommarli subito renderebbe impossibile distinguere un
     film mediocre da uno molto amato e molto sospetto insieme. */
  function valuta(film, p) {
    const motivi = [];
    let positivi = 0, negativi = 0;

    const contributo = (mappa, chiavi, moltiplicatore, frase) => {
      for (const k of chiavi) {
        const v = mappa.get(k);
        if (!v) continue;
        /* I contributi negativi contano, ma meno di quelli positivi:
           un regista può sbagliare un film senza essere bandito.
           Prima venivano scartati del tutto, e un titolo pieno di
           gente che non sopporti finiva a pari merito con uno neutro. */
        if (v.punti > 0.05)       { positivi += v.punti * moltiplicatore; motivi.push(frase(k, v)); }
        else if (v.punti < -0.05) { negativi += v.punti * moltiplicatore * 0.6; }
      }
    };

    contributo(p.registi, [film.director], 26,
      (k, v) => `hai visto ${v.film.length === 1 ? 'un film' : `${v.film.length} film`} di ${k}`);

    contributo(p.attori, (film.castDetail || []).slice(0, 6).map(c => c.name), 13,
      (k, v) => `c'è ${k}, che hai già visto in ${v.film[0].title}`);

    contributo(p.generi, film.genres, 9,
      (k, v) => `${k.toLowerCase()} è un genere che frequenti (${v.film.length})`);

    contributo(p.paesi, film.countries, 3, k => `produzione ${k}`);

    // La critica conta, ma non deve schiacciare il gusto personale.
    const critica = [film.rtScore, film.metascore, film.imdbRating ? film.imdbRating * 10 : null]
      .filter(x => x != null);
    if (critica.length) {
      const media = critica.reduce((a, b) => a + b, 0) / critica.length;
      const q = (media - 60) * 0.32;
      if (q >= 0) positivi += q; else negativi += q;
      if (media >= 80) motivi.push(`la critica lo promuove (${Math.round(media)}/100)`);
      if (media < 45)  motivi.push(`la critica lo boccia (${Math.round(media)}/100)`);
    }

    if (p.durata && film.runtime) {
      const scostamento = Math.abs(film.runtime - p.durata);
      if (scostamento < 12) { positivi += 4; motivi.push('dura quanto i film che scegli di solito'); }
    }

    // L'hai segnato come pronto: è quello che puoi guardare davvero stasera.
    if (film.user?.pronto) positivi += 10;

    return { punti: positivi + negativi, positivi, negativi,
             motivi: [...new Set(motivi)].slice(0, 3) };
  }

  /* ── la classifica dei consigli ──────────────────────── */
  function classifica(tutti, { lista = null, quanti = 8 } = {}) {
    const visti = tutti.filter(m => m.user.seen);
    if (visti.length < 3) return { pronti: false, visti: visti.length, voci: [], profilo: null };

    const p = profilo(visti);
    const candidati = tutti.filter(m => !m.user.seen && (!lista || m.lista === lista));

    const voci = candidati
      .map(m => ({ film: m, ...valuta(m, p) }))
      .sort((a, b) => b.punti - a.punti)
      .slice(0, quanti);

    return { pronti: true, visti: visti.length, voci, profilo: p };
  }

  /* Le tre cose che ti descrivono meglio, per la scheda del profilo. */
  function ritratto(p) {
    const cima = (mappa, n = 3) => [...mappa.entries()]
      .filter(([, v]) => v.punti > 0)
      .sort((a, b) => b[1].punti - a[1].punti)
      .slice(0, n)
      .map(([k, v]) => ({ nome: k, film: v.film.length, punti: v.punti }));

    return {
      generi:  cima(p.generi),
      registi: cima(p.registi, 2),
      attori:  cima(p.attori, 4),
      durata:  p.durata ? Math.round(p.durata) : null,
      scarto:  p.scarto
    };
  }

  /* ── il gemello: il film già visto che gli somiglia di più ──
     Non è "somiglianza oggettiva": pesa di più ciò che ti è piaciuto,
     perché serve a dire "se hai amato quello, guarda questo". */
  function gemello(film, visti) {
    const punteggia = v => {
      let s = 0;
      const generiComuni = film.genres.filter(g => v.genres.includes(g));
      s += generiComuni.length * 12;

      const cast = new Set((film.castDetail || []).slice(0, 8).map(c => c.name));
      const comuni = (v.castDetail || []).slice(0, 8).filter(c => cast.has(c.name));
      s += comuni.length * 20;

      if (film.director && film.director === v.director) s += 40;
      if (film.runtime && v.runtime && Math.abs(film.runtime - v.runtime) < 15) s += 6;
      if (film.countries.some(c => v.countries.includes(c))) s += 3;

      // Un film che hai amato è un paragone più utile di uno che hai subito.
      s *= 1 + Math.max(0, gradimento(v)) * 0.7;
      return { v, s, generiComuni, comuni };
    };

    const best = visti.map(punteggia).sort((a, b) => b.s - a.s)[0];
    return best && best.s >= 24 ? best : null;
  }

  /* ── il gancio: la voglia, poi la premessa ────────────
     Il difetto dei consigli era che parlavano solo di te — generi che
     frequenti, attori già visti — e mai del film. "Avventura è casa
     tua" non fa venire voglia di niente. Quello che fa venire voglia
     è sapere cosa succede: un incontro, una caccia al tesoro, un
     robot. La trama ce l'abbiamo già in casa: basta usarla.

     Due pezzi: l'umore ("se hai voglia di stare sul filo") e la
     premessa, presa dalla trama così com'è scritta. */

  const UMORI = {
    Romance:      ['se hai voglia di romanticismo', 'per una sera di cuore', 'se ti va di innamorarti un po\''],
    Horror:       ['se hai voglia di farti spaventare', 'per una sera con la luce spenta', 'se ti va di dormire male'],
    Thriller:     ['se hai voglia di stare sul filo', 'per una sera con il fiato corto', 'se ti va di non fidarti di nessuno'],
    Mistero:      ['se hai voglia di un enigma', 'se ti va di arrivarci prima del protagonista'],
    Fantascienza: ['se hai voglia di guardare più avanti', 'per una sera fuori da qui', 'se ti va di chiederti come andrà a finire'],
    Avventura:    ['se hai voglia di partire', 'per una sera di terre lontane', 'se ti va di seguire qualcuno che scappa'],
    Azione:       ['se hai voglia di adrenalina', 'per una sera che corre'],
    Fantasy:      ['se hai voglia di un altro mondo', 'se ti va di credere a qualcosa'],
    Commedia:     ['se hai voglia di ridere', 'per una sera leggera'],
    Dramma:       ['se hai voglia di qualcosa che resta addosso', 'per una sera di cose vere'],
    Drammatico:   ['se hai voglia di qualcosa che resta addosso', 'per una sera di cose vere'],
    Crime:        ['se hai voglia di stare dalla parte sbagliata', 'per una sera di gente losca'],
    Animazione:   ['se hai voglia di disegni che si muovono', 'per una sera animata'],
    Famiglia:     ['se hai voglia di guardarlo con qualcuno', 'per una sera in compagnia'],
    Storia:       ['se hai voglia di cose successe davvero'],
    Musica:       ['se hai voglia di alzare il volume'],
    Documentario: ['se hai voglia di realtà']
  };

  /* Attacchi che non dicono niente: meglio partire dalla frase dopo. */
  const FUFFA = /^(il film racconta|il film segue|racconta la storia|segue le vicende|la storia di|trama non disponibile|nuovo capitolo|un nuovo capitolo)\b/i;

  /* La prima frase di una trama è la premessa: chi, dove, cosa va
     storto. È esattamente il pezzo che serve. Le successive di solito
     sono conseguenze, e raccontarle sarebbe uno spoiler. */
  function premessa(plot) {
    if (!plot) return null;
    const testo = plot.replace(/\s+/g, ' ').trim();

    // Spezzo sui punti fermi, non sulle abbreviazioni ("Mr. Smith").
    const frasi = testo.split(/(?<=[.!?])\s+(?=[A-ZÀ-Þ"«'])/).filter(Boolean);
    if (!frasi.length) return null;

    let i = 0;
    if (FUFFA.test(frasi[i]) && frasi.length > 1) i++;

    /* La prima frase spesso è solo la posa in scena ("una bambina si
       trasferisce in una nuova casa"): il gancio vero è la seconda,
       quella in cui qualcosa gira storto. Se ci sta, la prendo. */
    let p = frasi[i];
    if (frasi[i + 1] && p.length + frasi[i + 1].length <= 195) p += ' ' + frasi[i + 1];

    p = p.trim();
    if (p.length < 30) return null;

    // Troppo lunga: taglio alla virgola più vicina alla fine utile,
    // così non resta una frase mozzata a metà parola.
    if (p.length > 195) {
      const taglio = p.lastIndexOf(',', 195);
      p = (taglio > 90 ? p.slice(0, taglio) : p.slice(0, 195).replace(/\s\S*$/, '')) + '…';
    }
    return p;
  }

  function gancio(film) {
    const p = premessa(film.plot);
    if (!p) return null;

    const seme = [...String(film.id)].reduce((s, c) => s + c.charCodeAt(0), 0);

    // L'umore lo detta il genere più caratterizzante, non il primo
    // della lista: "Avventura" c'è ovunque, "Romance" dice molto di più.
    const raro = [...(film.genres || [])]
      .filter(g => UMORI[g])
      .sort((a, b) => UMORI[a].length - UMORI[b].length);
    const scelto = raro.find(g => ['Romance', 'Horror', 'Mistero', 'Crime', 'Storia', 'Musica', 'Documentario'].includes(g))
      || raro[0];

    const voci = scelto ? UMORI[scelto] : null;
    const umore = voci ? voci[seme % voci.length] : null;

    return { umore: umore ? maiuscola(umore) : null, premessa: p };
  }

  /* ── la riga "ti piacerà perché" ─────────────────────
     Frasi intere, non elenchi: deve suonare come qualcuno
     che ti conosce, non come un motore di ricerca. */
  function perche(film, tutti) {
    const visti = tutti.filter(m => m.user.seen && m.id !== film.id);
    const amo = gancio(film);

    /* La redazione, quando c'è, ha già scritto il perché: con i
       richiami, le parentele, i film che hai visto. Le frasi calcolate
       qui sotto restano per i film che una scheda non ce l'hanno ancora. */
    const scheda = typeof Schede !== 'undefined' ? Schede.get(film.id) : null;
    if (scheda?.perche) {
      const pratico = praticoDi(film);
      return { gancio: amo, frase: F.esc(scheda.perche), caveat: null, pratico, redazione: true,
               vibes: scheda.vibes || [], nota: scheda.nota || null, dopo: scheda.dopo || [] };
    }
    if (visti.length < 3) return amo ? { gancio: amo, frase: null, caveat: null, pratico: null } : null;

    const p = profilo(visti);
    const pezzi = [];
    const nome = m => m.title;
    const stelle = m => m.user.myRating ? ` — gli hai dato ${'★'.repeat(m.user.myRating)}` : '';

    // Un film già nominato non va ripetuto: suonerebbe come un disco rotto.
    const citati = new Set();
    const cita = m => { citati.add(m.id); return `<i>${F.esc(nome(m))}</i>`; };
    let haGemello = false;

    /* 1. il regista */
    const reg = film.director && p.registi.get(film.director);
    if (reg && reg.punti > 0) {
      const suo = [...reg.film].sort((a, b) => (b.user.myRating || 0) - (a.user.myRating || 0))[0];
      pezzi.push(`hai già seguito <b>${F.esc(film.director)}</b> in ${cita(suo)}${stelle(suo)}`);
    }

    /* 2. i volti che ritrovi */
    const facce = (film.castDetail || []).slice(0, 6)
      .map(c => ({ nome: c.name, v: p.attori.get(c.name) }))
      .filter(x => x.v && x.v.punti > 0)
      .sort((a, b) => b.v.punti - a.v.punti)
      .slice(0, 2);
    if (facce.length) {
      const dove = facce[0].v.film.sort((a, b) => (b.user.myRating || 0) - (a.user.myRating || 0))[0];
      pezzi.push(facce.length > 1
        ? `ritrovi <b>${F.esc(facce[0].nome)}</b> e <b>${F.esc(facce[1].nome)}</b>, già incrociati nella tua libreria`
        : `c'è <b>${F.esc(facce[0].nome)}</b>, che hai visto in ${cita(dove)}${stelle(dove)}`);
    }

    /* 3. il gemello, solo se porta un film nuovo nel discorso.
       Vario l'attacco: ripetere "sta vicino a" su ogni scheda
       fa sembrare tutto uscito dallo stesso stampo. */
    const g = gemello(film, visti);
    if (g && !reg && !citati.has(g.v.id)) {
      const amato = (g.v.user.myRating || 0) >= 4;
      // Due generi bastano a dire il legame: "animazione e avventura e
      // famiglia e commedia" non è una descrizione, è un inventario.
      const gc = g.generiComuni.map(x => x.toLowerCase()).slice(0, 2);
      const legame = g.comuni.length ? 'stesso giro di facce'
        : gc.length > 1 ? `stesso incrocio di ${gc[0]} e ${gc[1]}`
        : 'stessa stoffa';

      const attacchi = amato
        ? [ t => `ti era piaciuto ${t}: questo gli somiglia`,
            t => `è cugino di ${t}, che hai amato`,
            t => `se ${t} ti ha preso, qui ritrovi ${legame}` ]
        : [ t => `sta dalle parti di ${t} — ${legame}`,
            t => `respira la stessa aria di ${t}`,
            t => `chi ha visto ${t} si ritrova in casa` ];

      // Scelta stabile per film: la frase non cambia a ogni ricarica.
      const seme = [...String(film.id)].reduce((s, c) => s + c.charCodeAt(0), 0);
      pezzi.push(attacchi[seme % attacchi.length](cita(g.v)));
      haGemello = true;
    }

    /* 4. il verdetto della critica, quando è netto */
    const critica = [film.rtScore, film.metascore, film.imdbRating ? film.imdbRating * 10 : null]
      .filter(x => x != null);
    const mediaCritica = critica.length
      ? Math.round(critica.reduce((a, b) => a + b, 0) / critica.length) : null;

    if (pezzi.length < 2 && mediaCritica != null && mediaCritica >= 82)
      pezzi.push(`ne stanno parlando benissimo (${mediaCritica} su cento)`);

    /* 5. il terreno che frequenti, detto una volta sola e senza conteggi.
       Solo se non c'è già un gancio: fra "avventura è casa tua" e la
       trama vera, vince la trama. Le formule sul genere restano il
       fondo del barile, non il piatto forte. */
    if (pezzi.length < 2 && !amo) {
      const gen = film.genres.map(x => ({ x, v: p.generi.get(x) }))
        .filter(x => x.v && x.v.punti > 0)
        .sort((a, b) => b.v.punti - a.v.punti)[0];
      if (gen) {
        const etichetta = `<b>${F.esc(F.conArticolo(gen.x))}</b>`;
        const seme = [...String(film.id)].reduce((s, c) => s + c.charCodeAt(0), 0);
        // Se un gemello ha già parlato di film, qui resto sul genere:
        // due paragoni di fila con lo stesso giro di parole stonano.
        const esempio = haGemello ? null : [...gen.v.film]
          .filter(f => !citati.has(f.id))
          .sort((a, b) => (b.user.myRating || 0) - (a.user.myRating || 0))[0];

        if (esempio && gen.v.film.length < 3) {
          pezzi.push(`sei dalle parti di ${cita(esempio)}`);
        } else {
          // Niente preposizioni davanti al genere: "su l'avventura"
          // costringerebbe a gestire tutte le elisioni italiane.
          const forme = [
            `${etichetta} è casa tua`,
            `${etichetta} non ti delude mai`,
            `${etichetta} è il tuo terreno`
          ];
          pezzi.push(forme[seme % forme.length]);
        }
      }
    }

    /* 6. l'ultima spiaggia: qualcosa di vero da dire c'è sempre.
       Con un gancio in mano non serve raschiare: il film si presenta
       già da solo, e una riga in meno è meglio di una riga vuota. */
    if (!pezzi.length && !amo && mediaCritica != null && mediaCritica >= 70)
      pezzi.push(`la critica lo tratta bene (${mediaCritica} su cento)`);
    if (!pezzi.length && !amo && film.director)
      pezzi.push(`lo firma <b>${F.esc(film.director)}</b>`);

    if (!pezzi.length && !amo) return null;

    /* Il contrappunto onesto: se la critica lo boccia, va detto. */
    let caveat = null;
    const stampa = [film.rtScore, film.metascore].filter(x => x != null);
    if (stampa.length) {
      const media = Math.round(stampa.reduce((a, b) => a + b, 0) / stampa.length);
      if (media < 45) {
        caveat = p.scarto != null && p.scarto > 8
          ? `La critica lo massacra (${media}/100), ma tu tendi a essere più generoso di lei.`
          : `Sappilo: la critica lo massacra, ${media}/100.`;
      } else if (media >= 85) {
        caveat = `E la critica è d'accordo con te: ${media}/100.`;
      }
    }

    /* Il dettaglio pratico: dove e quando. */
    const pratico = praticoDi(film);

    const frase = !pezzi.length ? null
      : pezzi.length > 1
        ? `${maiuscola(pezzi[0])}, e ${pezzi.slice(1).join(', ')}.`
        : `${maiuscola(pezzi[0])}.`;

    return { gancio: amo, frase, caveat, pratico };
  }

  /* ── il contrario: perché potresti lasciarlo perdere ──────
     Un consigliere che dice sempre di sì non consiglia, asseconda.
     Qui parlano solo i segnali negativi che hai prodotto tu: registi
     e attori che ti hanno lasciato freddo, generi che voti male,
     durate fuori dalla tua misura. La critica da sola non basta —
     bocciare un film perché piace poco ai giornali sarebbe il
     contrario di una libreria personale. */
  function contro(film, tutti) {
    const visti = tutti.filter(m => m.user.seen && m.id !== film.id);
    // Sotto i sei film votati il segnale negativo è rumore: una
    // stellina bassa non basta a dire "questa roba non fa per te".
    const conVoto = visti.filter(m => m.user.myRating);
    if (visti.length < 6 || conVoto.length < 3) return null;

    const p = profilo(visti);
    const pezzi = [];
    let malus = 0;

    const cita = m => `<i>${F.esc(m.title)}</i>`;
    /* Il film peggio giudicato fra quelli che portano quel nome:
       è il caso che spiega meglio perché il segnale è negativo. */
    const peggiore = v => [...v.film].sort((a, b) =>
      (a.user.myRating || 3) - (b.user.myRating || 3))[0];

    /* 1. la firma */
    const reg = film.director && p.registi.get(film.director);
    if (reg && reg.punti < -0.15) {
      malus += reg.punti * 26;
      const q = peggiore(reg);
      /* Le stelle fra parentesi, non in un'altra proposizione: con la
         congiunzione la frase finiva per avere due "e" di fila appena
         si aggiungeva un secondo motivo. */
      pezzi.push(`di <b>${F.esc(film.director)}</b> hai già visto ${cita(q)}${
        q.user.myRating ? ` (${'★'.repeat(q.user.myRating)})` : ', senza entusiasmo'}`);
    }

    /* 2. i volti che non ti hanno convinto */
    const facce = (film.castDetail || []).slice(0, 6)
      .map(c => ({ nome: c.name, v: p.attori.get(c.name) }))
      .filter(x => x.v && x.v.punti < -0.15)
      .sort((a, b) => a.v.punti - b.v.punti);
    if (facce.length) {
      malus += facce[0].v.punti * 13;
      pezzi.push(`<b>${F.esc(facce[0].nome)}</b> finora non ti ha convinto (${cita(peggiore(facce[0].v))})`);
    }

    /* 3. il genere che continui a bocciare */
    const gen = film.genres.map(x => ({ x, v: p.generi.get(x) }))
      .filter(x => x.v && x.v.punti < -0.2 && x.v.film.length >= 2)
      .sort((a, b) => a.v.punti - b.v.punti)[0];
    if (gen) {
      malus += gen.v.punti * 9;
      pezzi.push(`${F.esc(F.conArticolo(gen.x))} raramente ti ripaga (${gen.v.film.length} film, nessuno andato bene)`);
    }

    /* 4. la durata: un fattore pratico, non di gusto.
       Sotto la tua misura non è un problema — è mezz'ora guadagnata. */
    if (p.durata && film.runtime && film.runtime - p.durata > 42) {
      malus -= 5;
      pezzi.push(`sono <b>${Math.round(film.runtime - p.durata)} minuti</b> più della tua misura abituale`);
    }

    if (!pezzi.length) return null;

    /* Un titolo che ha comunque una ragione forte a favore non va
       bocciato: il dubbio si dice, la condanna no.

       Il confronto dev'essere fra cose omogenee. Il punteggio pieno di
       `valuta` non serve: somma decine di chiavi (ogni attore, ogni
       genere, ogni paese) e arriva a numeri che nessun malus può
       pareggiare, quindi il dubbio si cancellerebbe sempre da solo.
       Qui il paragone è uno a uno — la voce più favorevole contro la
       più contraria, con gli stessi pesi. */
    const meglio = (mappa, chiavi, moltiplicatore) => Math.max(0,
      ...chiavi.map(k => (mappa.get(k)?.punti || 0) * moltiplicatore));
    const pro = Math.max(
      meglio(p.registi, [film.director], 26),
      meglio(p.attori, (film.castDetail || []).slice(0, 6).map(c => c.name), 13),
      meglio(p.generi, film.genres, 9));

    if (pro >= Math.abs(malus)) return null;
    // Sotto questa soglia il segnale è troppo debole per valere una riga.
    if (malus > -4) return null;

    const frase = pezzi.length > 1
      ? `${maiuscola(pezzi[0])}, e ${pezzi.slice(1).join(', ')}.`
      : `${maiuscola(pezzi[0])}.`;

    /* "Forte" è quello che si merita un posto in "Ci penserei": il
       dubbio in fondo alla scheda si accontenta di meno. */
    return { frase, punti: malus, forte: malus <= -9 };
  }

  /* Dove e quando: l'unica riga che la redazione non può scrivere,
     perché cambia ogni giorno. */
  function praticoDi(film) {
    const gg = F.giorniA(film.releaseDate);
    const prev = F.prevendita(film);
    if (film.lista === 'cinema') {
      if (prev?.urgente)                return `${maiuscola(prev.testo)}.`;
      if (gg != null && gg > 0)         return `Esce fra ${gg} giorni.`;
      if (gg != null && gg >= -70)      return 'È in sala adesso.';
      return null;
    }
    if (film.user?.pronto)              return 'Lo hai segnato come pronto: si guarda stasera.';
    if (gg != null && gg > 0 && gg <= 45) return `Esce fra ${gg} giorni.`;
    return null;
  }

  /* La frase può iniziare con un tag (<b>, <i>): la maiuscola va
     sulla prima lettera del testo, saltando i tag di apertura. */
  const maiuscola = s =>
    s.replace(/^(\s*(?:<[^>]+>\s*)*)([a-zà-ÿ])/i, (_, tag, c) => tag + c.toUpperCase());

  return { classifica, ritratto, profilo, gradimento, perche, contro, gemello, gancio };
})();
