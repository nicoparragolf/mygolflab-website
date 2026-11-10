/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Elegir medio de pago (Webpay con Flow o Mercado Pago)
   Archivo: /js/mgl-pago.js
   Versión: 1.0 · 2026-11-10

   Uso:
     MGLPago.pagar({ tipo: 'clase', id: lessonId, token: accessToken, total: '$42.000' })
       → muestra la hoja para elegir el medio (si hay más de uno activo),
         crea el cobro en el servidor y lleva al alumno al pago.
       → devuelve una promesa: { ok:false, cancelado:true } si cerró la hoja,
         { ok:false, error:'…' } si falló. Si todo sale bien, la página se va.
     MGLPago.enApp()  → true dentro de la app (iPhone / Android).
       Las tiendas no permiten cobrar servicios digitales dentro de la app con
       otro medio que el suyo, ni mandar a pagar a la web: en la app no se
       muestran botones de compra (las páginas usan class="solo-web").

   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLPago) return;

  var MEDIOS = null;   // { flow: bool, mp: bool }

  function enApp() {
    if (window.MGLApp && MGLApp.esApp) return MGLApp.esApp();
    var CAP = window.Capacitor;
    return !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform()) || /CoachHubApp/.test(navigator.userAgent || '');
  }

  async function medios() {
    if (MEDIOS) return MEDIOS;
    try {
      var r = await fetch('/api/pago-crear', { method: 'GET' });
      var j = await r.json();
      MEDIOS = (j && j.medios) || { flow: false, mp: false };
    } catch (e) { MEDIOS = { flow: true, mp: false }; }
    return MEDIOS;
  }

  var CSS = ''
    + '.mglp-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;font-family:Barlow,system-ui,sans-serif}'
    + '@media(min-width:700px){.mglp-ov{align-items:center}}'
    + '.mglp,.mglp *{box-sizing:border-box}'
    + '.mglp{width:100%;max-width:440px;background:var(--c111111,#111);color:var(--cf5f5f5,#f5f5f5);border:1px solid var(--c333333,#333);border-radius:20px 20px 0 0;padding:22px 20px calc(20px + env(safe-area-inset-bottom));box-shadow:0 -10px 40px rgba(0,0,0,.4)}'
    + '@media(min-width:700px){.mglp{border-radius:20px}}'
    + '.mglp h3{font-family:"Bebas Neue",sans-serif;font-size:28px;letter-spacing:1px;margin:0;line-height:1}'
    + '.mglp .sub{color:var(--c8a8a8a,#8a8a8a);font-size:14px;margin-top:6px}'
    + '.mglp .tot{display:flex;justify-content:space-between;align-items:baseline;margin:16px 0 14px;padding:12px 14px;border-radius:12px;background:var(--c1a1a1a,#1a1a1a);border:1px solid var(--c262626,#262626);font-size:14px;color:var(--c8a8a8a,#8a8a8a)}'
    + '.mglp .tot b{font-family:"Bebas Neue",sans-serif;font-size:26px;letter-spacing:.5px;color:var(--cd4c5a9,#D4C5A9)}'
    + '.mglp .m{display:flex;align-items:center;gap:14px;width:100%;padding:14px 16px;margin-top:10px;border-radius:14px;border:1px solid var(--c333333,#333);background:var(--c161616,#161616);color:inherit;cursor:pointer;text-align:left;font:inherit}'
    + '.mglp .m:hover{border-color:var(--cd4c5a9,#D4C5A9)}'
    + '.mglp .m:disabled{opacity:.5;cursor:default}'
    + '.mglp .lg{flex:0 0 auto;width:62px;height:40px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;letter-spacing:.2px}'
    + '.mglp .lg.wp{background:#fff;color:#d6001c}'
    + '.mglp .lg.mp{background:#00b1ea;color:#fff}'
    + '.mglp .m b{display:block;font-size:16px;font-weight:600}'
    + '.mglp .m small{display:block;color:var(--c8a8a8a,#8a8a8a);font-size:12.5px;margin-top:2px}'
    + '.mglp .sec{display:flex;gap:8px;align-items:center;justify-content:center;color:var(--c8a8a8a,#8a8a8a);font-size:12.5px;margin-top:14px}'
    + '.mglp .sec svg{width:15px;height:15px}'
    + '.mglp .x{display:block;width:100%;margin-top:10px;padding:12px;background:none;border:none;color:var(--c8a8a8a,#8a8a8a);font:inherit;font-size:15px;cursor:pointer}'
    + '.mglp .err{color:#e06a6a;font-size:13.5px;margin-top:10px;display:none}';

  // Hoja para elegir el medio. elegir(medio) devuelve una promesa: si falla,
  // la hoja muestra el error y sigue abierta para reintentar u otro medio.
  function hoja(opts, disponibles, elegir) {
    return new Promise(function (resolve) {
      if (!document.getElementById('mglp-css')) {
        var st = document.createElement('style'); st.id = 'mglp-css'; st.textContent = CSS;
        document.head.appendChild(st);
      }
      var ov = document.createElement('div');
      ov.className = 'mglp-ov';
      var h = '<div class="mglp" role="dialog" aria-modal="true">'
        + '<h3>Elige cómo pagar</h3>'
        + '<div class="sub">' + (opts.tipo === 'contenido' ? 'Pago seguro. Quedas con acceso apenas se confirma.' : 'Pago seguro. Tu coach recibe la clase apenas se confirma.') + '</div>'
        + (opts.total ? '<div class="tot"><span>Total a pagar</span><b>' + opts.total + '</b></div>' : '<div style="height:8px"></div>');
      if (disponibles.flow) h += '<button type="button" class="m" data-m="flow"><span class="lg wp">Webpay</span><span><b>Webpay</b><small>Tarjetas de crédito, débito y prepago</small></span></button>';
      if (disponibles.mp) h += '<button type="button" class="m" data-m="mp"><span class="lg mp">MP</span><span><b>Mercado Pago</b><small>Saldo de Mercado Pago o tus tarjetas guardadas</small></span></button>';
      h += '<div class="sec"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>CoachYard no guarda los datos de tu tarjeta</div>'
        + '<div class="err"></div>'
        + '<button type="button" class="x">Cancelar</button></div>';
      ov.innerHTML = h;
      document.body.appendChild(ov);
      var ocupado = false;
      function cerrar(v) { if (ov.parentNode) ov.parentNode.removeChild(ov); resolve(v); }
      ov.addEventListener('click', async function (e) {
        if (ocupado) return;
        if (e.target === ov || (e.target.classList && e.target.classList.contains('x'))) { cerrar({ ok: false, cancelado: true }); return; }
        var b = e.target.closest && e.target.closest('.m');
        if (!b) return;
        ocupado = true;
        var botones = ov.querySelectorAll('.m, .x');
        for (var i = 0; i < botones.length; i++) botones[i].disabled = true;
        var small = b.querySelector('small'), antes = small.textContent, err = ov.querySelector('.err');
        var medio = b.getAttribute('data-m');
        small.textContent = 'Abriendo ' + (medio === 'mp' ? 'Mercado Pago' : 'Webpay') + '…';
        err.style.display = 'none';
        try { await elegir(medio); resolve({ ok: true }); }
        catch (x) {
          small.textContent = antes;
          err.textContent = x.message; err.style.display = 'block';
          for (var k = 0; k < botones.length; k++) botones[k].disabled = false;
          ocupado = false;
        }
      });
    });
  }

  async function crear(opts, medio) {
    var ruta = opts.tipo === 'contenido' ? '/api/contenido-pagar' : '/api/pago-crear';
    var cuerpo = opts.tipo === 'contenido' ? { purchase_id: opts.id, medio: medio } : { lesson_id: opts.id, medio: medio };
    var resp = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.token },
      body: JSON.stringify(cuerpo)
    });
    var j = await resp.json().catch(function () { return {}; });
    if (resp.ok && j.url) return j.url;
    var e = new Error(j.error || 'No se pudo abrir el pago');
    e.noConfigurado = resp.status === 503;
    e.codigo = j.codigo || '';
    throw e;
  }

  // En el navegador: se va a la página de pago. En la app (solo videollamadas
  // en vivo, que las tiendas permiten cobrar por fuera): se abre la ventana de
  // pago dentro de la app y, al cerrarla, se vuelve a la clase.
  var VOLVER = null;
  function ir(url) {
    var CAP = window.Capacitor, Browser = CAP && CAP.Plugins && CAP.Plugins.Browser;
    if (enApp() && Browser) {
      if (!ir.escuchando && Browser.addListener) {
        ir.escuchando = true;
        Browser.addListener('browserFinished', function () {
          if (!VOLVER) return;
          var r = VOLVER; VOLVER = null;
          if (window.MGLnav) MGLnav.href = r; else location.href = r;
        });
      }
      return Browser.open({ url: url, presentationStyle: 'fullscreen' });
    }
    try { window.top.location.href = url; } catch (e) { location.href = url; }
  }

  async function pagar(opts) {
    // en la app solo se cobran las videollamadas en vivo 1 a 1 (opts.envivo)
    if (enApp() && !opts.envivo) return { ok: false, error: 'No disponible en la app' };
    VOLVER = opts.tipo === 'clase' ? '/es/coachhub/clases.html?clase=' + encodeURIComponent(opts.id) : null;
    var m = await medios();
    var lista = Object.keys(m).filter(function (k) { return m[k]; });
    if (!lista.length) return { ok: false, error: 'Los pagos aún no están activos', noConfigurado: true };
    if (lista.length === 1) {
      try { await ir(await crear(opts, lista[0])); return { ok: true, enApp: enApp() }; }
      catch (e) { return { ok: false, error: e.message, noConfigurado: e.noConfigurado, codigo: e.codigo }; }
    }
    var r = await hoja(opts, m, async function (medio) { await ir(await crear(opts, medio)); });
    if (r && r.ok) r.enApp = enApp();
    return r;
  }

  // Después de pagar en la web desde el teléfono: ofrecer volver a la app
  function esMovil() { return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''); }
  function ofrecerApp(o) {
    if (enApp() || !esMovil()) return false;
    if (!document.getElementById('mglp-css')) {
      var st = document.createElement('style'); st.id = 'mglp-css'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    var ov = document.createElement('div');
    ov.className = 'mglp-ov';
    var href = 'mygolflab://abrir?ruta=' + encodeURIComponent(o.ruta || '/es/coachhub/clases.html');
    ov.innerHTML = '<div class="mglp" role="dialog" aria-modal="true" style="text-align:center">'
      + '<div style="width:64px;height:64px;border-radius:50%;margin:4px auto 14px;display:flex;align-items:center;justify-content:center;background:rgba(143,209,158,.12);border:2px solid #8fd19e">'
      + '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#8fd19e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>'
      + '<h3>' + (o.titulo || '¡Pago recibido!') + '</h3>'
      + '<div class="sub" style="margin-bottom:6px">' + (o.texto || '') + '</div>'
      + '<a class="m" href="' + href + '" style="justify-content:center;background:var(--cd4c5a9,#D4C5A9);color:#1C1709;border-color:transparent;text-decoration:none;margin-top:16px">'
      +   '<span><b>Abrir en la app CoachYard</b></span></a>'
      + '<button type="button" class="x">Seguir en la web</button></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || (e.target.classList && e.target.classList.contains('x'))) { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    });
    return true;
  }

  window.MGLPago = { pagar: pagar, medios: medios, enApp: enApp, ofrecerApp: ofrecerApp };
})();
