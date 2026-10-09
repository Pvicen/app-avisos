-- Migración 2026-10-10: AVISOS POR LUGAR.
-- Los sitios guardados («Súper», «Casa»…) y el lugar de cada aviso. La app de Android (la del
-- widget) vigila esos sitios con geovallas y avisa al llegar; la web solo los elige y los enseña.
--
-- Contrato de datos tras esta migración (se suma a los anteriores):
--   lugares   id (uuid) · nombre (1 a 40 letras, único sin mirar mayúsculas ni espacios de los
--             lados) · lat · lon (grados WGS84) · radio (metros, 150 por defecto; de 50 a 1000) ·
--             creado_por (correo de quien lo guardó; lo pone la base) · creado_en.
--             Compartidos como los avisos: todas las personas de `personas` los ven, los crean, los
--             cambian y los borran; nadie más los ve. En tiempo real.
--   avisos    + lugar_id   el lugar del aviso, o null. Si se borra el lugar, vuelve a null.
--   La posición del teléfono nunca se guarda: solo los sitios que se guardan a propósito.
--
-- Requiere la migración 2026-09-25-app-compartida.sql (es_persona()). Se puede ejecutar más de una
-- vez y no rompe la app publicada (no conoce `lugar_id`), ni el widget (pide sus columnas por
-- nombre), ni `Notificar`.
-- Después: setup/pruebas/lugares.md (todo tiene que salir PASA).

-- 0. Freno
do $$
begin
  if to_regprocedure('public.es_persona()') is null then
    raise exception 'Falta la migración 2026-09-25-app-compartida.sql (no existe public.es_persona()).';
  end if;
end $$;

-- 1. Los sitios
create table if not exists public.lugares (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 40),
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  radio integer not null default 150 check (radio between 50 and 1000),
  creado_por text default lower(auth.jwt()->>'email'),
  creado_en timestamptz not null default now()
);
create unique index if not exists lugares_nombre_unico on public.lugares (lower(btrim(nombre)));

alter table public.lugares enable row level security;

drop policy if exists "leer lugares" on public.lugares;
create policy "leer lugares" on public.lugares for select to authenticated
  using ((select public.es_persona()));

drop policy if exists "crear lugares" on public.lugares;
create policy "crear lugares" on public.lugares for insert to authenticated
  with check ((select public.es_persona()));

drop policy if exists "editar lugares" on public.lugares;
create policy "editar lugares" on public.lugares for update to authenticated
  using ((select public.es_persona()))
  with check ((select public.es_persona()));

drop policy if exists "borrar lugares" on public.lugares;
create policy "borrar lugares" on public.lugares for delete to authenticated
  using ((select public.es_persona()));

-- Sin sesión, nada; con sesión, lo que dejen las políticas de arriba
revoke all on public.lugares from anon;
grant select, insert, update, delete on public.lugares to authenticated;

-- 2. El lugar de cada aviso
alter table public.avisos add column if not exists lugar_id uuid
  references public.lugares (id) on delete set null;

-- 3. Tiempo real, sin fallar si ya estaba en la publicación
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lugares'
  ) then
    alter publication supabase_realtime add table public.lugares;
  end if;
end $$;

notify pgrst, 'reload schema';

-- Comprobación: tiene que salir una fila con PASA (la prueba completa está en setup/pruebas/lugares.md)
select case when
    (select c.relrowsecurity from pg_class c where c.oid = 'public.lugares'::regclass)
    and (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'lugares') = 4
    and exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'avisos' and column_name = 'lugar_id')
    and not has_table_privilege('anon', 'public.lugares', 'select')
  then 'PASA' else 'FALLA' end as avisos_por_lugar;
