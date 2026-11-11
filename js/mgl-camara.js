/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Cámara de swing + menú rápido del botón central
   Archivo: /js/mgl-camara.js
   Versión: 1.1 · 2026-11-11 (varios videos seguidos)

   1. Cámara
      En la app de iPhone (versión con la cámara nueva) se usa la cámara
      nativa CamaraSwing (app-movil/ios/App/App/CamaraSwing.swift): video
      estabilizado, 1080p a 60 fps, lentes 0.5× / 1× / 2×, en H.264.
      En el navegador, en Android o en versiones antiguas de la app se usa
      la cámara normal del teléfono (<input capture>).

      · Cualquier <input type="file" capture accept="video/..."> de la página
        se desvía solo a la cámara nueva cuando está disponible (no hay que
        tocar cada página). Para excluir uno: data-sin-camara-nativa.
      · MGLCamara.grabarVarios() → Promise<File[]> (se pueden grabar varios seguidos)
      · MGLCamara.grabar()      → Promise<File | null> (el último)
      · MGLCamara.nativa()      → true si está la cámara nueva
      · MGLCamara.dejar(file) / MGLCamara.tomar()
            pasar el video recién grabado a otra pestaña (analizador, evento)

   2. Menú rápido (botón dorado del centro del menú inferior del coach)
      MGLCamara.menuRapido() → Grabar video · Analizar swing · Crear evento.
      Después de grabar: Analizar ahora · Subir al perfil de un alumno ·
      Guardar en el teléfono.

   Sin template literals (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLCamara) return;

  // ── Plugin nativo ──────────────────────────────────────────────────────
  function cap() {
    var C = window.Capacitor;
    if (!C) { try { C = window.parent && window.parent.Capacitor; } catch (e) {} }
    return C || null;
  }
  function plugin() {
    var C = cap();
    if (!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
    if (C.getPlatform && C.getPlatform() !== 'ios') return null;
    if (C.__camaraSwing) return C.__camaraSwing;
    var ok = C.isPluginAvailable ? C.isPluginAvailable('CamaraSwing') : !!(C.PluginHeaders && C.PluginHeaders.some(function (h) { return h.name === 'CamaraSwing'; }));
    if (!ok) return null;
    var p = null;
    try { p = C.registerPlugin ? C.registerPlugin('CamaraSwing') : (C.Plugins && C.Plugins.CamaraSwing); } catch (e) {}
    if (!p && C.Plugins) p = C.Plugins.CamaraSwing || null;
    C.__camaraSwing = p;
    return p;
  }

  // ── Estilos ────────────────────────────────────────────────────────────
  var css = ''
    + '.mcam-ov{position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.62);display:flex;align-items:flex-end;justify-content:center;'
    +   'animation:mcamF .18s ease;-webkit-tap-highlight-color:transparent}'
    + '.mcam-ov.centro{align-items:center}'
    + '@keyframes mcamF{from{opacity:0}to{opacity:1}}'
    + '@keyframes mcamU{from{transform:translateY(24px);opacity:.6}to{transform:none;opacity:1}}'
    + '.mcam-sh{width:100%;max-width:520px;background:var(--c141414,#141414);border:1px solid var(--c2a2a2a,#2a2a2a);border-bottom:0;'
    +   'border-radius:22px 22px 0 0;padding:10px 16px calc(18px + env(safe-area-inset-bottom,0px));box-sizing:border-box;animation:mcamU .22s ease;'
    +   'font-family:Barlow,sans-serif;color:var(--cf5f5f5,#f5f5f5)}'
    + '.mcam-grip{width:40px;height:4px;border-radius:2px;background:var(--c3a3a3a,#3a3a3a);margin:2px auto 12px}'
    + '.mcam-sh h3{margin:0 4px 2px;font-family:"Barlow Condensed",sans-serif;font-size:21px;font-weight:700;letter-spacing:.3px;text-transform:uppercase}'
    + '.mcam-sh .sub{margin:0 4px 14px;color:var(--c8a8a8a,#8a8a8a);font-size:14px}'
    + '.mcam-op{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--c1a1a1a,#1a1a1a);border:1px solid var(--c262626,#262626);'
    +   'border-radius:16px;padding:14px;margin:0 0 10px;color:inherit;font:inherit;cursor:pointer;box-sizing:border-box}'
    + '.mcam-op:active{transform:scale(.985);background:var(--c202020,#202020)}'
    + '.mcam-op .ic{flex:0 0 auto;width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;'
    +   'background:rgba(var(--r212_197_169,212,197,169),.12);color:var(--cd4c5a9,#D4C5A9)}'
    + '.mcam-op.rec .ic{background:rgba(235,64,52,.14);color:#ff5a4f}'
    + '.mcam-op.top{border-color:rgba(var(--r212_197_169,212,197,169),.45);background:rgba(var(--r212_197_169,212,197,169),.08)}'
    + '.mcam-op .ic svg{width:24px;height:24px}'
    + '.mcam-op b{display:block;font-size:16.5px;font-weight:600}'
    + '.mcam-op small{display:block;color:var(--c8a8a8a,#8a8a8a);font-size:13.5px;margin-top:2px;line-height:1.3}'
    + '.mcam-x{display:block;width:100%;background:none;border:0;color:var(--c8a8a8a,#8a8a8a);font:600 15px Barlow,sans-serif;padding:10px;margin-top:2px;cursor:pointer}'
    + '.mcam-x.del{color:#ff6b61}'
    + '.mcam-prev{display:flex;gap:12px;align-items:center;margin:0 4px 14px}'
    + '.mcam-prev video{width:62px;height:88px;object-fit:cover;border-radius:10px;background:#000;border:1px solid var(--c2a2a2a,#2a2a2a)}'
    + '.mcam-prev h3{margin:0}.mcam-prev .sub{margin:2px 0 0}'
    + '.mcam-box{background:var(--c141414,#141414);border:1px solid var(--c2a2a2a,#2a2a2a);border-radius:18px;padding:22px 26px;min-width:220px;text-align:center;'
    +   'font-family:Barlow,sans-serif;color:var(--cf5f5f5,#f5f5f5)}'
    + '.mcam-box b{display:block;font-size:16px;margin-bottom:12px}'
    + '.mcam-bar{height:6px;border-radius:3px;background:var(--c2a2a2a,#2a2a2a);overflow:hidden}'
    + '.mcam-bar i{display:block;height:100%;width:0;background:var(--cd4c5a9,#D4C5A9);transition:width .15s}'
    + '.mcam-err{margin-top:12px;color:#ff6b61;font-size:14px}';
  function ponerCss() {
    if (document.getElementById('mgl-camara-css')) return;
    var st = document.createElement('style');
    st.id = 'mgl-camara-css';
    st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  var IC = {
    rec: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="M16 10.5l6-3.5v10l-6-3.5"/><circle cx="9" cy="12" r="2.2" fill="currentColor" stroke="none"/></svg>',
    swing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="14" height="14" rx="2.5"/><path d="M16.5 10l5-3v10l-5-3"/><path d="M6 15.5l3.5-5 3 3"/></svg>',
    evento: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M12 13v5M9.5 15.5h5"/></svg>',
    alumno: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0114 0v1"/></svg>',
    bajar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17"/></svg>'
  };

  // ── Hoja inferior ──────────────────────────────────────────────────────
  function hoja(html, alCerrar) {
    ponerCss();
    var ov = document.createElement('div');
    ov.className = 'mcam-ov';
    ov.innerHTML = '<div class="mcam-sh" role="dialog"><div class="mcam-grip"></div>' + html + '</div>';
    function cerrar() {
      if (!ov.parentNode) return;
      ov.parentNode.removeChild(ov);
      if (alCerrar) alCerrar();
    }
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(); });
    document.body.appendChild(ov);
    return { el: ov, cerrar: cerrar };
  }
  function opcion(id, ic, titulo, sub, clase) {
    return '<button class="mcam-op' + (clase ? ' ' + clase : '') + '" data-op="' + id + '"><span class="ic">' + ic + '</span>'
      + '<span><b>' + titulo + '</b><small>' + sub + '</small></span></button>';
  }

  function progreso(texto) {
    ponerCss();
    var ov = document.createElement('div');
    ov.className = 'mcam-ov centro';
    ov.innerHTML = '<div class="mcam-box"><b>' + texto + '</b><div class="mcam-bar"><i></i></div></div>';
    document.body.appendChild(ov);
    return {
      pct: function (p) { var i = ov.querySelector('i'); if (i) i.style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; },
      error: function (m) {
        var box = ov.querySelector('.mcam-box');
        box.innerHTML = '<b>No se pudo usar el video</b><div class="mcam-err"></div><button class="mcam-x">Cerrar</button>';
        box.querySelector('.mcam-err').textContent = m;
        box.querySelector('button').onclick = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
      },
      cerrar: function () { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    };
  }

  // ── Grabar ─────────────────────────────────────────────────────────────
  function base64ABytes(b64) {
    var bin = atob(b64 || ''), n = bin.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  var TROZO = 3 * 1024 * 1024;
  var grabandoAhora = false;

  // Lee un video de la cámara nativa (en trozos) y lo arma como File
  async function leerVideo(p, v, pr, hecho, total) {
    var partes = [], off = 0;
    for (;;) {
      var c = await p.leer({ path: v.path, offset: off, length: TROZO });
      var n = (c && Number(c.bytes)) || 0;
      if (!n) break;
      partes.push(base64ABytes(c.data));
      off += n;
      if (total) pr.pct((hecho + off) / total);
      if (n < TROZO) break;
    }
    if (!off) throw new Error('El video quedó vacío.');
    var f = new File(partes, v.nombre || 'swing.mp4', { type: v.tipo || 'video/mp4', lastModified: Date.now() });
    try { f.__rutaNativa = v.path; f.__duracion = Number(v.duracion) || 0; } catch (e) {}
    return { file: f, bytes: off };
  }

  // Devuelve una lista de File (la cámara permite grabar varios seguidos)
  async function grabarNativo(p, opts) {
    opts = opts || {};
    var r = await p.grabar({ fps: opts.fps || 60 });
    if (!r || r.cancelado) return [];
    var lista = (r.videos && r.videos.length) ? r.videos : (r.path ? [r] : []);
    if (!lista.length) return [];
    var pr = progreso(lista.length > 1 ? 'Preparando ' + lista.length + ' videos…' : 'Preparando video…');
    try {
      var total = 0, hecho = 0, out = [];
      lista.forEach(function (v) { total += Number(v.bytes) || 0; });
      for (var i = 0; i < lista.length; i++) {
        var x = await leerVideo(p, lista[i], pr, hecho, total);
        hecho += x.bytes;
        out.push(x.file);
      }
      pr.cerrar();
      return out;
    } catch (e) {
      pr.error((e && e.message) || 'Intenta grabar de nuevo.');
      return [];
    }
  }

  function grabarWeb() {
    return new Promise(function (ok) {
      var i = document.createElement('input');
      i.type = 'file';
      i.accept = 'video/*';
      i.setAttribute('capture', 'environment');
      i.setAttribute('data-sin-camara-nativa', '');
      i.style.display = 'none';
      document.body.appendChild(i);
      var listo = false;
      function fin(f) {
        if (listo) return;
        listo = true;
        ok(f || null);
        setTimeout(function () { if (i.parentNode) i.parentNode.removeChild(i); }, 0);
      }
      i.addEventListener('change', function () { fin(i.files && i.files[0]); });
      i.addEventListener('cancel', function () { fin(null); });
      i.click();
    });
  }

  // Lista de videos (en el navegador, uno solo)
  async function grabarVarios(opts) {
    var p = plugin();
    if (!p) { var w = await grabarWeb(); return w ? [w] : []; }
    if (grabandoAhora) return [];
    grabandoAhora = true;
    try { return await grabarNativo(p, opts); }
    catch (e) {
      console.warn('camara', e);
      alert('No se pudo abrir la cámara: ' + ((e && e.message) || 'intenta de nuevo.'));
      return [];
    } finally { grabandoAhora = false; }
  }

  // Un solo video (el último grabado)
  async function grabar(opts) {
    var l = await grabarVarios(opts);
    return l.length ? l[l.length - 1] : null;
  }

  // ── Cualquier <input capture> de video usa la cámara nueva ──────────────
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'INPUT' || t.type !== 'file') return;
    if (!t.hasAttribute('capture') || t.hasAttribute('data-sin-camara-nativa')) return;
    if (t.accept && !/video/i.test(t.accept)) return;
    var p = plugin();
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    if (grabandoAhora) return;
    grabandoAhora = true;
    grabarNativo(p, {}).then(function (lista) {
      grabandoAhora = false;
      if (!lista || !lista.length) return;
      if (!t.multiple) lista = [lista[lista.length - 1]];
      try {
        var dt = new DataTransfer();
        lista.forEach(function (f) { dt.items.add(f); });
        t.files = dt.files;
      } catch (er) { console.warn('camara: no se pudo pasar el archivo', er); return; }
      t.dispatchEvent(new Event('change', { bubbles: true }));
    }, function (er) {
      grabandoAhora = false;
      console.warn('camara', er);
      alert('No se pudo abrir la cámara: ' + ((er && er.message) || 'intenta de nuevo.'));
    });
  }, true);

  // ── Pasar los videos recién grabados a otra pestaña ─────────────────────
  function arriba() { try { return window.top || window; } catch (e) { return window; } }
  function dejar(lista) {
    if (lista && !lista.length && lista.size != null) lista = [lista];
    try { arriba().__mglVideoNuevo = { files: lista || [], t: Date.now() }; } catch (e) {}
  }
  // Devuelve la lista (vacía si no hay nada)
  function tomar() {
    try {
      var w = arriba(), x = w.__mglVideoNuevo;
      w.__mglVideoNuevo = null;
      if (!x || !x.files || Date.now() - x.t > 30 * 60 * 1000) return [];
      // se rearman en esta página (vienen de otra pestaña)
      return x.files.map(function (f) {
        var g = new File([f], f.name || 'swing.mp4', { type: f.type || 'video/mp4', lastModified: f.lastModified || Date.now() });
        try { g.__rutaNativa = f.__rutaNativa; } catch (e) {}
        return g;
      });
    } catch (e) { return []; }
  }

  // ── Guardar en el teléfono ──────────────────────────────────────────────
  async function guardarEnTelefono(lista) {
    if (lista && lista.size != null) lista = [lista];
    lista = lista || [];
    var C = cap();
    var Share = C && C.Plugins && C.isNativePlatform && C.isNativePlatform() ? C.Plugins.Share : null;
    var rutas = lista.filter(function (f) { return f.__rutaNativa; }).map(function (f) { return 'file://' + f.__rutaNativa; });
    if (Share && rutas.length === lista.length && rutas.length) {
      try { await Share.share({ title: lista[0].name, files: rutas }); return; }
      catch (e) { if (/cancel/i.test(String((e && e.message) || e))) return; }
    }
    var app = window.MGLApp;
    try { if (!app && window.top) app = window.top.MGLApp; } catch (e) {}
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i];
      if (app && app.esNativo && app.esNativo()) { await app.guardarBlob(f, f.name); continue; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(f);
      a.download = f.name || 'swing.mp4';
      document.body.appendChild(a);
      a.click();
      (function (el) { setTimeout(function () { URL.revokeObjectURL(el.href); el.remove(); }, 4000); })(a);
    }
  }

  // ── Menú rápido ─────────────────────────────────────────────────────────
  function ir(url) {
    if (window.MGLnav) window.MGLnav.href = url; else location.href = url;
  }
  function fmtDur(s) {
    s = Math.round(Number(s) || 0);
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }
  function fmtMB(b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB'; }

  function menuRapido() {
    var h = hoja(
      '<h3>¿Qué quieres hacer?</h3><p class="sub">Acceso rápido durante la clase</p>'
      + opcion('grabar', IC.rec, 'Grabar video', 'Cámara estabilizada para el swing', 'rec')
      + opcion('analizar', IC.swing, 'Analizar swing', 'Dibuja, compara dos swings y graba tu voz')
      + opcion('evento', IC.evento, 'Crear evento', 'Clase, video o ronda para un alumno')
      + '<button class="mcam-x" data-op="x">Cancelar</button>'
    );
    h.el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-op]') : null;
      if (!b) return;
      var op = b.getAttribute('data-op');
      h.cerrar();
      if (op === 'grabar') grabarYDecidir();
      else if (op === 'analizar') ir('/es/coachhub/analisis.html?from=dash');
      else if (op === 'evento') ir('/es/coachhub/jugador.html?nuevo=evento&t=' + Date.now());
    });
  }

  async function grabarYDecidir() {
    var lista = await grabarVarios({});
    if (!lista.length) return;
    despuesDeGrabar(lista);
  }

  function despuesDeGrabar(lista) {
    var ult = lista[lista.length - 1];
    var url = URL.createObjectURL(ult);
    var bytes = 0, dur = 0;
    lista.forEach(function (f) { bytes += f.size; dur += f.__duracion || 0; });
    var varios = lista.length > 1;
    var info = (varios ? lista.length + ' videos · ' : (dur ? fmtDur(dur) + ' · ' : '')) + fmtMB(bytes);
    var h = hoja(
      '<div class="mcam-prev"><video src="' + url + '#t=0.5" muted playsinline preload="metadata"></video>'
      + '<div><h3>' + (varios ? 'Videos listos' : 'Video listo') + '</h3><p class="sub">' + info + '</p></div></div>'
      + opcion('alumno', IC.alumno, 'Subir al perfil de un alumno', 'Le llega un aviso al teléfono y no ocupa tu galería', 'top')
      + opcion('analizar', IC.swing, varios ? 'Analizar el último' : 'Analizar ahora', 'Abre el video en el analizador')
      + opcion('guardar', IC.bajar, 'Guardar en el teléfono', 'Para tus fotos o para mandarlo por WhatsApp')
      + '<button class="mcam-x del" data-op="x">' + (varios ? 'Descartar videos' : 'Descartar video') + '</button>',
      function () { setTimeout(function () { URL.revokeObjectURL(url); }, 1000); }
    );
    h.el.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-op]') : null;
      if (!b) return;
      var op = b.getAttribute('data-op');
      if (op === 'x') {
        if (!confirm(varios ? '¿Descartar los ' + lista.length + ' videos?' : '¿Descartar el video?')) return;
        h.cerrar();
        return;
      }
      if (op === 'guardar') {
        guardarEnTelefono(lista).catch(function (er) { alert((er && er.message) || 'No se pudo guardar el video.'); });
        return;   // la hoja sigue abierta para elegir otra cosa después
      }
      h.cerrar();
      if (op === 'analizar') { dejar([ult]); ir('/es/coachhub/analisis.html?from=dash&video=nuevo'); }
      else if (op === 'alumno') { dejar(lista); ir('/es/coachhub/jugador.html?nuevo=evento&video=nuevo&t=' + Date.now()); }
    });
  }

  window.MGLCamara = {
    nativa: function () { return !!plugin(); },
    grabar: grabar,
    grabarVarios: grabarVarios,
    dejar: dejar,
    tomar: tomar,
    guardarEnTelefono: guardarEnTelefono,
    menuRapido: menuRapido
  };
})();
