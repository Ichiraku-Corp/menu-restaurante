# Instalar las ventas por WhatsApp (guía paso a paso)

Plan y funcionamiento: [`whatsapp-ventas.md`](whatsapp-ventas.md). Esta guía es para el día de la instalación.

Se hace en **dos fases**:

- **Fase A, con el número de prueba de Meta.** Se instala todo y se prueba de punta a punta sin tocar el
  WhatsApp real del local. Los clientes no ven nada.
- **Fase B, con el número real.** Cuando la Fase A funcione, se pasa el número del local a la API y se
  enciende el botón de la carta.

Quién hace cada cosa: **🙋 Edgar** (lo que solo puede hacer el dueño, con sus cuentas) y **🤖 Claude**
(lo hace desde su sesión, con tu permiso en cada paso).

> 🔒 Ninguna clave se escribe en el chat ni en el repositorio (es público). Las claves van solo en
> Supabase → Edge Functions → Secrets.

---

## Antes del día (cuando quieras, no afecta a nada)

### 1. 🙋 Token permanente de Meta (usuario del sistema)
El token de la pantalla de pruebas caduca en 24 h. Este no caduca.

1. Abre https://business.facebook.com/settings/system-users → **Agregar**.
2. Nombre: `ichiraku-bot` · Rol: **Administrador** → **Crear usuario del sistema**.
3. Con `ichiraku-bot` seleccionado → **Asignar activos**:
   - **Apps** → `Ichiraku` → activa **Control total** (Administrar app).
   - **Cuentas de WhatsApp** → la de Ichiraku → **Control total**.
   → **Guardar cambios**.
4. **Generar token** → app `Ichiraku` → Caducidad: **Nunca** → marca los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management` → **Generar token**.
5. **Cópialo en tu gestor de contraseñas.** Meta lo muestra una sola vez. Es la clave `WHATSAPP_TOKEN`.

### 2. 🙋 Secreto de la app
1. Abre https://developers.facebook.com/apps/1677345090710756/settings/basic/
2. En **Clave secreta de la app** toca **Mostrar** (pide tu contraseña de Facebook).
3. Guárdala en tu gestor de contraseñas. Es la clave `WHATSAPP_APP_SECRET`.

### 3. 🙋 Identificador del número de prueba
1. Abre https://developers.facebook.com/apps/1677345090710756/whatsapp-business/wa-dev-console/
2. Debajo del número de prueba ("De") aparece **Identificador del número de teléfono** (solo dígitos).
3. Anótalo. Es `WHATSAPP_PHONE_NUMBER_ID` (no es secreto).

### 4. 🙋 Contraseña del webhook
Inventa una frase sin espacios (por ejemplo `ramen-konoha-2026-webhook`) y guárdala. Es `WHATSAPP_VERIFY_TOKEN`.
La escribirás dos veces: en Supabase y en Meta.

### 5. 🙋 Política de privacidad publicada
Meta la exige para que la app reciba mensajes reales (Fase B). Completa en
[`borrador-politica-privacidad.md`](borrador-politica-privacidad.md) la razón social, el RIF y el contacto
(que la revise el contador o un abogado) y pídele a Claude que la publique como página de la carta
(`privacidad.html`).

---

## Fase A: instalar y probar con el número de prueba (al cierre del local, unos 40 minutos)

### A1. 🤖 Copia de seguridad antes de empezar
Claude lanza la copia de seguridad a mano y confirma que terminó en verde
(https://github.com/Ichiraku-Corp/menu-restaurante/actions/workflows/backup.yml).

### A2. 🤖 Base de datos
Claude ejecuta `supabase/whatsapp.sql` en Supabase (o lo pegas tú en
https://supabase.com/dashboard/project/krjryvtnzgwwhanmbdrn/sql/new → **Run**). Solo añade tablas,
columnas y funciones: la caja de hoy sigue igual. Se puede ejecutar más de una vez.

### A3. 🙋 Claves en Supabase
1. Abre https://supabase.com/dashboard/project/krjryvtnzgwwhanmbdrn/functions/secrets
2. **Add new secret**, una por una (nombre exacto y el valor que guardaste):

| Nombre | Valor |
|---|---|
| `WHATSAPP_TOKEN` | el token permanente (paso 1) |
| `WHATSAPP_APP_SECRET` | el secreto de la app (paso 2) |
| `WHATSAPP_PHONE_NUMBER_ID` | el identificador del número (paso 3) |
| `WHATSAPP_VERIFY_TOKEN` | la contraseña del webhook (paso 4) |

3. **Save**.

### A4. 🤖 Publicar la función `whatsapp`
Claude la publica **sin verificación de JWT** (Meta no tiene sesión de Supabase; la seguridad es la firma
de Meta). Queda en: `https://krjryvtnzgwwhanmbdrn.supabase.co/functions/v1/whatsapp`

### A5. 🙋 Conectar el webhook en Meta
1. Abre https://developers.facebook.com/apps/1677345090710756/whatsapp-business/wa-settings/
   (o el **Paso 2: Configuración de producción → Configurar webhooks** que viste antes).
