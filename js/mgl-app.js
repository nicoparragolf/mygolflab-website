/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab / Coach Hub · Ajustes cuando la web corre dentro de la app
   Archivo: /js/mgl-app.js
   Versión: 1.1 · 2026-11-07 (descargas nativas en la app)

   La app de Coach Hub (carpeta app-movil/, hecha con Capacitor) carga esta
   misma web. En el navegador normal este script no hace nada.

   Dentro de la app:
   1. Marca el <html> con las clases "en-app" y "en-ios" / "en-android",
      para poder ajustar estilos (ej. html.en-app .solo-web{display:none}).
   2. En iOS oculta los links a páginas de precios/planes: Apple no permite
      vender suscripciones digitales dentro de la app sin su sistema de pago.
      Los planes se contratan en la web.
   3. Login con Google / Apple: Google bloquea su login dentro de una app
      embebida, así que se abre en el navegador del sistema y vuelve a la
      app con mygolflab://auth (requiere esa URL en Supabase →
      Authentication → URL Configuration → Redirect URLs).

   Uso en las páginas de login:
     <script src="/js/mgl-app.js"></script>
     ...
     if (window.MGLApp && MGLApp.esApp()) {
       MGLApp.oauth(sb, 'google', function (msg) { mostrarError(msg); });
     }

   Sin template literals (el editor de GitHub los corrompe).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLApp) return;

  var CAP = window.Capacitor;
  var nativo = !!(CAP && CAP.isNativePlatform && CAP.isNativePlatform());
  var ua = navigator.userAgent || '';
  var esApp = nativo || ua.indexOf('CoachHubApp') > -1;
  var plataforma = nativo && CAP.getPlatform ? CAP.getPlatform()
    : (esApp ? (/iPhone|iPad|iPod/.test(ua) ? 'ios' : 'android') : 'web');

  var REDIRECT = 'mygolflab://auth';

  function plugin(nombre) {
    return (CAP && CAP.Plugins && CAP.Plugins[nombre]) || null;
  }

  // ── 1 y 2. Clases y estilos ──
  if (esApp) {
    var html = document.documentElement;
    html.classList.add('en-app');
    html.classList.add(plataforma === 'ios' ? 'en-ios' : 'en-android');

    var css = 'html.en-app .solo-web{display:none!important}';
    if (plataforma === 'ios') {
      css += 'html.en-ios a[href*="pricing.html"],html.en-ios .solo-web-ios{display:none!important}';
    }
    var st = document.createElement('style');
    st.id = 'mgl-app-css';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ── 3. Login con Google / Apple fuera del WebView ──
  var escuchando = false;

  function leerParams(url) {
    var out = {};
    var partes = [];
    var q = url.indexOf('?');
    var h = url.indexOf('#');
    if (q > -1) partes.push(url.slice(q + 1, h > q ? h : undefined));
    if (h > -1) partes.push(url.slice(h + 1));
    partes.forEach(function (p) {
      new URLSearchParams(p).forEach(function (v, k) { out[k] = v; });
    });
    return out;
  }

  function escucharVuelta(sb, onError) {
    if (escuchando) return;
    var App = plugin('App');
    if (!App) return;
    escuchando = true;
    App.addListener('appUrlOpen', async function (ev) {
      var url = (ev && ev.url) || '';
      if (url.indexOf(REDIRECT) !== 0) return;
      var Browser = plugin('Browser');
      if (Browser) { try { await Browser.close(); } catch (e) {} }

      var p = leerParams(url);
      try {
        if (p.error || p.error_description) {
          throw new Error(p.error_description || p.error);
        }
        if (p.access_token && p.refresh_token) {
          var r1 = await sb.auth.setSession({ access_token: p.access_token, refresh_token: p.refresh_token });
          if (r1.error) throw r1.error;
        } else if (p.code) {
          var r2 = await sb.auth.exchangeCodeForSession(p.code);
          if (r2.error) throw r2.error;
        } else {
          throw new Error('No llegaron los datos de la sesión.');
        }
        // onAuthStateChange de la página se encarga de redirigir
      } catch (e) {
        if (onError) onError('No se pudo iniciar sesión: ' + (e.message || e));
      }
    });
  }

  async function oauth(sb, provider, onError) {
    var nombre = provider === 'apple' ? 'Apple' : 'Google';
    var Browser = plugin('Browser');
    if (!Browser) {
      if (onError) onError('Actualiza la app para entrar con ' + nombre + '.');
      return;
    }
    escucharVuelta(sb, onError);
    var r = await sb.auth.signInWithOAuth({
      provider: provider,
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true }
    });
    if (r.error || !r.data || !r.data.url) {
      if (onError) onError('Error con ' + nombre + ': ' + ((r.error && r.error.message) || 'sin respuesta'));
      return;
    }
    try {
      await Browser.open({ url: r.data.url, presentationStyle: 'popover' });
    } catch (e) {
      if (onError) onError('No se pudo abrir el login de ' + nombre + '.');
    }
  }

  // ── 4. Descargas dentro de la app ──
  // El WebView de iOS ignora <a download>, así que en la app el archivo se
  // baja de forma nativa a la caché y se abre la hoja de compartir del
  // teléfono ("Guardar video", "Guardar en Archivos", WhatsApp, etc.).
  // Plugins: @capacitor/file-transfer, @capacitor/filesystem, @capacitor/share
  // (vienen desde la versión de la app con descargas; las anteriores caen al
  // plan B: abrir el archivo en el navegador interno con Browser).

  function nombreSeguro(nombre) {
    var n = String(nombre || 'archivo').replace(/[\/\\:*?"<>|#%]+/g, '-').trim();
    return n || 'archivo';
  }

  function cancelado(e) {
    var m = String((e && (e.message || e.errorMessage)) || e || '').toLowerCase();
    return m.indexOf('cancel') > -1;
  }

  async function compartirArchivo(uri, nombre) {
    var Share = plugin('Share');
    try {
      await Share.share({ title: nombre, files: [uri] });
    } catch (e) {
      if (!cancelado(e)) throw e;
    }
  }

  function puedeGuardarNativo() {
    return nativo && !!plugin('Filesystem') && !!plugin('Share');
  }

  // Devuelve true si la app se encargó de la descarga (o del plan B).
  // false = no estamos en la app; la página sigue con su <a download> normal.
  async function guardarDesdeUrl(url, nombre) {
    if (!nativo) return false;
    nombre = nombreSeguro(nombre);
    var FileTransfer = plugin('FileTransfer');

    if (!puedeGuardarNativo() || !FileTransfer) {
      var Browser = plugin('Browser');
      if (Browser) { await Browser.open({ url: url, presentationStyle: 'popover' }); return true; }
      window.open(url, '_blank');
      return true;
    }

    var Filesystem = plugin('Filesystem');
    try { await Filesystem.deleteFile({ path: nombre, directory: 'CACHE' }); } catch (e) {}
    var dest = await Filesystem.getUri({ path: nombre, directory: 'CACHE' });
    // La URL firmada de Supabase ya viene codificada: no volver a codificarla
    var r = await FileTransfer.downloadFile({ url: url, path: dest.uri, shouldEncodeUrlParams: false });
    await compartirArchivo((r && r.path) || dest.uri, nombre);
    return true;
  }

  function blobABase64(blob) {
    return new Promise(function (ok, mal) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        ok(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = function () { mal(fr.error || new Error('No se pudo leer el archivo')); };
      fr.readAsDataURL(blob);
    });
  }

  // Para archivos generados en la página (ej. la grabación del analizador)
  async function guardarBlob(blob, nombre) {
    if (!nativo) return false;
    nombre = nombreSeguro(nombre);
    if (!puedeGuardarNativo()) {
      throw new Error('Actualiza la app para poder guardar archivos.');
    }
    var Filesystem = plugin('Filesystem');
    var data = await blobABase64(blob);
    var w = await Filesystem.writeFile({ path: nombre, data: data, directory: 'CACHE' });
    await compartirArchivo(w.uri, nombre);
    return true;
  }

  window.MGLApp = {
    esApp: function () { return esApp; },
    esNativo: function () { return nativo; },
    plataforma: function () { return plataforma; },
    oauth: oauth,
    guardarDesdeUrl: guardarDesdeUrl,
    guardarBlob: guardarBlob
  };
})();
