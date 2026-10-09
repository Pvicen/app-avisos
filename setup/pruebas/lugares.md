# Comprobaciones de los avisos por lugar

Para después de ejecutar `setup/migraciones/2026-10-10-lugares.sql`. Comprueban que los lugares los
comparten las personas de la app y nadie más, que la tabla rechaza datos malos y que borrar un lugar
no borra sus avisos.

## 1. En el SQL Editor de Supabase

Pega TODO el bloque y pulsa **Run**. No cambia nada: simula las sesiones, crea lugares y avisos de
prueba y al final lo deshace todo. «Yo» es la **primera persona** de `personas` y «la otra», la
siguiente (si no hay, esas pruebas salen `SIN PROBAR`). Si Supabase avisa de «operaciones
destructivas», confirma: se deshacen al terminar.

```sql
create or replace function pg_temp.probar_lugares()
returns table (prueba text, esperado text, obtenido text, resultado text)
language plpgsql
as $$
declare
  yo    text;
  otra  text;
  l1    uuid;
  a1    uuid;
  n     int;
  t     text;
  r     text[] := '{}';
begin
  select correo into yo from public.personas order by creado_en limit 1;
  if yo is null then
    raise exception 'La tabla personas está vacía: falta la migración 2026-09-25-app-compartida.sql.';
  end if;
  select correo into otra from public.personas where correo <> yo order by creado_en limit 1;
  r := array_append(r, 'Yo|-|' || yo);

  -- Estructura
  select case when c.relrowsecurity then 'sí' else 'no' end into t
    from pg_class c where c.oid = 'public.lugares'::regclass;
  r := array_append(r, 'RLS activada|sí|' || t);
  select count(*)::text into t from pg_policies p where p.schemaname = 'public' and p.tablename = 'lugares';
  r := array_append(r, 'Políticas|4|' || t);
  select case when exists (
    select 1 from pg_publication_tables pt
    where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = 'lugares'
  ) then 'sí' else 'no' end into t;
  r := array_append(r, 'En tiempo real|sí|' || t);

  begin
    -- Un lugar de prueba, creado sin sesión (como postgres) para las lecturas de fuera
    insert into public.lugares (nombre, lat, lon) values ('prueba: fuera', 40.0, -3.0);

    -- Sin sesión
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    perform set_config('role', 'anon', true);
    begin
      select count(*) into n from public.lugares;
      t := n || ' filas';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Sin sesión, lee|rechazado|' || t);
    perform set_config('role', 'none', true);

    -- Alguien con cuenta pero fuera de personas
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'email', 'nadie@ejemplo.com')::text, true);
    perform set_config('role', 'authenticated', true);
    select count(*) into n from public.lugares;
    r := array_append(r, 'Fuera de personas, lee|0 filas|' || n || ' filas');
    begin
      insert into public.lugares (nombre, lat, lon) values ('prueba: intruso', 40.0, -3.0);
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Fuera de personas, crea|rechazado|' || t);
    perform set_config('role', 'none', true);

    -- Yo
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'email', yo)::text, true);
    perform set_config('role', 'authenticated', true);
    insert into public.lugares (nombre, lat, lon) values ('Prueba lugar', 40.4168, -3.7038) returning id into l1;
    select coalesce(creado_por, 'null') into t from public.lugares where id = l1;
    r := array_append(r, 'Creo un lugar: creado_por|' || yo || '|' || t);
    select radio::text into t from public.lugares where id = l1;
    r := array_append(r, 'Radio por defecto|150|' || t);
    begin
      insert into public.lugares (nombre, lat, lon) values ('  PRUEBA LUGAR ', 40.0, -3.0);
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Otro con el mismo nombre|rechazado|' || t);
    begin
      insert into public.lugares (nombre, lat, lon) values ('prueba: lat mala', 100, -3.0);
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Latitud fuera de rango|rechazado|' || t);
    begin
      insert into public.lugares (nombre, lat, lon) values ('   ', 40.0, -3.0);
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Nombre vacío|rechazado|' || t);

    -- Un aviso con ese lugar; al borrar el lugar, el aviso se queda sin lugar
    insert into public.avisos (texto, lugar_id) values ('prueba: comprar pan', l1) returning id into a1;
    delete from public.lugares where id = l1;
    select count(*) into n from public.avisos where id = a1 and lugar_id is null;
    r := array_append(r, 'Borro el lugar: el aviso sigue, sin lugar|1|' || n);
    perform set_config('role', 'none', true);

    -- La otra persona ve y cambia los lugares
    if otra is null then
      r := array_append(r, 'La otra persona ve y cambia el lugar|1|sin probar: no hay otra persona en personas');
    else
      insert into public.lugares (nombre, lat, lon) values ('Prueba compartido', 40.0, -3.0) returning id into l1;
      perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'email', otra)::text, true);
      perform set_config('role', 'authenticated', true);
      update public.lugares set radio = 300 where id = l1;
      get diagnostics n = row_count;
      r := array_append(r, 'La otra persona ve y cambia el lugar|1|' || n);
      perform set_config('role', 'none', true);
    end if;

    raise exception using errcode = 'PRB01', message = 'fin de la prueba';
  exception when sqlstate 'PRB01' then
    null;  -- aquí se deshace todo lo del bloque
  end;

  return query
    select split_part(u.x, '|', 1), split_part(u.x, '|', 2), split_part(u.x, '|', 3),
           case
             when split_part(u.x, '|', 2) = '-' then 'INFO'
             when split_part(u.x, '|', 3) like 'sin probar%' then 'SIN PROBAR'
             when split_part(u.x, '|', 3) = split_part(u.x, '|', 2) then 'PASA'
             else 'FALLA'
           end
    from unnest(r) with ordinality as u(x, i)
    order by u.i;
end;
$$;

select resultado, count(*) as cuantas, string_agg(prueba, ' / ') as pruebas
from pg_temp.probar_lugares() group by resultado;
```

**Lo que tiene que salir:** `INFO 1` (tu correo) y `PASA 13`, sin ninguna `FALLA`. Si sale alguna,
cambia la última consulta por `select * from pg_temp.probar_lugares();` para ver cuál.

| Prueba | Esperado |
|---|---|
| RLS activada · políticas · en tiempo real | sí · 4 · sí |
| Sin sesión, lee | rechazado |
| Fuera de personas, lee · crea | 0 filas · rechazado |
| Creo un lugar: creado_por · radio por defecto | mi correo · 150 |
| Otro con el mismo nombre · latitud fuera de rango · nombre vacío | rechazado |
| Borro el lugar: el aviso sigue, sin lugar | 1 |
| La otra persona ve y cambia el lugar | 1 |

## 2. Por la API, sin sesión

Con la clave publicable de `config.js` (`SUPABASE_ANON_KEY`), los lugares no tienen que verse:

```powershell
$clave = "<SUPABASE_ANON_KEY de config.js>"
Invoke-RestMethod -Uri "https://omotdruuyufwradcxdyb.supabase.co/rest/v1/lugares?select=id" -Headers @{ apikey = $clave }
```

Tiene que dar un error de permiso (401), no una lista.
