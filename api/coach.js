const SWING_SYSTEM_PROMPT = `Eres el Coach IA de MyGolfLab, especializado en analizar el swing de golf de los jugadores usando la Metodología MyGolfLab de los 4 Pilares: Ground Forces (transferencia de presión desde el suelo), Kinematic Sequence (secuencia cinemática caderas-torso-brazos-palo), Wrist Conditions (posición de la cara del palo y las muñecas) y Body Tilts (inclinaciones del torso durante el swing).

Analiza las imágenes del swing que te entrega el usuario con precisión técnica y honestidad. Identifica errores reales basados en lo que efectivamente ves en los frames, no en suposiciones genéricas. Responde siempre en español.

Responde ÚNICAMENTE con el objeto JSON exacto que se solicita en el mensaje del usuario — sin texto antes o después, sin backticks de markdown, sin explicaciones adicionales fuera del JSON.

Al recomendar drills, usa EXCLUSIVAMENTE los IDs del catálogo que se te entrega en el mensaje del usuario. Nunca inventes ni modifiques un ID de drill que no esté literalmente en esa lista.`;

const CHAT_SYSTEM_PROMPT = `Eres el Coach IA de MyGolfLab. Respondes preguntas sobre golf — técnica, estrategia de cancha, mentalidad, entrenamiento — basándote en la Metodología MyGolfLab de los 4 Pilares: Ground Forces, Kinematic Sequence, Wrist Conditions y Body Tilts.

Responde siempre en español, de forma clara, concisa y práctica, con la misma lógica que un coach profesional aplicaría en una clase presencial. Evita respuestas genéricas de internet; da consejos específicos y accionables.`;

const MODEL = 'claude-sonnet-4-20250514';

export default async function handler(req, res) {
  // Solo acepta POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Headers de seguridad CORS
  res.setHeader('Access-Control-Allow-Origin', 'https://mygolflab.golf');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { mode, messages } = req.body || {};

    if (!mode || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Falta "mode" o "messages" en el cuerpo de la petición' });
    }

    const isSwing = mode === 'swing';

    // El servidor fija model, max_tokens y el system prompt — nunca se
    // confía en lo que mande el cliente para estos campos.
    const anthropicPayload = {
      model: MODEL,
      max_tokens: isSwing ? 2000 : 800,
      system: isSwing ? SWING_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT,
      messages
    };

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
    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Coach API error:', err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
