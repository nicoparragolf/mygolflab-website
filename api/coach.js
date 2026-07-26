/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Backend del Coach IA
   Archivo: /api/coach.js
   Versión: 2.0 · 2026-07-26

   ── QUÉ CAMBIÓ RESPECTO A LA VERSIÓN ANTERIOR ──────────────────────────────

   1. MODELO ACTUALIZADO  ← esta era la causa del error 404
      'claude-sonnet-4-20250514' fue RETIRADO por Anthropic el 15/06/2026.
      Las llamadas a ese modelo devuelven 404 "not found".
      Reemplazado por 'claude-sonnet-5'.

   2. NADA DE temperature / top_p / top_k
      Sonnet 5 rechaza estos parámetros con error 400. No agregarlos nunca.
      La consistencia entre análisis ahora se logra por instrucciones del
      system prompt, no por temperatura.

   3. max_tokens MÁS ALTO
      Sonnet 5 tiene "adaptive thinking" activo por defecto: piensa antes de
      responder, y ese razonamiento consume parte del presupuesto de tokens.
      Además su tokenizador cuenta ~30% más. Con 2000 tokens el JSON del
      análisis se cortaba a la mitad.

   4. SE FILTRAN LOS BLOQUES DE RAZONAMIENTO
      La respuesta ahora trae bloques de tipo "thinking" además del texto.
      coach-ai.html no los entiende, así que se eliminan acá antes de
      devolver la respuesta. Esto evita tocar el frontend.

   5. RÚBRICA DEL SCORE EN EL SYSTEM PROMPT
      Para que dos análisis del mismo swing den puntajes parecidos.

   6. MENSAJES DE ERROR EN ESPAÑOL
      Antes se devolvía el error crudo de Anthropic y era imposible saber
      qué pasaba desde el navegador.

   REQUIERE: variable de entorno ANTHROPIC_API_KEY en Vercel.
   ═══════════════════════════════════════════════════════════════════════════ */

const MODEL = 'claude-sonnet-5';

const MAX_TOKENS_SWING = 8000;   // deja espacio para el razonamiento + el JSON
const MAX_TOKENS_CHAT  = 3000;


/* ═══════════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT · ANÁLISIS DE SWING
   ═══════════════════════════════════════════════════════════════════════════ */
const SWING_SYSTEM_PROMPT = `Eres el Coach IA de MyGolfLab, especializado en analizar el swing de golf
usando la Metodología MyGolfLab de los 4 Pilares.

════ LOS 4 PILARES ════
GF · GROUND FORCES — el motor
   Transferencia de presión desde el suelo hasta el palo, en tres vectores:
   vertical, horizontal y rotacional.
   Errores típicos: hanging back, negative footwork, early extension.

KS · KINEMATIC SEQUENCE — la transmisión
   Orden y timing de la cadena: pelvis → torso → brazos → palo.
   Errores típicos: over-the-top, stall, casting, brazos primero.

WC · WRIST CONDITIONS — el volante
   Shaft lean, lag y orientación de la cara del palo al impacto.
   Errores típicos: cupping, bowing excesivo, casting, flip.

BT · BODY TILTS — el chasis
   Forward bend, side bend y rotación en cada fase del swing.
   Errores típicos: early extension, reverse spine, hanging back, standing up.

════ CÓMO ANALIZAR ════
Recibirás 6 frames tomados a intervalos aproximadamente iguales del video.
NO asumas que cada frame corresponde a una fase específica: identifica tú
mismo qué fase muestra cada uno. Si un frame no aporta, ignóralo.

Considera el ángulo de cámara indicado:
· Face-on (de frente): útil para low point, tilts laterales, transferencia
  de peso y posición de la bola.
· Down-the-line (línea de tiro): útil para plano de swing, path, postura,
  ángulos de columna y early extension.

No afirmes cosas que el ángulo no permite ver. Analiza con precisión técnica
y honestidad: identifica errores reales basados en lo que efectivamente ves
en los frames, no en suposiciones genéricas. Si el video no permite evaluar
algo con seguridad, no lo inventes.

════ RÚBRICA DEL SCORE ════
Usa estas anclas. No inventes tu propia escala.
  85-100 — sin fallas relevantes; nivel competitivo
  70-84  — fundamentos sólidos; una falla de severidad media
  55-69  — una falla alta o dos medias; patrón funcional con fugas claras
  40-54  — dos o más fallas altas; el patrón limita el resultado
  20-39  — fallas estructurales múltiples en los fundamentos
   1-19  — solo si el video no permite evaluar el swing

CONSISTENCIA: dos análisis del mismo swing deben dar un score similar y las
mismas fallas. Aplica la rúbrica de forma literal y repetible; no busques
variedad en tus respuestas. Si se te entrega un análisis anterior del mismo
jugador, evalúa explícitamente si cada falla persiste, mejoró o se resolvió,
y mantén la misma clasificación para las fallas que sigan presentes.

════ TONO ════
Directo, cercano y sin jerga innecesaria. Explica el "por qué" antes del
"qué hacer". Adapta el vocabulario al nivel del jugador: a un principiante
háblale de sensaciones, a un avanzado puedes usar términos técnicos.
No condesciendas ni exageres los elogios.
Español de Chile, natural y profesional. Trata al jugador de "tú".

════ FORMATO DE SALIDA ════
Responde ÚNICAMENTE con el objeto JSON exacto que se solicita en el mensaje
del usuario: sin texto antes ni después, sin backticks de markdown, sin
explicaciones fuera del JSON.

Al recomendar drills, usa EXCLUSIVAMENTE los IDs del catálogo que se te
entrega en el mensaje del usuario. Nunca inventes ni modifiques un ID que no
esté literalmente en esa lista: los IDs inválidos se descartan y el jugador
se queda sin ejercicio.`;


