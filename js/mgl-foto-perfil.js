/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Foto de perfil del jugador
   Archivo: /js/mgl-foto-perfil.js
   Versión: 1.0 · 2026-11-23

   Igual que la foto del coach en la vitrina: hoja con opciones (ajustar la
   actual / elegir otra / quitar) y recortador cuadrado (mover, acercar, girar).
   Sube a coach-public/{user_id}/avatar/foto-{fecha}.jpg y la guarda en:
     · la cuenta (user_metadata.avatar_url) → foto del menú y del header
     · profiles.avatar_url y players.photo_url → la ve su coach
   (función mgl_set_mi_foto, sql/coach_hub_foto_jugador.sql)

   Uso:
     MGLFoto.abrir({ sb: clienteSupabase, user: session.user, actual: urlActual,
                     onCambio: function(urlNueva){ ... } });

   Opciones extra (para que el coach ponga la foto de un alumno):
     carpeta: 'uid-coach/jugadores/id-ficha'  → dónde se sube la foto
     guardar: async function(url){ return {error} }  → reemplaza el guardado
              en la cuenta propia (url null = quitar la foto)
     titulo:  texto del encabezado de la hoja

   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLFoto) return;

  var SB_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
  var BUCKET = 'coach-public';
  var O = null;      // opciones de la llamada actual
  var CROP = null;   // estado del recortador

  var CSS = ''
    + '.mfp-bg{position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;padding:16px;font-family:Barlow,system-ui,sans-serif}'
    + '.mfp-bg.on{display:flex}'
    + '.mfp,.mfp *{box-sizing:border-box}'
    + '.mfp{width:100%;max-width:400px;max-height:94vh;overflow-y:auto;background:var(--c111111,#111);color:var(--cf5f5f5,#f5f5f5);border:1px solid var(--c333333,#333);border-radius:18px;padding:22px}'
    + '.mfp h3{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:24px;margin:0 0 14px}'
    + '.mfp-ph{width:110px;height:110px;border-radius:50%;overflow:hidden;margin:0 auto 14px;border:2px solid var(--c7d7259,#7D7259);background:var(--c2b2619,#2B2619)}'
    + '.mfp-ph img{width:100%;height:100%;object-fit:cover;display:block}'
    + '.mfp-op{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:var(--c161616,#161616);border:1px solid var(--c262626,#262626);border-radius:12px;padding:12px 14px;margin-top:8px;cursor:pointer;color:inherit;font:inherit}'
    + '.mfp-op:hover{border-color:var(--c7d7259,#7D7259)}'
    + '.mfp-op span{width:34px;height:34px;border-radius:50%;background:rgba(212,197,169,.12);color:var(--cd4c5a9,#D4C5A9);display:flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto}'
    + '.mfp-op b{display:block;font-size:15px}.mfp-op small{color:var(--c8a8a8a,#8a8a8a);font-size:13px}'
    + '.mfp-op.danger span{background:rgba(224,106,106,.12);color:#e06a6a}.mfp-op.danger b{color:#e06a6a}'
    + '.mfp-x{display:block;width:100%;margin-top:10px;padding:11px;background:none;border:none;color:var(--c8a8a8a,#8a8a8a);font:inherit;font-size:15px;cursor:pointer}'
    + '.mfp-stage{position:relative;width:100%;max-width:356px;aspect-ratio:1/1;margin:0 auto;border-radius:16px;overflow:hidden;background:#000;touch-action:none;cursor:grab}'
    + '.mfp-stage canvas{width:100%;height:100%;display:block}'
    + '.mfp-ring{position:absolute;inset:0;pointer-events:none;border-radius:16px;box-shadow:inset 0 0 0 2000px rgba(0,0,0,.45);-webkit-mask:radial-gradient(circle at center,transparent 49.5%,#000 50%);mask:radial-gradient(circle at center,transparent 49.5%,#000 50%)}'
    + '.mfp-hint{color:var(--c8a8a8a,#8a8a8a);font-size:13px;text-align:center;margin-top:10px}'
    + '.mfp-ctrl{display:flex;align-items:center;gap:10px;margin-top:14px}'
    + '.mfp-ctrl input[type=range]{flex:1;accent-color:#D4C5A9}'
    + '.mfp-ic{color:var(--c8a8a8a,#8a8a8a);font-size:20px;width:16px;text-align:center}'
    + '.mfp-btn{border:1px solid var(--c333333,#333);background:none;color:inherit;border-radius:10px;padding:9px 14px;font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:15px;letter-spacing:.4px;text-transform:uppercase;cursor:pointer}'
    + '.mfp-btn.pri{background:#D4C5A9;border-color:#D4C5A9;color:#1C1709}'
    + '.mfp-btn:disabled{opacity:.5;cursor:default}'
    + '.mfp-acts{display:flex;gap:10px;justify-content:flex-end;margin-top:18px}'
    + '.mfp-msg{font-size:13.5px;margin-top:10px;min-height:1px;color:var(--c8a8a8a,#8a8a8a);text-align:center}'
    + '.mfp-msg.err{color:#e06a6a}';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function montar() {
    if ($('mfpSheet')) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var d = document.createElement('div');
    d.innerHTML = ''
      + '<div class="mfp-bg" id="mfpSheet"><div class="mfp">'
      +   '<h3 id="mfpTitulo">Foto de perfil</h3>'
      +   '<div class="mfp-ph" id="mfpPh"></div>'
      +   '<button class="mfp-op" type="button" id="mfpAjustar"><span>✥</span><div><b>Ajustar la foto actual</b><small>Acercar, mover o girar</small></div></button>'
      +   '<button class="mfp-op" type="button" id="mfpElegir"><span>⬆</span><div><b id="mfpElegirT">Elegir otra foto</b><small>De la galería del teléfono o la cámara</small></div></button>'
      +   '<button class="mfp-op danger" type="button" id="mfpQuitar"><span>✕</span><div><b>Quitar foto</b><small>Vuelven a verse las iniciales</small></div></button>'
      +   '<div class="mfp-msg" id="mfpMsg"></div>'
      +   '<button class="mfp-x" type="button" id="mfpCerrar">Cancelar</button>'
      + '</div></div>'
      + '<div class="mfp-bg" id="mfpCrop"><div class="mfp">'
      +   '<h3>Ajusta la foto</h3>'
      +   '<div class="mfp-stage" id="mfpStage"><canvas id="mfpCanvas" width="640" height="640"></canvas><div class="mfp-ring"></div></div>'
      +   '<div class="mfp-hint">Arrastra para mover · pellizca o usa la barra para acercar</div>'
      +   '<div class="mfp-ctrl"><span class="mfp-ic">−</span><input type="range" id="mfpZoom" min="1" max="4" step="0.01" value="1"><span class="mfp-ic">+</span>'
      +   '<button class="mfp-btn" type="button" id="mfpGirar" title="Girar">↻ Girar</button></div>'
      +   '<div class="mfp-msg" id="mfpCropMsg"></div>'
      +   '<div class="mfp-acts"><button class="mfp-btn" type="button" id="mfpCancelar">Cancelar</button><button class="mfp-btn pri" type="button" id="mfpUsar">Usar foto</button></div>'
      + '</div></div>'
      + '<input type="file" id="mfpFile" accept="image/*" style="display:none">';
    document.body.appendChild(d);

    $('mfpCerrar').onclick = cerrarHoja;
    $('mfpSheet').addEventListener('click', function (e) { if (e.target === this) cerrarHoja(); });
    $('mfpElegir').onclick = function () { $('mfpFile').value = ''; $('mfpFile').click(); };
    $('mfpFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.type && f.type.indexOf('image') !== 0) { msg('mfpMsg', 'Elige una imagen (JPG o PNG).', true); return; }
      cerrarHoja(); abrirCrop(f);
    };
    $('mfpAjustar').onclick = async function () {
      var b = this; b.disabled = true;
      try {
        var r = await fetch(O.actual, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var blob = await r.blob();
        cerrarHoja(); abrirCrop(new File([blob], 'foto.jpg', { type: blob.type || 'image/jpeg' }));
      } catch (e) { msg('mfpMsg', 'No se pudo abrir tu foto actual. Elige otra del teléfono.', true); }
      b.disabled = false;
    };
    $('mfpQuitar').onclick = async function () {
      var b = this; b.disabled = true; msg('mfpMsg', 'Quitando…');
      var ok = await guardar(null);
      b.disabled = false;
      if (ok) cerrarHoja();
    };
    eventosCrop();
  }

  function msg(id, t, err) { var m = $(id); if (!m) return; m.textContent = t || ''; m.className = 'mfp-msg' + (err ? ' err' : ''); }
  function cerrarHoja() { $('mfpSheet').classList.remove('on'); msg('mfpMsg', ''); }

  // ── Abrir ──
  function abrir(opts) {
    O = opts || {};
    if (!O.sb || !O.user) return;
    montar();
    $('mfpTitulo').textContent = O.titulo || 'Foto de perfil';
    if (!O.actual) { $('mfpFile').value = ''; $('mfpFile').click(); return; }   // sin foto: directo a elegir
    $('mfpPh').innerHTML = '<img src="' + esc(O.actual) + '" alt="">';
    var esGoogle = /googleusercontent\.com/.test(O.actual);
    $('mfpAjustar').style.display = esGoogle ? 'none' : '';
    $('mfpQuitar').style.display = esGoogle ? 'none' : '';
    $('mfpSheet').classList.add('on');
  }

  // ── Recortador (mismo que la vitrina del coach) ──
  function abrirCrop(file) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      CROP = { img: img, url: url, z: 1, rot: 0, x: 0, y: 0, ptrs: {}, pinch: null, drag: null };
      $('mfpZoom').value = 1; msg('mfpCropMsg', '');
      clamp(); dibujar();
      $('mfpCrop').classList.add('on');
    };
    img.onerror = function () { URL.revokeObjectURL(url); alert('No se pudo abrir la imagen'); };
    img.src = url;
  }
  function cerrarCrop() {
    $('mfpCrop').classList.remove('on');
    if (CROP) { URL.revokeObjectURL(CROP.url); CROP = null; }
  }
  function dims() { var c = CROP; return (c.rot % 180 === 0) ? [c.img.width, c.img.height] : [c.img.height, c.img.width]; }
  function base() { var d = dims(); return 640 / Math.min(d[0], d[1]); }
  function clamp() {
    var c = CROP, s = base() * c.z, d = dims();
    var mx = Math.max(0, (d[0] * s - 640) / 2), my = Math.max(0, (d[1] * s - 640) / 2);
    c.x = Math.max(-mx, Math.min(mx, c.x)); c.y = Math.max(-my, Math.min(my, c.y));
  }
  function pintar(ctx, size) {
    var c = CROP, k = size / 640, s = base() * c.z * k;
    ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2 + c.x * k, size / 2 + c.y * k); ctx.rotate(c.rot * Math.PI / 180);
    ctx.drawImage(c.img, -c.img.width * s / 2, -c.img.height * s / 2, c.img.width * s, c.img.height * s);
    ctx.restore();
  }
  function dibujar() { if (CROP) pintar($('mfpCanvas').getContext('2d'), 640); }
  function zoom(z, cx, cy) {
    var c = CROP, z0 = c.z; z = Math.max(1, Math.min(4, z));
    cx = (cx == null) ? 0 : cx - 320; cy = (cy == null) ? 0 : cy - 320;
    c.x = cx - (cx - c.x) * z / z0; c.y = cy - (cy - c.y) * z / z0;
    c.z = z; $('mfpZoom').value = z; clamp(); dibujar();
  }
  function eventosCrop() {
    var st = $('mfpStage');
    function pos(e) { var r = st.getBoundingClientRect(), k = 640 / r.width; return [(e.clientX - r.left) * k, (e.clientY - r.top) * k]; }
    st.addEventListener('pointerdown', function (e) {
      if (!CROP) return; e.preventDefault();
      try { st.setPointerCapture(e.pointerId); } catch (er) {}
      CROP.ptrs[e.pointerId] = pos(e);
      var ids = Object.keys(CROP.ptrs);
      if (ids.length === 2) {
        var a = CROP.ptrs[ids[0]], b = CROP.ptrs[ids[1]];
        CROP.pinch = { d0: Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), z0: CROP.z }; CROP.drag = null;
      } else if (ids.length === 1) {
        CROP.drag = { sx: CROP.ptrs[ids[0]][0], sy: CROP.ptrs[ids[0]][1], x0: CROP.x, y0: CROP.y };
      }
    });
    st.addEventListener('pointermove', function (e) {
      if (!CROP || !CROP.ptrs[e.pointerId]) return; e.preventDefault();
      CROP.ptrs[e.pointerId] = pos(e);
      var ids = Object.keys(CROP.ptrs);
      if (CROP.pinch && ids.length >= 2) {
        var a = CROP.ptrs[ids[0]], b = CROP.ptrs[ids[1]];
        zoom(CROP.pinch.z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / CROP.pinch.d0, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      } else if (CROP.drag) {
        var p = CROP.ptrs[e.pointerId];
        CROP.x = CROP.drag.x0 + (p[0] - CROP.drag.sx); CROP.y = CROP.drag.y0 + (p[1] - CROP.drag.sy);
        clamp(); dibujar();
      }
    });
    function up(e) {
      if (!CROP) return; delete CROP.ptrs[e.pointerId];
      var ids = Object.keys(CROP.ptrs);
      if (ids.length < 2) CROP.pinch = null;
      if (ids.length === 1) { var p = CROP.ptrs[ids[0]]; CROP.drag = { sx: p[0], sy: p[1], x0: CROP.x, y0: CROP.y }; }
      if (!ids.length) CROP.drag = null;
    }
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    st.addEventListener('wheel', function (e) {
      if (!CROP) return; e.preventDefault();
      var p = pos(e); zoom(CROP.z * Math.exp(-e.deltaY * 0.0022), p[0], p[1]);
    }, { passive: false });
    $('mfpZoom').addEventListener('input', function () { if (CROP) zoom(parseFloat(this.value)); });
    $('mfpGirar').addEventListener('click', function () { if (!CROP) return; CROP.rot = (CROP.rot + 90) % 360; CROP.x = 0; CROP.y = 0; clamp(); dibujar(); });
    $('mfpCancelar').addEventListener('click', cerrarCrop);
    $('mfpCrop').addEventListener('click', function (e) { if (e.target === this) cerrarCrop(); });
    $('mfpUsar').addEventListener('click', function () {
      if (!CROP) return;
      var b = this; b.disabled = true; msg('mfpCropMsg', 'Subiendo…');
      var out = document.createElement('canvas'); out.width = 600; out.height = 600;
      pintar(out.getContext('2d'), 600);
      out.toBlob(async function (blob) {
        if (!blob) { b.disabled = false; msg('mfpCropMsg', 'No se pudo preparar la foto.', true); return; }
        var path = (O.carpeta || (O.user.id + '/avatar')) + '/foto-' + Date.now() + '.jpg';
        var up = await O.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (up.error) { b.disabled = false; msg('mfpCropMsg', 'No se pudo subir: ' + up.error.message, true); return; }
        var url = SB_URL + '/storage/v1/object/public/' + BUCKET + '/' + path;
        var ok = await guardar(url, 'mfpCropMsg');
        b.disabled = false;
        if (ok) cerrarCrop();
      }, 'image/jpeg', 0.9);
    });
  }

  // ── Guardar en la cuenta y en las fichas ──
  async function guardar(url, msgId) {
    msgId = msgId || 'mfpMsg';
    try {
      if (typeof O.guardar === 'function') {
        var rg = await O.guardar(url);
        if (rg && rg.error) throw rg.error;
        O.actual = url;
        if (typeof O.onCambio === 'function') O.onCambio(url);
        return true;
      }
      var r1 = await O.sb.auth.updateUser({ data: { avatar_url: url, picture: url } });
      if (r1.error) throw r1.error;
      var r2 = await O.sb.rpc('mgl_set_mi_foto', { p_url: url });
      if (r2.error) throw r2.error;
      O.actual = url;
      if (typeof O.onCambio === 'function') O.onCambio(url);
      return true;
    } catch (e) {
      msg(msgId, 'No se pudo guardar la foto: ' + (e.message || e), true);
      return false;
    }
  }

  window.MGLFoto = { abrir: abrir };
})();
