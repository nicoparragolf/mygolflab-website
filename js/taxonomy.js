/* ══════════════════════════════════════════════════════════════
   /js/taxonomy.js — MyGolfLab
   Fuente única de verdad de las taxonomías del swing.
   Lo usan: coach-ai.html, library.html y dashboard.html
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  window.MGL_TAX = {

    /* ─── Listas cerradas: la IA solo puede usar estos valores ─── */
    componentes: ['cara', 'path', 'lowpoint', 'secuencia',
                  'postura', 'ground', 'conexion', 'distancia'],

    pilares: ['GF', 'KS', 'WC', 'BT'],

    errores: ['slice', 'hook', 'top', 'gordo', 'shank',
              'push', 'pull', 'potencia', 'distancia', 'spin'],

    severidades: ['alta', 'media', 'baja'],

    /* ─── Nombres bonitos para mostrar en pantalla ─── */
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
      slice: 'Slice', hook: 'Hook', top: 'Top', gordo: 'Gordo',
      shank: 'Shank', push: 'Push', pull: 'Pull',
      potencia: 'Pérdida de potencia',
      distancia: 'Control de distancia',
      spin: 'Spin en wedges'
    },

    /* ─── Colores. Ninguno choca con el rojo de severidad alta ─── */
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

    /* ─── Validadores ─── */
    esComponente: function (v) { return this.componentes.indexOf(v) >= 0; },
    esPilar:      function (v) { return this.pilares.indexOf(v)     >= 0; },
    esError:      function (v) { return this.errores.indexOf(v)     >= 0; },
    esSeveridad:  function (v) { return this.severidades.indexOf(v) >= 0; }
  };

  console.log('✅ MGL_TAX cargada —',
              window.MGL_TAX.componentes.length, 'componentes,',
              window.MGL_TAX.pilares.length, 'pilares');
})();
