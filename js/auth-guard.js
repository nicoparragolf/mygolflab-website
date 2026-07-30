/* ═══════════════════════════════════════════════════════════════════════════
   MyGolfLab · Guardia de sesión
   Archivo: /js/auth-guard.js
   Versión: 1.1 · 2026-07-30

   QUÉ CAMBIÓ RESPECTO A LA VERSIÓN ANTERIOR
   1. El plan Elite ahora pasa el control. Antes se comparaba contra 'pro'
      exacto, así que un usuario Elite —el plan más caro— rebotaba a la
      página de upgrade y no podía entrar ni a Coach IA ni a Training Lab.
   2. El plan se compara sin distinguir mayúsculas ni espacios sobrantes.
      Si en la base quedó guardado "Pro" o " pro ", igual funciona.
   3. Si el usuario no tiene fila en la tabla profiles, ya no se cae: avisa
      en la consola y lo trata como plan básico.
   4. Al redirigir a upgrade se conserva la página de origen, para poder
      devolver al jugador donde estaba después de pagar.
   ═══════════════════════════════════════════════════════════════════════════ */
(async () => {
  const SUPABASE_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';

  const script = document.currentScript;
  const required = script?.getAttribute('data-require') || 'auth';
  const LOGIN_URL = '/es/login.html';
  const UPGRADE_URL = '/es/upgrade.html';
  const CURRENT = window.location.pathname;

  /* Planes que dan acceso a las secciones marcadas con data-require="pro" */
  const PLANES_CON_ACCESO = ['pro', 'elite'];

  function normalizarPlan(valor) {
    return String(valor || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Esperar al DOM antes de insertar overlay
  const init = async () => {
    const overlay = document.createElement('div');
    overlay.id = 'auth-checking';
    overlay.style.cssText = `
      position:fixed;inset:0;background:#0a0a0a;
      display:flex;align-items:center;justify-content:center;
      z-index:99999;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;color:#fff;font-family:'Barlow Condensed',sans-serif;">
        <div style="font-size:1.2rem;letter-spacing:0.1em;opacity:0.6;">VERIFICANDO ACCESO...</div>
      </div>
    `;
    document.body.appendChild(overlay);

    const { createClient } = window.supabase;
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
      const { data: { session } } = await client.auth.getSession();

      if (!session) {
        window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(CURRENT)}`;
        return;
      }

      if (required === 'auth') {
        overlay.remove();
        return;
      }

      /* maybeSingle en vez de single: si el usuario todavía no tiene fila en
         profiles, devuelve null en vez de lanzar un error. */
      const { data: profile, error } = await client
        .from('profiles')
        .select('plan, pro_expires_at')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) {
        console.error('Auth guard · no se pudo leer el perfil:', error.message);
        window.location.href = `${UPGRADE_URL}?redirect=${encodeURIComponent(CURRENT)}`;
        return;
      }

      if (!profile) {
        console.warn('Auth guard · el usuario ' + session.user.id +
                     ' no tiene fila en la tabla profiles. Se trata como plan básico.');
        window.location.href = `${UPGRADE_URL}?redirect=${encodeURIComponent(CURRENT)}`;
        return;
      }

      const plan = normalizarPlan(profile.plan);
      const planConAcceso = PLANES_CON_ACCESO.includes(plan);
      const vigente = !profile.pro_expires_at ||
                      new Date(profile.pro_expires_at) > new Date();

      if (!planConAcceso || !vigente) {
        window.location.href = `${UPGRADE_URL}?redirect=${encodeURIComponent(CURRENT)}`;
        return;
      }

      overlay.remove();

    } catch (err) {
      console.error('Auth guard error:', err);
      window.location.href = LOGIN_URL;
    }
  };

  // Esperar al body
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
