# App de CoachFly (iOS y Android)

La app está hecha con **Capacitor**: es un "envoltorio" nativo que carga la web
`https://mygolflab.golf/es/coachhub/entrar.html`. Todo lo que subas a la web
aparece en la app al tiro, **sin volver a publicarla en las tiendas**.

Solo hay que volver a publicar la app cuando cambia algo nativo: el ícono, los
permisos o los plugins.

```
app-movil/
├── capacitor.config.json   ← nombre, id (golf.mygolflab.coachhub) y URL que carga
├── www/                    ← páginas locales: redirección y "Sin conexión"
├── assets/                 ← ícono (1024) y splash originales
├── ios/                    ← proyecto de Xcode
└── android/                ← proyecto de Android Studio
```

Vercel no publica esta carpeta (está en `.vercelignore`).

---

## 1. Una sola vez: preparar el Mac

1. **Xcode**: instálalo desde el App Store (es grande, tarda). Ábrelo una vez y acepta todo.
2. **Android Studio**: descárgalo de developer.android.com/studio e instálalo con las opciones por defecto.
3. **Node.js**: si `node -v` en la Terminal no responde, instálalo desde nodejs.org (versión LTS).
4. Descarga el repo (o haz `git pull` si ya lo tienes) y en la Terminal:

```bash
cd mygolflab-website/app-movil
npm install
```

## 2. Una sola vez: Supabase

Supabase → **Authentication → URL Configuration → Redirect URLs** → agregar:

```
mygolflab://auth
```

Sin esto, el login con Google/Apple dentro de la app no vuelve a la app.

## 3. Probar en el iPhone

```bash
npm run ios
```

Se abre Xcode. Luego:

1. Conecta el iPhone por cable. En el iPhone: Ajustes → Privacidad y seguridad → **Modo de desarrollador** → activar.
2. En Xcode, a la izquierda, haz clic en **App** → pestaña **Signing & Capabilities** → **Team**: elige tu Apple ID (o la cuenta de Smooth Golf cuando tengas Apple Developer).
3. Arriba al centro, elige tu iPhone como destino y aprieta ▶️.

Con un Apple ID gratis la app dura 7 días en tu teléfono. Para publicar en el App Store necesitas la cuenta Apple Developer (USD 99/año).

## 4. Probar en Android

```bash
npm run android
```

Se abre Android Studio. Espera a que termine de cargar (barra de abajo), conecta un Android con "Depuración USB" activada o usa un emulador, y aprieta ▶️.

## 5. Publicar

**iOS:** en Xcode, Product → Archive → Distribute App → App Store Connect. Después, en appstoreconnect.apple.com completas la ficha (fotos, descripción, política de privacidad) y la mandas a revisión.

**Android:** en Android Studio, Build → Generate Signed App Bundle → crea una llave (**guárdala bien, si la pierdes no puedes actualizar la app**) → sube el `.aab` en play.google.com/console.

Antes de cada nueva versión, sube el número en:
- iOS: Xcode → App → General → Version / Build
- Android: `android/app/build.gradle` → `versionCode` (+1) y `versionName`

## Cambiar ícono o splash

El ícono es Órbitas "Coach + alumno" en dorado; el original está en `assets/icon.svg`.
Para cambiarlo, reemplaza `assets/icon-only.png` (1024×1024) y `assets/splash.png` (2732×2732) y corre:

```bash
npm run iconos
npx cap sync
```

Ojo: en Android el generador deja el dibujo muy al borde y el círculo del ícono puede cortarlo. Pídele a Claude que ajuste las capas `ic_launcher_foreground` para que queden dentro de la zona segura.

## Cómo se comporta la web dentro de la app

El archivo `/js/mgl-app.js` de la web se activa solo dentro de la app:

- Agrega las clases `en-app` y `en-ios`/`en-android` al `<html>`. Cualquier elemento con la clase `solo-web` se oculta en la app.
- **En iOS oculta los links a `pricing.html`**: Apple no deja vender suscripciones digitales dentro de la app sin cobrar su comisión, así que los planes se contratan en la web.
- El login con Google/Apple se abre en el navegador del sistema (Google bloquea su login dentro de apps) y vuelve con `mygolflab://auth`.
