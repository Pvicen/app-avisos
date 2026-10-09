# Comprobaciones de «te toca a ti»

Para después de ejecutar `setup/migraciones/2026-10-09-te-toca.sql`. Comprueban que el disparador
apunta en la cola `avisos_eventos` lo que tiene que notificarse (y nada más) y que la cola no la ve
nadie desde la app ni desde la API.

## 1. En el SQL Editor de Supabase

Pega TODO el bloque y pulsa **Run**. No cambia nada:

- simula las sesiones de las dos personas de la app y una sin sesión;
- crea, pasa y completa avisos de prueba;
- al final lo deshace todo (avisos y eventos). La función es temporal y desaparece sola.

«Yo» es la **primera persona** de la tabla `personas` y «la otra», la siguiente. Si solo hay una
persona, las pruebas entre las dos salen `SIN PROBAR`. Si Supabase avisa de «operaciones
destructivas», confirma: se deshacen al terminar.

```sql
create or replace function pg_temp.probar_te_toca()
returns table (prueba text, esperado text, obtenido text, resultado text)
language plpgsql
as $$
declare
  yo    text;
  otra  text;
  a1    uuid;
  a2    uuid;
  a3    uuid;
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
  r := array_append(r, 'La otra persona|-|' || coalesce(otra, 'no hay'));

  -- Estructura
  select case when c.relrowsecurity then 'sí' else 'no' end into t
    from pg_class c where c.oid = 'public.avisos_eventos'::regclass;
  r := array_append(r, 'Cola con RLS activada|sí|' || t);
  select count(*)::text into t from pg_policies pol
    where pol.schemaname = 'public' and pol.tablename = 'avisos_eventos';
  r := array_append(r, 'Políticas de la cola|0|' || t);
  select count(*)::text into t from pg_trigger tr
    where tr.tgrelid = 'public.avisos'::regclass and tr.tgname = 'avisos_eventos';
  r := array_append(r, 'Disparador en avisos|1|' || t);

  -- Todo lo de este bloque se deshace al final
  begin
    -- Sin sesión: no puede leer la cola
    perform set_config('request.jwt.claims', '{"role": "anon"}', true);
    perform set_config('role', 'anon', true);
    begin
      select count(*) into n from public.avisos_eventos;
      t := 'la leyó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Sin sesión, lee la cola|rechazado|' || t);
    perform set_config('role', 'none', true);

    -- Yo, con sesión
    perform set_config('request.jwt.claims',
      json_build_object('role', 'authenticated', 'email', yo)::text, true);
    perform set_config('role', 'authenticated', true);
    begin
      select count(*) into n from public.avisos_eventos;
      t := 'la leyó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Con sesión, lee la cola|rechazado|' || t);
    begin
      insert into public.avisos (texto, para) values ('prueba: para alguien que no está', 'nadie@ejemplo.com');
      t := 'lo guardó';
    exception when others then
      t := 'rechazado';
    end;
    r := array_append(r, 'Pasar un aviso a quien no está en personas|rechazado|' || t);

    -- Un aviso mío para mí y completado por mí: nada que notificar
    insert into public.avisos (texto, para) values ('prueba: mío', yo) returning id into a3;
    update public.avisos set completado_en = now() where id = a3;
    perform set_config('role', 'none', true);
    select count(*) into n from public.avisos_eventos where aviso_id = a3;
    r := array_append(r, 'Mío, para mí y lo termino yo: eventos|0|' || n);

    if otra is null then
      r := array_append(r, 'Pasárselo a la otra|1 te_toca|sin probar: no hay otra persona en personas');
    else
      -- Yo se lo paso a la otra al crearlo
      perform set_config('role', 'authenticated', true);
      insert into public.avisos (texto, para) values ('prueba: te toca', otra) returning id into a1;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos
        where aviso_id = a1 and tipo = 'te_toca' and para = otra and quien = yo;
      r := array_append(r, 'Se lo paso a la otra al crearlo|1 te_toca|' || n || ' te_toca');

      -- Me lo paso a mí (no avisa) y otra vez a ella (avisa de nuevo)
      perform set_config('role', 'authenticated', true);
      update public.avisos set para = yo where id = a1;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos where aviso_id = a1 and tipo = 'te_toca' and para = yo;
      r := array_append(r, 'Me lo paso a mí mismo|0 te_toca|' || n || ' te_toca');
      perform set_config('role', 'authenticated', true);
      update public.avisos set para = otra where id = a1;
      update public.avisos set texto = 'prueba: te toca (editado)' where id = a1;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos where aviso_id = a1 and tipo = 'te_toca' and para = otra;
      r := array_append(r, 'Se lo vuelvo a pasar y luego edito el texto|2 te_toca|' || n || ' te_toca');

      -- Lo termina ella: me avisa a mí (lo anoté yo), no a ella
      perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'email', otra)::text, true);
      perform set_config('role', 'authenticated', true);
      update public.avisos set completado_en = now() where id = a1;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos
        where aviso_id = a1 and tipo = 'terminado' and para = yo and quien = otra;
      r := array_append(r, 'Lo termina ella: me avisa a mí|1 terminado|' || n || ' terminado');
      select count(*) into n from public.avisos_eventos where aviso_id = a1 and tipo = 'terminado' and para = otra;
      r := array_append(r, 'Lo termina ella: a ella no|0 terminado|' || n || ' terminado');

      -- Uno suyo, sin dueño, que termino yo: le avisa a ella
      perform set_config('role', 'authenticated', true);
      insert into public.avisos (texto) values ('prueba: suyo') returning id into a2;
      perform set_config('request.jwt.claims',
        json_build_object('role', 'authenticated', 'email', yo)::text, true);
      update public.avisos set completado_en = now() where id = a2;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos where aviso_id = a2 and tipo = 'terminado' and para = otra;
      r := array_append(r, 'Uno suyo que termino yo: le avisa|1 terminado|' || n || ' terminado');

      -- Lo devuelvo a pendientes y lo completo otra vez: un segundo aviso
      perform set_config('role', 'authenticated', true);
      update public.avisos set completado_en = null where id = a2;
      update public.avisos set completado_en = now() where id = a2;
      perform set_config('role', 'none', true);
      select count(*) into n from public.avisos_eventos where aviso_id = a2 and tipo = 'terminado';
      r := array_append(r, 'Deshacer y volver a terminar|2 terminado|' || n || ' terminado');

      -- Lo que hace Notificar (service role, sin correo) no apunta nada
      select count(*) into n from public.avisos_eventos where aviso_id = a2;
      update public.avisos set notificado_para = current_date where id = a2;
      select (count(*) - n)::text into t from public.avisos_eventos where aviso_id = a2;
      r := array_append(r, 'Las marcas de Notificar|0 eventos nuevos|' || t || ' eventos nuevos');
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

select * from pg_temp.probar_te_toca();
```

