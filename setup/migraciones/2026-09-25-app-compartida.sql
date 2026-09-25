-- Migración 2026-09-25: la app pasa a ser COMPARTIDA ("todo compartido").
-- Cada persona entra con su propia cuenta y todas ven, agregan y completan la
-- misma lista. Queda registrado quién anotó cada aviso y quién lo completó.
--
-- Contrato de datos tras esta migración (lo que pueden esperar la app, el widget
-- de Android y la función de notificaciones):
--   personas            correo (minúsculas, clave) · nombre · creado_en
--   avisos              + creado_por      correo de quien lo anotó (lo fija el servidor)
--                       + completado_por  correo de quien lo completó (lo fija el
--                                         servidor; se borra al devolverlo a pendientes)
--   push_suscripciones  + correo          dueño del dispositivo (lo fija el servidor)
--   Reglas: solo quien está en `personas` ve o toca algo. Todas las personas leen,
--   crean y editan todos los avisos; solo se borran los ya completados. Cada
--   persona gestiona solo sus propios dispositivos de notificación.
--
-- ⚠️ Antes de ejecutar: pon TU correo y TU nombre en el paso 1 (una sola línea).
-- Es segura de ejecutar más de una vez y no rompe la app ni el widget actuales.
--
-- Para sumar a otra persona (después de crear su cuenta en Authentication → Users):
--   insert into public.personas (correo, nombre) values (lower('su-correo@ejemplo.com'), 'Su nombre');

-- 1. Quiénes usan la app
create table if not exists public.personas (
  correo text primary key check (correo = lower(correo)),
  nombre text not null check (char_length(nombre) between 1 and 40),
  creado_en timestamptz not null default now()
);

insert into public.personas (correo, nombre)
values (lower('TU_CORREO@ejemplo.com'), 'Tu nombre')
on conflict (correo) do nothing;

-- Freno: si el correo del paso 1 no corresponde a ninguna cuenta, no se sigue
-- (si no, las reglas nuevas te dejarían fuera de tu propia app).
do $$
begin
  if not exists (
    select 1 from auth.users u
    join public.personas p on p.correo = lower(u.email)
  ) then
    raise exception 'El correo del paso 1 no tiene cuenta en Authentication → Users. Corrígelo y vuelve a ejecutar.';
  end if;
end $$;

-- ¿Quien hace la petición está en la lista? (security definer: consulta
-- personas sin pasar por su propia RLS, así no hay recursión)
create or replace function public.es_persona()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.personas
    where correo = lower(coalesce(auth.jwt()->>'email', ''))
  );
$$;

alter table public.personas enable row level security;

drop policy if exists "ver personas" on public.personas;
create policy "ver personas"
  on public.personas for select to authenticated
  using ((select public.es_persona()));

-- 2. Quién anotó y quién completó cada aviso
alter table public.avisos add column if not exists creado_por text;
alter table public.avisos add column if not exists completado_por text;

-- El trigger se quita mientras se rellenan los avisos antiguos (si no, los pisaría)
drop trigger if exists avisos_autoria on public.avisos;

-- Los avisos que ya existían son de la primera persona de la lista (tú)
update public.avisos
  set creado_por = (select correo from public.personas order by creado_en limit 1)
  where creado_por is null;
update public.avisos
  set completado_por = (select correo from public.personas order by creado_en limit 1)
  where completado_en is not null and completado_por is null;

-- El servidor fija la autoría: nadie puede hacerse pasar por otro ni cambiarla
create or replace function public.avisos_autoria()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  quien text := lower(nullif(auth.jwt()->>'email', ''));
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(quien, new.creado_por);
    new.completado_por := case
      when new.completado_en is null then null
      else coalesce(quien, new.completado_por)
    end;
  else
    new.creado_por := old.creado_por;
    if new.completado_en is null then
      new.completado_por := null;
    elsif old.completado_en is null then
      new.completado_por := coalesce(quien, new.completado_por);
    else
      new.completado_por := old.completado_por;
    end if;
  end if;
  return new;
end;
$$;

create trigger avisos_autoria
  before insert or update on public.avisos
  for each row execute function public.avisos_autoria();

-- 3. Seguridad: todas las personas de la lista comparten los avisos
drop policy if exists "leer avisos" on public.avisos;
create policy "leer avisos"
  on public.avisos for select to authenticated
  using ((select public.es_persona()));

drop policy if exists "crear avisos" on public.avisos;
create policy "crear avisos"
  on public.avisos for insert to authenticated
  with check ((select public.es_persona()));

drop policy if exists "editar avisos" on public.avisos;
create policy "editar avisos"
  on public.avisos for update to authenticated
  using ((select public.es_persona()))
  with check ((select public.es_persona()));

drop policy if exists "borrar avisos" on public.avisos;
create policy "borrar avisos"
  on public.avisos for delete to authenticated
  using ((select public.es_persona()) and completado_en is not null);

-- 4. Notificaciones: cada dispositivo queda a nombre de su dueño
alter table public.push_suscripciones add column if not exists correo text;
update public.push_suscripciones
  set correo = (select correo from public.personas order by creado_en limit 1)
  where correo is null;
alter table public.push_suscripciones
  alter column correo set default lower(auth.jwt()->>'email');

drop policy if exists "gestionar suscripciones" on public.push_suscripciones;
create policy "gestionar suscripciones"
  on public.push_suscripciones for all to authenticated
  using ((select public.es_persona()) and correo = (select lower(auth.jwt()->>'email')))
  with check ((select public.es_persona()) and correo = (select lower(auth.jwt()->>'email')));
