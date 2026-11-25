# CoachYard · Cobro de suscripciones

Dos caminos para pagar, una sola suscripción en Supabase (`coach_subscriptions`):

| Dónde paga el coach | Cómo | Quién avisa a CoachYard |
|---|---|---|
| **Web** (coachyard.golf, mygolflab.golf) | Flow: inscribe su tarjeta una vez y se cobra solo cada mes o año, en CLP | Flow → `/api/suscripcion?accion=flow` + revisión diaria |
| **App de iPhone/iPad** | Compras de Apple (Face ID), en moneda local | RevenueCat → `/api/suscripcion?accion=revenuecat` |

La prueba que le queda al coach se respeta en los dos: el primer cobro es cuando termina.
Descuento: se aplica el mayor entre **Coach Fundador (40% mientras siga suscrito)** y su **código de descuento**.

---

## A. Web con Flow

### 1. Llaves de Flow en Vercel
Vercel → proyecto → Settings → Environment Variables (si ya están por el cobro de clases, no hay que tocarlas):

- `FLOW_API_KEY` y `FLOW_SECRET_KEY` — Flow → Mis datos → Seguridad (o en sandbox.flow.cl para probar)
- `FLOW_API_URL` — `https://sandbox.flow.cl/api` para probar, `https://www.flow.cl/api` en producción
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → service_role
- `CRON_SECRET` — cualquier texto largo inventado (activa la revisión diaria de cobros)

### 2. Activar Suscripciones en Flow
En tu cuenta de Flow, pide/activa el producto **Suscripciones / Cargo automático**. Los planes
(`CY_STARTER_MENSUAL`, `CY_PRO_ANUAL`, etc.) y los cupones de descuento **se crean solos** la
primera vez que un coach elige ese plan.

### 3. Probar en sandbox
Con las llaves de sandbox: entra como coach → Planes → Elegir Pro → inscribe la tarjeta de
prueba de Flow → vuelves a Mi cuenta con "Tu plan quedó activo".

### 4. Pasar a producción
Cambia las 3 variables de Flow a las de producción y haz Redeploy.

---

## B. App con Apple (versión 1.2)

### 1. App Store Connect — una sola vez
1. **Small Business Program**: developer.apple.com/app-store/small-business-program → Enroll (comisión 15% en vez de 30%).
2. **Acuerdos, impuestos y banca** (Business): firma el acuerdo de **Apps de pago** y completa banco e impuestos.
3. App CoachYard → **Suscripciones** → crear grupo **"CoachYard"** y 6 suscripciones de 1 mes:

| Product ID | Nombre | Precio (Chile) |
|---|---|---|
| `cy_starter_mensual` | Starter | $8.990 |
| `cy_pro_mensual` | Pro | $17.990 |
| `cy_proplus_mensual` | Pro+ | $26.990 |
| `cy_starter_fundador` | Starter Fundador | $5.390 |
| `cy_pro_fundador` | Pro Fundador | $10.790 |
| `cy_proplus_fundador` | Pro+ Fundador | $16.190 |

   En cada una: **Oferta introductoria → Gratis → 2 semanas** (Apple no tiene 15 días; 2 semanas es lo más cercano).
   La Academia (varios coaches) queda solo en la web.
4. **Llave de compras dentro de la app**: Users and Access → Integrations → In-App Purchase → generar llave (.p8). Se usa en RevenueCat.

### 2. RevenueCat — una sola vez (gratis hasta US$2.500/mes)
1. Crear cuenta en revenuecat.com → proyecto **CoachYard** → app iOS con bundle `golf.mygolflab.coachhub`.
2. Subir la llave In-App Purchase (.p8) y la App Store Connect API key.
3. **Entitlement** `coachyard` con los 6 productos.
4. **Offerings**: `default` (los 3 normales, marcar como Current) y `fundador` (los 3 de fundador).
5. Integrations → **Webhooks** → URL `https://mygolflab.golf/api/suscripcion?accion=revenuecat`,
   Authorization header = un texto secreto inventado. Ese mismo texto va en Vercel como `REVENUECAT_WEBHOOK_AUTH`.
6. API keys → copiar la **llave pública de iOS** (`appl_...`) → se pega en `js/cy-iap.js` (`RC_IOS_KEY`).

### 3. Publicar
La app necesita una versión nueva (el plugin de compras es nativo). Va en la **1.2** junto con el iPad.
Antes de enviar a revisión, probar con una cuenta Sandbox de Apple (App Store Connect → Users and Access → Sandbox).

---

## Lo que ya está hecho
- `api/suscripcion.js`: inscripción de tarjeta, suscripción con prueba y descuento, cancelación, sincronización y webhook de Apple.
- `es/coachhub/pricing.html`: botones "Elegir plan" para coaches con sesión y contador de cupos de Coach Fundador.
- `es/coachhub/cuenta.html`: forma de pago, tarjeta, cancelar, administrar en App Store.
- `es/coachhub/planes-app.html` + `js/cy-iap.js`: pantalla de planes de Apple (solo aparece cuando `RC_IOS_KEY` está puesta y la app tiene el plugin).
- `sql/coachyard_cobros.sql` (ya aplicado): columnas de cobro, cupos de fundador automáticos (50).

## Cuando el cobro esté activo
- Quitar la extensión de prueba hasta el 31-01-2027 en `mgl_crear_prueba_coach()` (dejar solo `now() + interval '15 days'`).
- Avisar por correo a los coaches en prueba que ya pueden elegir su plan.
- Cerrar la campaña de fundadores cuando corresponda: `update mgl_cobros_config set founder_abierto = false;`
