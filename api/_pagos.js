/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Pagos de clases y contenido (Flow y Mercado Pago) — utilidades
   Archivo: /api/_pagos.js   (el "_" hace que Vercel no lo publique como ruta)
   Versión: 1.2 · 2026-11-10
     1.1: también confirma compras de contenido exclusivo (content_purchases)
     1.2: Mercado Pago como segundo medio de pago. La lógica que libera la
          clase o la colección (monto, comisión, alumno propio) es una sola
          para los dos medios: aplicarPago().

   Variables de entorno (Vercel → Settings → Environment Variables):
     FLOW_API_KEY               apiKey de tu cuenta Flow
     FLOW_SECRET_KEY            secretKey de tu cuenta Flow
     FLOW_API_URL               https://sandbox.flow.cl/api  (pruebas)
                                https://www.flow.cl/api      (producción)
     SUPABASE_SERVICE_ROLE_KEY  Supabase → Settings → API → service_role
     SITE_URL                   https://mygolflab.golf  (opcional)
     MP_ACCESS_TOKEN            Mercado Pago → Tus integraciones → Credenciales
                                (TEST-... para pruebas, APP_USR-... producción)
     MP_WEBHOOK_SECRET          clave secreta de las notificaciones (opcional,
                                Tus integraciones → Webhooks)
   Basta con configurar uno de los dos medios; el alumno ve solo los activos.
   ═══════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';

export const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yulpqupmftdjbepqiscs.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
export const SITE_URL = (process.env.SITE_URL || 'https://mygolflab.golf').replace(/\/$/, '');

export function config() {
  var flow = !!(process.env.FLOW_API_KEY && process.env.FLOW_SECRET_KEY && process.env.FLOW_API_URL);
  var mp = !!process.env.MP_ACCESS_TOKEN;
  var faltan = [];
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) faltan.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!flow && !mp) faltan.push('FLOW_API_KEY/FLOW_SECRET_KEY/FLOW_API_URL o MP_ACCESS_TOKEN');
  return {
    ok: faltan.length === 0,
    faltan: faltan,
    medios: { flow: flow, mp: mp },
    flowKey: process.env.FLOW_API_KEY,
    flowSecret: process.env.FLOW_SECRET_KEY,
    flowUrl: (process.env.FLOW_API_URL || '').replace(/\/$/, ''),
    mpToken: process.env.MP_ACCESS_TOKEN || '',
    mpSecret: process.env.MP_WEBHOOK_SECRET || '',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

// ── Flow: firma HMAC-SHA256 de los parámetros ordenados por nombre ──
export function flowSign(params, secret) {
  var keys = Object.keys(params).filter(function (k) { return k !== 's'; }).sort();
  var str = keys.map(function (k) { return k + String(params[k]); }).join('');
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

export async function flowPost(cfg, service, params) {
  var p = Object.assign({ apiKey: cfg.flowKey }, params);
  p.s = flowSign(p, cfg.flowSecret);
  var body = new URLSearchParams();
  Object.keys(p).forEach(function (k) { body.append(k, String(p[k])); });
  var r = await fetch(cfg.flowUrl + '/' + service, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Flow ' + service + ': ' + (data.message || r.status));
  return data;
}

export async function flowGet(cfg, service, params) {
  var p = Object.assign({ apiKey: cfg.flowKey }, params);
  p.s = flowSign(p, cfg.flowSecret);
  var qs = new URLSearchParams();
  Object.keys(p).forEach(function (k) { qs.append(k, String(p[k])); });
  var r = await fetch(cfg.flowUrl + '/' + service + '?' + qs.toString());
  var data = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Flow ' + service + ': ' + (data.message || r.status));
  return data;
}

// ── Supabase con la llave de servicio (salta RLS; solo en el servidor) ──
export async function db(cfg, path, opts) {
  opts = opts || {};
  var headers = {
    apikey: cfg.serviceKey,
    Authorization: 'Bearer ' + cfg.serviceKey,
    'Content-Type': 'application/json'
  };
  if (opts.prefer) headers.Prefer = opts.prefer;
  var r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  var txt = await r.text();
  var data = txt ? JSON.parse(txt) : null;
  if (!r.ok) throw new Error('DB ' + path.split('?')[0] + ': ' + ((data && data.message) || r.status));
  return { data: data, count: parseCount(r.headers.get('content-range')) };
}
function parseCount(cr) { if (!cr) return null; var n = cr.split('/')[1]; return n && n !== '*' ? parseInt(n, 10) : null; }

// ── Usuario que llama (token de sesión de Supabase) ──
export async function userFromToken(token) {
  if (!token) return null;
  var r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  });
  if (!r.ok) return null;
  return r.json();
}

// ── Dólar observado del día (mindicador.cl) con respaldo ──
export async function usdClp(fallback) {
  try {
    var ctrl = new AbortController();
    var t = setTimeout(function () { ctrl.abort(); }, 2500);
    var r = await fetch('https://mindicador.cl/api/dolar', { signal: ctrl.signal });
    clearTimeout(t);
    var d = await r.json();
    var v = d && d.serie && d.serie[0] && Number(d.serie[0].valor);
    if (v > 300) return v;
  } catch (e) {}
  return Number(fallback) || 950;
}

export async function pagosConfig(cfg) {
  try {
    var r = await db(cfg, 'mgl_pagos_config?id=eq.1&select=*');
    if (r.data && r.data[0]) return r.data[0];
  } catch (e) {}
  return { service_fee_pct: 5, own_student_pct: 0, usd_clp_fallback: 950,
           tiers: [{ hasta: 30, pct: 5 }, { hasta: 60, pct: 3 }, { hasta: null, pct: 2 }] };
}

// Comisión según cuántas clases pagadas lleva el coach este mes (incluida esta)
export function tierPct(tiers, n) {
  var list = Array.isArray(tiers) ? tiers : [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].hasta == null || n <= Number(list[i].hasta)) return Number(list[i].pct);
  }
  return list.length ? Number(list[list.length - 1].pct) : 5;
}

