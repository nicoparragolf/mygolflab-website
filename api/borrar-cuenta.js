/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab / CoachYard · Eliminar cuenta
   Archivo: /api/borrar-cuenta.js
   Versión: 1.0 · 2026-11-02

   Requisito de App Store y Google Play: el usuario tiene que poder borrar su
   cuenta desde la app. Lo usan es/profile.html y es/coachhub/cuenta.html
   (a través de /js/mgl-borrar-cuenta.js).

   POST /api/borrar-cuenta
   Headers: Authorization: Bearer <token de sesión de Supabase>
   Body:    { "confirmar": "ELIMINAR" }

   Pasos:
     1. Valida la sesión (solo puedes borrar TU cuenta).
     2. Borra los archivos del usuario en Storage (videos, fotos, frames).
     3. Borra sus datos en las tablas  → función SQL mgl_borrar_cuenta
     4. Borra el usuario de Supabase Auth.

   Requiere:
     · Variable de entorno SUPABASE_SERVICE_ROLE_KEY en Vercel (la misma de pagos)
     · Haber corrido sql/borrar_cuenta.sql en Supabase
   ═══════════════════════════════════════════════════════════════════════════ */
import { SUPABASE_URL, userFromToken } from './_pagos.js';

var BUCKETS_CONOCIDOS = ['player-media', 'coach-public', 'swing-frames', 'lesson-uploads'];

function headers(key, extra) {
  return Object.assign({
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json'
  }, extra || {});
}

async function rpc(key, fn, args) {
  var r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST', headers: headers(key), body: JSON.stringify(args)
  });
  var txt = await r.text();
  var data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = txt; }
  if (!r.ok) {
    var msg = (data && data.message) || r.status;
    var err = new Error(fn + ': ' + msg);
    err.code = data && data.code;
    throw err;
  }
  return data;
}

// Lista recursiva por carpeta (respaldo por si un archivo no quedó registrado)
async function listarCarpeta(key, bucket, prefix, out, depth) {
  if (depth > 6) return;
  var offset = 0;
  while (true) {
    var r = await fetch(SUPABASE_URL + '/storage/v1/object/list/' + bucket, {
      method: 'POST', headers: headers(key),
      body: JSON.stringify({ prefix: prefix, limit: 1000, offset: offset })
    });
    if (!r.ok) return; // bucket inexistente u otro problema: no bloquea
    var items = await r.json();
    if (!Array.isArray(items) || !items.length) return;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var full = prefix + '/' + it.name;
      if (it.id) out.push(full);
      else await listarCarpeta(key, bucket, full, out, depth + 1);
    }
    if (items.length < 1000) return;
    offset += 1000;
  }
}

async function borrarArchivos(key, bucket, names) {
  for (var i = 0; i < names.length; i += 100) {
    var lote = names.slice(i, i + 100);
    var r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket, {
      method: 'DELETE', headers: headers(key), body: JSON.stringify({ prefixes: lote })
    });
    if (!r.ok) {
      var t = await r.text();
      throw new Error('Storage ' + bucket + ': ' + t.slice(0, 200));
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(503).json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' });

  try {
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await userFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a iniciar sesión e inténtalo de nuevo.' });

    var body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (String(body.confirmar || '').trim().toUpperCase() !== 'ELIMINAR') {
      return res.status(400).json({ error: 'Escribe ELIMINAR para confirmar' });
    }

    var uid = user.id;

    // ── 1. Archivos en Storage ──
    var porBucket = {};
    try {
      var lista = await rpc(key, 'mgl_archivos_de_usuario', { p_uid: uid });
      (lista || []).forEach(function (o) {
        (porBucket[o.bucket_id] = porBucket[o.bucket_id] || []).push(o.name);
      });
    } catch (e) {
      if (e.code === 'PGRST202' || /Could not find the function/i.test(e.message)) {
        return res.status(503).json({ error: 'Falta correr sql/borrar_cuenta.sql en Supabase' });
      }
      throw e;
    }
    // Respaldo: carpetas que empiezan con el id del usuario
    for (var b = 0; b < BUCKETS_CONOCIDOS.length; b++) {
      var extra = [];
      await listarCarpeta(key, BUCKETS_CONOCIDOS[b], uid, extra, 0);
      if (extra.length) porBucket[BUCKETS_CONOCIDOS[b]] = (porBucket[BUCKETS_CONOCIDOS[b]] || []).concat(extra);
    }
    var nArchivos = 0;
    var buckets = Object.keys(porBucket);
    for (var k = 0; k < buckets.length; k++) {
      var unicos = porBucket[buckets[k]].filter(function (n, i, arr) { return arr.indexOf(n) === i; });
      nArchivos += unicos.length;
      await borrarArchivos(key, buckets[k], unicos);
    }

    // ── 2. Datos en las tablas ──
    var resumen = await rpc(key, 'mgl_borrar_cuenta', { p_uid: uid });

    // ── 3. Usuario de Auth ──
    var du = await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + uid, {
      method: 'DELETE', headers: headers(key)
    });
    if (!du.ok && du.status !== 404) {
      var dt = await du.text();
      throw new Error('Auth: ' + dt.slice(0, 200));
    }

    console.log('Cuenta eliminada', uid, { archivos: nArchivos, resumen: resumen });
    return res.status(200).json({ ok: true, archivos: nArchivos });
  } catch (e) {
    console.error('borrar-cuenta', e);
    return res.status(500).json({ error: 'No se pudo eliminar la cuenta. Escríbenos a nico@smoothgolf.co y la borramos a mano.', detalle: e.message });
  }
}
