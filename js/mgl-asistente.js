/* ═══════════════════════════════════════════════════════════════════════════
   Coach Hub · Asistente IA del coach ("Caddie")
   Archivo: /js/mgl-asistente.js
   Versión: 1.0 · 2026-11-04

   Lo carga mgl-products.js solo para coaches, en todas las páginas de
   Coach Hub. Dibuja una esfera flotante que se puede arrastrar (se pega al
   borde más cercano y recuerda dónde quedó) y, al tocarla, un chat.

   El coach pide cosas en lenguaje normal ("crea una clase para Clemente..."),
   el servidor (/api/asistente) le pregunta a Claude qué hacer, y las acciones
   se ejecutan ACÁ, con la sesión del coach (mismas reglas RLS que el resto).
   Todo lo que escribe en la base de datos pasa antes por una tarjeta que el
   coach puede editar y debe confirmar.

   La conversación se guarda en sessionStorage: sobrevive al cambiar de
   página, se borra al cerrar la pestaña o con "Nueva conversación".
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__MGL_ASISTENTE) return;
  window.__MGL_ASISTENTE = true;

  var NOMBRE = 'Caddie';
  var API = '/api/asistente';
  var MAX_VUELTAS = 8;

  var sb = window.MGL_SB;
  if (!sb) return;

  var KEY_CHAT = 'mgl_asis_chat_v1';
  var KEY_POS = 'mgl_asis_pos_v1';
  var KEY_OPEN = 'mgl_asis_open_v1';

  var S = {
    uid: null, token: null, coach: '',
    roster: [], rosterOk: false,
    history: [],   // mensajes tal cual van a la API
    view: [],      // lo que se ve en el chat
    busy: false, open: false, pendingNav: null
  };

  var TIPOS = {
    clase: 'Clase',
    video_analisis: 'Video Análisis',
    launch_monitor: 'Sesión de Launch Monitor',
    rutina_calentamiento: 'Rutina de Calentamiento',
    preparacion_fisica: 'Preparación Física'
  };
  var CON_AREA = { clase: 1, video_analisis: 1, launch_monitor: 1, preparacion_fisica: 1 };
  var PILARES = {
    ground_forces: 'Ground Forces', kinematic_sequence: 'Kinematic Sequence',
    body_tilts: 'Body Tilts', wrist_conditions: 'Wrist Conditions'
  };
  var AREAS = {
    full_swing: 'Full Swing', short_game: 'Juego Corto', putting: 'Putter',
    fisico: 'Físico', estrategia: 'Estrategia / Cancha'
  };

  // ── utilidades ──
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  }
  function ssGet(k) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function hoyISO() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function nombreDe(p) { return ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Alumno'; }
  function jugador(id) { for (var i = 0; i < S.roster.length; i++) if (S.roster[i].id === id) return S.roster[i]; return null; }
  function primerNombre() {
    var n = (S.coach || '').split(' ')[0];
    return n ? ', ' + n : '';
  }

  // markdown mínimo: **negrita**, viñetas "- " y saltos de línea
  function md(t) {
    var lines = esc(t).split('\n'), out = '', inList = false;
    lines.forEach(function (l) {
      var m = l.match(/^\s*[-•]\s+(.*)$/);
      if (m) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + m[1] + '</li>';
      } else {
        if (inList) { out += '</ul>'; inList = false; }
        out += l === '' ? '<br>' : '<p>' + l + '</p>';
      }
    });
    if (inList) out += '</ul>';
    return out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  // ═════════════════════════════════════════════════════════════════════
  // ESTILOS
  // ═════════════════════════════════════════════════════════════════════
  var css = ''
    // esfera
    + '.mgl-orb{position:fixed;z-index:46;width:60px;height:60px;border-radius:50%;cursor:grab;touch-action:none;'
    +   '-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;'
    +   'background:radial-gradient(circle at 34% 28%,#3a3222 0%,#16130d 55%,#070707 100%);'
    +   'border:1.5px solid rgba(212,197,169,.75);'
    +   'box-shadow:0 10px 26px rgba(0,0,0,.6),0 0 22px rgba(212,197,169,.28),inset 0 2px 3px rgba(255,255,255,.12);'
    +   'transition:left .28s cubic-bezier(.2,.8,.2,1),top .28s cubic-bezier(.2,.8,.2,1),transform .15s,opacity .2s;overflow:hidden}'
    + '.mgl-orb.drag{transition:none;cursor:grabbing;transform:scale(1.08)}'
    + '.mgl-orb.oculto{opacity:0;pointer-events:none;transform:scale(.6)}'
    + '.mgl-orb .core{position:absolute;inset:9px;border-radius:50%;filter:blur(3px);'
    +   'background:conic-gradient(from 0deg,#f5e7c4,#b8975a,#2b2416,#d4c5a9,#8a6f3e,#f5e7c4);animation:mglOrbGiro 7s linear infinite;opacity:.9}'
    + '.mgl-orb .core2{position:absolute;inset:17px;border-radius:50%;filter:blur(4px);'
    +   'background:radial-gradient(circle,#fff6dc 0%,rgba(212,197,169,.65) 45%,transparent 75%);animation:mglOrbLatido 3.2s ease-in-out infinite}'
    + '.mgl-orb .brillo{position:absolute;left:12px;top:8px;width:22px;height:12px;border-radius:50%;'
    +   'background:radial-gradient(ellipse,rgba(255,255,255,.55),transparent 70%);transform:rotate(-20deg)}'
    + '.mgl-orb.pensando .core{animation-duration:1.4s}'
    + '.mgl-orb.pensando .core2{animation-duration:1s}'
    + '@keyframes mglOrbGiro{to{transform:rotate(360deg)}}'
    + '@keyframes mglOrbLatido{0%,100%{transform:scale(.85);opacity:.75}50%{transform:scale(1.08);opacity:1}}'
    + '.mgl-orb-mini{width:30px;height:30px;border-width:1px;position:relative;flex:0 0 auto;cursor:default}'
    + '.mgl-orb-mini .core{inset:4px}.mgl-orb-mini .core2{inset:8px}.mgl-orb-mini .brillo{left:6px;top:4px;width:11px;height:6px}'
    // panel
    + '.mgl-asis{position:fixed;z-index:70;right:20px;bottom:20px;width:400px;height:min(640px,calc(100vh - 40px));'
    +   'display:flex;flex-direction:column;background:var(--c121212,#121212);border:1px solid var(--c2a2a2a,#2a2a2a);border-radius:22px;'
    +   'box-shadow:0 24px 60px rgba(0,0,0,.65);color:var(--ceeeeee,#eee);font-size:15px;line-height:1.45;overflow:hidden;'
    +   'opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .2s,transform .2s}'
    + '.mgl-asis.abierto{opacity:1;transform:none;pointer-events:auto}'
    + '@media (max-width:640px){.mgl-asis{left:0;right:0;bottom:0;width:auto;height:min(86vh,720px);border-radius:22px 22px 0 0;'
    +   'border-bottom:none;padding-bottom:env(safe-area-inset-bottom)}}'
    + '.mgl-asis-h{display:flex;align-items:center;gap:10px;padding:14px 14px 12px 16px;border-bottom:1px solid var(--c222222,#222)}'
    + '.mgl-asis-h .t{flex:1;min-width:0}'
    + '.mgl-asis-h .t b{display:block;font-family:"Barlow Condensed",sans-serif;font-size:20px;letter-spacing:.4px;color:#fff;line-height:1.1}'
    + '.mgl-asis-h .t span{font-size:12.5px;color:var(--c8a8a8a,#8a8a8a)}'
    + '.mgl-asis-h button{background:none;border:1px solid var(--c2c2c2c,#2c2c2c);color:var(--caaaaaa,#aaa);border-radius:10px;height:34px;padding:0 10px;font-size:13px;cursor:pointer}'
    + '.mgl-asis-h button.x{width:34px;padding:0;font-size:20px;line-height:1}'
    + '.mgl-asis-b{flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:12px;-webkit-overflow-scrolling:touch}'
    + '.mgl-asis-b::-webkit-scrollbar{width:8px}.mgl-asis-b::-webkit-scrollbar-thumb{background:rgba(var(--r255_255_255,255,255,255),.09);border-radius:8px;border:2px solid var(--c121212,#121212)}'
    + '.mgl-asis .u{align-self:flex-end;max-width:85%;background:rgba(var(--r212_197_169,212,197,169),.14);border:1px solid rgba(var(--r212_197_169,212,197,169),.25);'
    +   'color:#f2ead8;padding:9px 13px;border-radius:16px 16px 4px 16px;white-space:pre-wrap;word-wrap:break-word}'
    + '.mgl-asis .a{align-self:flex-start;max-width:92%;color:var(--ce6e6e6,#e6e6e6);word-wrap:break-word}'
    + '.mgl-asis .a p{margin:0 0 4px}.mgl-asis .a ul{margin:4px 0 6px;padding-left:20px}.mgl-asis .a li{margin:2px 0}'
    + '.mgl-asis .err{align-self:stretch;background:rgba(220,80,80,.1);border:1px solid rgba(220,80,80,.35);color:var(--cf0b4b4,#f0b4b4);padding:10px 12px;border-radius:12px;font-size:14px}'
    + '.mgl-asis .err button{margin-top:8px;background:none;border:1px solid rgba(var(--r240_180_180,240,180,180),.4);color:var(--cf0b4b4,#f0b4b4);border-radius:8px;padding:5px 10px;cursor:pointer}'
    + '.mgl-asis .pens{display:flex;align-items:center;gap:8px;color:var(--c8a8a8a,#8a8a8a);font-size:13.5px}'
    + '.mgl-asis .pens i{width:6px;height:6px;border-radius:50%;background:var(--cd4c5a9,#D4C5A9);animation:mglPunto 1s infinite}'
    + '.mgl-asis .pens i:nth-child(2){animation-delay:.15s}.mgl-asis .pens i:nth-child(3){animation-delay:.3s}'
    + '@keyframes mglPunto{0%,100%{opacity:.25}50%{opacity:1}}'
    // vacío
    + '.mgl-asis .vacio{margin:auto 0;text-align:center;padding:10px 6px}'
    + '.mgl-asis .vacio .mgl-orb{position:relative;margin:0 auto 14px;cursor:default}'
    + '.mgl-asis .vacio h3{font-family:"Barlow Condensed",sans-serif;font-size:24px;margin:0 0 6px;color:#fff;letter-spacing:.3px}'
    + '.mgl-asis .vacio p{color:#9a9a9a;margin:0 0 16px;font-size:14.5px}'
    + '.mgl-asis .sug{display:flex;flex-direction:column;gap:8px;text-align:left}'
    + '.mgl-asis .sug button{background:#191919;border:1px solid var(--c2a2a2a,#2a2a2a);color:#d8d8d8;border-radius:12px;padding:10px 12px;font-size:14px;text-align:left;cursor:pointer}'
    + '.mgl-asis .sug button:active{background:#202020}'
    // tarjeta de confirmación
    + '.mgl-asis .card{align-self:stretch;background:#181818;border:1px solid rgba(var(--r212_197_169,212,197,169),.35);border-radius:16px;padding:12px;display:flex;flex-direction:column;gap:9px}'
    + '.mgl-asis .card .ch{display:flex;align-items:center;gap:8px;font-family:"Barlow Condensed",sans-serif;font-size:15px;letter-spacing:.6px;text-transform:uppercase;color:var(--cd4c5a9,#D4C5A9)}'
    + '.mgl-asis .card label{display:block;font-size:12px;color:var(--c8a8a8a,#8a8a8a);margin-bottom:3px}'
    + '.mgl-asis .card input,.mgl-asis .card select,.mgl-asis .card textarea{width:100%;box-sizing:border-box;background:#0f0f0f;border:1px solid var(--c2c2c2c,#2c2c2c);'
    +   'color:var(--ceeeeee,#eee);border-radius:10px;padding:8px 10px;font:inherit;font-size:16px}'
    + '.mgl-asis .card textarea{min-height:88px;resize:vertical;line-height:1.4}'
    + '.mgl-asis .card .fila{display:flex;gap:8px}.mgl-asis .card .fila>div{flex:1;min-width:0}'
    + '.mgl-asis .card .acc{display:flex;gap:8px;margin-top:2px}'
    + '.mgl-asis .card .acc button{flex:1;height:42px;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;border:1px solid var(--c2c2c2c,#2c2c2c);background:none;color:var(--cbbbbbb,#bbb)}'
    + '.mgl-asis .card .acc button.ok{background:var(--cd4c5a9,#D4C5A9);border-color:var(--cd4c5a9,#D4C5A9);color:var(--c141414,#141414)}'
    + '.mgl-asis .card .acc button:disabled{opacity:.5}'
    + '.mgl-asis .card .aviso{font-size:12.5px;color:#b9a77f}'
    + '.mgl-asis .card.fin{gap:4px;border-color:var(--c2a2a2a,#2a2a2a)}'
    + '.mgl-asis .card.fin .res{font-size:14px;color:var(--ccfcfcf,#cfcfcf)}'
    + '.mgl-asis .card.fin .res a{color:var(--cd4c5a9,#D4C5A9)}'
    + '.mgl-asis .card.fin.no .res{color:var(--c8a8a8a,#8a8a8a)}'
    // entrada
    + '.mgl-asis-f{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 12px;border-top:1px solid var(--c222222,#222);background:var(--c121212,#121212)}'
    + '.mgl-asis-f textarea{flex:1;min-height:44px;max-height:140px;resize:none;background:var(--c1a1a1a,#1a1a1a);border:1px solid var(--c2c2c2c,#2c2c2c);color:var(--ceeeeee,#eee);'
    +   'border-radius:14px;padding:11px 13px;font:inherit;font-size:16px;line-height:1.35}'
    + '.mgl-asis-f textarea:focus{outline:none;border-color:rgba(var(--r212_197_169,212,197,169),.5)}'
    + '.mgl-asis-f button{flex:0 0 auto;width:44px;height:44px;border-radius:50%;border:1px solid var(--c2c2c2c,#2c2c2c);background:var(--c1a1a1a,#1a1a1a);color:#ccc;'
    +   'display:flex;align-items:center;justify-content:center;cursor:pointer}'
    + '.mgl-asis-f button svg{width:20px;height:20px}'
    + '.mgl-asis-f button.env{background:var(--cd4c5a9,#D4C5A9);border-color:var(--cd4c5a9,#D4C5A9);color:var(--c141414,#141414)}'
    + '.mgl-asis-f button:disabled{opacity:.45}'
    + '.mgl-asis-f button.mic.on{background:rgba(220,80,80,.2);border-color:rgba(220,80,80,.6);color:#f3a3a3;animation:mglOrbLatido 1.2s infinite}'
    // con el teclado abierto en el teléfono la esfera se esconde
    + 'html.mgl-kb .mgl-orb{opacity:0;pointer-events:none}';

  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function orbHTML(extra) {
    return '<div class="mgl-orb ' + (extra || '') + '"><div class="core"></div><div class="core2"></div><div class="brillo"></div></div>';
  }

  // ═════════════════════════════════════════════════════════════════════
  // ESFERA (arrastrable)
  // ═════════════════════════════════════════════════════════════════════
  var wrap = document.createElement('div');
  wrap.innerHTML = orbHTML();
  var orb = wrap.firstChild;
  orb.setAttribute('role', 'button');
  orb.setAttribute('aria-label', 'Abrir ' + NOMBRE + ', tu asistente');
  document.body.appendChild(orb);

  var SIZE = 60, MARGEN = 12;
  function tabH() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--mgl-tab-h');
    var tabs = document.querySelector('.mgl-tabs');
    if (!tabs || getComputedStyle(tabs).display === 'none') return 0;
    return tabs.getBoundingClientRect().height + 12 || parseInt(v, 10) || 0;
  }
  function limitesY() {
    var top = 70;
    var bottom = window.innerHeight - tabH() - SIZE - 14;
    return { min: top, max: Math.max(top, bottom) };
  }
  var pos = lsGet(KEY_POS) || { side: 'right', y: null };
  function colocar() {
    var L = limitesY();
    var y = pos.y == null ? L.max : Math.min(Math.max(pos.y, L.min), L.max);
    orb.style.top = y + 'px';
    orb.style.left = (pos.side === 'left' ? MARGEN : window.innerWidth - SIZE - MARGEN) + 'px';
  }
  colocar();
  window.addEventListener('resize', colocar);
  // el menú inferior aparece después: reacomodar cuando llegue
  setTimeout(colocar, 400); setTimeout(colocar, 1500);

  (function () {
    var start = null, moved = false, offX = 0, offY = 0;
    orb.addEventListener('pointerdown', function (e) {
      start = { x: e.clientX, y: e.clientY };
      var r = orb.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      moved = false;
      try { orb.setPointerCapture(e.pointerId); } catch (er) {}
    });
    orb.addEventListener('pointermove', function (e) {
      if (!start) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!moved && Math.sqrt(dx * dx + dy * dy) < 7) return;
      moved = true;
      orb.classList.add('drag');
      orb.style.left = Math.min(Math.max(e.clientX - offX, 4), window.innerWidth - SIZE - 4) + 'px';
      orb.style.top = Math.min(Math.max(e.clientY - offY, 4), window.innerHeight - SIZE - 4) + 'px';
    });
    function fin(e) {
      if (!start) return;
      start = null;
      orb.classList.remove('drag');
      if (!moved) { abrir(); return; }
      var r = orb.getBoundingClientRect();
      pos.side = (r.left + SIZE / 2) < window.innerWidth / 2 ? 'left' : 'right';
      pos.y = r.top;
      var L = limitesY();
      pos.y = Math.min(Math.max(pos.y, L.min), L.max);
      lsSet(KEY_POS, pos);
      colocar();
    }
    orb.addEventListener('pointerup', fin);
    orb.addEventListener('pointercancel', fin);
    orb.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } });
    orb.tabIndex = 0;
  })();

  // ═════════════════════════════════════════════════════════════════════
  // PANEL DE CHAT
  // ═════════════════════════════════════════════════════════════════════
  var IC_ENV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  var IC_MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3.5"/></svg>';

  var panel = document.createElement('div');
  panel.className = 'mgl-asis';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', NOMBRE + ', asistente');
  panel.innerHTML = ''
    + '<div class="mgl-asis-h">' + orbHTML('mgl-orb-mini')
    +   '<div class="t"><b>' + NOMBRE + '</b><span>Tu asistente en Coach Hub</span></div>'
    +   '<button type="button" id="mglAsisNueva" title="Nueva conversación">Nueva</button>'
    +   '<button type="button" class="x" id="mglAsisCerrar" aria-label="Cerrar">×</button>'
    + '</div>'
    + '<div class="mgl-asis-b" id="mglAsisBody"></div>'
    + '<div class="mgl-asis-f">'
    +   '<textarea id="mglAsisIn" rows="1" placeholder="Pídele algo a ' + NOMBRE + '…" enterkeyhint="send"></textarea>'
    +   '<button type="button" class="mic" id="mglAsisMic" aria-label="Dictar" style="display:none">' + IC_MIC + '</button>'
    +   '<button type="button" class="env" id="mglAsisEnv" aria-label="Enviar">' + IC_ENV + '</button>'
    + '</div>';
  document.body.appendChild(panel);

  var body = $('mglAsisBody'), input = $('mglAsisIn'), btnEnv = $('mglAsisEnv'), btnMic = $('mglAsisMic');

  function abrir() {
    S.open = true; ssSet(KEY_OPEN, true);
    panel.classList.add('abierto');
    orb.classList.add('oculto');
    pintar();
    ajustarTeclado();
    if (window.matchMedia('(min-width:641px)').matches) setTimeout(function () { input.focus(); }, 150);
  }
  function cerrar() {
    S.open = false; ssSet(KEY_OPEN, false);
    panel.classList.remove('abierto');
    orb.classList.remove('oculto');
    input.blur();
  }
  $('mglAsisCerrar').addEventListener('click', cerrar);
  $('mglAsisNueva').addEventListener('click', function () {
    if (S.busy) return;
    S.history = []; S.view = []; guardar(); pintar(); input.focus();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.open) cerrar(); });

  // en el teléfono, con el teclado abierto, el panel se ajusta al espacio visible
  function ajustarTeclado() {
    var vv = window.visualViewport;
    if (!vv || !window.matchMedia('(max-width:640px)').matches) { panel.style.bottom = ''; panel.style.height = ''; return; }
    var tapado = window.innerHeight - vv.height - vv.offsetTop;
    if (tapado > 80) {
      panel.style.bottom = tapado + 'px';
      panel.style.height = Math.min(vv.height - 8, 720) + 'px';
    } else {
      panel.style.bottom = ''; panel.style.height = '';
    }
    body.scrollTop = body.scrollHeight;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustarTeclado);
    window.visualViewport.addEventListener('scroll', ajustarTeclado);
  }

  // entrada: Enter envía (Shift+Enter = salto de línea), el textarea crece
  function crecer() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
  input.addEventListener('input', crecer);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); }
  });
  btnEnv.addEventListener('click', enviar);

  // ── Dictado por voz ──
  // El iPhone NO permite el reconocimiento de voz del navegador en apps
  // agregadas a la pantalla de inicio ni dentro de apps (WKWebView): el
  // botón existe pero no hace nada. Por eso se graba el audio (eso sí
  // funciona en todos lados, igual que en el analizador de swing) y se
  // transcribe en el servidor (/api/transcribir). Si el servidor no tiene
  // configurada la transcripción, en Safari/Chrome normal se usa el dictado
  // del navegador como respaldo.
  var VOZ = { rec: null, chunks: [], stream: null, t0: 0, timer: null, sinServidor: false, sr: null };
  var MAX_SEG = 90;

  function placeholderNormal() { input.placeholder = S.busy ? NOMBRE + ' está trabajando…' : 'Pídele algo a ' + NOMBRE + '…'; }
  function micEstado(on, texto) {
    btnMic.classList.toggle('on', !!on);
    if (texto) input.placeholder = texto; else placeholderNormal();
  }
  function pegarTexto(t) {
    t = String(t || '').trim();
    if (!t) return;
    input.value = (input.value ? input.value.replace(/\s+$/, '') + ' ' : '') + t;
    crecer();
    try { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
  }
  function avisoVoz(t) { agregar({ k: 'err', t: t }); }

  var puedeGrabar = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var esStandalone = (window.navigator.standalone === true) ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (puedeGrabar || (SR && !esStandalone)) btnMic.style.display = '';

  function mimeGrabacion() {
    var ops = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < ops.length; i++) { try { if (MediaRecorder.isTypeSupported(ops[i])) return ops[i]; } catch (e) {} }
    return '';
  }

  async function empezarGrabacion() {
    try {
      VOZ.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      micEstado(false);
      avisoVoz('No tengo permiso para usar el micrófono. Actívalo en Ajustes del teléfono → Safari (o la app) → Micrófono, y vuelve a intentar.');
      return;
    }
    var mime = mimeGrabacion();
    try { VOZ.rec = mime ? new MediaRecorder(VOZ.stream, { mimeType: mime, audioBitsPerSecond: 48000 }) : new MediaRecorder(VOZ.stream); }
    catch (e) { VOZ.rec = new MediaRecorder(VOZ.stream); }
    VOZ.chunks = [];
    VOZ.rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) VOZ.chunks.push(ev.data); };
    VOZ.rec.onstop = terminarGrabacion;
    VOZ.rec.start(1000);
    VOZ.t0 = Date.now();
    micEstado(true, 'Grabando… toca el micrófono para terminar');
    VOZ.timer = setInterval(function () {
      var s = Math.round((Date.now() - VOZ.t0) / 1000);
      input.placeholder = 'Grabando 0:' + (s < 10 ? '0' : '') + s + ' · toca el micrófono para terminar';
      if (s >= MAX_SEG) pararGrabacion();
    }, 500);
  }

  function pararGrabacion() {
    clearInterval(VOZ.timer);
    try { if (VOZ.rec && VOZ.rec.state !== 'inactive') VOZ.rec.stop(); } catch (e) { terminarGrabacion(); }
  }

  function soltarMic() {
    try { VOZ.stream && VOZ.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    VOZ.stream = null; VOZ.rec = null;
  }

  async function terminarGrabacion() {
    var tipo = (VOZ.rec && VOZ.rec.mimeType) || (VOZ.chunks[0] && VOZ.chunks[0].type) || 'audio/mp4';
    var blob = new Blob(VOZ.chunks, { type: tipo });
    var dur = (Date.now() - VOZ.t0) / 1000;
    soltarMic();
    if (dur < 0.8 || blob.size < 1500) { micEstado(false); return; }
    micEstado(false, 'Transcribiendo…');
    btnMic.disabled = true;
    try {
      var b64 = await new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result).split(',')[1] || ''); };
        fr.onerror = rej;
        fr.readAsDataURL(blob);
      });
      var tk = await token();
      var r = await fetch('/api/transcribir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
        body: JSON.stringify({ audio: b64, mime: tipo, nombres: S.roster.slice(0, 60).map(nombreDe), idioma: (window.MGLi18n && MGLi18n.lang) || 'es' })
      });
      var d = await r.json().catch(function () { return null; });
      if (r.ok && d && typeof d.texto === 'string') {
        if (d.texto.trim()) pegarTexto(d.texto);
        else avisoVoz('No alcancé a escuchar nada. Intenta de nuevo, más cerca del teléfono.');
      } else if (d && d.codigo === 'sin_clave') {
        VOZ.sinServidor = true;
        if (SR && !esStandalone) avisoVoz('La transcripción del servidor aún no está activada. Usaré el dictado del navegador: toca el micrófono de nuevo.');
        else avisoVoz('La transcripción de voz aún no está activada en el servidor. Mientras tanto puedes usar el micrófono del teclado del teléfono.');
      } else {
        avisoVoz((d && d.error) || 'No pude transcribir el audio. Inténtalo de nuevo.');
      }
    } catch (e) {
      avisoVoz('No pude transcribir el audio. Revisa tu internet.');
    } finally {
      btnMic.disabled = false;
      micEstado(false);
    }
  }

  // respaldo: dictado del navegador (solo funciona en Safari/Chrome normal)
  function dictadoNavegador() {
    if (VOZ.sr) { try { VOZ.sr.stop(); } catch (e) {} return; }
    var base = input.value ? input.value.replace(/\s+$/, '') + ' ' : '';
    try {
      var rec = new SR();
      rec.lang = 'es-CL'; rec.interimResults = true; rec.continuous = false;
      rec.onresult = function (ev) {
        var t = '';
        for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        input.value = base + t; crecer();
      };
      rec.onend = function () { VOZ.sr = null; micEstado(false); };
      rec.onerror = function (ev) {
        VOZ.sr = null; micEstado(false);
        var e = ev && ev.error;
        if (e === 'not-allowed') avisoVoz('El navegador no tiene permiso para el micrófono.');
        else if (e === 'service-not-allowed') avisoVoz('El dictado del navegador está desactivado. Activa Siri o Dictado en Ajustes, o usa el micrófono del teclado.');
        else if (e && e !== 'no-speech' && e !== 'aborted') avisoVoz('El dictado falló (' + e + '). Usa el micrófono del teclado del teléfono.');
      };
      VOZ.sr = rec;
      rec.start();
      micEstado(true, 'Te escucho…');
    } catch (e) { VOZ.sr = null; micEstado(false); }
  }

  btnMic.addEventListener('click', function () {
    if (VOZ.rec) { pararGrabacion(); return; }
    if (VOZ.sr) { dictadoNavegador(); return; }
    if (puedeGrabar && !VOZ.sinServidor) { empezarGrabacion(); return; }
    if (SR && !esStandalone) { dictadoNavegador(); return; }
    avisoVoz('El dictado no está disponible aquí. Usa el micrófono del teclado del teléfono.');
  });
  // si se cierra el panel grabando, se corta la grabación
  $('mglAsisCerrar').addEventListener('click', function () { if (VOZ.rec) pararGrabacion(); });

  // ═════════════════════════════════════════════════════════════════════
  // PINTAR LA CONVERSACIÓN
  // ═════════════════════════════════════════════════════════════════════
  function guardar() {
    // si la conversación crece mucho, se recorta para no pasarse del límite
    ssSet(KEY_CHAT, { history: S.history, view: S.view.filter(function (v) { return v.k !== 'pens'; }).slice(-80) });
  }

  function pintar() {
    if (!S.view.length) {
      var n1 = S.roster[0] ? nombreDe(S.roster[0]).split(' ')[0] : 'Clemente';
      var sugs = [
        'Crea una clase de hoy para ' + n1 + ': trabajamos ',
        '¿Qué clases online tengo pendientes?',
        'Anota en el perfil de ' + n1 + ' que ',
        'Mándale un mensaje a ' + n1 + ' recordándole '
      ];
      body.innerHTML = '<div class="vacio">' + orbHTML()
        + '<h3>Hola' + esc(primerNombre()) + ', soy ' + NOMBRE + '</h3>'
        + '<p>Dime qué registrar y lo hago por ti: clases, notas o mensajes a tus alumnos. Puedes escribir o dictar.</p>'
        + '<div class="sug">' + sugs.map(function (s) { return '<button type="button">' + esc(s.replace(/\s+$/, '…')) + '</button>'; }).join('') + '</div></div>';
      var bs = body.querySelectorAll('.sug button');
      Array.prototype.forEach.call(bs, function (b, i) {
        b.addEventListener('click', function () {
          input.value = sugs[i]; crecer(); input.focus();
          try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
        });
      });
      return;
    }
    body.innerHTML = '';
    S.view.forEach(function (v, i) { body.appendChild(nodo(v, i)); });
    body.scrollTop = body.scrollHeight;
    // una tarjeta por confirmar se muestra desde arriba (ahí está el alumno)
    var cards = body.querySelectorAll('.card:not(.fin)');
    if (cards.length) {
      var c = cards[cards.length - 1];
      if (c.offsetHeight > body.clientHeight - 20) body.scrollTop = c.offsetTop - body.offsetTop - 10;
    }
  }

  function nodo(v, i) {
    var d = document.createElement('div');
    if (v.k === 'u') { d.className = 'u'; d.textContent = v.t; }
    else if (v.k === 'a') { d.className = 'a'; d.innerHTML = md(v.t); }
    else if (v.k === 'pens') { d.className = 'pens'; d.innerHTML = '<i></i><i></i><i></i> ' + NOMBRE + ' está pensando…'; }
    else if (v.k === 'err') {
      d.className = 'err'; d.innerHTML = esc(v.t) + (v.retry ? '<br><button type="button">Reintentar</button>' : '');
      var b = d.querySelector('button');
      if (b) b.addEventListener('click', function () { S.view.splice(i, 1); ciclo(); });
    }
    else if (v.k === 'card') { return tarjeta(v); }
    return d;
  }

  function agregar(v) { S.view.push(v); guardar(); if (S.open) pintar(); }
  function quitarPensando() { S.view = S.view.filter(function (v) { return v.k !== 'pens'; }); }

  function ocupado(b) {
    S.busy = b;
    orb.classList.toggle('pensando', b);
    var mini = panel.querySelector('.mgl-orb-mini'); if (mini) mini.classList.toggle('pensando', b);
    btnEnv.disabled = b;
    input.placeholder = b ? NOMBRE + ' está trabajando…' : 'Pídele algo a ' + NOMBRE + '…';
  }

  // ═════════════════════════════════════════════════════════════════════
  // CONVERSACIÓN CON EL SERVIDOR
  // ═════════════════════════════════════════════════════════════════════
  function contexto() {
    var ctx = {
      coach: S.coach,
      hoy: new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      hoy_iso: hoyISO(),
      idioma: (window.MGLi18n && MGLi18n.lang) || 'es',
      pagina: (document.title || '') + ' (' + location.pathname + ')',
      jugadores: S.roster.map(function (p) { return { id: p.id, nombre: nombreDe(p), categoria: p.category || '' }; })
    };
    try {
      if (window.SEL && window.SEL.id && jugador(window.SEL.id)) {
        ctx.jugador_abierto = { id: window.SEL.id, nombre: nombreDe(jugador(window.SEL.id)) };
      }
    } catch (e) {}
    return ctx;
  }

  async function token() {
    var r = await sb.auth.getSession();
    var s = r && r.data && r.data.session;
    return s ? s.access_token : null;
  }

  function enviar() {
    var t = input.value.trim();
    if (!t || S.busy) return;
    input.value = ''; crecer();
    // al empezar un turno nuevo, el razonamiento de turnos anteriores ya no hace falta
    S.history.forEach(function (m) {
      if (m.role === 'assistant' && Array.isArray(m.content)) {
        var c = m.content.filter(function (b) { return b.type !== 'thinking' && b.type !== 'redacted_thinking'; });
        m.content = c.length ? c : [{ type: 'text', text: '…' }];
      }
    });
    var last = S.history[S.history.length - 1];
    if (last && last.role === 'user' && Array.isArray(last.content)) last.content.push({ type: 'text', text: t });
    else S.history.push({ role: 'user', content: t });
    if (S.history.length > 50) S.history = S.history.slice(-40);
    while (S.history.length && S.history[0].role !== 'user') S.history.shift();
    agregar({ k: 'u', t: t });
    ciclo();
  }

  async function ciclo() {
    if (S.busy) return;
    ocupado(true);
    try {
      if (!S.rosterOk) await cargarRoster();
      for (var vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
        S.view.push({ k: 'pens' }); if (S.open) pintar();
        var tk = await token();
        if (!tk) { quitarPensando(); agregar({ k: 'err', t: 'Tu sesión expiró. Vuelve a entrar a Coach Hub.' }); break; }
        var resp, data;
        try {
          resp = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
            body: JSON.stringify({ messages: S.history, contexto: contexto() })
          });
          data = await resp.json().catch(function () { return null; });
        } catch (e) { resp = null; }
        quitarPensando();
        if (!resp || !resp.ok || !data) {
          agregar({ k: 'err', t: (data && data.error) || 'No me pude conectar. Revisa tu internet.', retry: true });
          break;
        }
        var content = Array.isArray(data.content) ? data.content : [];
        S.history.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '…' }] });
        content.forEach(function (b) { if (b.type === 'text' && b.text && b.text.trim()) S.view.push({ k: 'a', t: b.text.trim() }); });
        guardar(); if (S.open) pintar();

        var usos = content.filter(function (b) { return b.type === 'tool_use'; });
        if (!usos.length) break;
        var resultados = [];
        for (var i = 0; i < usos.length; i++) {
          var out;
          try { out = await ejecutar(usos[i]); }
          catch (e) { out = { ok: false, error: String(e && e.message || e) }; }
          resultados.push({ type: 'tool_result', tool_use_id: usos[i].id, content: JSON.stringify(out) });
        }
        S.history.push({ role: 'user', content: resultados });
        guardar();
      }
    } finally {
      ocupado(false);
      guardar(); if (S.open) pintar();
      if (S.pendingNav) { var u = S.pendingNav; S.pendingNav = null; setTimeout(function () { location.href = u; }, 700); }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // HERRAMIENTAS
  // ═════════════════════════════════════════════════════════════════════
  async function cargarRoster() {
    var r = await sb.from('players').select('id,first_name,last_name,category,coach_id,user_id').eq('coach_id', S.uid);
    if (!r.error && r.data) {
      S.roster = r.data.sort(function (a, b) { return nombreDe(a).localeCompare(nombreDe(b)); });
      S.rosterOk = true;
    }
  }

  function buscar(texto) {
    var q = norm(texto).split(' ').filter(Boolean);
    if (!q.length) return [];
    return S.roster.map(function (p) {
      var partes = norm(nombreDe(p)).split(' ');
      var pts = 0;
      q.forEach(function (w) {
        partes.forEach(function (x) { if (x === w) pts += 3; else if (x.indexOf(w) === 0) pts += 2; else if (x.indexOf(w) > -1) pts += 1; });
      });
      return { p: p, pts: pts };
    }).filter(function (o) { return o.pts > 0; })
      .sort(function (a, b) { return b.pts - a.pts; })
      .slice(0, 6)
      .map(function (o) { return { id: o.p.id, nombre: nombreDe(o.p), categoria: o.p.category || null, tiene_cuenta: !!o.p.user_id }; });
  }

  function refrescarPerfil(pid) {
    try {
      if (window.SEL && window.SEL.id === pid && typeof window.selectPlayer === 'function') {
        window.selectPlayer(pid, { noHistory: true });
      }
    } catch (e) {}
  }

  async function ejecutar(t) {
    var a = t.input || {};
    switch (t.name) {
      case 'buscar_jugadores':
        if (!S.rosterOk) await cargarRoster();
        return { resultados: buscar(a.texto) };

      case 'ver_eventos_recientes': {
        if (!jugador(a.player_id)) return { ok: false, error: 'Ese alumno no está en tu lista.' };
        var n = Math.min(Math.max(parseInt(a.cantidad, 10) || 5, 1), 15);
        var r = await sb.from('player_events').select('event_type,title,event_date,summary,pillar')
          .eq('player_id', a.player_id).order('event_date', { ascending: false }).limit(n);
        if (r.error) return { ok: false, error: r.error.message };
        return { eventos: r.data };
      }

      case 'ver_notas': {
        if (!jugador(a.player_id)) return { ok: false, error: 'Ese alumno no está en tu lista.' };
        var rn = await sb.from('player_notes').select('content,created_at').eq('player_id', a.player_id)
          .order('created_at', { ascending: false }).limit(10);
        if (rn.error) return { ok: false, error: rn.error.message };
        return { notas: rn.data };
      }

      case 'ver_clases_pendientes': {
        var rc = await sb.from('coach_lessons').select('*').eq('coach_id', S.uid).eq('status', 'pendiente')
          .order('created_at', { ascending: false }).limit(20);
        if (rc.error) return { ok: false, error: rc.error.message };
        return {
          clases: (rc.data || []).map(function (l) {
            return {
              alumno: l.student_name || null,
              clase: (l.offering && l.offering.title) || null,
              pago: l.payment_status || null,
              pedida: l.created_at
            };
          })
        };
      }

      case 'abrir_pagina': {
        var p = a.player_id ? encodeURIComponent(a.player_id) : '';
        var rutas = {
          perfil_jugador: '/es/coachhub/jugador.html' + (p ? '?player=' + p : ''),
          notas_jugador: '/es/coachhub/jugador.html' + (p ? '?player=' + p + '&view=notas' : ''),
          nuevo_evento: '/es/coachhub/jugador.html?' + (p ? 'player=' + p + '&' : '') + 'nuevo=evento',
          mensajes: '/es/coachhub/mensajes.html' + (p ? '?player=' + p : ''),
          clases: '/es/coachhub/clases.html',
          analizar_swing: '/es/coachhub/analisis.html?from=dash',
          dashboard: '/es/coachhub/dashboard.html',
          jugadores: '/es/coachhub/jugador.html',
          contenido: '/es/coachhub/contenido.html',
          cuenta: '/es/coachhub/cuenta.html'
        };
        var url = rutas[a.destino];
        if (!url) return { ok: false, error: 'Destino desconocido' };
        S.pendingNav = url;
        ssSet(KEY_OPEN, a.destino !== 'analizar_swing');
        return { ok: true, nota: 'La página se abrirá al terminar tu respuesta.' };
      }

      case 'crear_evento':
      case 'crear_nota':
      case 'enviar_mensaje':
        return await confirmar(t);
    }
    return { ok: false, error: 'Herramienta desconocida' };
  }

  // ── tarjeta para revisar y confirmar ──
  var ESPERANDO = {}; // id de la tarjeta → resolver

  function confirmar(t) {
    return new Promise(function (resolve) {
      var a = t.input || {};
      var v = { k: 'card', id: t.id, tool: t.name, estado: 'pendiente', datos: {
        player_id: a.player_id || '',
        tipo: TIPOS[a.tipo] ? a.tipo : 'clase',
        titulo: a.titulo || '',
        descripcion: a.descripcion || a.texto || '',
        fecha: /^\d{4}-\d{2}-\d{2}$/.test(a.fecha || '') ? a.fecha : hoyISO(),
        pilar: PILARES[a.pilar] ? a.pilar : '',
        area: AREAS[a.area] ? a.area : '',
        dispositivo: a.dispositivo || '',
        hito: !!a.hito
      } };
      ESPERANDO[t.id] = resolve;
      input.disabled = true; input.placeholder = 'Revisa la tarjeta y confirma o cancela';
      agregar(v);
      if (!S.open) abrir();
    }).then(function (r) {
      input.disabled = false; input.placeholder = S.busy ? NOMBRE + ' está trabajando…' : 'Pídele algo a ' + NOMBRE + '…';
      return r;
    });
  }

  function opciones(obj, sel, vacio) {
    var h = vacio ? '<option value="">' + vacio + '</option>' : '';
    Object.keys(obj).forEach(function (k) { h += '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + esc(obj[k]) + '</option>'; });
    return h;
  }

  function tarjeta(v) {
    var d = document.createElement('div');
    var D = v.datos;
    var p = jugador(D.player_id);
    var titulos = { crear_evento: 'Nuevo evento', crear_nota: 'Nota rápida', enviar_mensaje: 'Mensaje' };

    if (v.estado !== 'pendiente') {
      d.className = 'card fin' + (v.estado === 'ok' ? '' : ' no');
      var txt;
      if (v.estado === 'ok') {
        var link = v.tool === 'enviar_mensaje'
          ? '/es/coachhub/mensajes.html?player=' + encodeURIComponent(D.player_id)
          : '/es/coachhub/jugador.html?player=' + encodeURIComponent(D.player_id) + (v.tool === 'crear_nota' ? '&view=notas' : '');
        var que = v.tool === 'crear_evento' ? (TIPOS[D.tipo] + ' · ' + D.titulo) : (v.tool === 'crear_nota' ? 'Nota guardada' : 'Mensaje enviado');
        txt = '✓ ' + esc(que) + ' — ' + esc(p ? nombreDe(p) : '') + ' · <a href="' + link + '">Ver</a>';
      } else if (v.estado === 'error') {
        txt = 'No se pudo guardar: ' + esc(v.error || '');
      } else {
        txt = 'Cancelado';
      }
      d.innerHTML = '<div class="ch">' + titulos[v.tool] + '</div><div class="res">' + txt + '</div>';
      return d;
    }

    d.className = 'card';
    var selJug = '<select data-f="player_id">' + (p ? '' : '<option value="">Elige el alumno</option>')
      + S.roster.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === D.player_id ? ' selected' : '') + '>' + esc(nombreDe(x)) + '</option>'; }).join('')
      + '</select>';
    var h = '<div class="ch">' + titulos[v.tool] + '</div>'
      + '<div><label>Alumno</label>' + selJug + '</div>';

    if (v.tool === 'crear_evento') {
      h += '<div class="fila"><div><label>Tipo</label><select data-f="tipo">' + opciones(TIPOS, D.tipo) + '</select></div>'
        + '<div><label>Fecha</label><input type="date" data-f="fecha" value="' + esc(D.fecha) + '"></div></div>'
        + '<div><label>Título</label><input type="text" data-f="titulo" maxlength="120" value="' + esc(D.titulo) + '"></div>'
        + '<div><label>Descripción del trabajo</label><textarea data-f="descripcion">' + esc(D.descripcion) + '</textarea></div>'
        + '<div class="fila"><div><label>Pilar</label><select data-f="pilar">' + opciones(PILARES, D.pilar, '—') + '</select></div>'
        + '<div data-area><label>Área</label><select data-f="area">' + opciones(AREAS, D.area, '—') + '</select></div></div>'
        + (D.tipo === 'launch_monitor' ? '<div><label>Dispositivo</label><input type="text" data-f="dispositivo" value="' + esc(D.dispositivo) + '"></div>' : '')
        + (D.hito ? '<div class="aviso">Se marcará como hito en el timeline.</div>' : '');
    } else {
      h += '<div><label>' + (v.tool === 'crear_nota' ? 'Nota' : 'Mensaje') + '</label><textarea data-f="descripcion">' + esc(D.descripcion) + '</textarea></div>';
      if (v.tool === 'enviar_mensaje' && p && !p.user_id) {
        h += '<div class="aviso">' + esc(nombreDe(p).split(' ')[0]) + ' todavía no tiene cuenta: verá el mensaje cuando entre a Coach Hub.</div>';
      }
    }
    var okTxt = { crear_evento: 'Guardar evento', crear_nota: 'Guardar nota', enviar_mensaje: 'Enviar' }[v.tool];
    h += '<div class="acc"><button type="button" data-no>Cancelar</button><button type="button" class="ok" data-si>' + okTxt + '</button></div>';
    d.innerHTML = h;

    // los cambios del coach quedan en la tarjeta (y sobreviven si se repinta)
    Array.prototype.forEach.call(d.querySelectorAll('[data-f]'), function (el) {
      el.addEventListener('input', function () { D[el.getAttribute('data-f')] = el.value; guardar(); });
      el.addEventListener('change', function () {
        D[el.getAttribute('data-f')] = el.value; guardar();
        if (el.getAttribute('data-f') === 'tipo') { var area = d.querySelector('[data-area]'); if (area) area.style.visibility = CON_AREA[el.value] ? '' : 'hidden'; }
      });
    });
    var ar = d.querySelector('[data-area]'); if (ar && !CON_AREA[D.tipo]) ar.style.visibility = 'hidden';
    var ta = d.querySelector('textarea'); if (ta) setTimeout(function () { ta.style.height = Math.min(ta.scrollHeight + 2, 260) + 'px'; }, 0);

    d.querySelector('[data-no]').addEventListener('click', function () { terminar(v, 'cancelado', { ok: false, cancelado: true, nota: 'El coach canceló esta acción.' }); });
    d.querySelector('[data-si]').addEventListener('click', async function () {
      var b = this; b.disabled = true; b.textContent = 'Guardando…';
      var r;
      try { r = await guardarAccion(v); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      if (r.ok) terminar(v, 'ok', r);
      else { v.error = r.error; terminar(v, 'error', r); }
    });
    return d;
  }

  function terminar(v, estado, resultado) {
    v.estado = estado;
    guardar(); if (S.open) pintar();
    var res = ESPERANDO[v.id]; delete ESPERANDO[v.id];
    if (res) res(resultado);
  }

  async function guardarAccion(v) {
    var D = v.datos;
    var p = jugador(D.player_id);
    if (!p) return { ok: false, error: 'Elige el alumno.' };
    var texto = String(D.descripcion || '').replace(/\s+$/, '');

    if (v.tool === 'crear_evento') {
      if (!String(D.titulo || '').trim()) return { ok: false, error: 'Falta el título.' };
      var ev = {
        player_id: p.id, coach_id: p.coach_id || S.uid, created_by: S.uid, source: 'manual',
        event_type: D.tipo, title: String(D.titulo).trim(), event_date: D.fecha || hoyISO(),
        summary: texto || null, pillar: D.pilar || null, is_milestone: !!D.hito
      };
      if (CON_AREA[D.tipo] && D.area) ev.area = D.area;
      if (D.tipo === 'launch_monitor' && D.dispositivo) ev.device = D.dispositivo;
      var r = await sb.from('player_events').insert(ev).select('id').single();
      // si la base todavía no tiene las columnas nuevas, se guarda sin ellas
      if (r.error && /area|device/i.test(r.error.message || '')) {
        delete ev.area; delete ev.device;
        r = await sb.from('player_events').insert(ev).select('id').single();
      }
      if (r.error) return { ok: false, error: r.error.message };
      refrescarPerfil(p.id);
      return { ok: true, evento_id: r.data.id, guardado: { alumno: nombreDe(p), tipo: TIPOS[D.tipo], titulo: ev.title, fecha: ev.event_date, descripcion: ev.summary } };
    }

    if (!texto.trim()) return { ok: false, error: 'El texto está vacío.' };

    if (v.tool === 'crear_nota') {
      var rn = await sb.from('player_notes').insert({ player_id: p.id, coach_id: p.coach_id || S.uid, created_by: S.uid, content: texto }).select('id').single();
      if (rn.error) return { ok: false, error: rn.error.message };
      refrescarPerfil(p.id);
      return { ok: true, nota_id: rn.data.id, guardado: { alumno: nombreDe(p), texto: texto } };
    }

    if (v.tool === 'enviar_mensaje') {
      var rm = await sb.from('coach_messages').insert({ player_id: p.id, sender_id: S.uid, body: texto }).select('id').single();
      if (rm.error) return { ok: false, error: rm.error.message };
      return { ok: true, mensaje_id: rm.data.id, enviado: { alumno: nombreDe(p), texto: texto, alumno_tiene_cuenta: !!p.user_id } };
    }
    return { ok: false, error: 'Acción desconocida' };
  }

  // ═════════════════════════════════════════════════════════════════════
  // INICIO
  // ═════════════════════════════════════════════════════════════════════
  (async function () {
    try {
      var r = await sb.auth.getSession();
      var s = r && r.data && r.data.session;
      if (!s) { orb.remove(); panel.remove(); return; }
      S.uid = s.user.id;
      var meta = s.user.user_metadata || {};
      S.coach = meta.full_name || meta.name || '';
      if (!S.coach) {
        var cp = await sb.from('coach_profiles').select('display_name').eq('coach_id', S.uid).maybeSingle();
        S.coach = (cp && cp.data && cp.data.display_name) || '';
      }
    } catch (e) {}

    var guardado = ssGet(KEY_CHAT);
    if (guardado && Array.isArray(guardado.history)) {
      S.history = guardado.history;
      S.view = Array.isArray(guardado.view) ? guardado.view : [];
      // si se cambió de página con una tarjeta sin confirmar, queda cancelada
      var last = S.history[S.history.length - 1];
      if (last && last.role === 'assistant' && Array.isArray(last.content)) {
        var pend = last.content.filter(function (b) { return b.type === 'tool_use'; });
        if (pend.length) {
          S.history.push({ role: 'user', content: pend.map(function (b) {
            return { type: 'tool_result', tool_use_id: b.id, content: JSON.stringify({ ok: false, cancelado: true, nota: 'El coach cambió de página antes de confirmar.' }) };
          }) });
          S.view.forEach(function (v) { if (v.k === 'card' && v.estado === 'pendiente') v.estado = 'cancelado'; });
          guardar();
        }
      }
    }
    await cargarRoster();
    if (ssGet(KEY_OPEN)) abrir();
  })();

  window.MGL_ASISTENTE = { abrir: abrir, cerrar: cerrar, nombre: NOMBRE };
})();
