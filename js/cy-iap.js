/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Compras dentro de la app (Apple) vía RevenueCat
   Archivo: /js/cy-iap.js
   Versión: 1.0 · 2026-11-25

   Solo funciona dentro de la app de iPhone/iPad a partir de la versión que
   incluya el plugin @revenuecat/purchases-capacitor (app-movil/package.json).
   En la web o en una versión antigua de la app, CY_IAP.disponible() = false y
   no se muestra nada de compras (la app sigue funcionando igual que hoy).

   Para activarlo hay que pegar la llave PÚBLICA de iOS de RevenueCat abajo
   (RevenueCat → Project → API keys → "App specific keys" → appl_...).
   Es pública: está hecha para ir dentro de la app.

   Ofertas en RevenueCat:
     default  → cy_starter_mensual, cy_pro_mensual, cy_proplus_mensual
     fundador → cy_starter_fundador, cy_pro_fundador, cy_proplus_fundador

   API:
     CY_IAP.disponible()              → true/false
     CY_IAP.iniciar(userId)           → Promise (configura RevenueCat con el id de Supabase)
     CY_IAP.planes(esFundador)        → Promise<[{ id, plan, nombre, precio, periodo, paquete }]>
     CY_IAP.comprar(paquete)          → Promise<{ ok, cancelado, error }>
     CY_IAP.restaurar()               → Promise<{ ok, activo }>
     CY_IAP.canjearCodigo()           → abre la hoja de Apple para códigos de oferta

   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  if (window.CY_IAP) return;

  var RC_IOS_KEY = '';   // ← pegar acá la llave pública de iOS de RevenueCat (appl_...)
  var ENTITLEMENT = 'coachyard';

  var NOMBRES = { starter: 'Starter', pro: 'Pro', pro_plus: 'Pro+' };
  var ORDEN = { starter: 1, pro: 2, pro_plus: 3 };
  var listo = null;

  function plugin() {
    var cap = window.Capacitor;
    if (!cap && window.top !== window) { try { cap = window.top.Capacitor; } catch (e) {} }
    return (cap && cap.Plugins && cap.Plugins.Purchases) || null;
  }
  function esIOS() {
    try {
      var cap = window.Capacitor;
      if (cap && cap.getPlatform) return cap.getPlatform() === 'ios';
      return document.documentElement.classList.contains('en-ios');
    } catch (e) { return false; }
  }

  function disponible() { return !!(RC_IOS_KEY && esIOS() && plugin()); }

  function planDe(id) {
    id = String(id || '').toLowerCase();
    if (id.indexOf('proplus') >= 0) return 'pro_plus';
    if (id.indexOf('starter') >= 0) return 'starter';
    if (id.indexOf('pro') >= 0) return 'pro';
    return null;
  }

  function iniciar(userId) {
    if (!disponible()) return Promise.reject(new Error('Compras no disponibles'));
    if (listo) return listo;
    var P = plugin();
    listo = P.configure({ apiKey: RC_IOS_KEY, appUserID: userId })
      .catch(function () { return P.logIn({ appUserID: userId }); })
      .then(function () { return true; });
    return listo;
  }

  function planes(esFundador) {
    var P = plugin();
    return P.getOfferings().then(function (o) {
      var oferta = (esFundador && o && o.all && o.all.fundador) || (o && o.current);
      var lista = ((oferta && oferta.availablePackages) || []).map(function (p) {
        var prod = p.product || {};
        var plan = planDe(prod.identifier);
        return {
          id: prod.identifier,
          plan: plan,
          nombre: NOMBRES[plan] || prod.title,
          precio: prod.priceString,
          periodo: /ANNUAL/i.test(p.packageType) ? 'año' : 'mes',
          prueba: prod.introPrice && Number(prod.introPrice.price) === 0
            ? (prod.introPrice.periodNumberOfUnits + ' ' + (String(prod.introPrice.periodUnit).toUpperCase() === 'DAY' ? 'días' : String(prod.introPrice.periodUnit).toLowerCase()))
            : null,
          paquete: p
        };
      }).filter(function (x) { return !!x.plan; });
      lista.sort(function (a, b) { return (ORDEN[a.plan] || 9) - (ORDEN[b.plan] || 9); });
      return lista;
    });
  }

  function comprar(paquete) {
    var P = plugin();
    return P.purchasePackage({ aPackage: paquete }).then(function () {
      return { ok: true };
    }).catch(function (e) {
      var cancelado = !!(e && (e.userCancelled || e.code === '1' || /cancel/i.test(String(e.message || ''))));
      return { ok: false, cancelado: cancelado, error: e && e.message };
    });
  }

  function restaurar() {
    var P = plugin();
    return P.restorePurchases().then(function (r) {
      var info = (r && r.customerInfo) || r || {};
      var act = info.entitlements && info.entitlements.active && info.entitlements.active[ENTITLEMENT];
      return { ok: true, activo: !!act };
    }).catch(function (e) { return { ok: false, error: e && e.message }; });
  }

  function canjearCodigo() {
    var P = plugin();
    if (P && P.presentCodeRedemptionSheet) return P.presentCodeRedemptionSheet();
    return Promise.resolve();
  }

  window.CY_IAP = {
    disponible: disponible,
    iniciar: iniciar,
    planes: planes,
    comprar: comprar,
    restaurar: restaurar,
    canjearCodigo: canjearCodigo
  };
})();
