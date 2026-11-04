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

## Para el cliente

- **Ficha del plato**: al tocar un plato se ve la foto en grande, la descripción y se elige
  tamaño, sabor, cantidad y una nota («sin cebolla»).
- **Mi pedido**: botón «+» en cada plato y barra abajo con el número de productos y el total.
  El pedido se guarda en el móvil del cliente y se recalcula con los precios actuales.
- **Mostrar al mesonero**: pantalla grande con el número de mesa, los productos y el total.
- **Número de mesa**: el cliente lo escribe, o viene en el QR si la URL lleva `?mesa=7`.
- **Buscador** por nombre, descripción, sabor o etiqueta.
- **Etiquetas** con icono: ⭐ Recomendado, 🌶️ Picante, 🆕 Nuevo, 🌱 Vegetariano (botones rápidos
  en el panel). Cualquier otra etiqueta se muestra tal cual.
- **WhatsApp** (opcional): rellena `WHATSAPP_NUMBER` en `config.js` y aparece el botón
  «Enviar por WhatsApp» con el pedido ya escrito.

## Gestión de costos (solo administración)

`gestion.html` (enlace «Gestión de costos» en el panel) calcula los costos del restaurante,
divididos por áreas: Administrativo, Cocina, Salón y barra, Seguridad y cámaras (editables).

- **Nómina quincenal**: empleados con su área, pago por quincena y bonos del mes.
- **Gastos**: fijos (se repiten cada mes) y variables (con fecha).
- **Insumos**: precio de compra, unidad y merma; calcula el costo real por kg, litro o unidad.
- **Recetas**: ingredientes y cantidades por plato y tamaño (Peq/Gr); da el costo, la ganancia
  y el % de costo sobre el precio de venta.
- **Resumen**: costo del mes por área, márgenes y punto de equilibrio estimado.
- **Proveedores y precios automáticos**: los precios nuevos que cambian hasta un 5 % se
  aplican solos; si cambian más, esperan tu aprobación. Historial de cada cambio.
  Preparado para n8n: ver [`docs/n8n-precios.md`](docs/n8n-precios.md).
- **Asistencia**: marcaciones del equipo de reconocimiento facial (vía n8n), con horario fijo por
  empleado, tolerancia de 5 min, faltas y retrasos descontados de forma proporcional y horas extra
  a 1,5 ×. Calcula lo que corresponde pagar en cada quincena.
- **Ventas**: ventas diarias por método de pago y por plato (vía n8n o a mano), comisiones del
  banco, reparto del 10 % de servicio (85 % local / 15 % personal) y resultado del mes.
  Ver [`docs/n8n-asistencia-ventas.md`](docs/n8n-asistencia-ventas.md).
- **Inventario**: stock y mínimo de cada insumo, compras, mermas (con quién las reporta), conteos
  físicos (detectan faltantes no registrados), lista de compras y valor del inventario. **Las ventas
  descuentan solas** del stock los insumos de las recetas de lo vendido (con su merma).
- **Estado de resultados**: ventas − costo de lo vendido = **utilidad bruta**; − nómina, gastos,
  comisiones, mermas y faltantes + servicio del local = **utilidad neta**. Por mes y por día.

**Activarla:** en Supabase → SQL Editor ejecuta `supabase/gestion.sql` (y de nuevo cada vez que se actualice; no borra datos). Crea las
tablas y añade como autorizadas las cuentas que ya existen en Authentication → Users.
Nada de esto es público: solo lo ven las cuentas de la tabla `staff` con rol dueño o admin.

## Nex, asistente de cocina por voz

`cocina.html` es la página de la tablet de cocina: el personal habla con **Nex** para registrar mermas
y conteos, consultar stock y recetas y ver qué falta comprar. Usa Claude a través de la función de
Supabase `supabase/functions/nex/` (la clave nunca llega a la tablet). Instalación y detalles en
[`docs/nex-asistente.md`](docs/nex-asistente.md).

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
