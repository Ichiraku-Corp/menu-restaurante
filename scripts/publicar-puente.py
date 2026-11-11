#!/usr/bin/env python3
"""Publica una versión nueva del puente para que la laptop de caja se actualice sola.

Uso:  python3 scripts/publicar-puente.py "nota de la versión" puente.js app/pos-base.js app/pos.html ...

Rutas válidas: puente.js, logo.pbm, imprimir-usb.ps1 (de la carpeta puente/) y app/<archivo>
(se toma del sitio: app/pos-base.js -> pos-base.js, app/assets/x.png -> assets/x.png). Nunca config.json.
Se escribe en Supabase con la API de administración (el token lo pone el entorno, no va en el repo).
"""
import base64, hashlib, json, os, subprocess, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROYECTO = "krjryvtnzgwwhanmbdrn"

def origen(ruta):
    if ruta.startswith("app/"):
        return os.path.join(RAIZ, ruta[4:])
    if ruta in ("puente.js", "logo.pbm", "imprimir-usb.ps1"):
        return os.path.join(RAIZ, "puente", ruta)
    sys.exit(f"Ruta no permitida: {ruta}")

def sql(q):
    out = subprocess.run(["curl", "-sS", "-X", "POST", f"https://api.supabase.com/v1/projects/{PROYECTO}/database/query",
                          "-H", "Authorization: Bearer proxy-injected", "-H", "Content-Type: application/json",
                          "--data-binary", "@-"], input=json.dumps({"query": q}).encode(), capture_output=True)
    return json.loads(out.stdout or b"null")

def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    nota, rutas = sys.argv[1], sys.argv[2:]
    if "puente.js" in rutas:
        subprocess.run(["node", "--check", origen("puente.js")], check=True)
    archivos = []
    for r in rutas:
        datos = open(origen(r), "rb").read()
        archivos.append({"path": r, "sha256": hashlib.sha256(datos).hexdigest(), "b64": base64.b64encode(datos).decode()})
    actual = sql("select coalesce(max(version), 0) as v from public.pos_bridge_releases")[0]["v"]
    nueva = actual + 1
    cuerpo = json.dumps(archivos).replace("$q$", "")
    r = sql(f"insert into public.pos_bridge_releases (version, notes, files) values ({nueva}, $n${nota}$n$, $q${cuerpo}$q$::jsonb) returning version")
    print(f"Publicada la versión {nueva}: {nota} ({len(archivos)} archivo(s))", r)

if __name__ == "__main__":
    main()