**Lo que tiene que salir:** las dos primeras filas son `INFO` (los dos correos) y todas las demás,
`PASA`.

| Prueba | Esperado |
|---|---|
| Cola con RLS activada · políticas · disparador | sí · 0 · 1 |
| Sin sesión / con sesión, lee la cola | rechazado |
| Pasar un aviso a quien no está en personas | rechazado |
| Mío, para mí y lo termino yo | 0 eventos |
| Se lo paso a la otra al crearlo | 1 te_toca |
| Me lo paso a mí mismo | 0 te_toca |
| Se lo vuelvo a pasar y luego edito el texto | 2 te_toca (editar no avisa) |
| Lo termina ella: me avisa a mí · a ella no | 1 terminado · 0 terminado |
| Uno suyo que termino yo: le avisa | 1 terminado |
| Deshacer y volver a terminar | 2 terminado |
| Las marcas de Notificar | 0 eventos nuevos |

Si alguna sale `FALLA`, **no sigas** y avísame con la tabla.

## 2. Por la API, sin sesión

Con la clave publicable de `config.js` (`SUPABASE_ANON_KEY`), la cola no tiene que verse:

```powershell
$clave = "<SUPABASE_ANON_KEY de config.js>"
Invoke-RestMethod -Uri "https://omotdruuyufwradcxdyb.supabase.co/rest/v1/avisos_eventos?select=id" -Headers @{ apikey = $clave }
```

Tiene que dar un error de permiso (401 o 403), no una lista.
