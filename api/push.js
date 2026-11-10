/* ═══════════════════════════════════════════════════════════════════════════
   CoachYard · Envío de avisos push
   Archivo: /api/push.js · 2026-11-09

   Lo llama la base de datos (sql/coach_hub_push.sql) cuando:
   · llega un mensaje nuevo (coach_messages)  → aviso a la otra persona
   · llega un mensaje a un grupo (coach_group_messages) → aviso a los demás del grupo
   · llega una clase nueva o se paga           → aviso al coach
   · el coach acepta, entrega o rechaza        → aviso al alumno
   y lo manda a cada teléfono del destinatario (tabla push_tokens).

   iOS va directo a Apple (APNs), sin Firebase. Android queda para cuando la
   app esté en Google Play (necesita Firebase).

   Variables en Vercel:
     PUSH_SECRET                 la misma clave que va en la tabla mgl_config
     SUPABASE_SERVICE_ROLE_KEY   (ya existe, la usan los pagos)
     APNS_KEY_P8                 contenido del archivo AuthKey_XXXX.p8 de Apple
     APNS_KEY_ID                 el ID de esa llave (10 caracteres)
     APNS_TEAM_ID                9L7RDVMT2W
     APNS_BUNDLE_ID              golf.mygolflab.coachhub (por defecto)
     APNS_SANDBOX                "1" solo para pruebas desde Xcode (TestFlight NO)
   Sin template literals.
   ═══════════════════════════════════════════════════════════════════════════ */
import http2 from 'node:http2';
import crypto from 'node:crypto';

var SB_URL = process.env.SUPABASE_URL || 'https://yulpqupmftdjbepqiscs.supabase.co';

var TXT = {
  es: { msg: 'Nuevo mensaje', clase: 'Nueva clase', pagada: 'Nueva clase pagada', pidio: 'Pidió una clase',
        aceptada: 'Tu coach aceptó tu clase', entregada: 'Tu análisis está listo', rechazada: 'Tu coach no pudo tomar tu clase',
        verla: 'Ábrela en CoachYard', alumno: 'Alumno', coach: 'Tu coach' },
  en: { msg: 'New message', clase: 'New lesson', pagada: 'New paid lesson', pidio: 'Requested a lesson',
        aceptada: 'Your coach accepted your lesson', entregada: 'Your analysis is ready', rechazada: "Your coach couldn't take your lesson",
        verla: 'Open it in CoachYard', alumno: 'Student', coach: 'Your coach' },
  pt: { msg: 'Nova mensagem', clase: 'Nova aula', pagada: 'Nova aula paga', pidio: 'Pediu uma aula',
        aceptada: 'Seu coach aceitou sua aula', entregada: 'Sua análise está pronta', rechazada: 'Seu coach não pôde aceitar sua aula',
        verla: 'Abra no CoachYard', alumno: 'Aluno', coach: 'Seu coach' }
};

