-- Migración 2026-10-24: el tope diario de los avisos de Atlas, en un solo paso.
-- `atlas-aviso` contaba los avisos de Atlas del día y luego insertaba, en dos peticiones separadas: varias
-- peticiones a la vez leían el mismo total y se saltaban el tope (64 a la vez creaban 64). Desde esta
-- migración lo hace la función `atlas_crear_aviso`, que cuenta e inserta en la misma transacción y bajo un
-- cerrojo de la base: dos llamadas nunca cuentan a la vez.
--
-- Contrato de datos tras esta migración (se suma a los anteriores):
--   atlas_crear_aviso(p_id, p_texto, p_vence, p_hora, p_para) devuelve un texto:
--     'existia'  ya hay un aviso con ese id: no toca nada
--     'tope'     ya hay 30 avisos de Atlas (creado_por = 'atlas') en las últimas 24 horas: no inserta
--     'creado'   lo inserta con creado_por = 'atlas' y para = p_para
--   Solo inserta (nunca cambia ni borra) y solo la llama la service role, la de `atlas-aviso`: ni la app
--   ni la API. El 30 y 'atlas' son espejo de MAX_AL_DIA y MARCA_ATLAS
--   (supabase/functions/atlas-aviso/validar.mjs), y una prueba de setup/pruebas/ los ata.
--
-- Es segura de ejecutar más de una vez y no rompe la app publicada, el widget ni `Notificar` (no la
-- conocen). Va ANTES de desplegar la `atlas-aviso` que la llama; sin ella, esa función responde 500 y no
-- crea nada.

-- 0. Freno: hacen falta las columnas de la app compartida y de «Te toca a ti»
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'avisos' and column_name = 'creado_por')
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'avisos' and column_name = 'para') then
    raise exception 'Faltan las migraciones 2026-09-25-app-compartida.sql y 2026-10-09-te-toca.sql.';
  end if;
end $$;

-- 1. Contar e insertar bajo el cerrojo (security invoker: corre con los permisos de quien la llama, la
--    service role; search_path vacío y nombres completos)
create or replace function public.atlas_crear_aviso(
  p_id uuid, p_texto text, p_vence date, p_hora time, p_para text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Una llamada detrás de otra: el cerrojo dura hasta el final de la transacción, así que la siguiente
  -- ya cuenta lo que insertó esta
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('atlas_crear_aviso'));

  if exists (select 1 from public.avisos a where a.id = p_id) then
    return 'existia';
  end if;

  if (select count(*) from public.avisos a
      where a.creado_por = 'atlas' and a.creado_en >= pg_catalog.now() - interval '24 hours') >= 30 then
    return 'tope';
  end if;

  insert into public.avisos (id, texto, vence, hora, creado_por, para)
  values (p_id, p_texto, p_vence, p_hora, 'atlas', p_para);
  return 'creado';
end;
$$;

-- 2. Solo la service role: Supabase da permiso de ejecutar a `anon` y `authenticated` por defecto
revoke all on function public.atlas_crear_aviso(uuid, text, date, time, text) from public, anon, authenticated;
grant execute on function public.atlas_crear_aviso(uuid, text, date, time, text) to service_role;

-- Que la API vea la función nueva sin esperar
notify pgrst, 'reload schema';

-- Comprobación: tiene que salir una fila con PASA
select case when
    to_regprocedure('public.atlas_crear_aviso(uuid,text,date,time,text)') is not null
    and not has_function_privilege('anon', 'public.atlas_crear_aviso(uuid,text,date,time,text)', 'execute')
    and not has_function_privilege('authenticated', 'public.atlas_crear_aviso(uuid,text,date,time,text)', 'execute')
    and has_function_privilege('service_role', 'public.atlas_crear_aviso(uuid,text,date,time,text)', 'execute')
  then 'PASA' else 'FALLA' end as atlas_tope;