// Inicio del mes en hora de Chile, en ISO UTC
export function inicioMesChile() {
  var now = new Date();
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' }).formatToParts(now);
  var y = parts.find(function (p) { return p.type === 'year'; }).value;
  var m = parts.find(function (p) { return p.type === 'month'; }).value;
  // medianoche del día 1 en Santiago: probar los dos offsets posibles (-03 / -04)
  var cands = ['-03:00', '-04:00'].map(function (off) { return new Date(y + '-' + m + '-01T00:00:00' + off); });
  var ok = cands.find(function (d) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    return p.find(function (x) { return x.type === 'day'; }).value === '01' && p.find(function (x) { return x.type === 'hour'; }).value === '00';
  });
  return (ok || cands[0]).toISOString();
}

// ── Crear el cobro en el medio elegido ──────────────────────────────────
// Devuelve { url, campos } — campos = columnas a guardar en la clase/compra.
export async function crearCobro(cfg, medio, d) {
  // d = { orderId, subject, total, email, tipo: 'clase'|'contenido' }
  if (medio === 'mp') {
    if (!cfg.medios.mp) throw new Error('Mercado Pago no está activo');
    var vence = new Date(Date.now() + 3600 * 1000).toISOString();
    var r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + cfg.mpToken,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': d.orderId + '-' + Date.now()
      },
      body: JSON.stringify({
        items: [{ id: d.orderId, title: d.subject, quantity: 1, unit_price: d.total, currency_id: 'CLP' }],
        payer: d.email ? { email: d.email } : undefined,
        external_reference: d.orderId,
        metadata: { tipo: d.tipo },
        notification_url: SITE_URL + '/api/pago-mp?accion=webhook',
        back_urls: {
          success: SITE_URL + '/api/pago-mp?accion=retorno',
          pending: SITE_URL + '/api/pago-mp?accion=retorno',
          failure: SITE_URL + '/api/pago-mp?accion=retorno'
        },
        auto_return: 'approved',
        statement_descriptor: 'COACHYARD',
        expires: true,
        expiration_date_to: vence
      })
    });
    var pj = await r.json().catch(function () { return {}; });
    if (!r.ok || !pj.id) throw new Error('Mercado Pago: ' + (pj.message || r.status));
    var url = /^TEST-/.test(cfg.mpToken) ? (pj.sandbox_init_point || pj.init_point) : pj.init_point;
    return { url: url, campos: { payment_provider: 'mp', provider_payment_id: null, flow_token: null } };
  }
  if (!cfg.medios.flow) throw new Error('Flow no está activo');
  var fo = await flowPost(cfg, 'payment/create', {
    commerceOrder: d.orderId,
    subject: d.subject,
    currency: 'CLP',
    amount: d.total,
    email: d.email,
    urlConfirmation: SITE_URL + '/api/pago-confirmar',
    urlReturn: SITE_URL + '/api/pago-retorno',
    optional: JSON.stringify(d.tipo === 'contenido' ? { contenido: d.orderId } : { lesson: d.orderId }),
    timeout: 3600
  });
  if (!fo.url || !fo.token) throw new Error('Flow no devolvió el link de pago');
  return {
    url: fo.url + '?token=' + encodeURIComponent(fo.token),
    campos: { payment_provider: 'flow', flow_token: fo.token, flow_order: fo.flowOrder || null }
  };
}

