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

## Pendiente de recibir

1. Reporte de ventas desde la apertura.
2. Recetas correctas y actualizadas, con precios de insumos.
3. Receta de los fideos caseros (ingredientes por tanda y porciones).
4. Proveedores y su WhatsApp.
5. ~~Personalidad e historia de Nex~~ ✅ recibida e integrada (si hay un texto de lore más largo, enviarlo).
6. Modelo del avatar de Nex (la ficha lo describe como 3D).
7. Días libres del personal (cuando estén definidos).
8. Impresoras (3, iguales): **caja**, **cocina** (comandas) y **salón de arriba** (precuentas).
   Revisada: **Roccia RC-8002**, 80 mm, cortador, 24 V; USB + red RJ-45 + wifi; **ESC/POS (Epson)**;
   recibe por TCP en el **puerto 9100**; IP por cable aparentemente fija **192.168.0.30** (video borroso,
   confirmar al instalar); wifi con modo AP 10.10.100.254. Contraseña de fábrica 12345678: cambiarla.
   Hoy imprime en ellas el sistema de ventas por red, así que las 3 están en la red del local.
   Falta la IP de las otras dos (cocina y caja).
9. Sistema de ventas actual: **Syth Software** (proveedor). Confirmar si también emite la factura
   digital o quién es el proveedor autorizado, y si permite exportar el historial de ventas.
10. Saber si el internet del local tiene IP fija (para limitar caja a la red del local).

## Próximas fases

- **Puesta en marcha:** ejecutar `supabase/gestion.sql` y los datos iniciales, publicar la función
  `nex` con la clave de Claude, crear la cuenta de la tablet.
- **Equipo facial:** instalar el Hikvision (12 V, cable de red), registrar caras con su nº de empleado
  y conectar las marcaciones a n8n (en la nube; si el equipo no envía a HTTPS, puente local).
- **n8n:** precios de proveedores por WhatsApp Business (API oficial de Meta), ventas diarias y
  avisos.
- **Nex, fase 3:** avatar Live2D, personalidad oficial e identificación por cara en la tablet.
- **Nex, fase 4:** revisión de uniforme al entrar (foto, la IA sugiere y un encargado decide; fotos
  borradas a los 7 días; consentimiento por escrito).
- **Centro del local (un PC que ya tiene el local):** encendido en horario, IP fija y sin suspensión;
  falta saber su sistema operativo. Puente entre el sistema en internet y los aparatos de
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
