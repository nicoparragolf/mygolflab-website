/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Confirmación de pago (Flow → nuestro servidor)
   Archivo: /api/pago-confirmar.js
   Versión: 1.0 · 2026-11-01

   Flow llama a esta URL (urlConfirmation) con POST token=... cuando cambia
   el estado del pago. Aquí se consulta el estado real a Flow (nunca se
   confía en lo que llega) y, si está pagado, la clase pasa a 'pendiente'
   para que el coach la vea, con su comisión calculada.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, confirmarPago } from './_pagos.js';

export default async function handler(req, res) {
  var cfg = config();
  if (!cfg.ok) return res.status(503).send('No configurado');
  try {
    var body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
    var token = body.token || (req.query && req.query.token);
    if (!token) return res.status(400).send('Falta token');
    var r = await confirmarPago(cfg, String(token));
    return res.status(200).send('OK ' + r.estado);
  } catch (e) {
    console.error('pago-confirmar', e);
    // 500 hace que Flow reintente la notificación
    return res.status(500).send('Error');
  }
}
