# CINETECA

Biblioteca cinematografica personale. Statica, vanilla, PWA — stessa filosofia dell'app gym.

## Avvio

```bash
node tools/serve.mjs
```

Poi apri http://localhost:8123 (serve un server: aprendo `index.html` col doppio clic il browser blocca il caricamento del catalogo).

## Come sono organizzati i dati

| File | Ruolo |
|---|---|
| `data/seed.json` | Export dalla pagina Notion "Movies". Base di partenza. |
| `data/movies.json` | Catalogo arricchito con TMDB. È quello che l'app legge davvero. |
| `localStorage` | **Stato personale**: visto, preferito, voto, note, film aggiunti da te, film scartati. Vive nel tuo browser (e in Supabase, se accedi). |
| `data/notizie.json` | La rassegna stampa e i trailer della settimana (`tools/notizie.mjs`). |
| `data/scoperte.json` | I dieci film del giorno per costruire la cineteca virtuale (`tools/scoperte.mjs`). |
| `data/da-curare.json` → `data/curatela.json` | Rassegna da riscrivere → riscritta (redazione del mattino). |
| `data/da-redigere.json` → `data/schede.json` | Schede dei film da scrivere → scritte (redazione del mattino). |
| `data/da-presentare.json` → `data/presentazioni.json` | Trailer e scoperte da presentare → contesto e trama (redazione del mattino). |

L'app legge `data/movies.json` e, se non c'è, ripiega su `data/seed.json`.
Lo stato personale è indicizzato per `id` del film, quindi rigenerare il catalogo
non cancella voti e note.

## Arricchimento

Due fonti, entrambe con key gratuita, entrambe usate solo in locale.

**TMDB** — locandine, backdrop, voto, budget/incassi, cast con foto, trailer YouTube, durate mancanti.
Key su https://www.themoviedb.org/settings/api

**OMDb** — Rotten Tomatoes, Metacritic, IMDb. Rotten Tomatoes non ha un'API pubblica:
OMDb ne riporta il punteggio agganciandosi all'IMDb ID che TMDB ci fornisce.
Key gratuita (1000 chiamate/giorno) su https://www.omdbapi.com/apikey.aspx

1. Crea `.env.local` nella cartella del progetto:
   ```
   TMDB_KEY=la_tua_chiave
   OMDB_KEY=la_tua_chiave
   ```
   Senza `OMDB_KEY` lo script gira lo stesso e salta i voti RT/Metacritic/IMDb.
2. Lancia:
   ```bash
   node tools/enrich.mjs
   ```

Su errore di rete lo script **non retrocede**: tiene i dati dell'ultimo arricchimento
riuscito e aggiorna solo i campi che arrivano da Notion.

## Aggiornamento dei voti

I film non ancora usciti non hanno voti da nessuna parte. Appena escono, i voti
compaiono rilanciando `node tools/enrich.mjs`.

All'apertura dell'app (e a ogni ritorno da background) il catalogo viene riletto,
quindi i voti nuovi si vedono senza ricaricare la pagina a mano. Il countdown
dell'uscita è vivo, aggiornato ogni secondo.

`.env.local` è in `.gitignore`: la chiave non finisce mai nel sito pubblicato.
Nel JSON vanno solo dati pubblici (percorsi immagine su image.tmdb.org, voti, numeri).

I dati presi da Notion hanno la precedenza: TMDB riempie solo i campi vuoti.

## Struttura

