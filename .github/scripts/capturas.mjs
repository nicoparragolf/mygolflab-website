// ═══════════════════════════════════════════════════════════════════════════
//  CoachYard · Capturas de pantalla para el App Store
//
//  Abre la web como la ve la app en un iPhone 6.5" (414×896 a 3x → 1242×2688,
//  el tamaño que Apple acepta como obligatorio) con la cuenta de prueba
//  revision@coachyard.golf, y guarda los PNG en ./capturas/.
//
//  Uso: DEMO_PASSWORD=... node .github/scripts/capturas.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'https://mygolflab.golf';
const SB_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
const EMAIL = 'revision@coachyard.golf';
const PASS = process.env.DEMO_PASSWORD;
const TOMAS = '6f56ff6a-764d-4aad-9df5-4faeddcb4991';

// En orden: así aparecen en la tienda
const PANTALLAS = [
  { archivo: '1-timeline.png',  url: '/es/coachhub/jugador.html?player=' + TOMAS },
  { archivo: '2-dashboard.png', url: '/es/coachhub/dashboard.html' },
  { archivo: '3-mensajes.png',  url: '/es/coachhub/mensajes.html?player=' + TOMAS },
  { archivo: '4-vitrina.png',   url: '/es/coaches/perfil.html?c=nico-parra' },
  { archivo: '5-coaches.png',   url: '/es/coaches/' },
];

if (!PASS) {
  console.log('⏭️  Falta el secret DEMO_PASSWORD: no se generan capturas.');
  process.exit(0);
}

fs.mkdirSync('capturas', { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 414, height: 896 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'es-CL',
  timezoneId: 'America/Santiago',
  colorScheme: 'dark',
  // "CoachHubApp" hace que la web se comporte como dentro de la app (oculta lo que es solo web)
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CoachHubApp',
});
const page = await ctx.newPage();

// Inicia sesión con la cuenta de prueba (la sesión queda en localStorage)
await page.goto(BASE + '/es/coachhub/entrar.html', { waitUntil: 'networkidle' });
const err = await page.evaluate(async ([u, k, e, p]) => {
  const c = window.supabase.createClient(u, k);
  const r = await c.auth.signInWithPassword({ email: e, password: p });
  return r.error ? r.error.message : null;
}, [SB_URL, SB_ANON, EMAIL, PASS]);
if (err) { console.error('❌ No se pudo iniciar sesión:', err); process.exit(1); }

let ok = 0;
for (const p of PANTALLAS) {
  try {
    await page.goto(BASE + p.url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2500);
    // sin barras de scroll ni avisos flotantes en la foto
    await page.addStyleTag({ content: '::-webkit-scrollbar{display:none!important}.toast,#toast{display:none!important}' });
    await page.screenshot({ path: 'capturas/' + p.archivo, fullPage: false });
    console.log('📸', p.archivo);
    ok++;
  } catch (e) {
    console.log('⚠️ ', p.archivo, e.message);
  }
}
await browser.close();
if (ok < 3) { console.error('❌ Apple pide al menos 3 capturas y solo salieron', ok); process.exit(1); }
