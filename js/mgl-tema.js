/* ═══════════════════════════════════════════════════════════════════════════
   Coach Hub · Tema claro / oscuro
   Archivo: /js/mgl-tema.js
   Versión: 1.0 · 2026-11-09

   Cada color del tema oscuro está escrito en el CSS como
     var(--c0a0a0a,#0a0a0a)      o      rgba(var(--r255_255_255,255,255,255),.1)
   Sin este script (o en modo oscuro) se usa el valor de respaldo, que es el
   color oscuro original. En modo claro este script define esas variables con
   la paleta clara.

   Preferencia guardada en localStorage 'mgl-tema': 'oscuro' | 'claro' | 'auto'
   (por defecto 'oscuro'). API: MGLTema.get(), MGLTema.set(valor), MGLTema.efectivo()
   Va en el <head>, antes de cualquier CSS de la página, para que no parpadee.
   Sin template literals a propósito.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLTema) return;
  var KEY = 'mgl-tema';
  var TOKENS = '--c0a0a0a:#f6f4ef;--c0b0b0b:#f6f4ef;--c0c0c0c:#f6f4ef;--c111111:#ffffff;--c121212:#ffffff;--c141414:#ffffff;--c161616:#ffffff;--c1a1a1a:#f4f1ea;--c1c1c1c:#f4f1ea;--c1d1d1d:#f4f1ea;--c222222:#e7e2d8;--c262626:#e4dfd4;--c2a2a2a:#d9d3c6;--c2c2c2c:#d9d3c6;--c333333:#d4cdbf;--c3a3a3a:#cbc4b5;--c666666:#8d877b;--c737373:#857f73;--c777777:#7f7a6e;--c888888:#6c675d;--c8a8a8a:#6c675d;--ca3a3a3:#5c574e;--caaaaaa:#5c574e;--cbbbbbb:#4f4b43;--ccfcfcf:#3b3832;--cd0d0d0:#3b3832;--cd6d6d6:#36332d;--cdddddd:#302d28;--ce6e6e6:#26241f;--ce8e8e8:#26241f;--ce9e9e9:#26241f;--ceeeeee:#211f1b;--cf5f5f5:#17150f;--cd4c5a9:#94794a;--c7d7259:#cbbb97;--cf0b860:#b07818;--c2b2619:#f1e8d3;--c16150f:#f3ecdc;--c2a2518:#f1e8d3;--ce9cf9f:#8a6a2c;--cb9a982:#8c7650;--ce8dcc2:#6f5c37;--cf5e7c4:#6f5c37;--cfff6dc:#5e4b22;--ce0a54a:#a86d14;--ce06a6a:#c64242;--ce0a15b:#b3701f;--c8fd19e:#2c8546;--ca98fd4:#7556b4;--c8fb8e0:#3b73aa;--cffb3b3:#b23434;--cffc0c0:#b23434;--cf0a0a0:#b23434;--cf0b4b4:#b23434;--cfca5a5:#b23434;--c08090a:#f6f4ef;--c101214:#ffffff;--c16191c:#f4f1ea;--c121417:#ffffff;--c0f0f0f:#ffffff;--cf0f0f0:#17150f;--cf2f3f2:#17150f;--cc4c8c6:#3b3832;--c7d827f:#6c675d;--c565b58:#8d877b;--c2e2e2e:#d9d3c6;--c555555:#8d877b;--c999999:#6c675d;--c6e6e6e:#7f7a6e;--c4ee6d3:#0b8072;--c4ee0cf:#0b8072;--c4eecd9:#0b8072;--c5eead4:#0d9484;--c99f6e4:#0b6b60;--c14b8a6:#0d8a7c;--c0d9488:#0b7a6e;--c0d1f1e:#e3f4ef;--c0a1a19:#e3f4ef;--c04210e:#e4f4e8;--c4ade80:#1f8a45;--cfbbf24:#b7860b;--cf87171:#c64242;--ca78bfa:#6d4fc4;--cfb923c:#c2621a;--c171010:#fbeeee;--c151515:#ece7dd;--c1d3a35:#e9e2d2;--ccfe9d4:#266b38;--c2a1414:#fbe8e8;--c06251f:#e2f3ee;--c2dd4bf:#0d9484;--r255_255_255:30,26,16;--r10_10_10:246,244,239;--r8_8_8:246,244,239;--r12_12_12:246,244,239;--r17_17_17:255,255,255;--r8_9_10:246,244,239;--r16_18_20:255,255,255;--r74_222_128:31,138,69;--r248_113_113:198,66,66;--r167_139_250:109,79,196;--r251_191_36:183,134,11;--r20_20_20:255,255,255;--r212_197_169:148,121,74;--r240_184_96:176,120,24;--r224_106_106:198,66,66;--r224_161_91:179,112,31;--r143_209_158:44,133,70;--r143_184_224:59,115,170;--r45_212_191:13,148,132;--r240_180_180:178,52,52;--ctexto:#17150f;--c2a1111:#fbe8e8';
  var css = 'html[data-theme="light"]{color-scheme:light;' + TOKENS + '}'
    // Detalles que no salen de la paleta
    + 'html[data-theme="light"] .act.primary,html[data-theme="light"] .card.primary{box-shadow:0 1px 0 rgba(0,0,0,.02)}'
    + 'html[data-theme="light"] img.logo-claro-inv{filter:invert(1)}'
    // Botón central Analizar del menú inferior: aro dorado sobre fondo claro
    + 'html[data-theme="light"] .mgl-tabs a.fab .ic{background:radial-gradient(circle at 35% 28%,#ffffff,#efe8d9 75%);'
    +   'box-shadow:0 0 0 5px #f6f4ef,0 8px 18px rgba(80,60,20,.22),0 0 14px rgba(148,121,74,.25),inset 0 2px 2px rgba(255,255,255,.8)}'
    // Esfera de Caddie: se mantiene oscura, con sombra más suave
    + 'html[data-theme="light"] .mgl-orb{box-shadow:0 8px 20px rgba(60,45,15,.28),0 0 18px rgba(212,197,169,.35),inset 0 2px 3px rgba(255,255,255,.12)}'
    // Analizador: el escenario del video sigue negro; su texto queda claro
    + 'html[data-theme="light"] .stagewrap .placeholder{color:#a3a3a3}html[data-theme="light"] .stagewrap .placeholder h2{color:#f5f5f5}'
    // Botón de Apple: negro sobre fondo claro
    + 'html[data-theme="light"] .btn-apple{background:#000;border-color:#000;color:#fff}';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function get() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    return (v === 'claro' || v === 'auto') ? v : 'oscuro';
  }
  function efectivo() {
    var v = get();
    if (v === 'auto') return (mq && mq.matches) ? 'claro' : 'oscuro';
    return v;
  }
  function statusBar(claro) {
    try {
      var SB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StatusBar;
      if (SB && SB.setStyle) SB.setStyle({ style: claro ? 'LIGHT' : 'DARK' });
    } catch (e) {}
  }
  function aplicar() {
    var claro = efectivo() === 'claro';
    var html = document.documentElement;
    if (claro) html.setAttribute('data-theme', 'light'); else html.removeAttribute('data-theme');
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', claro ? '#f6f4ef' : '#0a0a0a');
    statusBar(claro);
    try { window.dispatchEvent(new CustomEvent('mgl-tema', { detail: { tema: claro ? 'claro' : 'oscuro' } })); } catch (e) {}
  }
  function set(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
    aplicar();
  }

  var st = document.createElement('style');
  st.id = 'mgl-tema-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
  aplicar();
  // Las metas theme-color aparecen después en el <head>: repetir al cargar
  document.addEventListener('DOMContentLoaded', aplicar);
  if (mq) {
    var onChange = function () { if (get() === 'auto') aplicar(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
  // Si cambia en otra pestaña
  window.addEventListener('storage', function (e) { if (e.key === KEY) aplicar(); });

  window.MGLTema = { get: get, set: set, efectivo: efectivo, aplicar: aplicar };
})();
