/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Idiomas (español / inglés / portugués)
   Archivo: /js/mgl-i18n.js
   Versión: 1.0 · 2026-11-09

   El código de CoachYard sigue escrito en español. Cuando el idioma elegido
   es inglés, este script traduce lo que se ve en pantalla usando el
   diccionario /js/i18n/en.js (texto en español → texto en inglés):
     · textos de la página y los que se agregan después (MutationObserver)
     · placeholder, title, aria-label y alt
     · alert / confirm / prompt
     · fechas (toLocaleDateString con 'es-CL' pasa a inglés)
   No toca lo que escribe la gente (descripciones, notas, mensajes): solo se
   traduce un texto si calza con una frase del diccionario.
   Para que algo no se traduzca nunca: class="notranslate" o translate="no".

   Preferencia en localStorage 'mgl-idioma': 'es' | 'en' | 'pt'. Sin preferencia,
   se usa el idioma del teléfono o computador (inglés → en, portugués → pt,
   resto → es). Diccionarios: /js/i18n/en.js y /js/i18n/pt.js.
   API: MGLi18n.lang, MGLi18n.set('en'), MGLi18n.t('Texto en español')
   Va en el <head>, justo después de mgl-tema.js. Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLi18n) return;
  var KEY = 'mgl-idioma';
  var IDIOMAS = { es: 1, en: 1, pt: 1 };

  function detectar() {
    var v = null;
    try { v = localStorage.getItem(KEY); } catch (e) {}
    if (v && IDIOMAS[v]) return v;
    var nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'es';
    return /^en/i.test(nav) ? 'en' : /^pt/i.test(nav) ? 'pt' : 'es';
  }
  var lang = detectar();

  function set(v) {
    if (!IDIOMAS[v]) return;
    try { localStorage.setItem(KEY, v); } catch (e) {}
    // Dentro del marco de la app se recargan todas las pestañas
    try { if (window.MGL_EN_MARCO && window.parent !== window) { window.parent.location.reload(); return; } } catch (e) {}
    location.reload();
  }

  var api = { lang: lang, set: set, t: function (s) { return s; }, idiomas: ['es', 'en', 'pt'] };
  window.MGLi18n = api;
  document.documentElement.setAttribute('lang', lang);

  // Selector chico para páginas públicas: <span data-mgl-idioma></span>
  document.addEventListener('DOMContentLoaded', function () {
    var els = document.querySelectorAll('[data-mgl-idioma]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      el.classList.add('notranslate');
      el.innerHTML = '';
      [['es', 'Español'], ['en', 'English'], ['pt', 'Português']].forEach(function (o, j) {
        if (j) el.appendChild(document.createTextNode(' · '));
        var a = document.createElement('a');
        a.href = '#'; a.textContent = o[1];
        a.style.cssText = 'color:inherit;text-decoration:none;' + (o[0] === lang ? 'font-weight:700;opacity:1' : 'opacity:.6');
        a.addEventListener('click', function (e) { e.preventDefault(); if (o[0] !== lang) set(o[0]); });
        el.appendChild(a);
      });
    }
  });
  if (lang === 'es') return;

  // ── Diccionario ─────────────────────────────────────────────────────────
  // Se carga de forma síncrona para que la página no parpadee en español.
  var VAR = 'MGL_I18N_' + lang.toUpperCase();
  if (!window[VAR]) {
    document.write('<script src="/js/i18n/' + lang + '.js?v=1"><\/script>');
  }
  var D = null, LARGAS = null;
  function dic() {
    if (D) return D;
    D = window[VAR] || {};
    // Frases largas para reemplazo dentro de un texto (ej. "Buenas tardes, Nicolás")
    LARGAS = [];
    for (var k in D) if (k.length >= 10) LARGAS.push(k);
    LARGAS.sort(function (a, b) { return b.length - a.length; });
    return D;
  }

  // ── Reglas con partes variables ─────────────────────────────────────────
  var EN = lang === 'en';
  var MES = EN
    ? { ene: 'Jan', feb: 'Feb', mar: 'Mar', abr: 'Apr', may: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', sep: 'Sep', sept: 'Sep', oct: 'Oct', nov: 'Nov', dic: 'Dec' }
    : { ene: 'jan', feb: 'fev', mar: 'mar', abr: 'abr', may: 'mai', jun: 'jun', jul: 'jul', ago: 'ago', sep: 'set', sept: 'set', oct: 'out', nov: 'nov', dic: 'dez' };
  var MESL = EN
    ? { enero: 'January', febrero: 'February', marzo: 'March', abril: 'April', mayo: 'May', junio: 'June', julio: 'July', agosto: 'August', septiembre: 'September', setiembre: 'September', octubre: 'October', noviembre: 'November', diciembre: 'December' }
    : { enero: 'janeiro', febrero: 'fevereiro', marzo: 'março', abril: 'abril', mayo: 'maio', junio: 'junho', julio: 'julho', agosto: 'agosto', septiembre: 'setembro', setiembre: 'setembro', octubre: 'outubro', noviembre: 'novembro', diciembre: 'dezembro' };
  var DIA = EN
    ? { lun: 'Mon', mar: 'Tue', 'mié': 'Wed', mie: 'Wed', jue: 'Thu', vie: 'Fri', 'sáb': 'Sat', sab: 'Sat', dom: 'Sun' }
    : { lun: 'seg', mar: 'ter', 'mié': 'qua', mie: 'qua', jue: 'qui', vie: 'sex', 'sáb': 'sáb', sab: 'sáb', dom: 'dom' };
  var DIAL = EN
    ? { lunes: 'Monday', martes: 'Tuesday', 'miércoles': 'Wednesday', jueves: 'Thursday', viernes: 'Friday', 'sábado': 'Saturday', domingo: 'Sunday' }
    : { lunes: 'segunda-feira', martes: 'terça-feira', 'miércoles': 'quarta-feira', jueves: 'quinta-feira', viernes: 'sexta-feira', 'sábado': 'sábado', domingo: 'domingo' };
  // Palabras y frases cortas de las reglas: [singular, plural]
  var W = EN ? {
    alumno: ['student', 'students'], jugador: ['player', 'players'], evento: ['event', 'events'], video: ['video', 'videos'], foto: ['photo', 'photos'], clase: ['lesson', 'lessons'], dia: ['day', 'days'], nota: ['note', 'notes'], mensaje: ['message', 'messages'], meta: ['goal', 'goals'], tarea: ['task', 'tasks'], coleccion: ['collection', 'collections'], coach: ['coach', 'coaches'], analisis: ['analysis', 'analyses'], semana: ['week', 'weeks'], mes: ['month', 'months'], hora: ['hour', 'hours'], minuto: ['minute', 'minutes'], archivo: ['file', 'files'], resena: ['review', 'reviews'], venta: ['sale', 'sales'], compra: ['purchase', 'purchases'], hoyo: ['hole', 'holes'], golpe: ['shot', 'shots'], tip: ['tip', 'tips'], ano: ['year', 'years'],
    hace: '{n} {u} ago', de: '{a} of {b}', sinLeer: '{n} unread', enHub: '{n} {u} in your CoachYard', faltan: '{n} more {u} to drop to {x}', notas: 'Notes ({n})', esteMes: '{x} this month', hoy: '{x} today', pend: '{n} pending', nuevas: '{n} new', entrenando: '{n} {u} training'
  } : {
    alumno: ['aluno', 'alunos'], jugador: ['jogador', 'jogadores'], evento: ['evento', 'eventos'], video: ['vídeo', 'vídeos'], foto: ['foto', 'fotos'], clase: ['aula', 'aulas'], dia: ['dia', 'dias'], nota: ['nota', 'notas'], mensaje: ['mensagem', 'mensagens'], meta: ['meta', 'metas'], tarea: ['tarefa', 'tarefas'], coleccion: ['coleção', 'coleções'], coach: ['coach', 'coaches'], analisis: ['análise', 'análises'], semana: ['semana', 'semanas'], mes: ['mês', 'meses'], hora: ['hora', 'horas'], minuto: ['minuto', 'minutos'], archivo: ['arquivo', 'arquivos'], resena: ['avaliação', 'avaliações'], venta: ['venda', 'vendas'], compra: ['compra', 'compras'], hoyo: ['buraco', 'buracos'], golpe: ['tacada', 'tacadas'], tip: ['dica', 'dicas'], ano: ['ano', 'anos'],
    hace: 'há {n} {u}', de: '{a} de {b}', sinLeer: '{n} não lidas', enHub: '{n} {u} no seu CoachYard', faltan: 'Faltam {n} {u} para baixar para {x}', notas: 'Notas ({n})', esteMes: '{x} este mês', hoy: '{x} hoje', pend: '{n} pendentes', nuevas: '{n} novas', entrenando: '{n} {u} treinando'
  };
  function fmt(t, o) { return t.replace(/\{(\w)\}/g, function (_, k) { return o[k]; }); }
  function pal(clave, n) { var w = W[clave]; return w ? (+n === 1 ? w[0] : w[1]) : null; }
  function sinTilde(s) { return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s; }
  var REGLAS = [];
  function regla(re, fn) { REGLAS.push([re, fn]); }
  // Fechas
  regla(/^(\d{1,2})\s+(ene|feb|mar|abr|may|jun|jul|ago|sept?|oct|nov|dic)\.?(?:\s+(\d{4}))?$/i, function (m) {
    var mm = MES[m[2].toLowerCase()];
    return EN ? mm + ' ' + m[1] + (m[3] ? ', ' + m[3] : '') : m[1] + ' ' + mm + (m[3] ? ' ' + m[3] : '');
  });
  regla(/^(\d{1,2})\s+de\s+([a-zé]+)(?:\s+de\s+(\d{4}))?$/i, function (m) {
    var mm = MESL[m[2].toLowerCase()]; if (!mm) return null;
    return EN ? mm + ' ' + m[1] + (m[3] ? ', ' + m[3] : '') : m[1] + ' de ' + mm + (m[3] ? ' de ' + m[3] : '');
  });
  regla(/^([a-záéíóú]+),?\s+(\d{1,2})\s+de\s+([a-zé]+)(?:\s+de\s+(\d{4}))?$/i, function (m) {
    var d = DIAL[m[1].toLowerCase()], mm = MESL[m[3].toLowerCase()]; if (!d || !mm) return null;
    return EN ? d + ', ' + mm + ' ' + m[2] + (m[4] ? ', ' + m[4] : '') : d + ', ' + m[2] + ' de ' + mm + (m[4] ? ' de ' + m[4] : '');
  });
  regla(/^([a-zé]+)(?:\s+de)?\s+(\d{4})$/i, function (m) {
    var mm = MESL[m[1].toLowerCase()]; return mm ? (EN ? mm + ' ' + m[2] : mm + ' de ' + m[2]) : null;
  });
  regla(/^(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)$/i, function (m) { var x = MESL[m[1].toLowerCase()]; return m[1].charAt(0) === m[1].charAt(0).toUpperCase() ? x.charAt(0).toUpperCase() + x.slice(1) : x; });
  regla(/^(lun|mar|mié|mie|jue|vie|sáb|sab|dom)\.?$/i, function (m) { return DIA[m[1].toLowerCase()]; });
  regla(/^(lunes|martes|miércoles|jueves|viernes|sábado|domingo)$/i, function (m) { return DIAL[m[1].toLowerCase()]; });
  regla(/^(lun|mar|mié|mie|jue|vie|sáb|sab|dom)\.?\s+(\d{1,2})$/i, function (m) { return DIA[m[1].toLowerCase()] + ' ' + m[2]; });
  // Tiempos relativos y cantidades
  regla(/^hace\s+(\d+)\s+(min|minutos?|h|horas?|d|días?|semanas?|mes(?:es)?|años?)$/i, function (m) {
    var n = +m[1], u = m[2].toLowerCase();
    var U = /^min/.test(u) ? 'min' : u === 'h' ? 'h' : u === 'd' ? 'd' : /^h/.test(u) ? pal('hora', n) : /^d/.test(u) ? pal('dia', n) : /^sem/.test(u) ? pal('semana', n) : /^mes/.test(u) ? pal('mes', n) : pal('ano', n);
    return fmt(W.hace, { n: n, u: U });
  });
  regla(/^(\d+)\s+(alumnos?|jugadores?|eventos?|videos?|fotos?|clases?|días?|notas?|mensajes?|metas?|tareas?|colecciones?|coaches|coach|análisis|semanas?|meses|mes|horas?|minutos?|archivos?|reseñas?|ventas?|compras?|hoyos?|golpes?|tips?)$/i, function (m) {
    var n = +m[1], w = sinTilde(m[2].toLowerCase()).replace('ñ', 'n');
    var k = W[w] ? w : W[w.replace(/es$/, '')] ? w.replace(/es$/, '') : W[w.replace(/s$/, '')] ? w.replace(/s$/, '') : (w === 'colecciones' ? 'coleccion' : w === 'coaches' ? 'coach' : w === 'meses' ? 'mes' : w === 'resenas' ? 'resena' : null);
    if (!k || !W[k] || typeof W[k] === 'string') return null;
    return n + ' ' + pal(k, n);
  });
  regla(/^(\d+)\s+de\s+(\d+)$/, function (m) { return fmt(W.de, { a: m[1], b: m[2] }); });
  regla(/^(\d+)\s+sin leer$/i, function (m) { return fmt(W.sinLeer, { n: m[1] }); });
  regla(/^(\d+)\s+alumnos?\s+en tu CoachYard$/i, function (m) { return fmt(W.enHub, { n: m[1], u: pal('alumno', m[1]) }); });
  regla(/^Te faltan\s+(\d+)\s+clases?\s+para bajar a\s+(.+)$/i, function (m) { return fmt(W.faltan, { n: m[1], u: pal('clase', m[1]), x: m[2] }); });
  regla(/^Notas\s*\((\d+)\)$/i, function (m) { return fmt(W.notas, { n: m[1] }); });
  regla(/^(.+)\s+este mes$/i, function (m) { return /^[+\-\d]/.test(m[1]) ? fmt(W.esteMes, { x: m[1] }) : null; });
  regla(/^(.+)\s+hoy$/i, function (m) { return /^[+\-\d]/.test(m[1]) ? fmt(W.hoy, { x: m[1] }) : null; });
  regla(/^(\d+)\s+pendientes?$/i, function (m) { return fmt(W.pend, { n: m[1] }); });
  regla(/^(\d+)\s+nuevas?$/i, function (m) { return fmt(W.nuevas, { n: m[1] }); });
  regla(/^(\d+)\s+(días?|d)\s+entrenando$/i, function (m) { return fmt(W.entrenando, { n: m[1], u: pal('dia', m[1]) }); });

  function regl(s) {
    for (var i = 0; i < REGLAS.length; i++) {
      var m = s.match(REGLAS[i][0]);
      if (m) { var r = REGLAS[i][1](m); if (r != null) return r; }
    }
    return null;
  }

  // ── Traducción de un texto ──────────────────────────────────────────────
  function tr(raw) {
    if (!raw) return raw;
    var s = raw.replace(/\s+/g, ' ').trim();
    if (!s || !/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(s)) return raw;
    var d = dic();
    var out = null;
    if (Object.prototype.hasOwnProperty.call(d, s)) out = d[s];
    if (out == null) out = regl(s);
    if (out == null && s.indexOf(' · ') > 0) {
      // "Nuevo · España" → cada parte por separado
      var partes = s.split(' · '), alguna = false;
      for (var p = 0; p < partes.length; p++) { var tp = tr(partes[p]); if (tp !== partes[p]) { partes[p] = tp; alguna = true; } }
      if (alguna) out = partes.join(' · ');
    }
    if (out == null) {
      // "Algo:" + detalle  → traducir el prefijo y/o el detalle
      var m = s.match(/^(.{2,}?[:?!.…]) (.+)$/);
      if (m) {
        var a = Object.prototype.hasOwnProperty.call(d, m[1]) ? d[m[1]] : null;
        var b = tr(m[2]);
        if (a != null || b !== m[2]) out = (a != null ? a : m[1]) + ' ' + b;
      }
    }
    if (out == null && s.length < 300) {
      // Frases conocidas dentro de un texto más largo
      var x = s, cambio = false;
      for (var i = 0; i < LARGAS.length; i++) {
        var k = LARGAS[i];
        if (x.indexOf(k) !== -1) { x = x.split(k).join(d[k]); cambio = true; }
      }
      if (cambio) {
        // meses sueltos que quedaron en la frase ("Clases pagadas en noviembre")
        x = x.replace(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/gi, function (mm) { return MESL[mm.toLowerCase()]; });
        out = x;
      }
    }
    if (out == null) return raw;
    // Conservar espacios de los bordes
    var pre = raw.match(/^\s*/)[0], post = raw.match(/\s*$/)[0];
    return pre + out + post;
  }
  api.t = function (s) { return tr(s); };

  // ── Recorrer el DOM ─────────────────────────────────────────────────────
  var HECHO = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var SALTAR = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 0, SVG: 0 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function saltar(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentNode) {
      if (SALTAR[e.nodeName] === 1) return true;
      if (e.getAttribute('translate') === 'no') return true;
      if (e.classList && e.classList.contains('notranslate')) return true;
      if (e.isContentEditable) return true;
    }
    return false;
  }
  function texto(n) {
    if (HECHO && HECHO.get(n) === n.nodeValue) return;
    if (!n.parentNode || saltar(n.parentNode)) return;
    var v = n.nodeValue, t = tr(v);
    if (t !== v) n.nodeValue = t;
    if (HECHO) HECHO.set(n, n.nodeValue);
  }
  function atributos(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
    if (el.nodeName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
      var tv = tr(el.value); if (tv !== el.value) el.value = tv;
    }
    if (el.nodeName === 'OPTGROUP' && el.label) { var tl = tr(el.label); if (tl !== el.label) el.label = tl; }
  }
  function arbol(root) {
    if (!root) return;
    if (root.nodeType === 3) { texto(root); return; }
    if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
    if (root.nodeType === 1) {
      if (root.nodeName === 'TEXTAREA' && !saltar(root.parentNode)) { atributos(root); return; }
      if (saltar(root)) return;
      atributos(root);
    }
    var w = document.createTreeWalker(root, 5 /* ELEMENT | TEXT */, null, false), n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) texto(n);
      else if (SALTAR[n.nodeName] !== 1 || n.nodeName === 'TEXTAREA') atributos(n);
    }
  }
  var pendientes = [], programado = false;
  function procesar() {
    programado = false;
    var lista = pendientes; pendientes = [];
    for (var i = 0; i < lista.length; i++) arbol(lista[i]);
  }
  var obs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === 'childList') { for (var j = 0; j < m.addedNodes.length; j++) pendientes.push(m.addedNodes[j]); }
      else if (m.type === 'characterData') pendientes.push(m.target);
      else if (m.type === 'attributes') atributos(m.target);
    }
    // Se procesa en el mismo ciclo: antes de que el navegador pinte
    procesar();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener('DOMContentLoaded', function () {
    arbol(document.body);
    if (document.title) document.title = tr(document.title);
  });
  // El título cambia a veces por JS
  try {
    var td = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    if (td && td.set) Object.defineProperty(document, 'title', { configurable: true, get: function () { return td.get.call(document); }, set: function (v) { td.set.call(document, tr(v)); } });
  } catch (e) {}

  // ── Diálogos ────────────────────────────────────────────────────────────
  var _alert = window.alert, _confirm = window.confirm, _prompt = window.prompt;
  window.alert = function (m) { return _alert.call(window, tr(String(m == null ? '' : m))); };
  window.confirm = function (m) { return _confirm.call(window, tr(String(m == null ? '' : m))); };
  window.prompt = function (m, d) { return _prompt.call(window, tr(String(m == null ? '' : m)), d); };

  // ── Fechas: los formatos en español pasan a inglés ──────────────────────
  var LOC = EN ? 'en-US' : 'pt-BR';
  function loc(l) { return (typeof l === 'string' && /^es/i.test(l)) || l == null ? LOC : l; }
  ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach(function (fn) {
    var orig = Date.prototype[fn];
    Date.prototype[fn] = function (l, o) { return orig.call(this, loc(l), o); };
  });
  try {
    var DTF = Intl.DateTimeFormat;
    var NDTF = function (l, o) { return new DTF(loc(l), o); };
    NDTF.prototype = DTF.prototype; NDTF.supportedLocalesOf = DTF.supportedLocalesOf;
    Intl.DateTimeFormat = NDTF;
    var RTF = Intl.RelativeTimeFormat;
    if (RTF) { var NR = function (l, o) { return new RTF(loc(l), o); }; NR.prototype = RTF.prototype; Intl.RelativeTimeFormat = NR; }
  } catch (e) {}
})();
