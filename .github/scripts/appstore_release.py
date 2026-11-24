#!/usr/bin/env python3
"""
CoachYard · Deja lista la ficha del App Store y (si se pide) la manda a revisión.

Usa la llave de App Store Connect (secrets ASC_*) para:
  1. Nombre (CoachYard), subtítulo, política de privacidad y categoría (Deportes).
  2. Clasificación por edad.
  3. Precio gratis y disponibilidad en todos los países.
  4. Versión 1.0: descripción, palabras clave, URLs, copyright, build más reciente.
  5. Datos para la revisión de Apple (cuenta de prueba + notas).
  6. Capturas de pantalla (carpeta ./capturas, si existe).
  7. ENVIAR=true → manda la versión a revisión de Apple.

Idempotente: se puede correr varias veces; solo cambia lo que falta.
La clave de la cuenta de prueba viene del secret DEMO_PASSWORD (el repo es público).
Lo único que NO se puede hacer por API son las etiquetas de privacidad
("App Privacy"): se llenan una vez a mano en App Store Connect.
"""
import glob
import hashlib
import json
import os
import time

import jwt
import requests

API = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = "golf.mygolflab.coachhub"
import re as _re
# La versión sale del proyecto iOS (MARKETING_VERSION), así no hay que tocarla aquí
try:
    VERSION = _re.search(r"MARKETING_VERSION = ([0-9.]+);",
                         open("app-movil/ios/App/App.xcodeproj/project.pbxproj").read()).group(1)
except Exception:
    VERSION = "1.0"
# "Novedades" (obligatorio desde la segunda versión). Actualizar en cada versión nueva.
NOVEDADES = """• Nueva pantalla de inicio de CoachYard.
• CoachYard, presented by MyGolfLab: ahora ves a nuestros auspiciadores (GolfChile, Titleist y FootJoy) al iniciar sesión.
• Mejoras de estabilidad y rendimiento."""
NOMBRES = ["CoachYard", "CoachYard Golf", "CoachYard: Golf Coaching"]
SUBTITULO = "Tu academia de golf en la app"
PRIVACY_URL = "https://mygolflab.golf/es/privacidad.html"
SUPPORT_URL = "https://mygolflab.golf/es/coachhub/soporte.html"
MARKETING_URL = "https://mygolflab.golf/es/coachhub/index.html"
COPYRIGHT = "2026 Smooth Golf Co. SPA"
CONTACTO = {"contactFirstName": "Nicolás", "contactLastName": "Parra", "contactEmail": "n.parrarecart@gmail.com"}
DEMO_EMAIL = "revision@coachyard.golf"
TIPO_CAPTURA = "APP_IPHONE_65"   # 6.5" (1242×2688): Apple lo acepta como tamaño obligatorio

PROMO = ("Todo el historial de tus alumnos en un solo lugar: clases, videos, análisis de swing, "
         "metas y mensajes. Hecho por coaches, para coaches.")

DESCRIPCION = """CoachYard es la plataforma para coaches de golf y sus alumnos. Deja de tener los videos en la galería del teléfono, las notas en una libreta y los mensajes perdidos en WhatsApp: todo el trabajo con cada alumno queda ordenado en su perfil, desde la primera clase hasta la última.

PARA COACHES
• Perfil de cada alumno con un timeline de clases, videos, notas, metas y planes de entrenamiento.
• Graba con la cámara de la app y sube el video directo al perfil del alumno. Le llega un aviso al instante.
• Analizador de swing: dibuja líneas, círculos y flechas, compara dos videos lado a lado y graba el análisis con tu voz.
• Crea eventos en segundos mientras das la clase: clase, video análisis, sesión de launch monitor, ronda de torneo, calentamiento, preparación física y plan de entrenamiento.
• Rondas de torneo con estadísticas en tres niveles, de principiante a profesional, con Strokes Gained.
• Mensajes con cada alumno y grupos para mandar anuncios, tips y recordatorios.
• Vitrina de coaches: arma tu perfil público y recibe alumnos online de cualquier país.

PARA JUGADORES
• Todo lo que tu coach registra de ti, en un solo lugar y para siempre.
• Revisa tus videos y análisis cuando quieras, en la cancha o en el range.
• Sube tus propios videos, sesiones y resultados para que tu coach los vea.
• Escríbele a tu coach y recibe avisos cuando te deje algo nuevo.
• Encuentra coaches en la vitrina y toma clases online por videollamada.

Tus datos son tuyos: puedes eliminar tu cuenta cuando quieras desde Mi cuenta.

CoachYard es parte del ecosistema MyGolfLab, creado en Santiago de Chile por coaches profesionales."""

