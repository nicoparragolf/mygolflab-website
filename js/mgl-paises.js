/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Lista de países del mundo
   Archivo: /js/mgl-paises.js
   Versión: 1.0 · 2026-11-02

   Se guarda el código ISO de 2 letras (CL, AR, US…) y el nombre se muestra
   en el idioma de la página (<html lang="es"> → "Chile", lang="en" → "Chile",
   "Spain" / "España"…), así la versión en inglés no requiere cambiar datos.

   Uso:
     select.innerHTML = MGL_PAISES.opciones('CL');   // <option>… ordenadas
     MGL_PAISES.nombre('ES')                          // "España"
     MGL_PAISES.codigo('México')                      // "MX" (datos antiguos)

   Sin template literals a propósito (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var CODES = 'AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

  function lang() {
    return ((document.documentElement && document.documentElement.lang) || 'es').slice(0, 2);
  }
  var cache = {};
  function nombre(code, lg) {
    if (!code) return '';
    code = String(code);
    if (code.length !== 2) return code;              // dato antiguo guardado como nombre
    code = code.toUpperCase();
    lg = lg || lang();
    var k = lg + ':' + code;
    if (cache[k]) return cache[k];
    var n = code;
    try { n = new Intl.DisplayNames([lg], { type: 'region' }).of(code) || code; } catch (e) {}
    cache[k] = n;
    return n;
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  }
  // Convierte un valor antiguo ("Chile", "México", "Spain"…) a su código
  function codigo(valor) {
    if (!valor) return '';
    var v = String(valor).trim();
    if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
    var nv = norm(v);
    var langs = ['es', 'en', 'pt'];
    for (var i = 0; i < CODES.length; i++) {
      for (var j = 0; j < langs.length; j++) {
        if (norm(nombre(CODES[i], langs[j])) === nv) return CODES[i];
      }
    }
    return '';
  }
  function lista(lg) {
    lg = lg || lang();
    return CODES.map(function (c) { return { code: c, name: nombre(c, lg) }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, lg); });
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
  function opciones(seleccionado, lg) {
    var sel = codigo(seleccionado) || '';
    return lista(lg).map(function (p) {
      return '<option value="' + p.code + '"' + (p.code === sel ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
  }

  window.MGL_PAISES = { codes: CODES, nombre: nombre, codigo: codigo, lista: lista, opciones: opciones };
})();
