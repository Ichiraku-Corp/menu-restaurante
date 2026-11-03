# Menú digital del restaurante

Menú para el móvil que se abre al escanear un QR, con un panel de administración
para cambiar precios, platos, fotos y disponibilidad.

- **`index.html`**: el menú público. Una sola página sin librerías (~10 KB), con el CSS y el JS en línea.
  Guarda la última versión en el móvil, así que en visitas repetidas se ve al instante y se
  actualiza en segundo plano. Las fotos se cargan solo cuando aparecen en pantalla.
- **`admin.html`**: el panel. Login, categorías, platos, precios editables directamente en la lista,
  "Agotado" con un clic, subida de fotos (se comprimen en el navegador a ≤900 px WebP antes
  de subirlas) y generador del código QR en PNG/SVG.
- **Supabase** como backend gratuito: base de datos, almacenamiento de fotos y login.

## Puesta en marcha

1. **Crea un proyecto** en [supabase.com](https://supabase.com) (el plan gratuito basta).
2. En **SQL Editor** pega y ejecuta `supabase/schema.sql`. Crea las tablas, los permisos
   (lectura pública, escritura solo para el admin) y el bucket `dishes` para las fotos.
3. En **Authentication → Users → Add user** crea tu usuario de administrador (email + contraseña).
   En **Authentication → Providers → Email** desactiva *Allow new users to sign up*
   para que nadie más pueda registrarse.
4. En **Project Settings → API** copia la *Project URL* y la *anon public key* en `config.js`.
   Ahí también se configuran el nombre del restaurante, el eslogan y la moneda.
5. **Publica** la carpeta en cualquier hosting estático: GitHub Pages (Settings → Pages →
   Deploy from branch), Netlify o Vercel. No hay paso de compilación.
6. Abre `https://tu-dominio/admin.html`, entra, y descarga el QR desde la sección *Código QR*.

Sin `config.js` configurado, el menú funciona en **modo demo** con `data/menu.json`.

## Probar en local

```bash
npx serve .
```

y abre http://localhost:3000 (menú) y http://localhost:3000/admin.html (panel).

## Pensando en el juego de cartas

Cada plato tiene una columna `attributes` (JSON) que el menú ignora. Sirve para guardar
datos del futuro juego (rareza, ataque, defensa…) sin tocar el esquema ni romper el menú.
Las fotos ya están en un bucket público con URL estable, así que se pueden reutilizar
directamente como ilustraciones de las cartas.
