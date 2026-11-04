/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab / CoachFly · Ajustes cuando la web corre dentro de la app
   Archivo: /js/mgl-app.js
   Versión: 1.0 · 2026-11-02

   La app de CoachFly (carpeta app-movil/, hecha con Capacitor) carga esta
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

  window.MGLApp = {
    esApp: function () { return esApp; },
    esNativo: function () { return nativo; },
    plataforma: function () { return plataforma; },
    oauth: oauth
  };
})();
