/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Backend del Coach IA
   Archivo: /api/coach.js
   Versión: 5.0 · 2026-11-23  ·  evidencia medida + sesión obligatoria

   ── v5.3: MÁS RÁPIDO ──────────────────────────────────────────────────────
   Claude Sonnet 5 razona por defecto en esfuerzo "high", lo que más demora.
   El análisis de swing ahora va en esfuerzo "medium" (output_config.effort):
   las mediciones ya vienen calculadas por el motor de pose, así que no hace
   falta que razone tanto. Se puede ajustar sin tocar código con variables
   de entorno en Vercel:
     COACH_EFFORT   = low | medium | high      (por defecto: medium)
     COACH_THINKING = off                      (apaga el razonamiento: lo más
                                                rápido, posible pérdida de calidad)
   Si la API rechaza esos parámetros (400), se reintenta una vez sin ellos.
   La respuesta trae data.mgl = { ms, effort, thinking } para medir tiempos.

   ── v5.0: SWING COMPLETO Y SEGURIDAD ──────────────────────────────────────
   1. El frontend (js/mgl-swing-motor.js) ahora recorre el video completo con
      detección de pose y manda las 9 posiciones detectadas (P1…P10) más
      mediciones numéricas. El system prompt explica cómo usar esa evidencia:
      el estado de un componente medido parte del nivel medido y solo se
      mueve con una razón visible que se debe explicar.
   2. SESIÓN OBLIGATORIA: antes cualquiera que conociera la URL podía usar
      el endpoint (y gastar créditos de Anthropic). Ahora se exige el token
      de sesión de Supabase (header Authorization) y plan Pro/Elite vigente,
      con la misma regla que js/auth-guard.js.
      Emergencia: la variable de entorno COACH_AUTH=off en Vercel desactiva
      la verificación sin tocar código.

   ── v4.1: MAPEO FIJO DE COMPONENTES A PILARES ─────────────────────────────
   Hasta ahora el prompt definía los 4 pilares por un lado y los 8 componentes
   por otro, sin conectarlos. El modelo asignaba el pilar a criterio propio en
   cada análisis, así que el campo `pilar` variaba entre análisis del mismo
   swing. Ahora la tabla está escrita y es obligatoria.
   El mapeo se tomó del catálogo de 84 drills de coach-ai.html, donde cada
   drill ya tiene declarados sus pilares.

   ── v4.0: modo diagnóstico (GET /api/coach devuelve estado del backend)

   ── v3.0: EVALUACIÓN DE LOS 8 COMPONENTES ─────────────────────────────────
   El modelo evalúa SIEMPRE los 8 componentes del swing antes de opinar, y
   solo narra los que tienen falla (máximo 3). Evaluar es más estable que
   elegir: esto reduce la variación entre análisis del mismo video.
   Los 8 estados se guardan aunque no se muestren: son la base del dashboard.

   ── v2.0: QUÉ CAMBIÓ RESPECTO A LA VERSIÓN 1 ──────────────────────────────

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

import { userFromToken, SUPABASE_URL, SUPABASE_ANON_KEY } from './_pagos.js';

const MODEL = 'claude-sonnet-5';
const PLANES_CON_ACCESO = ['pro', 'elite'];   // igual que js/auth-guard.js

const MAX_TOKENS_SWING = 16000;  // v5.1: con 9 imágenes + mediciones, 8000 cortaba el JSON
const MAX_TOKENS_CHAT  = 3000;
const LIMITE_MB        = 4.0;   // Vercel corta a los 4.5 MB; avisamos antes


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

════ A QUÉ PILAR PERTENECE CADA COMPONENTE — TABLA FIJA ════
Esta correspondencia es parte de la metodología y NO se decide caso a caso.
Úsala siempre, exactamente así, en todos los análisis:

  cara       → WC
  path       → KS
  lowpoint   → BT
  secuencia  → KS
  postura    → BT
  ground     → GF
  conexion   → KS
  distancia  → WC

Nunca asignes un pilar distinto al de esta tabla, aunque el defecto concreto
te parezca relacionado con otro pilar. Un mismo componente debe reportar
siempre el mismo pilar: de eso depende que el jugador vea su progreso de
forma coherente entre un análisis y el siguiente.

