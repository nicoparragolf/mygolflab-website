/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Regreso del alumno desde Flow
   Archivo: /api/pago-retorno.js
   Versión: 1.1 · 2026-11-02
     1.1: si el pago era de una colección de contenido, vuelve a la colección

   Flow envía al alumno de vuelta a esta URL (urlReturn) con POST token=...
   Se confirma el pago (por si la notificación aún no llega) y se redirige a
   "Mis clases" (o a la colección comprada) mostrando el resultado.
   ═══════════════════════════════════════════════════════════════════════════ */
import { config, confirmarPago, SITE_URL } from './_pagos.js';

export default async function handler(req, res) {
  var destino = SITE_URL + '/es/coachhub/clases.html';
  var cfg = config();
  try {
    var body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
    var token = body.token || (req.query && req.query.token);
    if (cfg.ok && token) {
      var r = await confirmarPago(cfg, String(token));
      if (r.tipo === 'contenido') {
        destino = SITE_URL + '/es/coaches/contenido.html?pago=' + encodeURIComponent(r.estado)
          + (r.collectionId ? '&c=' + encodeURIComponent(r.collectionId) : '');
      } else {
        destino += '?pago=' + encodeURIComponent(r.estado) + (r.lessonId ? '&clase=' + encodeURIComponent(r.lessonId) : '');
      }
    } else {
      destino += '?pago=pendiente';
    }
  } catch (e) {
    console.error('pago-retorno', e);
    destino += '?pago=pendiente';
  }
  res.statusCode = 303;
  res.setHeader('Location', destino);
  res.end();
}
