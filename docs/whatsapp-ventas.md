# Ventas por WhatsApp (plan técnico)

Objetivo: que un cliente pida por WhatsApp y el pedido entre **solo** al sistema de ventas como Delivery o
Para llevar, se imprima en cocina, descuente inventario y quede en su ficha de cliente, sin copiar nada a
mano. Es la base para los anuncios «Click to WhatsApp» y para las apps futuras (usan las mismas funciones).

Estado: **plan, sin código todavía**. Rama `whatsapp-ventas`; la rama principal (la que publica la carta y caja) no se toca hasta probarlo.

## Principios

1. **Un solo sistema.** Nada de carta, precios, agotados ni clientes duplicados: todo sale de las tablas que
   ya existen (`dishes`, `pos_orders`, `customers`, `pos_rate()`…).
2. **Solo se añade.** Tablas y funciones nuevas en `supabase/whatsapp.sql`. Lo que ya funciona en caja no
   cambia de comportamiento. Se puede ejecutar más de una vez, como el resto.
3. **Nada secreto en el repositorio** (es público). Token de WhatsApp, secreto de la app de Meta y clave de
   Claude van solo en Supabase → Edge Functions → Secrets. Los datos de pago (pago móvil, Zelle…) van en
   la base de datos, no en el código.
4. **Caja decide.** Ningún pedido de WhatsApp llega a cocina sin que caja lo acepte (o sin pago comprobado
   automáticamente, en una fase posterior).
5. **API oficial de Meta** (Cloud API), con el número actual en modo coexistencia: sigue funcionando la app
   de WhatsApp Business en el teléfono.

## Cómo funciona

```
Carta (index.html) ──«Pedir por WhatsApp»──▶ wa_cart_create() ──▶ código del pedido (p. ej. K7M2)
        │                                                                   │
        └──── abre WhatsApp con «Hola, quiero hacer el pedido K7M2» ◀───────┘
                                   │
Cliente WhatsApp ──▶ Meta ──▶ función «whatsapp» (Supabase) ──▶ wa_messages / wa_conversations
                                   │   ├─ reconoce el código ▶ arma el pedido con precios actuales
                                   │   ├─ pide datos: retiro o delivery, dirección, cédula (formulario)
                                   │   └─ responde con total en Ref y Bs (tasa BCV) y datos de pago
                                   ▼
                          wa_orders «por aceptar» ──▶ aviso en caja (pos.html)
                                   │ caja acepta
                                   ▼
                pos_orders (delivery / llevar) ──▶ comanda en cocina, inventario, cliente
                                   │ cambios de estado
                                   ▼
                     wa_outbox ──▶ «Tu pedido está en preparación / en camino / listo»
```

**Por qué el código del pedido y no leer el texto:** la carta ya arma el pedido con fotos, tamaños, sabores y
notas. En vez de que el bot interprete un texto (frágil), la carta guarda el carrito en la base de datos y
manda solo un código. El servidor vuelve a calcular los precios y revisa agotados, así nadie puede cambiar un
precio editando el mensaje. Hoy el botón «Enviar por WhatsApp» manda texto suelto; se sustituye por este.

Quien escriba sin código (o desde un anuncio) recibe un saludo con botones: **Ver la carta** (enlace a la
carta), **Hacer un pedido**, **Horario y ubicación**, **Hablar con una persona**.

## Base de datos (`supabase/whatsapp.sql`)

| Tabla | Para qué |
|---|---|
| `wa_settings` | Una fila: horario, mensaje de bienvenida, datos de pago, costo de delivery por zona, bot activo sí/no |
| `wa_conversations` | Una por teléfono: cliente vinculado, último mensaje del cliente (ventana de 24 h), bot en pausa, quién la atiende, anuncio de origen |
| `wa_messages` | Cada mensaje entrante y saliente; `wa_id` único para no duplicar si Meta reenvía; estado (enviado, entregado, leído, error) |
| `wa_carts` | Carritos que crea la carta: código corto, platos, vence a las 2 h |
| `wa_orders` | Pedido de WhatsApp: platos, retiro o delivery, dirección, total, estado (`borrador` → `por_aceptar` → `aceptado` / `rechazado`), `pos_order_id` al aceptar |
| `wa_outbox` | Mensajes por enviar (avisos de estado, plantillas); la función los envía y reintenta |
| `wa_events` | Embudo para medir: conversación iniciada (con anuncio), pedido creado, aceptado, pagado, entregado |

Cambios mínimos en lo existente (solo columnas nuevas, con valor por defecto):

- `customers.wa_phone`: teléfono de WhatsApp normalizado (`58414…`), único. El cliente se reconoce por
  WhatsApp aunque aún no haya dado su cédula.
- `pos_orders.origin`: `'pos'` (por defecto) o `'whatsapp'`, para reportes y para saber a quién avisar.

Funciones (RPC), todas `security definer`, como el resto del sistema:

- `wa_cart_create(items)`: la llama la carta (anónima). Valida platos, tamaños y agotados; límite de
  carritos por minuto para evitar abuso. Devuelve el código.
- `wa_pending()` / `wa_accept(emp, pin, order, fee)` / `wa_reject(emp, pin, order, motivo)`: caja, con PIN.
  `wa_accept` usa por dentro `pos_open_delivery` o un pedido «llevar», añade los platos y llama a
  `pos_send`. Es decir, reutiliza exactamente el camino que ya está probado.
- Disparador en `pos_orders` / `pos_items`: cuando un pedido con `origin = 'whatsapp'` se envía a cocina, se
  cobra o se anula, deja el aviso en `wa_outbox`.
