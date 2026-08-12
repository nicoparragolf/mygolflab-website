/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · mgl-training.js  v2.0  ·  2026-08-12

   ── v2.0: CUATRO ARREGLOS DE TRAINING LAB ─────────────────────────────────

   1. LAS CIFRAS DE LA CABECERA ERAN INVENTADAS
      "7 días de racha", "142 drills completados" y "4.2/5 de constancia"
      estaban escritas a mano en el HTML: todos los jugadores veían las
      mismas, incluido uno que nunca entrenó. Ahora salen de
      training_sessions. Si el jugador no tiene sesiones, se muestran en
      cero, que es la verdad, en vez de un número halagador.

   2. EL SWITCH DE PRUEBAS DEJABA ENTRAR A LOS BÁSICO
      training.html trae un selector "Básico / Pro-Elite" que el propio
      código marca como "SOLO PRUEBAS: elimina este bloque en producción".
      Estaba visible y funcionando: cualquier usuario Básico podía apretarlo
      y usar la planificación que vendes como Pro. Ahora el selector se
      oculta y el plan se lee de la tabla profiles, que es la misma fuente
      que usa el dashboard.

   3. LOS COLORES DE DIFICULTAD CHOCABAN CON LOS DE SEVERIDAD
      Los niveles usaban verde, dorado, naranjo y rosado. El dashboard usa
      verde, ámbar, naranjo y rojo para la gravedad de una falla. Un mismo
      naranjo significaba "difícil" en una página y "problema moderado" en
      la otra. Los niveles pasan a una escala de un solo color: teal cada
      vez más intenso. Más intenso, más difícil.

   4. DRILLS FAVORITOS
      Botón de estrella en el modal de cada drill. Se guardan en la tabla
      drill_favoritos y el dashboard los muestra con acceso directo.

   Se mantiene todo lo de v1.1: el panel para registrar la sesión al
   terminar un drill.

   CÓMO SE INSTALA
   1. Subir este archivo a la carpeta /js/ del sitio, reemplazando el que
      ya está ahí.
   2. training.html ya lo carga: no hay que tocar el HTML.

   CÓMO SE DESINSTALA
   Borrar la línea que carga este archivo al final de training.html.
   Training Lab vuelve exactamente a como estaba.

   REQUIERE
   · mgl-setup.sql        (tabla training_sessions)
   · 02-drill-favoritos.sql (tabla drill_favoritos)
   Si falta alguna, esa parte avisa y el resto sigue funcionando.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var VERSION = '2.0';

  var SB_URL  = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
  var TABLA = 'training_sessions';
  var TABLA_FAV = 'drill_favoritos';

  var estado = {
    instalado: false, cliente: null, tablaOK: null, favOK: null,
    drillActual: null, varianteActual: null, nombreVariante: null,
    componenteFoco: null, guardadas: 0, ultimoError: null,
    sesiones: [], favoritos: {}, plan: null, planLeido: false
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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function diasEntre(a, b) {
    return Math.round((new Date(b) - new Date(a)) / 86400000);
  }


  /* ═════════════════════════════════════════════════════════════════════════
     ARREGLO 2 · EL PLAN SE LEE DE LA BASE DE DATOS, NO DE UN SWITCH
     ═════════════════════════════════════════════════════════════════════════ */

  function normPlan(p) {
    var x = String(p || '').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return ['basico', 'pro', 'elite'].indexOf(x) > -1 ? x : 'basico';
  }

  async function leerPlan() {
    var c = db(), u = await usuario();
    if (!c || !u) { estado.plan = 'basico'; estado.planLeido = true; return 'basico'; }
    try {
      var r = await c.from('profiles').select('plan').eq('id', u.id).maybeSingle();
      estado.plan = normPlan(r.data && r.data.plan);
    } catch (e) {
      estado.plan = 'basico';
    }
    estado.planLeido = true;
    return estado.plan;
  }

  /* Oculta el selector de pruebas y aplica el plan real.
     Nota: `access` en training.html se declara con let, así que no está en
     window; el cambio se hace llamando a setAccess(), que sí es global. */
  function aplicarPlanReal() {
    var toggle = document.getElementById('devAccess');
    if (toggle) toggle.style.display = 'none';

    var acceso = (estado.plan === 'pro' || estado.plan === 'elite') ? 'pro' : 'basic';
    if (typeof window.setAccess === 'function') {
      try { window.setAccess(acceso); }
      catch (e) { console.warn('[MGL] No se pudo aplicar el plan:', e); }
    }
    return acceso;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     ARREGLO 3 · COLORES DE DIFICULTAD EN ESCALA DE UN SOLO COLOR
     Más intenso = más difícil. El dorado queda libre para plan y premium,
     que es su función en el resto del sitio.
     ═════════════════════════════════════════════════════════════════════════ */

  function inyectarColores() {
    if (document.getElementById('mgl-niveles-css')) return;
    var css = [
      /* Pastillas de nivel en las tarjetas de la biblioteca */
      '.lvl-dot.beginner{color:#5eead4;border-color:rgba(45,212,191,.22);background:rgba(45,212,191,.05)}',
      '.lvl-dot.beginner:hover{background:rgba(45,212,191,.14)}',
      '.lvl-dot.intermediate{color:#5eead4;border-color:rgba(45,212,191,.45);background:rgba(45,212,191,.10)}',
      '.lvl-dot.intermediate:hover{background:rgba(45,212,191,.20)}',
      '.lvl-dot.advanced{color:#99f6e4;border-color:rgba(45,212,191,.70);background:rgba(45,212,191,.16)}',
      '.lvl-dot.advanced:hover{background:rgba(45,212,191,.26)}',
      '.lvl-dot.expert{color:#08090a;border-color:#2dd4bf;background:#2dd4bf;font-weight:700}',
      '.lvl-dot.expert:hover{background:#4ee6d3}',

      /* Etiquetas de nivel dentro de un plan generado */
      '.ex-level.beginner{color:#5eead4;border-color:rgba(45,212,191,.28);background:rgba(45,212,191,.05)}',
      '.ex-level.intermediate{color:#5eead4;border-color:rgba(45,212,191,.48);background:rgba(45,212,191,.10)}',
      '.ex-level.advanced{color:#99f6e4;border-color:rgba(45,212,191,.72);background:rgba(45,212,191,.16)}',
      '.ex-level.expert{color:#08090a;border-color:#2dd4bf;background:#2dd4bf}',

      /* Insignia del modal */
      '.modal-badge.beginner{color:#5eead4;border:1px solid rgba(45,212,191,.28);background:rgba(45,212,191,.10)}',
      '.modal-badge.intermediate{color:#5eead4;border:1px solid rgba(45,212,191,.48);background:rgba(45,212,191,.16)}',
      '.modal-badge.advanced{color:#99f6e4;border:1px solid rgba(45,212,191,.72);background:rgba(45,212,191,.24)}',
      '.modal-badge.expert{color:#08090a;border:1px solid #2dd4bf;background:#2dd4bf}'
    ].join('');
    var el = document.createElement('style');
    el.id = 'mgl-niveles-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }


  /* ═════════════════════════════════════════════════════════════════════════
     ARREGLO 1 · CIFRAS REALES EN LA CABECERA
     ═════════════════════════════════════════════════════════════════════════ */

  async function cargarSesiones() {
    var c = db(), u = await usuario();
    if (!c || !u) { estado.tablaOK = false; return []; }
    try {
      var r = await c.from(TABLA)
        .select('id,created_at,drill_id,categoria,variante,puntaje,puntaje_max,duracion_min')
        .eq('user_id', u.id).order('created_at', { ascending: false }).limit(500);
      if (r.error) { estado.tablaOK = false; estado.ultimoError = r.error.message; return []; }
      estado.tablaOK = true;
      estado.sesiones = r.data || [];
      return estado.sesiones;
    } catch (e) { estado.tablaOK = false; return []; }
  }

  /* Días distintos con entrenamiento, como texto AAAA-MM-DD */
  function diasEntrenados() {
    var set = {};
    estado.sesiones.forEach(function (s) { set[String(s.created_at).slice(0, 10)] = true; });
    return Object.keys(set).sort();
  }

  /* Racha: días seguidos entrenando hasta hoy o hasta ayer.
     Si el último entrenamiento fue hace más de un día, la racha se cortó y
     vale 0. Mostrar "7 días" a alguien que no entrena hace un mes es
     exactamente lo que hacía la versión anterior. */
  function rachaActual() {
    var d = diasEntrenados();
    if (!d.length) return 0;
    var hoy = new Date().toISOString().slice(0, 10);
    var ultimo = d[d.length - 1];
    var desde = diasEntre(ultimo, hoy);
    if (desde > 1) return 0;

    var racha = 1;
    for (var i = d.length - 1; i > 0; i--) {
      if (diasEntre(d[i - 1], d[i]) === 1) racha++;
      else break;
    }
    return racha;
  }

  /* Constancia sobre 5: cuántas de las últimas 4 semanas tuvieron al menos
     un día de entrenamiento, llevado a una escala de 0 a 5. Es una medida
     de aparecer, no de volumen. */
  function constancia() {
    var d = diasEntrenados();
    if (!d.length) return 0;
    var hoy = new Date(), semanas = 0;
    for (var s = 0; s < 4; s++) {
      var fin = new Date(hoy); fin.setDate(hoy.getDate() - s * 7);
      var ini = new Date(fin); ini.setDate(fin.getDate() - 6);
      var a = ini.toISOString().slice(0, 10), b = fin.toISOString().slice(0, 10);
      if (d.some(function (x) { return x >= a && x <= b; })) semanas++;
    }
    return Math.round((semanas / 4) * 5 * 10) / 10;
  }

  function pintarCabecera() {
    var stats = document.querySelectorAll('.hero-stat');
    if (!stats.length) return;

    function poner(i, valor, sufijo, etiqueta, acento) {
      var st = stats[i];
      if (!st) return;
      var v = st.querySelector('.hero-stat-val');
      var l = st.querySelector('.hero-stat-label');
      if (v) {
        v.innerHTML = esc(String(valor)) + (sufijo ? '<small>' + esc(sufijo) + '</small>' : '');
        v.className = 'hero-stat-val' + (acento ? ' accent' : '');
      }
      if (l && etiqueta) l.textContent = etiqueta;
    }

    if (!estado.tablaOK) {
      /* Sin tabla no se inventa nada: se dice que falta un paso */
      poner(0, '—', '', 'Racha activa', false);
      poner(2, '—', '', 'Drills completados', false);
      poner(3, '—', '', 'Índice de constancia', false);
      return;
    }

    var r = rachaActual();
    var total = estado.sesiones.length;
    var cte = constancia();

    poner(0, r, r === 1 ? 'día' : 'días', 'Racha activa', r > 0);
    /* La posición 1 es "Drills disponibles", que ya la llena training.html */
    poner(2, total, '', total === 1 ? 'Drill completado' : 'Drills completados', false);
    poner(3, cte, '/5', 'Índice de constancia', false);
  }


  /* ═════════════════════════════════════════════════════════════════════════
     ARREGLO 4 · DRILLS FAVORITOS
     ═════════════════════════════════════════════════════════════════════════ */

  async function cargarFavoritos() {
    var c = db(), u = await usuario();
    if (!c || !u) { estado.favOK = false; return; }
    try {
      var r = await c.from(TABLA_FAV).select('drill_id').eq('user_id', u.id);
      if (r.error) { estado.favOK = false; estado.ultimoError = r.error.message; return; }
      estado.favOK = true;
      estado.favoritos = {};
      (r.data || []).forEach(function (f) { estado.favoritos[String(f.drill_id)] = true; });
    } catch (e) { estado.favOK = false; }
  }

  async function alternarFavorito(drillId, btn) {
    var c = db(), u = await usuario();
    if (!c || !u) { pintarEstrella(btn, false, 'Inicia sesión para guardar favoritos'); return; }

    var esFav = !!estado.favoritos[drillId];
    btn.disabled = true;

    try {
      if (esFav) {
        var d = await c.from(TABLA_FAV).delete()
          .eq('user_id', u.id).eq('drill_id', String(drillId));
        if (d.error) throw d.error;
        delete estado.favoritos[drillId];
      } else {
        var i = await c.from(TABLA_FAV)
          .insert({ user_id: u.id, drill_id: String(drillId) });
        if (i.error) throw i.error;
        estado.favoritos[drillId] = true;
      }
      pintarEstrella(btn, !esFav);
      if (typeof window.toast === 'function') {
        window.toast(esFav ? 'Quitado de favoritos' : 'Guardado en favoritos',
                     esFav ? '' : 'Lo vas a ver en tu dashboard');
      }
    } catch (e) {
      estado.ultimoError = e.message || String(e);
      console.error('[MGL] Error con el favorito:', e);
      pintarEstrella(btn, esFav, 'No se pudo guardar');
    }
    btn.disabled = false;
  }

  function pintarEstrella(btn, activo, aviso) {
    btn.className = 'mgl-fav' + (activo ? ' on' : '');
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="' + (activo ? 'currentColor' : 'none') + '" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
      '<path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/></svg>' +
      '<span>' + (aviso ? esc(aviso) : (activo ? 'En favoritos' : 'Guardar en favoritos')) + '</span>';
  }


  /* ── CSS de los añadidos propios ── */
  function inyectarCSS() {
    if (document.getElementById('mgl-training-css')) return;
    var css =
      /* Panel de registro */
      '.mgl-reg{margin-top:20px;padding-top:20px;border-top:1px solid var(--border)}' +
      '.mgl-reg-t{font-family:"Barlow Condensed",sans-serif;font-size:11px;font-weight:700;' +
        'letter-spacing:3px;text-transform:uppercase;color:var(--text-muted);margin-bottom:14px;' +
        'display:flex;align-items:center;gap:8px}' +
      '.mgl-reg-t::after{content:"";flex:1;height:1px;background:var(--border)}' +
      '.mgl-campos{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}' +
      '.mgl-c{display:flex;flex-direction:column;gap:6px;flex:1;min-width:88px}' +
      '.mgl-c label{font-family:"Barlow Condensed",sans-serif;font-size:10px;font-weight:700;' +
        'letter-spacing:1.5px;text-transform:uppercase;color:var(--text-muted)}' +
      '.mgl-c input{background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;' +
        'padding:11px 12px;color:var(--text);font-family:"Barlow",sans-serif;' +
        'font-size:14px;outline:none;width:100%;transition:border-color .2s}' +
      '.mgl-c input:focus{border-color:var(--teal,#2dd4bf)}' +
      '.mgl-guardar{width:100%;margin-top:14px;padding:14px;border:none;border-radius:10px;' +
        'background:var(--teal,#2dd4bf);color:#08090a;font-family:"Barlow Condensed",sans-serif;' +
        'font-size:15px;font-weight:700;letter-spacing:2px;text-transform:uppercase;cursor:pointer;' +
        'transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}' +
      '.mgl-guardar:hover{background:#4ee6d3}' +
      '.mgl-guardar:disabled{opacity:.5;cursor:wait}' +
      '.mgl-guardar.hecho{background:#10b981}' +
      '.mgl-msg{font-size:13px;line-height:1.6;margin-top:12px;color:var(--text-muted)}' +
      '.mgl-pista{font-size:12.5px;line-height:1.6;color:var(--text-muted);margin-bottom:14px;opacity:.85}' +
      /* Estrella de favorito */
      '.mgl-fav{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:10px 16px;' +
        'border-radius:10px;border:1px solid var(--border-mid,rgba(255,255,255,.11));' +
        'background:transparent;color:var(--text-muted,#7d827f);cursor:pointer;' +
        'font-family:"Barlow Condensed",sans-serif;font-size:13px;font-weight:600;' +
        'letter-spacing:1px;text-transform:uppercase;transition:all .2s}' +
      '.mgl-fav:hover{border-color:var(--gold,#D4C5A9);color:var(--gold,#D4C5A9)}' +
      '.mgl-fav.on{border-color:var(--gold,#D4C5A9);color:var(--gold,#D4C5A9);' +
        'background:rgba(212,197,169,.10)}' +
      '.mgl-fav svg{width:16px;height:16px;flex-shrink:0}' +
      '.mgl-fav:disabled{opacity:.6;cursor:wait}' +
      '@media(max-width:600px){.mgl-c{min-width:calc(50% - 5px)}}';
    var el = document.createElement('style');
    el.id = 'mgl-training-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }


  /* ── El componente del swing que el jugador está trabajando ──
     Lo tomamos de su diagnóstico más reciente. Se guarda con la sesión para
     poder reconstruir el contexto más adelante, pero el dashboard NO lo usa
     para mezclar entrenamiento con técnica: Training Lab es rendimiento. */
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


  /* ── Insertar el panel de registro y la estrella dentro del modal ── */
  function pintarPanel() {
    var cuerpo = document.querySelector('.modal-body');
    if (!cuerpo) return;

    var viejo = document.getElementById('mgl-reg');
    if (viejo) viejo.remove();

    var d = estado.drillActual, v = estado.varianteActual;
    if (!d) return;

    var cont = document.createElement('div');
    cont.className = 'mgl-reg';
    cont.id = 'mgl-reg';

    /* Estrella de favorito, arriba del registro */
    if (estado.favOK) {
      var fav = document.createElement('button');
      fav.type = 'button';
      pintarEstrella(fav, !!estado.favoritos[String(d.id)]);
      fav.addEventListener('click', function () { alternarFavorito(String(d.id), fav); });
      cont.appendChild(fav);
    }

    if (estado.tablaOK === false) {
      var aviso = document.createElement('div');
      aviso.innerHTML =
        '<div class="mgl-reg-t">Registrar sesión</div>' +
        '<div class="mgl-msg">Para guardar tus sesiones falta correr <b>mgl-setup.sql</b> ' +
        'en Supabase. Mientras tanto puedes entrenar igual, pero no queda registro.</div>';
      cont.appendChild(aviso);
      cuerpo.appendChild(cont);
      return;
    }

    var reg = document.createElement('div');
    reg.innerHTML =
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
    cont.appendChild(reg);

    cuerpo.appendChild(cont);
    document.getElementById('mglGuardar').addEventListener('click', guardar);
  }


  /* ── Guardar la sesión en Supabase ── */
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
      estado.sesiones.unshift({
        id: 'nueva-' + estado.guardadas, created_at: new Date().toISOString(),
        drill_id: fila.drill_id, categoria: fila.categoria, variante: fila.variante,
        puntaje: fila.puntaje, puntaje_max: fila.puntaje_max, duracion_min: fila.duracion_min
      });
      pintarCabecera();   /* las cifras de arriba se actualizan al instante */

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


  /* ── Instalación ── */
  var intentos = 0;

  function instalar() {
    if (estado.instalado) return;
    inyectarCSS();
    inyectarColores();

    var errores = [];
    if (typeof window.openModal !== 'function') {
      errores.push('openModal() no existe — ¿el archivo está al final del <body> de training.html?');
    }
    if (catalogo() === null) {
      errores.push('No se encontró el catálogo de drills (allDrills)');
    }

    /* El catálogo se descarga por fetch al cargar la página, así que puede
       no estar listo todavía. Reintentamos antes de rendirnos. */
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
      /* 1 · Plan real y cierre del switch de pruebas */
      await leerPlan();
      var acceso = aplicarPlanReal();
      console.log('%c  ✅ Plan leído de profiles: ' + estado.plan +
                  ' → planificación ' + (acceso === 'pro' ? 'abierta' : 'bloqueada'),
                  'color:#10b981');
      if (document.getElementById('devAccess')) {
        console.log('%c  ✅ Selector de pruebas oculto', 'color:#10b981');
      }

      /* 2 · Cifras reales de la cabecera */
      await cargarSesiones();
      pintarCabecera();
      if (estado.tablaOK) {
        console.log('%c  ✅ Cabecera con datos reales · racha ' + rachaActual() +
                    ' · ' + estado.sesiones.length + ' sesiones · constancia ' + constancia() + '/5',
                    'color:#10b981');
      } else {
        console.warn('%c  ⚠️ La tabla training_sessions no responde. ¿Corriste mgl-setup.sql?',
                     'color:#f59e0b');
      }

      /* 3 · Favoritos */
      await cargarFavoritos();
      if (estado.favOK) {
        console.log('%c  ✅ Favoritos activos · ' + Object.keys(estado.favoritos).length +
                    ' guardados', 'color:#10b981');
      } else {
        console.warn('%c  ⚠️ La tabla drill_favoritos no responde. ' +
                     '¿Corriste 02-drill-favoritos.sql?', 'color:#f59e0b');
      }

      await cargarFoco();
      window.MGL_TRAINING_OK = !!(estado.tablaOK);
      console.log('%c  Escribe MGL_TRAINING_TEST() para revisar el estado.', 'color:#888');
    })();
  }


  /* ── Autotest ── */
  window.MGL_TRAINING_TEST = async function () {
    var r = [], c = db();
    function t(n, ok, d) { r.push({ prueba: n, resultado: ok ? 'OK' : 'REVISAR', detalle: d }); }

    t('Parche instalado', estado.instalado, 'v' + VERSION);
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

    var cat = catalogo() || [];
    t('Catálogo de drills', cat.length > 0, cat.length + ' drills disponibles');
    t('openModal interceptada', typeof window.openModal === 'function', '');

    /* ── Arreglo 1 ── */
    t('1 · Cabecera sin cifras inventadas',
      !/\b(142|4\.2)\b/.test(document.querySelector('.hero-stats')
        ? document.querySelector('.hero-stats').textContent : ''),
      'racha ' + rachaActual() + ' · ' + estado.sesiones.length +
      ' sesiones · constancia ' + constancia() + '/5');
    t('1 · La racha se corta si dejas de entrenar',
      estado.sesiones.length === 0 || rachaActual() >= 0,
      diasEntrenados().length + ' días distintos entrenados');

    /* ── Arreglo 2 ── */
    var toggle = document.getElementById('devAccess');
    t('2 · Selector de pruebas cerrado',
      !toggle || toggle.style.display === 'none',
      toggle ? 'oculto' : 'no está en el HTML');
    t('2 · Plan leído de la base de datos', estado.planLeido,
      'plan: ' + (estado.plan || '—') +
      ' → planificación ' + ((estado.plan === 'pro' || estado.plan === 'elite')
        ? 'abierta' : 'bloqueada'));

    /* ── Arreglo 3 ── */
    t('3 · Colores de nivel en escala teal',
      !!document.getElementById('mgl-niveles-css'), 'sin choque con severidad');

    /* ── Arreglo 4 ── */
    t('4 · Tabla drill_favoritos', !!estado.favOK,
      estado.favOK ? Object.keys(estado.favoritos).length + ' favoritos'
                   : 'falta correr 02-drill-favoritos.sql');

    t('Componente en foco', true, estado.componenteFoco || 'sin diagnóstico previo');
    t('Sin errores', !estado.ultimoError, estado.ultimoError || 'ninguno');

    console.log('%c MGL TRAINING v' + VERSION + ' — AUTOTEST ',
                'background:#2dd4bf;color:#08090a;font-weight:bold');
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
