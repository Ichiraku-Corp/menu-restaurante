# Nex: asistente de cocina por voz

Nex vive en una tablet de la cocina (`cocina.html`). El personal le habla y ella:

- registra **mermas** («se quemaron dos kilos de pollo») y **conteos** de inventario,
- responde **cuánto queda** de un insumo y **qué falta comprar**,
- dice las **cantidades de una receta** («¿cuánto pollo lleva el Kyojuro grande?»),
- **anula** el último registro de esa persona si se equivocó.

Todo queda en Gestión → Inventario, con quién lo reportó y el origen «nex».

## Cómo funciona

```
Tablet (cocina.html)  ──voz→texto (Chrome)──▶  función «nex» (Supabase)  ──▶  Claude Opus 5.5
        ▲                                             │  acciones: register_movement, stock, recetas
        └──────────── respuesta hablada ◀─────────────┘
```

- La **clave de Claude** está solo en la función de Supabase, nunca en la tablet.
- La tablet entra con una **cuenta de rol «cocina»**: puede usar a Nex, pero no ve sueldos, ventas ni
  costos.
- El reconocimiento de voz y la voz de Nex son los del navegador (gratis). Usar **Chrome** en la tablet.
- Mientras no haya reconocimiento facial, cada persona **toca su nombre** antes de hablar.
- La conversación se reinicia tras 3 minutos sin uso o al cambiar de persona.

## Puesta en marcha

1. **Base de datos:** ejecuta de nuevo `supabase/gestion.sql` en Supabase → SQL Editor.
2. **Clave de Claude:** en [console.anthropic.com](https://console.anthropic.com) crea una API key
   (y, si quieres, un límite de gasto mensual).
3. **Secreto en Supabase:** Edge Functions → **Secrets** → añade `ANTHROPIC_API_KEY` con esa clave.
4. **Publicar la función:** Edge Functions → **Deploy a new function** → nombre `nex` → pega el
   contenido de `supabase/functions/nex/index.ts` → Deploy.
   (Con la CLI: `supabase functions deploy nex`.)
5. **Cuenta de la tablet:** Authentication → Users → Add user (por ejemplo `cocina@…` con contraseña)
   y luego, en SQL Editor:
   ```sql
   insert into public.staff (email, role) values ('cocina@tu-dominio.com', 'cocina');
   ```
6. **Tablet:** abre `https://ichiraku-corp.github.io/menu-restaurante/cocina.html` en Chrome, entra con
   esa cuenta, permite el micrófono y añádela a la pantalla de inicio.

Para que Nex sea útil, los insumos deben tener **stock y mínimo** cargados (Gestión → Insumos e
Inventario) y los platos sus **recetas**.

## Modelo y costo

- Modelo: **Claude Opus 5.5**, con esfuerzo bajo para respuestas rápidas y las instrucciones fijas en
  caché (más barato).
- Si un filtro de seguridad rechazara una petición, la API la reintenta sola con el modelo de respaldo
  recomendado (`fallbacks: "default"`).
- Estimación: unos 45–110 $ al mes con ~100 mensajes al día. Se paga por uso.

## Personalidad

`SYSTEM_PROMPT` en `supabase/functions/nex/index.ts` tiene una personalidad provisional (maid alegre y
motivadora). Se sustituirá por la ficha y la historia oficial de Nex. El avatar de `cocina.html` también
es provisional hasta tener su modelo Live2D.

## Pruebas

`supabase/functions/tests/nex_test.ts` prueba la función sin red (Claude y Supabase simulados):

```bash
deno test --allow-env supabase/functions/tests/nex_test.ts
```
