/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Suscripciones de coaches (Flow en la web, Apple en la app)
   Archivo: /api/suscripcion.js
   Versión: 1.0 · 2026-11-25

   Una sola función de Vercel con varias acciones (?accion=...):

   WEB (Flow, cobro en pesos chilenos con tarjeta inscrita):
     POST iniciar      { plan, periodo }  (con sesión) → { url } para inscribir la tarjeta
     GET/POST tarjeta  ?cid=<coach>&token=…   Flow vuelve acá después de inscribir
                        la tarjeta → crea la suscripción (con la prueba restante
                        y el descuento) y lleva al coach a Mi cuenta.
     POST cancelar     (con sesión) → cancela al final del período pagado
     POST flow         urlCallback de los planes de Flow (cada cobro) → sincroniza
     GET  sincronizar  (cron diario de Vercel) → sincroniza todas las de Flow

   APP (Apple, vía RevenueCat):
     POST revenuecat   webhook de RevenueCat → actualiza la suscripción del coach

   GET config         qué está configurado (sin mostrar llaves)

   Precios: los define ESTE archivo (nunca el navegador). Flow cobra en CLP.
   Descuento: se aplica el mayor entre Coach Fundador (40% mientras siga
   suscrito) y el código de descuento que haya usado el coach.

   Variables de entorno nuevas (Vercel → Settings → Environment Variables):
     REVENUECAT_WEBHOOK_AUTH   texto secreto que se pega también en RevenueCat
                               (Integrations → Webhooks → Authorization header)
     CRON_SECRET               texto secreto para el cron diario (Vercel lo manda solo)
   Usa además las de /api/_pagos.js: FLOW_API_KEY, FLOW_SECRET_KEY, FLOW_API_URL,
   SUPABASE_SERVICE_ROLE_KEY y SITE_URL.

   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, db, userFromToken, flowPost, flowGet, SITE_URL } from './_pagos.js';

// ── Precios en CLP (IVA incluido). Anual = 10 meses. ──
export const PLANES = {
  starter:  { nombre: 'Starter',  mensual: 8990,  anual: 89900 },
  pro:      { nombre: 'Pro',      mensual: 17990, anual: 179900 },
  pro_plus: { nombre: 'Pro+',     mensual: 26990, anual: 269900 },
  academia: { nombre: 'Academia', mensual: 44990, anual: 449900 }
};
var PERIODOS = { mensual: 3, anual: 4 };   // interval de Flow: 3 = mes, 4 = año

function planIdFlow(plan, periodo) { return 'CY_' + plan.toUpperCase() + '_' + periodo.toUpperCase(); }

function urlBase(req) {
  // Si la llamada llega por coachyard.golf, las vueltas de Flow también van ahí
  var host = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '');
  if (/coachyard\.golf$/i.test(host)) return 'https://' + host.replace(/^www\./, '');
  return SITE_URL;
}

function cuerpo(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) {
      var o = {}; new URLSearchParams(req.body).forEach(function (v, k) { o[k] = v; }); return o;
    }
  }
  return req.body;
}

