/* ══════════════════════════════════════════════════════════
   schede.js — le schede scritte dalla redazione

   data/schede.json: per ogni film, una trama vera e un "ti
   piacerà perché" da cinefilo, scritti ogni mattina dalla
   redazione (la routine di Claude Code) con i dati del film e
   il ritratto del lettore. Qui si leggono e basta.

   Se il file manca o un film non c'è ancora, chi chiama torna
   ai dati di TMDB e alle frasi calcolate: la scheda è un
   miglioramento, non una dipendenza.
   ══════════════════════════════════════════════════════════ */

const Schede = (() => {
  let schede = {};
  let pronte = null;

  async function carica() {
    if (pronte) return pronte;
    pronte = (async () => {
      try {
        const res = await fetch(`data/schede.json?t=${Date.now()}`);
        if (res.ok) schede = await res.json();
      } catch { /* si va avanti senza */ }
      return schede;
    })();
    return pronte;
  }

  const get = id => schede[id] || null;
  const quante = () => Object.keys(schede).length;

  return { carica, get, quante };
})();
