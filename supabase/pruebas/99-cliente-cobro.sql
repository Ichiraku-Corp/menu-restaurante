-- Datos del cliente al cobrar: sin cédula, el teléfono reconoce al cliente que ya vino (no se duplica).
-- Todo en una transacción que se deshace al final.
\set ON_ERROR_STOP 1
\set QUIET 1
begin;
select (select id from public.employees where name = 'Mesera Prueba') mesera \gset
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"tablet@prueba.test"}', false);
select public.pos_open(:mesera, '2222', null, 'Cliente 1') as o1 \gset
select public.pos_set_customer(:mesera, '2222', :o1, '', 'Ana Prueba', '0414-555.12.34', '', false) ->> 'id' as c1 \gset
select public.pos_open(:mesera, '2222', null, 'Cliente 2') as o2 \gset
select public.pos_set_customer(:mesera, '2222', :o2, 'V20999888', 'Ana Prueba', '+58 414 5551234', '', false) ->> 'id' as c2 \gset
select public.pos_open(:mesera, '2222', null, 'Cliente 3') as o3 \gset
select public.pos_set_customer(:mesera, '2222', :o3, 'V20999777', 'Otra Persona', '0414 5551234', '', false) ->> 'id' as c3 \gset
reset role;
select prueba.ok(:c1 = :c2, 'sin cédula, el teléfono reconoce a la misma clienta (no se duplica)');
select prueba.ok((select doc_id from public.customers where id = :c1) = public.pos_doc('V20999888'), 'la cédula que dio después queda guardada en su ficha');
select prueba.ok((select customer_id from public.pos_orders where id = :o2) = :c1, 'el pedido queda con su cliente');
select prueba.ok(:c3 <> :c1, 'con otra cédula y el mismo teléfono es otra persona: se registra aparte');
rollback;
