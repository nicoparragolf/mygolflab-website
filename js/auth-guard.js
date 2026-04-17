(async () => {
  const SUPABASE_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';

  const script = document.currentScript;
  const required = script?.getAttribute('data-require') || 'auth';

  const LOGIN_URL = '/es/login.html';
  const UPGRADE_URL = '/es/upgrade.html';
  const CURRENT = window.location.pathname;

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
