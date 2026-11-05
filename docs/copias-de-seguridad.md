# Copias de seguridad de la base de datos

Cada madrugada (03:17, hora de Venezuela) GitHub Actions copia la base de datos de Supabase (esquema
`public`: carta, nómina, gastos, insumos, recetas, inventario, ventas, asistencia…), la **cifra con
AES-256** y la guarda **30 días**. El archivo está en el repositorio público, pero sin la contraseña es
ilegible.

> Las fotos de los platos (almacenamiento de Supabase) y las cuentas de usuario no van en la copia.
> Las fotos originales están en `assets/dishes/` y las cuentas se vuelven a crear en Authentication.

## Activarla (una vez)

1. **Cadena de conexión:** Supabase → botón **Connect** (arriba) → **Session pooler** → copia la
   cadena `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres` y
   sustituye `[YOUR-PASSWORD]` por la contraseña de la base de datos (Project Settings → Database;
   si no la recuerdas, ahí mismo se puede restablecer).
2. **Contraseña de cifrado:** inventa una frase larga (16 caracteres o más) y **guárdala en un lugar
   seguro** (gestor de contraseñas o papel en la caja fuerte). Sin ella no se pueden abrir las copias.
3. **Secretos en GitHub:** el repositorio → **Settings → Secrets and variables → Actions → New
   repository secret**:
   - `SUPABASE_DB_URL` = la cadena del paso 1
   - `BACKUP_PASSPHRASE` = la frase del paso 2
4. **Probarla:** pestaña **Actions** → «Copia de seguridad diaria» → **Run workflow**. En unos minutos
   debe terminar en verde y mostrar el archivo `ichiraku-AAAA-MM-DD.dump.gpg` en **Artifacts**.

Si alguna noche falla, GitHub envía un correo a quien administra el repositorio.

## Restaurar

Necesitas un PC con PostgreSQL (`pg_restore`) y GnuPG (`gpg`) instalados.

1. Descarga el artefacto del día elegido (pestaña Actions → la ejecución → Artifacts) y descomprime
   el `.zip`.
2. Descifra (pedirá la frase de cifrado):
   ```bash
   gpg --output ichiraku.dump --decrypt ichiraku-AAAA-MM-DD.dump.gpg
   ```
3. Restaura en Supabase (cadena de conexión del paso 1):
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname "postgresql://…" ichiraku.dump
   ```
   `--clean` **borra y reemplaza** las tablas actuales por las de la copia: úsalo solo si de verdad
   quieres volver a ese día. Para revisar una copia sin tocar nada, restáurala en un proyecto de
   Supabase de prueba.

Este ciclo (copiar → cifrar → descifrar → restaurar en una base vacía) se probó con la base de
pruebas: los datos, la seguridad por filas (RLS) y las 18 reglas de acceso volvieron idénticos.

## Alternativa de pago

El plan **Pro de Supabase** (25 $/mes) incluye copias diarias automáticas con restauración desde el
panel. Se pueden usar las dos cosas a la vez.
