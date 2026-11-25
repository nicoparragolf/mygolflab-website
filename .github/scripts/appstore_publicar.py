"""
CoachYard · Publicar en el App Store una versión ya aprobada por Apple.

Busca la versión de iOS que está en "Pending Developer Release" (aprobada,
esperando que la publiques a mano) y le pide a Apple que la publique.
Si no hay ninguna aprobada esperando, no hace nada.
"""
import json
import os
import time

import jwt
import requests

API = "https://api.appstoreconnect.apple.com"
BUNDLE_ID = os.environ.get("BUNDLE_ID", "golf.mygolflab.coachhub")
KEY_ID = os.environ["ASC_KEY_ID"]
ISSUER = os.environ["ASC_ISSUER_ID"]
P8 = os.environ["ASC_KEY_P8"]


def token():
    now = int(time.time())
    return jwt.encode({"iss": ISSUER, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"},
                      P8, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"})


def call(method, path, body=None, ok=(200, 201, 204)):
    r = requests.request(method, API + "/v1" + path, timeout=90,
                         headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"},
                         data=json.dumps(body) if body is not None else None)
    if r.status_code not in ok:
        print(f"❌ {method} {path} → {r.status_code}\n{r.text[:2500]}")
        raise SystemExit(1)
    return r.json() if r.text else {}


def main():
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        print(f"❌ No existe una app con bundle ID {BUNDLE_ID}.")
        raise SystemExit(1)
    app_id = apps[0]["id"]
    vers = call("GET", f"/apps/{app_id}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
    for v in vers:
        a = v["attributes"]
        print(f"   versión {a.get('versionString')}: {a.get('appStoreState') or a.get('appVersionState')}")
    lista = next((v for v in vers if (v["attributes"].get("appStoreState") == "PENDING_DEVELOPER_RELEASE"
                                      or v["attributes"].get("appVersionState") == "PENDING_DEVELOPER_RELEASE")), None)
    if not lista:
        print("⏭️  No hay ninguna versión aprobada esperando publicación. No se hizo nada.")
        return
    num = lista["attributes"]["versionString"]
    call("POST", "/appStoreVersionReleaseRequests", {
        "data": {"type": "appStoreVersionReleaseRequests",
                 "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": lista["id"]}}}}})
    print(f"✅ Versión {num} enviada a publicación. Aparece en el App Store en unas horas (hasta 24 h).")


if __name__ == "__main__":
    main()
