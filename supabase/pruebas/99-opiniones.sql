-- Opinión del cliente: el QR del recibo, la página opinion.html (sin sesión) y Gestión › Clientes › Opiniones
\set ON_ERROR_STOP 1
\set QUIET 1
insert into public.staff (email, role) values ('dueno@prueba.test', 'dueño') on conflict do nothing;
update public.gestion_settings set alert_emails = 'alertas@prueba.test', opinion_qr = true, opinion_google = '', opinion_alerta = true;
delete from public.pos_reports where data ->> 'kind' = 'alerta';
select coalesce((select value::text from public.pos_kv where key = 'bridge_status'), '') as bridge_antes \gset
delete from public.pos_kv where key = 'bridge_status';
select prueba.ok((select opinion_qr and opinion_alerta and opinion_google = '' from public.gestion_settings limit 1),
  'de entrada: QR en el recibo y alerta de 1–2 estrellas encendidos; enlace de Google vacío');
select (select id from public.employees where name = 'Cajera Prueba') caja, (select id from public.employees where name = 'Mesera Prueba') mesera,
       (select id from public.dishes where jsonb_array_length(coalesce(variants, '[]'::jsonb)) = 0 and available order by id limit 1) plato,
       not exists (select 1 from public.pos_sessions where status = 'abierta') hay_que_abrir \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
\if :hay_que_abrir
select public.pos_cash_open(:caja, '1111', 0, 0);
\endif

-- 1) Con el puente viejo (no avisa que sabe imprimir QR), el recibo sale como siempre
select public.pos_open(:mesera, '2222', null, 'Opinión 1') as o1 \gset
select public.pos_add(:mesera, '2222', :o1, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 1)));
select public.pos_send(:mesera, '2222', :o1);
select (public.pos_order(:o1) -> 'totals' ->> 'total')::numeric as t1 \gset
select public.pos_pay(:caja, '1111', :o1, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t1)));
reset role;
select prueba.ok((select body from public.pos_print_jobs where printer = 'caja' and body like '%RECIBO%' order by id desc limit 1) not like '%@qr%'
                 and not exists (select 1 from public.opiniones where order_id = :o1),
  'si el puente de la caja aún no sabe imprimir QR, el recibo sale sin el código (no imprime el enlace como texto)');

-- 2) Con el puente nuevo: el recibo termina con la invitación y el QR con un enlace único
insert into public.pos_kv (key, value) values ('bridge_status', '{"version": 39, "qr": true}'::jsonb)
on conflict (key) do update set value = excluded.value;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Opinión 2') as o2 \gset
select public.pos_add(:mesera, '2222', :o2, jsonb_build_array(jsonb_build_object('dish_id', :plato, 'qty', 2)));
select public.pos_send(:mesera, '2222', :o2);
select (public.pos_order(:o2) -> 'totals' ->> 'total')::numeric as t2 \gset
select public.pos_precuenta(:mesera, '2222', :o2);
select public.pos_pay(:caja, '1111', :o2, jsonb_build_array(jsonb_build_object('method', 'efectivo_usd', 'amount', :t2)));
reset role;
select prueba.ok((select body from public.pos_print_jobs where printer = 'caja' and body like '%PRECUENTA%' order by id desc limit 1) not like '%@qr%',
  'la precuenta sale sin QR: va solo en el recibo');
select token as tk from public.opiniones where order_id = :o2 \gset
select body as recibo from public.pos_print_jobs where printer = 'caja' and body like '%RECIBO%' order by id desc limit 1 \gset
select prueba.ok(:'tk' ~ '^[A-Za-z0-9_-]{12}$', 'cada recibo lleva su propio código de 12 letras, difícil de adivinar');
select prueba.ok(:'recibo' like E'@logo\n~^ICHIRAKU RAMEN\n~RECIBO%', 'el recibo empieza con el shiba, como la precuenta');
select prueba.ok(not exists (select 1 from public.pos_print_jobs where printer <> 'caja' and body like '%@logo%')
                 and not exists (select 1 from public.pos_print_jobs where body like '%@logo%' and body not like '%PRECUENTA%' and body not like '%RECIBO%'),
  'el shiba solo sale en la precuenta y el recibo: nunca en las comandas');
select prueba.ok(:'recibo' like '%~Gracias por tu visita!' || E'\n\n' || '~Como te fue? Cuentanos en 1 minuto' || E'\n' || '@qr https://ichiraku-corp.github.io/menu-restaurante/opinion.html?t=' || :'tk',
  'el recibo termina con «Como te fue?» y el QR con el enlace del pedido');