/* ═══════════════════════════════════════════════════════════════════════════
   SYSTEM PROMPT · CHAT
   ═══════════════════════════════════════════════════════════════════════════ */
const CHAT_SYSTEM_PROMPT = `Eres el Coach IA de MyGolfLab. Respondes preguntas sobre golf —técnica,
estrategia de cancha, mentalidad, entrenamiento— basándote en la Metodología
MyGolfLab de los 4 Pilares: Ground Forces (el motor), Kinematic Sequence
(la transmisión), Wrist Conditions (el volante) y Body Tilts (el chasis).

════ CÓMO RESPONDES ════
· Claro, conciso y práctico, como un coach en una clase presencial.
· Explica la causa antes de la solución. El jugador que entiende, corrige.
· Evita respuestas genéricas de internet: da consejos específicos y accionables.
· Cuando falte contexto, pregunta antes de suponer. Una pregunta a la vez.
· Si la consulta requiere ver el swing, sugiere usar "Analizar Swing".
· Si el tema calza con ejercicios, menciona la Biblioteca (drills técnicos)
  o el Training Lab (drills de rendimiento con puntuación). No inventes
  nombres de drills: refiere a la sección.

════ LÍMITES ════
· No des consejo médico. Ante dolor o lesión, deriva a un profesional.
· No prometas resultados ni plazos concretos de mejora.
· Si no sabes algo, dilo.

════ TONO ════
Español de Chile, natural y profesional. Trata al jugador de "tú".
Es una conversación, no un manual: nada de listas interminables.`;


/* ═══════════════════════════════════════════════════════════════════════════
   HANDLER
   ═══════════════════════════════════════════════════════════════════════════ */
export default async function handler(req, res) {

  // Solo acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      nota: 'Si ves este mensaje en el navegador, el backend está funcionando correctamente.'
    });
  }

  // Headers de seguridad CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://mygolflab.golf');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // La clave debe existir antes de intentar nada
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('[coach] Falta la variable de entorno ANTHROPIC_API_KEY');
    return res.status(500).json({
      error: 'Configuración incompleta en el servidor: falta ANTHROPIC_API_KEY.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); }
      catch (e) { return res.status(400).json({ error: 'JSON inválido en el cuerpo de la petición' }); }
    }

    const { mode, messages } = body || {};

    if (!mode || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Falta "mode" o "messages" en el cuerpo de la petición' });
    }
    if (mode !== 'swing' && mode !== 'chat') {
      return res.status(400).json({ error: 'El campo "mode" debe ser "swing" o "chat"' });
    }
    if (messages.length > 40) {
      return res.status(400).json({ error: 'Conversación demasiado larga' });
    }

    const isSwing = mode === 'swing';

    /* El servidor fija model, max_tokens y el system prompt.
       Nunca se confía en lo que mande el cliente para estos campos.
       IMPORTANTE: no agregar temperature / top_p / top_k — Sonnet 5 los rechaza. */
    const anthropicPayload = {
      model: MODEL,
      max_tokens: isSwing ? MAX_TOKENS_SWING : MAX_TOKENS_CHAT,
      system: isSwing ? SWING_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
      messages
    };

    const inicio = Date.now();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(anthropicPayload)
    });

    const data = await response.json();
    const ms = Date.now() - inicio;

    /* ── Error del lado de Anthropic ── */
    if (!response.ok) {
      console.error('[coach] Error de Anthropic', response.status, JSON.stringify(data));

      const mensajes = {
        400: 'La solicitud fue rechazada. Revisa los parámetros enviados.',
        401: 'La clave de API es inválida o expiró.',
        403: 'La clave de API no tiene permiso para usar este modelo.',
        404: 'El modelo "' + MODEL + '" no existe o fue retirado. Hay que actualizarlo.',
        413: 'El video generó imágenes demasiado pesadas. Graba un clip más corto.',
        429: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
        500: 'El servicio de IA tuvo un error interno. Inténtalo de nuevo.',
        529: 'El servicio está sobrecargado. Inténtalo en unos segundos.'
      };

      return res.status(response.status).json({
        error: mensajes[response.status] || 'Error al comunicarse con el servicio de IA',
        codigo: response.status,
        tipo: (data && data.error && data.error.type) || null
      });
    }

    /* ── Filtrar bloques de razonamiento ──
       Sonnet 5 devuelve bloques "thinking" además del texto. coach-ai.html
       espera solo bloques con .text, así que los quitamos acá.            */
    if (Array.isArray(data.content)) {
      data.content = data.content.filter(function (b) {
        return b && b.type === 'text';
      });
    }

    /* ── Aviso si la respuesta se cortó por falta de tokens ── */
    if (data.stop_reason === 'max_tokens') {
      console.warn('[coach] Respuesta truncada por max_tokens. Subir el límite de ' +
                   (isSwing ? MAX_TOKENS_SWING : MAX_TOKENS_CHAT));
    }

    console.log('[coach] ok · modo=' + mode + ' · ' + ms + 'ms · tokens=' +
      ((data.usage && data.usage.input_tokens) || '?') + '/' +
      ((data.usage && data.usage.output_tokens) || '?') +
      ' · bloques=' + (Array.isArray(data.content) ? data.content.length : '?'));

    return res.status(200).json(data);

  } catch (err) {
    console.error('Coach API error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
