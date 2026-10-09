-- Migración 2026-10-09: RESUMEN DEL LUNES.
-- Cada lunes desde las 9:00 (hora de España) `Notificar` envía a cada persona un resumen de la
-- semana. Esta tabla apunta a quién se le envió ya el de cada lunes, para no repetirlo.
--
-- Contrato de datos tras esta migración (se suma a los anteriores):
--   avisos_resumenes  lunes (fecha del lunes de esa semana) · correo (de `personas`) · enviado_en.
--                     Una fila = ese lunes ya se le envió (o se está enviando) a esa persona.
--                     Solo la lee y la escribe la service role (`Notificar`); desde la app y la API
--                     nadie la ve. Si se borra a la persona, se borran sus filas.
--
-- Es segura de ejecutar más de una vez y no toca nada de lo que ya hay.

-- Freno: hace falta la migración de la app compartida
do $$
begin
  if to_regclass('public.personas') is null then
    raise exception 'Falta la migración 2026-09-25-app-compartida.sql (tabla personas).';
  end if;
end $$;

create table if not exists public.avisos_resumenes (
  lunes date not null,
  correo text not null references public.personas (correo) on update cascade on delete cascade,
  enviado_en timestamptz not null default now(),
  primary key (lunes, correo)
);
alter table public.avisos_resumenes enable row level security;
revoke all on public.avisos_resumenes from anon, authenticated;

notify pgrst, 'reload schema';

-- Comprobación: tiene que salir una fila con PASA
select case when
    (select c.relrowsecurity from pg_class c where c.oid = 'public.avisos_resumenes'::regclass)
    and not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = 'avisos_resumenes')
    and not has_table_privilege('authenticated', 'public.avisos_resumenes', 'select')
    and not has_table_privilege('anon', 'public.avisos_resumenes', 'select')
  then 'PASA' else 'FALLA' end as resumen_del_lunes;