// Fecha de Flow ("2026-12-10 13:20:00", hora de Chile) → ISO
function fechaFlow(s, finDeDia) {
  if (!s) return null;
  var t = String(s).trim().replace(' ', 'T');
  if (t.length === 10) t += finDeDia ? 'T23:59:59' : 'T00:00:00';
  var d = new Date(t + '-03:00');
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function sub(cfg, coachId) {
  var r = await db(cfg, 'coach_subscriptions?coach_id=eq.' + coachId + '&select=*');
  return r.data && r.data[0];
}
async function guardar(cfg, coachId, cambios) {
  cambios.updated_at = new Date().toISOString();
  await db(cfg, 'coach_subscriptions?coach_id=eq.' + coachId, { method: 'PATCH', body: cambios });
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW
// ════════════════════════════════════════════════════════════════════════════
async function asegurarPlanFlow(cfg, req, plan, periodo) {
  var id = planIdFlow(plan, periodo);
  try { await flowGet(cfg, 'plans/get', { planId: id }); return id; } catch (e) {}
  await flowPost(cfg, 'plans/create', {
    planId: id,
    name: 'CoachYard ' + PLANES[plan].nombre + ' ' + periodo,
    currency: 'CLP',
    amount: PLANES[plan][periodo],
    interval: PERIODOS[periodo],
    interval_count: 1,
    trial_period_days: 0,
    days_until_due: 3,
    charges_retries_number: 3,
    urlCallback: urlBase(req) + '/api/suscripcion?accion=flow'
  });
  return id;
}

// Descuento que corresponde al coach: el mayor entre fundador y su código
async function descuento(cfg, s) {
  var conf = (await db(cfg, 'mgl_cobros_config?id=eq.1&select=*')).data[0] || {};
  var mejor = null;
  if (s.founder && conf.founder_pct > 0) mejor = { tipo: 'fundador', pct: conf.founder_pct, meses: null, conf: conf };
  if (s.discount_code_id) {
    var c = (await db(cfg, 'discount_codes?id=eq.' + s.discount_code_id + '&select=*')).data[0];
    if (c && c.percent_off > 0 && (!mejor || c.percent_off > mejor.pct)) {
      mejor = { tipo: 'codigo', pct: c.percent_off, meses: c.duration_months, codigo: c };
    }
  }
  return mejor;
}

async function cuponFlow(cfg, d) {
  if (!d) return null;
  if (d.tipo === 'fundador') {
    if (d.conf.flow_coupon_fundador) return d.conf.flow_coupon_fundador;
    var rf = await flowPost(cfg, 'coupon/create', { name: 'CoachYard Fundador ' + d.pct + '%', percent_off: d.pct, duration: 0 });
    await db(cfg, 'mgl_cobros_config?id=eq.1', { method: 'PATCH', body: { flow_coupon_fundador: String(rf.id) } });
    return String(rf.id);
  }
  if (d.codigo.flow_coupon_id) return d.codigo.flow_coupon_id;
  var params = { name: 'CoachYard ' + d.codigo.code, percent_off: d.pct, duration: d.meses ? 1 : 0 };
  if (d.meses) params.times = d.meses;
  var rc = await flowPost(cfg, 'coupon/create', params);
  await db(cfg, 'discount_codes?id=eq.' + d.codigo.id, { method: 'PATCH', body: { flow_coupon_id: String(rc.id) } });
  return String(rc.id);
}

// Lee la suscripción en Flow y la copia a coach_subscriptions
async function sincronizarFlow(cfg, s) {
  if (!s || s.provider !== 'flow' || !s.provider_ref) return null;
  var f = await flowGet(cfg, 'subscription/get', { subscriptionId: s.provider_ref });
  var st = Number(f.status);
  var cambios = {};
  if (st === 4) {
    cambios.status = 'canceled';
    cambios.current_period_end = fechaFlow(f.period_end, true) || s.current_period_end;
  } else if (st === 2) {
    cambios.status = 'trialing';
    cambios.trial_ends_at = fechaFlow(f.trial_end, true) || s.trial_ends_at;
  } else if (st === 1) {
    cambios.status = Number(f.morose) === 1 ? 'past_due' : 'active';
    cambios.current_period_end = fechaFlow(f.period_end, true);
  } else {
    return f;   // 0 = aún no empieza: no se toca
  }
  if (f.cancel_at_period_end != null) cambios.cancel_at_period_end = Number(f.cancel_at_period_end) === 1;
  await guardar(cfg, s.coach_id, cambios);
  return f;
}

async function sincronizarTodasFlow(cfg) {
  var r = await db(cfg, 'coach_subscriptions?provider=eq.flow&provider_ref=not.is.null&select=*');
  var ok = 0, err = [];
  for (var i = 0; i < (r.data || []).length; i++) {
    try { await sincronizarFlow(cfg, r.data[i]); ok++; }
    catch (e) { err.push(r.data[i].coach_id + ': ' + e.message); }
  }
  return { ok: ok, errores: err };
}

async function iniciar(req, res, cfg) {
  var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  var user = await userFromToken(token);
  if (!user || !user.id) return res.status(401).json({ error: 'Inicia sesión para elegir tu plan' });

  var b = cuerpo(req);
  var plan = String(b.plan || ''), periodo = String(b.periodo || 'mensual');
  if (!PLANES[plan] || !PERIODOS[periodo]) return res.status(400).json({ error: 'Plan no válido' });

  var s = await sub(cfg, user.id);
  if (!s) return res.status(403).json({ error: 'Esta cuenta no es de coach' });
  if (s.plan === 'cortesia') return res.status(409).json({ error: 'Tu cuenta ya tiene acceso completo' });
  if (s.provider === 'apple' && ['active', 'trialing', 'past_due'].indexOf(s.status) >= 0) {
    return res.status(409).json({ error: 'Tu suscripción está en el App Store. Adminístrala desde tu iPhone.' });
  }
  // Si ya tiene suscripción de Flow activa, se cancela la anterior al crear la nueva (cambio de plan)
  var customerId = s.flow_customer_id;
  if (!customerId) {
    var nombre = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || user.email;
    var c = await flowPost(cfg, 'customer/create', { name: nombre, email: user.email, externalId: user.id });
    customerId = c.customerId;
  }
  await guardar(cfg, user.id, { flow_customer_id: customerId, pending_plan: plan, pending_period: periodo });

  var reg = await flowPost(cfg, 'customer/register', {
    customerId: customerId,
    url_return: urlBase(req) + '/api/suscripcion?accion=tarjeta&cid=' + user.id
  });
  return res.status(200).json({ url: reg.url + '?token=' + reg.token });
}

async function tarjeta(req, res, cfg) {
  var q = req.query || {};
  var b = cuerpo(req);
  var token = b.token || q.token;
  var cid = String(q.cid || '');
  var volver = urlBase(req) + '/es/coachhub/cuenta.html?suscripcion=';
  if (!token || !/^[0-9a-f-]{36}$/i.test(cid)) return res.redirect(302, volver + 'error');

  try {
    var est = await flowGet(cfg, 'customer/getRegisterStatus', { token: token });
    var s = await sub(cfg, cid);
    if (!s || String(est.customerId) !== String(s.flow_customer_id)) return res.redirect(302, volver + 'error');
    if (String(est.status) !== '1') return res.redirect(302, volver + 'tarjeta_rechazada');

    var plan = s.pending_plan, periodo = s.pending_period || 'mensual';
    if (!PLANES[plan]) return res.redirect(302, volver + 'error');
    var planId = await asegurarPlanFlow(cfg, req, plan, periodo);

    // La prueba que le queda al coach se respeta: el primer cobro es cuando termina
    var dias = 0;
    if (s.status === 'trialing' && s.trial_ends_at) {
      dias = Math.max(0, Math.ceil((new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000));
    }
    var params = { planId: planId, customerId: s.flow_customer_id };
    if (dias > 0) params.trial_period_days = dias;
    var cupon = await cuponFlow(cfg, await descuento(cfg, s));
    if (cupon) params.couponId = cupon;

    // Cambio de plan: se cancela la suscripción anterior de Flow de inmediato
    if (s.provider === 'flow' && s.provider_ref) {
      try { await flowPost(cfg, 'subscription/cancel', { subscriptionId: s.provider_ref, at_period_end: 0 }); } catch (e) {}
    }

    var nueva = await flowPost(cfg, 'subscription/create', params);
    await guardar(cfg, cid, {
      provider: 'flow',
      provider_ref: String(nueva.subscriptionId),
      plan: plan,
      billing_period: periodo,
      status: dias > 0 ? 'trialing' : 'active',
      cancel_at_period_end: false,
      card_last4: est.last4CardDigits ? String(est.last4CardDigits) : null,
      pending_plan: null,
      pending_period: null
    });
    try { await sincronizarFlow(cfg, await sub(cfg, cid)); } catch (e) {}
    return res.redirect(302, volver + 'ok');
  } catch (e) {
    console.error('suscripcion tarjeta', e);
    return res.redirect(302, volver + 'error');
  }
}

async function cancelar(req, res, cfg) {
  var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  var user = await userFromToken(token);
  if (!user || !user.id) return res.status(401).json({ error: 'Inicia sesión' });
  var s = await sub(cfg, user.id);
  if (!s || s.provider !== 'flow' || !s.provider_ref) return res.status(409).json({ error: 'No tienes una suscripción web para cancelar' });
  await flowPost(cfg, 'subscription/cancel', { subscriptionId: s.provider_ref, at_period_end: 1 });
  await guardar(cfg, user.id, { cancel_at_period_end: true });
  try { await sincronizarFlow(cfg, await sub(cfg, user.id)); } catch (e) {}
  return res.status(200).json({ ok: true });
}

// ════════════════════════════════════════════════════════════════════════════
// APPLE (RevenueCat)
// Productos en App Store Connect (los crea Nico; ver PAGOS.md):
//   cy_starter_mensual, cy_pro_mensual, cy_proplus_mensual
//   cy_starter_fundador, cy_pro_fundador, cy_proplus_fundador
// ════════════════════════════════════════════════════════════════════════════
export function planDeProducto(productId) {
  var p = String(productId || '').toLowerCase();
  if (p.indexOf('proplus') >= 0 || p.indexOf('pro_plus') >= 0) return 'pro_plus';
  if (p.indexOf('starter') >= 0) return 'starter';
  if (p.indexOf('academia') >= 0) return 'academia';
  if (p.indexOf('pro') >= 0) return 'pro';
  return null;
}

export function cambiosRevenueCat(ev) {
  var exp = ev.expiration_at_ms ? new Date(Number(ev.expiration_at_ms)).toISOString() : null;
  var plan = planDeProducto(ev.product_id || (ev.new_product_id));
  var t = String(ev.type || '');
  var c = { provider: 'apple' };
  var ref = ev.original_transaction_id || ev.transaction_id;
  if (ref) c.provider_ref = String(ref);
  if (plan) c.plan = plan;
  if (/anual|annual|year/i.test(String(ev.product_id || ''))) c.billing_period = 'anual';
  else if (plan) c.billing_period = 'mensual';

  if (['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT'].indexOf(t) >= 0) {
    if (String(ev.period_type) === 'TRIAL') { c.status = 'trialing'; c.trial_ends_at = exp; }
    else { c.status = 'active'; c.current_period_end = exp; }
    c.cancel_at_period_end = false;
  } else if (t === 'CANCELLATION') {
    c.status = 'canceled'; c.current_period_end = exp; c.cancel_at_period_end = true;
  } else if (t === 'BILLING_ISSUE') {
    c.status = 'past_due'; if (exp) c.current_period_end = exp;
  } else if (t === 'EXPIRATION') {
    c.status = 'expired'; c.current_period_end = exp;
  } else {
    return null;   // TEST, TRANSFER, SUBSCRIBER_ALIAS, etc.: no cambia nada
  }
  return c;
}

async function revenuecat(req, res, cfg) {
  var esperado = process.env.REVENUECAT_WEBHOOK_AUTH;
  var llega = String(req.headers.authorization || '');
  if (!esperado || (llega !== esperado && llega !== 'Bearer ' + esperado)) return res.status(401).json({ error: 'no autorizado' });

  var ev = (cuerpo(req) || {}).event || {};
  if (ev.type === 'TEST') return res.status(200).json({ ok: true, test: true });
  var uid = String(ev.app_user_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(uid)) return res.status(200).json({ ok: true, ignorado: 'usuario anónimo' });

  var s = await sub(cfg, uid);
  if (!s) return res.status(200).json({ ok: true, ignorado: 'no es coach' });
  if (s.plan === 'cortesia') return res.status(200).json({ ok: true, ignorado: 'cortesía' });

  var c = cambiosRevenueCat(ev);
  if (!c) return res.status(200).json({ ok: true, ignorado: ev.type });
  await guardar(cfg, uid, c);
  return res.status(200).json({ ok: true });
}

// ════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  var cfg = config();
  var accion = String((req.query && req.query.accion) || '');

  try {
    if (accion === 'config') {
      return res.status(200).json({
        flow: !!cfg.medios.flow, supabase: !!cfg.serviceKey,
        revenuecat: !!process.env.REVENUECAT_WEBHOOK_AUTH, cron: !!process.env.CRON_SECRET,
        planes: PLANES
      });
    }
    if (accion === 'revenuecat') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
      if (!cfg.serviceKey) return res.status(503).json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' });
      return await revenuecat(req, res, cfg);
    }

    if (!cfg.medios.flow || !cfg.serviceKey) {
      if (accion === 'tarjeta') return res.redirect(302, urlBase(req) + '/es/coachhub/cuenta.html?suscripcion=error');
      return res.status(503).json({ error: 'El cobro con tarjeta aún no está activo', faltan: cfg.faltan });
    }

    if (accion === 'iniciar' && req.method === 'POST') return await iniciar(req, res, cfg);
    if (accion === 'tarjeta') return await tarjeta(req, res, cfg);
    if (accion === 'cancelar' && req.method === 'POST') return await cancelar(req, res, cfg);
    if (accion === 'flow') {
      await sincronizarTodasFlow(cfg);
      return res.status(200).send('OK');
    }
    if (accion === 'sincronizar') {
      var secreto = process.env.CRON_SECRET;
      if (!secreto || String(req.headers.authorization || '') !== 'Bearer ' + secreto) return res.status(401).json({ error: 'no autorizado' });
      return res.status(200).json(await sincronizarTodasFlow(cfg));
    }
    return res.status(404).json({ error: 'Acción desconocida' });
  } catch (e) {
    console.error('suscripcion', accion, e);
    return res.status(500).json({ error: 'No se pudo completar: ' + e.message });
  }
}
