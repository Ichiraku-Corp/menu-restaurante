# Verificación en dos pasos (2FA) del panel y la gestión

El **panel de la carta** (`admin.html`) y la **gestión** (`gestion.html`) piden, después de la
contraseña, el **código de 6 dígitos** de una app del teléfono (Google Authenticator, Microsoft
Authenticator o Authy).

No es solo una pantalla: la **base de datos** entrega sueldos, ventas, costos, inventario y la edición
de la carta **únicamente** a sesiones verificadas con ese código (nivel `aal2` en `can_manage()`).
Aunque alguien robara la contraseña, sin el teléfono no ve ni cambia nada.

- La **carta pública** no cambia: los clientes la ven sin iniciar sesión.
- La **tablet de cocina** (rol «cocina») no pide código: es una cuenta compartida que no puede ver datos
  sensibles ni modificar la carta.

## Primera vez

1. Entra en `/admin.html` con tu correo y contraseña.
2. Aparece «Protege tu cuenta» con un **código QR**. En la app del teléfono: añadir cuenta → escanear.
3. Escribe el código de 6 dígitos que muestra la app → **Verificar**.

Desde entonces, cada vez que inicies sesión te pedirá el código actual de la app.

## Si pierdes el teléfono

Necesitas entrar en tu cuenta de **supabase.com** (protegida con tu propia 2FA o la de GitHub; guarda
sus códigos de recuperación). Luego, en **SQL Editor**, ejecuta cambiando el correo:

```sql
delete from auth.mfa_factors
where user_id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
```

La próxima vez que entres al panel te mostrará un QR nuevo para vincular el teléfono nuevo.

## Añadir otro administrador

1. Supabase → Authentication → Users → **Add user** (correo y contraseña).
2. SQL Editor: `insert into public.staff (email, role) values ('correo@ejemplo.com', 'admin');`
3. Esa persona, al entrar por primera vez, vinculará su propio teléfono.
