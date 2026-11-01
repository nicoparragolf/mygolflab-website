/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Selector de producto (MyGolfLab ↔ Coach Hub)
   Archivo: /js/mgl-products.js
   Versión: 1.0 · 2026-11-01

   Una cuenta, dos productos. Este script:
   1. Pinta el header con el acento de cada producto:
        MyGolfLab → teal  ·  Coach Hub → dorado
   2. Agrega el selector "MyGolfLab | Coach Hub":
        - En MyGolfLab: siempre (es el puente). Lleva a la ficha en Coach Hub
          si es coach o ya tiene coach; si no, a la vitrina /es/coaches/.
        - En Coach Hub: jugadores y rol "ambos" (un coach puro no ve MyGolfLab).
        - data-switch="always": se muestra siempre (vitrina pública de coaches).

   Uso (después del script de supabase-js):
     <script src="/js/mgl-products.js" data-product="mgl"></script>
     <script src="/js/mgl-products.js" data-product="hub"></script>
     <script src="/js/mgl-products.js" data-product="hub" data-switch="always"></script>

   Sin template literals a propósito (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var SUPABASE_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';

  var script = document.currentScript;
  var PRODUCT = (script && script.getAttribute('data-product')) === 'hub' ? 'hub' : 'mgl';
  var ALWAYS = !!(script && script.getAttribute('data-switch') === 'always');

  // ── 1. Estilos (se inyectan de inmediato para que no parpadee el color) ──
  var css = ''
    + '.prod-wrap{display:inline-flex;align-items:center;flex-shrink:0;min-width:0}'
    + '.prod-switch{display:inline-flex;align-items:center;gap:2px;margin-left:12px;padding:3px;'
    +   'border:1px solid #2a2a2a;border-radius:999px;background:#121212;flex-shrink:0}'
    + '.prod-switch a{font-family:"Barlow Condensed",sans-serif;font-size:12px;font-weight:700;'
    +   'letter-spacing:.6px;text-transform:uppercase;padding:4px 10px;border-radius:999px;'
    +   'color:#8a8a8a;text-decoration:none;white-space:nowrap;line-height:1.25;transition:color .2s,background .2s}'
    + '.prod-switch a:hover{color:#f5f5f5}'
    + '.prod-switch a.on-mgl{background:rgba(45,212,191,.14);color:#2dd4bf}'
    + '.prod-switch a.on-hub{background:rgba(212,197,169,.16);color:#D4C5A9}'
    // Desde MyGolfLab, el salto a Coach Hub va en su dorado para que se note
    + '.prod-switch a.go-hub{color:#D4C5A9}.prod-switch a.go-hub:hover{background:rgba(212,197,169,.1)}'
    + '.nav-auth .prod-switch{margin:0 6px 0 0}'
    // Junto a los botones de cuenta el espacio es justo: solo el salto al otro producto
    + '.prod-switch.ps-desk a[aria-current]{display:none}'
    + '.prod-switch.ps-desk a:not([aria-current])::after{content:" \\203A"}'
    // En MyGolfLab el menú central es ancho: en desktop el selector va junto a
    // los botones de cuenta; en mobile (menú hamburguesa) va junto al logo.
    + '.prod-switch.ps-mob{display:none}'
    + '@media (max-width:880px){.prod-switch.ps-mob{display:inline-flex}.prod-switch.ps-desk{display:none}}'
    // En teléfonos se muestra solo el producto al que puedes saltar
    + '@media (max-width:480px){.prod-switch{margin-left:8px}.prod-switch a{padding:4px 9px;font-size:11px;letter-spacing:.4px}'
    +   '.prod-switch a[aria-current]{display:none}.prod-switch a:not([aria-current])::after{content:" \\203A"}}';

  if (PRODUCT === 'hub') {
    // Coach Hub = acento dorado en el header (logo, link activo y línea superior)
    css += ''
      + '#siteHeader .brand span,#siteHeader .logo span{color:#D4C5A9 !important}'
      + '#siteHeader .nav-links a.active{color:#D4C5A9 !important}'
      + '#siteHeader{box-shadow:inset 0 2px 0 rgba(212,197,169,.6)}'
      + '.brand-by{font-family:"Barlow Condensed",sans-serif;font-size:11px;font-weight:600;'
      +   'letter-spacing:.8px;text-transform:uppercase;color:#8a8a8a;margin-left:6px;white-space:nowrap}'
      + '@media (max-width:520px){.brand-by{display:none}}'
      + '@media (max-width:480px){#siteHeader #roleChip{display:none !important}}';
  }

  var style = document.createElement('style');
  style.id = 'mgl-products-css';
  style.appendChild(document.createTextNode(css));
  (document.head || document.documentElement).appendChild(style);

  // ── 2. Selector de producto ──
  function link(label, href, activeClass) {
    var a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (activeClass) { a.className = activeClass; a.setAttribute('aria-current', 'page'); }
    return a;
  }

  function makeSwitch(loggedIn, extraClass, hubHref) {
    var sw = document.createElement('div');
    sw.className = 'prod-switch' + (extraClass ? ' ' + extraClass : '');
    sw.setAttribute('aria-label', 'Cambiar de producto');
    sw.appendChild(link('MyGolfLab',
      loggedIn ? '/es/dashboard.html' : '/es/index.html',
      PRODUCT === 'mgl' ? 'on-mgl' : ''));
    sw.appendChild(link('Coach Hub',
      hubHref || (loggedIn ? '/es/coachhub/dashboard.html' : '/es/coaches/'),
      PRODUCT === 'hub' ? 'on-hub' : 'go-hub'));
    return sw;
  }

  function buildSwitch(loggedIn, hubHref) {
    var hdr = document.getElementById('siteHeader');
    if (!hdr || hdr.querySelector('.prod-switch')) return;
    var brand = hdr.querySelector('.brand, .logo');
    if (!brand) return;

    var auth = PRODUCT === 'mgl' ? hdr.querySelector('.nav-auth') : null;
    var sw = makeSwitch(loggedIn, auth ? 'ps-mob' : '', hubHref);
    if (auth) {
      var desk = makeSwitch(loggedIn, 'ps-desk', hubHref);
      auth.insertBefore(desk, auth.firstChild);
      // Los scripts de sesión de cada página reescriben .nav-auth con innerHTML:
      // si eso borra el selector, se vuelve a poner.
      if (window.MutationObserver) {
        new MutationObserver(function () {
          if (!auth.querySelector('.prod-switch')) auth.insertBefore(desk, auth.firstChild);
        }).observe(auth, { childList: true });
      }
    }

    // Se envuelve logo + selector para no romper el flex del header
    var parent = brand.parentNode;
    var wrap = document.createElement('div');
    wrap.className = 'prod-wrap';
    parent.insertBefore(wrap, brand);
    wrap.appendChild(brand);
    var by = parent.querySelector('.brand-by');
    if (by) wrap.appendChild(by);
    wrap.appendChild(sw);
  }

  async function decide() {
    try {
      if (!window.supabase || !window.supabase.createClient) {
        if (ALWAYS || PRODUCT === 'mgl') buildSwitch(false);
        return;
      }
      var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      var res = await sb.auth.getSession();
      var session = res && res.data && res.data.session;
      if (!session) {
        // En MyGolfLab el puente a Coach Hub se ve siempre (lleva a la vitrina)
        if (ALWAYS || PRODUCT === 'mgl') buildSwitch(false);
        return;
      }
      var uid = session.user.id;
      var pr = await sb.from('profiles').select('role').eq('id', uid).maybeSingle();
      var role = (pr && pr.data && pr.data.role) || 'jugador';
      window.MGL_ROLE = role;

      var show = ALWAYS;
      var hubHref = '/es/coachhub/dashboard.html';
      if (PRODUCT === 'mgl') {
        // En MyGolfLab el puente se ve siempre. Destino: su Coach Hub si es coach
        // o ya tiene ficha con un coach; si no, la vitrina para elegir uno.
        show = true;
        if (role !== 'coach' && role !== 'ambos') {
          var fi = await sb.from('players').select('id').eq('user_id', uid).limit(1);
          if (!(fi && fi.data && fi.data.length)) hubHref = '/es/coaches/';
        }
      } else {
        if (role === 'jugador' || role === 'ambos') show = true;
      }
      if (show) buildSwitch(true, hubHref);
    } catch (e) {
      console.warn('mgl-products', e);
      if (ALWAYS || PRODUCT === 'mgl') buildSwitch(false);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decide);
  } else {
    decide();
  }
})();
