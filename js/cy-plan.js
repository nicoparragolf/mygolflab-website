/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Plan del coach (prueba de 15 días, límites y bloqueo)
   Archivo: /js/cy-plan.js
   Versión: 1.0 · 2026-11-25

   Qué hace:
   - Lee el estado del plan del coach (RPC mgl_coach_estado) y lo guarda 10 min.
   - Muestra el aviso "Prueba gratis: te quedan X días" (solo en las páginas
     que tengan un <div id="cyPlanBanner"></div>).
   - Muestra la ventana "Tu prueba terminó" o "Llegaste al máximo de alumnos"
     cuando el coach intenta algo que su plan no permite.
   - Escucha TODAS las respuestas de Supabase: si la base de datos rechaza algo
     con CY_PLAN_INACTIVO o CY_LIMITE_ALUMNOS, abre la ventana sola. Así no hay
     que tocar cada botón: el bloqueo real lo hace la base de datos.
   - Guarda códigos de descuento que vengan en el link (?codigo=JUAN20) y los
     canjea solo cuando el coach inicia sesión.

   ⚠️ Apple: dentro de la app de iPhone/iPad la ventana NO muestra precios ni
   botones para pagar; solo un texto neutro. Los precios viven en la web.

   Uso en las páginas:
     CY_PLAN.puede('crear')     → true/false (si es false, ya mostró la ventana)
     CY_PLAN.puede('alumno')    → revisa además el tope de alumnos
     CY_PLAN.listo(function(estado){ ... })
     CY_PLAN.refrescar()

   Sin template literals a propósito (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.CY_PLAN) return;

  var URL_SB = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var KEY_SB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
  var CACHE = 'cy-plan';
  var CODIGO = 'cy-codigo';
  var PRECIOS = '/es/coachhub/pricing.html';

  var estado = null, cargado = false, colas = [];

  // ── ¿Estamos dentro de la app de iPhone/iPad? ──
  function enIOSApp() {
    try {
      if (window.MGLApp && MGLApp.esApp() && MGLApp.plataforma() === 'ios') return true;
      var html = document.documentElement;
      if (html.classList.contains('en-ios')) return true;
      var cap = window.Capacitor;
      if (cap && cap.isNativePlatform && cap.isNativePlatform() && cap.getPlatform && cap.getPlatform() === 'ios') return true;
      var ua = navigator.userAgent || '';
      if (ua.indexOf('CoachHubApp') > -1 && /iPhone|iPad|iPod/.test(ua)) return true;
      if (window.top !== window && window.top.document.documentElement.classList.contains('en-ios')) return true;
    } catch (e) {}
    return false;
  }

  // ── Código de descuento que viene en el link ──
  try {
    var q = new URLSearchParams(location.search);
    var cod = q.get('codigo') || q.get('code');
    if (cod && /^[A-Za-z0-9_-]{3,30}$/.test(cod)) localStorage.setItem(CODIGO, cod.toUpperCase());
  } catch (e) {}

  // ── Cache ──
  function leerCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE) || 'null');
      if (c && Date.now() - c.t < 10 * 60 * 1000) return c.e;
    } catch (e) {}
    return null;
  }
  function guardarCache(e) {
    try { localStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), e: e })); } catch (x) {}
  }
  var c0 = leerCache();
  if (c0) estado = c0;

  function terminar() {
    cargado = true;
    var q2 = colas; colas = [];
    q2.forEach(function (fn) { try { fn(estado); } catch (e) { console.warn(e); } });
    pintarBanner();
  }

  // ── Leer el estado desde Supabase (con la sesión ya guardada en el navegador) ──
  var cliente = null;
  // Usa el cliente de la página (window.sb) para no tener dos sesiones peleando
  // por renovar el mismo token. Solo si la página no tiene uno, crea el suyo.
  function sb() {
    if (window.sb && window.sb.rpc && window.sb.auth) return window.sb;
    if (cliente) return cliente;
    if (!window.supabase || !supabase.createClient) return null;
    cliente = supabase.createClient(URL_SB, KEY_SB);
    return cliente;
  }

  function refrescar() {
    var c = sb();
    if (!c) { terminar(); return Promise.resolve(estado); }
    return c.auth.getSession().then(function (s) {
      if (!s || !s.data || !s.data.session) { estado = null; return null; }
      return c.rpc('mgl_coach_estado').then(function (r) {
        if (r.error) { console.warn('cy-plan', r.error); return estado; }
        estado = r.data;
        guardarCache(estado);
        return canjearPendiente(c).then(function () { return estado; });
      });
    }).catch(function (e) { console.warn('cy-plan', e); return estado; })
      .then(function (e) { terminar(); return e; });
  }

  function canjearPendiente(c) {
    var cod = null;
    try { cod = localStorage.getItem(CODIGO); } catch (e) {}
    if (!cod || !estado || !estado.tiene_plan || estado.codigo) return Promise.resolve();
    return c.rpc('mgl_canjear_codigo', { p_code: cod }).then(function (r) {
      try { localStorage.removeItem(CODIGO); } catch (e) {}
      if (r.data && r.data.ok) {
        return c.rpc('mgl_coach_estado').then(function (r2) {
          if (!r2.error) { estado = r2.data; guardarCache(estado); }
          aviso('Código ' + cod + ' aplicado' + (r.data.percent_off ? ': ' + r.data.percent_off + '% de descuento' : ''));
        });
      }
    });
  }

  // Espera a que la página cree su cliente (window.sb); si no aparece en ~1,5 s
  // y existe la librería, usa uno propio.
  function arrancar() {
    var n = 0;
    var t = setInterval(function () {
      n++;
      var hayPagina = window.sb && window.sb.rpc;
      var hayLib = window.supabase && supabase.createClient;
      if (hayPagina || (hayLib && n > 10)) { clearInterval(t); refrescar(); }
      else if (n > 40) { clearInterval(t); terminar(); }
    }, 150);
  }
  // Páginas públicas (landing, precios, entrar) cargan este archivo con
  // data-solo-codigo: solo guardan el código del link, sin leer el plan.
  var soloCodigo = !!(document.currentScript && document.currentScript.hasAttribute('data-solo-codigo'));
  if (soloCodigo) { cargado = true; }
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  // ── Estilos ──
  var css = ''
    + '.cy-ov{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}'
    + '.cy-box{width:100%;max-width:380px;background:var(--c141414,#141414);border:1px solid rgba(240,184,96,.35);border-radius:18px;padding:26px 22px 20px;color:var(--cf5f5f5,#f5f5f5);font-family:Inter,system-ui,sans-serif;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}'
    + '.cy-ic{width:52px;height:52px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(240,184,96,.12);color:#F0B860;font-size:24px}'
    + '.cy-box h3{margin:0 0 8px;font-family:"Barlow Condensed",Inter,sans-serif;font-size:24px;letter-spacing:.02em}'
    + '.cy-box p{margin:0 0 18px;font-size:14px;line-height:1.5;color:var(--ca3a3a3,#a3a3a3)}'
    + '.cy-btn{display:block;width:100%;padding:13px;border-radius:12px;border:0;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none;margin-top:8px;box-sizing:border-box}'
    + '.cy-btn.pri{background:#F0B860;color:#111}'
    + '.cy-btn.sec{background:transparent;color:var(--ca3a3a3,#a3a3a3);border:1px solid rgba(255,255,255,.12)}'
    + '.cy-ban{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:10px 14px;margin:0 0 14px;border-radius:12px;background:rgba(240,184,96,.10);border:1px solid rgba(240,184,96,.35);color:var(--cf5f5f5,#f5f5f5);font-size:13px;font-family:Inter,system-ui,sans-serif}'
    + '.cy-ban b{color:#F0B860}'
    + '.cy-ban a{color:#F0B860;font-weight:700;text-decoration:none;white-space:nowrap}'
    + '.cy-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);z-index:99999;background:#F0B860;color:#111;padding:10px 16px;border-radius:10px;font:600 14px Inter,system-ui,sans-serif}';
  function ponerCss() {
    if (document.getElementById('cy-plan-css')) return;
    var st = document.createElement('style');
    st.id = 'cy-plan-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function aviso(txt) {
    ponerCss();
    var d = document.createElement('div');
    d.className = 'cy-toast';
    d.textContent = txt;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3500);
  }

  // ── Ventana de bloqueo ──
  var abierta = false;
  function ventana(tipo) {
    if (abierta) return;
    abierta = true;
    ponerCss();
    var ios = enIOSApp();
    var titulo, texto, ic = '⛳';
    var tope = estado && estado.max_alumnos;

    if (tipo === 'limite') {
      titulo = 'Llegaste a ' + (tope || 'tu máximo de') + ' alumnos';
      texto = ios
        ? 'Tu plan actual permite hasta ' + (tope || 'este número de') + ' alumnos activos. Puedes archivar un alumno que ya no veas para liberar un cupo, o administrar tu cuenta desde la web.'
        : 'Tu plan actual permite hasta ' + (tope || 'este número de') + ' alumnos activos. Pásate a un plan con más cupos o archiva un alumno que ya no veas (no pierdes su historial).';
    } else {
      var prueba = estado && estado.status === 'trialing';
      titulo = prueba ? 'Tu prueba gratis terminó' : 'Tu plan no está activo';
      texto = ios
        ? 'Tus alumnos, videos y análisis siguen guardados y puedes verlos. Para seguir creando contenido, administra tu cuenta desde la web.'
        : 'Tus alumnos, videos y análisis siguen guardados y puedes verlos. Para seguir creando clases, videos y análisis, elige tu plan.';
      ic = '⏳';
    }

    var ov = document.createElement('div');
    ov.className = 'cy-ov';
    var html = '<div class="cy-box" role="dialog" aria-modal="true">'
      + '<div class="cy-ic">' + ic + '</div>'
      + '<h3></h3><p></p>';
    if (!ios) html += '<a class="cy-btn pri" target="_top" href="' + PRECIOS + '">Ver planes</a>';
    html += '<button class="cy-btn sec" type="button">Cerrar</button></div>';
    ov.innerHTML = html;
    ov.querySelector('h3').textContent = titulo;
    ov.querySelector('p').textContent = texto;
    function cerrar() { abierta = false; if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector('.cy-btn.sec').onclick = cerrar;
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });
    document.body.appendChild(ov);
  }

  // ── Aviso de días de prueba ──
  function pintarBanner() {
    var el = document.getElementById('cyPlanBanner');
    if (!el || !estado || !estado.tiene_plan) return;
    ponerCss();
    var ios = enIOSApp();
    var html = '';
    if (estado.status === 'trialing' && estado.activo) {
      var d = estado.dias_prueba;
      html = '<span>Prueba gratis: te ' + (d === 1 ? 'queda <b>1 día</b>' : 'quedan <b>' + d + ' días</b>')
        + ' · ' + estado.alumnos + '/' + (estado.max_alumnos || '∞') + ' alumnos</span>';
      if (!ios) html += '<a target="_top" href="' + PRECIOS + '">Ver planes</a>';
    } else if (!estado.activo) {
      html = '<span><b>Tu plan no está activo.</b> Puedes ver todo, pero no crear contenido nuevo.</span>';
      if (!ios) html += '<a target="_top" href="' + PRECIOS + '">Elegir plan</a>';
    }
    if (!html) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="cy-ban">' + html + '</div>';
  }

  // ── Revisión antes de una acción ──
  function puede(accion) {
    if (!estado || !estado.tiene_plan) return true;      // jugador, o aún no carga: decide la base de datos
    if (!estado.activo) { ventana('inactivo'); return false; }
    if (accion === 'alumno' && estado.max_alumnos != null && estado.alumnos >= estado.max_alumnos) {
      ventana('limite'); return false;
    }
    return true;
  }

  // ── Escuchar los rechazos de la base de datos (cualquier página) ──
  if (window.fetch && !window.fetch.__cy) {
    var original = window.fetch;
    var nuevo = function () {
      var args = arguments;
      return original.apply(this, args).then(function (res) {
        try {
          var u = (args[0] && args[0].url) || String(args[0] || '');
          if (!res.ok && u.indexOf('/rest/v1/') > -1) {
            res.clone().text().then(function (t) {
              if (t.indexOf('CY_LIMITE_ALUMNOS') > -1) ventana('limite');
              else if (t.indexOf('CY_PLAN_INACTIVO') > -1) {
                if (estado) estado.activo = false;
                ventana('inactivo');
              }
            }).catch(function () {});
          }
        } catch (e) {}
        return res;
      });
    };
    nuevo.__cy = true;
    window.fetch = nuevo;
  }

  window.CY_PLAN = {
    listo: function (fn) { if (cargado) fn(estado); else colas.push(fn); },
    estado: function () { return estado; },
    puede: puede,
    refrescar: refrescar,
    mostrar: ventana,
    enIOSApp: enIOSApp,
    pintarBanner: pintarBanner
  };
})();