async function sb(path, opts) {
  opts = opts || {};
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  var r = await fetch(SB_URL + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (opts.method === 'DELETE') return null;
  var j = await r.json().catch(function () { return null; });
  return Array.isArray(j) ? j : [];
}

function nombre(p) { return p ? ((p.first_name || '') + ' ' + (p.last_name || '')).trim() : ''; }
function corto(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ── Qué aviso corresponde ────────────────────────────────────────────────
async function armarAvisos(tabla, op, fila, antes) {
  var out = [];   // { user_id, title(lang), body(lang), url, tipo }
  if (tabla === 'coach_messages' && op === 'INSERT') {
    var pl = (await sb('players?id=eq.' + fila.player_id + '&select=id,coach_id,user_id,first_name,last_name'))[0];
    if (!pl) return out;
    if (fila.sender_id === pl.coach_id) {
      if (!pl.user_id) return out;
      var cp = (await sb('coach_profiles?coach_id=eq.' + pl.coach_id + '&select=display_name'))[0];
      out.push({ user_id: pl.user_id, titulo: function (t) { return (cp && cp.display_name) || t.coach; },
                 cuerpo: function () { return corto(fila.body, 140); }, url: '/es/coachhub/mensajes.html', tipo: 'msg' });
    } else {
      out.push({ user_id: pl.coach_id, titulo: function (t) { return nombre(pl) || t.alumno; },
                 cuerpo: function () { return corto(fila.body, 140); },
                 url: '/es/coachhub/mensajes.html?player=' + encodeURIComponent(pl.id), tipo: 'msg' });
    }
    return out;
  }
  if (tabla === 'coach_group_messages' && op === 'INSERT') {
    // Grupo: aviso a todos los miembros con cuenta (y al coach si escribió un alumno), menos a quien lo mandó
    var g = (await sb('coach_groups?id=eq.' + fila.group_id + '&select=id,name,coach_id'))[0];
    if (!g) return out;
    var miembros = await sb('coach_group_members?group_id=eq.' + g.id + '&select=player_id,players(user_id,first_name,last_name)');
    var quien = '';
    if (fila.sender_id === g.coach_id) {
      var cpg = (await sb('coach_profiles?coach_id=eq.' + g.coach_id + '&select=display_name'))[0];
      quien = (cpg && cpg.display_name) || '';
    } else {
      miembros.forEach(function (m) { if (m.players && m.players.user_id === fila.sender_id) quien = (m.players.first_name || '').trim(); });
    }
    var url = '/es/coachhub/mensajes.html?grupo=' + encodeURIComponent(g.id);
    var destinos = {};
    miembros.forEach(function (m) { if (m.players && m.players.user_id) destinos[m.players.user_id] = 1; });
    destinos[g.coach_id] = 1;
    delete destinos[fila.sender_id];
    Object.keys(destinos).forEach(function (uid) {
      out.push({ user_id: uid, titulo: function () { return g.name; },
                 cuerpo: function () { return corto((quien ? quien + ': ' : '') + fila.body, 140); }, url: url, tipo: 'grupo-' + g.id });
    });
    return out;
  }
  if (tabla === 'coach_lessons') {
    var titulo = (fila.offering && fila.offering.title) || '';
    var urlCoach = '/es/coachhub/clases.html?clase=' + encodeURIComponent(fila.id);
    if (op === 'INSERT' && fila.status === 'pendiente') {
      out.push({ user_id: fila.coach_id, titulo: function (t) { return t.clase + ' · ' + (fila.student_name || t.alumno); },
                 cuerpo: function (t) { return titulo || t.pidio; }, url: urlCoach, tipo: 'clase' });
    }
    if (op === 'UPDATE' && antes) {
      if (fila.payment_status === 'pagado' && antes.payment_status !== 'pagado' && fila.status === 'pendiente') {
        out.push({ user_id: fila.coach_id, titulo: function (t) { return t.pagada + ' · ' + (fila.student_name || t.alumno); },
                   cuerpo: function (t) { return titulo || t.pidio; }, url: urlCoach, tipo: 'clase' });
      }
      if (fila.status !== antes.status && (fila.status === 'aceptada' || fila.status === 'entregada' || fila.status === 'rechazada')) {
        out.push({ user_id: fila.student_id, titulo: function (t) { return t[fila.status]; },
                   cuerpo: function (t) { return corto(fila.coach_reply, 140) || titulo || t.verla; },
                   url: '/es/coachhub/clases.html?clase=' + encodeURIComponent(fila.id), tipo: 'clase' });
      }
    }
  }
  return out;
}

// ── APNs ─────────────────────────────────────────────────────────────────
var JWT = { token: null, t: 0 };
function jwtApns() {
  var ahora = Math.floor(Date.now() / 1000);
  if (JWT.token && ahora - JWT.t < 3000) return JWT.token;
  var b64 = function (o) { return Buffer.from(JSON.stringify(o)).toString('base64url'); };
  var h = b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID });
  var p = b64({ iss: process.env.APNS_TEAM_ID, iat: ahora });
  var key = String(process.env.APNS_KEY_P8 || '').replace(/\\n/g, '\n');
  var firma = crypto.sign('sha256', Buffer.from(h + '.' + p), { key: key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  JWT = { token: h + '.' + p + '.' + firma, t: ahora };
  return JWT.token;
}

function enviarApns(cliente, token, payload) {
  return new Promise(function (ok) {
    var req = cliente.request({
      ':method': 'POST',
      ':path': '/3/device/' + token,
      authorization: 'bearer ' + jwtApns(),
      'apns-topic': process.env.APNS_BUNDLE_ID || 'golf.mygolflab.coachhub',
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json'
    });
    var status = 0, data = '';
    req.on('response', function (h) { status = h[':status']; });
    req.on('data', function (c) { data += c; });
    req.on('end', function () { ok({ status: status, body: data }); });
    req.on('error', function (e) { ok({ status: 0, body: String(e && e.message || e) }); });
    req.setTimeout(8000, function () { req.close(); ok({ status: 0, body: 'timeout' }); });
    req.end(JSON.stringify(payload));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  if (!process.env.PUSH_SECRET || req.headers['x-push-secret'] !== process.env.PUSH_SECRET) {
    return res.status(401).json({ error: 'no autorizado' });
  }
  var body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || !body.fila) return res.status(400).json({ error: 'sin datos' });

  try {
    var avisos = await armarAvisos(body.tabla, body.op, body.fila, body.antes);
    if (!avisos.length) return res.json({ ok: true, enviados: 0 });
    var faltaApns = !process.env.APNS_KEY_P8 || !process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID;
    var host = process.env.APNS_SANDBOX === '1' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    var cliente = null, enviados = 0, errores = [];

    for (var i = 0; i < avisos.length; i++) {
      var a = avisos[i];
      if (!a.user_id) continue;
      var tokens = await sb('push_tokens?user_id=eq.' + a.user_id + '&select=token,platform,lang');
      for (var j = 0; j < tokens.length; j++) {
        var tk = tokens[j];
        if (tk.platform !== 'ios') continue;          // Android: pendiente (Firebase)
        if (faltaApns) { errores.push('faltan variables APNS_*'); continue; }
        var t = TXT[tk.lang] || TXT.es;
        var payload = {
          aps: { alert: { title: corto(a.titulo(t), 80), body: a.cuerpo(t) }, sound: 'default', 'thread-id': a.tipo },
          url: a.url
        };
        if (!cliente) cliente = http2.connect(host);
        var r = await enviarApns(cliente, tk.token, payload);
        if (r.status === 200) enviados++;
        else {
          errores.push(r.status + ' ' + r.body);
          // token que ya no sirve (app desinstalada, etc.): se borra
          if (r.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(r.body)) {
            await sb('push_tokens?token=eq.' + encodeURIComponent(tk.token), { method: 'DELETE' });
          }
        }
      }
    }
    if (cliente) cliente.close();
    return res.json({ ok: true, enviados: enviados, errores: errores.slice(0, 5) });
  } catch (e) {
    console.error('push', e);
    return res.status(500).json({ error: String(e && e.message || e) });
  }
}
