# Hoja de ruta del sistema Ichiraku

Visión: un sistema de gestión del restaurante prácticamente autónomo, con una asistente (Nex) para el
personal y la aprobación del dueño en lo que toca dinero.

## Hecho

- **Carta digital** con QR, buscador, etiquetas, ficha del plato y carrito con 10 % de servicio.
- **Panel** de la carta y QR con diseño (tarjetas impresas para las 13 mesas).
- **Gestión** (`gestion.html`, solo personal autorizado): nómina quincenal, gastos por área, insumos
  con merma, recetas por ingrediente, precios de proveedores con aprobación (regla del 5 %),
  asistencia (preparada para el Hikvision DS-K1T321MFWX), ventas diarias, inventario (ventas →
  stock, mermas, conteos, lista de compras) y estado de resultados con utilidad bruta y neta (IVA
  separado).
- **Histórico y clientes** (Gestión): 2 años de ventas de Syth por mes y por día de la semana,
  proyección de los próximos meses, ganancia estimada, platos y grupos más vendidos, y base de
  clientes con buscador y consentimiento para promociones.
- **Nex, fase 2** (`cocina.html` + función `nex`): asistente por voz para mermas, conteos, stock y
  recetas, con Claude Opus 5.5.

## Pendientes (actualizado el 7 nov 2026)

### 🔴 Primero (rápido, 5–10 min cada uno)
0. En Supabase → SQL Editor, pegar **`1-gestion.sql`** (nueva versión de `supabase/gestion.sql`: 2FA
   obligatoria, tablas de histórico y clientes) y después **`4-historico-syth-PRIVADO.sql`** (ventas,
   productos y clientes de Syth, horarios y Gise). No volver a ejecutar `2-datos-iniciales`.
   Luego entrar en `/admin.html` y **vincular el teléfono** con el QR.
1. Entrar en Gestión y confirmar: **12 personas** en Nómina con nombre completo y horario, los
   **9 gastos fijos**, y las pestañas **Histórico** y **Clientes** con datos.
2. Activar la **verificación en dos pasos (2FA)** en Supabase y en GitHub (GitHub ✅ en curso).
3. GitHub → Settings → Pages → marcar **Enforce HTTPS**.
4. Activar la **copia de seguridad diaria**: secretos `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE` en GitHub y
   probar con «Run workflow» (`docs/copias-de-seguridad.md`).

### 📎 Para enviar
6. Recetas correctas y actualizadas de la carta, por porción y tamaño (Peq/Gr).
7. Lista de costos de insumos: precio y cantidad de compra; si se puede, stock actual y mínimo.
8. Receta de los fideos caseros (ingredientes por tanda y porciones).
9. Proveedores: nombre, WhatsApp y qué vende cada uno.
10. Hoja de autoprueba de las impresoras de **cocina** y **caja** (para su IP).
11. Modelo **Live2D** de Nex, cuando tenga su apariencia definitiva.

### ❓ Para averiguar
12. **Syth Software:** ¿emiten la factura digital o quién es el proveedor autorizado? ¿Pueden exportar las
    ventas de cada día por plato (para llenar el inventario solo)?
13. Proveedor de internet: ¿el local tiene IP fija?
14. ¿El 10 % de servicio que se cobraba en Syth era todo para el personal o una parte para el local?
    (hoy la gestión supone 15 % personal / 85 % local; se cambia en Ventas → Ajustes).

### 🤖 Nex
15. Crear la clave en console.anthropic.com (con límite de gasto), guardarla como secreto
    `ANTHROPIC_API_KEY` en Supabase y publicar la función `nex` (`docs/nex-asistente.md`).
16. Crear la cuenta de la tablet de cocina y darle el rol «cocina».

### 📝 Documentos
17. Completar el borrador de **política de privacidad** con razón social, RIF y contacto, y que lo revise
    un abogado o el contador (`docs/borrador-politica-privacidad.md`), antes del registro de clientes.
17b. **Clientes importados de Syth (338):** pedirles permiso antes de enviarles promociones (por ejemplo,
    un mensaje único por WhatsApp al publicar la política); marcarlo en Gestión → Clientes.