PALABRAS = "golf,coach,entrenador,clases,swing,alumnos,análisis,video,academia,profesor,torneo,handicap,drills"

NOTAS_REVISION = (
    "CoachYard is a tool for golf coaches to keep their students' history (lessons, videos, notes, goals) "
    "in one place, and for students to follow it. Log in with the demo coach account provided (email + password "
    "on the login screen): it has 4 fictitious students.\n\n"
    "Main flows: bottom menu > Mis jugadores > open 'Tomás' to see his timeline; center button > Grabar video / "
    "Analizar swing / Crear evento; Mensajes.\n\n"
    "User-generated content (guideline 1.2): in Mensajes, open a chat and tap '⋯' (top right) to Report or Block. "
    "Coach profiles and content collections have a 'Reportar' link at the bottom. Reports are reviewed within 24 h.\n\n"
    "Payments (guideline 3.1): the iOS app does not sell digital content or subscriptions. Coach plans, video "
    "collections and asynchronous video analyses are only sold on our website and the app shows no buy buttons or links "
    "for them. Only live one-to-one video lessons with a real coach (real-time person-to-person service, 3.1.3(d)) "
    "can be paid in the app, through Webpay/Mercado Pago.\n\n"
    "Account deletion: avatar > Mi cuenta > Eliminar cuenta. Sign in with Apple is available.\n"
    "The interface is in Spanish (English and Portuguese available in the language selector)."
)

EDITABLES = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED",
             "INVALID_BINARY", "DEVELOPER_ACTION_NEEDED"}

KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
P8 = os.environ["ASC_KEY_P8"]
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD", "")
ENVIAR = os.environ.get("ENVIAR", "false").lower() == "true"

faltantes = []
avisos = []


def token():
    now = int(time.time())
    return jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      P8, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})


def call(method, path, body=None, ok=(200, 201, 204), fatal=True):
    url = path if path.startswith("http") else API + (path if path.startswith("/v") else "/v1" + path)
    r = requests.request(method, url, timeout=90,
                         headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
                         data=json.dumps(body) if body is not None else None)
    if r.status_code not in ok:
        if fatal:
            print(f"❌ {method} {path} → {r.status_code}\n{r.text[:2500]}")
            raise SystemExit(1)
        return {"_error": r.status_code, "_text": r.text}
    return r.json() if r.text else {}


def patch_tolerante(path, tipo, oid, attrs):
    """PATCH que quita los campos que Apple no reconoce (la API cambia de versión en versión)."""
    attrs = dict(attrs)
    for _ in range(25):
        r = call("PATCH", path, {"data": {"type": tipo, "id": oid, "attributes": attrs}}, fatal=False)
        if "_error" not in r:
            return True
        txt = r["_text"]
        malo = None
        try:
            for e in json.loads(txt).get("errors", []):
                ptr = (e.get("source") or {}).get("pointer", "")
                campo = ptr.rsplit("/", 1)[-1] if ptr else ""
                if campo and campo not in attrs and "REQUIRED" in (e.get("code") or ""):
                    # campo nuevo que Apple exige: se responde "no" y se avisa
                    attrs[campo] = False
                    print(f"   ℹ️ Apple pide '{campo}': se marcó como 'No' (revísalo si corresponde)")
                    malo = "__reintentar__"
                    break
                if campo in attrs:
                    malo = campo
                    break
                for k in list(attrs):
                    if k in (e.get("detail") or ""):
                        malo = k
                        break
                if malo:
                    break
        except Exception:
            pass
        if not malo:
            print(f"⚠️  PATCH {path} → {r['_error']}: {txt[:800]}")
            return False
        if malo != "__reintentar__":
            attrs.pop(malo)
    return False


