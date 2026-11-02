/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Selector de producto (MyGolfLab ↔ Coach Hub)
   Archivo: /js/mgl-products.js
   Versión: 1.1 · 2026-11-02
     1.1: menú compacto entre 901 y 1100 px (entra el link Contenido)

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

  // Ajustes para cuando la web corre dentro de la app (no hace nada en el navegador)
  if (!window.MGLApp && !document.querySelector('script[src="/js/mgl-app.js"]')) {
    var sApp = document.createElement('script');
    sApp.src = '/js/mgl-app.js';
    (document.head || document.documentElement).appendChild(sApp);
  }
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
      + '.nav-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;'
      +   'margin-left:6px;border-radius:9px;background:#D4C5A9;color:#1C1709;font-family:"Barlow Condensed",sans-serif;'
      +   'font-size:11px;font-weight:700;letter-spacing:0;line-height:1;vertical-align:2px}'
      + '@media (max-width:1180px){.brand-by{display:none}}'
      // entre 901 y 1100 px el menú del coach (6 links + selector) queda justo: se compacta
      + '@media (min-width:901px) and (max-width:1100px){#siteHeader .nav-links{gap:13px !important}'
      +   '#siteHeader .nav-links a{font-size:14.5px !important;letter-spacing:.3px !important}#siteHeader .nav-inner{gap:12px !important}}'
      // campana de avisos
      + '.mgl-bell{position:relative;flex:0 0 auto;width:38px;height:38px;border-radius:50%;border:1px solid #2a2a2a;background:#121212;'
      +   'color:#cfcfcf;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin-left:6px;transition:border-color .2s,color .2s}'
      + '.mgl-bell:hover,.mgl-bell.open{border-color:rgba(212,197,169,.5);color:#D4C5A9}'
      + '.mgl-bell svg{width:19px;height:19px}'
      // en mobile el menú se esconde: la campana se va a la derecha junto al avatar
      + '@media (max-width:900px){#siteHeader .mgl-bell{margin-left:auto}#siteHeader .mgl-bell + #navAvatar{margin-left:6px !important}}'
      + '.mgl-bell .nb{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#D4C5A9;color:#1C1709;'
      +   'font-family:"Barlow Condensed",sans-serif;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #0a0a0a}'
      + '.mgl-bell.ring svg{animation:mglRing .9s ease}'
      + '@keyframes mglRing{0%,100%{transform:rotate(0)}15%{transform:rotate(16deg)}30%{transform:rotate(-14deg)}45%{transform:rotate(10deg)}60%{transform:rotate(-6deg)}75%{transform:rotate(3deg)}}'
      + '.mgl-panel{position:fixed;z-index:300;width:min(370px,calc(100vw - 20px));max-height:min(560px,calc(100vh - 90px));overflow-y:auto;'
      +   'background:#121212;border:1px solid #2e2e2e;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.6);font-family:Barlow,sans-serif;color:#f5f5f5;display:none}'
      + '.mgl-panel.on{display:block}'
      + '.mgl-panel h5{font-family:"Barlow Condensed",sans-serif;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#777;margin:0;padding:14px 16px 6px}'
      + '.mgl-panel .ph{display:flex;align-items:center;justify-content:space-between;padding:14px 16px 4px}'
      + '.mgl-panel .ph b{font-family:"Bebas Neue",sans-serif;font-size:22px;letter-spacing:1px;font-weight:400}'
      + '.mgl-panel .it{display:flex;gap:11px;align-items:flex-start;padding:10px 16px;text-decoration:none;color:inherit;border-top:1px solid #1d1d1d}'
      + '.mgl-panel .it:hover{background:#18170f}'
      + '.mgl-panel .av{width:36px;height:36px;border-radius:50%;background:#2B2619;color:#D4C5A9;display:flex;align-items:center;justify-content:center;'
      +   'font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:14px;flex:0 0 auto}'
      + '.mgl-panel .tx{flex:1 1 auto;min-width:0}'
      + '.mgl-panel .tx b{display:block;font-size:14.5px;font-weight:600}'
      + '.mgl-panel .tx span{display:block;font-size:13.5px;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
      + '.mgl-panel .tx em{font-style:normal;font-size:12px;color:#777}'
      + '.mgl-panel .ct{background:#D4C5A9;color:#1C1709;border-radius:10px;min-width:20px;height:20px;padding:0 6px;font-family:"Barlow Condensed",sans-serif;'
      +   'font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}'
      + '.mgl-panel .none{padding:22px 16px 26px;text-align:center;color:#888;font-size:14px;line-height:1.5}'
      + '.mgl-panel .ft{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #1d1d1d;flex-wrap:wrap}'
      + '.mgl-panel .ft a,.mgl-panel .ft button{flex:1 1 auto;text-align:center;font-family:"Barlow Condensed",sans-serif;font-size:13px;font-weight:700;letter-spacing:.6px;'
      +   'text-transform:uppercase;color:#D4C5A9;border:1px solid rgba(212,197,169,.35);border-radius:10px;padding:8px 10px;background:none;cursor:pointer;text-decoration:none}'
      + '.mgl-toasts{position:fixed;right:16px;z-index:400;display:flex;flex-direction:column;gap:10px;width:min(360px,calc(100vw - 32px));pointer-events:none}'
      + '.mgl-toast{pointer-events:auto;display:flex;gap:12px;align-items:flex-start;background:#161510;border:1px solid rgba(212,197,169,.45);border-radius:14px;'
      +   'padding:12px 14px;box-shadow:0 14px 40px rgba(0,0,0,.55);color:#f5f5f5;text-decoration:none;font-family:Barlow,sans-serif;animation:mglIn .28s ease}'
      + '.mgl-toast.out{opacity:0;transform:translateY(-8px);transition:all .25s}'
      + '.mgl-toast .av{width:38px;height:38px;border-radius:50%;background:#2B2619;color:#D4C5A9;display:flex;align-items:center;justify-content:center;'
      +   'font-family:"Barlow Condensed",sans-serif;font-weight:700;flex:0 0 auto}'
      + '.mgl-toast .tx{flex:1 1 auto;min-width:0}'
      + '.mgl-toast .tx small{display:block;font-family:"Barlow Condensed",sans-serif;font-size:11.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#D4C5A9}'
      + '.mgl-toast .tx b{display:block;font-size:15px;font-weight:600;margin-top:1px}'
      + '.mgl-toast .tx span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;color:#bbb;margin-top:2px}'
      + '.mgl-toast .x{background:none;border:none;color:#777;font-size:18px;cursor:pointer;padding:0 2px;line-height:1}'
      + '@keyframes mglIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}'
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
    if (activeClass) a.className = activeClass;
    // Solo el producto en el que estás es la "página actual" (se oculta en el botón compacto).
    // OJO: go-hub es solo color; si lleva aria-current, el botón queda vacío.
    if (activeClass === 'on-mgl' || activeClass === 'on-hub') a.setAttribute('aria-current', 'page');
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

  // ── 3. Contador de mensajes sin leer (links con data-nav="mensajes") ──
  //    y de clases nuevas por responder (data-nav="clases", solo coaches)
  var COUNTS = { mensajes: 0, clases: 0 };
  function paintUnread() {
    Object.keys(COUNTS).forEach(function (k) {
      var n = COUNTS[k], links = document.querySelectorAll('a[data-nav="' + k + '"]');
      for (var i = 0; i < links.length; i++) {
        var a = links[i], b = a.querySelector('.nav-badge');
        if (n > 0) {
          if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; a.appendChild(b); }
          var txt = n > 99 ? '99+' : String(n);
          if (b.textContent !== txt) b.textContent = txt;
        } else if (b) {
          b.parentNode.removeChild(b);
        }
      }
    });
  }
  function setupUnread(sb, uid, isCoach) {
    async function refresh() {
      try {
        var r = await sb.from('coach_messages').select('id', { count: 'exact', head: true })
          .neq('sender_id', uid).is('read_at', null);
        if (!r.error) COUNTS.mensajes = r.count || 0;   // si la tabla no existe, no se muestra nada
        if (isCoach) {
          var c = await sb.from('coach_lessons').select('id', { count: 'exact', head: true })
            .eq('coach_id', uid).eq('status', 'pendiente');
          if (!c.error) COUNTS.clases = c.count || 0;
        }
        paintUnread();
        paintBell();
      } catch (e) {}
    }
    window.MGL_REFRESH_UNREAD = refresh;
    refresh();
    setInterval(refresh, 30000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    // Algunas páginas arman el menú con JS después: se vuelve a pintar el contador
    var hdr = document.getElementById('siteHeader');
    if (hdr && window.MutationObserver) {
      new MutationObserver(function () { if (COUNTS.mensajes > 0 || COUNTS.clases > 0) paintUnread(); })
        .observe(hdr, { childList: true, subtree: true });
    }
  }

  // ── 4. Campana de avisos + aviso flotante cuando llega algo nuevo ──
  var NOTIF = { sb: null, uid: null, coach: false, names: {}, namesOk: false, bell: null, panel: null, box: null };
  function escH(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function iniH(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?').charAt(0) + ((p[1] || '').charAt(0))).toUpperCase(); }
  function agoH(iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'ahora';
    if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
    var d = Math.round(s / 86400); return d === 1 ? 'ayer' : 'hace ' + d + ' días';
  }
  var BELL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>';

  async function loadNames() {
    if (NOTIF.namesOk) return;
    var sb = NOTIF.sb;
    try {
      if (NOTIF.coach) {
        var r = await sb.from('players').select('id,first_name,last_name').eq('coach_id', NOTIF.uid);
        (r.data || []).forEach(function (p) { NOTIF.names[p.id] = ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Alumno'; });
      }
      var c = await sb.rpc('mgl_msg_mis_coaches');
      (c.data || []).forEach(function (x) { if (!NOTIF.names[x.player_id]) NOTIF.names[x.player_id] = x.coach_name || 'Tu coach'; });
      NOTIF.namesOk = true;
    } catch (e) {}
  }
  function nameOf(pid) { return NOTIF.names[pid] || (NOTIF.coach ? 'Alumno' : 'Tu coach'); }

  function placeBell() {
    var hdr = document.getElementById('siteHeader');
    if (!hdr || hdr.querySelector('.mgl-bell')) return;
    var b = document.createElement('button');
    b.className = 'mgl-bell'; b.type = 'button'; b.setAttribute('aria-label', 'Avisos');
    b.innerHTML = BELL_SVG;
    var av = hdr.querySelector('#navAvatar');
    var ham = hdr.querySelector('.hamburger');
    if (av && av.parentNode) av.parentNode.insertBefore(b, av);
    else if (ham && ham.parentNode) ham.parentNode.insertBefore(b, ham);
    else (hdr.querySelector('.nav-inner') || hdr).appendChild(b);
    NOTIF.bell = b;

    var p = document.createElement('div');
    p.className = 'mgl-panel'; document.body.appendChild(p);
    NOTIF.panel = p;
    var t = document.createElement('div');
    t.className = 'mgl-toasts'; document.body.appendChild(t);
    NOTIF.box = t;
    positionFloating();
    window.addEventListener('resize', positionFloating);
    window.addEventListener('scroll', positionFloating, { passive: true });

    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (p.classList.contains('on')) { closePanel(); return; }
      openPanel();
    });
    document.addEventListener('click', function (e) { if (p.classList.contains('on') && !p.contains(e.target)) closePanel(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
  }
  function positionFloating() {
    var hdr = document.getElementById('siteHeader'); if (!hdr) return;
    var bottom = Math.max(0, hdr.getBoundingClientRect().bottom) + 10;
    if (NOTIF.panel) { NOTIF.panel.style.top = bottom + 'px'; NOTIF.panel.style.right = '10px'; }
    if (NOTIF.box) NOTIF.box.style.top = bottom + 'px';
  }
  function closePanel() { if (NOTIF.panel) NOTIF.panel.classList.remove('on'); if (NOTIF.bell) NOTIF.bell.classList.remove('open'); }

  function paintBell() {
    var b = NOTIF.bell; if (!b) return;
    var n = COUNTS.mensajes + (NOTIF.coach ? COUNTS.clases : 0);
    var nb = b.querySelector('.nb');
    if (n > 0) {
      if (!nb) { nb = document.createElement('span'); nb.className = 'nb'; b.appendChild(nb); }
      nb.textContent = n > 99 ? '99+' : String(n);
      b.setAttribute('aria-label', n + ' avisos sin leer');
    } else if (nb) { nb.parentNode.removeChild(nb); b.setAttribute('aria-label', 'Avisos'); }
  }

  async function openPanel() {
    var p = NOTIF.panel, sb = NOTIF.sb;
    NOTIF.bell.classList.add('open');
    positionFloating();
    p.innerHTML = '<div class="ph"><b>Avisos</b></div><div class="none">Cargando…</div>';
    p.classList.add('on');
    await loadNames();
    var h = '<div class="ph"><b>Avisos</b></div>', algo = false;

    // mensajes sin leer, agrupados por conversación
    try {
      var r = await sb.from('coach_messages').select('player_id,body,created_at')
        .neq('sender_id', NOTIF.uid).is('read_at', null).order('created_at', { ascending: false }).limit(100);
      if (!r.error && r.data && r.data.length) {
        var g = {}, order = [];
        r.data.forEach(function (m) { if (!g[m.player_id]) { g[m.player_id] = { last: m, n: 0 }; order.push(m.player_id); } g[m.player_id].n++; });
        h += '<h5>Mensajes sin leer</h5>';
        order.slice(0, 8).forEach(function (pid) {
          var x = g[pid], nm = nameOf(pid);
          h += '<a class="it" href="/es/coachhub/mensajes.html?player=' + encodeURIComponent(pid) + '"><div class="av">' + escH(iniH(nm)) + '</div>'
            + '<div class="tx"><b>' + escH(nm) + '</b><span>' + escH(x.last.body.replace(/\s+/g, ' ')) + '</span><em>' + agoH(x.last.created_at) + '</em></div>'
            + '<div class="ct">' + x.n + '</div></a>';
        });
        algo = true;
      }
    } catch (e) {}

    // clases nuevas (solo coach)
    if (NOTIF.coach) {
      try {
        var c = await sb.from('coach_lessons').select('id,student_name,offering,created_at')
          .eq('coach_id', NOTIF.uid).eq('status', 'pendiente').order('created_at', { ascending: false }).limit(6);
        if (!c.error && c.data && c.data.length) {
          h += '<h5>Clases por responder</h5>';
          c.data.forEach(function (l) {
            h += '<a class="it" href="/es/coachhub/clases.html?clase=' + encodeURIComponent(l.id) + '"><div class="av">' + escH(iniH(l.student_name)) + '</div>'
              + '<div class="tx"><b>' + escH(l.student_name || 'Alumno') + '</b><span>' + escH((l.offering && l.offering.title) || 'Clase') + '</span><em>' + agoH(l.created_at) + '</em></div></a>';
          });
          algo = true;
        }
      } catch (e) {}
    }

    if (!algo) h += '<div class="none">Estás al día.<br>Aquí te avisamos cuando llegue un mensaje' + (NOTIF.coach ? ' o una clase nueva.' : '.') + '</div>';
    h += '<div class="ft"><a href="/es/coachhub/mensajes.html">Ver mensajes</a>' + (NOTIF.coach ? '<a href="/es/coachhub/clases.html">Ver clases</a>' : '');
    if ('Notification' in window && Notification.permission === 'default') h += '<button type="button" id="mglNotifOn">Avisar también fuera de esta pestaña</button>';
    h += '</div>';
    p.innerHTML = h;
    var on = document.getElementById('mglNotifOn');
    if (on) on.addEventListener('click', function (e) {
      e.stopPropagation();
      Notification.requestPermission().then(function () { openPanel(); });
    });
  }

  function toast(title, kind, body, href) {
    if (!NOTIF.box) return;
    var a = document.createElement('a');
    a.className = 'mgl-toast'; a.href = href;
    a.innerHTML = '<div class="av">' + escH(iniH(title)) + '</div><div class="tx"><small>' + escH(kind) + '</small><b>' + escH(title) + '</b><span>' + escH(body) + '</span></div>'
      + '<button class="x" type="button" aria-label="Cerrar">×</button>';
    a.querySelector('.x').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); hide(); });
    NOTIF.box.insertBefore(a, NOTIF.box.firstChild);
    while (NOTIF.box.children.length > 3) NOTIF.box.removeChild(NOTIF.box.lastChild);
    var tm = setTimeout(hide, 7000);
    function hide() { clearTimeout(tm); a.classList.add('out'); setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 260); }
    if (NOTIF.bell) { NOTIF.bell.classList.remove('ring'); void NOTIF.bell.offsetWidth; NOTIF.bell.classList.add('ring'); }
    // fuera de la pestaña: aviso del navegador (si lo autorizó)
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try {
        var n = new Notification(kind + ' · ' + title, { body: body, icon: '/es/coachhub/icon-192.png', tag: href });
        n.onclick = function () { window.focus(); location.href = href; };
      } catch (e) {}
    }
  }

  function setupNotifications(sb, uid, isCoach) {
    NOTIF.sb = sb; NOTIF.uid = uid; NOTIF.coach = isCoach;
    placeBell();
    var path = location.pathname;
    try {
      sb.channel('mgl-avisos-' + uid)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coach_messages' }, async function (pl) {
          var m = pl.new || {};
          if (!m.player_id || m.sender_id === uid) return;
          if (window.MGL_REFRESH_UNREAD) window.MGL_REFRESH_UNREAD();
          // en Mensajes la propia página ya muestra el mensaje
          if (path.indexOf('/mensajes.html') >= 0 && !document.hidden) return;
          await loadNames();
          toast(nameOf(m.player_id), 'Nuevo mensaje', m.body || '', '/es/coachhub/mensajes.html?player=' + encodeURIComponent(m.player_id));
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'coach_lessons' }, function (pl) {
          var l = pl.new || {};
          if (!isCoach || l.coach_id !== uid || l.payment_status !== 'pagado' || l.status !== 'pendiente') return;
          if (!l.paid_at || Date.now() - new Date(l.paid_at).getTime() > 120000) return;
          if (window.MGL_REFRESH_UNREAD) window.MGL_REFRESH_UNREAD();
          if (path.indexOf('/clases.html') >= 0 && !document.hidden) return;
          toast(l.student_name || 'Alumno', 'Nueva clase pagada', (l.offering && l.offering.title) || 'Clase', '/es/coachhub/clases.html?clase=' + encodeURIComponent(l.id));
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coach_lessons' }, function (pl) {
          var l = pl.new || {};
          if (!isCoach || l.coach_id !== uid || l.status !== 'pendiente') return;
          if (window.MGL_REFRESH_UNREAD) window.MGL_REFRESH_UNREAD();
          if (path.indexOf('/clases.html') >= 0 && !document.hidden) return;
          toast(l.student_name || 'Alumno', 'Nueva clase', (l.offering && l.offering.title) || 'Pidió una clase', '/es/coachhub/clases.html?clase=' + encodeURIComponent(l.id));
        })
        .subscribe();
    } catch (e) { console.warn('avisos', e); }
  }

  // ── 5. Foto de perfil en el avatar del header, en todas las páginas ──
  //    Coach: la foto de su vitrina. Resto: la foto de su cuenta (Google, etc.).
  function setupAvatar(sb, session, isCoach) {
    var meta = session.user.user_metadata || {};
    function apply(url) {
      if (!url) return;
      var els = document.querySelectorAll('#navAvatar, #siteHeader .nav-avatar');
      for (var i = 0; i < els.length; i++) {
        (function (el) {
          function put() {
            var img = el.querySelector('img');
            if (img && img.getAttribute('src') === url) return;
            el.innerHTML = '<img src="' + url.replace(/"/g, '&quot;') + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:50%">';
          }
          put();
          // algunas páginas pintan las iniciales después: se vuelve a poner la foto
          if (window.MutationObserver && !el._mglAv) {
            el._mglAv = true;
            new MutationObserver(function () { put(); }).observe(el, { childList: true });
          }
        })(els[i]);
      }
    }
    var metaUrl = meta.avatar_url || meta.picture || '';
    if (!isCoach) { apply(metaUrl); return; }
    sb.from('coach_profiles').select('photo_path').eq('coach_id', session.user.id).maybeSingle().then(function (r) {
      var path = r && r.data && r.data.photo_path;
      if (!path) { apply(metaUrl); return; }
      var url = SUPABASE_URL + '/storage/v1/object/public/coach-public/' + path.split('/').map(encodeURIComponent).join('/');
      apply(url);
      // la foto de la vitrina queda como foto de la cuenta (la usan Mensajes y MyGolfLab)
      if (meta.avatar_url !== url) { try { sb.auth.updateUser({ data: { avatar_url: url } }); } catch (e) {} }
    }, function () { apply(metaUrl); });
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
      setupAvatar(sb, session, role === 'coach' || role === 'ambos');
      if (PRODUCT === 'hub') {
        setupNotifications(sb, uid, role === 'coach' || role === 'ambos');
        setupUnread(sb, uid, role === 'coach' || role === 'ambos');
      }

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
