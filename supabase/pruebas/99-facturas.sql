-- Fotos de facturas: la tablet sube la foto y la registra con la salida o la mercancía; solo el dueño las ve
\set ON_ERROR_STOP 1
\set QUIET 1
select (select id from public.employees where name = 'Cajera Prueba') caja, (select min(id) from public.ingredients) ing,
       not exists (select 1 from public.pos_sessions where status = 'abierta') hay_que_abrir \gset
-- Lo que en Supabase ya tiene la cuenta con sesión sobre storage.objects
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;
grant usage, select on all sequences in schema storage to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif
select prueba.falla(format('select public.pos_cash_out(%s, %L, %L, 5, %L, %L)', :caja, '1111', 'efectivo_usd', 'Compra de hielo', '../otra/cosa.jpg'), 'no es válida', 'no acepta cualquier ruta como foto');
select public.pos_cash_out(:caja, '1111', 'efectivo_usd', 5, 'Compra de hielo', '2026-11/0123456789abcdef0123456789abcdef.jpg');
select public.pos_cash_out(:caja, '1111', 'efectivo_usd', 2, 'Propina delivery');
select public.pos_purchase(:caja, '1111', jsonb_build_array(jsonb_build_object('id', :ing, 'qty', 2)), '2026-11/fedcba9876543210fedcba9876543210.jpg');
insert into storage.objects (bucket_id) values ('facturas');
select prueba.ok((select count(*) from storage.objects where bucket_id = 'facturas') = 0, 'la tablet sube la foto pero no puede verla');
select prueba.falla('insert into storage.objects (bucket_id) values (''dishes'')', 'row-level security', 'la tablet no puede subir fotos a la carta');
select prueba.falla('select public.gestion_facturas(30)', 'Sin permiso', 'la tablet no ve la lista de facturas');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_facturas(30) as f \gset
select prueba.ok(exists (select 1 from jsonb_array_elements(:'f'::jsonb) e where e ->> 'kind' = 'salida' and e -> 'detalle' ->> 'motivo' = 'Compra de hielo'
                         and (e -> 'detalle' ->> 'monto')::numeric = 5 and e ->> 'por' = 'Cajera'), 'el dueño ve la salida con su motivo, monto y quién la hizo');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'f'::jsonb) e where e ->> 'kind' = 'compra' and jsonb_array_length(e -> 'detalle' -> 'insumos') = 1), 'y la mercancía que llegó con su foto');
select prueba.ok(not exists (select 1 from jsonb_array_elements(:'f'::jsonb) e where e -> 'detalle' ->> 'motivo' = 'Propina delivery'), 'una salida sin foto no aparece en la lista');
select prueba.ok((select count(*) from storage.objects where bucket_id = 'facturas') >= 1, 'el dueño sí ve las fotos');
reset role;
select set_config('request.jwt.claims', '', false);
\echo 'TODAS LAS PRUEBAS DE FACTURAS PASARON'
