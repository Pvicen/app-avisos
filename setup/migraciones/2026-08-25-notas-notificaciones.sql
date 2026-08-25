-- Migración: notas por aviso + notificaciones push.
-- ⚠️ Reemplaza TU_CORREO@ejemplo.com (1 vez) por tu correo antes de ejecutar.
-- Es segura de ejecutar más de una vez.

-- Nota opcional por aviso
alter table public.avisos add column if not exists
  nota text check (nota is null or char_length(nota) <= 2000);

-- Marca de "ya notificado para esta fecha de vencimiento"
alter table public.avisos add column if not exists notificado_para date;

-- Dispositivos suscritos a notificaciones push
create table if not exists public.push_suscripciones (
  endpoint text primary key,
  datos jsonb not null,
  creado_en timestamptz not null default now()
);

alter table public.push_suscripciones enable row level security;

drop policy if exists "gestionar suscripciones" on public.push_suscripciones;
create policy "gestionar suscripciones"
  on public.push_suscripciones for all to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com')
  with check (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com');
