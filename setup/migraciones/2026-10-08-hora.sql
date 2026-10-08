-- Migración 2026-10-08: HORA EXACTA en los avisos.
-- Un aviso con fecha puede llevar además una hora; la notificación suena a esa hora en vez de
-- con el aviso de las 9:00. Independiente de la migración del panel del mismo día.
--
-- Contrato de datos tras esta migración (se suma al de 2026-09-25-app-compartida.sql):
--   avisos  + hora             hora de España (Europe/Madrid), HH:MM:00; null = sin hora.
--                              Solo cuenta si hay `vence`: sin fecha se ignora (no se pinta ni
--                              suena). La app la borra cuando se quita la fecha.
--           + notificado_hora  la escribe solo `Notificar`, junto con `notificado_para`.
--                              Un aviso ya sonó si notificado_para = vence y notificado_hora
--                              es la misma que hora (las dos null si no tiene hora). Si se
--                              cambia la fecha o la hora, vuelve a sonar.
--   Reglas: las de siempre. Sin cambios en la RLS ni en el trigger de autoría.
--
-- Es segura de ejecutar más de una vez y no rompe la app publicada (lee `*` y no usa las
-- columnas nuevas), ni el widget (pide sus columnas por nombre), ni la función `Notificar`
-- desplegada (no las mira hasta que se cambie).

alter table public.avisos add column if not exists hora time(0);
alter table public.avisos add column if not exists notificado_hora time(0);

-- Que la API vea las columnas nuevas sin esperar
notify pgrst, 'reload schema';

-- Comprobación: tiene que salir una fila con PASA
select case when count(*) = 2 then 'PASA' else 'FALLA' end as hora_exacta
from information_schema.columns
where table_schema = 'public'
  and table_name = 'avisos'
  and column_name in ('hora', 'notificado_hora')
  and data_type = 'time without time zone'
  and is_nullable = 'YES';
