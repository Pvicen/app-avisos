-- Migración para proyectos que ya tenían la versión inicial de la app.
-- Agrega: historial (completado_en), prioridades (prioridad) y fechas límite (vence),
-- el permiso de edición que necesitan "editar aviso" y "marcar como hecho", y
-- endurece el borrado: solo se pueden borrar avisos ya completados (protege los
-- pendientes frente a versiones viejas de la app que completaban borrando).
--
-- ⚠️ Reemplaza TU_CORREO@ejemplo.com (3 veces) por tu correo antes de ejecutar.
-- Es segura de ejecutar más de una vez.

alter table public.avisos add column if not exists completado_en timestamptz;
alter table public.avisos add column if not exists prioridad boolean not null default false;
alter table public.avisos add column if not exists vence date;

drop policy if exists "editar avisos" on public.avisos;
create policy "editar avisos"
  on public.avisos for update to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com')
  with check (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com');

drop policy if exists "borrar avisos" on public.avisos;
create policy "borrar avisos"
  on public.avisos for delete to authenticated
  using (auth.jwt()->>'email' = 'TU_CORREO@ejemplo.com' and completado_en is not null);