-- Volver a pasar por el recibo del mismo pedido no cambia el enlace
select prueba.ok(public.opinion_qr(:o2) like '%t=' || :'tk' and (select count(*) from public.opiniones where order_id = :o2) = 1, 'el enlace de un pedido no cambia');
-- Apagado en Gestión, o consumo de un empleado a su cuenta: sin QR
update public.gestion_settings set opinion_qr = false;
select prueba.ok(public.opinion_qr(:o1) = '' and not exists (select 1 from public.opiniones where order_id = :o1), 'si se apaga en Gestión, el recibo sale sin QR');
update public.gestion_settings set opinion_qr = true;
insert into public.pos_orders (kind, label, status, opened_by) values ('llevar', 'Consumo empleado', 'cobrada', :mesera) returning id as oe \gset
insert into public.pos_payments (order_id, method, currency, amount, amount_ref, created_by) values (:oe, 'cuenta', 'REF', 5, 5, :caja);
select prueba.ok(public.opinion_qr(:oe) = '', 'el consumo de un empleado a su cuenta no lleva QR de opinión');

-- 3) La página, sin sesión (el público)
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.ok(public.opinion_ver('noexiste1234') ->> 'estado' = 'no_existe', 'un enlace inventado no muestra nada');
select prueba.ok(public.opinion_ver(:'tk') ->> 'estado' = 'nueva' and public.opinion_ver(:'tk') ->> 'fecha' = to_char(now() at time zone 'America/Caracas', 'DD/MM/YYYY')
                 and not (public.opinion_ver(:'tk') ? 'phone'),
  'el enlace del recibo abre la opinión de esa visita, con la fecha (y nunca muestra un teléfono)');
select prueba.falla('select public.opinion_enviar(''noexiste1234'', 5)', 'no es válido', 'no se puede opinar con un enlace inventado');
select prueba.falla($$select public.opinion_enviar('$$ || :'tk' || $$', 0)$$, 'de 1 a 5', 'hay que elegir de 1 a 5 estrellas');
select prueba.falla($$select public.opinion_enviar('$$ || :'tk' || $$', 5, '', 'Ana', '12')$$, 'WhatsApp', 'un WhatsApp incompleto se rechaza');
select prueba.falla('select * from public.opiniones', 'permission denied', 'el público no puede leer las opiniones de los demás');
select prueba.falla('select public.gestion_opiniones(30)', 'permission denied', 'el público no ve el resumen de Gestión');
select prueba.falla('select public.opinion_qr(1)', 'permission denied', 'el público no puede crear enlaces');
-- 5 estrellas sin enlace de Google: se guarda y no ofrece Google
select prueba.ok((public.opinion_enviar(:'tk', 5, '  Excelente el ramen  ') -> 'google') = 'null'::jsonb, 'con 5 estrellas y sin enlace de Google en Gestión, solo se guarda');
reset role;
select prueba.ok((select rating = 5 and comment = 'Excelente el ramen' and answered_at is not null and edits = 0 from public.opiniones where token = :'tk'),
  'se guarda la calificación y el comentario (sin espacios de más)');
select prueba.ok(not exists (select 1 from public.pos_reports where data ->> 'kind' = 'alerta'), '5 estrellas no manda alerta');
update public.gestion_settings set opinion_google = 'https://g.page/r/ichiraku-prueba/review';
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.ok(public.opinion_ver(:'tk') ->> 'estado' = 'respondida' and (public.opinion_ver(:'tk') ->> 'rating')::int = 5
                 and public.opinion_ver(:'tk') ->> 'google' = 'https://g.page/r/ichiraku-prueba/review',
  'al volver a abrir el enlace ve lo que puso y, con 4–5 estrellas, el botón de reseña en Google');
-- La cambia a 2 estrellas y deja sus datos: alerta al correo con la mesa, quién atendió, el comentario y el contacto
select prueba.ok((public.opinion_enviar(:'tk', 2, 'La sopa llegó fría', 'Ana Pérez', '+58 414-123.45.67') -> 'google') = 'null'::jsonb,
  'con 2 estrellas no ofrece Google');
reset role;
select prueba.ok((select name = 'Ana Pérez' and phone = '+584141234567' and edits = 1 from public.opiniones where token = :'tk'),
  'guarda el nombre y el WhatsApp (solo números) y cuenta el cambio');
select data as alerta from public.pos_reports where data ->> 'clave' = 'opinion-' || :o2 \gset
select prueba.ok(:'alerta'::jsonb ->> 'titulo' = 'Opinión de 2 estrellas: ' || public.pos_order_label(:o2)
                 and :'alerta'::jsonb -> 'lineas' ->> 1 like 'Atendió: ' || public.pos_emp_name(:mesera) || ' · cobró ' || public.pos_emp_name(:caja)
                 and :'alerta'::jsonb -> 'lineas' ->> 2 = 'Comentario: La sopa llegó fría'
                 and :'alerta'::jsonb -> 'lineas' ->> 3 = 'Contacto: Ana Pérez · +584141234567'
                 and (select recipients from public.pos_reports where data ->> 'clave' = 'opinion-' || :o2) = 'alertas@prueba.test',
  '1–2 estrellas: alerta al correo con la mesa, quién atendió y cobró, el comentario y el contacto');
