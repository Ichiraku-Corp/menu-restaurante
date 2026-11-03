#!/usr/bin/env node
// Genera supabase/seed.sql a partir de data/menu.json.
// Uso: node scripts/seed-sql.js
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const menu = JSON.parse(fs.readFileSync(path.join(root, "data/menu.json"), "utf8"));

const lit = (v) => v == null ? "null" : "'" + String(v).replace(/'/g, "''") + "'";
const arr = (a) => "array[" + a.map(lit).join(",") + "]::text[]";

let sql = `-- Menú completo generado desde data/menu.json (node scripts/seed-sql.js).
-- Ejecutar en Supabase → SQL Editor DESPUÉS de schema.sql.
-- ATENCIÓN: reemplaza las categorías y platos que ya existan.
-- Las fotos apuntan a assets/dishes/ del propio sitio. Si cambias una foto
-- desde el panel, se sube a Supabase Storage automáticamente.
begin;
truncate public.dishes, public.categories restart identity;
`;
for (const c of menu.categories) {
  sql += `insert into public.categories (id, name, subtitle, position) overriding system value values (${c.id}, ${lit(c.name)}, ${lit(c.subtitle || "")}, ${c.position});\n`;
}
for (const d of menu.dishes) {
  sql += "insert into public.dishes (category_id, name, subtitle, description, price, variants, options, tags, photo_url, available, position) values (" +
    [d.category_id, lit(d.name), lit(d.subtitle || ""), lit(d.description || ""), d.price,
     lit(JSON.stringify(d.variants || [])) + "::jsonb", arr(d.options || []), arr(d.tags || []),
     lit(d.photo_url), d.available ? "true" : "false", d.position].join(", ") + ");\n";
}
sql += `select setval(pg_get_serial_sequence('public.categories', 'id'), (select max(id) from public.categories));
commit;
`;
fs.writeFileSync(path.join(root, "supabase/seed.sql"), sql);
console.log(`supabase/seed.sql: ${menu.categories.length} categorías, ${menu.dishes.length} platos`);