def configurar_info(iid):
    locs = call("GET", f"/appInfos/{iid}/appInfoLocalizations")["data"]
    for l in locs:
        hecho = False
        for nombre in NOMBRES:
            r = call("PATCH", f"/appInfoLocalizations/{l['id']}", {"data": {
                "type": "appInfoLocalizations", "id": l["id"],
                "attributes": {"name": nombre, "subtitle": SUBTITULO, "privacyPolicyUrl": PRIVACY_URL}}}, fatal=False)
            if "_error" not in r:
                print(f"1. ✅ Nombre '{nombre}' · subtítulo · privacidad ({l['attributes']['locale']})")
                hecho = True
                break
            print(f"   ⚠️ '{nombre}' no se pudo usar: {r['_text'][:300]}")
        if not hecho:
            faltantes.append("nombre de la app (todos los nombres probados están ocupados)")
    call("PATCH", f"/appInfos/{iid}", {"data": {"type": "appInfos", "id": iid, "relationships": {
        "primaryCategory": {"data": {"type": "appCategories", "id": "SPORTS"}},
        "secondaryCategory": {"data": {"type": "appCategories", "id": "EDUCATION"}}}}})
    print("   ✅ Categoría: Deportes (secundaria: Educación)")

    # ── 2. Clasificación por edad ──
    ar = call("GET", f"/appInfos/{iid}/ageRatingDeclaration", fatal=False)
    if "_error" in ar or not ar.get("data"):
        avisos.append("clasificación por edad: no se pudo leer, revísala a mano")
    else:
        ok = patch_tolerante(f"/ageRatingDeclarations/{ar['data']['id']}", "ageRatingDeclarations", ar["data"]["id"], {
            "alcoholTobaccoOrDrugUseOrReferences": "NONE", "contests": "NONE", "gamblingSimulated": "NONE",
            "gambling": False, "horrorOrFearThemes": "NONE", "matureOrSuggestiveThemes": "NONE",
            "medicalOrTreatmentInformation": "NONE", "profanityOrCrudeHumor": "NONE",
            "sexualContentGraphicAndNudity": "NONE", "sexualContentOrNudity": "NONE",
            "violenceCartoonOrFantasy": "NONE", "violenceRealistic": "NONE",
            "violenceRealisticProlongedGraphicOrSadistic": "NONE", "gunsOrOtherWeapons": "NONE",
            "unrestrictedWebAccess": False, "lootBox": False, "socialMedia": False,
            "messagingAndChat": True, "userGeneratedContent": True, "advertising": False,
            "parentalControls": False, "ageAssurance": False, "healthOrWellnessTopics": False,
        })
        print("2.", "✅ Clasificación por edad lista" if ok else "⚠️ Clasificación por edad incompleta")
        if not ok:
            avisos.append("clasificación por edad: revisarla a mano en App Information")


