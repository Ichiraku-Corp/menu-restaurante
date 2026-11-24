-- ============================================================================
-- Misiones elegidas por Edgar (documento «100 misiones de Shibu», 24/11/2026)
-- Prende las que aprobó, con sus cambios («Tu versión», nivel y días), dice para quién es cada una (meseras, cajeras o
-- todas), deja la de la tienda como la extra de todos los días, suma la #101 que pidió (equipo +50 %) y elige el plato
-- de la semana (Tonkotsu). Las rechazadas y las pendientes quedan apagadas.
-- Corre una sola vez (queda la marca «misiones_elegidas» en pos_kv): si después se cambia algo desde Gestión, volver a
-- aplicar los archivos no lo deshace.
-- Esperan a una versión siguiente (aprobadas, pero todavía apagadas):
--   #70 y #71 (opiniones de 5 estrellas): Edgar las quiere en una sección de misiones SEMANALES con metas acumulables.
--   #80 (ninguna anulación por error al anotar): falta que al anular se diga si fue un error al anotar.
-- ============================================================================
do $$
begin
  if exists (select 1 from public.pos_kv where key = 'misiones_elegidas') then return; end if;

  -- 1) Lo que Edgar cambió (texto, nivel, días o meta) y las que ahora se pueden medir
  update public.mis_catalogo k set texto = x.texto, nivel = x.nivel, dias = x.dias, tipo = x.tipo, params = x.params::jsonb, updated_at = now()
  from (values
    (1,  'Cierra 3 comandas de $30 o más', 1, 'todos', 'comandas', '{"n": 3, "monto": 30}'),
    (2,  'Cierra 4 comandas de $30 o más', 2, 'todos', 'comandas', '{"n": 4, "monto": 30}'),
    (3,  'Cierra 5 comandas de $30 o más', 3, 'todos', 'comandas', '{"n": 5, "monto": 30}'),
    (5,  'Cierra 3 comandas de $50 o más', 3, 'todos', 'comandas', '{"n": 3, "monto": 50}'),
    (20, 'Comanda promedio de $20 o más (mínimo 8 comandas)', 2, 'todos', 'promedio', '{"monto": 20, "minimo": 8}'),
    (23, 'Cierra una comanda con 8 platos o más', 1, 'todos', 'platos_comanda', '{"n": 1, "platos": 8}'),
    (24, 'Cierra 3 comandas con 5 platos o más', 1, 'normales', 'platos_comanda', '{"n": 3, "platos": 5}'),
    (29, 'Vende 4 postres en una misma comanda', 1, 'todos', 'comandas_con', '{"n": 1, "con": "postres", "min": 4}'),
    (33, 'Vende 30 bebidas', 3, 'fuertes', 'unidades', '{"n": 30, "cat": "Bebidas"}'),
    (34, 'En 5 comandas, vende bebida junto al ramen', 1, 'todos', 'comandas_con', '{"n": 5, "con": "bebida_ramen"}'),
    (40, 'Vende 6 Gyozas', 1, 'normales', 'unidades', '{"n": 6, "nombres": ["Gyozas"]}'),
    (41, 'Vende 10 Gyozas', 2, 'todos', 'unidades', '{"n": 10, "nombres": ["Gyozas"]}'),
    -- la favorita de Edgar: sale el 40 % de los días
    (43, '5 comandas completas en el día: entrada, ramen, bebida y postre', 2, 'todos', 'comandas_con', '{"n": 5, "con": "completa", "frecuencia": 40}'),
    (44, '10 comandas completas en el día', 3, 'todos', 'comandas_con', '{"n": 10, "con": "completa"}'),
    (45, 'Postre en la mitad de tus comandas (mínimo 6)', 3, 'flojos', 'proporcion', '{"con": "postre", "pct": 50, "minimo": 6}'),
    (46, 'Vende 4 ramen grandes', 1, 'todos', 'unidades', '{"n": 4, "cat": "Ramen", "grande": true}'),
    (58, 'Vende 3 artículos de la tienda del menú', 1, 'todos', 'unidades', '{"n": 3, "cat": "Tienda"}'),
    (62, 'Registra 7 clientes nuevos', 2, 'todos', 'clientes_nuevos', '{"n": 7}'),
    (63, 'Atiende a 2 clientes que vuelven', 1, 'todos', 'vuelven', '{"n": 2}'),
    (64, 'Atiende a 5 clientes que vuelven', 2, 'todos', 'vuelven', '{"n": 5}'),
    (65, 'Atiende a un cliente que viene por 5.ª vez o más', 2, 'todos', 'vuelven', '{"n": 1, "visitas": 5}'),
    (69, 'Consigue 1 opinión de 5 estrellas', 1, 'todos', 'opiniones', '{"n": 1, "estrellas": 5}'),
    (72, 'Que un cliente te nombre en su opinión', 3, 'todos', 'nombrada', '{"n": 1}'),
    (73, 'Ninguna opinión de 3 estrellas o menos en tus mesas (mínimo 2)', 2, 'todos', 'sin_quejas', '{"minimo": 2}'),
    (76, 'En 10 mesas, manda la comanda a cocina antes de 5 minutos', 2, 'todos', 'rapidas', '{"n": 10, "minutos": 5}'),
    (77, 'En 15 mesas, manda la comanda antes de 5 minutos', 3, 'fuertes', 'rapidas', '{"n": 15, "minutos": 5}'),
    (83, 'Mesa express: de abrir a cobrar en menos de 30 minutos, 3 veces', 1, 'normales', 'express', '{"n": 3, "minutos": 30}'),
    (86, 'Equipo: el local llega a la meta del día', 1, 'todos', 'equipo_meta', '{"pct": 100}'),
    (87, 'Equipo: el local pasa la meta del día por 20 %', 2, 'todos', 'equipo_meta', '{"pct": 120}'),
    (91, 'Racha: 3 días seguidos cumpliendo la misión fácil', 2, 'todos', 'racha', '{"dias": 3, "nivel": 1}'),
    (92, 'Racha: 5 días seguidos con al menos una misión', 3, 'todos', 'racha', '{"dias": 5}'),
    (94, 'Vende más que ayer', 3, 'todos', 'vs_ayer', '{}'),
    (97, 'Cierre de caja con diferencia menor a Ref 1', 2, 'todos', 'cierre_cuadrado', '{"monto": 1}')
  ) x(numero, texto, nivel, dias, tipo, params)
  where k.numero = x.numero;

  -- 2) La que Edgar pidió agregar
  insert into public.mis_catalogo (numero, texto, nivel, dias, tipo, params)
  values (101, 'Equipo: el local pasa la meta del día por 50 %', 3, 'todos', 'equipo_meta', '{"pct": 150}')
  on conflict (numero) do nothing;

  -- 3) Para quién es: las de caja (cobrar, delivery, para llevar, cierre) para las cajeras; las de equipo, rachas, clientes
  --    nuevos y la extra de la tienda para todas; las demás (lo que cada una anota) para las meseras
  update public.mis_catalogo set para = case
      when numero in (75, 96, 97, 98, 99, 100) then 'cajeras'
      when numero in (58, 61, 62, 86, 87, 88, 89, 90, 91, 92, 93, 101) then 'todas'
      else 'meseras' end
  where numero is not null;

  -- 4) La extra de todos los días: vender artículos de la tienda del menú (la #58)
  update public.mis_catalogo set extra = (numero = 58) where numero is not null;

  -- 5) Prendidas: las aprobadas (menos las que esperan: #70, #71 y #80), si ya se pueden medir
  update public.mis_catalogo set activa = (numero in (
      1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
      26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 40, 41, 42, 43, 44, 45,
      46, 47, 48, 52, 53, 54, 55, 56, 58, 59, 60,
      61, 62, 63, 64, 65, 69, 72, 73, 75,
      76, 77, 83,
      86, 87, 88, 89, 91, 92, 94, 101,
      97, 98, 99) and public.mis_tipo_medible(tipo)), updated_at = now()
  where numero is not null;

  -- 6) El plato de la semana (para las #52 y #53)
  insert into public.pos_kv (key, value) values ('misiones', '{"plato_semana": "Tonkotsu"}')
  on conflict (key) do update set value = coalesce(public.pos_kv.value, '{}'::jsonb) || '{"plato_semana": "Tonkotsu"}', updated_at = now();

  insert into public.pos_kv (key, value) values ('misiones_elegidas', jsonb_build_object('fecha', '2026-11-24', 'documento', '100 misiones de Shibu'));
end $$;