### 📦 Cuando llegue
18. **Equipo Hikvision:** instalación guiada; antes, consentimiento por escrito de cada empleado.

### ✅ Resuelto
- SQL de gestión y datos iniciales ejecutados en Supabase (5 nov).
- Base de datos de Syth (2 años) y horarios recibidos e importados (7 nov); pago de Gise: Ref 240 al mes.
- Seguridad web: CSP, librerías propias, vista previa al compartir, página 404, copia diaria cifrada (falta
  activarla) y borrador de política de privacidad.
- Personalidad e historia de Nex: recibida e integrada.
- Impresoras (3, iguales: caja, cocina y precuentas del salón Edo): **Roccia RC-8002**, 80 mm,
  cortador, 24 V; USB + red RJ-45 + wifi; **ESC/POS (Epson)**; puerto **9100**; la de arriba parece tener
  IP fija **192.168.0.30** (confirmar al instalar); contraseña de fábrica 12345678, cambiarla. Ya están en
  la red del local (hoy imprime en ellas el sistema de ventas).
- PC del local: la **laptop de caja con Windows**, queda encendida.
- QR para la Feria de comida: no hacen falta.

## Próximas fases

- **Puesta en marcha:** SQL y datos iniciales ✅; falta confirmar en Gestión, publicar la función
  `nex` con la clave de Claude y crear la cuenta de la tablet.
- **Equipo facial:** instalar el Hikvision (12 V, cable de red), registrar caras con su nº de empleado
  y conectar las marcaciones a n8n (en la nube; si el equipo no envía a HTTPS, puente local).
- **n8n:** precios de proveedores por WhatsApp Business (API oficial de Meta), ventas diarias y
  avisos.
- **Nex, fase 3:** avatar Live2D, personalidad oficial e identificación por cara en la tablet.
- **Nex, fase 4:** revisión de uniforme al entrar (foto, la IA sugiere y un encargado decide; fotos
  borradas a los 7 días; consentimiento por escrito).
- **Centro del local: la laptop de caja (Windows)**, que queda encendida. Configurar IP fija en la red
  del local y que no se suspenda. Puente entre el sistema en internet y los aparatos de
  la red local: envía trabajos ESC/POS a las 3 impresoras (puerto 9100) y recibe las marcaciones del
  Hikvision.
- **Sistema de punto de venta y facturación propio** (sustituye al sistema de ventas actual):
  - **Usuarios:** meseras (teléfono o tablet), caja (vinculada a las impresoras), cocina (Nex) y
    dueño/admin.
  - **Seguridad:** solo dispositivos aprobados por el dueño (bloqueables), PIN personal por mesera,
    horario y, si es posible, solo desde la red del local; PIN de encargado para anular, descontar o
    dar cortesías; registro de auditoría; las impresoras solo reciben trabajos del puente del local.
  - **Salón:** áreas **Feria de comida** (afuera, ~20 mesas), **Tokio** (recepción, 8 mesas) y
    **Edo** (arriba, 5 mesas; impresora de precuentas); mapa de mesas con estados, mover y unir mesas.
  - **Sin internet sigue funcionando:** el PC del local guarda las operaciones y las sincroniza al
    volver la conexión (arquitectura con servidor local).
  - **Comandas:** tamaños, sabores, notas, tiempos; impresión automática en cocina; agotados en tiempo
    real.
  - **Cuentas:** dividir por platos, a partes iguales o por persona; mover platos; precuenta impresa
    arriba.
  - **Cobro:** métodos y pagos mixtos ($ y Bs con tasa del día), vuelto, 10 % de servicio, IGTF si
    aplica; registro y validación de pagos (referencias; verificación bancaria automática si el banco
    lo permite).
  - **Factura digital** con el proveedor autorizado; recibos en caja.
  - **Cierre diario:** arqueo por método, diferencias, fondo de caja, reporte; alimenta ventas,
    inventario y utilidades.
  - **Clientes:** registro con consentimiento, historial, fidelidad y captación desde el QR de la carta.
  - **Reportes:** por mesera, hora, plato y tiempos de cocina.
- **Al final:** juego de cartas con los platos (borrador en `docs/borrador-cartas.html`).
