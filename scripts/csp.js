#!/usr/bin/env node
// Escribe (o comprueba) la política de seguridad de contenido (CSP) de cada página.
//
//   node scripts/csp.js          actualiza la etiqueta <meta http-equiv="Content-Security-Policy">
//   node scripts/csp.js --check  falla si alguna página tiene la política desactualizada
//
// Solo se permite ejecutar código del propio sitio y los bloques <script> en línea cuya
// huella (sha256) coincide exactamente. Si cambias un script en línea, vuelve a ejecutarlo.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PAGES = ["index.html", "admin.html", "gestion.html", "cocina.html", "pos.html", "404.html", "docs/borrador-cartas.html"];

const config = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const m = config.match(/SUPABASE_URL:\s*"https:\/\/([^"/]+)/);
const SUPA = m ? m[1] : null;

function policy(hashes) {
  const supa = SUPA ? [`https://${SUPA}`] : [];
  return [
    "default-src 'self'",
    ["script-src 'self'"].concat(hashes.map((h) => `'sha256-${h}'`)).join(" "),
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:"].concat(supa).join(" "),
    ["connect-src 'self'"].concat(supa, SUPA ? [`wss://${SUPA}`] : []).join(" "),
    "font-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

const META_RE = /\n?<meta http-equiv="Content-Security-Policy" content="[^"]*">/;
let stale = 0;
for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  const html = fs.readFileSync(file, "utf8");
  const hashes = [];
  for (const [, body] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    hashes.push(crypto.createHash("sha256").update(body, "utf8").digest("base64"));
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy(hashes)}">`;
  const without = html.replace(META_RE, "");
  const updated = without.replace(/(<meta charset="utf-8">)/, `$1\n${meta}`);
  if (updated === without) throw new Error(`${rel}: falta <meta charset="utf-8">`);
  if (updated !== html) {
    stale++;
    if (!process.argv.includes("--check")) fs.writeFileSync(file, updated);
    console.log(`${process.argv.includes("--check") ? "desactualizada" : "actualizada"}: ${rel} (${hashes.length} script en línea)`);
  }
}
if (process.argv.includes("--check") && stale) { console.error("Ejecuta: node scripts/csp.js"); process.exit(1); }
if (!stale) console.log("Todas las páginas tienen la política al día.");
