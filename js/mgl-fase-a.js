/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · FASE A — Taxonomía de diagnósticos
   Archivo: /js/mgl-fase-a.js
   Versión: 1.0  ·  2026-07-26

   QUÉ HACE
   Este archivo aplica, por sí solo, los pasos 1 a 7 de la Fase A:
     · Define la taxonomía oficial (componentes, pilares, errores)
     · Inyecta el CSS de los chips de componente
     · Agrega normalizeFinding(): valida y rescata los diagnósticos de la IA
     · Reemplaza analyzeSwing(): nuevo prompt con taxonomía + contexto previo
     · Reemplaza renderResults(): muestra los chips y entiende el formato viejo
     · Corre un autotest al cargar y escribe el resultado en la consola

   CÓMO SE INSTALA
   1. Copiar este archivo en la carpeta /js/ del sitio
   2. En coach-ai.html, justo antes del cierre de BODY, agregar una etiqueta
      script que apunte a  /js/mgl-fase-a.js

   CÓMO SE DESINSTALA
   Borrar esa línea. El sitio vuelve exactamente a como estaba.

   IMPORTANTE
   Este archivo NO modifica coach-ai.html. Redefine funciones desde afuera.
   Por eso debe cargarse DESPUÉS del bloque de script principal, es decir,
   al final del <body>. Si se pone en el <head> no funciona.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var VERSION = '1.0';

  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 1 · TAXONOMÍA
     Fuente única de verdad. Cuando construyamos el dashboard, este bloque
     se moverá a su propio archivo para compartirlo entre páginas.
     ═════════════════════════════════════════════════════════════════════════ */

  var MGL_TAX = {

    /* Listas cerradas: la IA solo puede usar estos valores */
    componentes: ['cara', 'path', 'lowpoint', 'secuencia',
                  'postura', 'ground', 'conexion', 'distancia'],

    pilares: ['GF', 'KS', 'WC', 'BT'],

    errores: ['slice', 'hook', 'top', 'gordo', 'shank',
              'push', 'pull', 'potencia', 'distancia', 'spin'],

    severidades: ['alta', 'media', 'baja'],

    /* Nombres para mostrar en pantalla */
    componenteLabel: {
      cara:      'Cara del palo',
      path:      'Path / Trayectoria',
      lowpoint:  'Low point y contacto',
      secuencia: 'Secuencia y rotación',
      postura:   'Postura y ángulos',
      ground:    'Ground forces y presión',
      conexion:  'Conexión y ancho de arco',
      distancia: 'Control de distancia y spin'
    },

    pilarLabel: {
      GF: 'Ground Forces',
      KS: 'Kinematic Sequence',
      WC: 'Wrist Conditions',
      BT: 'Body Tilts'
    },

    errorLabel: {
      slice:     'Slice',
      hook:      'Hook',
      top:       'Top',
      gordo:     'Gordo',
      shank:     'Shank',
      push:      'Push',
      pull:      'Pull',
      potencia:  'Pérdida de potencia',
      distancia: 'Control de distancia',
      spin:      'Spin en wedges'
    },

    /* Colores. Ninguno choca con el rojo de severidad alta (#ef4444) */
    componenteColor: {
      cara:      '#2dd4bf',
      path:      '#3b82f6',
      lowpoint:  '#f59e0b',
      secuencia: '#ec4899',
      postura:   '#8b5cf6',
      ground:    '#06b6d4',
      conexion:  '#10b981',
      distancia: '#fb923c'
    },

    /* Validadores */
    esComponente: function (v) { return this.componentes.indexOf(v) >= 0; },
    esPilar:      function (v) { return this.pilares.indexOf(v)     >= 0; },
    esError:      function (v) { return this.errores.indexOf(v)     >= 0; },
    esSeveridad:  function (v) { return this.severidades.indexOf(v) >= 0; }
  };

  window.MGL_TAX = MGL_TAX;


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 2 · CSS DE LOS CHIPS
     Se inyecta desde acá para no tener que tocar el <style> de la página.
     ═════════════════════════════════════════════════════════════════════════ */

  function injectCSS() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('mgl-fase-a-css')) return;

    var css =
      '.diagnosis-chips{display:flex;gap:6px;flex-wrap:wrap;padding:0 24px 16px;margin-top:-4px}' +
      '.diagnosis-chip{display:inline-flex;align-items:center;gap:6px;' +
        'font-family:var(--font-heading),sans-serif;font-size:.75rem;font-weight:600;' +
        'text-transform:uppercase;letter-spacing:1px;padding:3px 10px;border-radius:100px;' +
        'border:1px solid currentColor;background:rgba(255,255,255,.03)}' +
      '.diagnosis-chip.muted{color:var(--text-muted);border-color:var(--border-light)}' +
      '@media(max-width:640px){.diagnosis-chips{padding:0 16px 14px}}';

    var el = document.createElement('style');
    el.id = 'mgl-fase-a-css';
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 3 · normalizeFinding()
     Recibe un diagnóstico crudo de la IA y devuelve uno limpio y validado.
     Si la IA se equivoca en la taxonomía, deduce los valores desde los drills
     recomendados (que ya vienen clasificados en el catálogo).
     Devuelve null solo si el diagnóstico es irrecuperable.
     ═════════════════════════════════════════════════════════════════════════ */

  function normalizeFinding(diag) {
    if (!diag || typeof diag !== 'object') return null;

    var T = window.MGL_TAX;
    if (!T) { console.error('[MGL] MGL_TAX no disponible'); return null; }

    var out = {
      titulo:          String(diag.titulo || 'Diagnóstico').slice(0, 120),
      que_pasa:        String(diag.que_pasa || ''),
      como_corregirlo: String(diag.como_corregirlo || ''),
      severidad:       T.esSeveridad(diag.severidad) ? diag.severidad : 'media',
      frame_ref:       null,
      componente:      null,
      pilar:           null,
      error_tag:       null,
      drills:          []
    };

    /* Frame de referencia (acepta el nombre nuevo y el viejo) */
    var fr = parseInt(diag.frame_ref != null ? diag.frame_ref : diag.frame_referencia, 10);
    if (fr >= 1 && fr <= 6) out.frame_ref = fr;

    /* Resolver drills primero: son la fuente más confiable para el rescate */
    var seen = {};
    var recs = Array.isArray(diag.drills_recomendados) ? diag.drills_recomendados
             : Array.isArray(diag.drills)              ? diag.drills
             : [];
    recs.forEach(function (raw) {
      var dr = (typeof resolveDrill === 'function')
        ? resolveDrill(raw && raw.id ? raw.id : raw)
        : null;
      if (dr && !seen[dr.id]) { seen[dr.id] = true; out.drills.push(dr); }
    });
    var d0 = out.drills[0] || null;

    /* Componente */
    if (T.esComponente(diag.componente)) {
      out.componente = diag.componente;
    } else if (d0) {
      out.componente = d0.c;
      console.warn('[MGL] componente inválido ("' + diag.componente +
                   '") → deducido del drill ' + d0.id + ' = "' + d0.c + '"');
    }

    /* Pilar */
    if (T.esPilar(diag.pilar)) {
      out.pilar = diag.pilar;
    } else if (d0 && d0.p && d0.p.length) {
      out.pilar = d0.p[0];
      console.warn('[MGL] pilar inválido ("' + diag.pilar + '") → deducido = "' + out.pilar + '"');
    }

    /* Error técnico */
    if (T.esError(diag.error_tag)) {
      out.error_tag = diag.error_tag;
    } else if (d0 && d0.e && d0.e.length) {
      out.error_tag = d0.e[0];
      console.warn('[MGL] error_tag inválido ("' + diag.error_tag + '") → deducido = "' + out.error_tag + '"');
    }

    /* Sin componente no sirve para el dashboard */
    if (!out.componente) {
      console.error('[MGL] Diagnóstico DESCARTADO (sin componente ni drills válidos):', diag);
      return null;
    }

    return out;
  }

  window.normalizeFinding = normalizeFinding;


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 4 · Helper: resolver la lista de drills de un diagnóstico
     Entiende los tres formatos posibles:
       a) drills: [{id,t,c,...}]       ← formato nuevo (ya resuelto)
       b) drills: ['cara-01', ...]     ← ids sueltos
       c) drills_recomendados: [...]   ← formato viejo del historial
     ═════════════════════════════════════════════════════════════════════════ */

  function resolveDrillList(diag) {
    var lista = [];
    var seen = {};

    function push(raw) {
      if (!raw) return;
      var dr = (raw && typeof raw === 'object' && raw.id && raw.t)
        ? raw
        : (typeof resolveDrill === 'function'
            ? resolveDrill(raw && raw.id ? raw.id : raw)
            : null);
      if (dr && !seen[dr.id]) { seen[dr.id] = true; lista.push(dr); }
    }

    if (Array.isArray(diag.drills) && diag.drills.length) {
      diag.drills.forEach(push);
    } else if (Array.isArray(diag.drills_recomendados)) {
      diag.drills_recomendados.forEach(push);
    }
    return lista;
  }


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 5 · renderResults() — reemplaza la versión original
     Novedades: muestra chips de componente/pilar/error y entiende análisis
     antiguos del historial (que no tienen taxonomía).
     ═════════════════════════════════════════════════════════════════════════ */

  function renderResultsPatched(result) {
    var container = document.getElementById('analysisResults');
    if (!container) return;

    var T   = window.MGL_TAX;
    var esc = (typeof escapeHtml === 'function')
      ? escapeHtml
      : function (t) { var d = document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; };

    var nivelText = result.nivel === 'principiante' ? 'Nivel Principiante'
                  : result.nivel === 'avanzado'     ? 'Nivel Avanzado'
                  : 'Nivel Intermedio';

    var html = '<div class="result-header fade-in-up">' +
      '<div class="result-score ' + scoreClassFor(result.score) + '">' +
      esc(String(result.score)) + '</div>' +
      '<div class="result-summary"><h2>DIAGNÓSTICO DE TU SWING</h2>' +
      '<p>' + esc(result.resumen || '') + '</p>' +
      '<span style="font-family:var(--font-heading);font-size:0.8rem;color:var(--text-muted);' +
      'text-transform:uppercase;letter-spacing:1.5px;">' + nivelText + '</span>' +
      '</div></div>';

    html += '<p class="score-disclaimer">El puntaje es una guía orientativa basada en 6 imágenes ' +
            'de una sola cámara, no una medición precisa. Concéntrate en los diagnósticos ' +
            'y sus correcciones.</p>';

    (result.diagnosticos || []).forEach(function (diag, i) {

      /* ── Severidad ── */
      var sevClass = diag.severidad === 'alta' ? 'severity-high'
                   : diag.severidad === 'baja' ? 'severity-low'
                   : 'severity-medium';
      var sevText  = diag.severidad === 'alta' ? 'Prioridad Alta'
                   : diag.severidad === 'baja' ? 'Prioridad Baja'
                   : 'Prioridad Media';

      /* ── Chips de taxonomía (solo si el análisis los tiene) ── */
      var chipsHtml = '';
      if (T && diag.componente && T.componenteLabel[diag.componente]) {
        var col = T.componenteColor[diag.componente] || 'var(--accent)';
        chipsHtml += '<span class="diagnosis-chip" style="color:' + col + '">' +
                     esc(T.componenteLabel[diag.componente]) + '</span>';
      }
      if (T && diag.pilar && T.pilarLabel[diag.pilar]) {
        chipsHtml += '<span class="diagnosis-chip muted">' + esc(T.pilarLabel[diag.pilar]) + '</span>';
      }
      if (T && diag.error_tag && T.errorLabel[diag.error_tag]) {
        chipsHtml += '<span class="diagnosis-chip muted">' + esc(T.errorLabel[diag.error_tag]) + '</span>';
      }
      if (chipsHtml) chipsHtml = '<div class="diagnosis-chips">' + chipsHtml + '</div>';

      /* ── Frame de referencia ── */
      var frameIdx = parseInt(diag.frame_ref != null ? diag.frame_ref : diag.frame_referencia, 10);
      var frameHtml = '';
      if (frameIdx >= 1 && frameIdx <= 6 &&
          typeof extractedFrames !== 'undefined' && extractedFrames[frameIdx - 1]) {
        frameHtml = '<figure class="diagnosis-frame">' +
          '<button type="button" onclick="seekPreview(' + (frameIdx - 1) + ')" ' +
          'aria-label="Ver este momento en el video">' +
          '<img src="' + extractedFrames[frameIdx - 1] + '" alt="Frame del error: ' +
          esc(FRAME_LABELS[frameIdx - 1]) + '"></button>' +
          '<figcaption>▶ ' + esc(FRAME_LABELS[frameIdx - 1].split('/')[0]) + '</figcaption>' +
          '</figure>';
      }

      /* ── Drills ── */
      var drillsHtml = '';
      resolveDrillList(diag).forEach(function (dr) {
        var color = (typeof COMPONENT_COLOR !== 'undefined' && COMPONENT_COLOR[dr.c])
          ? COMPONENT_COLOR[dr.c] : 'var(--accent)';
        var meta = dr.cn + ' · ' + dr.n + ' · ' + dr.d;
        drillsHtml += '<a class="drill-referral" href="' + esc(dr.u) +
          '" target="_blank" rel="noopener">' +
          '<span class="drill-cat-dot" style="background:' + color + '"></span>' +
          '<div class="drill-referral-info">' +
          '<div class="drill-referral-name">' + esc(dr.t) + '</div>' +
          '<div class="drill-referral-desc">' + esc(meta) + '</div></div>' +
          '<span class="drill-referral-arrow" aria-hidden="true">→</span></a>';
      });

      /* ── Cuerpo ── */
      var bodyInner =
        '<div class="diagnosis-block"><div class="diagnosis-label">Qué está pasando</div>' +
        '<div class="diagnosis-text">' + esc(diag.que_pasa || '') + '</div></div>' +
        '<div class="diagnosis-block"><div class="diagnosis-label">Cómo corregirlo</div>' +
        '<div class="diagnosis-text">' + esc(diag.como_corregirlo || '') + '</div></div>' +
        (drillsHtml
          ? '<div class="diagnosis-block"><div class="diagnosis-label">' +
            'Drills recomendados en la Biblioteca</div>' + drillsHtml + '</div>'
          : '');

      var body = frameHtml
        ? '<div class="diagnosis-grid">' + frameHtml + '<div>' + bodyInner + '</div></div>'
        : bodyInner;

      html += '<div class="diagnosis-card fade-in-up delay-' + Math.min(i + 1, 3) + '">' +
        '<div class="diagnosis-card-header">' +
        '<div class="diagnosis-number">' + (i + 1) + '</div>' +
        '<h3>' + esc(diag.titulo || 'Diagnóstico') + '</h3>' +
        '<span class="diagnosis-severity ' + sevClass + '">' + sevText + '</span></div>' +
        chipsHtml +
        '<div class="diagnosis-card-body">' + body + '</div></div>';
    });

    html += '<div class="library-referral fade-in-up delay-3"><h3>PROFUNDIZA EN TU CORRECCIÓN</h3>' +
      '<p>En la Biblioteca encontrarás drills enfocados en corregir cada error diagnosticado. ' +
      'En Training Lab, drills de performance con variantes por nivel.</p>' +
      '<a href="/es/library.html" target="_blank" rel="noopener">Ver Biblioteca ' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a></div>';

    html += '<button type="button" class="new-analysis-btn" onclick="resetAnalysis()">' +
            '↻ ANALIZAR OTRO SWING</button>';

    container.innerHTML = html;
    container.classList.add('visible');
    container.focus();
  }


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 6 · Construcción del prompt con taxonomía
     ═════════════════════════════════════════════════════════════════════════ */

  function buildPromptText(ctx) {
    return 'Analiza estos 6 frames de mi swing de golf.' + ctx +

      '\n\nCATÁLOGO DE DRILLS DISPONIBLES (recomienda SOLO ids de esta lista, 1 a 3 por ' +
      'diagnóstico, eligiendo los que ataquen el error detectado). ' +
      'Formato "id [componente] errores — título":\n' +
      catalogForPrompt() +

      '\n\n════ TAXONOMÍA OBLIGATORIA ════\n' +
      'Cada diagnóstico DEBE incluir estos tres campos, usando EXCLUSIVAMENTE los valores ' +
      'de estas listas. No inventes valores nuevos.\n\n' +

      'componente (exactamente uno):\n' +
      '  cara       — orientación de la cara del palo al impacto\n' +
      '  path       — trayectoria del palo (in-to-out / out-to-in, plano)\n' +
      '  lowpoint   — punto bajo del arco, calidad de contacto, divot\n' +
      '  secuencia  — orden y timing de la cadena cinemática, rotación\n' +
      '  postura    — ángulos del cuerpo, tilts, early extension\n' +
      '  ground     — uso del suelo, transferencia de presión, footwork\n' +
      '  conexion   — relación brazos-cuerpo, ancho de arco\n' +
      '  distancia  — control de distancia, spin, calibración\n\n' +

      'pilar (exactamente uno): GF | KS | WC | BT\n' +
      '  GF = Ground Forces · KS = Kinematic Sequence\n' +
      '  WC = Wrist Conditions · BT = Body Tilts\n\n' +

      'error_tag (la consecuencia visible en el vuelo de la bola; si no hay una ' +
      'consecuencia clara, elige la más cercana):\n' +
      '  slice | hook | top | gordo | shank | push | pull | potencia | distancia | spin\n\n' +

      'IMPORTANTE: el "componente" que elijas debe coincidir con el componente de los ' +
      'drills que recomiendas para ese mismo diagnóstico.\n\n' +

      '════ REGLAS ════\n' +
      '- Máximo 3 diagnósticos. Prioriza causa raíz sobre síntoma.\n' +
      '- Si dos hallazgos comparten componente, fusiónalos en uno solo.\n' +
      '- No fuerces encontrar fallas: si el swing está bien, devuelve menos diagnósticos.\n\n' +

      '════ FORMATO ════\n' +
      'Responde SOLO en JSON válido, sin backticks ni texto extra:\n' +
      '{"score":<1-100>,"resumen":"<1-2 oraciones>","nivel":"<principiante|intermedio|avanzado>",' +
      '"diagnosticos":[{' +
        '"titulo":"<nombre corto del problema>",' +
        '"componente":"<cara|path|lowpoint|secuencia|postura|ground|conexion|distancia>",' +
        '"pilar":"<GF|KS|WC|BT>",' +
        '"error_tag":"<slice|hook|top|gordo|shank|push|pull|potencia|distancia|spin>",' +
        '"severidad":"<alta|media|baja>",' +
        '"que_pasa":"<causa raíz, 2-3 oraciones>",' +
        '"como_corregirlo":"<instrucciones concretas>",' +
        '"frame_referencia":<1-6 o null>,' +
        '"drills_recomendados":["<id exacto del catálogo>"]}]}';
  }


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 7 · analyzeSwing() — reemplaza la versión original
     Cambios respecto al original:
       · Usa el prompt con taxonomía
       · Inyecta el análisis anterior como contexto
       · Normaliza los diagnósticos antes de mostrarlos
       · Deja __crudo y __ultimo en window para poder inspeccionar
     ═════════════════════════════════════════════════════════════════════════ */

  async function analyzeSwingPatched() {
    var $ = function (id) { return document.getElementById(id); };

    if (typeof extractedFrames === 'undefined' || extractedFrames.length === 0) {
      showStatus('consentHint', 'No hay frames para analizar.', 'error'); return;
    }
    if (!$('consentCheck').checked) {
      showStatus('consentHint', 'Marca la casilla de consentimiento para continuar.', 'error'); return;
    }

    var handicap = $('qHandicap').value.trim();
    var problema = $('qProblema').value.trim();
    var objetivo = $('qObjetivo').value.trim();

    $('uploadSection').style.display = 'none';
    $('questionnaireSection').classList.remove('visible');
    $('analysisLoading').classList.add('visible');
    $('analysisResults').classList.remove('visible');
    $('analysisResults').innerHTML = '';
    resetLoadingSteps();
    animateLoadingSteps();

    /* ── Frames como imágenes ── */
    var imageContent = [];
    extractedFrames.forEach(function (frame, i) {
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/jpeg',
          data: frame.replace('data:image/jpeg;base64,', '')
        }
      });
      imageContent.push({
        type: 'text',
        text: 'Frame ' + (i + 1) + ': ' + (FRAME_LABELS[i] || 'Posición ' + (i + 1))
      });
    });

    /* ── Contexto ── */
    var angleText = cameraAngle === 'face'
      ? 'de frente (face-on)'
      : 'desde la línea de tiro (down-the-line)';

    var ctx = '\n\nÁNGULO DE CÁMARA: ' + angleText + ' (toma esto en cuenta para el análisis).';
    ctx += '\n\nNOTA: los 6 frames están tomados a intervalos aproximadamente iguales; ' +
           'identifica tú mismo la fase real de cada uno.';

    if (handicap || problema || objetivo) {
      ctx += '\n\nINFORMACIÓN DEL JUGADOR:';
      if (handicap) ctx += '\n- Hándicap/Nivel: ' + handicap;
      if (problema) ctx += '\n- Problema principal: ' + problema;
      if (objetivo) ctx += '\n- Objetivo: ' + objetivo;
      ctx += '\n\nUsa esta información para adaptar tu comunicación.';
    }

    /* ── Análisis anterior: fuerza continuidad entre evaluaciones ── */
    try {
      var prev = (typeof getHistory === 'function') ? getHistory()[0] : null;
      if (prev && Array.isArray(prev.diagnosticos) && prev.diagnosticos.length) {
        var lineas = prev.diagnosticos.map(function (d) {
          var comp = d.componente ? '[' + d.componente + '] ' : '';
          return '- ' + comp + (d.titulo || '') + ' (severidad ' + (d.severidad || 'media') + ')';
        }).join('\n');

        ctx += '\n\n════ ANÁLISIS ANTERIOR ════\n' +
               'Fecha: ' + new Date(prev.date).toLocaleDateString('es-CL') +
               ' · Score: ' + prev.score + '\n' +
               'Fallas detectadas entonces:\n' + lineas +
               '\n\nEvalúa explícitamente si cada una de esas fallas PERSISTE, MEJORÓ o se ' +
               'RESOLVIÓ, y menciónalo en el resumen. Si una falla persiste, usa EXACTAMENTE ' +
               'el mismo "componente" que antes. No inventes fallas nuevas solo por variar.';
      }
    } catch (e) {
      console.warn('[MGL] No se pudo leer el análisis anterior:', e);
    }

    var promptText = buildPromptText(ctx);

    /* ── Llamada al backend ── */
    analysisController = new AbortController();
    var timeout = setTimeout(function () {
      if (analysisController) analysisController.abort();
    }, 90000);

    try {
      var response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: analysisController.signal,
        body: JSON.stringify({
          mode: 'swing',
          messages: [{ role: 'user', content: imageContent.concat([{ type: 'text', text: promptText }]) }]
        })
      });
      clearTimeout(timeout);
      if (!response.ok) throw new Error('HTTP ' + response.status);

      var data = await response.json();
      var raw = (data.content || []).map(function (c) { return c.text || ''; }).join('');
      var result = parseAnalysis(raw);
      if (!result || !Array.isArray(result.diagnosticos)) throw new Error('Respuesta inesperada');

      /* Copia cruda, para poder inspeccionar en la consola */
      try { window.__crudo = JSON.parse(JSON.stringify(result)); } catch (e) {}

      /* Normalización */
      var totalOriginal = result.diagnosticos.length;
      result.diagnosticos = result.diagnosticos
        .map(normalizeFinding)
        .filter(function (d) { return d !== null; })
        .slice(0, 3);

      if (!result.diagnosticos.length) {
        throw new Error('No se pudieron clasificar los diagnósticos');
      }
      if (result.diagnosticos.length < totalOriginal) {
        console.warn('[MGL] Se descartaron ' + (totalOriginal - result.diagnosticos.length) +
                     ' de ' + totalOriginal + ' diagnósticos');
      }

      result.score = Math.max(1, Math.min(100, parseInt(result.score, 10) || 50));
      window.__ultimo = result;

      console.log('%c[MGL] Análisis normalizado', 'color:#2dd4bf;font-weight:bold');
      console.table(result.diagnosticos.map(function (d) {
        return {
          titulo:     d.titulo,
          componente: d.componente,
          pilar:      d.pilar,
          error:      d.error_tag,
          severidad:  d.severidad,
          drills:     d.drills.length
        };
      }));

      $('analysisLoading').classList.remove('visible');
      renderResults(result);
      saveToHistory(result);

    } catch (err) {
      clearTimeout(timeout);
      $('analysisLoading').classList.remove('visible');
      $('questionnaireSection').classList.add('visible');
      var msg = (err && err.name === 'AbortError')
        ? 'El análisis tardó demasiado o fue cancelado. Inténtalo de nuevo.'
        : 'Hubo un error al analizar el swing. Revisa tu conexión e inténtalo de nuevo.';
      showStatus('consentHint', msg, 'error');
      console.error('[MGL] Error en analyzeSwing:', err);
    } finally {
      analysisController = null;
    }
  }


  /* ═════════════════════════════════════════════════════════════════════════
     BLOQUE 8 · INSTALACIÓN + AUTOTEST
     ═════════════════════════════════════════════════════════════════════════ */

  function instalar() {
    injectCSS();

    var errores = [];
    var avisos  = [];

    /* ── Dependencias que deben existir en coach-ai.html ── */
    if (typeof window.resolveDrill !== 'function')
      errores.push('resolveDrill() no existe — el archivo se está cargando antes del script principal');
    if (typeof window.DRILLS_CATALOG === 'undefined')
      errores.push('DRILLS_CATALOG no existe — ¿estás en coach-ai.html?');
    if (typeof window.renderResults !== 'function')
      errores.push('renderResults() original no encontrada');
    if (typeof window.analyzeSwing !== 'function')
      errores.push('analyzeSwing() original no encontrada');
    if (typeof window.catalogForPrompt !== 'function')
      errores.push('catalogForPrompt() no encontrada');

    /* ── Reemplazo de funciones ── */
    if (!errores.length) {
      window.renderResults = renderResultsPatched;
      window.analyzeSwing  = analyzeSwingPatched;
    }

    /* ── Test 1: validación directa ── */
    var t1 = normalizeFinding({
      titulo: 'Cara abierta al impacto',
      componente: 'cara', pilar: 'WC', error_tag: 'slice', severidad: 'alta',
      que_pasa: 'x', como_corregirlo: 'y', frame_referencia: 5,
      drills_recomendados: ['cara-01']
    });
    var ok1 = !!(t1 && t1.componente === 'cara' && t1.pilar === 'WC' &&
                 t1.error_tag === 'slice' && t1.severidad === 'alta' && t1.frame_ref === 5);
    if (!ok1) errores.push('Test 1 (validación directa) falló');

    /* ── Test 2: rescate desde el drill ── */
    var t2 = normalizeFinding({
      titulo: 'Algo raro', componente: 'inventado', pilar: 'XX', error_tag: 'nada',
      drills_recomendados: ['cara-01']
    });
    var ok2 = !!(t2 && t2.componente === 'cara');
    if (!ok2) errores.push('Test 2 (rescate desde drill) falló');

    /* ── Test 3: descarte de basura ── */
    var t3 = normalizeFinding({ titulo: 'Sin nada', componente: 'zzz', drills_recomendados: ['no-existe'] });
    var ok3 = (t3 === null);
    if (!ok3) errores.push('Test 3 (descarte) falló');

    /* ── Test 4: taxonomía completa ── */
    var ok4 = MGL_TAX.componentes.length === 8 && MGL_TAX.pilares.length === 4 &&
              MGL_TAX.errores.length === 10;
    if (!ok4) errores.push('Test 4 (taxonomía) falló');

    /* ── Test 5: el prompt incluye la taxonomía ── */
    var ok5 = false;
    try {
      var p = buildPromptText('');
      ok5 = p.indexOf('TAXONOMÍA OBLIGATORIA') > -1 &&
            p.indexOf('"componente"') > -1 &&
            p.indexOf('error_tag') > -1;
    } catch (e) { }
    if (!ok5) avisos.push('No se pudo verificar el prompt (revisa que DRILLS_CATALOG esté cargado)');

    /* ── Reporte ── */
    var linea = '════════════════════════════════════════════';
    if (errores.length === 0) {
      console.log('%c' + linea, 'color:#2dd4bf');
      console.log('%c  MyGolfLab · FASE A v' + VERSION + ' — INSTALADA CORRECTAMENTE',
                  'color:#2dd4bf;font-weight:bold;font-size:13px');
      console.log('%c' + linea, 'color:#2dd4bf');
      console.log('%c  ✅ Taxonomía cargada (8 componentes · 4 pilares · 10 errores)', 'color:#10b981');
      console.log('%c  ✅ normalizeFinding() disponible',                                'color:#10b981');
      console.log('%c  ✅ renderResults() reemplazada',                                  'color:#10b981');
      console.log('%c  ✅ analyzeSwing() reemplazada',                                   'color:#10b981');
      console.log('%c  ✅ Prompt con taxonomía activo',                                  'color:#10b981');
      console.log('%c  ✅ 4 de 4 tests internos pasaron',                                'color:#10b981');
      avisos.forEach(function (a) { console.warn('  ⚠️ ' + a); });
      console.log('%c' + linea, 'color:#2dd4bf');
      console.log('%c  Ya puedes analizar un swing. Deja esta consola abierta.',
                  'color:#8a8a8a');
      window.MGL_FASE_A_OK = true;
    } else {
      console.log('%c' + linea, 'color:#ef4444');
      console.log('%c  MyGolfLab · FASE A — NO SE PUDO INSTALAR',
                  'color:#ef4444;font-weight:bold;font-size:13px');
      console.log('%c' + linea, 'color:#ef4444');
      errores.forEach(function (e) { console.error('  ❌ ' + e); });
      console.log('%c' + linea, 'color:#ef4444');
      console.log('%c  Copia TODO este bloque rojo y envíalo para diagnóstico.', 'color:#ef4444');
      window.MGL_FASE_A_OK = false;
    }
  }

  /* Espera a que el documento esté listo (por si el script se carga en el head) */
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', instalar);
  } else {
    instalar();
  }

  /* Expuesto por si hace falta reinstalar manualmente desde la consola */
  window.MGL_REINSTALAR = instalar;

})();
