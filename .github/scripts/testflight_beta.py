#!/usr/bin/env python3
"""
CoachYard · Prepara TestFlight para testers externos (link público).

Usa la llave de App Store Connect (secrets ASC_*) para:
  1. Llenar la "Test Information" (descripción, email de feedback, política de privacidad).
  2. Llenar los datos de revisión (contacto + cuenta de prueba para Apple).
  3. Crear el grupo externo con link público y agregarle el build más reciente.
  4. Mandar el build a Beta App Review (si no se ha mandado ya).

Es idempotente: se puede correr varias veces; solo hace lo que falta.
Los datos sensibles (clave de la cuenta de prueba y teléfono) NO van en el repo,
que es público: se escriben a mano una vez en App Store Connect → TestFlight →
Test Information. Mientras falten, el script no manda el build a revisión.
"""
import json
import os
import sys
import time

import jwt
import requests

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = "golf.mygolflab.coachhub"
GROUP_NAME = "Beta CoachYard"
PRIVACY_URL = "https://mygolflab.golf/es/privacidad.html"
MARKETING_URL = "https://coachyard.golf"
FEEDBACK_EMAIL = "n.parrarecart@gmail.com"
DEMO_EMAIL = "revision@coachyard.golf"

DESCRIPTION = (
    "CoachYard es la plataforma para coaches de golf y sus alumnos. El coach guarda "
    "en el perfil de cada alumno todo su historial: clases, videos, análisis de swing, "
    "notas, metas y planes de entrenamiento, y se comunica con ellos por mensajes.\n\n"
    "Qué probar: crear un evento en el perfil de un alumno, grabar o subir un video, "
    "usar el analizador de swing y enviar un mensaje. Cuéntanos cualquier error o idea "
    "con una captura de pantalla desde TestFlight."
)
WHATS_NEW = (
    "Primera beta de CoachYard. Prueba la cámara, el analizador de swing, "
    "los eventos del timeline y los mensajes."
)
REVIEW_NOTES = (
    "CoachYard is a tool for golf coaches to keep their students' history (lessons, "
    "videos, notes, goals) in one place. Log in with the demo coach account provided: "
    "it already has 4 fictitious students. Main flows: Dashboard > Mis jugadores > open "
    "a student's timeline; center button > Grabar video / Analizar swing / Crear evento; "
    "Mensajes. There are no in-app purchases: lessons are paid on the website only. "
    "Account deletion: avatar > Mi cuenta > Eliminar cuenta."
)

KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
P8 = os.environ["ASC_KEY_P8"]


def token():
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
        P8, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"},
    )


def call(method, path, body=None, ok=(200, 201, 204)):
    r = requests.request(
        method, path if path.startswith("http") else API + path,
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
        data=json.dumps(body) if body is not None else None, timeout=60,
    )
    if r.status_code not in ok:
        print(f"❌ {method} {path} → {r.status_code}\n{r.text[:1500]}")
        raise SystemExit(1)
    return r.json() if r.text else {}