════ CÓMO ANALIZAR ════
Normalmente recibirás las POSICIONES DETECTADAS del swing, en orden
cronológico, cada una rotulada con su código: P1 Setup, P2 Takeaway,
P3 Mitad del backswing, P4 Top, P5 Transición, P6 Pre-impacto, P7 Impacto,
P8 Release, P10 Finish. Fueron elegidas por un detector de pose que recorrió
el video completo, así que confía en el rótulo de cada imagen.

Junto a ellas viene un bloque "EVIDENCIA MEDIDA" con mediciones del cuerpo
del jugador a lo largo de todo el swing. Úsalo así:
· Para un componente CON medición, su estado parte del nivel medido (si hay
  varias mediciones del mismo componente, la más grave). Puedes moverlo como
  máximo UN nivel, y solo si las imágenes muestran con claridad algo que la
  medición no captura; en ese caso explícalo en "que_pasa".
· Si una medición dice "no evaluable" o su confianza es baja, apóyate en
  las imágenes.
· Los componentes SIN medición (normalmente cara, path en face-on, conexión,
  distancia) se evalúan mirando las imágenes, con la misma honestidad de
  siempre.
· Cuando narres una falla medida, cita el número en lenguaje simple
  ("tu pelvis se acerca a la bola unos 6 cm entre el setup y el impacto").
  Nunca inventes números que no estén en la evidencia.
· Las mediciones son del cuerpo. El palo, la cara y el path del palo no se
  miden: sobre eso habla solo de lo que se ve en las imágenes.

Si en cambio recibes imágenes SIN rótulo de fase y sin evidencia medida
(modo básico), están tomadas a intervalos aproximadamente iguales: identifica
tú mismo qué fase muestra cada una e ignora las que no aporten.

Considera el ángulo de cámara indicado:
· Face-on (de frente): útil para low point, tilts laterales, transferencia
  de peso y posición de la bola.
· Down-the-line (línea de tiro): útil para plano de swing, path, postura,
  ángulos de columna y early extension.

No afirmes cosas que el ángulo no permite ver. Analiza con precisión técnica
y honestidad: identifica errores reales basados en lo que efectivamente ves
en los frames, no en suposiciones genéricas. Si el video no permite evaluar
algo con seguridad, no lo inventes.

════ MÉTODO DE EVALUACIÓN — OBLIGATORIO ════
Antes de escribir cualquier diagnóstico, evalúa SIEMPRE los 8 componentes del
swing, uno por uno, en este orden fijo:

  cara · path · lowpoint · secuencia · postura · ground · conexion · distancia

Para cada uno asigna exactamente uno de estos estados:
  ok            — sin observaciones relevantes
  leve          — desviación menor, no limita el resultado
  moderado      — desviación clara que afecta la consistencia
  severo        — desviación que limita el resultado de forma evidente
  no_evaluable  — el ángulo o la calidad del video no permiten juzgarlo

Usa "no_evaluable" con honestidad. Desde face-on no se ve el path del palo;
desde down-the-line no se ve bien la transferencia lateral. Es preferible
declarar que no se puede evaluar antes que inventar una observación.

Recién después de completar los 8, escribe los diagnósticos narrados: solo
para los componentes marcados severo, moderado o leve, ordenados de mayor a
menor gravedad, con un máximo de 3. Si solo hay 2 componentes con falla,
entrega 2. Si solo hay 1, entrega 1. NUNCA inventes una falla para llegar a 3.

En cada diagnóstico incluye siempre estos dos campos, además de los que pida
el esquema del mensaje del usuario:
  "componente" — uno de los 8 nombres exactos de la lista de arriba
  "pilar"      — la sigla GF, KS, WC o BT que le corresponde según la tabla fija

Esta evaluación completa no es opcional: es lo que hace que dos análisis del
mismo swing coincidan.

════ RÚBRICA DEL SCORE ════
Usa estas anclas. No inventes tu propia escala.
  85-100 — sin fallas relevantes; nivel competitivo
  70-84  — fundamentos sólidos; una falla de severidad media
  55-69  — una falla alta o dos medias; patrón funcional con fugas claras
  40-54  — dos o más fallas altas; el patrón limita el resultado
  20-39  — fallas estructurales múltiples en los fundamentos
   1-19  — solo si el video no permite evaluar el swing

