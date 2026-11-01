/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Crear el pago de una clase en Flow
   Archivo: /api/pago-crear.js
   Versión: 1.0 · 2026-11-01

   POST /api/pago-crear
   Headers: Authorization: Bearer <token de sesión de Supabase del alumno>
   Body:    { "lesson_id": "<uuid de coach_lessons en estado por_pagar>" }
   Responde { "url": "<checkout de Flow>" } para redirigir al alumno.

   El precio NUNCA viene del navegador: se toma de la clase (copiado de la
   oferta por la base de datos) y se convierte a pesos con el dólar del día.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, db, userFromToken, usdClp, pagosConfig, flowPost, SITE_URL } from './_pagos.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  var cfg = config();
  if (!cfg.ok) return res.status(503).json({ error: 'Los pagos aún no están configurados', faltan: cfg.faltan });

  try {
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await userFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Inicia sesión para pagar' });

    var body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    var id = String(body.lesson_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Clase inválida' });

    var lr = await db(cfg, 'coach_lessons?id=eq.' + id + '&select=*');
    var l = lr.data && lr.data[0];
    if (!l || l.student_id !== user.id) return res.status(404).json({ error: 'Clase no encontrada' });
    if (l.status !== 'por_pagar' || l.payment_status === 'pagado') return res.status(409).json({ error: 'Esta clase ya no está esperando pago' });

    var conf = await pagosConfig(cfg);
    var rate = await usdClp(conf.usd_clp_fallback);
    var precio = Number(l.price) || 0;
    var base = l.currency === 'USD' ? Math.round(precio * rate / 100) * 100 : Math.round(precio);
    if (base < 1000) return res.status(400).json({ error: 'Monto demasiado bajo para cobrar' });
    var fee = Math.round(base * Number(conf.service_fee_pct) / 100);
    var total = base + fee;

    // nombre del coach para el detalle del cobro
    var coach = 'tu coach';
    try {
      var cp = await db(cfg, 'coach_profiles?coach_id=eq.' + l.coach_id + '&select=display_name');
      if (cp.data && cp.data[0] && cp.data[0].display_name) coach = cp.data[0].display_name;
    } catch (e) {}
    var titulo = (l.offering && l.offering.title) || 'Clase';
    var subject = ('Coach Hub · ' + titulo + ' con ' + coach).slice(0, 200);

    var fo = await flowPost(cfg, 'payment/create', {
      commerceOrder: l.id,
      subject: subject,
      currency: 'CLP',
      amount: total,
      email: user.email || l.student_email,
      urlConfirmation: SITE_URL + '/api/pago-confirmar',
      urlReturn: SITE_URL + '/api/pago-retorno',
      optional: JSON.stringify({ lesson: l.id }),
      timeout: 3600
    });
    if (!fo.url || !fo.token) throw new Error('Flow no devolvió el link de pago');

    await db(cfg, 'coach_lessons?id=eq.' + l.id, {
      method: 'PATCH',
      body: {
        base_clp: base, service_fee_clp: fee, amount_clp: total, usd_clp_rate: rate,
        flow_token: fo.token, flow_order: fo.flowOrder || null, payment_status: 'pendiente'
      }
    });

    return res.status(200).json({ url: fo.url + '?token=' + encodeURIComponent(fo.token), amount_clp: total });
  } catch (e) {
    console.error('pago-crear', e);
    return res.status(500).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
  }
}
