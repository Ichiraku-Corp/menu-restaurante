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
- **Nex, fase 2** (`cocina.html` + función `nex`): asistente por voz para mermas, conteos, stock y
  recetas, con Claude Opus 5.5.

## Pendientes (actualizado el 5 nov 2026)

### 📎 Para enviar
1. Reporte de ventas desde la apertura (exportado de Syth Software).
2. Recetas correctas y actualizadas de la carta, por porción y tamaño (Peq/Gr).
3. Lista de costos de insumos: precio y cantidad de compra; si se puede, stock actual y mínimo.
4. Receta de los fideos caseros (ingredientes por tanda y porciones).
5. Proveedores: nombre, WhatsApp y qué vende cada uno.
6. Modelo **Live2D** de Nex, con su apariencia definitiva (cambiará respecto a la ficha actual).
7. Hoja de autoprueba de las impresoras de **cocina** y **caja** (para su IP).

### ❓ Para averiguar
8. **Syth Software** (sistema de ventas actual): ¿emiten la factura digital o quién es el proveedor
   autorizado? ¿Pueden exportar el historial de ventas?
9. Proveedor de internet: ¿el local tiene IP fija? (para limitar caja a la red del local)
10. Días libres de cada empleado (cuando estén definidos).

### 🛠️ En Supabase
11. ~~Ejecutar `supabase/gestion.sql`~~ ✅ hecho (5 nov).
12. ~~Ejecutar los datos iniciales privados~~ ✅ hecho (5 nov).
13. Entrar en Gestión de costos y confirmar que se ven los 11 empleados y los 9 gastos fijos.
14. Nex: crear la clave en console.anthropic.com (con límite de gasto), guardarla como secreto
    `ANTHROPIC_API_KEY` y publicar la función `nex` (`docs/nex-asistente.md`).
15. Crear la cuenta de la tablet de cocina y darle el rol «cocina».

### 🔐 Seguridad (de tu lado)
17. GitHub → Settings → Pages → marcar **Enforce HTTPS**.
18. Activar la **verificación en dos pasos (2FA)** en tu cuenta de Supabase y en la de GitHub.
19. Activar la **copia de seguridad diaria**: secretos `SUPABASE_DB_URL` y `BACKUP_PASSPHRASE` en
    GitHub y probarla con «Run workflow» (`docs/copias-de-seguridad.md`).
20. Completar y revisar con un abogado el **borrador de política de privacidad**
    (`docs/borrador-politica-privacidad.md`) antes de activar el registro de clientes.

### 📦 Cuando llegue
16. Equipo Hikvision: instalación guiada; antes, consentimiento por escrito de cada empleado.

### ✅ Resuelto
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