CONSISTENCIA: dos análisis del mismo swing deben dar el mismo estado en los
8 componentes y un score similar. Aplica la rúbrica de forma literal y
repetible; no busques variedad en tus respuestas ni en tu redacción. La misma
evidencia medida debe llevar siempre al mismo estado.
Si se te entrega un análisis anterior del mismo jugador, úsalo SOLO para
comparar: el estado actual lo decide la evidencia de este video. Di si cada
falla persiste, mejoró o se resolvió (con números si hay mediciones de ambas
fechas) y usa el mismo nombre técnico para las fallas que sigan presentes.

NOMBRES DE LAS FALLAS: usa la terminología estándar del golf, no descripciones
propias. Di "early extension", no "se para de golpe". Di "reverse spine", no
"se inclina hacia atrás". Un mismo defecto debe llamarse siempre igual.

SOBRE error_tag: es la consecuencia que ese defecto produce con MAYOR
frecuencia en el vuelo de la bola, no lo que tú supones que pasó en este golpe
(en el video no se ve el vuelo). Usa la asociación más típica y mantenla
estable entre análisis. Referencias:
  early extension  → shank o top
  reverse spine    → top
  over-the-top     → slice
  casting / flip   → top
  hanging back     → gordo
  cara abierta     → slice
  cara cerrada     → hook
  falta de presión → potencia

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
   VERIFICACIÓN DE ACCESO
   ═══════════════════════════════════════════════════════════════════════════ */
function normalizarPlan(v) {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function verificarAcceso(req) {
  var token = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return { ok: false, status: 401, motivo: 'sin token',
             error: 'Tu sesión expiró. Vuelve a iniciar sesión para usar el Coach IA.' };
  }
  var user = null;
  try { user = await userFromToken(token); } catch (e) { user = null; }
  if (!user || !user.id) {
    return { ok: false, status: 401, motivo: 'token inválido',
             error: 'Tu sesión expiró. Vuelve a iniciar sesión para usar el Coach IA.' };
  }
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/profiles?select=plan,pro_expires_at&id=eq.' +
                        encodeURIComponent(user.id), {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
    });
    var filas = r.ok ? await r.json() : [];
    var p = filas && filas[0];
    var plan = normalizarPlan(p && p.plan);
    var vigente = !(p && p.pro_expires_at) || new Date(p.pro_expires_at) > new Date();
    if (!p || PLANES_CON_ACCESO.indexOf(plan) < 0 || !vigente) {
      return { ok: false, status: 403, motivo: 'plan ' + (plan || 'sin perfil') + (vigente ? '' : ' vencido'),
               error: 'El Coach IA es parte del plan Pro o Elite. Revisa tu suscripción.' };
    }
  } catch (e) {
    return { ok: false, status: 503, motivo: 'no se pudo leer el perfil: ' + e.message,
             error: 'No pudimos verificar tu plan. Inténtalo de nuevo en unos segundos.' };
  }
  return { ok: true, userId: user.id };
}


/* ═══════════════════════════════════════════════════════════════════════════
   HANDLER
   ═══════════════════════════════════════════════════════════════════════════ */
