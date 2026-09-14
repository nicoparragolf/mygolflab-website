/* ============================================================
   MyGolfLab Coach Hub · Rondas y Strokes Gained
   ------------------------------------------------------------
   Este archivo es independiente a propósito: el baseline de SG
   se va a ir ajustando con el tiempo (la idea es reemplazarlo
   por tablas propias de LatAm) y no queremos tocar jugador.html
   cada vez que eso pase.

   Se engancha leyendo los globales de jugador.html: sb, USER,
   SEL, COACH_ID, IS_COACH, toast, showError, errMsg, esc.

   API pública (window.MGLRondas):
     load(playerId)      → carga las rondas del jugador a memoria
     open(eventId)       → abre el modal de la ronda
     summaryHTML(evId)   → tarjeta resumen para el timeline
     del(roundId)        → elimina la ronda

   Sin template literals (el editor de GitHub los rompe).
   ============================================================ */
(function(){
'use strict';

// ============================================================
// BASELINE — golpes esperados para embocar, por lie y distancia
//
// IMPORTANTE: esto es una aproximación calibrada con los valores
// públicos de referencia del juego profesional, escrita como
// curva interpolada y NO como copia de una tabla. Sirve para
// comparar áreas entre sí y ver tendencias; no es equivalente al
// SG oficial del PGA Tour. Cuando tengamos suficientes rondas
// propias, estas listas se reemplazan y se recalculan las rondas
// guardadas (por eso cada una guarda su baseline_version).
//
// Distancias en METROS. Formato: [distancia, golpes esperados].
// ============================================================
var BASELINE_VERSION = 'mgl-sg-v1';

var BASE = {
  tee: [
    [120,2.88],[150,3.00],[180,3.14],[210,3.32],[240,3.50],[270,3.62],
    [300,3.74],[330,3.85],[366,3.99],[400,4.15],[440,4.45],[470,4.58],
    [500,4.70],[540,4.85]
  ],
  calle: [
    [5,2.10],[10,2.18],[20,2.40],[30,2.52],[40,2.58],[50,2.62],[60,2.66],
    [75,2.71],[90,2.76],[110,2.84],[125,2.89],[140,2.95],[160,3.03],
    [180,3.12],[200,3.22],[220,3.32],[240,3.42]
  ],
  rough: [
    [5,2.26],[10,2.34],[20,2.59],[30,2.70],[40,2.76],[50,2.81],[60,2.86],
    [75,2.92],[90,2.98],[110,3.06],[125,3.12],[140,3.18],[160,3.27],
    [180,3.36],[200,3.46],[220,3.57]
  ],
  bunker: [
    [5,2.45],[10,2.50],[20,2.60],[30,2.70],[40,2.80],[60,2.95],[80,3.06],
    [100,3.16],[130,3.30],[160,3.45],[190,3.62]
  ],
  recovery: [
    [10,3.00],[20,3.10],[50,3.25],[90,3.40],[130,3.55],[170,3.72],[210,3.90]
  ],
  green: [
    [0.3,1.00],[0.6,1.01],[0.9,1.05],[1.2,1.13],[1.5,1.24],[2,1.39],
    [2.5,1.52],[3,1.62],[4,1.73],[5,1.79],[6,1.85],[8,1.92],[10,1.98],
    [13,2.06],[16,2.13],[20,2.21],[25,2.30],[30,2.38]
  ]
};

// Factor de nivel: E_nivel = 1 + (E_referencia - 1) * k
// k = 1 es el nivel de referencia profesional. Más alto = más
// golpes esperados, o sea una vara acorde al jugador.
var K_CATEGORIA = {
  profesional:   1.00,
  elite_amateur: 1.05,
  college:       1.10,
  amateur:       1.20,
  senior:        1.22,
  junior:        1.26,
  iniciacion:    1.45
};
function kDe(cat){ return K_CATEGORIA[cat] != null ? K_CATEGORIA[cat] : 1.20; }

function interp(tabla, d){
  if(!tabla || !tabla.length) return 3;
  if(d <= tabla[0][0]) return tabla[0][1];
  var ult = tabla[tabla.length-1];
  if(d >= ult[0]) return ult[1];
  for(var i=0;i<tabla.length-1;i++){
    var a=tabla[i], b=tabla[i+1];
    if(d>=a[0] && d<=b[0]){
      var t=(d-a[0])/(b[0]-a[0]);
      return a[1] + t*(b[1]-a[1]);
    }
  }
  return ult[1];
}

// Golpes esperados para embocar desde (lie, distancia) según el nivel k.
function esperados(lie, d, k){
  if(d==null || d<=0) return 0;
  var tabla = BASE[lie] || BASE.calle;
  var base = interp(tabla, d);
  return 1 + (base-1) * (k||1);
}

// Categoría de un golpe, según desde dónde se pega.
function categoria(lie, d, par, esPrimero){
  if(lie==='green') return 'putt';
  if(lie==='tee' && par>3 && esPrimero) return 'salida';
  if(d<=30) return 'corto';
  return 'approach';
}

// ------------------------------------------------------------
// Cadena de golpes → SG por categoría.
// estados: [{lie, d, pen}] = el estado ANTES de cada golpe.
// putts y puttDist describen el bloque de putting al final.
// El cálculo telescopa, así que sg_total siempre cuadra con
// (golpes esperados desde el tee) − (golpes reales).
// ------------------------------------------------------------
function sgDeHoyo(estados, putts, puttDist, par, k){
  var out = {salida:0, approach:0, corto:0, putt:0, total:0};
  var n = estados.length;
  var i, pen = 0;

  for(i=0;i<n;i++){
    var e  = estados[i];
    var Ei = esperados(e.lie, e.d, k);
    var Ej;
    if(i < n-1) Ej = esperados(estados[i+1].lie, estados[i+1].d, k);
    else        Ej = (putts>0) ? esperados('green', puttDist, k) : 0;
    var p = e.pen||0;
    pen += p;
    var g = Ei - Ej - 1 - p;
    out[categoria(e.lie, e.d, par, i===0)] += g;
  }

  if(putts>0){
    out.putt += esperados('green', puttDist, k) - putts;
  }

  var golpes = n + pen + putts;
  out.total = (n ? esperados(estados[0].lie, estados[0].d, k) : 0) - golpes;
  return out;
}

// ============================================================
// RECONSTRUCCIÓN — de los datos hoyo a hoyo a una cadena de golpes
// ============================================================
var LARGO_DEFAULT = {3:155, 4:355, 5:470};
var LIE_TEE = {calle:'calle', rough:'rough', bunker:'bunker', recovery:'recovery', penal:'calle'};
var DIST_FALLO = {calle:16, rough:12, bunker:10, recovery:20};

function largoHoyo(h, defs){
  if(h.length_m) return Number(h.length_m);
  var d = defs && defs[h.par];
  return d ? Number(d) : (LARGO_DEFAULT[h.par] || 355);
}

function esGir(h){
  var score = Number(h.score||0), putts = Number(h.putts||0), par = Number(h.par||4);
  if(!score) return false;
  return (score - putts) <= (par - 2);
}

function reconstruir(h, defs){
  var par    = Number(h.par||4);
  var score  = Number(h.score||par);
  var putts  = Number(h.putts||0);
  var pen    = Number(h.penalties||0);
  var largo  = largoHoyo(h, defs);
  var gir    = esGir(h);
  var pPutt  = (h.first_putt_m!=null && h.first_putt_m!=='') ? Number(h.first_putt_m) : (putts>0?6:0);
  var aprox  = (h.approach_m!=null && h.approach_m!=='') ? Number(h.approach_m) : null;

  var estados = [];

  if(par===3){
    estados.push({lie:'tee', d:largo, pen:0});
  } else {
    var lieT = LIE_TEE[h.tee_result] || 'calle';
    var penT = (h.tee_result==='penal') ? 1 : 0;
    estados.push({lie:'tee', d:largo, pen:penT});

    var dAprox = aprox!=null ? aprox : Math.max(60, largo - 230);
    if(par===5 && (score-putts) >= 3){
      // hay un tiro intermedio antes del approach
      var dLay = Math.max(dAprox+60, largo-250);
      estados.push({lie:lieT, d:dLay, pen:0});
      estados.push({lie:lieT, d:dAprox, pen:0});
    } else {
      estados.push({lie:lieT, d:dAprox, pen:0});
    }
  }

  if(!gir && putts>0){
    var lieF = h.miss_lie || 'rough';
    estados.push({lie:lieF, d:DIST_FALLO[lieF]||12, pen:0});
  }

  // Ajuste: la cantidad de golpes que no son putt tiene que cuadrar
  // con el score. Si faltan, se agregan golpes desde el mismo lugar
  // (golpes que no ganaron terreno, que es exactamente lo que pasó).
  var objetivo = score - putts - pen;
  if(objetivo < 1) objetivo = 1;
  while(estados.length > objetivo && estados.length > 1){
    estados.splice(1,1);
  }
  while(estados.length < objetivo){
    var ultimo = estados[estados.length-1];
    estados.push({lie:ultimo.lie, d:ultimo.d, pen:0});
  }
  // las penalidades declaradas que no quedaron en el tee se cuelgan del último golpe
  var penPuestas = 0;
  estados.forEach(function(e){ penPuestas += (e.pen||0); });
  if(pen > penPuestas) estados[estados.length-1].pen = (estados[estados.length-1].pen||0) + (pen - penPuestas);

  return {estados:estados, putts:putts, puttDist:pPutt, par:par, gir:gir};
}

function calcularHoyo(h, defs, k){
  var r = reconstruir(h, defs);
  var sg = sgDeHoyo(r.estados, r.putts, r.puttDist, r.par, k);
  return {sg:sg, gir:r.gir};
}

// ------------------------------------------------------------
// Tiro a tiro (nivel avanzado): la cadena viene dada, sin estimar.
// shots: [{lie, distance_m, penalty, holed}]
// ------------------------------------------------------------
function calcularHoyoTiros(shots, par, k){
  var out={salida:0, approach:0, corto:0, putt:0, total:0};
  if(!shots || !shots.length) return out;
  var pen=0;
  for(var i=0;i<shots.length;i++){
    var s=shots[i];
    var Ei=esperados(s.lie, Number(s.distance_m), k);
    var Ej=0;
    if(i<shots.length-1) Ej=esperados(shots[i+1].lie, Number(shots[i+1].distance_m), k);
    var p=Number(s.penalty||0);
    pen+=p;
    out[categoria(s.lie, Number(s.distance_m), par, i===0)] += (Ei-Ej-1-p);
  }
  var golpes=shots.length+pen;
  out.total=esperados(shots[0].lie, Number(shots[0].distance_m), k)-golpes;
  return out;
}

// exportamos el motor para poder recalcular rondas viejas más adelante
window.MGLSG = {
  version: BASELINE_VERSION,
  esperados: esperados,
  kDe: kDe,
  calcularHoyo: calcularHoyo,
  calcularHoyoTiros: calcularHoyoTiros,
  BASE: BASE
};

// ============================================================
// ESTILOS DEL MÓDULO (se inyectan solos)
// ============================================================
var CSS = ''
+ '.rd-cfg{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:6px}'
+ '.rd-cfg .field{margin-bottom:0;flex:1;min-width:110px}'
+ '.rd-lvl{display:flex;gap:7px;flex-wrap:wrap;margin:4px 0 16px}'
+ '.rd-note{font-size:12px;color:#666;line-height:1.5;margin-top:6px}'
+ '.rd-holes{display:flex;flex-direction:column;gap:9px;max-height:46vh;overflow-y:auto;padding-right:3px;margin-top:6px}'
+ '.rd-hole{background:#111;border:1px solid #262626;border-radius:11px;padding:10px 12px}'
+ '.rd-hole.bad{border-color:rgba(224,106,106,.45)}'
+ '.rd-hole.gir{border-color:rgba(45,212,191,.3)}'
+ '.rd-hrow{display:flex;gap:9px;align-items:center;flex-wrap:wrap}'
+ '.rd-hno{font-family:"Bebas Neue";font-size:21px;line-height:1;color:#2dd4bf;width:30px;flex-shrink:0}'
+ '.rd-f{display:flex;flex-direction:column;gap:2px}'
+ '.rd-f label{font-family:"Barlow Condensed";font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:#666;margin:0}'
+ '.rd-f input,.rd-f select{background:#1c1c1c;border:1px solid #333;color:#f5f5f5;font-family:"Barlow";font-size:14px;padding:6px 8px;border-radius:7px;width:100%}'
+ '.rd-f.w45 input,.rd-f.w45 select{width:56px;text-align:center}'
+ '.rd-f.w90 select{min-width:104px}'
+ '.rd-f.grow{flex:1;min-width:120px}'
+ '.rd-tag{font-family:"Barlow Condensed";font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:2px 8px;border-radius:10px;border:1px solid #333;color:#8a8a8a}'
+ '.rd-tag.on{color:#2dd4bf;border-color:#1a7d72;background:rgba(45,212,191,.1)}'
+ '.rd-tot{display:flex;gap:14px;flex-wrap:wrap;align-items:center;background:#111;border:1px solid #262626;border-radius:11px;padding:12px 14px;margin-top:14px}'
+ '.rd-kpi{text-align:center;min-width:62px}'
+ '.rd-kpi .n{font-family:"Bebas Neue";font-size:23px;line-height:1;color:#f5f5f5}'
+ '.rd-kpi .n.pos{color:#2dd4bf}.rd-kpi .n.neg{color:#e06a6a}'
+ '.rd-kpi .l{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-top:3px}'
+ '.rd-shots{margin-top:8px;display:flex;flex-direction:column;gap:6px}'
+ '.rd-shot{display:flex;gap:7px;align-items:center}'
+ '.rd-shot .n{font-size:11px;color:#666;width:16px}'
+ '.rd-add{color:#2dd4bf;font-family:"Barlow Condensed";font-weight:600;font-size:12.5px;text-transform:uppercase;letter-spacing:.4px;cursor:pointer;margin-top:4px;display:inline-block}'
+ '.rd-card{background:#161616;border:1px solid #262626;border-radius:12px;padding:13px 15px;margin-top:13px}'
+ '.rd-card h4{font-family:"Barlow Condensed";font-size:15px;text-transform:uppercase;letter-spacing:.5px;color:#8a8a8a;margin-bottom:10px}'
+ '.rd-sg{display:flex;flex-direction:column;gap:7px}'
+ '.rd-sgrow{display:flex;align-items:center;gap:10px;font-size:13px}'
+ '.rd-sgrow .lb{width:88px;color:#8a8a8a;flex-shrink:0}'
+ '.rd-sgrow .tr{flex:1;height:8px;background:#111;border:1px solid #262626;border-radius:5px;position:relative;overflow:hidden}'
+ '.rd-sgrow .tr i{position:absolute;top:0;bottom:0;display:block}'
+ '.rd-sgrow .tr .mid{position:absolute;top:0;bottom:0;left:50%;width:1px;background:#333}'
+ '.rd-sgrow .vl{width:52px;text-align:right;font-variant-numeric:tabular-nums;font-family:"Barlow Condensed";font-weight:600;font-size:15px}'
+ '.rd-sgrow .vl.pos{color:#2dd4bf}.rd-sgrow .vl.neg{color:#e06a6a}';

var st=document.createElement('style');
st.textContent=CSS;
document.head.appendChild(st);

// ============================================================
// MODAL
// ============================================================
var MODAL = ''
+ '<div class="overlay" id="ovRonda" style="z-index:150">'
+ '<div class="modal" style="max-width:760px">'
+ '  <h2 id="rd_head">Estadísticas de la ronda</h2>'
+ '  <div class="rd-cfg">'
+ '    <div class="field"><label>Fecha</label><input id="rd_date" type="date"></div>'
+ '    <div class="field" style="flex:2"><label>Campo</label><input id="rd_course" placeholder="Ej: Los Leones"></div>'
+ '    <div class="field"><label>Tees</label><input id="rd_tees" placeholder="Azules"></div>'
+ '  </div>'
+ '  <div class="rd-cfg" style="margin-top:12px">'
+ '    <div class="field"><label>Tipo</label><select id="rd_kind">'
+ '      <option value="torneo">Torneo</option><option value="clasificatorio">Clasificatorio</option><option value="practica">Ronda de práctica</option>'
+ '    </select></div>'
+ '    <div class="field"><label>Hoyos</label><select id="rd_holes"><option value="18">18</option><option value="9">9</option></select></div>'
+ '    <div class="field"><label>Nivel de detalle</label><select id="rd_level">'
+ '      <option value="basico">Resumen</option><option value="intermedio">Hoyo por hoyo</option><option value="avanzado">Tiro a tiro</option>'
+ '    </select></div>'
+ '  </div>'
+ '  <div class="rd-note" id="rd_lvlnote"></div>'
+ '  <div id="rd_body" style="margin-top:16px"></div>'
+ '  <div class="rd-tot" id="rd_totals"></div>'
+ '  <div class="field" style="margin-top:14px"><label>Notas de la ronda</label>'
+ '    <textarea id="rd_notes" rows="2" placeholder="Viento, estado del campo, cómo se sintió..."></textarea></div>'
+ '  <div class="modal-actions">'
+ '    <button class="btn-ghost" id="rd_del" style="margin-right:auto">Eliminar estadísticas</button>'
+ '    <button class="btn-ghost" id="rd_cancel">Cancelar</button>'
+ '    <button class="btn-primary" id="rd_save">Guardar ronda</button>'
+ '  </div>'
+ '</div></div>';

var wrap=document.createElement('div');
wrap.innerHTML=MODAL;
document.body.appendChild(wrap.firstChild);

// ============================================================
// ESTADO
// ============================================================
var ROUNDS={};        // event_id → round_stats
var R_EVENT=null, R_ROUND=null, R_HOLES=[], R_SHOTS={}, R_LEVEL='basico';
var LARGOS={3:155,4:355,5:470};

var APROX=[[0,'—'],[20,'menos de 30 m'],[40,'30 a 50 m'],[60,'50 a 70 m'],[80,'70 a 90 m'],[100,'90 a 110 m'],[120,'110 a 130 m'],[140,'130 a 150 m'],[160,'150 a 170 m'],[180,'170 a 190 m'],[205,'más de 190 m']];
var PUTTD=[[0,'—'],[0.7,'menos de 1 m'],[1.5,'1 a 2 m'],[2.5,'2 a 3 m'],[4,'3 a 5 m'],[6.5,'5 a 8 m'],[10,'8 a 12 m'],[15,'más de 12 m']];
var SALIDA=[['','—'],['calle','Calle'],['rough','Rough'],['bunker','Bunker'],['recovery','Árboles'],['penal','Penalidad']];
var FALLO=[['rough','Rough'],['bunker','Bunker'],['calle','Calle'],['recovery','Árboles']];
var LIES=[['tee','Tee'],['calle','Calle'],['rough','Rough'],['bunker','Bunker'],['recovery','Árboles'],['green','Green']];

function _esc(s){ return (window.esc?window.esc(s):String(s==null?'':s)); }
function _toast(m,e){ if(window.toast) window.toast(m,e); }
function _err(t,d,p){ if(window.showError) window.showError(t,d,p); else console.error(t,d); }
function _em(e){ return window.errMsg?window.errMsg(e):(e&&e.message)||'error'; }
function opts(arr, sel){
  var h='';
  arr.forEach(function(o){
    var v=o[0], l=o[1];
    h+='<option value="'+v+'"'+(String(v)===String(sel)?' selected':'')+'>'+l+'</option>';
  });
  return h;
}
function num(v,def){ var n=Number(v); return isFinite(n)?n:(def||0); }

function parDefault(i){
  // reparto clásico: 4 pares 3, 4 pares 5, el resto pares 4
  var p3={3:1,6:1,8:1,12:1,16:1}, p5={2:1,5:1,11:1,14:1};
  if(p3[i]) return 3;
  if(p5[i]) return 5;
  return 4;
}
function holesVacios(n){
  var a=[];
  for(var i=1;i<=n;i++){
    a.push({hole_no:i, par:parDefault(i), score:'', putts:'', tee_result:'', approach_m:'', miss_lie:'rough', first_putt_m:'', penalties:0});
  }
  return a;
}

// ============================================================
// RENDER
// ============================================================
var NOTAS_NIVEL={
  basico:'Resumen de la ronda: score, putts, calles y greens. No calcula Strokes Gained, pero sí alimenta el gráfico de métricas.',
  intermedio:'Hoyo por hoyo. Con estos datos se reconstruye una secuencia de golpes aproximada y se estima el SG por área. El SG total siempre cuadra con el score real.',
  avanzado:'Tiro a tiro: cada golpe con su lie y su distancia al hoyo. Acá el SG es exacto, sin estimaciones.'
};

function render(){
  document.getElementById('rd_lvlnote').textContent=NOTAS_NIVEL[R_LEVEL]||'';
  var b=document.getElementById('rd_body');
  if(R_LEVEL==='basico')      b.innerHTML=htmlBasico();
  else if(R_LEVEL==='avanzado') b.innerHTML=htmlAvanzado();
  else                        b.innerHTML=htmlIntermedio();
  recalcular();
}

function htmlBasico(){
  var r=R_ROUND||{};
  function f(id,lb,val,ph){
    return '<div class="rd-f grow"><label>'+lb+'</label><input id="'+id+'" type="number" step="1" value="'+(val==null?'':val)+'" placeholder="'+(ph||'')+'"></div>';
  }
  return '<div class="rd-hrow" style="gap:10px">'
    + f('rb_par','Par del campo',r.par||72)
    + f('rb_score','Score',r.score)
    + f('rb_putts','Putts',r.putts)
    + f('rb_pen','Penalidades',r.penalties||0)
    + '</div><div class="rd-hrow" style="gap:10px;margin-top:10px">'
    + f('rb_fw','Calles',r.fairways_hit)
    + f('rb_fwt','Calles posibles',r.fairways_total||14)
    + f('rb_gir','Greens en regulación',r.gir)
    + '</div><div class="rd-hrow" style="gap:10px;margin-top:10px">'
    + f('rb_ud','Up & down logrados',r.up_downs)
    + f('rb_udt','Up & down intentados',r.up_down_tries)
    + '</div>';
}

function htmlIntermedio(){
  var h='<div class="rd-hrow" style="gap:10px;margin-bottom:10px">'
    + '<div class="rd-f w45"><label>Par 3</label><input id="rl3" type="number" value="'+LARGOS[3]+'"></div>'
    + '<div class="rd-f w45"><label>Par 4</label><input id="rl4" type="number" value="'+LARGOS[4]+'"></div>'
    + '<div class="rd-f w45"><label>Par 5</label><input id="rl5" type="number" value="'+LARGOS[5]+'"></div>'
    + '<div class="rd-note" style="flex:1;min-width:180px;margin:0">Largo promedio en metros de cada tipo de hoyo. Sirve para estimar el SG de salida.</div>'
    + '</div><div class="rd-holes">';

  R_HOLES.forEach(function(x,i){
    var gir = window.MGLSG ? null : null;
    var girOk = (x.score!=='' && x.putts!=='') ? ((num(x.score)-num(x.putts)) <= (num(x.par)-2)) : null;
    var cls = girOk===true ? ' gir' : (girOk===false ? ' bad' : '');
    h+='<div class="rd-hole'+cls+'">'
      + '<div class="rd-hrow">'
      +   '<span class="rd-hno">'+x.hole_no+'</span>'
      +   '<div class="rd-f w45"><label>Par</label><select data-i="'+i+'" data-k="par">'+opts([[3,3],[4,4],[5,5]],x.par)+'</select></div>'
      +   '<div class="rd-f w45"><label>Score</label><input data-i="'+i+'" data-k="score" type="number" min="1" value="'+x.score+'"></div>'
      +   '<div class="rd-f w45"><label>Putts</label><input data-i="'+i+'" data-k="putts" type="number" min="0" value="'+x.putts+'"></div>'
      +   (x.par>3
            ? '<div class="rd-f w90"><label>Salida</label><select data-i="'+i+'" data-k="tee_result">'+opts(SALIDA,x.tee_result)+'</select></div>'
            : '')
      +   '<div class="rd-f w90"><label>Approach</label><select data-i="'+i+'" data-k="approach_m">'+opts(APROX,x.approach_m)+'</select></div>'
      +   '<div class="rd-f w90"><label>1er putt</label><select data-i="'+i+'" data-k="first_putt_m">'+opts(PUTTD,x.first_putt_m)+'</select></div>'
      +   (girOk===false
            ? '<div class="rd-f w90"><label>Falló en</label><select data-i="'+i+'" data-k="miss_lie">'+opts(FALLO,x.miss_lie)+'</select></div>'
            : '')
      +   '<div class="rd-f w45"><label>Pen</label><input data-i="'+i+'" data-k="penalties" type="number" min="0" value="'+num(x.penalties,0)+'"></div>'
      + '</div></div>';
  });
  return h+'</div>';
}

function htmlAvanzado(){
  var h='<div class="rd-holes">';
  R_HOLES.forEach(function(x,i){
    var shots=R_SHOTS[x.hole_no]||[];
    h+='<div class="rd-hole">'
      + '<div class="rd-hrow">'
      +   '<span class="rd-hno">'+x.hole_no+'</span>'
      +   '<div class="rd-f w45"><label>Par</label><select data-i="'+i+'" data-k="par">'+opts([[3,3],[4,4],[5,5]],x.par)+'</select></div>'
      +   '<span class="rd-tag'+(shots.length?' on':'')+'">'+(shots.length?shots.length+' golpes':'sin golpes')+'</span>'
      + '</div><div class="rd-shots">';
    shots.forEach(function(s,j){
      h+='<div class="rd-shot"><span class="n">'+(j+1)+'</span>'
        + '<div class="rd-f w90"><select data-h="'+x.hole_no+'" data-j="'+j+'" data-s="lie">'+opts(LIES,s.lie)+'</select></div>'
        + '<div class="rd-f w45"><input data-h="'+x.hole_no+'" data-j="'+j+'" data-s="distance_m" type="number" step="0.1" value="'+s.distance_m+'" title="distancia al hoyo antes del golpe"></div>'
        + '<div class="rd-f w45"><input data-h="'+x.hole_no+'" data-j="'+j+'" data-s="penalty" type="number" min="0" value="'+num(s.penalty,0)+'" title="penalidades"></div>'
        + '<button class="btn-x" style="height:30px;width:30px" onclick="MGLRondas._rmShot('+x.hole_no+','+j+')">×</button>'
        + '</div>';
    });
    h+='<span class="rd-add" onclick="MGLRondas._addShot('+x.hole_no+')">+ agregar golpe</span>'
      + '</div></div>';
  });
  return h+'</div><div class="rd-note">La distancia es al hoyo <b>antes</b> de pegar. El último golpe de cada hoyo es el que emboca; no hace falta marcarlo.</div>';
}

// ============================================================
// CÁLCULO EN VIVO
// ============================================================
function kActual(){
  var cat = (window.SEL && SEL.category) || 'amateur';
  return window.MGLSG.kDe(cat);
}

function agregados(){
  var k=kActual();
  var tot={salida:0, approach:0, corto:0, putt:0, total:0};
  var score=0, putts=0, par=0, gir=0, pen=0, fw=0, fwt=0, ud=0, udt=0;
  var hayDatos=false;

  if(R_LEVEL==='basico'){
    var g=function(id){ var el=document.getElementById(id); return el?num(el.value,0):0; };
    par=g('rb_par'); score=g('rb_score'); putts=g('rb_putts'); pen=g('rb_pen');
    fw=g('rb_fw'); fwt=g('rb_fwt'); gir=g('rb_gir'); ud=g('rb_ud'); udt=g('rb_udt');
    return {score:score, putts:putts, par:par, gir:gir, pen:pen, fw:fw, fwt:fwt, ud:ud, udt:udt, sg:null, porHoyo:[]};
  }

  var porHoyo=[];
  R_HOLES.forEach(function(x){
    par += num(x.par,4);
    var sgh=null, s=0, p=0;

    if(R_LEVEL==='avanzado'){
      var shots=(R_SHOTS[x.hole_no]||[]).filter(function(z){ return z.distance_m!=='' && z.distance_m!=null; });
      if(!shots.length){ porHoyo.push(null); return; }
      var puttsH=shots.filter(function(z){ return z.lie==='green'; }).length;
      shots.forEach(function(z){ p += num(z.penalty,0); });
      s = shots.length + p;
      sgh = window.MGLSG.calcularHoyoTiros(shots, num(x.par,4), k);
      putts += puttsH;
      pen += p;
      if(shots.length>1 && shots[1] && shots[1].lie==='calle') fw++;
      if(num(x.par,4)>3) fwt++;
    } else {
      if(x.score===''||x.score==null){ porHoyo.push(null); return; }
      s=num(x.score); p=num(x.penalties,0);
      var res = window.MGLSG.calcularHoyo(x, LARGOS, k);
      sgh = res.sg;
      putts += num(x.putts,0);
      pen += p;
      if(res.gir) gir++;
      if(num(x.par,4)>3){ fwt++; if(x.tee_result==='calle') fw++; }
      if(!res.gir && num(x.putts,0)===1 && s<=num(x.par,4)+0){ ud++; }
      if(!res.gir) udt++;
    }

    hayDatos=true;
    score += s;
    ['salida','approach','corto','putt','total'].forEach(function(c){ tot[c]+= (sgh[c]||0); });
    porHoyo.push(sgh);
  });

  return {score:score, putts:putts, par:par, gir:gir, pen:pen, fw:fw, fwt:fwt, ud:ud, udt:udt,
          sg:hayDatos?tot:null, porHoyo:porHoyo};
}

function barra(v){
  var max=6;
  var p=Math.max(-1,Math.min(1, v/max));
  var w=Math.abs(p)*50;
  var color = v>=0 ? '#2dd4bf' : '#e06a6a';
  var pos = v>=0 ? 'left:50%' : ('left:'+(50-w)+'%');
  return '<span class="tr"><i style="'+pos+';width:'+w+'%;background:'+color+'"></i><span class="mid"></span></span>';
}
function sgRow(lb,v){
  var cls = v>=0?'pos':'neg';
  return '<div class="rd-sgrow"><span class="lb">'+lb+'</span>'+barra(v)
       + '<span class="vl '+cls+'">'+(v>=0?'+':'')+v.toFixed(2)+'</span></div>';
}

function recalcular(){
  var a=agregados();
  var box=document.getElementById('rd_totals');
  var vsPar = a.score && a.par ? (a.score-a.par) : null;
  var h='';
  h+='<div class="rd-kpi"><div class="n">'+(a.score||'—')+'</div><div class="l">score</div></div>';
  h+='<div class="rd-kpi"><div class="n '+(vsPar==null?'':(vsPar<=0?'pos':'neg'))+'">'+(vsPar==null?'—':(vsPar>0?'+'+vsPar:vsPar))+'</div><div class="l">vs par</div></div>';
  h+='<div class="rd-kpi"><div class="n">'+(a.putts||'—')+'</div><div class="l">putts</div></div>';
  h+='<div class="rd-kpi"><div class="n">'+(a.fwt?Math.round(a.fw*100/a.fwt)+'%':'—')+'</div><div class="l">calles</div></div>';
  h+='<div class="rd-kpi"><div class="n">'+(a.gir||a.gir===0?a.gir:'—')+'</div><div class="l">GIR</div></div>';
  if(a.sg){
    h+='<div class="rd-kpi"><div class="n '+(a.sg.total>=0?'pos':'neg')+'">'+(a.sg.total>=0?'+':'')+a.sg.total.toFixed(1)+'</div><div class="l">SG total</div></div>';
  }
  box.innerHTML=h;

  var prev=document.getElementById('rd_sgprev');
  if(prev) prev.parentNode.removeChild(prev);
  if(a.sg){
    var d=document.createElement('div');
    d.id='rd_sgprev'; d.className='rd-card';
    d.innerHTML='<h4>Strokes Gained · referencia '+((window.SEL&&SEL.category)||'amateur').replace('_',' ')+'</h4>'
      + '<div class="rd-sg">'
      + sgRow('Salida', a.sg.salida) + sgRow('Approach', a.sg.approach)
      + sgRow('Juego corto', a.sg.corto) + sgRow('Putting', a.sg.putt)
      + '<div style="height:1px;background:#262626;margin:3px 0"></div>'
      + sgRow('Total', a.sg.total)
      + '</div>';
    box.parentNode.insertBefore(d, box.nextSibling);
  }
  return a;
}

// ============================================================
// EVENTOS DEL FORMULARIO
// ============================================================
document.getElementById('ovRonda').addEventListener('input',function(e){
  var t=e.target;
  if(t.id==='rl3'||t.id==='rl4'||t.id==='rl5'){
    LARGOS[3]=num(document.getElementById('rl3').value,155);
    LARGOS[4]=num(document.getElementById('rl4').value,355);
    LARGOS[5]=num(document.getElementById('rl5').value,470);
    recalcular(); return;
  }
  var i=t.getAttribute('data-i'), k=t.getAttribute('data-k');
  if(i!=null && k){
    R_HOLES[Number(i)][k] = t.value;
    if(k==='score'||k==='putts'||k==='par'){ render(); return; }
    recalcular(); return;
  }
  var hn=t.getAttribute('data-h'), j=t.getAttribute('data-j'), s=t.getAttribute('data-s');
  if(hn!=null && s){
    R_SHOTS[Number(hn)][Number(j)][s]=t.value;
    recalcular(); return;
  }
  recalcular();
});
document.getElementById('rd_level').addEventListener('change',function(){
  R_LEVEL=this.value;
  render();
});
document.getElementById('rd_holes').addEventListener('change',function(){
  var n=num(this.value,18);
  if(R_HOLES.length!==n) R_HOLES=holesVacios(n);
  render();
});
document.getElementById('rd_cancel').addEventListener('click',function(){
  document.getElementById('ovRonda').classList.remove('show');
});

// ============================================================
// ABRIR / CARGAR
// ============================================================
async function load(playerId){
  ROUNDS={};
  var r=await sb.from('round_stats').select('*').eq('player_id',playerId);
  if(r.error){ console.warn('round_stats',r.error); return; }
  (r.data||[]).forEach(function(x){ ROUNDS[x.event_id]=x; });
}

async function open(eventId){
  R_EVENT=eventId;
  R_ROUND=ROUNDS[eventId]||null;
  R_SHOTS={};
  var tier=(window.SEL&&SEL.stats_tier)||'basico';
  R_LEVEL = (R_ROUND&&R_ROUND.detail_level) || tier;

  document.getElementById('rd_head').textContent = R_ROUND ? 'Editar estadísticas de la ronda' : 'Estadísticas de la ronda';
  document.getElementById('rd_date').value   = (R_ROUND&&R_ROUND.played_on) || new Date().toISOString().slice(0,10);
  document.getElementById('rd_course').value = (R_ROUND&&R_ROUND.course)||'';
  document.getElementById('rd_tees').value   = (R_ROUND&&R_ROUND.tees)||'';
  document.getElementById('rd_kind').value   = (R_ROUND&&R_ROUND.round_kind)||'torneo';
  document.getElementById('rd_holes').value  = String((R_ROUND&&R_ROUND.holes)||18);
  document.getElementById('rd_level').value  = R_LEVEL;
  document.getElementById('rd_notes').value  = (R_ROUND&&R_ROUND.notes)||'';
  document.getElementById('rd_del').style.display = R_ROUND ? 'inline-block' : 'none';

  R_HOLES=holesVacios(num(document.getElementById('rd_holes').value,18));

  if(R_ROUND){
    var rh=await sb.from('round_holes').select('*').eq('round_id',R_ROUND.id).order('hole_no');
    (rh.data||[]).forEach(function(x){
      var i=x.hole_no-1;
      if(R_HOLES[i]) R_HOLES[i]={
        hole_no:x.hole_no, par:x.par, score:x.score==null?'':x.score, putts:x.putts==null?'':x.putts,
        tee_result:x.tee_result||'', approach_m:x.approach_m==null?'':x.approach_m,
        miss_lie:x.miss_lie||'rough', first_putt_m:x.first_putt_m==null?'':x.first_putt_m,
        penalties:x.penalties||0, length_m:x.length_m
      };
    });
    var rs=await sb.from('round_shots').select('*').eq('round_id',R_ROUND.id).order('hole_no').order('shot_no');
    (rs.data||[]).forEach(function(x){
      if(!R_SHOTS[x.hole_no]) R_SHOTS[x.hole_no]=[];
      R_SHOTS[x.hole_no].push({lie:x.lie, distance_m:x.distance_m, penalty:x.penalty||0});
    });
  }

  render();
  document.getElementById('ovRonda').classList.add('show');
}

function addShot(hn){
  if(!R_SHOTS[hn]) R_SHOTS[hn]=[];
  var prev=R_SHOTS[hn][R_SHOTS[hn].length-1];
  R_SHOTS[hn].push({lie: prev?'calle':'tee', distance_m: prev?'':String(LARGOS[4]), penalty:0});
  render();
}
function rmShot(hn,j){
  if(R_SHOTS[hn]) R_SHOTS[hn].splice(j,1);
  render();
}

// ============================================================
// GUARDAR
// ============================================================
document.getElementById('rd_save').addEventListener('click',async function(){
  var btn=this; btn.disabled=true;
  var a=recalcular();
  var k=kActual();

  if(!a.score){ _toast('Falta el score de la ronda',true); btn.disabled=false; return; }

  var fila={
    event_id:R_EVENT, player_id:SEL.id, coach_id:window.COACH_ID||null, created_by:USER.id,
    played_on:document.getElementById('rd_date').value||new Date().toISOString().slice(0,10),
    course:document.getElementById('rd_course').value.trim()||null,
    tees:document.getElementById('rd_tees').value.trim()||null,
    round_kind:document.getElementById('rd_kind').value,
    holes:num(document.getElementById('rd_holes').value,18),
    par:a.par||null, score:a.score, putts:a.putts||null,
    fairways_hit:a.fw, fairways_total:a.fwt, gir:a.gir, penalties:a.pen,
    up_downs:a.ud, up_down_tries:a.udt,
    detail_level:R_LEVEL, baseline_version:window.MGLSG.version, baseline_k:k,
    sg_total:a.sg?Number(a.sg.total.toFixed(3)):null,
    sg_tee:a.sg?Number(a.sg.salida.toFixed(3)):null,
    sg_approach:a.sg?Number(a.sg.approach.toFixed(3)):null,
    sg_short:a.sg?Number(a.sg.corto.toFixed(3)):null,
    sg_putt:a.sg?Number(a.sg.putt.toFixed(3)):null,
    notes:document.getElementById('rd_notes').value.replace(/\s+$/,'')||null,
    updated_at:new Date().toISOString()
  };

  var rid;
  if(R_ROUND){
    var ru=await sb.from('round_stats').update(fila).eq('id',R_ROUND.id).select().single();
    if(ru.error){ _err('No se pudo guardar la ronda',_em(ru.error),'Si menciona round_stats, falta correr coach_hub_rondas_v1.sql.'); btn.disabled=false; return; }
    rid=ru.data.id; ROUNDS[R_EVENT]=ru.data;
  } else {
    var ri=await sb.from('round_stats').insert(fila).select().single();
    if(ri.error){ _err('No se pudo guardar la ronda',_em(ri.error),'Si menciona round_stats, falta correr coach_hub_rondas_v1.sql.'); btn.disabled=false; return; }
    rid=ri.data.id; ROUNDS[R_EVENT]=ri.data;
  }

  await sb.from('round_holes').delete().eq('round_id',rid);
  await sb.from('round_shots').delete().eq('round_id',rid);

  if(R_LEVEL!=='basico'){
    var filasH=[];
    R_HOLES.forEach(function(x,i){
      var sgh=a.porHoyo[i];
      if(!sgh && R_LEVEL==='intermedio' && (x.score===''||x.score==null)) return;
      filasH.push({
        round_id:rid, player_id:SEL.id, hole_no:x.hole_no, par:num(x.par,4),
        length_m:LARGOS[num(x.par,4)]||null,
        score:x.score===''?null:num(x.score), putts:x.putts===''?null:num(x.putts),
        tee_result:x.tee_result||null,
        approach_m:x.approach_m===''?null:num(x.approach_m),
        miss_lie:x.miss_lie||null,
        first_putt_m:x.first_putt_m===''?null:num(x.first_putt_m),
        penalties:num(x.penalties,0),
        gir:(x.score!==''&&x.putts!=='')?((num(x.score)-num(x.putts))<=(num(x.par)-2)):null,
        sg_tee:sgh?Number(sgh.salida.toFixed(3)):null,
        sg_approach:sgh?Number(sgh.approach.toFixed(3)):null,
        sg_short:sgh?Number(sgh.corto.toFixed(3)):null,
        sg_putt:sgh?Number(sgh.putt.toFixed(3)):null,
        sg_total:sgh?Number(sgh.total.toFixed(3)):null
      });
    });
    if(filasH.length){
      var rhi=await sb.from('round_holes').insert(filasH);
      if(rhi.error) _err('La ronda se guardó, pero falló el detalle por hoyo',_em(rhi.error));
    }
  }

  if(R_LEVEL==='avanzado'){
    var filasS=[];
    Object.keys(R_SHOTS).forEach(function(hn){
      R_SHOTS[hn].forEach(function(s,j){
        if(s.distance_m===''||s.distance_m==null) return;
        filasS.push({round_id:rid, player_id:SEL.id, hole_no:Number(hn), shot_no:j+1,
          lie:s.lie, distance_m:num(s.distance_m), penalty:num(s.penalty,0),
          holed:false});
      });
    });
    if(filasS.length){
      var rsi=await sb.from('round_shots').insert(filasS);
      if(rsi.error) _err('La ronda se guardó, pero fallaron los golpes',_em(rsi.error));
    }
  }

  // métricas → alimentan el gráfico y las metas que ya existen
  await sb.from('player_metrics').delete().eq('event_id',R_EVENT);
  var mets=[];
  function met(key,val){
    if(val==null || !isFinite(val)) return;
    mets.push({player_id:SEL.id, event_id:R_EVENT, metric_key:key, value:Number(val),
               measured_at:fila.played_on, source:'ronda'});
  }
  met('score', a.score);
  if(a.par) met('score_to_par', a.score-a.par);
  met('putts', a.putts);
  if(a.fwt) met('fairways_pct', Math.round(a.fw*100/a.fwt));
  if(fila.holes) met('gir_pct', Math.round(a.gir*100/fila.holes));
  met('penalties', a.pen);
  if(a.udt) met('up_down_pct', Math.round(a.ud*100/a.udt));
  if(a.sg){
    met('sg_total', Number(a.sg.total.toFixed(2)));
    met('sg_tee', Number(a.sg.salida.toFixed(2)));
    met('sg_approach', Number(a.sg.approach.toFixed(2)));
    met('sg_short', Number(a.sg.corto.toFixed(2)));
    met('sg_putt', Number(a.sg.putt.toFixed(2)));
  }
  if(mets.length){
    var rm=await sb.from('player_metrics').insert(mets);
    if(rm.error) console.warn('metrics ronda',rm.error);
  }

  btn.disabled=false;
  document.getElementById('ovRonda').classList.remove('show');
  _toast('Ronda guardada'+(a.sg?' · SG total '+(a.sg.total>=0?'+':'')+a.sg.total.toFixed(1):''));
  if(window.onRondaGuardada) window.onRondaGuardada();
});

document.getElementById('rd_del').addEventListener('click',async function(){
  if(!R_ROUND) return;
  if(!confirm('¿Eliminar las estadísticas de esta ronda? El evento del timeline se mantiene.')) return;
  var r=await sb.from('round_stats').delete().eq('id',R_ROUND.id);
  if(r.error){ _err('No se pudo eliminar',_em(r.error)); return; }
  await sb.from('player_metrics').delete().eq('event_id',R_EVENT);
  delete ROUNDS[R_EVENT];
  document.getElementById('ovRonda').classList.remove('show');
  _toast('Estadísticas eliminadas');
  if(window.onRondaGuardada) window.onRondaGuardada();
});

// ============================================================
// TARJETA RESUMEN EN EL TIMELINE
// ============================================================
function summaryHTML(eventId){
  var r=ROUNDS[eventId];
  if(!r){
    return '<button class="tl-link" onclick="MGLRondas.open(\'' + eventId + '\')">+ Cargar estadísticas de la ronda</button>';
  }
  var vs = (r.score!=null && r.par!=null) ? (r.score-r.par) : null;
  var h='<div class="rd-card">'
    + '<div class="rd-tot" style="margin:0;border:none;background:none;padding:0">'
    +   '<div class="rd-kpi"><div class="n">'+(r.score!=null?r.score:'—')+'</div><div class="l">score</div></div>'
    +   '<div class="rd-kpi"><div class="n '+(vs==null?'':(vs<=0?'pos':'neg'))+'">'+(vs==null?'—':(vs>0?'+'+vs:vs))+'</div><div class="l">vs par</div></div>'
    +   '<div class="rd-kpi"><div class="n">'+(r.putts!=null?r.putts:'—')+'</div><div class="l">putts</div></div>'
    +   '<div class="rd-kpi"><div class="n">'+(r.fairways_total?Math.round(r.fairways_hit*100/r.fairways_total)+'%':'—')+'</div><div class="l">calles</div></div>'
    +   '<div class="rd-kpi"><div class="n">'+(r.gir!=null?r.gir:'—')+'</div><div class="l">GIR</div></div>'
    + '</div>';
  if(r.sg_total!=null){
    h+='<div class="rd-sg" style="margin-top:12px">'
      + sgRow('Salida', Number(r.sg_tee||0))
      + sgRow('Approach', Number(r.sg_approach||0))
      + sgRow('Juego corto', Number(r.sg_short||0))
      + sgRow('Putting', Number(r.sg_putt||0))
      + '<div style="height:1px;background:#262626;margin:3px 0"></div>'
      + sgRow('Total', Number(r.sg_total))
      + '</div>'
      + '<div class="rd-note">SG estimado contra una referencia de nivel '+_esc(r.baseline_k)+'× · '+_esc(r.baseline_version)+'</div>';
  }
  h+='<button class="tl-link" onclick="MGLRondas.open(\'' + eventId + '\')">Editar estadísticas</button>'
    + '</div>';
  return h;
}

function tieneRonda(eventId){ return !!ROUNDS[eventId]; }

window.MGLRondas = {
  load: load,
  open: open,
  summaryHTML: summaryHTML,
  tieneRonda: tieneRonda,
  _addShot: addShot,
  _rmShot: rmShot
};

})();