```
index.html          guscio e markup
css/styles.css      tutto lo stile
sw.js               service worker: prima la rete, la cache è il paracadute

js/store.js         catalogo + stato personale (localStorage)
js/format.js        date, durate, valute, helper
js/app.js           filtri, griglia, hero, avvio
js/detail.js        scheda film
js/avviso.js        il messaggio con "annulla" in fondo allo schermo
js/novita.js        cosa è cambiato da quando non ci sei
js/notizie.js       la rassegna stampa
js/charts.js        i grafici, disegnati a mano in SVG
js/stats.js         vista statistiche
js/consiglia.js     il consigliere: perché sì e perché no
js/persone.js       la libreria vista dalle persone (regia + cast)
js/ciechi.js        gli angoli bui: i buchi della libreria
js/perte.js         la scheda "Per te"
js/cloud.js         accesso e sincronia via Supabase (facoltativa)

tools/enrich.mjs    arricchimento TMDB + OMDb
tools/notizie.mjs   rassegna stampa italiana + trailer della settimana
tools/schede.mjs    prepara le schede che la redazione deve scrivere
tools/scoperte.mjs  i dieci film del giorno + trailer e scoperte da presentare
tools/importa.mjs   import dall'export Notion
tools/versione.mjs  allinea il `?v=` degli asset e la cache del service worker
tools/serve.mjs     server statico di sviluppo
```

## La redazione del mattino

Ogni mattina una routine di Claude Code (programmata fuori dal repository)
fa `git pull`, legge i file `da-*.json` preparati dai workflow e scrive
i file di risposta, poi committa su `main` **solo quei file**. Il push
fa ripartire `rassegna.yml`, che applica il lavoro all'app.

| Legge | Scrive | Cosa |
|---|---|---|
| `data/da-curare.json` | `data/curatela.json` | titolo, sommario, "perché ti riguarda" e sezione di ogni articolo |
| `data/da-redigere.json` | `data/schede.json` | trama, "ti piacerà perché", vibes, "dopo la sala", nota di ogni film in libreria |
| `data/da-presentare.json` | `data/presentazioni.json` | per ogni trailer e ogni scoperta: una riga di contesto e due o tre righe di trama |

Formato di `data/presentazioni.json`, chiave = `id` del film (`tmdb-<id>`):

```json
{ "tmdb-1248832": {
    "contesto": "Tom Cruise per la prima volta con Iñárritu, in una commedia",
    "trama": "Due o tre frasi: premessa, tono, di che film si tratta. Niente spoiler.",
    "impronta": "copia esatta del campo impronta del film",
    "scritta": "YYYY-MM-DD" } }
```

`contesto` è la riga che dice perché se ne parla o cos'è — "il nuovo film di…",
"l'atteso ritorno di…", "esordio di…", "nuovo horror che…" — agganciata al
lettore quando il legame è vero; max 120 caratteri. `trama` 180–320 caratteri,
solo primo atto; se la sinossi TMDB manca e il film non si conosce, si dice cosa
promette il progetto dai dati, senza inventare.

## Costruire la cineteca virtuale

Nella rassegna, sotto i trailer, ogni giorno ci sono dieci film già usciti che
non hai in libreria (`tools/scoperte.mjs`): dai registi e attori che segui, dai
tuoi generi, dai classici, da quello che gira adesso. Per ciascuno dici una cosa
sola — **visto** (e compaiono subito le stelle), **da vedere**, oppure **no** —
e il film entra nel tuo stato personale come quelli aggiunti dai trailer.
I "no" valgono per sempre: quel film non torna né fra i trailer né fra le scoperte.
Un film non giudicato non viene riproposto per quattro mesi.

## Scorciatoie

- `/` — vai alla ricerca
- `Esc` — chiudi la scheda film
- il nome di una persona, ovunque compaia, porta ai suoi film in libreria

## Quando tocchi il codice

Ogni asset è caricato con un `?v=…` e il service worker nomina la cache
allo stesso modo. Il workflow notturno lo aggiorna da solo **quando cambiano
i dati**; se invece hai cambiato codice, fallo a mano:

```bash
node tools/versione.mjs
```

Senza, un telefono che ha già aperto la cineteca continua a servire il
JavaScript vecchio. Lo script avvisa anche se hai aggiunto uno script
all'index dimenticandolo nell'elenco `SHELL` di `sw.js`.
