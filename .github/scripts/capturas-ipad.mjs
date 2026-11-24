// CoachYard · Capturas de prueba en tamaño iPad (para revisar el diseño, no van a la tienda)
// Uso: DEMO_PASSWORD=... BASE=https://... node .github/scripts/capturas-ipad.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'https://mygolflab.golf';
const SB_URL = 'https://yulpqupmftdjbepqiscs.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bHBxdXBtZnRkamJlcHFpc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQxNDA0NjYsImV4cCI6MjA4OTcxNjQ2Nn0.e-8SEni5uxUoigXCkVM2VYm7UrHYxxVl7hPsUrZvYao';
const EMAIL = 'revision@coachyard.golf';
const PASS = process.env.DEMO_PASSWORD;
const TOMAS = '6f56ff6a-764d-4aad-9df5-4faeddcb4991';

const PANTALLAS = [
  ['dashboard', '/es/coachhub/dashboard.html'],
  ['jugadores', '/es/coachhub/jugador.html'],
  ['timeline', '/es/coachhub/jugador.html?player=' + TOMAS],
  ['clases', '/es/coachhub/clases.html'],
  ['mensajes', '/es/coachhub/mensajes.html'],
  ['mensajes-hilo', '/es/coachhub/mensajes.html?player=' + TOMAS],
  ['cuenta', '/es/coachhub/cuenta.html'],
  ['vitrina', '/es/coachhub/vitrina.html'],
  ['contenido', '/es/coachhub/contenido.html'],
  ['coaches', '/es/coaches/'],
  ['perfil-coach', '/es/coaches/perfil.html?c=nico-parra'],
  ['analisis', '/es/coachhub/analisis.html?from=dash'],
];
const TAMANOS = (process.env.TAMANOS || '820x1180,1180x820,1024x1366').split(',');

if (!PASS) { console.log('Falta DEMO_PASSWORD'); process.exit(1); }
fs.mkdirSync('capturas-ipad', { recursive: true });
const browser = await chromium.launch();
for (const t of TAMANOS) {
  const [w, h] = t.split('x').map(Number);
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, screen: { width: w, height: h },
    deviceScaleFactor: 1, isMobile: false, hasTouch: true,
    locale: 'es-CL', timezoneId: 'America/Santiago', colorScheme: 'dark',
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 CoachHubApp',
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/es/coachhub/entrar.html', { waitUntil: 'networkidle' });
  const err = await page.evaluate(async ([u, k, e, p]) => {
    const c = window.supabase.createClient(u, k);
    const r = await c.auth.signInWithPassword({ email: e, password: p });
    try { localStorage.setItem('mgl-rol', 'coach'); } catch (x) {}
    return r.error ? r.error.message : null;
  }, [SB_URL, SB_ANON, EMAIL, PASS]);
  if (err) { console.error('login', err); process.exit(1); }
  for (const [n, u] of PANTALLAS) {
    try {
      // como en la app: dentro del marco app.html
      await page.goto(BASE + '/es/coachhub/app.html#' + encodeURIComponent(u), { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(6000);
      // ¿algo sobresale a lo ancho dentro de la pestaña visible?
      const info = await page.evaluate(() => {
        const f = document.querySelector('iframe.mrc.on');
        if (!f) return 'sin marco: ' + location.href;
        const d = f.contentDocument; const W = d.documentElement.clientWidth;
        const anchos = [];
        d.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1) anchos.push(el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '') + ' ' + Math.round(r.right)); });
        return f.contentWindow.location.pathname + ' ancho=' + W + ' scrollW=' + d.documentElement.scrollWidth + (anchos.length ? ' sobresalen: ' + anchos.slice(0, 6).join(' | ') : '');
      });
      console.log(t, n, info);
      await page.screenshot({ path: 'capturas-ipad/' + t + '-' + n + '.png' });
    } catch (e) { console.log('error', t, n, e.message); }
  }
  await ctx.close();
}
await browser.close();
