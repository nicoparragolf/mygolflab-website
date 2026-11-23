/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Motor de swing (pose + fases + mediciones)
   Archivo: /js/mgl-swing-motor.js
   Versión: 1.0 · 2026-11-23

   ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
   Antes, coach-ai.html sacaba 6 imágenes a intervalos iguales de TODO el clip.
   En un video de 8 s con un swing de 1,3 s, solo 1 o 2 imágenes caían dentro
   del swing y el impacto casi nunca aparecía. Además el canvas era fijo de
   640×360, así que los videos verticales del iPhone llegaban aplastados.

   Este motor:
     1. Recorre el video COMPLETO con MediaPipe Pose (33 puntos del cuerpo por
        cuadro). Todo corre en el teléfono/computador del alumno: no sube el
        video a ningún servidor y no cuesta nada.
     2. Encuentra solo el swing dentro del clip y lo vuelve a recorrer fino
        (hasta 60 cuadros por segundo en la bajada).
     3. Detecta automáticamente 9 posiciones: P1 Setup, P2 Takeaway,
        P3 Mitad del backswing, P4 Top, P5 Transición, P6 Pre-impacto,
        P7 Impacto, P8 Release, P10 Finish.
     4. Recorta al jugador respetando la orientación real del video
        (vertical u horizontal) y saca esas 9 imágenes.
     5. Mide el swing con números (sway, early extension, tempo, etc.),
        las clasifica con los UMBRALES de abajo y le entrega todo a Claude
        como evidencia. Claude ya no adivina: interpreta mediciones.
     6. Detecta solo si el video es de frente o de línea de tiro.
     7. Calcula una huella (hash) del video: si el alumno sube el mismo
        archivo dos veces, se le muestra el mismo análisis.
     8. Agrega el token de sesión a todas las llamadas a /api/coach
        (el backend ahora exige sesión y plan Pro/Elite).

   ── ORDEN DE LOS FRAMES (importante) ───────────────────────────────────────
   window.extractedFrames queda en este orden "canónico":
       1 P1 Setup · 2 P2 Takeaway · 3 P4 Top · 4 P5 Transición · 5 P7 Impacto
       6 P10 Finish · 7 P3 Mitad backswing · 8 P6 Pre-impacto · 9 P8 Release
   Así los primeros 6 siguen calzando con las etiquetas que ya usan el
   dashboard y el logbook (Setup, Takeaway, Top, Transición, Impacto,
   Finish) y no hubo que tocar esas páginas. En pantalla y para Claude se
   muestran en orden cronológico.

   ── CÓMO SE INSTALA ─────────────────────────────────────────────────────────
   En coach-ai.html, al final del body, ANTES de mgl-fase-a.js:
       script src="/js/mgl-swing-motor.js"
   Si el detector no carga (sin internet, navegador muy antiguo) el motor
   cae solo al método básico, sin romper la página.

   ── CALIBRACIÓN ─────────────────────────────────────────────────────────────
   Los umbrales del bloque UMBRALES son iniciales. Se ajustan con los swings
   reales que Nico revise. Cambiar un número ahí cambia la clasificación en
   todos los análisis siguientes.
   Unidad "% torso": distancia expresada como porcentaje del largo del torso
   del propio jugador (hombros → caderas, ~45–55 cm en un adulto). Se usa
   porque funciona igual sin importar a qué distancia esté la cámara.

   En la consola: MGL_MOTOR.ultimo → último resultado completo
                  MGL_MOTOR.test() → autotest con un swing sintético

   Sin template literals (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  if (window.MGL_MOTOR) return;

  var VERSION = '1.0';

  /* ═════════════════════════════════════════════════════════════════════════
     CONFIGURACIÓN
     ═════════════════════════════════════════════════════════════════════════ */
  var TV_VER   = '1.2.3';
  var TV_URL   = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TV_VER + '/vision_bundle.mjs';
  var WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + TV_VER + '/wasm';
  var MODELOS  = [
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'
  ];

  var LADO_MAX_IMG   = 768;   // px del lado largo de cada imagen para Claude
  var CALIDAD_JPEG   = 0.82;
  var PASO_GRUESO    = 1 / 15; // primera pasada: 15 cuadros por segundo
  var MAX_GRUESO     = 160;    // tope de muestras en la primera pasada
  var PASO_FINO      = 1 / 60; // bajada e impacto
  var PASO_MEDIO     = 1 / 30; // backswing y follow-through
  var VEL_MIN_SWING  = 3;      // torsos por segundo: menos que esto no es un swing

  /* ── UMBRALES ──────────────────────────────────────────────────────────────
     Cada métrica tiene tres rangos anidados: ok ⊂ leve ⊂ moderado.
     Fuera de "moderado" es "severo". -99 / 99 = sin límite por ese lado. */
  var UMBRALES = {
    /* De frente (face-on) */
    sway_top:            { ok: [-99, 12], leve: [-99, 20], moderado: [-99, 30] },   // % torso hacia atrás
    pelvis_impacto:      { ok: [8, 40],   leve: [3, 48],   moderado: [-3, 58] },    // % torso hacia el target
    cabeza_top:          { ok: [-99, 6],  leve: [-99, 10], moderado: [-99, 16] },   // % torso hacia el target
    inclinacion_top:     { ok: [-99, 2],  leve: [-99, 6],  moderado: [-99, 12] },   // ° hacia el target
    inclinacion_impacto: { ok: [-40, -12], leve: [-46, -7], moderado: [-52, -2] },  // ° (negativo = lejos del target)
    manos_impacto:       { ok: [4, 40],   leve: [-2, 48],  moderado: [-10, 60] },   // % torso hacia el target
    cadera_lidera_ms:    { ok: [-400, 60], leve: [-400, 110], moderado: [-400, 170] }, // ms respecto del top
    /* Línea de tiro (down-the-line) */
    early_extension:     { ok: [-99, 5],  leve: [-99, 9],  moderado: [-99, 15] },   // % torso hacia la bola
    perdida_columna:     { ok: [-99, 5],  leve: [-99, 9],  moderado: [-99, 14] },   // ° perdidos
    manos_afuera_bajada: { ok: [-99, 4],  leve: [-99, 10], moderado: [-99, 18] },   // % torso hacia afuera
    /* Ambas vistas */
    cabeza_vertical:     { ok: [-6, 6],   leve: [-10, 10], moderado: [-16, 16] },   // % torso (+ = sube)
    tempo:               { ok: [2.5, 3.6], leve: [2.1, 4.2], moderado: [1.7, 5.0] } // backswing : bajada
  };

  var PILAR = { cara: 'WC', path: 'KS', lowpoint: 'BT', secuencia: 'KS',
                postura: 'BT', ground: 'GF', conexion: 'KS', distancia: 'WC' };

  /* Definición de cada métrica: qué componente evalúa y cómo se lee */
  var DEF = {
    sway_top: {
      nombre: 'Sway en el backswing', componente: 'ground', unidad: 'pct', confianza: 'alta',
      alto: 'la pelvis se desplaza hacia atrás en vez de rotar (sway)'
    },
    pelvis_impacto: {
      nombre: 'Pelvis hacia el target al impacto', componente: 'ground', unidad: 'pct', confianza: 'alta',
      bajo: 'la pelvis no llega adelante al impacto (hanging back)',
      alto: 'la pelvis se desliza de más hacia el target (slide)'
    },
    cabeza_top: {
      nombre: 'Cabeza hacia el target en el top', componente: 'postura', unidad: 'pct', confianza: 'alta',
      alto: 'la cabeza se va hacia el target en el backswing (patrón de reverse pivot)'
    },
    inclinacion_top: {
      nombre: 'Inclinación de columna en el top', componente: 'postura', unidad: 'grados', confianza: 'media',
      alto: 'el torso se inclina hacia el target en el top (reverse spine)'
    },
    inclinacion_impacto: {
      nombre: 'Side bend al impacto', componente: 'lowpoint', unidad: 'grados', confianza: 'media',
      bajo: 'el torso se inclina de más hacia atrás al impacto (hanging back, low point atrás)',
      alto: 'falta inclinación lateral al impacto: el torso queda vertical o hacia el target'
    },
    manos_impacto: {
      nombre: 'Manos adelante al impacto (shaft lean aprox.)', componente: 'cara', unidad: 'pct', confianza: 'media',
      bajo: 'las manos llegan atrasadas al impacto (posible flip / pérdida de shaft lean)',
      alto: 'las manos llegan muy adelantadas al impacto'
    },
    cadera_lidera_ms: {
      nombre: 'Inicio de la bajada: pelvis respecto del top', componente: 'secuencia', unidad: 'ms', confianza: 'media',
      alto: 'la pelvis empieza a moverse al target tarde: la bajada la inician brazos/torso'
    },
    early_extension: {
      nombre: 'Early extension (pelvis hacia la bola)', componente: 'postura', unidad: 'pct', confianza: 'alta',
      alto: 'la pelvis se acerca a la bola en la bajada (early extension)'
    },
    perdida_columna: {
      nombre: 'Pérdida del ángulo de columna al impacto', componente: 'postura', unidad: 'grados', confianza: 'alta',
      alto: 'el jugador se levanta: pierde la inclinación hacia adelante (standing up)'
    },
    manos_afuera_bajada: {
      nombre: 'Manos hacia afuera al inicio de la bajada', componente: 'path', unidad: 'pct', confianza: 'media',
      alto: 'las manos salen hacia la bola al bajar (patrón over-the-top)'
    },
    cabeza_vertical: {
      nombre: 'Movimiento vertical de la cabeza al impacto', componente: 'postura', unidad: 'pct', confianza: 'alta',
      bajo: 'la cabeza baja al impacto (dip)',
      alto: 'la cabeza sube al impacto (se levanta)'
    },
    tempo: {
      nombre: 'Tempo backswing : bajada', componente: 'secuencia', unidad: 'ratio', confianza: 'media',
      bajo: 'backswing apurado respecto de la bajada',
      alto: 'backswing muy lento o bajada sin aceleración'
    }
  };

  /* Fases. "orden" es la posición canónica en extractedFrames (ver cabecera) */
  var FASES = [
    { id: 'P1',  etiqueta: 'P1 Setup/Address',          orden: 0 },
    { id: 'P2',  etiqueta: 'P2 Takeaway',               orden: 1 },
    { id: 'P3',  etiqueta: 'P3 Mitad del backswing',    orden: 6 },
    { id: 'P4',  etiqueta: 'P4 Top del backswing',      orden: 2 },
    { id: 'P5',  etiqueta: 'P5 Transición/Bajada',      orden: 3 },
    { id: 'P6',  etiqueta: 'P6 Pre-impacto',            orden: 7 },
    { id: 'P7',  etiqueta: 'P7 Impacto',                orden: 4 },
    { id: 'P8',  etiqueta: 'P8 Release',                orden: 8 },
    { id: 'P10', etiqueta: 'P10 Finish',                orden: 5 }
  ];

  var NIVELES = ['ok', 'leve', 'moderado', 'severo'];
  var NIVEL_TXT = { ok: 'ok', leve: 'leve', moderado: 'moderado', severo: 'severo', no_evaluable: 'no evaluable' };


  /* ═════════════════════════════════════════════════════════════════════════
     UTILIDADES GEOMÉTRICAS
     ═════════════════════════════════════════════════════════════════════════ */
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
  function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
  function deg(r) { return r * 180 / Math.PI; }
  function sign(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function mediana(arr) {
    var a = arr.filter(function (x) { return isFinite(x); }).slice().sort(function (p, q) { return p - q; });
    if (!a.length) return NaN;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     SERIE TEMPORAL A PARTIR DE LAS MUESTRAS DE POSE
     muestras: [{ t: segundos, lm: [33 × {x,y,v}] en PÍXELES | null }]
     ═════════════════════════════════════════════════════════════════════════ */
  var VIS_IDX = [0, 11, 12, 15, 16, 23, 24];

  function derivar(lm) {
    var v = 0;
    VIS_IDX.forEach(function (k) { v += (lm[k].v == null ? 1 : lm[k].v); });
    return {
      H:  mid(lm[15], lm[16]),           // manos
      HP: mid(lm[23], lm[24]),           // pelvis
      SH: mid(lm[11], lm[12]),           // hombros
      HD: { x: lm[0].x, y: lm[0].y },    // cabeza (nariz)
      SW: dist(lm[11], lm[12]),          // ancho aparente de hombros
      TT: dist(mid(lm[11], lm[12]), mid(lm[23], lm[24])), // largo de torso
      V:  v / VIS_IDX.length
    };
  }

  var PUNTOS = ['H', 'HP', 'SH', 'HD'];
  var ESCALARES = ['SW', 'TT', 'V'];

  function construirSerie(muestras) {
    var t = [], d = [], lm = [], det = [];
    muestras.forEach(function (m) {
      t.push(m.t); lm.push(m.lm || null);
      d.push(m.lm ? derivar(m.lm) : null);
      det.push(!!m.lm);
    });
    var n = t.length;
    var detectados = det.filter(Boolean).length;
    if (detectados < 4) return null;

    /* Rellenar huecos por interpolación lineal en el tiempo */
    for (var i = 0; i < n; i++) {
      if (d[i]) continue;
      var a = i - 1; while (a >= 0 && !det[a]) a--;
      var b = i + 1; while (b < n && !det[b]) b++;
      if (a < 0 && b >= n) return null;
      if (a < 0) { d[i] = d[b]; continue; }
      if (b >= n) { d[i] = d[a]; continue; }
      var f = (t[i] - t[a]) / ((t[b] - t[a]) || 1);
      var o = {};
      PUNTOS.forEach(function (k) {
        o[k] = { x: d[a][k].x + (d[b][k].x - d[a][k].x) * f, y: d[a][k].y + (d[b][k].y - d[a][k].y) * f };
      });
      ESCALARES.forEach(function (k) { o[k] = d[a][k] + (d[b][k] - d[a][k]) * f; });
      o.V = 0; // los rellenados no cuentan como visibles
      d[i] = o;
    }

    /* Suavizado centrado de 3 muestras (quita el temblor del detector) */
    var S = { t: t, lm: lm, det: det, n: n };
    PUNTOS.forEach(function (k) {
      S[k] = d.map(function (_, j) {
        var x = 0, y = 0, c = 0;
        for (var q = Math.max(0, j - 1); q <= Math.min(n - 1, j + 1); q++) { x += d[q][k].x; y += d[q][k].y; c++; }
        return { x: x / c, y: y / c };
      });
    });
    ESCALARES.forEach(function (k) {
      S[k] = d.map(function (_, j) {
        if (k === 'V') return d[j].V;
        var s = 0, c = 0;
        for (var q = Math.max(0, j - 1); q <= Math.min(n - 1, j + 1); q++) { s += d[q][k]; c++; }
        return s / c;
      });
    });
    S.escala = mediana(S.TT);
    S.tasaDeteccion = detectados / n;
    return S;
  }

  function velocidades(S) {
    var v = [];
    for (var i = 0; i < S.n; i++) {
      var a = Math.max(0, i - 1), b = Math.min(S.n - 1, i + 1);
      var dt = S.t[b] - S.t[a];
      v.push(dt > 0 ? dist(S.H[a], S.H[b]) / dt / S.escala : 0);
    }
    return v;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     DETECCIÓN DE FASES
     Usa la trayectoria de las manos (punto medio de las muñecas):
       · Pico de velocidad    → la bajada
       · Manos más altas antes del pico → Top (P4)
       · Último momento quieto antes del backswing → Setup (P1)
       · Manos de vuelta más cerca de su posición de setup → Impacto (P7)
       · Primer momento quieto después del impacto → Finish (P10)
     El resto de las posiciones sale por fracción del arco recorrido.
     ═════════════════════════════════════════════════════════════════════════ */
  function detectarFases(S) {
    if (!S || S.n < 8 || !(S.escala > 0)) return null;
    var v = velocidades(S);
    var iPeak = 0;
    for (var i = 1; i < S.n; i++) if (v[i] > v[iPeak]) iPeak = i;
    var vMax = v[iPeak];
    if (!(vMax >= VEL_MIN_SWING)) return null;
    var tPeak = S.t[iPeak];

    /* Top: manos más altas (y mínima) en los 1,8 s antes del pico */
    var iTop = -1, yMin = Infinity;
    for (i = 0; i <= iPeak; i++) {
      if (S.t[i] >= tPeak - 1.8 && S.H[i].y < yMin) { yMin = S.H[i].y; iTop = i; }
    }
    if (iTop < 1 || iTop >= iPeak) return null;

    /* Pico de velocidad del backswing (para caminar hacia atrás desde ahí) */
    var iBack = -1, vb = 0;
    for (i = 0; i < iTop; i++) {
      if (S.t[i] >= S.t[iTop] - 1.6 && v[i] > vb) { vb = v[i]; iBack = i; }
    }
    if (iBack < 0 || vb < 0.08 * vMax) return null;

    var quieto = Math.max(0.10 * vMax, 0.6);
    var iA = iBack;
    while (iA > 0 && v[iA] >= quieto) iA--;
    /* Afinar el inicio del takeaway por desplazamiento (más preciso que la
       velocidad, que tarda en subir porque el takeaway parte lento) */
    var iQ = iA;
    for (i = iA; i >= 0 && S.t[i] >= S.t[iA] - 0.5; i--) if (v[i] < v[iQ]) iQ = i;
    iA = iQ;
    for (i = iQ; i < iTop; i++) {
      if (dist(S.H[i], S.H[iQ]) > 0.02 * S.escala) break;
      iA = i;
    }

    /* Debe haber un backswing de verdad: manos suben al menos medio torso */
    if ((S.H[iA].y - S.H[iTop].y) < 0.5 * S.escala) return null;

    /* Impacto: manos de vuelta lo más cerca de su posición de setup */
    var Ha = S.H[iA], iImp = -1, dmin = Infinity;
    for (i = iTop + 1; i < S.n; i++) {
      if (S.t[i] > S.t[iTop] + 0.75 || S.t[i] > tPeak + 0.25) break;
      var dd = dist(S.H[i], Ha);
      if (dd < dmin) { dmin = dd; iImp = i; }
    }
    if (iImp < 0) return null;

    /* Finish */
    var iFin = S.n - 1;
    for (i = iImp + 1; i < S.n; i++) {
      var dtI = S.t[i] - S.t[iImp];
      if (dtI > 1.4) { iFin = i; break; }
      if (dtI >= 0.45 && v[i] < quieto && (i + 1 >= S.n || v[i + 1] < quieto)) { iFin = i; break; }
    }
    if (iFin <= iImp) iFin = Math.min(S.n - 1, iImp + 1);

    var idx = {
      P1: iA,
      P2: porArco(S, iA, iTop, 0.22),
      P3: porArco(S, iA, iTop, 0.60),
      P4: iTop,
      P5: porArco(S, iTop, iImp, 0.40),
      P6: porArco(S, iTop, iImp, 0.80),
      P7: iImp,
      P8: porArco(S, iImp, iFin, 0.30),
      P10: iFin
    };
    return { idx: idx, vMax: vMax, iPeak: iPeak };
  }

  function porArco(S, i0, i1, frac) {
    if (i1 <= i0) return i0;
    var tot = 0, k;
    for (k = i0 + 1; k <= i1; k++) tot += dist(S.H[k - 1], S.H[k]);
    if (!(tot > 0)) return i0;
    var acc = 0;
    for (k = i0 + 1; k <= i1; k++) {
      acc += dist(S.H[k - 1], S.H[k]);
      if (acc >= frac * tot) return k;
    }
    return i1;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     VISTA (de frente / línea de tiro) Y DIRECCIONES
     ═════════════════════════════════════════════════════════════════════════ */
  function detectarVista(S, F) {
    var i0 = F.idx.P1, vals = [];
    for (var i = Math.max(0, i0 - 3); i <= Math.min(S.n - 1, i0 + 3); i++) vals.push(S.SW[i] / S.TT[i]);
    var ratio = mediana(vals);
    var vista = null, confianza = 'baja';
    if (ratio >= 0.55) { vista = 'face'; confianza = ratio >= 0.65 ? 'alta' : 'media'; }
    else if (ratio <= 0.42) { vista = 'dtl'; confianza = ratio <= 0.32 ? 'alta' : 'media'; }
    return { vista: vista, confianza: confianza, ratio: r1(ratio * 100) / 100 };
  }

  /* Face-on: +1 si el target está hacia la derecha de la imagen */
  function direccionTarget(S, F) {
    var a = F.idx.P1;
    var s = (S.H[F.idx.P10].x - S.H[a].x) - (S.H[F.idx.P4].x - S.H[a].x);
    return sign(s) || 1;
  }
  /* Down-the-line: +1 si la bola está hacia la derecha de la imagen */
  function direccionBola(S, F) {
    var a = F.idx.P1;
    return sign(S.H[a].x - S.HP[a].x) || 1;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     MEDICIONES
     ═════════════════════════════════════════════════════════════════════════ */
  function clasificar(valor, spec) {
    function dentro(r) { return valor >= r[0] && valor <= r[1]; }
    if (dentro(spec.ok)) return 'ok';
    if (dentro(spec.leve)) return 'leve';
    if (dentro(spec.moderado)) return 'moderado';
    return 'severo';
  }

  function textoUnidad(valor, unidad) {
    if (unidad === 'pct') return Math.round(valor) + '% del torso (≈' + Math.round(Math.abs(valor) * 0.5) + ' cm)';
    if (unidad === 'grados') return Math.round(valor) + '°';
    if (unidad === 'ms') return (valor > 0 ? '+' : '') + Math.round(valor) + ' ms';
    if (unidad === 'ratio') return (Math.round(valor * 10) / 10) + ':1';
    return String(valor);
  }
  function textoRango(spec, unidad) {
    var lo = spec.ok[0], hi = spec.ok[1];
    function f(v) {
      if (unidad === 'ratio') return (Math.round(v * 10) / 10) + ':1';
      if (unidad === 'grados') return v + '°';
      if (unidad === 'ms') return v + ' ms';
      return v + '%';
    }
    if (lo <= -99 || lo <= -400) return 'ideal ≤ ' + f(hi);
    if (hi >= 99) return 'ideal ≥ ' + f(lo);
    return 'ideal entre ' + f(lo) + ' y ' + f(hi);
  }

  function medir(S, F, vista) {
    var I = F.idx, E = S.escala;
    var out = [];
    function pct(v) { return v / E * 100; }
    function vis(indices) {
      var m = 1;
      indices.forEach(function (i) { m = Math.min(m, S.V[i]); });
      return m;
    }
    function agregar(id, valor, indices, fase) {
      var def = DEF[id], spec = UMBRALES[id];
      var visible = vis(indices);
      var nivel = (!isFinite(valor) || visible < 0.45) ? 'no_evaluable' : clasificar(valor, spec);
      var lado = null;
      if (nivel !== 'ok' && nivel !== 'no_evaluable') lado = valor < spec.ok[0] ? 'bajo' : 'alto';
      out.push({
        id: id,
        nombre: def.nombre,
        componente: def.componente,
        pilar: PILAR[def.componente],
        valor: isFinite(valor) ? r1(valor) : null,
        unidad: def.unidad,
        texto: isFinite(valor) ? textoUnidad(valor, def.unidad) : '—',
        nivel: nivel,
        lectura: lado ? (def[lado] || '') : '',
        referencia: textoRango(spec, def.unidad),
        confianza: visible < 0.6 ? 'baja' : def.confianza,
        fase: fase
      });
    }

    var tTempo = (S.t[I.P4] - S.t[I.P1]) / Math.max(0.001, S.t[I.P7] - S.t[I.P4]);

    if (vista === 'face') {
      var d = direccionTarget(S, F);
      agregar('sway_top', pct((S.HP[I.P4].x - S.HP[I.P1].x) * -d), [I.P1, I.P4], 'P4');
      agregar('pelvis_impacto', pct((S.HP[I.P7].x - S.HP[I.P1].x) * d), [I.P1, I.P7], 'P7');
      agregar('cabeza_top', pct((S.HD[I.P4].x - S.HD[I.P1].x) * d), [I.P1, I.P4], 'P4');
      agregar('inclinacion_top', inclinacionLateral(S, I.P4, d), [I.P4], 'P4');
      agregar('inclinacion_impacto', inclinacionLateral(S, I.P7, d), [I.P7], 'P7');
      agregar('manos_impacto', pct((S.H[I.P7].x - S.H[I.P1].x) * d), [I.P1, I.P7], 'P7');
      agregar('cadera_lidera_ms', caderaLidera(S, F, d), [I.P4, I.P7], 'P5');
    } else {
      var f = direccionBola(S, F);
      agregar('early_extension', pct((S.HP[I.P7].x - S.HP[I.P1].x) * f), [I.P1, I.P7], 'P7');
      agregar('perdida_columna', flexion(S, I.P1, f) - flexion(S, I.P7, f), [I.P1, I.P7], 'P7');
      agregar('manos_afuera_bajada',
        pct(((S.H[I.P5].x - S.HP[I.P5].x) - (S.H[I.P3].x - S.HP[I.P3].x)) * f),
        [I.P3, I.P5], 'P5');
    }
    agregar('cabeza_vertical', pct(S.HD[I.P1].y - S.HD[I.P7].y), [I.P1, I.P7], 'P7');
    agregar('tempo', tTempo, [I.P1, I.P4, I.P7], 'P4');
    return out;
  }

  /* Inclinación lateral del torso (face-on). + = hacia el target */
  function inclinacionLateral(S, i, d) {
    return deg(Math.atan2((S.SH[i].x - S.HP[i].x) * d, S.HP[i].y - S.SH[i].y));
  }
  /* Flexión hacia adelante del torso (down-the-line). + = hacia la bola */
  function flexion(S, i, f) {
    return deg(Math.atan2((S.SH[i].x - S.HP[i].x) * f, S.HP[i].y - S.SH[i].y));
  }
  /* Cuándo la pelvis empieza a ir al target, respecto del top (ms) */
  function caderaLidera(S, F, d) {
    var I = F.idx, iMin = I.P1, k;
    for (k = I.P1; k <= I.P7; k++) if (S.HP[k].x * d < S.HP[iMin].x * d) iMin = k;
    for (k = iMin + 1; k <= I.P7; k++) {
      if ((S.HP[k].x - S.HP[iMin].x) * d >= 0.03 * S.escala) return (S.t[k] - S.t[I.P4]) * 1000;
    }
    return NaN;
  }

  function componentesMedidos(metricas) {
    var res = {};
    metricas.forEach(function (m) {
      if (m.nivel === 'no_evaluable') return;
      var prev = res[m.componente];
      if (!prev || NIVELES.indexOf(m.nivel) > NIVELES.indexOf(prev)) res[m.componente] = m.nivel;
    });
    return res;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     MEDIAPIPE
     ═════════════════════════════════════════════════════════════════════════ */
  var _pose = null;
  function cargarPose() {
    if (_pose) return _pose;
    _pose = (async function () {
      var mod = await import(TV_URL);
      var files = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      var ultimo = null;
      for (var m = 0; m < MODELOS.length; m++) {
        var delegados = ['GPU', 'CPU'];
        for (var g = 0; g < delegados.length; g++) {
          try {
            var lm = await mod.PoseLandmarker.createFromOptions(files, {
              baseOptions: { modelAssetPath: MODELOS[m], delegate: delegados[g] },
              runningMode: 'IMAGE',
              numPoses: 1,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5
            });
            console.log('[MGL motor] Detector listo · ' + MODELOS[m].split('/').pop() + ' · ' + delegados[g]);
            return lm;
          } catch (e) { ultimo = e; }
        }
      }
      throw ultimo || new Error('No se pudo cargar el detector de pose');
    })();
    _pose.catch(function () { _pose = null; });
    return _pose;
  }

  function buscar(video, t) {
    return new Promise(function (resolve) {
      if (Math.abs(video.currentTime - t) < 0.0005 && video.readyState >= 2) return resolve(true);
      var listo = false;
      function fin(ok) { if (listo) return; listo = true; video.removeEventListener('seeked', alBuscar); resolve(ok); }
      function alBuscar() { fin(true); }
      video.addEventListener('seeked', alBuscar);
      setTimeout(function () { fin(false); }, 3000);
      try { video.currentTime = t; } catch (e) { fin(false); }
    });
  }

  async function muestrear(video, pose, tiempos, alAvanzar) {
    var W = video.videoWidth, H = video.videoHeight, res = [];
    for (var i = 0; i < tiempos.length; i++) {
      var t = tiempos[i];
      var ok = await buscar(video, t);
      var lm = null;
      if (ok) {
        try {
          var r = pose.detect(video);
          if (r && r.landmarks && r.landmarks[0]) {
            lm = r.landmarks[0].map(function (p) {
              return { x: p.x * W, y: p.y * H, v: p.visibility == null ? 1 : p.visibility };
            });
          }
        } catch (e) { lm = null; }
      }
      res.push({ t: t, lm: lm });
      if (alAvanzar && (i % 4 === 0 || i === tiempos.length - 1)) alAvanzar((i + 1) / tiempos.length);
    }
    return res;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     ANÁLISIS COMPLETO DE UN VIDEO
     ═════════════════════════════════════════════════════════════════════════ */
  async function analizarVideo(video, alAvanzar) {
    var dur = video.duration;
    var W = video.videoWidth, H = video.videoHeight;
    if (!(dur > 0) || !W || !H) return { ok: false, motivo: 'video_ilegible' };
    try { video.pause(); } catch (e) {}

    var pose = await cargarPose();
    function avance(base, peso, msg) {
      return function (p) { if (alAvanzar) alAvanzar(base + p * peso, msg); };
    }

    /* 1 · Pasada gruesa sobre todo el clip */
    var paso = Math.max(PASO_GRUESO, dur / MAX_GRUESO), tiempos = [];
    for (var t = 0.02; t < dur - 0.02; t += paso) tiempos.push(r3(t));
    var gruesas = await muestrear(video, pose, tiempos, avance(0, 0.45, 'Buscando tu swing en el video'));
    var Sg = construirSerie(gruesas);
    if (!Sg) return { ok: false, motivo: 'sin_cuerpo' };
    var Fg = detectarFases(Sg);
    if (!Fg) return { ok: false, motivo: 'sin_swing', tasa: Sg.tasaDeteccion };

    /* 2 · Pasada fina solo sobre el swing */
    var tA = Sg.t[Fg.idx.P1], tTop = Sg.t[Fg.idx.P4], tImp = Sg.t[Fg.idx.P7], tFin = Sg.t[Fg.idx.P10];
    var ini = Math.max(0.01, tA - 0.3), fin = Math.min(dur - 0.01, tFin + 0.3);
    var zIni = Math.max(ini, tTop - 0.2), zFin = Math.min(fin, tImp + 0.25);
    var finos = {};
    for (t = ini; t <= fin; t += (t >= zIni && t <= zFin) ? PASO_FINO : PASO_MEDIO) finos[r3(t)] = true;
    gruesas.forEach(function (m) { if (m.t >= ini && m.t <= fin) delete finos[r3(m.t)]; });
    var tf = Object.keys(finos).map(Number).sort(function (a, b) { return a - b; });
    var nuevas = await muestrear(video, pose, tf, avance(0.45, 0.45, 'Midiendo cada cuadro del swing'));
    var todas = nuevas.concat(gruesas.filter(function (m) { return m.t >= ini && m.t <= fin; }))
      .sort(function (a, b) { return a.t - b.t; });

    var S = construirSerie(todas);
    var F = S ? detectarFases(S) : null;
    if (!F) { S = Sg; F = Fg; }

    /* 3 · Vista, mediciones */
    var vistaDet = detectarVista(S, F);
    var vista = vistaDet.vista || (window.cameraAngle === 'dtl' ? 'dtl' : 'face');
    var metricas = medir(S, F, vista);

    /* 4 · Recorte común e imágenes */
    var rect = recorte(S, F, W, H);
    var imagenes = [];
    for (var k = 0; k < FASES.length; k++) {
      var fase = FASES[k], i = F.idx[fase.id];
      if (alAvanzar) alAvanzar(0.9 + 0.1 * k / FASES.length, 'Preparando las imágenes de cada fase');
      await buscar(video, S.t[i]);
      var img = capturar(video, rect, S.lm[i], S, F, i, vista);
      imagenes.push({ fase: fase.id, etiqueta: fase.etiqueta, orden: fase.orden, t: S.t[i],
                      limpio: img.limpio, esqueleto: img.esqueleto });
    }

    var calidad = [];
    if (S.tasaDeteccion < 0.8) calidad.push('el cuerpo no se vio bien en parte del swing');
    if (S.escala < 0.12 * H) calidad.push('el jugador aparece pequeño en el cuadro (cámara lejos)');
    var bajada = (S.t[F.idx.P7] - S.t[F.idx.P4]) * 1000;

    return {
      ok: true,
      version: VERSION,
      modo: 'motor',
      vista: vista,
      vistaDetectada: vistaDet,
      duracion: dur,
      cuadros: gruesas.length + nuevas.length,
      tasaDeteccion: r1(S.tasaDeteccion * 100),
      fases: FASES.map(function (f) { return { id: f.id, etiqueta: f.etiqueta, t: r3(S.t[F.idx[f.id]]) }; }),
      tiempos: {
        backswing_ms: Math.round((S.t[F.idx.P4] - S.t[F.idx.P1]) * 1000),
        bajada_ms: Math.round(bajada)
      },
      metricas: metricas,
      componentes: componentesMedidos(metricas),
      calidad: calidad,
      imagenes: imagenes,
      rect: rect
    };
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  function recorte(S, F, W, H) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = F.idx.P1; i <= F.idx.P10; i++) {
      var lm = S.lm[i]; if (!lm) continue;
      lm.forEach(function (p) {
        if (p.v < 0.5) return;
        if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      });
    }
    if (!isFinite(x0)) return { x: 0, y: 0, w: W, h: H };
    var T = S.escala;
    x0 -= 0.85 * T; x1 += 0.85 * T; y0 -= 0.9 * T; y1 += 0.3 * T;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
  }

  var CONEXIONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
                    [23, 25], [25, 27], [24, 26], [26, 28]];

  function capturar(video, rect, lm, S, F, i, vista) {
    var esc = Math.min(1.5, LADO_MAX_IMG / Math.max(rect.w, rect.h));
    var cw = Math.round(rect.w * esc), ch = Math.round(rect.h * esc);
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var g = c.getContext('2d');
    g.drawImage(video, rect.x, rect.y, rect.w, rect.h, 0, 0, cw, ch);
    var limpio = c.toDataURL('image/jpeg', CALIDAD_JPEG);

    function P(p) { return { x: (p.x - rect.x) * esc, y: (p.y - rect.y) * esc }; }
    var lw = Math.max(2, Math.round(cw / 180));

    /* Líneas de referencia del setup (gold, punteadas) */
    var a = F.idx.P1;
    g.save();
    g.setLineDash([6, 6]); g.lineWidth = Math.max(1, lw - 1); g.strokeStyle = 'rgba(212,197,169,0.85)';
    if (vista === 'dtl') {
      var hp = P(S.HP[a]), sh = P(S.SH[a]);
      var dx = sh.x - hp.x, dy = sh.y - hp.y;
      g.beginPath(); g.moveTo(hp.x - dx * 0.6, hp.y - dy * 0.6); g.lineTo(sh.x + dx * 0.6, sh.y + dy * 0.6); g.stroke();
      g.beginPath(); g.moveTo(hp.x - 0.05 * cw * sign(dx || 1), 0); g.lineTo(hp.x - 0.05 * cw * sign(dx || 1), ch); g.stroke();
    } else {
      var hx = P(S.HP[a]).x, hd = P(S.HD[a]);
      g.beginPath(); g.moveTo(hx, 0); g.lineTo(hx, ch); g.stroke();
      g.beginPath(); g.arc(hd.x, hd.y, Math.max(10, S.escala * esc * 0.22), 0, Math.PI * 2); g.stroke();
    }
    g.restore();

    /* Esqueleto del cuadro actual */
    if (lm) {
      g.lineCap = 'round'; g.lineWidth = lw; g.strokeStyle = '#2dd4bf';
      CONEXIONES.forEach(function (cx) {
        var p1 = lm[cx[0]], p2 = lm[cx[1]];
        if (p1.v < 0.4 || p2.v < 0.4) return;
        var q1 = P(p1), q2 = P(p2);
        g.beginPath(); g.moveTo(q1.x, q1.y); g.lineTo(q2.x, q2.y); g.stroke();
      });
      g.fillStyle = '#D4C5A9';
      [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach(function (k) {
        if (lm[k].v < 0.4) return;
        var q = P(lm[k]);
        g.beginPath(); g.arc(q.x, q.y, lw * 1.1, 0, Math.PI * 2); g.fill();
      });
    }
    return { limpio: limpio, esqueleto: c.toDataURL('image/jpeg', CALIDAD_JPEG) };
  }


  /* ═════════════════════════════════════════════════════════════════════════
     MÉTODO BÁSICO (respaldo si el detector no carga)
     Igual al original, pero respetando la orientación del video.
     ═════════════════════════════════════════════════════════════════════════ */
  async function extraerBasico(video) {
    var dur = video.duration, W = video.videoWidth, H = video.videoHeight;
    var esc = Math.min(1, LADO_MAX_IMG / Math.max(W, H));
    var c = document.createElement('canvas');
    c.width = Math.round(W * esc); c.height = Math.round(H * esc);
    var g = c.getContext('2d'), out = [], negros = 0;
    for (var i = 0; i < 6; i++) {
      var t = (dur / 7) * (i + 1);
      var ok = await buscar(video, t);
      var data = '';
      if (ok) {
        try {
          g.drawImage(video, 0, 0, c.width, c.height);
          var px = g.getImageData(c.width / 2 - 20, c.height / 2 - 20, 40, 40).data, s = 0;
          for (var k = 0; k < px.length; k += 4) s += px[k] + px[k + 1] + px[k + 2];
          if (s / (px.length / 4 * 3) < 8) negros++;
          data = c.toDataURL('image/jpeg', CALIDAD_JPEG);
        } catch (e) { negros++; }
      } else negros++;
      out.push({ t: t, data: data });
    }
    return { frames: out, negros: negros };
  }


  /* ═════════════════════════════════════════════════════════════════════════
     HUELLA DEL VIDEO (mismo archivo → mismo análisis)
     ═════════════════════════════════════════════════════════════════════════ */
  async function huella(file) {
    try {
      if (!file || !window.crypto || !crypto.subtle) return null;
      var buf = await file.arrayBuffer();
      var h = await crypto.subtle.digest('SHA-256', buf);
      return Array.prototype.map.call(new Uint8Array(h), function (b) {
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    } catch (e) { return null; }
  }


  /* ═════════════════════════════════════════════════════════════════════════
     TEXTO PARA CLAUDE
     ═════════════════════════════════════════════════════════════════════════ */
  function bloquePrompt(res) {
    if (!res || res.modo !== 'motor') return '';
    var vistaTxt = res.vista === 'face' ? 'de frente (face-on)' : 'línea de tiro (down-the-line)';
    var s = '\n\n════ EVIDENCIA MEDIDA · MOTOR DE POSE MGL v' + res.version + ' ════\n' +
      'Se procesó el video COMPLETO con detección de pose (33 puntos del cuerpo, ' + res.cuadros +
      ' cuadros, hasta 60 por segundo en la bajada). Las imágenes NO son al azar: son las posiciones ' +
      'del swing detectadas automáticamente. En cada imagen se identifica la fase con su código P.\n\n' +
      'Vista: ' + vistaTxt + (res.vistaDetectada.vista ? ' (detectada automáticamente, confianza ' +
        res.vistaDetectada.confianza + ')' : ' (indicada por el jugador)') + '\n' +
      'Fases (segundo del video): ' + res.fases.map(function (f) {
        return f.id + ' ' + f.t.toFixed(2) + 's';
      }).join(' · ') + '\n' +
      'Duración: backswing ' + res.tiempos.backswing_ms + ' ms · bajada ' + res.tiempos.bajada_ms + ' ms\n\n' +
      'Mediciones (100% del torso ≈ 45–55 cm en un adulto; los cm son aproximados):\n';
    res.metricas.forEach(function (m) {
      s += '- [' + m.componente + ' · ' + m.pilar + '] ' + m.nombre + ': ' + m.texto +
           ' → ' + NIVEL_TXT[m.nivel].toUpperCase() + ' (' + m.referencia + '; confianza ' + m.confianza +
           ', fase ' + m.fase + ')' + (m.lectura ? '. Lectura: ' + m.lectura : '') + '\n';
    });
    var conMedida = Object.keys(res.componentes);
    var sinMedida = ['cara', 'path', 'lowpoint', 'secuencia', 'postura', 'ground', 'conexion', 'distancia']
      .filter(function (c) { return conMedida.indexOf(c) < 0; });
    s += '\nNivel base por componente según lo medido: ' +
      (conMedida.length ? conMedida.map(function (c) { return c + '=' + res.componentes[c]; }).join(', ') : 'ninguno') +
      '\nComponentes SIN medición directa (evalúalos mirando las imágenes): ' + sinMedida.join(', ');
    if (res.calidad.length) s += '\nAdvertencias de calidad: ' + res.calidad.join('; ');
    return s;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     INTERFAZ
     ═════════════════════════════════════════════════════════════════════════ */
  function injectCSS() {
    if (document.getElementById('mgl-motor-css')) return;
    var css =
      '.mgl-fases{grid-template-columns:repeat(auto-fill,minmax(96px,1fr))!important}' +
      '.mgl-fases figure{margin:0;cursor:pointer}' +
      '.mgl-fases img{aspect-ratio:auto!important;height:150px;object-fit:contain!important;background:#000}' +
      '.mgl-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 10px}' +
      '.mgl-tag{font-family:var(--font-heading);font-size:.72rem;letter-spacing:1px;text-transform:uppercase;' +
        'padding:4px 10px;border-radius:999px;border:1px solid var(--border);color:var(--text-muted)}' +
      '.mgl-toggle{background:none;border:1px solid var(--accent,#2dd4bf);color:var(--accent,#2dd4bf);' +
        'border-radius:999px;padding:4px 12px;font-size:.75rem;cursor:pointer;font-family:inherit}' +
      '.mgl-medidas{margin-top:14px;display:grid;gap:6px}' +
      '.mgl-medidas-titulo{font-family:var(--font-heading);font-size:.85rem;font-weight:600;color:var(--text-muted);' +
        'text-transform:uppercase;letter-spacing:1.5px;margin:18px 0 4px}' +
      '.mgl-medida{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;' +
        'border:1px solid var(--border);border-radius:8px;font-size:.82rem;background:var(--bg-card)}' +
      '.mgl-medida-nombre{color:var(--text-secondary)}' +
      '.mgl-medida-ref{display:block;font-size:.72rem;color:var(--text-muted)}' +
      '.mgl-medida-valor{white-space:nowrap;text-align:right}' +
      '.mgl-nivel{font-family:var(--font-heading);font-size:.7rem;letter-spacing:1px;text-transform:uppercase;margin-left:8px}' +
      '.mgl-nivel.ok{color:#10b981}.mgl-nivel.leve{color:#f59e0b}.mgl-nivel.moderado{color:#fb923c}' +
      '.mgl-nivel.severo{color:#ef4444}.mgl-nivel.no_evaluable{color:var(--text-muted)}' +
      '.diagnosis-frame img{aspect-ratio:auto!important;max-height:340px;object-fit:contain!important;background:#000}' +
      '.frames-mini img{aspect-ratio:auto!important;width:auto}' +
      '.mgl-aviso{margin:0 0 16px;padding:10px 14px;border-radius:8px;border:1px solid var(--accent,#2dd4bf);' +
        'font-size:.85rem;color:var(--text-secondary)}';
    var st = document.createElement('style');
    st.id = 'mgl-motor-css'; st.textContent = css;
    document.head.appendChild(st);
  }

  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }

  /* Lista de mediciones (se usa aquí y en los resultados de Fase A) */
  function htmlMedidas(metricas, titulo) {
    if (!metricas || !metricas.length) return '';
    var h = '<div class="mgl-medidas-titulo">' + esc(titulo || 'Lo que medimos en tu swing') + '</div><div class="mgl-medidas">';
    metricas.forEach(function (m) {
      h += '<div class="mgl-medida"><span class="mgl-medida-nombre">' + esc(m.nombre) +
        '<span class="mgl-medida-ref">' + esc(m.referencia) + (m.lectura ? ' · ' + esc(m.lectura) : '') + '</span></span>' +
        '<span class="mgl-medida-valor">' + esc(m.texto) +
        '<span class="mgl-nivel ' + m.nivel + '">' + esc(NIVEL_TXT[m.nivel]) + '</span></span></div>';
    });
    return h + '</div>';
  }

  var verEsqueleto = true;

  function pintar(gridId, previewId, res) {
    var grid = document.getElementById(gridId), prev = document.getElementById(previewId);
    if (!grid || !prev) return;
    grid.innerHTML = '';
    grid.classList.add('mgl-fases');
    var lab = prev.querySelector('.frames-label');
    if (lab) lab.textContent = 'Fases detectadas de tu swing';

    var extra = document.getElementById(previewId + 'Motor');
    if (!extra) {
      extra = document.createElement('div'); extra.id = previewId + 'Motor';
      prev.appendChild(extra);
    }
    var bar = document.getElementById(previewId + 'Bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = previewId + 'Bar'; bar.className = 'mgl-toolbar';
      prev.insertBefore(bar, grid);
    }

    var vistaTxt = res.vista === 'face' ? 'De frente' : 'Línea de tiro';
    bar.innerHTML = '<span class="mgl-tag">' + esc(vistaTxt) + '</span>' +
      '<span class="mgl-tag">Tempo ' + esc((res.metricas.filter(function (m) { return m.id === 'tempo'; })[0] || {}).texto || '—') + '</span>' +
      '<span class="mgl-tag">' + res.cuadros + ' cuadros analizados</span>' +
      '<button type="button" class="mgl-toggle">' + (verEsqueleto ? 'Ver sin esqueleto' : 'Ver esqueleto') + '</button>';
    bar.querySelector('.mgl-toggle').onclick = function () {
      verEsqueleto = !verEsqueleto; pintar(gridId, previewId, res);
    };

    res.imagenes.forEach(function (im) {
      var fig = document.createElement('figure');
      var img = document.createElement('img');
      img.src = verEsqueleto ? im.esqueleto : im.limpio;
      img.alt = 'Fase del swing: ' + im.etiqueta;
      var cap = document.createElement('figcaption'); cap.className = 'frame-label';
      cap.textContent = im.etiqueta.split('/')[0] + ' · ' + im.t.toFixed(2) + 's';
      fig.appendChild(img); fig.appendChild(cap);
      fig.onclick = function () { if (typeof window.seekPreview === 'function') window.seekPreview(im.orden); };
      grid.appendChild(fig);
    });

    var obs = res.metricas.filter(function (m) { return m.nivel !== 'ok' && m.nivel !== 'no_evaluable'; }).length;
    extra.innerHTML = htmlMedidas(res.metricas,
      'Mediciones · ' + res.metricas.length + ' tomadas, ' + obs + ' con observaciones');
  }

  function limpiarPintado(gridId, previewId) {
    var g = document.getElementById(gridId); if (g) g.classList.remove('mgl-fases');
    var b = document.getElementById(previewId + 'Bar'); if (b) b.remove();
    var e = document.getElementById(previewId + 'Motor'); if (e) e.innerHTML = '';
  }

  var MENSAJE_FALLO = {
    sin_cuerpo: 'No logramos ver tu cuerpo en el video.',
    sin_swing: 'No encontramos un swing completo en el video.',
    video_ilegible: 'No pudimos leer el video.',
    error: 'El detector de movimiento no se pudo cargar.'
  };

  /* ── Reemplazo de extractFrames() de coach-ai.html ── */
  async function extractFramesMotor(videoEl, gridId, previewId, btnId, statusId) {
    window.extractedFrames = []; window.frameTimes = [];
    window.MGL_SWING = null;
    var grid = document.getElementById(gridId);
    if (grid) grid.innerHTML = '';
    limpiarPintado(gridId, previewId);
    if (btnId && document.getElementById(btnId)) document.getElementById(btnId).disabled = true;

    if (typeof window.fixVideoDuration === 'function') await window.fixVideoDuration(videoEl);
    var dur = videoEl.duration;
    if (!dur || dur === Infinity || isNaN(dur) || dur < 0.5) {
      window.showStatus(statusId, 'No pudimos leer la duración del video. Prueba con otro archivo (MP4 H.264).', 'error');
      return;
    }

    var file = window.currentVideoFile;
    var hashP = huella(file);

    var res = null, motivo = null;
    try {
      window.showStatus(statusId, 'Cargando el detector de movimiento…', 'info');
      res = await analizarVideo(videoEl, function (p, msg) {
        window.showStatus(statusId, msg + '… ' + Math.round(p * 100) + '%', 'info');
      });
      if (!res.ok) { motivo = res.motivo; res = null; }
    } catch (e) {
      console.warn('[MGL motor] Falló el análisis de pose:', e);
      motivo = 'error'; res = null;
    }

    if (res) {
      /* Orden canónico en extractedFrames (compatible con dashboard/logbook) */
      var canon = res.imagenes.slice().sort(function (a, b) { return a.orden - b.orden; });
      window.extractedFrames = canon.map(function (im) { return im.limpio; });
      window.frameTimes = canon.map(function (im) { return im.t; });
      window.FRAME_LABELS = canon.map(function (im) { return im.etiqueta; });
      res.hash = await hashP;
      window.MGL_SWING = res;
      MOTOR.ultimo = res;

      /* Si la vista detectada no calza con la elegida, se corrige */
      var vd = res.vistaDetectada;
      var aviso = '';
      if (vd.vista && vd.confianza !== 'baja' && vd.vista !== window.cameraAngle && typeof window.setAngle === 'function') {
        window.setAngle(vd.vista);
        aviso = 'Detectamos que el video es ' + (vd.vista === 'face' ? 'de frente' : 'de línea de tiro') +
                ' y ajustamos el ángulo. ';
      }
      pintar(gridId, previewId, res);
      document.getElementById(previewId).classList.add('visible');
      if (btnId) document.getElementById(btnId).disabled = false;
      if (aviso || res.calidad.length) {
        window.showStatus(statusId, aviso + (res.calidad.length ? 'Ojo: ' + res.calidad.join('; ') +
          '. El análisis puede ser menos preciso.' : ''), 'info');
      } else {
        window.clearStatus(statusId);
      }
      console.log('%c[MGL motor] Swing analizado', 'color:#2dd4bf;font-weight:bold', res);
      return;
    }

    /* ── Respaldo: método básico ── */
    var b = await extraerBasico(videoEl);
    if (b.negros >= 5) {
      window.showStatus(statusId, 'El video se ve en negro al procesarlo (problema de códec). Exporta como MP4 H.264 e inténtalo otra vez.', 'error');
      return;
    }
    window.extractedFrames = b.frames.map(function (f) { return f.data; });
    window.frameTimes = b.frames.map(function (f) { return f.t; });
    window.FRAME_LABELS = ['Setup/Address', 'Takeaway', 'Top del backswing', 'Transición/Downswing', 'Impacto', 'Follow-through'];
    window.MGL_SWING = { ok: false, modo: 'basico', motivo: motivo, hash: await hashP };
    MOTOR.ultimo = window.MGL_SWING;
    if (grid) {
      window.extractedFrames.forEach(function (src, i) {
        var fig = document.createElement('figure');
        var img = document.createElement('img'); img.src = src; img.alt = 'Frame del swing: ' + window.FRAME_LABELS[i];
        var cap = document.createElement('figcaption'); cap.className = 'frame-label';
        cap.textContent = window.FRAME_LABELS[i].split('/')[0];
        fig.appendChild(img); fig.appendChild(cap); grid.appendChild(fig);
      });
    }
    document.getElementById(previewId).classList.add('visible');
    if (btnId) document.getElementById(btnId).disabled = false;
    window.showStatus(statusId, (MENSAJE_FALLO[motivo] || MENSAJE_FALLO.error) +
      ' Igual puedes continuar, pero el análisis será menos preciso. Para el mejor resultado: un solo swing ' +
      'por video, cuerpo completo en cuadro, cámara fija a la altura de las manos y, si puedes, a 60 fps.', 'info');
  }


  /* ═════════════════════════════════════════════════════════════════════════
     TOKEN DE SESIÓN EN LAS LLAMADAS A /api/coach
     ═════════════════════════════════════════════════════════════════════════ */
  var SB_URL  = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
  var _sb = null;
  async function tokenSesion() {
    try {
      if (!_sb && window.supabase && window.supabase.createClient) _sb = window.supabase.createClient(SB_URL, SB_ANON);
      if (!_sb) return null;
      var r = await _sb.auth.getSession();
      return (r && r.data && r.data.session) ? r.data.session.access_token : null;
    } catch (e) { return null; }
  }

  function instalarAuthFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__mglAuth) return;
    var original = window.fetch;
    var envuelto = function (entrada, opciones) {
      var url = '';
      try { url = (typeof entrada === 'string') ? entrada : (entrada && entrada.url) || ''; } catch (e) {}
      if (url.indexOf('/api/coach') === -1) return original.apply(this, arguments);
      var self = this, args = arguments;
      return tokenSesion().then(function (tok) {
        if (!tok) return original.apply(self, args);
        var op = {};
        Object.keys(opciones || {}).forEach(function (k) { op[k] = opciones[k]; });
        var h = new Headers((opciones && opciones.headers) || {});
        if (!h.has('Authorization')) h.set('Authorization', 'Bearer ' + tok);
        op.headers = h;
        return original.call(self, entrada, op);
      });
    };
    envuelto.__mglAuth = true;
    window.fetch = envuelto;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     AUTOTEST CON UN SWING SINTÉTICO
     ═════════════════════════════════════════════════════════════════════════ */
  function swingSintetico(vista, opts) {
    opts = opts || {};
    var muestras = [], W = 1080, H = 1920, T = 300; // torso de 300 px
    var tA = 1.0, tTop = 1.9, tImp = 2.18, tFin = 3.0;
    var d = 1; // target / bola hacia la derecha
    for (var t = 0; t <= 4; t += 1 / 60) {
      var hip = { x: 540, y: 1100 }, sh = { x: 540, y: 800 }, head = { x: 540, y: 680 };
      var hand;
      var swRatio = vista === 'face' ? 0.85 : 0.25;
      if (vista === 'dtl') { sh.x = hip.x + 200 * d; head.x = sh.x + 40 * d; }
      var addrHand = vista === 'face' ? { x: 540, y: 1150 } : { x: hip.x + 320 * d, y: 1200 };
      var topHand = vista === 'face' ? { x: 540 - 260 * d, y: 650 } : { x: hip.x + 60 * d, y: 600 };
      var finHand = vista === 'face' ? { x: 540 + 260 * d, y: 640 } : { x: hip.x - 80 * d, y: 620 };
      var p;
      if (t < tA) hand = addrHand;
      else if (t < tTop) { p = (t - tA) / (tTop - tA); p = 0.5 - 0.5 * Math.cos(Math.PI * p);
        hand = { x: addrHand.x + (topHand.x - addrHand.x) * p, y: addrHand.y + (topHand.y - addrHand.y) * p }; }
      else if (t < tImp) { p = (t - tTop) / (tImp - tTop); p = p * p;
        hand = { x: topHand.x + (addrHand.x + 40 * d - topHand.x) * p, y: topHand.y + (addrHand.y - 20 - topHand.y) * p }; }
      else if (t < tFin) { p = (t - tImp) / (tFin - tImp); p = Math.sin(Math.PI / 2 * p);
        var hi = { x: addrHand.x + 40 * d, y: addrHand.y - 20 };
        hand = { x: hi.x + (finHand.x - hi.x) * p, y: hi.y + (finHand.y - hi.y) * p }; }
      else hand = finHand;
      /* Defectos inyectados */
      if (opts.early && t > tTop) { var k = Math.min(1, (t - tTop) / (tImp - tTop)); hip.x += 45 * d * k; }
      if (opts.sway && t > tA && t <= tTop) { hip.x -= 90 * d * (t - tA) / (tTop - tA); }
      var lm = [];
      for (var i = 0; i < 33; i++) lm.push({ x: hip.x, y: hip.y, v: 0.95 });
      var halfSW = T * swRatio / 2;
      lm[0] = { x: head.x, y: head.y, v: 0.99 };
      lm[11] = { x: sh.x - halfSW, y: sh.y, v: 0.99 }; lm[12] = { x: sh.x + halfSW, y: sh.y, v: 0.99 };
      lm[15] = { x: hand.x - 8, y: hand.y, v: 0.95 }; lm[16] = { x: hand.x + 8, y: hand.y, v: 0.95 };
      lm[23] = { x: hip.x - halfSW * 0.8, y: hip.y, v: 0.99 }; lm[24] = { x: hip.x + halfSW * 0.8, y: hip.y, v: 0.99 };
      muestras.push({ t: r3(t), lm: lm });
    }
    return { muestras: muestras, W: W, H: H, esperado: { tA: tA, tTop: tTop, tImp: tImp } };
  }

  function test() {
    var fallas = [];
    ['face', 'dtl'].forEach(function (vista) {
      var sw = swingSintetico(vista);
      var S = construirSerie(sw.muestras), F = detectarFases(S);
      if (!F) { fallas.push(vista + ': no detectó fases'); return; }
      var tTop = S.t[F.idx.P4], tImp = S.t[F.idx.P7];
      if (Math.abs(tTop - sw.esperado.tTop) > 0.05) fallas.push(vista + ': top en ' + tTop);
      if (Math.abs(tImp - sw.esperado.tImp) > 0.04) fallas.push(vista + ': impacto en ' + tImp);
      var vd = detectarVista(S, F);
      if (vd.vista !== vista) fallas.push(vista + ': vista detectada ' + vd.vista);
      var orden = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P10'];
      for (var k = 1; k < orden.length; k++) {
        if (F.idx[orden[k]] < F.idx[orden[k - 1]]) fallas.push(vista + ': fases fuera de orden');
      }
      var M = medir(S, F, vista);
      var tempo = M.filter(function (m) { return m.id === 'tempo'; })[0];
      if (!tempo || tempo.nivel !== 'ok') fallas.push(vista + ': tempo ' + (tempo && tempo.texto));
    });
    var swE = swingSintetico('dtl', { early: true });
    var SE = construirSerie(swE.muestras), FE = detectarFases(SE);
    var ee = FE && medir(SE, FE, 'dtl').filter(function (m) { return m.id === 'early_extension'; })[0];
    if (!ee || ee.nivel === 'ok') fallas.push('early extension inyectada no detectada (' + (ee && ee.texto) + ')');
    var swS = swingSintetico('face', { sway: true });
    var SS = construirSerie(swS.muestras), FS = detectarFases(SS);
    var sw2 = FS && medir(SS, FS, 'face').filter(function (m) { return m.id === 'sway_top'; })[0];
    if (!sw2 || sw2.nivel === 'ok') fallas.push('sway inyectado no detectado (' + (sw2 && sw2.texto) + ')');
    return { ok: fallas.length === 0, fallas: fallas };
  }


  /* ═════════════════════════════════════════════════════════════════════════
     API PÚBLICA E INSTALACIÓN
     ═════════════════════════════════════════════════════════════════════════ */
  var MOTOR = {
    version: VERSION,
    umbrales: UMBRALES,
    definiciones: DEF,
    fases: FASES,
    ultimo: null,
    bloquePrompt: bloquePrompt,
    htmlMedidas: htmlMedidas,
    /* "P4" → índice 1-based en extractedFrames (orden canónico) */
    indiceDeFase: function (code) {
      var c = String(code || '').toUpperCase().replace(/\s/g, '');
      for (var i = 0; i < FASES.length; i++) if (FASES[i].id === c) return FASES[i].orden + 1;
      return null;
    },
    analizarVideo: analizarVideo,
    cargarPose: cargarPose,
    test: test,
    _puro: { construirSerie: construirSerie, detectarFases: detectarFases, medir: medir,
             detectarVista: detectarVista, swingSintetico: swingSintetico, clasificar: clasificar }
  };
  window.MGL_MOTOR = MOTOR;

  if (typeof document === 'undefined') return;

  function instalar() {
    injectCSS();
    instalarAuthFetch();
    if (typeof window.extractFrames === 'function') {
      window.__extractFramesOriginal = window.extractFrames;
      window.extractFrames = extractFramesMotor;
    } else {
      console.warn('[MGL motor] extractFrames() no existe: ¿el archivo se cargó antes del script principal?');
    }
    var r = test();
    console.log('%c 🏌️ MGL MOTOR v' + VERSION + (r.ok ? ' — INSTALADO, autotest OK ' : ' — AUTOTEST CON FALLAS '),
      'background:' + (r.ok ? '#2dd4bf' : '#ef4444') + ';color:#06251f;font-weight:bold', r.ok ? '' : r.fallas);
    /* Precarga del detector cuando la página está tranquila */
    var pre = function () { cargarPose().catch(function () {}); };
    if ('requestIdleCallback' in window) window.requestIdleCallback(pre, { timeout: 4000 });
    else setTimeout(pre, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', instalar);
  else instalar();
})();
