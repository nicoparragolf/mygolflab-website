/* ═══════════════════════════════════════════════════════════════════════════
   Coach Hub · Asistente IA del coach ("Caddie")
   Archivo: /api/asistente.js
   Versión: 1.0 · 2026-11-04

   Cómo funciona
   ─────────────
   El navegador del coach manda la conversación y una foto del contexto
   (lista de sus alumnos, página en la que está, fecha de hoy). Este endpoint
   le agrega el system prompt y la lista de herramientas, llama a Claude y
   devuelve la respuesta tal cual (incluidos los bloques "thinking", que hay
   que devolver sin tocar en la vuelta siguiente cuando hay herramientas).

   Las herramientas NO se ejecutan acá: las ejecuta el navegador con la
   sesión del propio coach. Así rigen las mismas reglas de seguridad (RLS)
   que en el resto de la plataforma y este servidor nunca toca la base de
   datos. Todo lo que escribe (eventos, notas, mensajes) se muestra antes en
   una tarjeta y solo se guarda si el coach confirma.

   Seguridad
   ─────────
   · Solo responde a usuarios con sesión válida de Supabase (token Bearer).
   · Solo a cuentas con rol coach o ambos.
   · Límites de tamaño de conversación para que nadie lo use de proxy gratis.

   POST /api/asistente
     Headers: Authorization: Bearer <token de sesión de Supabase>
     Body:    { messages: [...], contexto: {...} }
   GET  /api/asistente  → diagnóstico

   REQUIERE: ANTHROPIC_API_KEY en Vercel (la misma que usa /api/coach).
   ═══════════════════════════════════════════════════════════════════════════ */

import { userFromToken, SUPABASE_URL, SUPABASE_ANON_KEY } from './_pagos.js';

const MODEL = 'claude-sonnet-5';      // el mismo que ya funciona en /api/coach
const MAX_TOKENS = 4000;              // deja espacio al razonamiento adaptativo
const MAX_MENSAJES = 60;
const MAX_KB = 400;

export const NOMBRE = 'Caddie';

/* ── Herramientas que el navegador sabe ejecutar ── */
const TOOLS = [
  {
    name: 'buscar_jugadores',
    description: 'Busca alumnos del coach por nombre o apellido (tolera tildes y nombres incompletos). Úsala cuando el nombre que dijo el coach no calce claramente con uno solo de la lista de alumnos del contexto.',
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Nombre, apellido o parte de ellos' } },
      required: ['texto']
    }
  },
  {
    name: 'crear_evento',
    description: 'Prepara un evento nuevo en el timeline de un alumno. El coach lo revisa y confirma antes de que se guarde. Tipos permitidos: clase, video_analisis, launch_monitor, rutina_calentamiento, preparacion_fisica.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string', description: 'id del alumno (de la lista del contexto o de buscar_jugadores)' },
        tipo: { type: 'string', enum: ['clase', 'video_analisis', 'launch_monitor', 'rutina_calentamiento', 'preparacion_fisica'] },
        titulo: { type: 'string', description: 'Título corto y claro, máximo ~60 caracteres. Ej: "Postura · posición de pelota"' },
        descripcion: { type: 'string', description: 'Descripción del trabajo, redactada como la escribiría el coach. Puede usar viñetas con "- " y saltos de línea.' },
        fecha: { type: 'string', description: 'Fecha del evento en formato AAAA-MM-DD. Si el coach no dice otra, la de hoy.' },
        pilar: { type: 'string', enum: ['ground_forces', 'kinematic_sequence', 'body_tilts', 'wrist_conditions'], description: 'Pilar de la metodología. Omitir si no corresponde claramente.' },
        area: { type: 'string', enum: ['full_swing', 'short_game', 'putting', 'fisico', 'estrategia'], description: 'Área del juego. Solo para clase, video_analisis, launch_monitor y preparacion_fisica.' },
        dispositivo: { type: 'string', description: 'Solo para launch_monitor: Trackman, GCQuad, etc.' },
        hito: { type: 'boolean', description: 'true solo si el coach dice explícitamente que es un hito' }
      },
      required: ['player_id', 'tipo', 'titulo', 'descripcion']
    }
  },
  {
    name: 'crear_nota',
    description: 'Prepara una nota rápida en la pestaña Notas del perfil del alumno (frases, recordatorios, quotes de la clase). El coach confirma antes de guardar.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string' },
        texto: { type: 'string' }
      },
      required: ['player_id', 'texto']
    }
  },
  {
    name: 'enviar_mensaje',
    description: 'Prepara un mensaje del coach a un alumno en la sección Mensajes. El coach lo revisa y confirma antes de enviarlo. Escríbelo en primera persona como si fuera el coach, tuteando al alumno.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string' },
        texto: { type: 'string' }
      },
      required: ['player_id', 'texto']
    }
  },
  {
    name: 'ver_eventos_recientes',
    description: 'Devuelve los últimos eventos del timeline de un alumno (tipo, título, fecha, descripción). Úsala para responder sobre qué se trabajó, o para dar continuidad a una clase.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string' },
        cantidad: { type: 'integer', description: 'Cuántos eventos, por defecto 5, máximo 15' }
      },
      required: ['player_id']
    }
  },
  {
    name: 'ver_notas',
    description: 'Devuelve las últimas notas rápidas del perfil de un alumno.',
    input_schema: {
      type: 'object',
      properties: { player_id: { type: 'string' } },
      required: ['player_id']
    }
  },
  {
    name: 'ver_clases_pendientes',
    description: 'Devuelve las solicitudes de clase online que el coach tiene pendientes de responder en la sección Clases.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'abrir_pagina',
    description: 'Lleva al coach a una página de Coach Hub. Úsala solo si el coach lo pide o si la tarea no se puede hacer desde el chat (metas, planes de entrenamiento, rondas de torneo, subir videos).',
    input_schema: {
      type: 'object',
      properties: {
        destino: { type: 'string', enum: ['perfil_jugador', 'notas_jugador', 'nuevo_evento', 'mensajes', 'clases', 'analizar_swing', 'dashboard', 'jugadores', 'contenido', 'cuenta'] },
        player_id: { type: 'string', description: 'Para perfil_jugador, notas_jugador, nuevo_evento y mensajes' }
      },
      required: ['destino']
    }
  }
];

