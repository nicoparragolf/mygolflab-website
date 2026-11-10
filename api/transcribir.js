/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Transcripción de voz para Caddie
   Archivo: /api/transcribir.js
   Versión: 1.0 · 2026-11-04

   Por qué existe
   ──────────────
   En el iPhone, el dictado del navegador (Web Speech API) no funciona en las
   apps agregadas a la pantalla de inicio ni dentro de apps nativas: el botón
   existe pero no hace nada. Grabar audio sí funciona en todos lados, así que
   el navegador graba y este endpoint lo transcribe con OpenAI.

   POST /api/transcribir
     Headers: Authorization: Bearer <token de sesión de Supabase>
     Body:    { audio: <base64>, mime: 'audio/mp4', nombres: ['Clemente Silva', ...] }
   Respuesta: { texto: '...' }
   GET  /api/transcribir → diagnóstico

   REQUIERE: OPENAI_API_KEY en Vercel.
   Opcional: OPENAI_TRANSCRIBE_MODEL (por defecto gpt-4o-mini-transcribe;
             si ese modelo no está disponible se reintenta con whisper-1).
   ═══════════════════════════════════════════════════════════════════════════ */

import { userFromToken, SUPABASE_URL, SUPABASE_ANON_KEY } from './_pagos.js';

const MODELO = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const RESPALDO = 'whisper-1';
const MAX_MB = 3.2;   // ~90 s de voz; Vercel corta el cuerpo en 4.5 MB

const VOCABULARIO = 'Coach de golf en Chile dictando notas de clase. ' +
  'Términos: postura, setup, posición de pelota, stance, grip, backswing, downswing, transición, impacto, finish, ' +
  'early extension, over the top, lag, shaft lean, cara del palo, path, low point, driver, madera, híbrido, hierro 7, ' +
  'wedge, sand wedge, putter, chip, pitch, bunker, green, fairway, Trackman, Sportsbox, carry, spin, ' +
  'Ground Forces, Kinematic Sequence, Body Tilts, Wrist Conditions.';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({ estado: 'ok', modelo: MODELO, clave_presente: !!process.env.OPENAI_API_KEY });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'La transcripción de voz no está activada (falta OPENAI_API_KEY).', codigo: 'sin_clave' });
    }

    // ── sesión de coach ──
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await userFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a entrar.' });
    var rp = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    var perfil = rp.ok ? await rp.json() : [];
    var rol = perfil && perfil[0] && perfil[0].role;
    if (rol !== 'coach' && rol !== 'ambos') return res.status(403).json({ error: 'Solo para coaches.' });

    // ── audio ──
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    var b64 = body && body.audio;
    if (!b64 || typeof b64 !== 'string') return res.status(400).json({ error: 'No llegó el audio.' });
    var buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_MB * 1048576) return res.status(413).json({ error: 'El audio es muy largo. Graba menos de un minuto y medio.' });

    var mime = String((body && body.mime) || 'audio/mp4').split(';')[0];
    var ext = mime.indexOf('webm') > -1 ? 'webm' : mime.indexOf('ogg') > -1 ? 'ogg' : mime.indexOf('wav') > -1 ? 'wav' : 'mp4';

    // los nombres de los alumnos ayudan a escribirlos bien
    var nombres = Array.isArray(body.nombres) ? body.nombres.slice(0, 60).map(function (n) { return String(n).slice(0, 40); }) : [];
    var prompt = VOCABULARIO + (nombres.length ? ' Alumnos: ' + nombres.join(', ') + '.' : '');

    async function transcribir(modelo) {
      var fd = new FormData();
      fd.append('file', new Blob([buf], { type: mime }), 'voz.' + ext);
      fd.append('model', modelo);
      fd.append('language', (body && (body.idioma === 'en' || body.idioma === 'pt')) ? body.idioma : 'es');
      fd.append('prompt', prompt.slice(0, 900));
      fd.append('response_format', 'json');
      var r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        body: fd
      });
      var d = await r.json().catch(function () { return null; });
      return { r: r, d: d };
    }

    var out = await transcribir(MODELO);
    if (!out.r.ok && MODELO !== RESPALDO && (out.r.status === 404 || out.r.status === 400)) {
      console.warn('[transcribir] ' + MODELO + ' falló (' + out.r.status + '), reintento con ' + RESPALDO);
      out = await transcribir(RESPALDO);
    }
    if (!out.r.ok || !out.d) {
      console.error('[transcribir] OpenAI ' + out.r.status + ': ' + JSON.stringify(out.d).slice(0, 400));
      var msg = {
        401: 'La clave de OpenAI es inválida.',
        429: 'Sin créditos o demasiadas solicitudes en OpenAI. Revisa tu saldo.'
      }[out.r.status] || 'No pude transcribir el audio. Inténtalo de nuevo.';
      return res.status(502).json({ error: msg, codigo: out.r.status });
    }

    var texto = String(out.d.text || '').trim();
    // si solo devolvió el vocabulario de ayuda (pasa con audio en silencio), no hay texto real
    if (texto && VOCABULARIO.indexOf(texto.slice(0, 40)) === 0) texto = '';
    return res.status(200).json({ texto: texto });
  } catch (err) {
    console.error('[transcribir] excepción', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Error interno al transcribir.' });
  }
}
