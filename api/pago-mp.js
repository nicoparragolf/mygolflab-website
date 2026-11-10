/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Mercado Pago: aviso de pago y regreso del alumno
   Archivo: /api/pago-mp.js
   Versión: 1.0 · 2026-11-10

   Un solo archivo para no sumar funciones en Vercel:

   ?accion=webhook  (POST de Mercado Pago, notification_url)
     Mercado Pago avisa que un pago cambió. Nunca se confía en lo que llega:
     se consulta el pago real a Mercado Pago con nuestro token y, si está
     aprobado, se libera la clase o la colección (misma lógica que Flow).
     Si MP_WEBHOOK_SECRET está configurado, además se valida la firma.

   ?accion=retorno  (GET, back_urls)
     El alumno vuelve de Mercado Pago. Se confirma el pago (por si el aviso
     aún no llega) y se le lleva a "Mis clases" o a la colección comprada.

   Variables: MP_ACCESS_TOKEN (obligatoria), MP_WEBHOOK_SECRET (opcional),
   SUPABASE_SERVICE_ROLE_KEY. Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
import crypto from 'node:crypto';
import { config, confirmarPagoMP, destinoTrasPago } from './_pagos.js';

function firmaValida(req, cfg, dataId) {
  if (!cfg.mpSecret) return true;   // sin clave configurada no se valida (el pago se consulta igual)
  var sig = String(req.headers['x-signature'] || '');
  var reqId = String(req.headers['x-request-id'] || '');
  var ts = '', v1 = '';
  sig.split(',').forEach(function (parte) {
    var kv = parte.split('=');
    var k = (kv[0] || '').trim(), v = (kv[1] || '').trim();
    if (k === 'ts') ts = v;
    if (k === 'v1') v1 = v;
  });
  if (!ts || !v1) return false;
  var manifest = 'id:' + String(dataId).toLowerCase() + ';' + (reqId ? 'request-id:' + reqId + ';' : '') + 'ts:' + ts + ';';
  var calc = crypto.createHmac('sha256', cfg.mpSecret).update(manifest).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(v1)); } catch (e) { return false; }
}

async function webhook(req, res, cfg) {
  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  var q = req.query || {};
  var tipo = body.type || q.type || q.topic || '';
  var id = (body.data && body.data.id) || q['data.id'] || (q.topic === 'payment' ? q.id : '');
  // solo interesan los pagos (merchant_order y otros se ignoran con 200)
  if (tipo !== 'payment' || !id) return res.status(200).send('ignorado');
  if (!firmaValida(req, cfg, id)) return res.status(401).send('firma inválida');
  try {
    var r = await confirmarPagoMP(cfg, String(id));
    return res.status(200).send('OK ' + r.estado);
  } catch (e) {
    console.error('pago-mp webhook', e);
    return res.status(500).send('Error');   // Mercado Pago reintenta
  }
}

async function retorno(req, res, cfg) {
  var q = req.query || {};
  var payId = q.payment_id || q.collection_id;
  var r = { estado: q.status === 'approved' ? 'pendiente' : (q.status === 'null' || !q.status ? 'pendiente' : 'fallido') };
  try {
    if (payId && payId !== 'null') r = await confirmarPagoMP(cfg, String(payId));
  } catch (e) {
    console.error('pago-mp retorno', e);
  }
  res.statusCode = 303;
  res.setHeader('Location', destinoTrasPago(r));
  res.end();
}

export default async function handler(req, res) {
  var cfg = config();
  var accion = (req.query && req.query.accion) || '';
  if (!cfg.ok || !cfg.medios.mp) {
    if (accion === 'retorno') { res.statusCode = 303; res.setHeader('Location', destinoTrasPago({ estado: 'pendiente' })); return res.end(); }
    return res.status(503).send('Mercado Pago no configurado');
  }
  if (accion === 'webhook') return webhook(req, res, cfg);
  if (accion === 'retorno') return retorno(req, res, cfg);
  return res.status(400).send('Acción desconocida');
}
