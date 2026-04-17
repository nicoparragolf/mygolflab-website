// auth-guard.js — MyGolfLab
// Uso: <script src="/js/auth-guard.js" data-require="pro"></script>
// data-require="auth"  → solo requiere estar logueado (ej: dashboard)
// data-require="pro"   → requiere plan pro (ej: coach-ai, training, biblioteca)

(async () => {
  const SUPABASE_URL = 'https://TU_PROJECT.supabase.co';
  const SUPABASE_ANON_KEY = 'TU_ANON_KEY';

  const { createClient } = supabase; // asume que supabase-js ya está cargado

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Leer qué nivel requiere esta página
  const script = document.currentScript;
  const required = script?.getAttribute('data-require') || 'auth';

  // Rutas
  const LOGIN_URL = '/es/login.html';
  const UPGRADE_URL = '/es/upgrade.html';
  const CURRENT = window.location.pathname;

  // Mostrar overlay mientras verifica
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

  try {
    // 1. Verificar sesión
    const { data: { session } } = await client.auth.getSession();

    if (!session) {
      // No logueado → login
      window.location.href = `${LOGIN_URL}?redirect=${encodeURIComponent(CURRENT)}`;
      return;
    }

    if (required === 'auth') {
      // Solo necesita estar logueado
      overlay.remove();
      return;
    }

    // 2. Verificar plan pro
    const { data: profile, error } = await client
      .from('profiles')
      .select('plan, pro_expires_at')
      .eq('id', session.user.id)
      .single();

    if (error || !profile) {
      window.location.href = UPGRADE_URL;
      return;
    }

    const isPro = profile.plan === 'pro' && (
      !profile.pro_expires_at ||
      new Date(profile.pro_expires_at) > new Date()
    );

    if (!isPro) {
      window.location.href = UPGRADE_URL;
      return;
    }

    // Todo ok
    overlay.remove();

  } catch (err) {
    console.error('Auth guard error:', err);
    window.location.href = LOGIN_URL;
  }
})();
