-- Configuración de la base de datos para la app de Avisos (instalación desde cero).
--
-- ⚠️ ANTES DE EJECUTAR: reemplaza TU_CORREO@ejemplo.com (aparece 4 veces)
-- por el MISMO correo con el que crearás tu usuario en Authentication → Users.
-- Luego pega TODO el archivo en el SQL Editor de Supabase y pulsa "Run".

-- 1. Tabla de avisos
create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  texto text not null check (char_length(texto) between 1 and 500),
  creado_en timestamptz not null default now(),
  completado_en timestamptz,        -- null = pendiente; con fecha = en el historial
  prioridad boolean not null default false,
  vence date                        -- fecha límite opcional
);

-- 2. Seguridad: SOLO tu usuario (identificado por su correo) puede ver y tocar
--    los avisos. Aunque alguien lograra crear otra cuenta en el proyecto
--    (registro abierto por error, cuentas anónimas, etc.), no vería nada.
alter table public.avisos enable row level security;

create policy "leer avisos"
  on public.avisos for select to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com');

create policy "crear avisos"
  on public.avisos for insert to authenticated
  with check (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com');

create policy "editar avisos"
  on public.avisos for update to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com')
  with check (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com');

create policy "borrar avisos"
  on public.avisos for delete to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com' and completado_en is not null);

-- 3. Tiempo real: los cambios se avisan al instante a todos los dispositivos
alter publication supabase_realtime add table public.avisos;
