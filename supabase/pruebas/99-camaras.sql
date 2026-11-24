-- Cámaras: el dueño las carga en Gestión, Nex pide fotos, el puente las toma y las sube, y se borran solas.
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño'), ('puente@prueba.test', 'impresora'), ('tablet@prueba.test', 'sala') on conflict do nothing;

-- 1) Solo el dueño las ve y las carga
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_camaras()', 'Sin permiso', 'la tablet no ve las cámaras');
select prueba.falla('select public.cam_pedir_foto(1)', 'Sin permiso', 'la tablet no puede pedir fotos');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_camara_guardar(null, 'Cocina', 'cocina', 1, true, false, 'Que la cocina esté limpia y ordenada', null) as cocina \gset
select public.gestion_camara_guardar(null, 'Caja', 'caja', 2, true, true, '', null) as caja \gset
select prueba.falla($q$select public.gestion_camara_guardar(null, 'Otra', 'salon', 2, true, true, '', null)$q$, 'Ya hay una cámara en el canal 2', 'dos cámaras no pueden tener el mismo canal');
select prueba.falla($q$select public.gestion_camara_guardar(null, 'Otra', 'salon', 0, true, true, '', null)$q$, 'El canal va del 1 al 64', 'el canal es el número de la cámara en el grabador');
select prueba.falla($q$select public.gestion_camara_guardar(null, 'Otra', 'salon', 3, true, true, '', 5)$q$, 'de 15 minutos a 24 horas', 'la revisión automática no puede ser cada 5 minutos');

-- 2) El dueño pide una foto de prueba; pedirla otra vez enseguida no repite
select public.cam_pedir_foto(:cocina, 'prueba', 'normal', 'Edgar') as f1 \gset
select public.cam_pedir_foto(:cocina, 'prueba', 'normal', 'Edgar') as f1b \gset
reset role;
select prueba.ok(:f1 = :f1b, 'pedir la misma foto dos veces seguidas no repite la petición');

-- 3) El puente: ve lo pendiente, guarda cómo está el grabador (sin la clave) y sube la foto
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select public.cam_pendientes('{"marca": "hikvision", "host": "192.168.1.64", "clave": "secreta", "ok": true}'::jsonb) as pend \gset
reset role;
select prueba.ok(exists (select 1 from jsonb_array_elements(:'pend'::jsonb) e where (e ->> 'id')::bigint = :f1 and (e ->> 'canal')::int = 1),
  'el puente ve la foto pendiente con el canal 1 del grabador');
select prueba.ok((select value ->> 'marca' from public.pos_kv where key = 'camaras_estado') = 'hikvision'
  and (select value from public.pos_kv where key = 'camaras_estado') ? 'at' and not ((select value from public.pos_kv where key = 'camaras_estado') ? 'clave'),
  'queda anotado que el puente ve el grabador, sin guardar la clave');
set role authenticated;
select prueba.falla(format('select public.cam_foto_lista(%s, %L)', :f1, '../../otra-cosa.jpg'), 'Ruta de foto no válida', 'una ruta rara no se acepta');
select public.cam_foto_lista(:f1, '2026-11/' || :f1 || '-0a1b2c3d4e5f.jpg', 182000, '');
select prueba.falla(format('select public.cam_foto_lista(%s, %L)', :f1, '2026-11/' || :f1 || '-0a1b2c3d4e5f.jpg'), 'ya no está pendiente', 'la misma foto no se anota dos veces');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.cam_foto_lista(%s, %L)', :f1, 'x'), 'Sin permiso', 'una tablet no puede hacerse pasar por el puente');
select prueba.falla('select public.cam_pendientes()', 'Sin permiso', 'ni ver lo pendiente');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_camaras() as g \gset
reset role;
select prueba.ok(:'g'::jsonb -> 'camaras' -> 0 ->> 'nombre' = 'Cocina' and :'g'::jsonb -> 'camaras' -> 0 -> 'ultima' ->> 'path' like '2026-11/%'
  and :'g'::jsonb -> 'estado' ->> 'host' = '192.168.1.64', 'Gestión muestra las cámaras con su última foto y que el puente ve el grabador');

