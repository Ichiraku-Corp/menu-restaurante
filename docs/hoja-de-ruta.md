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
5. Personalidad e historia de Nex.
6. Modelo Live2D de Nex.
7. Días libres del personal (cuando estén definidos).
8. Impresoras (3): **caja**, **cocina** (comandas) y **salón de arriba** (precuentas a clientes).
   La de arriba es una **Roccia** térmica de 80 mm, conectada por red. De cada una falta la etiqueta
   (modelo), una foto de los puertos traseros y la hoja de autoprueba (dirección IP).
9. Nombre del proveedor de facturación digital (para revisar su API).

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
- **Sistema de facturación propio:** sustituirá al sistema de ventas actual, con facturación digital
  a través del proveedor autorizado y **impresión automática por red**: comandas en cocina, precuentas en el salón de arriba y
  facturas o recibos en caja.
- **Al final:** juego de cartas con los platos (borrador en `docs/borrador-cartas.html`).
