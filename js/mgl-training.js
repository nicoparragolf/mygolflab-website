/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · mgl-training.js  v1.1  ·  2026-08-01

   ── v1.1: ARREGLO DE LECTURA DEL CATÁLOGO ─────────────────────────────────
   La v1.0 buscaba el catálogo de drills en window.allDrills y no lo
   encontraba, así que abortaba con "allDrills no existe". El motivo: en
   training.html el catálogo se declara con `let allDrills`, y las variables
   declaradas con let o const NO quedan colgadas de window, aunque sí sean
   globales. Ahora se lee por nombre directo, con window como respaldo.

   QUÉ HACE
   Hace que Training Lab registre lo que entrenas. Hoy el botón "Empezar Drill"
   solo cierra la ventana y no queda rastro de la sesión. Con este archivo, al
   terminar un drill puedes anotar tu puntaje y el tiempo, y eso se guarda en
   Supabase. El dashboard lo lee para mostrarte tu entrenamiento por área y
   para saber cuándo toca volver a medir tu swing.

   CÓMO SE INSTALA
   1. Copiar este archivo en la carpeta /js/ del sitio
   2. En training.html, justo antes del cierre de BODY, agregar una etiqueta
      script que apunte a  /js/mgl-training.js

   CÓMO SE DESINSTALA
   Borrar esa línea. Training Lab vuelve exactamente a como estaba.

   IMPORTANTE
   No modifica training.html por dentro. Redefine funciones desde afuera, así
   que debe cargarse DESPUÉS del script principal, al final del <body>.

   REQUIERE
   Haber corrido mgl-setup.sql en Supabase (crea la tabla training_sessions).
   Si la tabla no existe, el panel avisa y no se pierde nada.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var VERSION = '1.1';

  var SB_URL  = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
  var TABLA = 'training_sessions';

  var estado = {
    instalado: false, cliente: null, tablaOK: null,
    drillActual: null, varianteActual: null,
    componenteFoco: null, guardadas: 0, ultimoError: null
  };

  /* ── Catálogo de drills de training.html ──
     Se declara allá con `let allDrills`, y las variables declaradas con let
     o const no aparecen en window aunque sean globales. Por eso se lee por
     nombre directo; window queda como respaldo por si algún día cambia. */
  function catalogo() {
    try {
      if (typeof allDrills !== 'undefined' && Array.isArray(allDrills)) return allDrills;
    } catch (e) { /* la variable aún no existe */ }
    if (Array.isArray(window.allDrills)) return window.allDrills;
    return null;
  }

  /* ── Cliente de Supabase: reusa el de la página si ya existe ── */
  function db() {
    if (estado.cliente) return estado.cliente;
    var cand = [window.sb, window.supabaseClient, window._sb, window.client];
    for (var i = 0; i < cand.length; i++) {
      var c = cand[i];
      if (c && typeof c.from === 'function' && c.auth) { estado.cliente = c; return c; }
    }
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      estado.cliente = window.supabase.createClient(SB_URL, SB_ANON);
      return estado.cliente;
    }
    return null;
  }

  async function usuario() {
    var c = db();
    if (!c) return null;
    try {
      var r = await c.auth.getSession();
      return (r.data && r.data.session) ? r.data.session.user : null;
    } catch (e) { return null; }
  }

  /* ── El componente del swing que el jugador está trabajando ──
     Lo tomamos de su diagnóstico más reciente, para poder cruzar
     entrenamiento con técnica en el dashboard. */
  async function cargarFoco() {
    var c = db(), u = await usuario();
    if (!c || !u) return;
    try {
      var r = await c.from('swing_findings')
        .select('componente, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (!r.error && r.data && r.data.length) estado.componenteFoco = r.data[0].componente;
    } catch (e) { /* no es crítico */ }
  }

  /* ── ¿Existe la tabla? ── */
  async function revisarTabla() {
    var c = db(), u = await usuario();
    if (!c || !u) { estado.tablaOK = false; return false; }
    try {
      var r = await c.from(TABLA).select('id', { count: 'exact', head: true }).eq('user_id', u.id);
      estado.tablaOK = !r.error;
      if (r.error) estado.ultimoError = r.error.message;
      return estado.tablaOK;
    } catch (e) { estado.tablaOK = false; return false; }
  }

  /* ── CSS del panel ── */
  function inyectarCSS() {
    if (document.getElementById('mgl-training-css')) return;
    var css =
      '.mgl-reg{margin-top:20px;padding-top:20px;border-top:1px solid var(--border)}' +
      '.mgl-reg-t{font-family:var(--font-heading),sans-serif;font-size:11px;font-weight:700;' +
        'letter-spacing:3px;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px;' +
        'display:flex;align-items:center;gap:8px}' +
      '.mgl-reg-t::after{content:"";flex:1;height:1px;background:var(--border)}' +
      '.mgl-campos{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}' +
      '.mgl-c{display:flex;flex-direction:column;gap:6px;flex:1;min-width:88px}' +
      '.mgl-c label{font-family:var(--font-heading),sans-serif;font-size:10px;font-weight:700;' +
        'letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted)}' +
      '.mgl-c input{background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;' +
        'padding:11px 12px;color:var(--text);font-family:var(--font-body),sans-serif;' +
        'font-size:14px;outline:none;width:100%;transition:border-color .2s}' +
      '.mgl-c input:focus{border-color:var(--teal,#2dd4bf)}' +
      '.mgl-guardar{width:100%;margin-top:14px;padding:14px;border:none;border-radius:10px;' +
        'background:var(--teal,#2dd4bf);color:#0a0a0a;font-family:var(--font-heading),sans-serif;' +
        'font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;' +
        'transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}' +
      '.mgl-guardar:hover{background:#4eecd9}' +
      '.mgl-guardar:disabled{opacity:.5;cursor:wait}' +
      '.mgl-guardar.hecho{background:#10b981}' +
      '.mgl-msg{font-size:13px;line-height:1.6;margin-top:12px;color:var(--text-muted)}' +
      '.mgl-pista{font-size:12.5px;line-height:1.6;color:var(--text-muted);margin-bottom:14px;opacity:.85}' +
      '@media(max-width:600px){.mgl-c{min-width:calc(50% - 5px)}}';
    var el = document.createElement('style');
    el.id = 'mgl-training-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  /* ── Adivinar el puntaje máximo desde el texto del sistema de puntuación ──
     Los drills describen su puntuación en prosa ("1 punto por cada acierto,
     máximo 18"). Buscamos un número plausible para prellenar el campo. */
  function maximoSugerido(variante) {
    if (!variante) return '';
    var txt = (variante.puntuacion && variante.puntuacion.sistema) || '';
    var m = txt.match(/m[áa]ximo\s+de?\s*(\d{1,3})/i) || txt.match(/(\d{1,3})\s*puntos?\s+m[áa]x/i);
    if (m) return m[1];
    if (variante.num_pelotas) return String(variante.num_pelotas);
    return '';
  }

  function minutosDe(variante) {
    if (!variante || !variante.duracion) return '';
    var m = String(variante.duracion).match(/(\d{1,3})/);
    return m ? m[1] : '';
  }

  /* ── Insertar el panel de registro dentro del modal ── */
  function pintarPanel() {
    var cuerpo = document.querySelector('#drillModal .modal-body');
    if (!cuerpo) return;

    var viejo = document.getElementById('mgl-reg');
    if (viejo) viejo.remove();

    var d = estado.drillActual, v = estado.varianteActual;
    if (!d) return;

    var cont = document.createElement('div');
    cont.className = 'mgl-reg';
    cont.id = 'mgl-reg';

    if (estado.tablaOK === false) {
      cont.innerHTML =
        '<div class="mgl-reg-t">Registrar sesión</div>' +
        '<div class="mgl-msg">Para guardar tus sesiones falta correr <b>mgl-setup.sql</b> ' +
        'en Supabase. Mientras tanto puedes entrenar igual, pero no queda registro.</div>';
      cuerpo.appendChild(cont);
      return;
    }

    cont.innerHTML =
      '<div class="mgl-reg-t">Registrar esta sesión</div>' +
      '<div class="mgl-pista">Cuando termines, anota tu resultado. Los campos son opcionales: ' +
      'con solo presionar el botón ya queda registrado que entrenaste este drill.</div>' +
      '<div class="mgl-campos">' +
        '<div class="mgl-c"><label for="mglPts">Mi puntaje</label>' +
          '<input type="number" id="mglPts" min="0" max="999" placeholder="—"></div>' +
        '<div class="mgl-c"><label for="mglMax">De un máximo de</label>' +
          '<input type="number" id="mglMax" min="1" max="999" placeholder="—" value="' +
          maximoSugerido(v) + '"></div>' +
        '<div class="mgl-c"><label for="mglMin">Minutos</label>' +
          '<input type="number" id="mglMin" min="1" max="600" placeholder="—" value="' +
          minutosDe(v) + '"></div>' +
      '</div>' +
      '<button class="mgl-guardar" id="mglGuardar">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.5" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>' +
      'Terminé este drill</button>' +
      '<div class="mgl-msg" id="mglMsg"></div>';

    cuerpo.appendChild(cont);
    document.getElementById('mglGuardar').addEventListener('click', guardar);
  }

  /* ── Guardar en Supabase ── */
  async function guardar() {
    var btn = document.getElementById('mglGuardar');
    var msg = document.getElementById('mglMsg');
    var c = db(), u = await usuario();

    if (!u) {
      msg.textContent = 'Necesitas iniciar sesión para guardar tus sesiones.';
      msg.style.color = '#ef4444';
      return;
    }

    var pts = document.getElementById('mglPts').value;
    var max = document.getElementById('mglMax').value;
    var min = document.getElementById('mglMin').value;
    var d = estado.drillActual;

    btn.disabled = true;
    btn.textContent = 'Guardando…';
    msg.textContent = '';

    var fila = {
      user_id: u.id,
      drill_id: String(d.id),
      drill_nombre: d.name || null,
      categoria: d.category || null,
      variante: estado.nombreVariante || null,
      puntaje: pts === '' ? null : Number(pts),
      puntaje_max: max === '' ? null : Number(max),
      duracion_min: min === '' ? null : Number(min),
      componente: estado.componenteFoco || null
    };

    try {
      var r = await c.from(TABLA).insert(fila);
      if (r.error) throw r.error;

      estado.guardadas++;
      btn.classList.add('hecho');
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Registrado';

      var pct = (fila.puntaje != null && fila.puntaje_max)
        ? Math.round((fila.puntaje / fila.puntaje_max) * 100) : null;
      msg.innerHTML = 'Sesión guardada' + (pct !== null ? ' · <b>' + pct + '%</b>' : '') +
        '. Ya aparece en tu dashboard.';
      msg.style.color = '#10b981';

      console.log('%c[MGL] 🏌️ Sesión registrada · ' + (d.name || d.id) +
        (pct !== null ? ' · ' + pct + '%' : ''), 'color:#10b981;font-weight:bold');

      setTimeout(function () {
        if (typeof window.closeModal === 'function') window.closeModal();
      }, 1300);

    } catch (e) {
      estado.ultimoError = e.message || String(e);
      msg.textContent = 'No se pudo guardar: ' + estado.ultimoError;
      msg.style.color = '#ef4444';
      btn.disabled = false;
      btn.textContent = 'Terminé este drill';
      console.error('[MGL] Error guardando la sesión:', e);
    }
  }

  /* ── Interceptar la apertura del modal ── */
  var intentos = 0;

  function instalar() {
    if (estado.instalado) return;
    inyectarCSS();

    var errores = [];
    if (typeof window.openModal !== 'function') {
      errores.push('openModal() no existe — ¿el archivo está al final del <body> de training.html?');
    }
    if (catalogo() === null) {
      errores.push('No se encontró el catálogo de drills (allDrills)');
    }

    /* El catálogo se descarga por fetch al cargar la página, así que puede
       no estar listo todavía. Reintentamos unas cuantas veces antes de rendirnos. */
    if (errores.length && intentos < 12) {
      intentos++;
      setTimeout(instalar, 500);
      return;
    }

    if (errores.length) {
      console.log('%c════════════════════════════════════════════', 'color:#ef4444');
      console.log('%c  MGL TRAINING — NO SE PUDO INSTALAR', 'color:#ef4444;font-weight:bold;font-size:13px');
      errores.forEach(function (e) { console.error('  ❌ ' + e); });
      console.log('%c  El archivo debe cargarse al final del <body>, después del script principal.',
                  'color:#ef4444');
      window.MGL_TRAINING_OK = false;
      return;
    }

    var original = window.openModal;
    window.openModal = function (drillId, levelKey) {
      original.apply(this, arguments);
      try {
        var lista = catalogo() || [];
        var d = lista.filter(function (x) { return String(x.id) === String(drillId); })[0];
        estado.drillActual = d || null;
        estado.nombreVariante = levelKey || null;
        estado.varianteActual = (d && d.variaciones) ? d.variaciones[levelKey] : null;
        pintarPanel();
      } catch (e) { console.warn('[MGL] No se pudo dibujar el panel:', e); }
    };

    /* El botón original "Empezar Drill" pasa a ser secundario:
       ahora el que registra es el nuestro. */
    var cta = document.getElementById('modalCta');
    if (cta) {
      cta.style.background = 'transparent';
      cta.style.color = 'var(--text-muted)';
      cta.style.border = '1px solid var(--border)';
      cta.innerHTML = 'Cerrar';
    }

    estado.instalado = true;

    console.log('%c════════════════════════════════════════════', 'color:#2dd4bf');
    console.log('%c  MyGolfLab · TRAINING v' + VERSION + ' — INSTALADO',
                'color:#2dd4bf;font-weight:bold;font-size:13px');
    console.log('%c════════════════════════════════════════════', 'color:#2dd4bf');

    (async function () {
      await cargarFoco();
      var ok = await revisarTabla();
      if (ok) {
        console.log('%c  ✅ Tus sesiones de entrenamiento se van a guardar', 'color:#10b981');
        if (estado.componenteFoco) {
          console.log('%c  ✅ Componente en foco: ' + estado.componenteFoco, 'color:#10b981');
        }
        window.MGL_TRAINING_OK = true;
      } else {
        console.warn('%c  ⚠️ La tabla training_sessions no responde. ¿Corriste mgl-setup.sql?',
                     'color:#f59e0b');
        window.MGL_TRAINING_OK = false;
      }
      console.log('%c  Escribe MGL_TRAINING_TEST() para revisar el estado.', 'color:#888');
    })();
  }

  /* ── Autotest ── */
  window.MGL_TRAINING_TEST = async function () {
    var r = [], c = db();
    function t(n, ok, d) { r.push({ prueba: n, resultado: ok ? 'OK' : 'REVISAR', detalle: d }); }

    t('Parche instalado', estado.instalado, '');
    t('Cliente de Supabase', !!c, c ? 'disponible' : 'no se encontró');

    var u = null;
    if (c) { try { u = await usuario(); } catch (e) {} }
    t('Sesión iniciada', !!u, u ? u.email : 'entra con tu cuenta');

    var cuantas = 0;
    if (c && u) {
      var q = await c.from(TABLA).select('id', { count: 'exact', head: true }).eq('user_id', u.id);
      t('Tabla training_sessions', !q.error, q.error ? q.error.message : 'accesible');
      cuantas = q.count || 0;
    } else {
      t('Tabla training_sessions', false, 'sin sesión, no se puede comprobar');
    }

    t('Sesiones guardadas', true, cuantas + ' en total · ' + estado.guardadas + ' en esta visita');
    t('openModal interceptada', typeof window.openModal === 'function', '');
    var cat = catalogo() || [];
    t('Catálogo de drills', cat.length > 0, cat.length + ' drills disponibles');
    t('Componente en foco', true, estado.componenteFoco || 'sin diagnóstico previo');
    t('Sin errores', !estado.ultimoError, estado.ultimoError || 'ninguno');

    console.log('%c MGL TRAINING — AUTOTEST ', 'background:#2dd4bf;color:#0a0a0a;font-weight:bold');
    console.table(r);
    var mal = r.filter(function (x) { return x.resultado === 'REVISAR'; });
    if (!mal.length) console.log('%c Todo correcto. ', 'background:#22c55e;color:#04210e');
    else console.warn('Revisar: ' + mal.map(function (x) { return x.prueba; }).join(', '));
    return r;
  };

  window.MGL_TRAINING = estado;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalar);
  } else {
    instalar();
  }
})();
