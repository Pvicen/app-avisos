# Comprobaciones de seguridad del panel

Para después de ejecutar `setup/migraciones/2026-10-08-panel.sql`. Comprueban que el panel solo lo
lee su dueño y que nadie puede escribirlo desde la app ni desde la API (Contrato C2 de
`docs/panel-contrato.md`).

## 1. En el SQL Editor de Supabase

Pega TODO el bloque y pulsa **Run**. No cambia nada:

- crea una fila de prueba para el dueño (si aún no tiene panel);
- simula tres sesiones: sin sesión, la otra persona de la app y el dueño;
- intenta escribir desde cada una;
- al final lo deshace todo. La función es temporal y desaparece sola.

El dueño es la **primera persona** de la tabla `personas` (la que se creó con la migración
2026-09-25) y la otra persona es la siguiente. Si Supabase avisa de «operaciones destructivas», es
por los intentos de borrar y modificar de la prueba: confirma, porque se deshacen al terminar.

```sql
create or replace function pg_temp.probar_panel()
returns table (prueba text, esperado text, obtenido text, resultado text)
language plpgsql
as $$
declare
  yo    text;
  otra  text;
  n     int;
  t     text;
  r     text[] := '{}';
begin
  select correo into yo from public.personas order by creado_en limit 1;
  if yo is null then
    raise exception 'La tabla personas está vacía: falta la migración 2026-09-25-app-compartida.sql.';
  end if;
  select correo into otra from public.personas where correo <> yo order by creado_en limit 1;
  r := array_append(r, 'Dueño que se prueba|-|' || yo);

  -- Estructura de la tabla
  select case when c.relrowsecurity then 'sí' else 'no' end into t
    from pg_class c where c.oid = 'public.panel'::regclass;
  r := array_append(r, 'RLS activada|sí|' || t);

  select count(*)::text || ' (' || coalesce(string_agg(pol.cmd, ', '), 'ninguna') || ')' into t
    from pg_policies pol where pol.schemaname = 'public' and pol.tablename = 'panel';
  r := array_append(r, 'Políticas de la tabla|1 (SELECT)|' || t);

  select case when exists (
    select 1 from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = 'panel'
  ) then 'sí' else 'no' end into t;
  r := array_append(r, 'En tiempo real|sí|' || t);

  -- Pruebas de acceso: todo lo de este bloque se deshace al final (fila de prueba,
  -- sesión simulada y cualquier cosa que se colara).
  begin
    insert into public.panel (dueno, datos, version, generado)
    values (yo, '{"prueba": true}', 1, now())
    on conflict (dueno) do nothing;

    -- Sin sesión
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    perform set_config('role', 'anon', true);
    select count(*) into n from public.panel;
    r := array_append(r, 'Sin sesión, lee|0 filas|' || n || ' filas');
    begin
      insert into public.panel (dueno, datos, version, generado) values ('x@ejemplo.com', '{}', 1, now());
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Sin sesión, intenta escribir|rechazado|' || t);
    perform set_config('role', 'none', true);

    -- La otra persona de la app
    if otra is null then
      r := array_append(r, 'La otra persona lee el panel|0 filas|sin probar: no hay otra persona en personas');
    else
      perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'email', otra)::text, true);
      perform set_config('role', 'authenticated', true);
      select count(*) into n from public.panel;
      r := array_append(r, 'La otra persona lee el panel|0 filas|' || n || ' filas');
      begin
        insert into public.panel (dueno, datos, version, generado) values (otra, '{}', 1, now());
        t := 'lo guardó';
      exception when others then
        t := 'rechazado';
      end;
      r := array_append(r, 'La otra persona intenta crear el suyo|rechazado|' || t);
      perform set_config('role', 'none', true);
    end if;

    -- El dueño
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'email', yo)::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from public.panel;
    r := array_append(r, 'El dueño lee su panel|1 fila|' || n || (case when n = 1 then ' fila' else ' filas' end));
    begin
      insert into public.panel (dueno, datos, version, generado) values ('otro@ejemplo.com', '{}', 1, now());
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'El dueño intenta crear una fila|rechazado|' || t);
    begin
      update public.panel set version = 99 where dueno = yo;
      get diagnostics n = row_count;
      t := case when n = 0 then 'rechazado (0 filas)' else 'lo cambió' end;
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'El dueño intenta modificarlo|rechazado|' || t);
    begin
      delete from public.panel where dueno = yo;
      get diagnostics n = row_count;
      t := case when n = 0 then 'rechazado (0 filas)' else 'lo borró' end;
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'El dueño intenta borrarlo|rechazado|' || t);

    raise exception using errcode = 'PRB01', message = 'fin de la prueba';
  exception when sqlstate 'PRB01' then
    null;  -- aquí se deshace todo lo del bloque
  end;

  return query
    select split_part(u.x, '|', 1), split_part(u.x, '|', 2), split_part(u.x, '|', 3),
           case
             when split_part(u.x, '|', 2) = '-' then 'INFO'
             when split_part(u.x, '|', 3) like 'sin probar%' then 'SIN PROBAR'
             when split_part(u.x, '|', 3) like split_part(u.x, '|', 2) || '%' then 'PASA'
             else 'FALLA'
           end
    from unnest(r) with ordinality as u(x, i)
    order by u.i;
end;
$$;

select * from pg_temp.probar_panel();
```

**Lo que tiene que salir:** la primera fila es `INFO` (tu correo) y todas las demás, `PASA`.

| Prueba | Esperado |
|---|---|
| RLS activada | sí |
| Políticas de la tabla | 1 (SELECT) |
| En tiempo real | sí |
| Sin sesión, lee | 0 filas |
| Sin sesión, intenta escribir | rechazado |
| La otra persona lee el panel | 0 filas |
| La otra persona intenta crear el suyo | rechazado |
| El dueño lee su panel | 1 fila |
| El dueño intenta crear una fila / modificarlo / borrarlo | rechazado |

Si alguna sale `FALLA`, **no sigas**: el panel no está protegido como debe.

## 2. Por la API, sin sesión

Lo mismo que la app vería sin iniciar sesión. Con la clave publicable de `config.js`
(`SUPABASE_ANON_KEY`), en PowerShell:

```powershell
$clave = "<SUPABASE_ANON_KEY de config.js>"
Invoke-RestMethod -Uri "https://omotdruuyufwradcxdyb.supabase.co/rest/v1/panel?select=dueno" -Headers @{ apikey = $clave }
```

Tiene que devolver una lista vacía. Si dice que la tabla no existe, la migración no se ejecutó.

## 3. Lo que cubre la RLS sin prueba aparte

El tiempo real (realtime) aplica la misma política de lectura que la API: quien no puede leer la
fila tampoco recibe sus cambios. Se comprueba con la vista del panel (Caja C3).