-- 4) Nex (service_role): pide, anota lo que vio; las fotos de hace menos de 15 s se reutilizan
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select public.cam_pedir_foto(:cocina, 'nex', 'normal', 'Nex') as f2 \gset
select prueba.ok(:f2 = :f1, 'si hay una foto de hace segundos, Nex usa esa (no pide otra)');
select public.cam_anotar(:f1, '¿Está limpia la cocina?', 'La cocina está ordenada; hay una olla en el piso junto a la nevera.', true, 'Nex') as o1 \gset
select prueba.ok((select camara_id from public.cam_observaciones where id = :o1) = :cocina, 'lo que Nex vio queda anotado con su cámara');
select public.cam_pedir_foto(:caja, 'nex', 'alto', 'Nex') as f3 \gset
select prueba.ok((select detalle from public.cam_fotos where id = :f3) = 'alto', 'Nex puede pedir la foto con más detalle');
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla(format('select public.cam_anotar(%s, %L, %L)', :f1, 'x', 'y'), 'Sin permiso', 'solo Nex anota lo que vio');
reset role;

-- 5) Revisión automática, fotos vencidas y el tope por hora
update public.cam_camaras set revisar_cada_min = 30 where id = :cocina;
update public.cam_fotos set pedida_at = now() - interval '3 minutes' where id = :f3;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select public.cam_pendientes() as p2 \gset
select public.cam_pendientes() as p3 \gset
reset role;
select prueba.ok((select count(*) from public.cam_fotos where camara_id = :cocina and motivo = 'revision') = 1,
  'la cámara con revisión cada 30 minutos pide una foto sola (y una sola vez)');
select prueba.ok((select error from public.cam_fotos where id = :f3) = 'El puente no la tomó a tiempo', 'una foto que nadie tomó en 2 minutos se vence');
insert into public.cam_fotos (camara_id, motivo, pedida_at, lista_at, error) select :caja, 'prueba', now() - interval '10 minutes', now(), 'x' from generate_series(1, 60);
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select prueba.falla(format('select public.cam_pedir_foto(%s)', :caja), 'Ya se pidieron 60 fotos', 'hay un tope de 60 fotos por hora (cuida el costo)');
select set_config('request.jwt.claims', '', false);

-- 6) Limpieza: a los 7 días se borran; las que tienen alerta duran 30
insert into public.cam_fotos (camara_id, pedida_at, lista_at, path) values (:caja, now() - interval '8 days', now() - interval '8 days', '2026-11/9001-aaaaaaaa.jpg') returning id as vieja \gset
update public.cam_fotos set pedida_at = now() - interval '8 days' where id = :f1;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"puente@prueba.test"}', false);
select public.cam_viejas() as v \gset
reset role;
select prueba.ok(exists (select 1 from jsonb_array_elements(:'v'::jsonb) e where (e ->> 'id')::bigint = :vieja)
  and not exists (select 1 from jsonb_array_elements(:'v'::jsonb) e where (e ->> 'id')::bigint = :f1),
  'una foto de hace 8 días se borra, pero la que tiene una alerta de Nex se guarda 30 días');
set role authenticated;
select public.cam_borradas(array[:vieja]::bigint[]) as nb \gset
reset role;
select prueba.ok(:nb = 1 and (select path is null and borrada_at is not null from public.cam_fotos where id = :vieja), 'la foto borrada queda anotada sin ruta');
select prueba.ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'camaras%') = 3,
  'el bucket «camaras» tiene sus reglas: el puente sube y borra, el dueño ve');
select set_config('request.jwt.claims', '', false);
rollback;
\echo TODAS LAS PRUEBAS DE CÁMARAS PASARON