function systemPrompt(ctx) {
  ctx = ctx || {};
  var jugadores = Array.isArray(ctx.jugadores) ? ctx.jugadores.slice(0, 400) : [];
  var lista = jugadores.length
    ? jugadores.map(function (j) {
        return '- ' + String(j.nombre || '').slice(0, 80) + ' · id ' + String(j.id || '').slice(0, 40) +
          (j.categoria ? ' · ' + String(j.categoria).slice(0, 30) : '');
      }).join('\n')
    : '(el coach todavía no tiene alumnos)';

  return `Eres ${NOMBRE}, el asistente de IA de Coach Hub (plataforma de MyGolfLab para coaches de golf).
Trabajas para el coach ${String(ctx.coach || '').slice(0, 80) || 'que te habla'}. Tu trabajo es ahorrarle tiempo:
registrar en la plataforma lo que te pide, rápido y bien redactado, muchas veces
mientras está en plena clase con el celular en la mano.

════ CONTEXTO ACTUAL ════
Hoy es ${String(ctx.hoy || '').slice(0, 40)} (zona horaria del coach). Fecha ISO de hoy: ${String(ctx.hoy_iso || '').slice(0, 10)}.
Página en la que está el coach: ${String(ctx.pagina || '').slice(0, 80)}.
${ctx.jugador_abierto ? 'Tiene abierto el perfil de: ' + String(ctx.jugador_abierto.nombre || '').slice(0, 80) + ' (id ' + String(ctx.jugador_abierto.id || '').slice(0, 40) + '). Si dice "este alumno", "él" o "ella" sin nombrar a nadie, es este.' : ''}

Alumnos del coach:
${lista}

════ CÓMO TRABAJAS ════
· Si el pedido es claro, ejecútalo directo con la herramienta. No pidas permiso
  para usarla: la plataforma ya le muestra al coach una tarjeta para revisar y
  confirmar antes de guardar cualquier cosa.
· Identifica al alumno con la lista de arriba. Si el nombre calza con uno solo,
  úsalo aunque esté incompleto o sin tildes. Si calza con varios o con ninguno,
  pregunta cuál (en una línea, ofreciendo las opciones).
· Si el coach pide varias cosas en un mensaje, prepáralas todas.
· Después de que una acción se guarda, confírmalo en una frase corta. No repitas
  todo el contenido. Si el coach canceló, acéptalo sin insistir.
· Nunca digas que guardaste algo si la herramienta no devolvió ok.
· Metas, planes de entrenamiento, rondas de torneo y subir videos todavía no
  se pueden hacer desde el chat: dilo en una línea y ofrece abrir la página.

════ CÓMO REDACTAS UN EVENTO ════
· Título: corto, específico. Ej: "Postura · posición de pelota", "Wedges 50–80 m".
· Descripción: escrita como la escribiría el coach en su bitácora, en español de
  Chile, clara y técnica. Ordena lo que dijo en viñetas ("- ") si hay más de una
  idea. Mantén fielmente las indicaciones del coach: no agregues correcciones,
  drills ni diagnósticos que él no mencionó. Puedes mejorar la redacción.
· Tipo: "clase" por defecto cuando habla de una clase o de lo que trabajaron.
  "video_analisis" si es un análisis de video; "launch_monitor" si habla de
  Trackman u otro monitor; "preparacion_fisica" para trabajo físico;
  "rutina_calentamiento" para calentamiento previo a competir.
· Fecha: hoy, salvo que diga otra ("ayer", "el martes"); calcúlala tú.
· Pilar (metodología de los 4 pilares de MyGolfLab), solo si es claro:
    postura, lowpoint, inclinaciones, early extension → body_tilts
    cara del palo, muñecas, lag, shaft lean, control de distancia → wrist_conditions
    path, secuencia, conexión, over-the-top, transición → kinematic_sequence
    presión, piso, trabajo de pies, transferencia de peso → ground_forces
  La posición de pelota es parte de la postura/setup → body_tilts.
· Área: full_swing para swing completo y setup; short_game para chip, pitch,
  bunker y wedges cortos; putting; fisico; estrategia para cancha y manejo.
· Hito: false, salvo que el coach diga que es un hito.

════ TONO ════
Español de Chile, cercano y profesional. Tutea al coach. Respuestas cortas:
el coach está ocupado. Sin listas largas, sin emojis, sin relleno.${String(ctx.idioma || '') === 'en' ? `

════ IDIOMA ════
El coach usa Coach Hub en inglés. Respóndele SIEMPRE en inglés (de Estados
Unidos), con el mismo tono cercano y corto. Los títulos, descripciones, notas
y mensajes que prepares también van en inglés. Si el coach te escribe en
español, igual respóndele en inglés salvo que te pida otra cosa. Los valores
internos (tipo, pilar, área) no cambian.` : ''}`;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      return res.status(200).json({
        estado: 'ok',
        asistente: NOMBRE,
        modelo: MODEL,
        clave_api_presente: !!process.env.ANTHROPIC_API_KEY,
        hora: new Date().toISOString()
      });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY en el servidor.' });
    }

    // ── sesión del coach ──
    var token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    var user = await userFromToken(token);
    if (!user || !user.id) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a entrar.' });

    var rp = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    var perfil = rp.ok ? await rp.json() : [];
    var rol = perfil && perfil[0] && perfil[0].role;
    if (rol !== 'coach' && rol !== 'ambos') {
      return res.status(403).json({ error: 'El asistente es solo para coaches.' });
    }

    // ── cuerpo ──
    var body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    var messages = body && body.messages;
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Falta la conversación.' });
    if (messages.length > MAX_MENSAJES) return res.status(400).json({ error: 'La conversación es muy larga. Empieza una nueva.' });
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_KB * 1024) {
      return res.status(413).json({ error: 'La conversación es muy larga. Empieza una nueva.' });
    }

    var payload = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt(body.contexto),
      tools: TOOLS,
      messages: messages
    };

    var r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return null; });

    if (!r.ok || !data) {
      console.error('[asistente] Anthropic ' + r.status + ': ' + JSON.stringify(data).slice(0, 500));
      var msg = {
        401: 'La clave de la IA es inválida.',
        429: 'Demasiadas solicitudes o sin créditos en Anthropic. Inténtalo en un rato.',
        529: 'La IA está sobrecargada. Inténtalo en unos segundos.'
      }[r.status] || 'La IA no pudo responder. Inténtalo de nuevo.';
      return res.status(502).json({ error: msg, codigo: r.status, detalle: data && data.error && data.error.message });
    }

    console.log('[asistente] ok · ' + user.id.slice(0, 8) + ' · stop=' + data.stop_reason +
      ' · tokens=' + (data.usage && data.usage.input_tokens) + '/' + (data.usage && data.usage.output_tokens));

    return res.status(200).json({ content: data.content || [], stop_reason: data.stop_reason });
  } catch (err) {
    console.error('[asistente] excepción', err && err.stack ? err.stack : err);
    return res.status(500).json({ error: 'Error interno del asistente.' });
  }
}