def main():
    # ── App ──
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        print(f"❌ No existe una app con bundle ID {BUNDLE_ID}.")
        raise SystemExit(1)
    app = apps[0]
    app_id = app["id"]
    locale = app["attributes"].get("primaryLocale") or "es-MX"
    print(f"App: {app['attributes']['name']} ({app_id}) · idioma {locale}")

    # ── 1. App Info: nombre, subtítulo, privacidad, categoría ──
    infos = call("GET", f"/apps/{app_id}/appInfos")["data"]
    info = next((i for i in infos if (i["attributes"].get("state") or i["attributes"].get("appStoreState"))
                 not in ("READY_FOR_DISTRIBUTION", "READY_FOR_SALE")), None)
    if info is None:
        # Con la app ya publicada, nombre/categoría/edad quedan bloqueados hasta que haya una versión nueva en preparación
        print("1. ⏭️  Información general publicada (sin cambios): nombre, categoría y edad se mantienen")
    else:
        configurar_info(info["id"])

    # ── 3. Precio (gratis) y disponibilidad ──
    ps = call("GET", f"/apps/{app_id}/appPriceSchedule?include=manualPrices", fatal=False)
    tiene_precio = "_error" not in ps and bool((ps.get("data") or {}).get("relationships", {})
                                              .get("manualPrices", {}).get("data"))
    if tiene_precio:
        print("3. ✅ Precio ya definido")
    else:
        pts = call("GET", f"/apps/{app_id}/appPricePoints?filter[territory]=USA&limit=200")["data"]
        gratis = next((p for p in pts if float(p["attributes"].get("customerPrice") or 0) == 0), None)
        if not gratis:
            faltantes.append("precio gratis (no se encontró el punto de precio 0)")
        else:
            call("POST", "/appPriceSchedules", {
                "data": {"type": "appPriceSchedules", "relationships": {
                    "app": {"data": {"type": "apps", "id": app_id}},
                    "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
                    "manualPrices": {"data": [{"type": "appPrices", "id": "${p0}"}]}}},
                "included": [{"type": "appPrices", "id": "${p0}", "attributes": {"startDate": None},
                              "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": gratis["id"]}}}}]})
            print("3. ✅ Precio: gratis")
    av = call("GET", f"/apps/{app_id}/appAvailabilityV2", fatal=False)
    if "_error" in av or not av.get("data"):
        terrs = call("GET", "/territories?limit=200")["data"]
        inc = [{"type": "territoryAvailabilities", "id": "${t" + t["id"] + "}", "attributes": {"available": True},
                "relationships": {"territory": {"data": {"type": "territories", "id": t["id"]}}}} for t in terrs]
        r = call("POST", "/v2/appAvailabilities", {
            "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True},
                     "relationships": {"app": {"data": {"type": "apps", "id": app_id}},
                                       "territoryAvailabilities": {"data": [{"type": i["type"], "id": i["id"]} for i in inc]}}},
            "included": inc}, fatal=False)
        if "_error" in r:
            avisos.append("disponibilidad por país: elegir 'todos los países' a mano en Pricing and Availability")
            print("   ⚠️ Disponibilidad:", r["_text"][:400])
        else:
            print(f"   ✅ Disponible en {len(terrs)} países")
    else:
        print("   ✅ Disponibilidad ya definida")

    # ── 4. Versión 1.0 ──
    vers = call("GET", f"/apps/{app_id}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
    estado = lambda v: v["attributes"].get("appVersionState") or v["attributes"].get("appStoreState")
    ver = next((v for v in vers if estado(v) in EDITABLES), None)
    if not ver:
        en_revision = next((v for v in vers if estado(v) in ("WAITING_FOR_REVIEW", "IN_REVIEW", "READY_FOR_REVIEW")), None)
        if en_revision:
            print(f"4. ⏳ La versión {en_revision['attributes']['versionString']} ya está en revisión ({estado(en_revision)}).")
            return
        ver = call("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
                   "attributes": {"platform": "IOS", "versionString": VERSION},
                   "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})["data"]
        print(f"4. ✅ Versión {VERSION} creada")
    vid = ver["id"]
    vstr = ver["attributes"]["versionString"]
    # Publicación manual: Apple aprueba y tú decides el día del lanzamiento
    call("PATCH", f"/appStoreVersions/{vid}", {"data": {"type": "appStoreVersions", "id": vid,
         "attributes": {"copyright": COPYRIGHT, "releaseType": "MANUAL"}}})
    print(f"4. Versión {vstr} ({estado(ver)}) · publicación manual")

    vlocs = call("GET", f"/appStoreVersions/{vid}/appStoreVersionLocalizations")["data"]
    textos = {"description": DESCRIPCION, "keywords": PALABRAS, "supportUrl": SUPPORT_URL,
              "marketingUrl": MARKETING_URL, "promotionalText": PROMO}
    ya_publicada = any(estado(v) in ("READY_FOR_DISTRIBUTION", "READY_FOR_SALE", "REPLACED_WITH_NEW_VERSION")
                       for v in vers if v["id"] != vid)
    if ya_publicada:
        textos["whatsNew"] = NOVEDADES
    if not vlocs:
        vlocs = [call("POST", "/appStoreVersionLocalizations", {"data": {
            "type": "appStoreVersionLocalizations", "attributes": dict(textos, locale=locale),
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})["data"]]
    else:
        for l in vlocs:
            call("PATCH", f"/appStoreVersionLocalizations/{l['id']}", {"data": {
                "type": "appStoreVersionLocalizations", "id": l["id"], "attributes": textos}})
    print("   ✅ Descripción, palabras clave y URLs")

    # Build más reciente de esta versión
    builds = call("GET", f"/builds?filter[app]={app_id}&filter[preReleaseVersion.version]={vstr}"
                         f"&filter[processingState]=VALID&sort=-uploadedDate&limit=5")["data"]
    builds = [b for b in builds if not b["attributes"].get("expired")]
    if not builds:
        faltantes.append(f"build válido de la versión {vstr} (correr 'App iOS')")
    else:
        b = builds[0]
        if b["attributes"].get("usesNonExemptEncryption") is None:
            call("PATCH", f"/builds/{b['id']}", {"data": {"type": "builds", "id": b["id"],
                 "attributes": {"usesNonExemptEncryption": False}}})
        call("PATCH", f"/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": b["id"]}})
        print(f"   ✅ Build {b['attributes']['version']} ({b['attributes']['uploadedDate'][:10]}) asignado")

    # ── 5. Datos para la revisión de Apple ──
    beta = call("GET", f"/apps/{app_id}/betaAppReviewDetail", fatal=False)
    telefono = ((beta.get("data") or {}).get("attributes") or {}).get("contactPhone") if "_error" not in beta else None
    rd = call("GET", f"/appStoreVersions/{vid}/appStoreReviewDetail", ok=(200, 404), fatal=False)
    rd = rd.get("data") if isinstance(rd, dict) else None
    attrs = dict(CONTACTO, demoAccountName=DEMO_EMAIL, demoAccountRequired=True, notes=NOTAS_REVISION)
    if telefono:
        attrs["contactPhone"] = telefono
    if DEMO_PASSWORD:
        attrs["demoAccountPassword"] = DEMO_PASSWORD
    if rd:
        if not telefono and rd["attributes"].get("contactPhone"):
            attrs["contactPhone"] = rd["attributes"]["contactPhone"]
        call("PATCH", f"/appStoreReviewDetails/{rd['id']}", {"data": {
            "type": "appStoreReviewDetails", "id": rd["id"], "attributes": attrs}})
    else:
        call("POST", "/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": attrs,
             "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}})
    if not attrs.get("contactPhone"):
        faltantes.append("teléfono de contacto para Apple")
    if not DEMO_PASSWORD:
        faltantes.append("secret DEMO_PASSWORD (clave de la cuenta de prueba)")
    print("5. ✅ Datos de revisión" + ("" if DEMO_PASSWORD else " (sin clave de prueba)"))

    # ── 6. Capturas ──
    archivos = sorted(glob.glob("capturas/*.png"))
    loc0 = vlocs[0]["id"]
    sets = call("GET", f"/appStoreVersionLocalizations/{loc0}/appScreenshotSets")["data"]
    sset = next((s for s in sets if s["attributes"]["screenshotDisplayType"] == TIPO_CAPTURA), None)
    if archivos:
        if not sset:
            sset = call("POST", "/appScreenshotSets", {"data": {"type": "appScreenshotSets",
                        "attributes": {"screenshotDisplayType": TIPO_CAPTURA},
                        "relationships": {"appStoreVersionLocalization": {"data": {
                            "type": "appStoreVersionLocalizations", "id": loc0}}}}})["data"]
        for viejo in call("GET", f"/appScreenshotSets/{sset['id']}/appScreenshots")["data"]:
            call("DELETE", f"/appScreenshots/{viejo['id']}")
        for f in archivos:
            data = open(f, "rb").read()
            sc = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots",
                      "attributes": {"fileName": os.path.basename(f), "fileSize": len(data)},
                      "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": sset["id"]}}}}})["data"]
            for op in sc["attributes"]["uploadOperations"]:
                h = {x["name"]: x["value"] for x in op.get("requestHeaders", [])}
                trozo = data[op["offset"]:op["offset"] + op["length"]]
                r = requests.request(op["method"], op["url"], headers=h, data=trozo, timeout=120)
                if r.status_code >= 300:
                    print(f"❌ Subiendo {f}: {r.status_code} {r.text[:300]}")
                    raise SystemExit(1)
            call("PATCH", f"/appScreenshots/{sc['id']}", {"data": {"type": "appScreenshots", "id": sc["id"],
                 "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
            print(f"6. 📸 {os.path.basename(f)} subida")
        # esperar a que Apple las procese
        for _ in range(30):
            scs = call("GET", f"/appScreenshotSets/{sset['id']}/appScreenshots")["data"]
            estados = [((s["attributes"].get("assetDeliveryState") or {}).get("state")) for s in scs]
            if all(e == "COMPLETE" for e in estados):
                break
            if any(e == "FAILED" for e in estados):
                errs = [(s["attributes"].get("assetDeliveryState") or {}).get("errors") for s in scs]
                print("❌ Apple rechazó una captura:", errs)
                raise SystemExit(1)
            time.sleep(5)
        print(f"   ✅ {len(archivos)} capturas listas")
    else:
        n = len(call("GET", f"/appScreenshotSets/{sset['id']}/appScreenshots")["data"]) if sset else 0
        if n >= 3:
            print(f"6. ✅ Ya hay {n} capturas")
        else:
            faltantes.append("capturas de pantalla (mínimo 3)")

    # ── 7. Enviar a revisión ──
    print()
    if faltantes:
        print("⏸️  Falta antes de enviar:", "; ".join(faltantes))
    if avisos:
        print("ℹ️ ", "; ".join(avisos))
    print("ℹ️  Las etiquetas de privacidad (App Privacy) se llenan a mano: App Store Connect → la app → App Privacy.")
    if not ENVIAR:
        print("\nFicha lista. Para mandarla a revisión: Actions → 'App Store' → Run workflow → enviar = true.")
        return
    if faltantes:
        print("❌ No se envía a revisión hasta completar lo que falta.")
        raise SystemExit(1)
    abiertas = call("GET", f"/reviewSubmissions?filter[app]={app_id}&filter[platform]=IOS"
                           f"&filter[state]=READY_FOR_REVIEW,UNRESOLVED_ISSUES")["data"]
    sub = abiertas[0] if abiertas else call("POST", "/reviewSubmissions", {"data": {
        "type": "reviewSubmissions", "attributes": {"platform": "IOS"},
        "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})["data"]
    call("POST", "/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
        "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub["id"]}},
        "appStoreVersion": {"data": {"type": "appStoreVersions", "id": vid}}}}}, ok=(200, 201, 204, 409))
    r = call("PATCH", f"/reviewSubmissions/{sub['id']}", {"data": {"type": "reviewSubmissions", "id": sub["id"],
             "attributes": {"submitted": True}}}, fatal=False)
    if "_error" in r:
        print("❌ Apple no aceptó el envío:\n" + r["_text"][:2500])
        print("\nLo más común: faltan las etiquetas de privacidad (App Privacy) o algún dato de la ficha.")
        raise SystemExit(1)
    print("🚀 ¡Enviada a revisión de Apple! Suele tardar entre 24 y 48 horas. Te llega un correo con el resultado.")


if __name__ == "__main__":
    main()
