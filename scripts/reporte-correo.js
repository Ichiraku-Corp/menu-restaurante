// Copia reporte-cierre.js (el mismo HTML de la caja y de la laptop) como módulo para la función «correo».
// Uso: node scripts/reporte-correo.js          (escribe supabase/functions/correo/reporte.js)
//      node scripts/reporte-correo.js --check  (falla si la copia no está al día)
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "reporte-cierre.js"), "utf8");
const out = "// GENERADO por scripts/reporte-correo.js desde reporte-cierre.js: no editar a mano.\n" +
  "// deno-lint-ignore-file\n// @ts-nocheck\nconst module = { exports: {} };\n" + src +
  "\nexport const reportHtml = module.exports.reportHtml;\nexport const weekSubject = module.exports.weekSubject;\n";
const dest = path.join(ROOT, "supabase", "functions", "correo", "reporte.js");
if (process.argv.includes("--check")) {
  const cur = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8") : "";
  if (cur !== out) { console.log("desactualizado: supabase/functions/correo/reporte.js\nEjecuta: node scripts/reporte-correo.js"); process.exit(1); }
  console.log("La copia del reporte para el correo está al día.");
} else { fs.writeFileSync(dest, out); console.log("escrito: supabase/functions/correo/reporte.js"); }
