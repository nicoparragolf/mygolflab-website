/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Navegación tipo app (marco + pestañas vivas)
   Archivo: /js/mgl-marco.js
   Versión: 1.0 · 2026-11-09

   En el teléfono (y en la app), CoachYard corre dentro de /es/coachhub/app.html:
   una página "marco" que mantiene cada pestaña del menú inferior viva en su
   propio iframe (Jugadores, Clases, Mensajes, Perfil…). Cambiar de pestaña ya
   no recarga nada: se muestra la que ya estaba cargada, con su scroll y su
   estado, como en una app nativa. No hay pantallazo negro.

   Este script va PRIMERO en el <head> de cada página de CoachYard y hace:
   · Página abierta suelta en el teléfono con sesión iniciada → se va al marco.
   · Página dentro del marco:
       - si pertenece a otra pestaña, se abre en esa pestaña;
       - si no es de CoachYard (entrar, landing, pago…), se abre afuera;
       - los links a otras pestañas cambian de pestaña sin recargar.
   En el computador (pantalla ancha) no hace nada: todo sigue como antes.
   Para saltarse el marco: agregar ?marco=no a la URL.
   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.MGLMarco) return;
  var SB_KEY = 'sb-yulpqupmftdjbepqiscs-auth-token';

  // Pestaña a la que pertenece cada página
  function tabDe(path, rol) {
    path = String(path || '').replace(/\/index\.html$/, '/');
    var esCoach = rol !== 'jugador';
    if (path === '/es/coachhub/jugador.html') return 'jugador';
    if (path === '/es/coachhub/clases.html') return 'clases';
    if (path === '/es/coachhub/mensajes.html') return 'mensajes';
    if (path === '/es/coachhub/analisis.html') return 'analisis';
    if (path === '/es/coachhub/dashboard.html') return esCoach ? 'dashboard' : 'jugador';
    if (path === '/es/coachhub/cuenta.html' || path === '/es/coachhub/vitrina.html' || path === '/es/coachhub/contenido.html' || path === '/es/coachhub/reporte.html') return 'cuenta';
    if (path.indexOf('/es/coaches/') === 0) return esCoach ? 'cuenta' : 'coaches';
    return null;
  }
  function rol() { try { return localStorage.getItem('mgl-rol') || ''; } catch (e) { return ''; } }
  function haySesion() { try { return !!localStorage.getItem(SB_KEY); } catch (e) { return false; } }
  function telefono() {
    var cap = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    if (cap || /CoachHubApp/.test(navigator.userAgent || '')) return true;
    // Se mide la pantalla (no la ventana): en el <head> todavía no se aplica el
    // meta viewport y el ancho de la ventana es 980 en cualquier teléfono.
    var lado = Math.min(screen.width || 9999, screen.height || 9999);
    return lado <= 600;
  }
  function shellDe(w) { try { return w.parent && w.parent !== w && w.parent.MGLShell ? w.parent.MGLShell : null; } catch (e) { return null; } }

  var SHELL = shellDe(window);
  window.MGLMarco = { tabDe: tabDe, enMarco: !!SHELL };
  // Para navegar desde código: MGLnav.href = 'mensajes.html?player=…'
  // Dentro del marco cambia de pestaña sin recargar la página actual.
  window.MGLnav = {
    get href() { return location.href; },
    set href(u) {
      if (SHELL) { try { SHELL.abrir(new URL(u, location.href).href, 'link'); return; } catch (e) {} }
      location.href = u;
    }
  };

  // ── A. Página suelta: ¿pasar al marco? ──────────────────────────────────
  if (!SHELL) {
    if (/[?&]marco=no\b/.test(location.search)) return;
    if (location.pathname === '/es/coachhub/app.html') return;
    if (!tabDe(location.pathname, rol()) || !haySesion() || !telefono()) return;
    // Páginas públicas de coaches sin sesión quedan sueltas (ya chequeado arriba)
    // (sin window.stop(): cancelaría este mismo cambio de página)
    document.documentElement.style.visibility = 'hidden';
    location.replace('/es/coachhub/app.html#' + encodeURIComponent(location.pathname + location.search + location.hash));
    return;
  }

  // ── B. Página dentro del marco ──────────────────────────────────────────
  window.MGL_EN_MARCO = true;
  document.documentElement.classList.add('mgl-en-marco');
  // La app (Capacitor) solo existe en la ventana principal: se comparte
  try { if (!window.Capacitor && window.parent.Capacitor) window.Capacitor = window.parent.Capacitor; } catch (e) {}

  var miTab = null;
  try { miTab = window.frameElement && window.frameElement.getAttribute('data-tab'); } catch (e) {}
  var r = SHELL.llegue(window, miTab);
  if (r !== 'ok') { try { window.stop(); } catch (e) {} return; }

  // Links: a otra pestaña → cambiar de pestaña; fuera de CoachYard → afuera
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#' || /^(javascript|mailto|tel|sms|whatsapp):/i.test(href)) return;
    var u;
    try { u = new URL(href, location.href); } catch (er) { return; }
    var t = SHELL.destino(u);
    if (t === miTab) {
      // tocar en el menú la pestaña en la que ya estás: volver arriba
      if (a.closest('.mgl-tabs') && u.pathname === location.pathname && u.search === location.search) {
        e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;   // navegación normal dentro de la misma pestaña
    }
    e.preventDefault();
    SHELL.abrir(u.href, a.closest('.mgl-tabs') ? 'tab' : 'link');
  }, true);
})();