// Medio elegido por el alumno: el pedido o el que esté activo
export function medioPedido(cfg, pedido) {
  var m = pedido === 'mp' ? 'mp' : (pedido === 'flow' ? 'flow' : '');
  if (m && cfg.medios[m]) return m;
  return cfg.medios.flow ? 'flow' : (cfg.medios.mp ? 'mp' : '');
}

// ── Flow: confirma consultando el estado real a Flow ──
export async function confirmarPago(cfg, token) {
  var st = await flowGet(cfg, 'payment/getStatus', { token: token });
  // 1 pendiente · 2 pagada · 3 rechazada · 4 anulada
  return aplicarPago(cfg, {
    orderId: st.commerceOrder,
    estado: st.status === 2 ? 'pagado' : (st.status === 1 ? 'pendiente' : 'fallido'),
    amount: st.amount,
    media: (st.paymentData && st.paymentData.media) || null,
    campos: { payment_provider: 'flow', flow_order: st.flowOrder || null }
  });
}

// ── Mercado Pago: confirma consultando el pago real a Mercado Pago ──
var MP_MEDIA = { credit_card: 'Tarjeta de crédito', debit_card: 'Tarjeta de débito', prepaid_card: 'Tarjeta de prepago',
                 account_money: 'Saldo Mercado Pago', bank_transfer: 'Transferencia', ticket: 'Efectivo' };
export async function confirmarPagoMP(cfg, paymentId) {
  var r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: 'Bearer ' + cfg.mpToken }
  });
  var p = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error('Mercado Pago payments: ' + (p.message || r.status));
  var s = p.status;
  var estado = s === 'approved' ? 'pagado'
    : (s === 'pending' || s === 'in_process' || s === 'authorized' || s === 'in_mediation' ? 'pendiente' : 'fallido');
  return aplicarPago(cfg, {
    orderId: p.external_reference,
    estado: estado,
    amount: p.transaction_amount,
    media: 'Mercado Pago' + (MP_MEDIA[p.payment_type_id] ? ' · ' + MP_MEDIA[p.payment_type_id] : ''),
    campos: { payment_provider: 'mp', provider_payment_id: String(p.id) }
  });
}

// Quita columnas nuevas si la migración aún no se corrió (PGRST204)
async function patchSeguro(cfg, path, body) {
  try { return await db(cfg, path, { method: 'PATCH', body: body }); }
  catch (e) {
    if (!/payment_provider|provider_payment_id|PGRST204|schema cache/i.test(e.message)) throw e;
    var b = Object.assign({}, body); delete b.payment_provider; delete b.provider_payment_id;
    return db(cfg, path, { method: 'PATCH', body: b });
  }
}

