/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Crear el pago de una colección de contenido en Flow
   Archivo: /api/contenido-pagar.js
   Versión: 1.0 · 2026-11-02

   POST /api/contenido-pagar
   Headers: Authorization: Bearer <token de sesión de Supabase del alumno>
   Body:    { "purchase_id": "<uuid de content_purchases en estado por_pagar>", "medio": "flow" | "mp" }
   Responde { "url": "<checkout de Flow o Mercado Pago>" } para redirigir al alumno.

   La compra se crea antes con la función mgl_contenido_comprar (Supabase).
   El precio NUNCA viene del navegador: se toma de la compra (copiado de la
   colección por la base de datos) y se convierte a pesos con el dólar del día.
   Al volver de Flow, /api/pago-retorno confirma el pago y lleva al alumno
   de vuelta a la colección.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, db, userFromToken, usdClp, pagosConfig, crearCobro, medioPedido } from './_pagos.js';

export default async function handler(req, res) {
  var cfg = config();
  // GET → qué medios de pago están activos (para mostrar los botones)
  if (req.method === 'GET') return res.status(200).json({ medios: cfg.ok ? cfg.medios : { flow: false, mp: false } });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!cfg.ok) return res.status(503).json({ error: 'Los pagos aún no están configurados', faltan: cfg.faltan });

  try {
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await userFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Inicia sesión para comprar' });

    var body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    var id = String(body.purchase_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Compra inválida' });

    var pr = await db(cfg, 'content_purchases?id=eq.' + id + '&select=*');
    var p = pr.data && pr.data[0];
    if (!p || p.student_id !== user.id) return res.status(404).json({ error: 'Compra no encontrada' });
    if (p.status !== 'por_pagar' && p.status !== 'fallido') return res.status(409).json({ error: 'Esta compra ya no está esperando pago' });

    // la colección tiene que seguir a la venta
    var cr = await db(cfg, 'coach_collections?id=eq.' + p.collection_id + '&select=id,title,is_published');
    var col = cr.data && cr.data[0];
    if (!col || !col.is_published) return res.status(409).json({ error: 'Esta colección ya no está a la venta' });

    var conf = await pagosConfig(cfg);
    var rate = await usdClp(conf.usd_clp_fallback);
    var precio = Number(p.price) || 0;
    var base = p.currency === 'USD' ? Math.round(precio * rate / 100) * 100 : Math.round(precio);
    if (base < 1000) return res.status(400).json({ error: 'Monto demasiado bajo para cobrar' });
    var fee = Math.round(base * Number(conf.service_fee_pct) / 100);
    var total = base + fee;

    var coach = 'tu coach';
    try {
      var cp = await db(cfg, 'coach_profiles?coach_id=eq.' + p.coach_id + '&select=display_name');
      if (cp.data && cp.data[0] && cp.data[0].display_name) coach = cp.data[0].display_name;
    } catch (e) {}
    var subject = ('CoachYard · ' + (p.title || col.title || 'Contenido') + ' · ' + coach).slice(0, 200);

    var medio = medioPedido(cfg, body.medio);
    var cobro = await crearCobro(cfg, medio, {
      orderId: p.id, subject: subject, total: total, email: user.email || p.student_email, tipo: 'contenido'
    });

    await patchCampos(cfg, 'content_purchases?id=eq.' + p.id, Object.assign({
      base_clp: base, service_fee_clp: fee, amount_clp: total, usd_clp_rate: rate, status: 'por_pagar'
    }, cobro.campos));

    return res.status(200).json({ url: cobro.url, medio: medio, amount_clp: total });
  } catch (e) {
    console.error('contenido-pagar', e);
    return res.status(500).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
  }
}

// Guarda los datos del cobro; si la migración de medios de pago aún no se
// corrió, reintenta sin las columnas nuevas.
async function patchCampos(cfg, path, body) {
  try { return await db(cfg, path, { method: 'PATCH', body: body }); }
  catch (e) {
    if (!/payment_provider|provider_payment_id|PGRST204|schema cache/i.test(e.message)) throw e;
    var b = Object.assign({}, body); delete b.payment_provider; delete b.provider_payment_id;
    return db(cfg, path, { method: 'PATCH', body: b });
  }
}