-- Un cambio sin datos conserva los anteriores; bajar de 2 a 1 no repite la alerta
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select public.opinion_enviar(:'tk', 1, 'La sopa llegó fría y tardó', '', '');
reset role;
select prueba.ok((select name = 'Ana Pérez' and phone = '+584141234567' and rating = 1 from public.opiniones where token = :'tk')
                 and (select count(*) from public.pos_reports where data ->> 'kind' = 'alerta') = 1,
  'cambiarla sin escribir los datos conserva el contacto, y no repite la alerta');
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select public.opinion_enviar(:'tk', 3, repeat('x', 900));
select prueba.falla($$select public.opinion_enviar('$$ || :'tk' || $$', 4)$$, '3 veces', 'se puede cambiar hasta 3 veces');
reset role;
select prueba.ok((select length(comment) = 500 and rating = 3 from public.opiniones where token = :'tk'), 'un comentario muy largo se corta en 500 letras');

-- 4) Con la alerta apagada no avisa; un enlace de más de 30 días vence
update public.gestion_settings set opinion_alerta = false;
select public.opinion_qr(:o1) as linea1 \gset
select token as tk1 from public.opiniones where order_id = :o1 \gset
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select public.opinion_enviar(:'tk1', 1, 'Mal');
reset role;
select prueba.ok(not exists (select 1 from public.pos_reports where data ->> 'clave' = 'opinion-' || :o1), 'con la alerta apagada en Gestión, 1 estrella no avisa');
update public.gestion_settings set opinion_alerta = true;
update public.opiniones set created_at = now() - interval '31 days' where token = :'tk1';
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select prueba.ok(public.opinion_ver(:'tk1') ->> 'estado' = 'vencida', 'después de 30 días el enlace aparece vencido');
select prueba.falla($$select public.opinion_enviar('$$ || :'tk1' || $$', 5)$$, 'venció', 'y ya no se puede opinar');
reset role;
update public.opiniones set created_at = now() - interval '2 days' where token = :'tk1';

-- Privacidad: el contacto se borra a los 12 meses (la calificación y el comentario se quedan)
insert into public.opiniones (order_id, token, created_at, rating, comment, name, phone, answered_at)
values (:oe, 'viejo0000001', now() - interval '13 months', 4, 'Rico', 'Luis', '+584120000000', now() - interval '13 months');
select public.opinion_qr(:o2);
select prueba.ok((select name = '' and phone = '' and rating = 4 and comment = 'Rico' from public.opiniones where token = 'viejo0000001')
                 and (select name = 'Ana Pérez' from public.opiniones where token = :'tk'),
  'el nombre y WhatsApp de hace más de 12 meses se borran solos; la calificación y el comentario se quedan');
delete from public.opiniones where token = 'viejo0000001';

-- 5) Gestión: solo el dueño o admin ve el resumen
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select prueba.falla('select public.gestion_opiniones(30)', 'Sin permiso', 'una tablet no ve las opiniones');
select set_config('request.jwt.claims', '{"role":"authenticated","email":"dueno@prueba.test","aal":"aal2"}', false);
select public.gestion_opiniones(30) as g \gset
reset role;
select prueba.ok((:'g'::jsonb ->> 'impresos')::int = (select count(*) from public.opiniones where created_at >= now() - interval '30 days')
                 and (:'g'::jsonb ->> 'respondidas')::int = (select count(*) from public.opiniones where created_at >= now() - interval '30 days' and rating is not null)
                 and :'g'::jsonb -> 'estrellas' = (select jsonb_agg((select count(*) from public.opiniones where created_at >= now() - interval '30 days' and rating = s) order by s) from generate_series(1, 5) s)
                 and (:'g'::jsonb ->> 'promedio')::numeric = (select round(avg(rating), 1) from public.opiniones where created_at >= now() - interval '30 days')
                 and (:'g'::jsonb ->> 'puente_qr')::boolean,
  'Gestión ve cuántos recibos llevaron QR, cuántos respondieron, el promedio y cuántas de cada estrella');
select prueba.ok(exists (select 1 from jsonb_array_elements(:'g'::jsonb -> 'lista') x
                         where (x ->> 'order_id')::bigint = :o2 and x ->> 'name' = 'Ana Pérez' and x ->> 'phone' = '+584141234567'
                           and x ->> 'mesonero' = public.pos_emp_name(:mesera) and (x ->> 'rating')::int = 3 and (x ->> 'cambios')::int = 3)
                 and exists (select 1 from jsonb_array_elements(:'g'::jsonb -> 'por_mesonero') x where x ->> 'nombre' = public.pos_emp_name(:mesera) and (x ->> 'n')::int >= 2),
  'y la lista con mesa, mesonero, contacto y cuántas veces la cambió, y el resumen por mesonero');

-- Deja el estado del puente como estaba (las pruebas que siguen no esperan el QR)
delete from public.pos_kv where key = 'bridge_status';
insert into public.pos_kv (key, value) select 'bridge_status', nullif(:'bridge_antes', '')::jsonb where :'bridge_antes' <> '';

\echo 'TODAS LAS PRUEBAS DE OPINIONES PASARON'
