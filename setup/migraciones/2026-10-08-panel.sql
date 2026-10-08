-- Migración 2026-10-08: el Panel personal (encargo 113, Contrato C2).
--
-- Tabla `panel`: una fila por dueño con el último JSON del panel (Contrato C1, en
-- docs/panel-contrato.md). Solo la lee su dueño, y solo si está en `personas`. El cliente
-- NUNCA escribe: la llena la Edge Function `panel-subir` con la service role.
--
-- Requiere la migración 2026-09-25-app-compartida.sql (función es_persona()).
-- No lleva datos personales, no toca los avisos y se puede ejecutar más de una vez.

-- Freno: sin es_persona() no se sigue
do $$
begin
  if to_regprocedure('public.es_persona()') is null then
    raise exception 'Falta la migración 2026-09-25-app-compartida.sql (no existe public.es_persona()).';
  end if;
end $$;

create table if not exists public.panel (
  dueno     text primary key check (dueno = lower(dueno)),
  datos     jsonb not null,
  version   int not null,
  generado  timestamptz not null,
  recibido  timestamptz not null default now()
);

alter table public.panel enable row level security;

-- Solo su dueño la lee; el cliente NUNCA escribe (no hay políticas de insert, update ni delete)
drop policy if exists "leer mi panel" on public.panel;
create policy "leer mi panel" on public.panel for select to authenticated
  using (dueno = (select lower(auth.jwt()->>'email')) and (select public.es_persona()));

-- Doble cerrojo: además de no tener políticas de escritura, el cliente no tiene permiso para
-- escribir. La service role (la Edge Function) conserva los suyos.
revoke insert, update, delete, truncate, references, trigger on public.panel from anon, authenticated;

-- Lectura explícita (algunos proyectos no la dan por defecto a las tablas nuevas). Qué filas se
-- ven lo decide la política de arriba: sin sesión o sin ser el dueño, ninguna.
grant select on public.panel to anon, authenticated;

-- Tiempo real, sin fallar si la tabla ya estaba en la publicación
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'panel'
  ) then
    alter publication supabase_realtime add table public.panel;
  end if;
end $$;