export default async function handler(req, res) {

  /* ── Todo va dentro de un try gigante: nada puede tumbar la función ── */
  try {

    /* ═══ MODO DIAGNÓSTICO ═══
       Abrir https://mygolflab.golf/api/coach en el navegador devuelve un
       informe del estado del backend. Sirve para saber si el problema está
       en la función o en la petición. */
    if (req.method === 'GET') {
      let nodeV = 'desconocida';
      try { nodeV = process.version; } catch (e) {}

      return res.status(200).json({
        estado: 'ok',
        mensaje: 'El backend del Coach IA está vivo y funcionando.',
        version_endpoint: '5.3',
        esfuerzo_analisis: (process.env.COACH_EFFORT || 'medium') + (String(process.env.COACH_THINKING || '').toLowerCase() === 'off' ? ' · sin razonamiento' : ''),
        max_duracion_s: 300,
        verificacion_sesion: process.env.COACH_AUTH === 'off' ? 'DESACTIVADA' : 'activa',
        mapeo_pilares: 'activo',
        modelo_configurado: MODEL,
        clave_api_presente: !!process.env.ANTHROPIC_API_KEY,
        largo_clave: process.env.ANTHROPIC_API_KEY
          ? process.env.ANTHROPIC_API_KEY.length : 0,
        clave_empieza_bien: process.env.ANTHROPIC_API_KEY
          ? process.env.ANTHROPIC_API_KEY.slice(0, 7) === 'sk-ant-' : false,
        node: nodeV,
        max_tokens_swing: MAX_TOKENS_SWING,
        limite_payload_mb: LIMITE_MB,
        hora: new Date().toISOString()
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    /* ── CORS ── */
    try {
      var ORIGENES = ['https://mygolflab.golf', 'https://www.mygolflab.golf', 'https://coachyard.golf', 'https://www.coachyard.golf'];
      var origen = String(req.headers.origin || '');
      res.setHeader('Access-Control-Allow-Origin', ORIGENES.indexOf(origen) >= 0 ? origen : 'https://mygolflab.golf');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    } catch (e) { /* si falla, seguimos igual */ }

    /* ── Clave de API ── */
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('[coach] FALTA la variable ANTHROPIC_API_KEY');
      return res.status(500).json({
        error: 'Configuración incompleta en el servidor: falta ANTHROPIC_API_KEY.',
        etapa: 'clave'
      });
    }

    /* ── Sesión y plan ──
       Misma regla que js/auth-guard.js: plan pro o elite, y vigente. */
    if (process.env.COACH_AUTH !== 'off') {
      var acceso = await verificarAcceso(req);
      if (!acceso.ok) {
        console.warn('[coach] acceso rechazado · ' + acceso.motivo);
        return res.status(acceso.status).json({ error: acceso.error, etapa: 'acceso' });
      }
    }

    /* ── Cuerpo de la petición, midiendo el tamaño ── */
    let body = req.body;
    let tamanoMB = 0;

    try {
      if (typeof body === 'string') {
        tamanoMB = Buffer.byteLength(body, 'utf8') / 1048576;
        body = JSON.parse(body);
      } else if (body && typeof body === 'object') {
        tamanoMB = Buffer.byteLength(JSON.stringify(body), 'utf8') / 1048576;
      }
    } catch (e) {
      console.error('[coach] No se pudo leer el cuerpo:', e.message);
      return res.status(400).json({
        error: 'No se pudo leer la petición. Puede que el video sea muy pesado.',
        etapa: 'cuerpo'
      });
    }

    console.log('[coach] petición recibida · ' + tamanoMB.toFixed(2) + ' MB');

    if (tamanoMB > LIMITE_MB) {
      console.error('[coach] Payload demasiado grande: ' + tamanoMB.toFixed(2) + ' MB');
      return res.status(413).json({
        error: 'El video generó imágenes demasiado pesadas (' +
               tamanoMB.toFixed(1) + ' MB). Graba un clip más corto o con menos calidad.',
        etapa: 'tamano',
        mb: Number(tamanoMB.toFixed(2))
      });
    }

    const mode = body && body.mode;
    const messages = body && body.messages;

    if (!mode || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: 'Falta "mode" o "messages" en el cuerpo de la petición',
        etapa: 'validacion'
      });
    }
    if (mode !== 'swing' && mode !== 'chat') {
      return res.status(400).json({ error: 'El campo "mode" debe ser "swing" o "chat"' });
    }
    if (messages.length > 40) {
      return res.status(400).json({ error: 'Conversación demasiado larga' });
    }

    const isSwing = mode === 'swing';

    /* El servidor fija model, max_tokens y el system prompt.
       IMPORTANTE: no agregar temperature / top_p / top_k — Sonnet 5 los rechaza. */
    const anthropicPayload = {
      model: MODEL,
      max_tokens: isSwing ? MAX_TOKENS_SWING : MAX_TOKENS_CHAT,
      system: isSwing ? SWING_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
      messages
    };

    /* Velocidad: esfuerzo del razonamiento (ver cabecera v5.3) */
    const EFFORTS = ['low', 'medium', 'high'];
    const effort = EFFORTS.indexOf(String(process.env.COACH_EFFORT || '').toLowerCase()) >= 0
      ? String(process.env.COACH_EFFORT).toLowerCase() : 'medium';
    const sinThinking = String(process.env.COACH_THINKING || '').toLowerCase() === 'off';
    anthropicPayload.output_config = { effort: effort };
    if (sinThinking) anthropicPayload.thinking = { type: 'disabled' };

    console.log('[coach] llamando a Anthropic · modo=' + mode + ' · modelo=' + MODEL);
    const inicio = Date.now();

    let response, data;
    function llamar(payload) {
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload)
      });
    }
    let ajustesUsados = { effort: effort, thinking: sinThinking ? 'off' : 'adaptive' };
    try {
      response = await llamar(anthropicPayload);
      /* Si la API no acepta effort/thinking para este modelo, reintento sin ellos */
      if (response.status === 400) {
        const errTxt = await response.clone().text();
        if (/effort|output_config|thinking/i.test(errTxt)) {
          console.warn('[coach] La API rechazó effort/thinking, reintento sin ellos: ' + errTxt.slice(0, 300));
          delete anthropicPayload.output_config;
          delete anthropicPayload.thinking;
          ajustesUsados = { effort: 'por defecto', thinking: 'por defecto' };
          response = await llamar(anthropicPayload);
        }
      }
    } catch (e) {
      console.error('[coach] Falló la conexión con Anthropic:', e.message);
      return res.status(502).json({
        error: 'No se pudo conectar con el servicio de IA. Inténtalo de nuevo.',
        etapa: 'conexion'
      });
    }

    try {
      data = await response.json();
    } catch (e) {
      console.error('[coach] Respuesta ilegible de Anthropic:', e.message);
      return res.status(502).json({
        error: 'El servicio de IA devolvió una respuesta ilegible.',
        etapa: 'respuesta'
      });
    }

    const ms = Date.now() - inicio;

    /* ── Error del lado de Anthropic ── */
    if (!response.ok) {
      console.error('[coach] Error de Anthropic ' + response.status + ': ' +
                    JSON.stringify(data).slice(0, 500));

      const mensajes = {
        400: 'La solicitud fue rechazada por el servicio de IA.',
        401: 'La clave de API es inválida o expiró.',
        403: 'La clave de API no tiene permiso para usar este modelo.',
        404: 'El modelo "' + MODEL + '" no existe o fue retirado. Hay que actualizarlo.',
        413: 'Las imágenes son demasiado pesadas. Graba un clip más corto.',
        429: 'Demasiadas solicitudes o sin créditos. Revisa tu saldo en Anthropic.',
        500: 'El servicio de IA tuvo un error interno. Inténtalo de nuevo.',
        529: 'El servicio está sobrecargado. Inténtalo en unos segundos.'
      };

      return res.status(response.status).json({
        error: mensajes[response.status] || 'Error al comunicarse con el servicio de IA',
        codigo: response.status,
        tipo: (data && data.error && data.error.type) || null,
        detalle: (data && data.error && data.error.message) || null,
        etapa: 'anthropic'
      });
    }

    /* ── Filtrar bloques de razonamiento ──
       Sonnet 5 devuelve bloques "thinking" además del texto.
       coach-ai.html espera solo bloques con .text, así que los quitamos. */
    let bloquesAntes = 0;
    if (Array.isArray(data.content)) {
      bloquesAntes = data.content.length;
      data.content = data.content.filter(function (b) { return b && b.type === 'text'; });
    }

    if (data.stop_reason === 'max_tokens') {
      console.warn('[coach] Respuesta TRUNCADA por max_tokens. Subir el límite.');
      if (isSwing) {
        return res.status(502).json({
          error: 'La respuesta de la IA llegó incompleta. Inténtalo de nuevo.',
          etapa: 'truncado',
          tokens: data.usage || null
        });
      }
    }

    console.log('[coach] ok · modo=' + mode + ' · effort=' + ajustesUsados.effort + ' · ' + ms + 'ms · tokens=' +
      ((data.usage && data.usage.input_tokens) || '?') + '/' +
      ((data.usage && data.usage.output_tokens) || '?') +
      ' · bloques ' + bloquesAntes + '→' +
      (Array.isArray(data.content) ? data.content.length : '?'));

    data.mgl = { ms: ms, effort: ajustesUsados.effort, thinking: ajustesUsados.thinking,
                 tokens: data.usage || null };
    return res.status(200).json(data);

  } catch (err) {
    /* Red de seguridad final: pase lo que pase, respondemos algo legible */
    try {
      console.error('[coach] EXCEPCIÓN NO CONTROLADA:', err && err.stack ? err.stack : err);
      return res.status(500).json({
        error: 'Error interno del servidor',
        etapa: 'excepcion',
        detalle: (err && err.message) ? String(err.message).slice(0, 300) : 'desconocido'
      });
    } catch (e2) {
      return res.status(500).end('error');
    }
  }
}
