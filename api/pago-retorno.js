/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Regreso del alumno desde Flow
   Archivo: /api/pago-retorno.js
   Versión: 1.1 · 2026-11-02
     1.1: si el pago era de una colección de contenido, vuelve a la colección

   Flow envía al alumno de vuelta a esta URL (urlReturn) con POST token=...
   Se confirma el pago (por si la notificación aún no llega) y se redirige a
   "Mis clases" (o a la colección comprada) mostrando el resultado.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, confirmarPago, destinoTrasPago } from './_pagos.js';

export default async function handler(req, res) {
  var cfg = config();
  var destino = destinoTrasPago({ estado: 'pendiente' });
  try {
    var body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
    var token = body.token || (req.query && req.query.token);
    if (cfg.ok && cfg.medios.flow && token) destino = destinoTrasPago(await confirmarPago(cfg, String(token)));
  } catch (e) {
    console.error('pago-retorno', e);
  }
  res.statusCode = 303;
  res.setHeader('Location', destino);
  res.end();
}