- RLS activado en todas las tablas nuevas, sin acceso directo: solo funciones.

## Función `whatsapp` (`supabase/functions/whatsapp/index.ts`)

- `GET`: verificación del webhook de Meta (`hub.verify_token`).
- `POST`: comprueba la firma `X-Hub-Signature-256` con el secreto de la app (si no coincide, se descarta),
  guarda el mensaje, responde 200 de inmediato y procesa en segundo plano.
- Tipos que entiende: texto, botones, listas, formularios (WhatsApp Flows), ubicación (para la dirección),
  imagen (capturas de pago, se guardan para caja) y el origen del anuncio (`referral`).
- Envía con la Graph API de Meta usando `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
- Fuera de la ventana de 24 h solo envía **plantillas aprobadas**.
- Se publica con `--no-verify-jwt` (Meta no manda sesión de Supabase); la seguridad es la firma.

Secretos nuevos: `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_PHONE_NUMBER_ID`. `ANTHROPIC_API_KEY` ya existe (Nex).

## Pantallas

- **Caja (`pos.html`)**: aviso con sonido «Pedido de WhatsApp» con los platos, retiro o delivery, dirección,
  pago anunciado y captura. Botones **Aceptar** (pide el costo del delivery si falta) y **Rechazar** (con
  motivo, que se le envía al cliente).
- **Bandeja (`bandeja.html`)**, para caja y dueño: conversaciones, responder a mano, pausar el bot en una
  conversación, ver la ficha del cliente y sus pedidos.
- **Gestión → WhatsApp**: datos de pago, horario, zonas de delivery y el embudo (conversaciones, pedidos,
  ventas y de qué anuncio vinieron).

## Pagos (Venezuela)

- El bot envía el total en **Ref y en Bs** (tasa BCV del día, la misma de caja) y los datos de pago.
- **Binance y PayPal**: el cliente paga y el sistema lo comprueba solo con lo que ya existe
  (`pos_incoming` / `pos_match_incoming`).
- **Pago móvil y Zelle**: el cliente manda la referencia o la captura; caja la confirma, como hoy. Banesco
  automático cuando esté el acceso del banco (ya está previsto en `pos_incoming`).
- **Efectivo al recibir**: permitido o no según `wa_settings`.

## Plantillas de Meta (aprobación previa)

Utilidad: `pedido_recibido`, `pedido_aceptado`, `pedido_en_camino`, `pedido_listo_retirar`,
`pedido_rechazado`. Marketing (más adelante, solo a clientes con permiso): `promo_semana`,
`te_extranamos`. Dentro de la ventana de 24 h los avisos de utilidad no tienen costo.

## Etapas

**Etapa 1: vender ya**
1. `whatsapp.sql` con tablas, funciones y pruebas (`supabase/pruebas/70-whatsapp.sql`).
2. Función `whatsapp`: recibir, guardar, firma, saludo con botones y envío de mensajes.
3. Carta: botón «Pedir por WhatsApp» con código del pedido.
4. Caja: aviso, aceptar y rechazar. Avisos de estado al cliente.
5. Bandeja para responder a mano.

**Etapa 2: automatizar lo predecible**
6. Formularios de WhatsApp (Flows) para retiro/delivery, dirección y cédula.
7. Preguntas frecuentes (horario, ubicación, zonas, métodos de pago) con respuestas fijas, sacadas de
   las conversaciones reales de la Etapa 1.
8. Aceptación automática cuando el pago de Binance o PayPal ya está comprobado (opcional, lo decide el dueño).

**Etapa 3: Nex atiende a los clientes**
9. Nex con una versión «de atención al cliente» de su identidad y herramientas cerradas: ver la carta,
   armar el pedido, estado del pedido, horario, pasar a una persona. Nunca inventa precios ni platos.
10. Primero en **modo sugerencia** (propone la respuesta y una persona la aprueba en la bandeja), luego
    sola en casos simples, luego general. Se evalúa con conversaciones reales antes de cada paso.

**Etapa 4: crecer**
11. Campañas «Click to WhatsApp» medidas por anuncio en Gestión → WhatsApp.
12. Permiso para promociones (338 clientes de Syth, después de publicar la política de privacidad),
    segmentos, recompra y «te extrañamos».

## Pruebas y seguridad

- `supabase/pruebas/70-whatsapp.sql`: carrito con plato agotado o precio alterado, mensaje repetido de Meta,
  aceptar crea el pedido de caja y la comanda, rechazar avisa al cliente, permisos sin PIN fallan.
- `supabase/functions/tests/whatsapp_test.ts`: firma válida e inválida, mensajes de cada tipo, ventana de 24 h.
- `pruebas-navegador`: recorrido «pedido de WhatsApp → caja acepta → cocina».
- CI (`pruebas.yml`) corre todo en cada cambio. Revisión de seguridad antes de pasar a `main`.
- Política de privacidad: añadir los mensajes de WhatsApp y cuánto tiempo se guardan.
- Publicación al cierre del local, nunca en pleno servicio.

## Falta decidir (dueño)

1. ¿Delivery propio con zonas y precios fijos, o caja pone el costo en cada pedido?
2. ¿Solo retiro y delivery, o también reservas de mesa?
3. ¿Quién atiende la bandeja en el turno: caja, o una persona de sala?
4. ¿Se acepta efectivo al recibir el delivery?
5. ¿Pedido mínimo para delivery?
6. Horario de atención por WhatsApp (¿el bot responde fuera de horario y toma pedidos para después?).
