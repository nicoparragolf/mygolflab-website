/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Modo diagnóstico
   Archivo: /js/mgl-debug.js
   Versión: 1.0 · 2026-11-23

   Se activa SOLO abriendo la página con ?debug=1 (coach-ai.html lo carga
   en ese caso). Registra paso a paso lo que pasa al subir un video:
   carga/recarga de la página, toque en la zona de subida, el evento change
   del selector, qué archivo llega (nombre, tipo, tamaño), los eventos del
   reproductor y cualquier error. Lo muestra en un recuadro abajo de la
   pantalla. Las líneas se conservan si Safari recarga la pestaña, así
   se ve si la página se reinició al volver desde Fotos.
   No envía nada a ningún servidor.
   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.MGL_DEBUG) return;

  /* La sesión sobrevive a una recarga de la pestaña: así se ve si Safari recargó */
  var SES;
  try {
    SES = sessionStorage.getItem('mgl_dbg_ses');
    if (!SES) { SES = 'd' + Date.now().toString(36); sessionStorage.setItem('mgl_dbg_ses', SES); }
    var n = Number(sessionStorage.getItem('mgl_dbg_cargas') || 0) + 1;
    sessionStorage.setItem('mgl_dbg_cargas', String(n));
    window.__mglCargas = n;
  } catch (e) { SES = 'x' + Date.now().toString(36); }

  var t0 = Date.now(), lineas = [], caja = null;
  try { lineas = JSON.parse(sessionStorage.getItem('mgl_dbg_lineas') || '[]'); } catch (e) { lineas = []; }

  function log(msg) {
    var d = new Date();
    var s = ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2) + '.' +
            Math.floor(d.getMilliseconds() / 100) + ' ' + msg;
    lineas.push(s); if (lineas.length > 40) lineas.shift();
    try { sessionStorage.setItem('mgl_dbg_lineas', JSON.stringify(lineas)); } catch (e) {}
    pintar();
  }
  window.MGL_DEBUG = { log: log, sesion: SES };

  function pintar() {
    if (!caja) return;
    caja.querySelector('pre').textContent = lineas.slice(-18).join('\n');
    caja.scrollTop = caja.scrollHeight;
  }

  /* ── Lo básico ── */
  var nav = '';
  try { var pe = performance.getEntriesByType('navigation')[0]; nav = pe ? pe.type : ''; } catch (e) {}
  log('CARGA #' + window.__mglCargas + ' tipo=' + nav + ' · ' + navigator.userAgent.slice(0, 120));

  window.addEventListener('error', function (e) {
    log('ERROR ' + (e.message || e) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; log('PROMESA RECHAZADA ' + (r && (r.message || r)));
  });
  document.addEventListener('visibilitychange', function () { log('visibilidad=' + document.visibilityState); });
  window.addEventListener('pageshow', function (e) { log('pageshow persisted=' + e.persisted); });
  window.addEventListener('focus', function () { log('focus'); });

  ['error', 'warn'].forEach(function (k) {
    var orig = console[k];
    console[k] = function () {
      try { log('console.' + k + ' ' + Array.prototype.map.call(arguments, function (a) {
        return (a && a.message) ? a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a));
      }).join(' ').slice(0, 300)); } catch (e) {}
      return orig.apply(console, arguments);
    };
  });

  function instalar() {
    caja = document.createElement('div');
    caja.style.cssText = 'position:fixed;left:6px;right:6px;bottom:6px;z-index:2147483647;background:rgba(0,0,0,.88);' +
      'color:#2dd4bf;font:11px/1.35 ui-monospace,Menlo,monospace;border:1px solid #2dd4bf;border-radius:8px;padding:6px 8px;' +
      'max-height:38vh;overflow:auto;pointer-events:auto';
    caja.innerHTML = '<div style="color:#D4C5A9;margin-bottom:4px">DIAGNÓSTICO · sesión ' + SES +
      ' <button type="button" data-b style="float:right;font:inherit;background:none;border:1px solid #555;color:#aaa;border-radius:4px;margin-left:6px">borrar</button>' +
      ' <button type="button" data-o style="float:right;font:inherit;background:none;border:1px solid #555;color:#aaa;border-radius:4px">ocultar</button></div><pre style="margin:0;white-space:pre-wrap"></pre>';
    caja.querySelector('[data-o]').onclick = function () { caja.style.display = 'none'; };
    caja.querySelector('[data-b]').onclick = function () {
      lineas = []; try { sessionStorage.removeItem('mgl_dbg_lineas'); sessionStorage.removeItem('mgl_dbg_cargas'); } catch (e) {}
      pintar();
    };
    document.body.appendChild(caja);
    pintar();

    var dz = document.getElementById('dropZone'), inp = document.getElementById('videoInput');
    var pl = document.getElementById('previewPlayer');
    log('DOM listo · dropZone=' + !!dz + ' input=' + !!inp + ' padreInput=' + (inp && inp.parentNode && inp.parentNode.tagName) +
        ' accept=' + (inp && inp.accept) + ' motor=' + (window.MGL_MOTOR && window.MGL_MOTOR.version));

    if (dz) dz.addEventListener('click', function () { log('toque en zona de subida'); }, true);
    if (inp) {
      inp.addEventListener('click', function () { log('input.click (se abre el selector)'); }, true);
      ['change', 'input', 'cancel'].forEach(function (ev) {
        inp.addEventListener(ev, function () {
          var f = inp.files && inp.files[0];
          log('input.' + ev + ' · archivos=' + (inp.files ? inp.files.length : 'null') +
              (f ? ' · ' + f.name + ' · tipo="' + f.type + '" · ' + (f.size / 1048576).toFixed(1) + ' MB' : ''));
        }, true);
      });
    }
    if (pl) {
      ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'stalled', 'suspend', 'error', 'seeked'].forEach(function (ev) {
        pl.addEventListener(ev, function () {
          log('video.' + ev + ' · dur=' + pl.duration + ' · ' + pl.videoWidth + 'x' + pl.videoHeight +
              ' · ready=' + pl.readyState + (ev === 'error' && pl.error ? ' · código ' + pl.error.code + ' ' + (pl.error.message || '') : ''));
        });
      });
    }

    /* Envolver funciones de la página para ver si se llaman */
    ['handleVideoFile', 'extractFrames', 'showStatus'].forEach(function (nombre) {
      var f = window[nombre];
      if (typeof f !== 'function') { log('no existe ' + nombre); return; }
      window[nombre] = function () {
        var a = arguments;
        if (nombre === 'showStatus') log('mensaje: ' + String(a[1]).slice(0, 140));
        else if (nombre === 'handleVideoFile') log('handleVideoFile(' + (a[0] && a[0].name) + ')');
        else log('extractFrames()');
        try { return f.apply(this, a); }
        catch (e) { log('EXCEPCIÓN en ' + nombre + ': ' + (e && e.message)); throw e; }
      };
    });
    log('instrumentación lista');
  }

  if (document.readyState === 'complete') instalar();
  else window.addEventListener('load', function () { setTimeout(instalar, 300); });
})();
