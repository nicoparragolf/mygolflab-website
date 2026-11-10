/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Agenda de videollamadas (elegir horario)
   Archivo: /js/mgl-agenda.js
   Versión: 1.0 · 2026-11-10

   El coach publica horarios semanales en SU zona horaria (coach_availability +
   coach_profiles.timezone). Aquí se calculan los horarios libres de las
   próximas semanas, se muestran en la hora del alumno y se descuentan los ya
   reservados (mgl_horarios_ocupados). La base de datos vuelve a validar todo
   al reservar (mgl_reservar), así que esto es solo para mostrar.

   Uso:
     var ag = await MGLAgenda.cargar(sb, coachId, tzCoach);
     MGLAgenda.selector(elemento, ag, { minutos: 60, alElegir: function (iso) { … } });
     MGLAgenda.fecha(iso)  → "mar 18 nov · 10:00"
   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLAgenda) return;

  var DIAS = 21, PASO = 30, AVISO_H = 4;
  var DSEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  // ── Zonas horarias sin librerías ──
  var FMT = {};
  function partes(ms, tz) {
    var f = FMT[tz] || (FMT[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    }));
    var o = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10); });
    if (o.hour === 24) o.hour = 0;
    return o;
  }
  function desfase(ms, tz) {
    var p = partes(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(ms / 60000) * 60000;
  }
  // hora "de reloj" en la zona del coach → instante UTC (ms)
  function relojAUtc(y, m, d, minutos, tz) {
    var guess = Date.UTC(y, m - 1, d, 0, minutos);
    var o1 = desfase(guess, tz), t = guess - o1, o2 = desfase(t, tz);
    return o2 === o1 ? t : guess - o2;
  }

  function tzLocal() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Santiago'; } catch (e) { return 'America/Santiago'; } }
  function dosD(n) { return (n < 10 ? '0' : '') + n; }
  function hora(ms) { var d = new Date(ms); return dosD(d.getHours()) + ':' + dosD(d.getMinutes()); }
  function claveDia(ms) { var d = new Date(ms); return d.getFullYear() + '-' + dosD(d.getMonth() + 1) + '-' + dosD(d.getDate()); }
  function etiquetaDia(ms) { var d = new Date(ms); return DSEM[d.getDay()] + ' ' + d.getDate() + ' ' + MES[d.getMonth()]; }
  function fecha(iso) { var ms = new Date(iso).getTime(); return etiquetaDia(ms) + ' · ' + hora(ms); }

  async function cargar(sb, coachId, tz) {
    var desde = new Date(), hasta = new Date(Date.now() + (DIAS + 1) * 86400000);
    var rs = await Promise.all([
      sb.from('coach_availability').select('weekday,start_min,end_min').eq('coach_id', coachId),
      sb.rpc('mgl_horarios_ocupados', { p_coach: coachId, p_desde: desde.toISOString(), p_hasta: hasta.toISOString() })
    ]);
    return {
      coachId: coachId,
      tz: tz || 'America/Santiago',
      reglas: (rs[0].data || []),
      ocupados: (rs[1].data || []).map(function (b) { return [new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]; })
    };
  }

  // Horarios libres (ms UTC), ordenados
  function libres(ag, minutos) {
    var dur = (minutos || 60) * 60000, minimo = Date.now() + AVISO_H * 3600000, out = [];
    var hoy = partes(Date.now(), ag.tz);
    for (var i = 0; i <= DIAS; i++) {
      var dia = new Date(Date.UTC(hoy.year, hoy.month - 1, hoy.day + i));
      var y = dia.getUTCFullYear(), m = dia.getUTCMonth() + 1, d = dia.getUTCDate(), dow = dia.getUTCDay();
      ag.reglas.forEach(function (r) {
        if (Number(r.weekday) !== dow) return;
        for (var t = Number(r.start_min); t + (minutos || 60) <= Number(r.end_min); t += PASO) {
          var ini = relojAUtc(y, m, d, t, ag.tz), fin = ini + dur;
          if (ini < minimo) continue;
          var choca = ag.ocupados.some(function (o) { return ini < o[1] && fin > o[0]; });
          if (!choca && out.indexOf(ini) < 0) out.push(ini);
        }
      });
    }
    return out.sort(function (a, b) { return a - b; });
  }

  var CSS = ''
    + '.mga-dias{display:flex;gap:8px;overflow-x:auto;padding:2px 0 10px;scrollbar-width:none}'
    + '.mga-dias::-webkit-scrollbar{display:none}'
    + '.mga-dia{flex:0 0 auto;min-width:62px;padding:8px 10px;border-radius:12px;border:1px solid var(--c333333,#333);background:none;color:inherit;font:inherit;cursor:pointer;text-align:center;line-height:1.15}'
    + '.mga-dia small{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;opacity:.7}'
    + '.mga-dia b{font-size:18px}'
    + '.mga-dia.on{background:var(--cd4c5a9,#D4C5A9);border-color:var(--cd4c5a9,#D4C5A9);color:#1C1709}'
    + '.mga-horas{display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:8px}'
    + '.mga-h{padding:10px 0;border-radius:10px;border:1px solid var(--c333333,#333);background:none;color:inherit;font:inherit;font-size:15px;font-weight:600;cursor:pointer}'
    + '.mga-h:hover{border-color:var(--cd4c5a9,#D4C5A9)}'
    + '.mga-h.on{background:var(--cd4c5a9,#D4C5A9);border-color:var(--cd4c5a9,#D4C5A9);color:#1C1709}'
    + '.mga-nota{font-size:12.5px;color:var(--c8a8a8a,#8a8a8a);margin-top:10px;line-height:1.4}'
    + '.mga-vacio{font-size:14px;color:var(--c8a8a8a,#8a8a8a);padding:10px 0;line-height:1.5}';

  function selector(el, ag, opts) {
    opts = opts || {};
    if (!document.getElementById('mga-css')) {
      var st = document.createElement('style'); st.id = 'mga-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var lista = libres(ag, opts.minutos);
    if (!lista.length) {
      el.innerHTML = '<div class="mga-vacio">No quedan horarios libres en las próximas 3 semanas. Escríbele al coach para coordinar.</div>';
      if (opts.alElegir) opts.alElegir(null);
      return;
    }
    var porDia = {}, orden = [];
    lista.forEach(function (ms) { var k = claveDia(ms); if (!porDia[k]) { porDia[k] = []; orden.push(k); } porDia[k].push(ms); });
    var diaSel = orden[0], elegido = null;
    var otraZona = tzLocal() !== ag.tz;

    function pintar() {
      var h = '<div class="mga-dias">';
      orden.forEach(function (k) {
        var ms = porDia[k][0], d = new Date(ms);
        h += '<button type="button" class="mga-dia' + (k === diaSel ? ' on' : '') + '" data-d="' + k + '"><small>' + DSEM[d.getDay()] + '</small><b>' + d.getDate() + '</b><small>' + MES[d.getMonth()] + '</small></button>';
      });
      h += '</div><div class="mga-horas">';
      porDia[diaSel].forEach(function (ms) {
        h += '<button type="button" class="mga-h' + (ms === elegido ? ' on' : '') + '" data-t="' + ms + '">' + hora(ms) + '</button>';
      });
      h += '</div><div class="mga-nota">Horarios en tu hora local' + (otraZona ? ' (' + tzLocal().replace(/_/g, ' ') + '). El coach está en ' + ag.tz.replace(/_/g, ' ') + '.' : '.') + '</div>';
      el.innerHTML = h;
    }
    el.onclick = function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.getAttribute('data-d')) { diaSel = b.getAttribute('data-d'); pintar(); return; }
      if (b.getAttribute('data-t')) {
        elegido = Number(b.getAttribute('data-t')); pintar();
        if (opts.alElegir) opts.alElegir(new Date(elegido).toISOString());
      }
    };
    pintar();
  }

  // Link para agregar la sesión a Google Calendar
  function linkCalendario(titulo, isoIni, isoFin, detalle) {
    function f(iso) { return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(titulo)
      + '&dates=' + f(isoIni) + '/' + f(isoFin) + '&details=' + encodeURIComponent(detalle || '');
  }

  window.MGLAgenda = { cargar: cargar, libres: libres, selector: selector, fecha: fecha, hora: hora,
                       linkCalendario: linkCalendario, relojAUtc: relojAUtc, tzLocal: tzLocal };
})();