// Libera la clase (o la colección) cuando el pago está confirmado.
// Es idempotente: si ya estaba marcada como pagada no hace nada.
export async function aplicarPago(cfg, pago) {
  var lessonId = pago.orderId;
  var estado = pago.estado;
  if (!lessonId) return { estado: estado, lessonId: null };

  var lr = await db(cfg, 'coach_lessons?id=eq.' + encodeURIComponent(lessonId) + '&select=*');
  var l = lr.data && lr.data[0];
  // si no es una clase, puede ser la compra de una colección de contenido
  if (!l) return confirmarCompraContenido(cfg, pago, estado, lessonId);
  if (l.payment_status === 'pagado' || l.payment_status === 'reembolso_pendiente' || l.payment_status === 'reembolsado') {
    return { estado: 'pagado', lessonId: lessonId };
  }

  if (estado === 'fallido') {
    await db(cfg, 'coach_lessons?id=eq.' + l.id, { method: 'PATCH', body: { payment_status: 'fallido' } });
    return { estado: estado, lessonId: lessonId };
  }
  if (estado !== 'pagado') return { estado: estado, lessonId: lessonId };

  // el monto pagado tiene que calzar con lo que cobramos
  if (Number(pago.amount) !== Number(l.amount_clp)) {
    console.error('Pago con monto distinto', lessonId, pago.amount, l.amount_clp);
    await db(cfg, 'coach_lessons?id=eq.' + l.id, { method: 'PATCH', body: { payment_status: 'fallido' } });
    return { estado: 'fallido', lessonId: lessonId };
  }

  var conf = await pagosConfig(cfg);

  // ¿alumno propio? su ficha con este coach existía antes de su primera clase por la vitrina
  var own = false;
  try {
    var fichas = [];
    var pu = await db(cfg, 'players?coach_id=eq.' + l.coach_id + '&user_id=eq.' + l.student_id + '&select=created_at');
    fichas = fichas.concat(pu.data || []);
    if (l.student_email) {
      var pe = await db(cfg, 'players?coach_id=eq.' + l.coach_id + '&email=ilike.' + encodeURIComponent(l.student_email) + '&select=created_at');
      fichas = fichas.concat(pe.data || []);
    }
    fichas.sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; });
    var primera = await db(cfg, 'coach_lessons?coach_id=eq.' + l.coach_id + '&student_id=eq.' + l.student_id +
      '&select=created_at&order=created_at.asc&limit=1');
    var fichaDesde = fichas[0] && fichas[0].created_at;
    var primeraClase = primera.data && primera.data[0] && primera.data[0].created_at;
    own = !!(fichaDesde && primeraClase && new Date(fichaDesde) < new Date(primeraClase));
  } catch (e) { console.warn('own student', e.message); }

  // clases pagadas del coach este mes (sin contar esta) → escalón
  var desde = inicioMesChile();
  var cnt = await db(cfg, 'coach_lessons?coach_id=eq.' + l.coach_id + '&payment_status=eq.pagado&paid_at=gte.' +
    encodeURIComponent(desde) + '&select=id', { prefer: 'count=exact' });
  var n = (cnt.count || 0) + 1;
  var pct = own ? Number(conf.own_student_pct) : tierPct(conf.tiers, n);
  var base = Number(l.base_clp) || 0;
  var commission = Math.round(base * pct / 100);

  await patchSeguro(cfg, 'coach_lessons?id=eq.' + l.id + '&payment_status=neq.pagado', Object.assign({
    status: l.status === 'por_pagar' ? 'pendiente' : l.status,
    payment_status: 'pagado',
    paid_at: new Date().toISOString(),
    payment_method: pago.media,
    is_own_student: own,
    commission_pct: pct,
    commission_clp: commission,
    coach_payout_clp: base - commission,
    payout_status: 'por_liquidar'
  }, limpiar(pago.campos, l)));
  return { estado: 'pagado', lessonId: lessonId };
}
function limpiar(campos, fila) {
  var out = {};
  Object.keys(campos || {}).forEach(function (k) {
    var v = campos[k];
    if (k === 'flow_order') v = v || fila.flow_order || null;
    if (v != null) out[k] = v;
  });
  return out;
}

