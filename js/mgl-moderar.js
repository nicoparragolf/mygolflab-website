/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Reportar y bloquear usuarios
   Archivo: /js/mgl-moderar.js
   Versión: 1.0 · 2026-11-19

   Apple exige (guía 1.2) que en las apps donde los usuarios se escriben o
   publican contenido se pueda reportar y bloquear a otra persona.
   Requiere sql/coach_hub_moderacion.sql.

   Uso:
     MGLModerar.menu(sb, {
       titulo: 'Juan Pérez',
       contexto: 'mensaje' | 'grupo' | 'perfil_coach' | 'contenido',
       ref: id del chat (player_id), grupo, coach o colección,
       evidencia: texto opcional (ej. últimos mensajes),
       bloqueo: { bloqueado: bool, cambiar: async function(on){ ... return true; } }   // opcional
     });
     MGLModerar.reportar(sb, { contexto, ref, evidencia, reportado })
     MGLModerar.bloqueados(sb) → Promise<{ user_id: true }>

   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLModerar) return;

  var MOTIVOS = [
    ['spam', 'Spam o publicidad'],
    ['acoso', 'Acoso o lenguaje ofensivo'],
    ['inapropiado', 'Contenido sexual o inapropiado'],
    ['estafa', 'Estafa o cobro sospechoso'],
    ['suplantacion', 'Se hace pasar por otra persona'],
    ['menor', 'Pone en riesgo a un menor'],
    ['otro', 'Otro motivo']
  ];

  var CSS = ''
    + '.mglm-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;font-family:Barlow,system-ui,sans-serif}'
    + '@media(min-width:700px){.mglm-ov{align-items:center}}'
    + '.mglm,.mglm *{box-sizing:border-box}'
    + '.mglm{width:100%;max-width:440px;max-height:92vh;overflow-y:auto;background:var(--c111111,#111);color:var(--cf5f5f5,#f5f5f5);border:1px solid var(--c333333,#333);border-radius:20px 20px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom))}'
    + '@media(min-width:700px){.mglm{border-radius:20px}}'
    + '.mglm h3{font-family:"Bebas Neue",sans-serif;font-size:28px;letter-spacing:1px;margin:0;line-height:1}'
    + '.mglm .sub{color:var(--c8a8a8a,#8a8a8a);font-size:14px;margin-top:6px;line-height:1.45}'
    + '.mglm .op{display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;margin-top:10px;border-radius:14px;border:1px solid var(--c333333,#333);background:var(--c161616,#161616);color:inherit;cursor:pointer;text-align:left;font:inherit;font-size:16px}'
    + '.mglm .op:hover{border-color:var(--cd4c5a9,#D4C5A9)}'
    + '.mglm .op.rojo{color:#f87171}'
    + '.mglm .op small{display:block;color:var(--c8a8a8a,#8a8a8a);font-size:12.5px;margin-top:2px}'
    + '.mglm .rad{display:flex;align-items:center;gap:10px;padding:11px 12px;margin-top:8px;border-radius:12px;border:1px solid var(--c262626,#262626);background:var(--c161616,#161616);cursor:pointer;font-size:15px}'
    + '.mglm .rad input{accent-color:#D4C5A9;width:18px;height:18px;margin:0}'
    + '.mglm textarea{width:100%;min-height:80px;margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--c333333,#333);background:var(--c161616,#161616);color:inherit;font:inherit;font-size:15px;resize:vertical}'
    + '.mglm .ok{display:block;width:100%;margin-top:14px;padding:14px;border:none;border-radius:14px;background:#D4C5A9;color:#1C1709;font:inherit;font-weight:700;font-size:16px;cursor:pointer}'
    + '.mglm .ok:disabled{opacity:.5;cursor:default}'
    + '.mglm .x{display:block;width:100%;margin-top:8px;padding:12px;background:none;border:none;color:var(--c8a8a8a,#8a8a8a);font:inherit;font-size:15px;cursor:pointer}'
    + '.mglm .err{color:#f87171;font-size:13.5px;margin-top:10px;min-height:1px}'
    + '.mglm .nota{color:var(--c8a8a8a,#8a8a8a);font-size:12.5px;margin-top:10px;line-height:1.45}';

  function css() {
    if (document.getElementById('mglm-css')) return;
    var s = document.createElement('style'); s.id = 'mglm-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hoja(html) {
    css();
    var ov = document.createElement('div');
    ov.className = 'mglm-ov';
    ov.innerHTML = '<div class="mglm" role="dialog" aria-modal="true">' + html + '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) cerrar(ov); });
    document.body.appendChild(ov);
    return ov;
  }
  function cerrar(ov) { if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  function aviso(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    var ov = hoja('<h3>Listo</h3><div class="sub">' + esc(msg) + '</div><button class="ok" type="button">Entendido</button>');
    ov.querySelector('.ok').onclick = function () { cerrar(ov); };
  }

  // ── Menú: Reportar / Bloquear ──
  function menu(sb, o) {
    var b = o.bloqueo;
    var html = '<h3>' + esc(o.titulo || 'Opciones') + '</h3>'
      + '<button class="op" type="button" data-a="rep"><span>⚑</span><span>Reportar<small>Avísanos si algo no está bien. Lo revisamos en menos de 24 horas.</small></span></button>';
    if (b) {
      html += b.bloqueado
        ? '<button class="op" type="button" data-a="desb"><span>⊘</span><span>Desbloquear<small>Podrán volver a escribirse.</small></span></button>'
        : '<button class="op rojo" type="button" data-a="blq"><span>⊘</span><span>Bloquear<small>No podrá escribirte y dejarás de ver sus mensajes.</small></span></button>';
    }
    html += '<button class="x" type="button">Cancelar</button>';
    var ov = hoja(html);
    ov.querySelector('.x').onclick = function () { cerrar(ov); };
    ov.querySelector('[data-a="rep"]').onclick = function () { cerrar(ov); reportar(sb, o); };
    var bb = ov.querySelector('[data-a="blq"]') || ov.querySelector('[data-a="desb"]');
    if (bb) bb.onclick = function () { cerrar(ov); confirmarBloqueo(o); };
  }

  function confirmarBloqueo(o) {
    var on = !o.bloqueo.bloqueado;
    var ov = hoja(on
      ? '<h3>¿Bloquear?</h3><div class="sub">' + esc(o.titulo || 'Esta persona') + ' no podrá enviarte mensajes y dejarás de ver los suyos. No se le avisa. Puedes desbloquear cuando quieras desde este mismo menú.</div>'
        + '<button class="ok" type="button" style="background:#f87171;color:#fff">Bloquear</button><button class="x" type="button">Cancelar</button>'
      : '<h3>¿Desbloquear?</h3><div class="sub">Podrán volver a escribirse.</div>'
        + '<button class="ok" type="button">Desbloquear</button><button class="x" type="button">Cancelar</button>');
    ov.querySelector('.x').onclick = function () { cerrar(ov); };
    var btn = ov.querySelector('.ok');
    btn.onclick = async function () {
      btn.disabled = true;
      var ok = false;
      try { ok = await o.bloqueo.cambiar(on); } catch (e) { ok = false; }
      cerrar(ov);
      aviso(ok ? (on ? 'Bloqueado. Ya no recibirás sus mensajes.' : 'Desbloqueado.') : 'No se pudo cambiar. Intenta de nuevo.');
    };
  }

  // ── Formulario de reporte ──
  function reportar(sb, o) {
    var html = '<h3>Reportar</h3><div class="sub">¿Qué está pasando? Tu reporte es anónimo para la otra persona.</div>';
    MOTIVOS.forEach(function (m, i) {
      html += '<label class="rad"><input type="radio" name="mglm-mot" value="' + m[0] + '"' + (i === 0 ? '' : '') + '><span>' + esc(m[1]) + '</span></label>';
    });
    html += '<textarea id="mglm-det" maxlength="2000" placeholder="Cuéntanos más (opcional)"></textarea>'
      + '<div class="err" id="mglm-err"></div>'
      + '<button class="ok" type="button" disabled>Enviar reporte</button><button class="x" type="button">Cancelar</button>'
      + '<div class="nota">Si alguien está en peligro, contacta de inmediato a las autoridades de tu país.</div>';
    var ov = hoja(html);
    var btn = ov.querySelector('.ok');
    ov.querySelector('.x').onclick = function () { cerrar(ov); };
    Array.prototype.forEach.call(ov.querySelectorAll('input[name="mglm-mot"]'), function (r) {
      r.onchange = function () { btn.disabled = false; };
    });
    btn.onclick = async function () {
      var sel = ov.querySelector('input[name="mglm-mot"]:checked');
      if (!sel) return;
      btn.disabled = true; btn.textContent = 'Enviando…';
      var r = await sb.rpc('mgl_reportar', {
        p_context: o.contexto, p_ref: String(o.ref || ''), p_reason: sel.value,
        p_details: (ov.querySelector('#mglm-det').value || '').trim() || null,
        p_evidence: o.evidencia || null, p_reported: o.reportado || null
      });
      if (r.error) {
        btn.disabled = false; btn.textContent = 'Enviar reporte';
        ov.querySelector('#mglm-err').textContent = /JWT|sesi/i.test(r.error.message) ? 'Inicia sesión para reportar.' : 'No se pudo enviar: ' + r.error.message;
        return;
      }
      cerrar(ov);
      aviso('Gracias. Recibimos tu reporte y lo revisaremos en menos de 24 horas.');
    };
  }

  async function bloqueados(sb) {
    var out = {};
    try {
      var r = await sb.from('user_blocks').select('blocked_id');
      (r.data || []).forEach(function (x) { out[x.blocked_id] = true; });
    } catch (e) {}
    return out;
  }

  window.MGLModerar = { menu: menu, reportar: reportar, bloqueados: bloqueados };
})();
