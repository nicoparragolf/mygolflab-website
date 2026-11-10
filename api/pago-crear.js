/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Crear el pago de una clase en Flow
   Archivo: /api/pago-crear.js
   Versión: 1.0 · 2026-11-01

   POST /api/pago-crear
   Headers: Authorization: Bearer <token de sesión de Supabase del alumno>
   Body:    { "lesson_id": "<uuid de coach_lessons en estado por_pagar>", "medio": "flow" | "mp" }
   GET /api/pago-crear → { medios: { flow, mp } } (medios activos)
   Responde { "url": "<checkout de Flow o Mercado Pago>" } para redirigir al alumno.

   El precio NUNCA viene del navegador: se toma de la clase (copiado de la
   oferta por la base de datos) y se convierte a pesos con el dólar del día.
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
    if (!user || !user.id) return res.status(401).json({ error: 'Inicia sesión para pagar' });

    var body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    var id = String(body.lesson_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Clase inválida' });

    var lr = await db(cfg, 'coach_lessons?id=eq.' + id + '&select=*');
    var l = lr.data && lr.data[0];
    if (!l || l.student_id !== user.id) return res.status(404).json({ error: 'Clase no encontrada' });
    if (l.status !== 'por_pagar' || l.payment_status === 'pagado') return res.status(409).json({ error: 'Esta clase ya no está esperando pago' });

    // videollamada: el horario apartado tiene que seguir libre; si sí, se
    // renueva el apartado por 1 hora más mientras el alumno paga
    if (l.offering && l.offering.kind === 'videollamada') {
      var bk = await db(cfg, 'coach_bookings?lesson_id=eq.' + l.id + '&status=eq.reservada&select=id,starts_at,ends_at');
      var mias = bk.data || [];
      if (!mias.length) return res.status(409).json({ error: 'Elige un horario antes de pagar', codigo: 'horario' });
      for (var i = 0; i < mias.length; i++) {
        var b = mias[i];
        var otras = await db(cfg, 'coach_bookings?coach_id=eq.' + l.coach_id + '&status=eq.reservada&id=neq.' + b.id +
          '&starts_at=lt.' + encodeURIComponent(b.ends_at) + '&ends_at=gt.' + encodeURIComponent(b.starts_at) + '&select=id,lesson_id,created_at');
        for (var j = 0; j < (otras.data || []).length; j++) {
          var ot = otras.data[j];
          var ol = await db(cfg, 'coach_lessons?id=eq.' + ot.lesson_id + '&select=status,payment_status');
          var x = ol.data && ol.data[0];
          var activa = x && x.status !== 'cancelada' && x.status !== 'rechazada' &&
            (x.payment_status === 'pagado' || x.payment_status === 'sin_pago' || Date.now() - new Date(ot.created_at).getTime() < 3600000);
          if (activa) return res.status(409).json({ error: 'Tu horario ya no está disponible. Elige otro.', codigo: 'horario' });
        }
      }
      await db(cfg, 'coach_bookings?lesson_id=eq.' + l.id + '&status=eq.reservada', { method: 'PATCH', body: { created_at: new Date().toISOString() } });
    }

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
    var subject = ('CoachYard · ' + titulo + ' con ' + coach).slice(0, 200);

    var medio = medioPedido(cfg, body.medio);
    var cobro = await crearCobro(cfg, medio, {
      orderId: l.id, subject: subject, total: total, email: user.email || l.student_email, tipo: 'clase'
    });

    await patchCampos(cfg, 'coach_lessons?id=eq.' + l.id, Object.assign({
      base_clp: base, service_fee_clp: fee, amount_clp: total, usd_clp_rate: rate, payment_status: 'pendiente'
    }, cobro.campos));

    return res.status(200).json({ url: cobro.url, medio: medio, amount_clp: total });
  } catch (e) {
    console.error('pago-crear', e);
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