2. **URL de devolución de llamada:** `https://krjryvtnzgwwhanmbdrn.supabase.co/functions/v1/whatsapp`
3. **Token de verificación:** la contraseña del paso 4.
4. **Verificar y guardar.** Si sale error, avísale a Claude (casi siempre es una letra distinta en la contraseña).
5. En **Campos del webhook**, busca **messages** → **Suscribirse**.

### A6. 🙋 Datos del bot en Gestión
Entra en Gestión → **WhatsApp** y completa:
- **Datos de pago** (pago móvil, Zelle, Binance, PayPal) → **Guardar**.
- **Zonas de delivery** con su precio → **Añadir zona**.

### A7. 🙋🤖 Prueba completa
Desde tu teléfono personal (el que agregaste como destinatario de prueba):
1. Escribe **Hola** al número de prueba de Meta → debe llegar el menú con opciones.
2. Toca **📍 Ubicación y horario** → llega la dirección y el pin.
3. Haz una **reserva** → en la caja (botón **WhatsApp → Reservas**) aparece y la confirmas.
4. Pide desde la carta. Claude te da un enlace de prueba con el botón encendido solo para ti.
   Sigue los pasos hasta **Confirmar**.
5. En caja: **Aceptar y enviar a cocina** → sale la comanda y te llega "✅ ¡Pedido confirmado!".
6. **Avisar: va en camino** → te llega el aviso.
7. Anula ese pedido de prueba en caja con el motivo "prueba".

Si todo eso funciona, la Fase A está lista. 🎉

### A8. 🤖 Unir la rama
Claude une `whatsapp-ventas` a la rama principal (con todas las pruebas en verde), y el botón WhatsApp
aparece en la caja. Mientras el número real no esté conectado, a la caja no le llega nada de clientes.

---

## Fase B: pasar al número real

### B1. 🙋 Copia de los chats del teléfono
En la app WhatsApp Business del local: **Ajustes → Chats → Copia de seguridad → Guardar**. Opcional pero
recomendado: los chats viejos no pasan a la API.

### B2. 🙋 Elegir cómo conectar el número
- **Opción A (recomendada, gratis):** el número pasa a la API y se atiende desde la **bandeja de la caja**.
  En el teléfono: WhatsApp Business → **Ajustes → Cuenta → Eliminar cuenta** (solo el número en la app,
  no tu Facebook). Espera 3 minutos.
- **Opción B:** coexistencia con un proveedor autorizado (pago mensual) para seguir usando también la
  app del teléfono. Se decide antes con Claude.

### B3. 🙋 Agregar el número a la API
1. Abre https://developers.facebook.com/apps/1677345090710756/use_cases/ → **Paso 2: Configuración de producción**.
2. **Agregar número de teléfono** → el número del local → verifica por **SMS** o **llamada**.
3. Nombre visible: **Ichiraku Ramen** (Meta lo revisa en 1 o 2 días).
4. Anota el nuevo **Identificador del número de teléfono**.

### B4. 🙋 Cambiar el identificador en Supabase
https://supabase.com/dashboard/project/krjryvtnzgwwhanmbdrn/functions/secrets → edita
`WHATSAPP_PHONE_NUMBER_ID` con el del número real → **Save**.

### B5. 🙋 Publicar la app de Meta
1. https://developers.facebook.com/apps/1677345090710756/settings/basic/ → **URL de la política de
   privacidad**: la de `privacidad.html` (paso 5) · **Categoría:** Negocios y páginas · Ícono: el logo.
2. Menú **Publicar** → **Publicar**. Desde ese momento llegan los mensajes reales.

### B6. 🤖 Encender el botón de la carta
Claude pone el número en `config.js` (`WHATSAPP_NUMBER`) y activa `WHATSAPP_ORDERS: true`. La carta
muestra **Pedir por WhatsApp · retiro o delivery**.

### B7. 🙋 Primer pedido real
Pídele a alguien de confianza que haga un pedido real desde la carta. Si llega a caja y lo aceptas, ya
está todo listo para los anuncios **Click to WhatsApp**.

---

## Si algo falla

| Síntoma | Qué revisar |
|---|---|
| Meta no deja guardar el webhook | La contraseña del webhook es distinta en Meta y en Supabase, o la función no está publicada. |
| El cliente escribe y no responde nada | Gestión → WhatsApp → **Bot encendido**; que no esté "atiende una persona" en ese chat; el campo **messages** suscrito en Meta. |
| El bot responde pero no llegan los avisos de caja | El token caducó o le faltan permisos (paso 1). En el chat de caja aparece "⚠ no se envió". |
| "Pasaron más de 24 horas" al responder | Regla de WhatsApp: solo se puede escribir libremente hasta 24 h después del último mensaje del cliente. |
| Hay que apagarlo ya | Gestión → WhatsApp → desmarcar **Bot encendido** → Guardar. Los mensajes siguen llegando a la bandeja de caja. |
