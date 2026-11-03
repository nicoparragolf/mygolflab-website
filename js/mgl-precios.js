/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Precios en USD / CLP
   Archivo: /js/mgl-precios.js
   Versión: 1.1 · 2026-11-03

   - Las ofertas guardan precio + moneda ('USD' o 'CLP').
   - El precio se muestra en la moneda que fijó el coach (sin convertir);
     al lado va la equivalencia en la moneda de quien mira (Chile → CLP).
   - El dólar del día sale de mindicador.cl (dólar observado) y se guarda
     12 horas en el navegador. Si no responde, se usa un valor de respaldo.
   - Al pagar (cuando esté Mercado Pago) se cobra siempre en CLP; ese cálculo
     final lo hará el servidor, no este archivo.

   Uso:
     MGL_PRECIO.listo(function(){ ... MGL_PRECIO.mostrar(o.price, o.currency) ... });
     MGL_PRECIO.moneda()          → 'CLP' | 'USD' (lo que ve este visitante)
     MGL_PRECIO.clp(precio, mon)  → entero en pesos
     MGL_PRECIO.usd(precio, mon)  → dólares (2 decimales)
     MGL_PRECIO.esChile()         → true/false

   Sin template literals a propósito (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var RESPALDO = 950;                       // CLP por USD si no hay conexión
  var CACHE = 'mgl_usd_clp';
  var TZ_CHILE = ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'];

  var tasa = RESPALDO, lista = false, colas = [];

  function leerCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c && c.v > 300 && Date.now() - c.t < 12 * 3600 * 1000) return c.v;
    } catch (e) {}
    return null;
  }

  function terminar() {
    lista = true;
    var q = colas; colas = [];
    q.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } });
  }

  var c = leerCache();
  if (c) { tasa = c; terminar(); }
  else {
    var hecho = false;
    var t = setTimeout(function () { if (!hecho) { hecho = true; terminar(); } }, 2500);
    fetch('https://mindicador.cl/api/dolar').then(function (r) { return r.json(); }).then(function (d) {
      var v = d && d.serie && d.serie[0] && Number(d.serie[0].valor);
      if (v > 300) {
        tasa = v;
        try { localStorage.setItem(CACHE, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
      }
    }).catch(function () {}).then(function () {
      if (!hecho) { hecho = true; clearTimeout(t); terminar(); }
    });
  }

  function esChile() {
    try {
      var forz = localStorage.getItem('mgl_moneda');
      if (forz === 'CLP') return true;
      if (forz === 'USD') return false;
    } catch (e) {}
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (TZ_CHILE.indexOf(tz) >= 0) return true;
    } catch (e) {}
    var langs = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
    return langs.indexOf('es-cl') >= 0;
  }

  function clp(precio, moneda) {
    precio = Number(precio) || 0;
    if ((moneda || 'CLP') === 'CLP') return Math.round(precio);
    // USD → CLP redondeado a la centena
    return Math.round(precio * tasa / 100) * 100;
  }

  function usd(precio, moneda) {
    precio = Number(precio) || 0;
    if (moneda === 'USD') return Math.round(precio * 100) / 100;
    return Math.round(precio / tasa * 100) / 100;
  }

  function fmtCLP(n) {
    try { return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n); }
    catch (e) { return '$' + n; }
  }
  function fmtUSD(n) {
    var entero = Math.abs(n - Math.round(n)) < 0.005;
    return 'USD ' + (entero ? Math.round(n) : n.toFixed(2));
  }

  window.MGL_PRECIO = {
    listo: function (fn) { if (lista) fn(); else colas.push(fn); },
    tasa: function () { return tasa; },
    esChile: esChile,
    moneda: function () { return esChile() ? 'CLP' : 'USD'; },
    clp: clp,
    usd: usd,
    fmtCLP: fmtCLP,
    fmtUSD: fmtUSD,
    // Precio en la moneda que fijó el coach, sin convertir ('Gratis' si es 0).
    // Ej: un coach que cobra USD 40 se ve "USD 40" también desde Chile.
    mostrar: function (precio, moneda) {
      if (!Number(precio)) return 'Gratis';
      return (moneda || 'CLP') === 'USD' ? fmtUSD(Number(precio)) : fmtCLP(Math.round(Number(precio)));
    },
    // Precio convertido a la moneda de quien mira (para filtros de presupuesto)
    local: function (precio, moneda) {
      if (!Number(precio)) return 'Gratis';
      return esChile() ? fmtCLP(clp(precio, moneda)) : fmtUSD(usd(precio, moneda));
    },
    // Texto chico con la equivalencia en la moneda de quien mira.
    // Vacío si el precio ya está en su moneda.
    otra: function (precio, moneda) {
      if (!Number(precio)) return '';
      moneda = moneda || 'CLP';
      if (esChile()) return moneda === 'CLP' ? '' : '≈ ' + fmtCLP(clp(precio, moneda)) + ' CLP';
      return moneda === 'USD' ? '' : '≈ ' + fmtUSD(usd(precio, moneda));
    },
    cambiar: function (m) { try { localStorage.setItem('mgl_moneda', m); } catch (e) {} }
  };
})();