// A dónde vuelve el alumno después de pagar (web)
export function destinoTrasPago(r) {
  if (r && r.tipo === 'contenido') {
    return SITE_URL + '/es/coaches/contenido.html?pago=' + encodeURIComponent(r.estado)
      + (r.collectionId ? '&c=' + encodeURIComponent(r.collectionId) : '');
  }
  return SITE_URL + '/es/coachhub/clases.html?pago=' + encodeURIComponent((r && r.estado) || 'pendiente')
    + (r && r.lessonId ? '&clase=' + encodeURIComponent(r.lessonId) : '');
}

// ── Contenido exclusivo: compra de una colección de videos ──
// Misma lógica que las clases: el monto tiene que calzar, comisión escalonada
// según las ventas de contenido del coach en el mes, 0% con alumnos propios.
// Es idempotente: si ya estaba pagada no hace nada.
async function confirmarCompraContenido(cfg, pago, estado, purchaseId) {
  var base = { estado: estado, lessonId: null, purchaseId: purchaseId, collectionId: null, tipo: 'contenido' };
  var pr;
  try {
    pr = await db(cfg, 'content_purchases?id=eq.' + encodeURIComponent(purchaseId) + '&select=*');
  } catch (e) { return { estado: estado, lessonId: null }; }   // la tabla aún no existe
  var p = pr.data && pr.data[0];
  if (!p) return { estado: estado, lessonId: null };
  base.collectionId = p.collection_id;

  if (p.status === 'pagado' || p.status === 'otorgado' || p.status === 'reembolsado') {
    base.estado = 'pagado';
    return base;
  }
  if (estado === 'fallido') {
    await db(cfg, 'content_purchases?id=eq.' + p.id, { method: 'PATCH', body: { status: 'fallido' } });
    return base;
  }
  if (estado !== 'pagado') return base;

  if (Number(pago.amount) !== Number(p.amount_clp)) {
    console.error('Pago de contenido con monto distinto', p.id, pago.amount, p.amount_clp);
    await db(cfg, 'content_purchases?id=eq.' + p.id, { method: 'PATCH', body: { status: 'fallido' } });
    base.estado = 'fallido';
    return base;
  }

  var conf = await pagosConfig(cfg);

  // ¿alumno propio? ya tenía ficha con este coach antes de comprar
  var own = false;
  try {
    var fichas = [];
    var pu = await db(cfg, 'players?coach_id=eq.' + p.coach_id + '&user_id=eq.' + p.student_id + '&select=created_at');
    fichas = fichas.concat(pu.data || []);
    if (p.student_email) {
      var pe = await db(cfg, 'players?coach_id=eq.' + p.coach_id + '&email=ilike.' + encodeURIComponent(p.student_email) + '&select=created_at');
      fichas = fichas.concat(pe.data || []);
    }
    own = fichas.some(function (f) { return f.created_at && new Date(f.created_at) < new Date(p.created_at); });
  } catch (e) { console.warn('own student contenido', e.message); }

  var desde = inicioMesChile();
  var cnt = await db(cfg, 'content_purchases?coach_id=eq.' + p.coach_id + '&status=eq.pagado&paid_at=gte.' +
    encodeURIComponent(desde) + '&select=id', { prefer: 'count=exact' });
  var n = (cnt.count || 0) + 1;
  var pct = own ? Number(conf.own_student_pct) : tierPct(conf.tiers, n);
  var baseClp = Number(p.base_clp) || 0;
  var commission = Math.round(baseClp * pct / 100);

  await patchSeguro(cfg, 'content_purchases?id=eq.' + p.id + '&status=neq.pagado', Object.assign({
    status: 'pagado',
    paid_at: new Date().toISOString(),
    payment_method: pago.media,
    is_own_student: own,
    commission_pct: pct,
    commission_clp: commission,
    coach_payout_clp: baseClp - commission,
    payout_status: 'por_liquidar'
  }, limpiar(pago.campos, p)));
  base.estado = 'pagado';
  return base;
}
