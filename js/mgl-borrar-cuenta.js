/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab / Coach Hub · Botón y ventana de "Eliminar cuenta"
   Archivo: /js/mgl-borrar-cuenta.js
   Versión: 1.0 · 2026-11-02

   Uso:
     MGLBorrarCuenta.montar(document.getElementById('zonaCuenta'), {
       sb: clienteSupabase,
       volverA: '/es/coachhub/entrar.html'      // a dónde ir después de borrar
     });

   Llama a /api/borrar-cuenta (borra archivos, datos y el usuario de Auth).
   Sin template literals (el editor de GitHub los rompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var CSS =
    '.mbc-zona{margin-top:44px;border-top:1px solid #262626;padding-top:24px}' +
    '.mbc-zona h3{font-family:"Barlow Condensed",sans-serif;font-size:15px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:#8a8a8a;margin:0 0 6px}' +
    '.mbc-zona p{color:#8a8a8a;font-size:14.5px;line-height:1.5;margin:0 0 14px;max-width:560px}' +
    '.mbc-btn{display:inline-flex;align-items:center;gap:8px;background:transparent;border:1px solid rgba(224,106,106,.45);color:#e06a6a;border-radius:10px;padding:10px 18px;font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:14.5px;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;transition:background .2s}' +
    '.mbc-btn:hover{background:rgba(224,106,106,.08)}' +
    '.mbc-bg{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.72);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:20px}' +
    '.mbc-bg.on{display:flex}' +
    '.mbc-box{width:100%;max-width:440px;background:#141414;border:1px solid #333;border-radius:20px;padding:28px 26px;color:#f5f5f5;font-family:"Barlow",sans-serif}' +
    '.mbc-box h2{font-family:"Bebas Neue",sans-serif;font-size:32px;letter-spacing:1px;margin:0 0 10px;line-height:1}' +
    '.mbc-box p{color:#a3a3a3;font-size:15px;line-height:1.5;margin:0 0 10px}' +
    '.mbc-box ul{margin:0 0 14px 18px;padding:0;color:#a3a3a3;font-size:14.5px;line-height:1.55}' +
    '.mbc-box label{display:block;font-family:"Barlow Condensed",sans-serif;font-size:13px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;color:#8a8a8a;margin:16px 0 7px}' +
    '.mbc-box input{width:100%;box-sizing:border-box;background:#0a0a0a;border:1px solid #333;border-radius:10px;padding:12px 14px;color:#fff;font-size:16px;font-family:inherit;letter-spacing:1px}' +
    '.mbc-box input:focus{outline:none;border-color:#e06a6a}' +
    '.mbc-row{display:flex;gap:10px;margin-top:20px}' +
    '.mbc-row button{flex:1;border-radius:10px;padding:12px;font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:15px;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;border:1px solid #333;background:#1a1a1a;color:#f5f5f5}' +
    '.mbc-row .mbc-del{background:#e06a6a;border-color:#e06a6a;color:#1a0b0b}' +
    '.mbc-row .mbc-del:disabled{opacity:.4;cursor:not-allowed}' +
    '.mbc-err{display:none;margin-top:12px;color:#e06a6a;font-size:14px;line-height:1.45}' +
    '.mbc-err.on{display:block}';

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function montar(contenedor, opts) {
    opts = opts || {};
    if (!contenedor || !opts.sb) return;
    if (!document.getElementById('mbc-css')) {
      var st = document.createElement('style');
      st.id = 'mbc-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }

    contenedor.innerHTML = '';
    var zona = el('section', 'mbc-zona',
      '<h3>Eliminar cuenta</h3>' +
      '<p>Borra tu cuenta de MyGolfLab y Coach Hub junto con tus videos, análisis, mensajes y datos. No se puede deshacer.</p>');
    var btn = el('button', 'mbc-btn', 'Eliminar mi cuenta');
    btn.type = 'button';
    zona.appendChild(btn);
    contenedor.appendChild(zona);

    var bg = el('div', 'mbc-bg',
      '<div class="mbc-box" role="dialog" aria-modal="true" aria-labelledby="mbcTitulo">' +
        '<h2 id="mbcTitulo">¿Eliminar tu cuenta?</h2>' +
        '<p>Se borra para siempre, en MyGolfLab y en Coach Hub (es la misma cuenta):</p>' +
        '<ul>' +
          '<li>Tus videos, fotos y análisis de swing</li>' +
          '<li>Tus mensajes, clases y notas</li>' +
          '<li>Si eres coach: tu vitrina y las fichas de todos tus alumnos</li>' +
        '</ul>' +
        '<p>Si tienes una suscripción pagada, cancélala antes para que no se te cobre de nuevo.</p>' +
        '<label for="mbcInput">Escribe ELIMINAR para confirmar</label>' +
        '<input id="mbcInput" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ELIMINAR">' +
        '<div class="mbc-err" id="mbcErr"></div>' +
        '<div class="mbc-row">' +
          '<button type="button" class="mbc-cancel">Cancelar</button>' +
          '<button type="button" class="mbc-del" disabled>Eliminar</button>' +
        '</div>' +
      '</div>');
    document.body.appendChild(bg);

    var input = bg.querySelector('#mbcInput');
    var del = bg.querySelector('.mbc-del');
    var cancel = bg.querySelector('.mbc-cancel');
    var err = bg.querySelector('#mbcErr');
    var ocupado = false;

    function abrir() {
      input.value = ''; del.disabled = true; err.classList.remove('on');
      bg.classList.add('on');
      setTimeout(function () { input.focus(); }, 50);
    }
    function cerrar() { if (!ocupado) bg.classList.remove('on'); }
    function mostrarError(m) { err.textContent = m; err.classList.add('on'); }

    btn.addEventListener('click', abrir);
    cancel.addEventListener('click', cerrar);
    bg.addEventListener('click', function (e) { if (e.target === bg) cerrar(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
    input.addEventListener('input', function () {
      del.disabled = input.value.trim().toUpperCase() !== 'ELIMINAR';
    });

    del.addEventListener('click', async function () {
      if (del.disabled || ocupado) return;
      ocupado = true; del.disabled = true; cancel.disabled = true;
      del.textContent = 'Eliminando…'; err.classList.remove('on');
      try {
        var s = await opts.sb.auth.getSession();
        var token = s.data && s.data.session && s.data.session.access_token;
        if (!token) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.');
        var r = await fetch('/api/borrar-cuenta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ confirmar: 'ELIMINAR' })
        });
        var data = await r.json().catch(function () { return {}; });
        if (!r.ok) throw new Error(data.error || 'No se pudo eliminar la cuenta.');

        try { await opts.sb.auth.signOut({ scope: 'local' }); } catch (x) {}
        try {
          Object.keys(localStorage).forEach(function (k) {
            if (/^(mgl_|sb-)/.test(k)) localStorage.removeItem(k);
          });
        } catch (x) {}
        bg.querySelector('.mbc-box').innerHTML =
          '<h2>Cuenta eliminada</h2><p>Tu cuenta y tus datos fueron borrados. Gracias por haber sido parte.</p>';
        setTimeout(function () { window.location.href = opts.volverA || '/es/index.html'; }, 2200);
      } catch (e) {
        ocupado = false; cancel.disabled = false; del.disabled = false;
        del.textContent = 'Eliminar';
        mostrarError(e.message || 'No se pudo eliminar la cuenta.');
      }
    });
  }

  window.MGLBorrarCuenta = { montar: montar };
})();