def main():
    faltantes = []

    # ── App ──
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        print(f"❌ No existe una app con bundle ID {BUNDLE_ID} en App Store Connect.")
        raise SystemExit(1)
    app = apps[0]
    app_id = app["id"]
    locale = app["attributes"].get("primaryLocale") or "es-MX"
    print(f"App: {app['attributes']['name']} ({app_id}) · idioma principal {locale}")

    # ── 1. Test Information ──
    locs = call("GET", f"/apps/{app_id}/betaAppLocalizations")["data"]
    attrs = {"description": DESCRIPTION, "feedbackEmail": FEEDBACK_EMAIL,
             "privacyPolicyUrl": PRIVACY_URL, "marketingUrl": MARKETING_URL}
    if locs:
        for l in locs:
            call("PATCH", f"/betaAppLocalizations/{l['id']}",
                 {"data": {"type": "betaAppLocalizations", "id": l["id"], "attributes": attrs}})
    else:
        call("POST", "/betaAppLocalizations", {"data": {
            "type": "betaAppLocalizations", "attributes": dict(attrs, locale=locale),
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})
    print("1. ✅ Test Information lista")

    # ── 2. Datos para la revisión de Apple ──
    det = call("GET", f"/apps/{app_id}/betaAppReviewDetail")["data"]
    cur = det["attributes"]
    upd = {"contactFirstName": cur.get("contactFirstName") or "Nicolás",
           "contactLastName": cur.get("contactLastName") or "Parra",
           "contactEmail": cur.get("contactEmail") or FEEDBACK_EMAIL,
           "demoAccountName": DEMO_EMAIL, "demoAccountRequired": True,
           "notes": REVIEW_NOTES}
    # Apple exige el teléfono en cada cambio: si aún no está, no se toca nada aquí.
    if cur.get("contactPhone"):
        upd["contactPhone"] = cur["contactPhone"]
        call("PATCH", f"/betaAppReviewDetails/{det['id']}",
             {"data": {"type": "betaAppReviewDetails", "id": det["id"], "attributes": upd}})
        cur = call("GET", f"/apps/{app_id}/betaAppReviewDetail")["data"]["attributes"]
    if not cur.get("contactPhone"):
        faltantes.append("teléfono de contacto")
    if not cur.get("demoAccountPassword"):
        faltantes.append("clave de la cuenta de prueba")
    print("2. Datos de revisión:", "✅ completos" if not faltantes else "⚠️ falta " + ", ".join(faltantes))

    # ── Build más reciente ──
    builds = call("GET", f"/builds?filter[app]={app_id}&sort=-uploadedDate&limit=10")["data"]
    build = next((b for b in builds if b["attributes"]["processingState"] == "VALID"
                  and not b["attributes"].get("expired")), None)
    if not build:
        print("❌ No hay ningún build válido y vigente. Corre el workflow 'App iOS' primero.")
        raise SystemExit(1)
    bid = build["id"]
    ba = build["attributes"]
    print(f"Build: {ba['version']} subido {ba['uploadedDate'][:10]}")
    if ba.get("usesNonExemptEncryption") is None:
        call("PATCH", f"/builds/{bid}", {"data": {"type": "builds", "id": bid,
             "attributes": {"usesNonExemptEncryption": False}}})
    bl = call("GET", f"/builds/{bid}/betaBuildLocalizations")["data"]
    if bl:
        for l in bl:
            call("PATCH", f"/betaBuildLocalizations/{l['id']}", {"data": {
                "type": "betaBuildLocalizations", "id": l["id"], "attributes": {"whatsNew": WHATS_NEW}}})
    else:
        call("POST", "/betaBuildLocalizations", {"data": {
            "type": "betaBuildLocalizations", "attributes": {"locale": locale, "whatsNew": WHATS_NEW},
            "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})

    # ── 3. Grupo externo con link público ──
    groups = call("GET", f"/betaGroups?filter[app]={app_id}&limit=50")["data"]
    group = next((g for g in groups if g["attributes"]["name"] == GROUP_NAME), None)
    if not group:
        group = call("POST", "/betaGroups", {"data": {
            "type": "betaGroups",
            "attributes": {"name": GROUP_NAME, "publicLinkEnabled": True,
                           "publicLinkLimitEnabled": False, "feedbackEnabled": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}}}}})["data"]
        print(f"3. ✅ Grupo '{GROUP_NAME}' creado")
    elif not group["attributes"].get("publicLinkEnabled"):
        group = call("PATCH", f"/betaGroups/{group['id']}", {"data": {
            "type": "betaGroups", "id": group["id"],
            "attributes": {"publicLinkEnabled": True, "publicLinkLimitEnabled": False}}})["data"]
    gid = group["id"]
    call("POST", f"/betaGroups/{gid}/relationships/builds",
         {"data": [{"type": "builds", "id": bid}]}, ok=(200, 201, 204, 409))
    print("   ✅ Build agregado al grupo")

    # ── 4. Revisión de Apple ──
    subs = call("GET", f"/betaAppReviewSubmissions?filter[build]={bid}")["data"]
    if subs:
        print("4. Revisión de Apple:", subs[0]["attributes"].get("betaReviewState"))
    else:
        priv = requests.get(PRIVACY_URL, timeout=30)
        if priv.status_code != 200:
            faltantes.append("política de privacidad publicada (aprobar el PR)")
        if faltantes:
            print("4. ⏸️ No se manda a revisión todavía. Falta:", ", ".join(faltantes))
        else:
            s = call("POST", "/betaAppReviewSubmissions", {"data": {
                "type": "betaAppReviewSubmissions",
                "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})["data"]
            print("4. ✅ Enviado a revisión de Apple:", s["attributes"].get("betaReviewState"))

    g = call("GET", f"/betaGroups/{gid}")["data"]["attributes"]
    print("\n🔗 Link público:", g.get("publicLink") or "(aparece cuando Apple apruebe el build)")
    if faltantes:
        print("⚠️ Pendiente:", ", ".join(faltantes))


if __name__ == "__main__":
    main()
