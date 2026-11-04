# Asistencia (reconocimiento facial) y ventas diarias con n8n

El sistema ya está listo para recibir marcaciones y ventas. Falta montar n8n y conectarlo.
Para las credenciales, usa la *service_role key* igual que en [`n8n-precios.md`](n8n-precios.md),
guardada solo dentro de n8n.

## 1. Asistencia

### Qué guarda el sistema

Solo **quién marcó y a qué hora**. Las caras y las huellas se quedan en el equipo; nunca se
envían a Supabase. Conviene tener el **consentimiento por escrito** de cada empleado para el
registro biométrico.

En **Gestión → Nómina**, cada empleado necesita:

- su **horario fijo** (días y horas de entrada y salida), y
- su **nº de empleado en el equipo facial** (el *Employee No.* con que se registró en el equipo).

### Reglas (editables en Gestión → Ventas → Ajustes)

- **Tolerancia:** 5 minutos. Si llega más tarde, cuentan todos los minutos de retraso.
- **Falta:** día del horario sin ninguna marcación → se descuenta el día completo.
- **Retraso:** se descuentan los minutos tarde.
- **Horas extra:** lo que se queda después de su hora de salida (más de la tolerancia), y los días
  libres trabajados, se pagan a **1,5 ×** la hora normal.
- **Valor de la hora:** sueldo mensual ÷ horas de su horario en el mes (semanas × 52 ÷ 12).
- La primera marcación del día es la **entrada** y la última, la **salida**. Si solo hay una, se
  marca «sin salida» para revisar y no se descuenta nada.
- Hora de Venezuela (America/Caracas).

### Llamada que hace n8n por cada marcación

`POST https://krjryvtnzgwwhanmbdrn.supabase.co/rest/v1/rpc/record_attendance`
(cabeceras `apikey`, `Authorization: Bearer …` y `Content-Type: application/json`, como en precios)

```json
{ "p_employee": "7", "p_time": "2026-11-03T12:08:00-04:00", "p_source": "hikvision", "p_device": "Entrada" }
```

- `p_employee`: el nº de empleado del equipo (también vale el nombre exacto).
- `p_time`: fecha y hora **con zona horaria**.
- Si la misma marcación llega dos veces, no se duplica (`"duplicate": true`).

### Equipo Hikvision DS-K1T321MFWX-B

Según su ficha técnica oficial: reconocimiento facial, huella, tarjeta M1 y PIN; 500 caras,
3.000 huellas, 150.000 eventos; antisuplantación; menú en español; **ISAPI, ISUP 5.0 y Push SDK**;
función de asistencia (también en modo «solo asistencia»).

**Instalación**

- Alimentación **12 VDC** (≤ 6 W), **no PoE**: adaptador de 12 V / 1 A (comprobar si viene incluido).
- Conectarlo al router **con cable de red (RJ-45)**. El wifi de la ficha es «modo AP» (para
  configurarlo), no está garantizado que se una a la red del local.
- Uso en interior, a la altura de la cara (reconoce entre 0,3 y 1,5 m).
- Registrar a cada empleado con su **Employee No.** y poner ese mismo número en
  Gestión → Nómina → «Nº de empleado en el equipo facial».

**Conexión con n8n en la nube**

El equipo está dentro de la red del local; n8n en la nube no puede consultarlo sin abrir puertos
del router (no recomendado). Por eso:

1. **Primero probar el envío desde el equipo:** en su configuración web, en el apartado de envío de
   eventos (*HTTP Listening* / *Event upload*, según el firmware), poner la URL del **Webhook** de
   n8n. Si el equipo acepta una URL HTTPS de internet, cada marcación llegará sola y n8n la
   reenvía a `record_attendance` (campo `employeeNoString` y la hora del evento).
2. **Si no acepta HTTPS:** poner un puente en el local (por ejemplo una Raspberry Pi) que reciba
   los eventos del equipo por la red local y los reenvíe a n8n en la nube o directamente a
   `record_attendance`.

## 2. Ventas diarias

Al cierre de cada día, n8n lee el reporte del sistema de ventas y llama a:

`POST https://krjryvtnzgwwhanmbdrn.supabase.co/rest/v1/rpc/upsert_daily_sales`

```json
{
  "p_date": "2026-11-03",
  "p_total": 520.00,
  "p_service": 52.00,
  "p_methods": { "debito": 300, "credito": 100, "pago_movil": 80, "efectivo": 40, "otros": 0 },
  "p_tickets": 41,
  "p_items": [
    { "name": "Hokage", "variant": "", "qty": 3, "amount": 75 },
    { "name": "Pollo Saiyan", "variant": "Gr", "qty": 4, "amount": 60 }
  ],
  "p_source": "n8n"
}
```

- `p_total` y `p_methods` van **sin** el 10 % de servicio; el servicio va en `p_service`.
- Si se envía otra vez el mismo día, **reemplaza** los datos de ese día (no duplica).
- Los platos se enlazan solos con la carta si el nombre coincide; si no, aparecen marcados como
  «no está en la carta» en Gestión → Ventas.

Con esto, **Gestión → Ventas** calcula:

- comisiones del banco estimadas (débito 1,75 %, crédito 4 %, pago móvil 1,9 %; editables),
- el reparto del servicio (85 % local, 15 % personal; editable),
- el costo de insumos de lo vendido, según las recetas cargadas,
- y el **resultado del mes**: ventas + servicio del local − comisiones − insumos − nómina y gastos.

Mientras no esté n8n, los días se pueden cargar a mano con «+ Día».
