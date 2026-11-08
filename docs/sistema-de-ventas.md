# Sistema de ventas de Ichiraku (sala y caja)

Sustituye al sistema anterior para **pedidos por mesa, comandas en cocina, precuentas, cobro y cierre
de caja**. La factura fiscal se hace a mano hasta que llegue la factura electrónica del SENIAT
(diciembre).

| Pieza | Dónde | Para qué |
|---|---|---|
| `pos.html` | Tablets de las meseras y la laptop de caja (navegador) | Mesas, pedidos, cobro y caja |
| `supabase/pos.sql` | Supabase → SQL Editor | Base de datos y reglas |
| `puente/` | Laptop de caja (Windows), siempre encendida | Imprime en cocina y caja; trae la tasa del euro BCV |
| Gestión → Nómina | Dueño | PIN de 4 dígitos de cada persona |

## Cómo funciona

- **Áreas:** Feria (mesas 1–20), Tokio (1–8) y Edo (1–5), más **Para llevar** y **Delivery** (nombre,
  teléfono, dirección y costo del delivery; sin 10 %).
- **Por cobrar:** todas las mesas abiertas con lo que falta, cuáles **pidieron la cuenta** (precuenta
  impresa) y cuáles abonaron.
- **Dividir la cuenta:** en el cobro, «Dividir cuenta» entre N personas; cada una paga con su método
  («Cobrar solo esta parte») y la mesa sigue abierta hasta completar. Una cuenta con abonos no se puede anular.
- **Agotados:** Caja → «Platos agotados»; desaparecen de la carta y nadie puede pedirlos.
- **Conteo de inventario:** Caja → «Conteo de inventario» (lo contado reemplaza el stock del sistema).
- Cada persona entra con **su PIN**; todas pueden tomar pedidos y cobrar. Todo queda registrado con su nombre.
- **Enviar a cocina** imprime la comanda en cocina. Lo que ya está en cocina solo se puede **anular
  con motivo**; el motivo sale en el **cierre de caja**. Igual con los **descuentos**.
- **Precuenta** y **recibo** salen en la impresora de caja (no son factura fiscal).
- **Cobro:** efectivo $, efectivo Bs, pago móvil, punto (débito/crédito), Zelle, Binance y PayPal,
  mezclados como haga falta. Las divisas cuentan 1 a 1 con el precio Ref; los bolívares a la **tasa
  del euro BCV** del día. El vuelto se da en $ o en Bs.
- **Servicio 10 %** solo en mesa (no en para llevar).
- **Caja:** se abre con el fondo en efectivo y se cierra escribiendo lo contado por método. El cierre
  se imprime con diferencias, anulaciones y descuentos, y las ventas pasan solas a **Gestión → Ventas**
  y al **inventario**.
- **Cierre por correo:** al cerrar caja, el puente envía un reporte detallado (métodos y arqueo, áreas,
  meseras, horas, platos, anulaciones, descuentos y cada pedido) a los correos de Gestión → Ventas →
  Ajustes. Necesita en `config.json` una cuenta de Gmail con **contraseña de aplicación** (`correo`).
- La tablet se **bloquea** sola a los 3 minutos sin uso.
- Necesita internet. Si se cae, se anota en papel y se carga al volver.

## Instalación (una sola vez)

1. **Supabase → SQL Editor:** ejecutar `supabase/gestion.sql` y luego `supabase/pos.sql`.
2. **Cuentas** (Authentication → Users → Add user, con «Auto Confirm User»):
   - cuenta de **sala** → `insert into public.staff (email, role) values ('correo-sala', 'sala');`
   - cuenta de **impresora** → `insert into public.staff (email, role) values ('correo-impresora', 'impresora');`
3. **PIN** de cada persona: Gestión → Nómina → editar → «PIN del sistema de ventas».
4. **Laptop de caja:**
   1. Instalar **Node.js LTS** desde nodejs.org (instalador de Windows, todo «Siguiente»).
   2. Copiar la carpeta `puente` a `C:\Ichiraku\puente` y poner `config.json` (correo y contraseña de
      la cuenta impresora e IP de cada impresora).
   3. Doble clic en **`probar-impresoras.bat`**: debe salir un papel en cocina y otro en caja.
   4. Doble clic en **`iniciar.bat`** y dejar la ventana abierta (se puede minimizar).
   5. Para que arranque solo: `Win + R` → `shell:startup` → pegar ahí un acceso directo a `iniciar.bat`.
   6. En la configuración de energía: que la laptop **no se suspenda** con la tapa cerrada ni por inactividad.
5. **Tablets y caja:** abrir `https://ichiraku-corp.github.io/menu-restaurante/pos.html` en Chrome →
   menú ⋮ → **Añadir a pantalla de inicio**. La primera vez se activa con la cuenta de sala.

## Si algo falla

- **«La impresión está atrasada»:** la laptop de caja está apagada, sin internet o con el puente
  cerrado. Revisar la ventana del puente y `puente.log`.
- **Una impresora no imprime:** comprobar que está encendida, con papel y con el cable de red puesto;
  la laptop debe estar en la misma red (cocina 192.168.1.100, caja 192.168.0.20).
- **Sin tasa del día:** Caja → «Escribir tasa» (la del euro BCV).
- **Alguien olvidó su PIN:** el dueño le pone uno nuevo en Gestión → Nómina.
