-- Migración 2026-10-09: «TE TOCA A TI» y el aviso cuando el otro termina algo.
-- Un aviso puede ser para una persona concreta; al pasárselo, a esa persona le llega una
-- notificación, y cuando alguien termina un aviso que anotó o le tocaba a otra, a esa otra también.
-- Las notificaciones las envía `Notificar` en su vuelta de cada minuto, leyendo una cola de eventos.
--
-- Contrato de datos tras esta migración (se suma a los anteriores):
--   avisos          + para       correo (de `personas`) de quien le toca; null = de nadie en concreto.
--                                Lo pone cualquier persona desde la app. Si se borra a esa persona
--                                de `personas`, vuelve a null.
--   avisos_eventos  la cola de notificaciones. Solo la lee y la escribe la service role (`Notificar`);
--                   desde la app y la API nadie la ve. La llena el disparador `avisos_eventos`:
--                     id          número creciente
--                     tipo        'te_toca' | 'terminado'
--                     aviso_id    el aviso (sin clave foránea: el aviso puede borrarse luego)
--                     texto       copia del texto del aviso en ese momento
--                     quien       correo de quien lo hizo (null si fue desde el SQL Editor)
--                     para        correo de quien tiene que recibirlo
--                     creado_en   cuándo pasó
--                     enviado_en  null = pendiente; lo pone `Notificar` al enviarlo
--                     intentos    envíos fallidos (`Notificar` se rinde a partir de unos cuantos)
--   Reglas del disparador (después de cada alta o cambio en `avisos`):
--     te_toca    `para` pasa a ser una persona (al crearlo o al cambiarlo), el aviso está pendiente
--                y no se lo pone uno a sí mismo.
--     terminado  el aviso pasa a completado: un evento para quien lo anotó y otro para quien le
--                tocaba, sin repetir, solo si están en `personas` y nunca para quien lo completó.
--   Si apuntar un evento falla, el cambio del aviso se guarda igual (solo se pierde la notificación).
--
-- Es segura de ejecutar más de una vez y no rompe la app publicada (no conoce `para`), ni el widget
-- (pide sus columnas por nombre), ni `Notificar` (no mira la cola hasta que se actualice).
-- Después: setup/pruebas/te-toca.md (todo tiene que salir PASA).

-- 0. Freno: hace falta la migración de la app compartida
do $$
begin
  if to_regclass('public.personas') is null or to_regprocedure('public.es_persona()') is null then
    raise exception 'Falta la migración 2026-09-25-app-compartida.sql (tabla personas y es_persona()).';
  end if;
end $$;

-- 1. A quién le toca
alter table public.avisos add column if not exists para text
  references public.personas (correo) on update cascade on delete set null;

-- 2. La cola de eventos: sin políticas, así que ni anon ni authenticated pueden verla ni tocarla
create table if not exists public.avisos_eventos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('te_toca', 'terminado')),
  aviso_id uuid not null,
  texto text not null,
  quien text,
  para text not null,
  creado_en timestamptz not null default now(),
  enviado_en timestamptz,
  intentos smallint not null default 0
);
alter table public.avisos_eventos enable row level security;
revoke all on public.avisos_eventos from anon, authenticated;
create index if not exists avisos_eventos_pendientes
  on public.avisos_eventos (id) where enviado_en is null;

-- 3. El disparador que apunta los eventos (security definer: escribe en la cola sin permisos de
--    la sesión; search_path vacío y nombres completos)
create or replace function public.avisos_eventos_registrar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quien text := lower(nullif(auth.jwt()->>'email', ''));
begin
  begin
    -- Te toca: se le pasa a alguien, salvo que se lo ponga uno mismo
    if new.para is not null
       and new.completado_en is null
       and (tg_op = 'INSERT' or new.para is distinct from old.para)
       and new.para is distinct from quien then
      insert into public.avisos_eventos (tipo, aviso_id, texto, quien, para)
      values ('te_toca', new.id, new.texto, quien, new.para);
    end if;

    -- Terminado: a quien lo anotó y a quien le tocaba, nunca a quien lo completó
    if tg_op = 'UPDATE' and old.completado_en is null and new.completado_en is not null then
      insert into public.avisos_eventos (tipo, aviso_id, texto, quien, para)
      select 'terminado', new.id, new.texto, new.completado_por, d.correo
      from (select distinct x.correo from (values (new.creado_por), (new.para)) as x (correo)) as d
      where d.correo is not null
        and d.correo is distinct from new.completado_por
        and exists (select 1 from public.personas p where p.correo = d.correo);
    end if;
  exception when others then
    -- La notificación nunca puede impedir guardar el aviso
    raise warning 'avisos_eventos_registrar: %', sqlerrm;
  end;
  return null;
end;
$$;

-- Solo la usa el disparador: nadie la llama a mano (ni por la API)
revoke execute on function public.avisos_eventos_registrar() from public, anon, authenticated;

drop trigger if exists avisos_eventos on public.avisos;
create trigger avisos_eventos
  after insert or update on public.avisos
  for each row execute function public.avisos_eventos_registrar();

-- Que la API vea la columna nueva sin esperar
notify pgrst, 'reload schema';

-- Comprobación: tiene que salir una fila con PASA (la prueba completa está en setup/pruebas/te-toca.md)
select case when
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'avisos' and column_name = 'para')
    and (select c.relrowsecurity from pg_class c where c.oid = 'public.avisos_eventos'::regclass)
    and exists (select 1 from pg_trigger t
                where t.tgrelid = 'public.avisos'::regclass and t.tgname = 'avisos_eventos')
  then 'PASA' else 'FALLA' end as te_toca;
