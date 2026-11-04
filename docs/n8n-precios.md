# Precios automáticos de proveedores con n8n

El sistema ya está listo para recibir precios. Falta montar n8n y conectarlo.

## Cómo decide el sistema

Cada precio nuevo entra por la función `propose_price` de Supabase:

| Caso | Resultado |
|---|---|
| El costo por kg / L / unidad cambia **hasta el 5 %** (configurable en Gestión → Insumos) | Se aplica solo |
| Cambia **más del 5 %** | Queda **pendiente** en Gestión → Insumos para aprobar o rechazar |
| Cambia el tipo de unidad (p. ej. de kg a unidades) | Queda **pendiente** |
| Es el primer precio del insumo | Se aplica solo |

Todo cambio aplicado queda en «Últimos cambios de precio», con su origen.

## Llamada que hace n8n

Nodo **HTTP Request**:

- **Método:** `POST`
- **URL:** `https://krjryvtnzgwwhanmbdrn.supabase.co/rest/v1/rpc/propose_price`
- **Cabeceras:**
  - `apikey`: la *service_role key*
  - `Authorization`: `Bearer <service_role key>`
  - `Content-Type`: `application/json`
- **Cuerpo:**

```json
{
  "p_ingredient": "Pechuga de pollo",
  "p_buy_price": 12.5,
  "p_buy_qty": 2,
  "p_buy_unit": "kg",
  "p_supplier": "Avícola Central",
  "p_source": "n8n",
  "p_raw": "Buenos días, la pechuga está a 12,50 los 2 kg"
}
```

- `p_ingredient`: nombre exacto del insumo (sin importar mayúsculas) o su número.
- `p_buy_unit`: `kg`, `g`, `l`, `ml` o `unidad`.
- `p_supplier`: opcional, nombre o número del proveedor.
- `p_raw`: opcional, el mensaje original, para revisarlo si queda pendiente.

**Respuesta:** `{"id": 7, "status": "applied" | "pending", "change_pct": 3.2, "reason": "..."}`.
Si el insumo no existe, devuelve un error con el texto «Insumo no encontrado».

> ⚠️ La *service_role key* (Supabase → Project Settings → API) salta todos los permisos.
> Guárdala **solo** en las credenciales de n8n. Nunca en este repositorio ni en una página web.

## Flujo propuesto en n8n

1. **Schedule** (p. ej. lunes 8:00) → lee los proveedores activos y sus insumos
   (`GET /rest/v1/suppliers?active=eq.true` y `GET /rest/v1/ingredients?supplier_id=eq.<id>`).
2. **WhatsApp Business Cloud API** → envía a cada proveedor una plantilla aprobada por Meta:
   «Hola, ¿nos confirmas los precios de esta semana? Pollo (kg), Huevos (cartón)…».
3. **Webhook de WhatsApp** → recibe la respuesta.
4. **Lectura del mensaje** (un nodo de IA o expresiones) → lo convierte en
   `{insumo, precio, cantidad, unidad}` por cada línea.
5. **HTTP Request** → llama a `propose_price` por cada insumo.
6. **Aviso** (opcional) → si alguno quedó `pending`, te manda un WhatsApp o un correo para que
   entres a aprobarlo.

## Requisitos de WhatsApp

- Un número de **WhatsApp Business** registrado en la **API oficial de Meta (Cloud API)**.
  Automatizar un WhatsApp normal va contra sus normas y puede bloquear el número.
- Los mensajes que inicia el negocio usan **plantillas** aprobadas por Meta y tienen un costo
  pequeño por conversación.
