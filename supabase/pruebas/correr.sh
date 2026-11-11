#!/bin/bash
# Crea una base vacía, instala todo el esquema y corre las pruebas.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres supabase/pruebas/correr.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${PRUEBAS_DB:-ichiraku_pruebas}
psql -d postgres -qc "drop database if exists $DB" -c "create database $DB"
run() { psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$1" > /tmp/prueba-$$.log 2>&1 || { cat /tmp/prueba-$$.log; echo "ERROR en $1"; exit 1; }; }
run pruebas/00-entorno.sql
for f in schema seed gestion pos servicio asistencia avisos whatsapp; do run "$f.sql"; done
# Aplicar el esquema dos veces debe funcionar igual (así se actualiza producción)
for f in gestion pos servicio asistencia avisos whatsapp; do run "$f.sql"; done
for t in pruebas/[1-9]*.sql; do
  echo "== $t"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$t" 2>&1 | grep -E "ok:|FALLÓ|ERROR|PASARON" | sed 's/^.*NOTICE: *//'
  [ "${PIPESTATUS[0]}" -eq 0 ] || { echo "ERROR en $t"; exit 1; }
done
