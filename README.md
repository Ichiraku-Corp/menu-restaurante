# Menú digital — Ichiraku Ramen

Menú para el móvil que se abre al escanear un QR, con un panel de administración
para cambiar precios, platos, fotos y disponibilidad.

- **`index.html`**: el menú público. Una sola página sin librerías, con el CSS y el JS en línea.
  Guarda la última versión en el móvil, así que en visitas repetidas se ve al instante y se
  actualiza en segundo plano. Las fotos (≈7 KB cada una) se cargan solo cuando aparecen en pantalla.
- **`admin.html`**: el panel. Login, categorías, platos, nombre en japonés, tamaños (Peq/Gr)
  con precio propio, sabores, precios editables directamente en la lista, "Agotado" con un clic,
  subida de fotos (se comprimen en el navegador antes de subirlas) y generador del QR en PNG/SVG.
- **Supabase** como backend gratuito: base de datos, almacenamiento de fotos y login.

## Contenido actual

`data/menu.json` tiene la carta completa: 6 categorías y 34 productos, con las fotos recortadas
de la carta impresa en `assets/dishes/`. Los productos que no tienen foto se pueden completar
desde el panel.

Si editas `data/menu.json`, regenera el SQL de carga con:

```bash
node scripts/seed-sql.js
```

## Puesta en marcha

1. **Crea un proyecto** en [supabase.com](https://supabase.com) (el plan gratuito basta).
2. En **SQL Editor** ejecuta `supabase/schema.sql` (tablas, permisos y bucket de fotos) y
   después `supabase/seed.sql` (carga la carta completa).
3. En **Authentication → Users → Add user** crea tu usuario de administrador (email + contraseña).
   En **Authentication → Providers → Email** desactiva *Allow new users to sign up*
   para que nadie más pueda registrarse.
4. En **Project Settings → API** copia la *Project URL* y la *anon public key* en `config.js`.
   Ahí también se configuran el nombre, el eslogan y el formato de precio (`Ref 2.5`).
5. **Publica** la carpeta en cualquier hosting estático: GitHub Pages (Settings → Pages →
   Deploy from branch), Netlify o Vercel. No hay paso de compilación.
6. Abre `https://tu-dominio/admin.html`, entra, y descarga el QR desde la sección *Código QR*.

Sin Supabase configurado en `config.js`, el menú funciona igual mostrando `data/menu.json`
(pero los cambios solo se pueden hacer editando ese archivo).

## Probar en local

```bash
npx serve .
```

y abre http://localhost:3000 (menú) y http://localhost:3000/admin.html (panel).

## Pensando en el juego de cartas

Cada plato tiene una columna `attributes` (JSON) que el menú ignora. Sirve para guardar
datos del futuro juego (rareza, ataque, defensa…) sin tocar el esquema ni romper el menú.
Las descripciones ya tienen mucho "texto de carta" ("Resistencia a los rayos +1",
"Elimina pesadillas", "nivel de sabrosura más de 9.000") y las fotos tienen URL estable
para reutilizarlas como ilustraciones.
