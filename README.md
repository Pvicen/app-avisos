# 📌 App de avisos

Lista de pendientes compartida entre personas y dispositivos (PCs, notebook, Android e
iPhone), sincronizada en tiempo real. Agregas un aviso en un dispositivo y aparece al
instante en los demás; lo marcas como hecho y pasa al historial en todos. Al tocar un
aviso aparecen sus opciones: editarlo, agregarle una nota, marcarlo como importante (sube
al principio con una franja coral) y ponerle fecha límite (se destaca cuando está por
vencer) y, si hace falta, una hora exacta («Hoy · 18:00»: la notificación suena a esa hora).
La fecha y la hora también se pueden escribir (o dictar) en el propio aviso: «comprar pan
mañana a las 6» se guarda como «comprar pan» para mañana a las 18:00 (ver
[Escribir como hablas](#escribir-como-hablas)). Cada aviso muestra quién lo anotó y el historial quién lo hizo; desde ahí se
puede devolver a pendientes (o usar el "Deshacer" rápido). También avisa con
notificaciones cuando algo vence (🔔).

## Cómo funciona

- Una sola página web (`index.html`) que se abre desde el navegador de cualquier dispositivo.
- Los avisos se guardan en **Supabase** (base de datos gratuita en la nube).
- Protegida con usuario y contraseña: cada persona inicia sesión con su propia cuenta una
  vez en cada dispositivo y queda guardada. Las políticas de seguridad (RLS) solo dejan ver
  y tocar los avisos a los correos de la tabla `personas`.
- Si la conexión en tiempo real se cae, la app reintenta sola y además refresca la lista
  al volver a la pestaña, al recuperar internet y cada 2 minutos.

## Configuración inicial (una sola vez)

1. **Crear cuenta en Supabase**: entra a <https://supabase.com>, pulsa "Start your project"
   y crea una cuenta gratis.
2. **Crear un proyecto**: nombre `avisos` (o el que quieras), inventa una contraseña de base
   de datos (guárdala, aunque no la vas a necesitar en el día a día) y elige la región
   más cercana (South America / São Paulo).
3. **Crear la tabla**: abre [`setup/supabase.sql`](setup/supabase.sql), reemplaza
   `TU_CORREO@ejemplo.com` por tu correo real, pega todo el contenido en el **SQL Editor**
   de Supabase y pulsa **Run**. Después ejecuta, en orden, las migraciones de
   [`setup/migraciones/`](setup/migraciones/) (la última necesita que tu usuario del
   paso 4 ya exista).
4. **Crear tu usuario**: en **Authentication → Users → Add user → Create new user**,
   pon ese mismo correo y una contraseña **larga y única** (mínimo ~16 caracteres,
   idealmente generada por un gestor de contraseñas; no reutilices una de otro sitio).
   Esta contraseña es la única llave de entrada a tus avisos desde internet, y es la que
   usarás para entrar a la app.
5. **Cerrar el registro**: en **Authentication → Sign In / Providers**, desactiva
   *Allow new users to sign up* y verifica que *Allow anonymous sign-ins* también esté
   desactivado.
6. **Copiar las claves**: en **Project Settings → API** (o **Data API**), copia:
   - *Project URL* → pégala en `config.js` como `SUPABASE_URL`
   - *anon public key* → pégala en `config.js` como `SUPABASE_ANON_KEY`

   > La clave `anon` está pensada para ser pública: la seguridad la dan las políticas
   > RLS del paso 3 más tu contraseña.

7. Abre la app, entra con tu correo y contraseña, y listo.

## Nota sobre el plan gratuito

Supabase pausa los proyectos gratuitos tras ~1 semana sin uso. Si algún día la app no carga
o no te deja entrar, entra al dashboard de Supabase y pulsa "Restore project" (tus datos
no se pierden).

## Usar e instalar en tus dispositivos

La app vive en <https://pvicen.github.io/app-avisos/> — **ojo: siempre con la barra final**,
así funciona también sin conexión.

- **Celular (Android)**: abre la dirección en Chrome o Samsung Internet, menú ⋮ →
  **"Agregar a pantalla de inicio"** (o "Instalar aplicación"). Queda como una app más,
  con su ícono, y se abre a pantalla completa.
- **iPhone**: abre la dirección en **Safari**, toca **Compartir** (el cuadrado con la
  flecha) → **"Agregar a inicio"**. Hay que abrirla desde ese ícono para poder activar las
  notificaciones (iOS 16.4 o superior).
- **PC (Chrome/Edge)**: abre la dirección y pulsa el icono de **instalar** a la derecha
  de la barra de direcciones (o menú ⋮ → "Instalar Avisos"). Queda con ventana propia
  e icono en la barra de tareas, y puedes dejarla como ventanita chica en el escritorio.

## Compartir la app con otra persona

La lista es común: todas las personas ven, agregan y completan los mismos avisos, cada una
con su propia cuenta. Una vez ejecutada la migración
[`2026-09-25-app-compartida.sql`](setup/migraciones/2026-09-25-app-compartida.sql):

1. En **Authentication → Users → Add user → Create new user**, crea su cuenta con su correo
   y una contraseña temporal (marca *Auto Confirm User*).
2. En el **SQL Editor**, súmala a la lista:

   ```sql
   insert into public.personas (correo, nombre) values (lower('su-correo@ejemplo.com'), 'Su nombre');
   ```

3. Pásale el link. Entra con su correo y la contraseña temporal, y la cambia desde su
   avatar (arriba a la derecha) → **Cambiar contraseña**.

Para quitar a alguien: `delete from public.personas where correo = 'su-correo@ejemplo.com';`
(y, si quieres, borra su usuario en Authentication → Users).

## Notificaciones push (opcional)

Para que el celular/PC avise cuando un aviso vence (incluso con la app cerrada) hace falta
una Edge Function en Supabase que revisa cada minuto y envía el push. Configuración (una vez):

1. **Función**: Dashboard → **Edge Functions** → *Deploy a new function* → nombre `notificar`,
   pega el contenido de [`supabase/functions/notificar/index.ts`](supabase/functions/notificar/index.ts),
   añade un segundo archivo llamado exactamente `reglas.mjs` con el contenido de
   [`supabase/functions/notificar/reglas.mjs`](supabase/functions/notificar/reglas.mjs) (si el
   editor lo crea como `file2.ts`, renómbralo) y despliega. En los detalles de la función,
   **desactiva "Verify JWT"** (la protege el secreto del cron).
2. **Secretos**: en Edge Functions → **Secrets** agrega:
   - `VAPID_KEYS`: el JSON con las llaves VAPID (generadas al configurar el proyecto)
   - `VAPID_SUBJECT`: `mailto:tu-correo`
   - `CRON_SECRET`: una cadena aleatoria larga
3. **Migraciones**: ejecuta [`setup/migraciones/2026-08-25-notas-notificaciones.sql`](setup/migraciones/2026-08-25-notas-notificaciones.sql)
   en el SQL Editor (reemplazando el correo) y, para la hora exacta,
   [`setup/migraciones/2026-10-08-hora.sql`](setup/migraciones/2026-10-08-hora.sql) (tiene que
   salir `PASA`).
4. **Cron**: en el SQL Editor, con tu ref de proyecto y tu CRON_SECRET:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('avisos-notificar', '* * * * *', $$
     select net.http_post(
       url := 'https://TU_REF.supabase.co/functions/v1/notificar',
       headers := '{"Content-Type":"application/json","x-cron-secret":"TU_CRON_SECRET"}'::jsonb,
       body := '{}'::jsonb
     );
   $$);
   ```

   Si ya tenías el cron de antes (cada hora, `'5 * * * *'`), basta con cambiarle el horario:

   ```sql
   select cron.alter_job(
     job_id := (select jobid from cron.job where jobname = 'avisos-notificar'),
     schedule := '* * * * *'
   );
   ```

5. En la app, toca **🔔** en cada dispositivo donde quieras recibir avisos y acepta el permiso.

La función trabaja en **hora de España** y notifica **una vez por aviso**: los que tienen
fecha y no hora, el día en que vencen desde las 9:00; los que tienen hora, a esa hora (con
hasta un minuto de retraso), y no en el aviso de las 9:00. Si se le cambia la fecha o la hora,
vuelve a sonar. Las notificaciones de vencimiento llegan a todos los dispositivos donde se activó
la 🔔; las de [«te toca a ti»](#te-toca-a-ti), solo a los de la persona que corresponde.
La llave pública VAPID va en `config.js`; la privada solo vive en los secretos de Supabase.

## Te toca a ti

Con más de una persona en la app, al tocar un aviso aparecen **«Para Ana»** y **«Para mí»**: el
aviso queda con la etiqueta «Para ti» / «Para Ana» (en el color de esa persona, también en el
widget) y el saludo cuenta cuántos son para ti. Tocar otra vez la píldora activa lo quita.

- Al pasarle un aviso a otra persona, **le llega una notificación**: «👉 Te toca: comprar pan ·
  Te lo pasó Vicente».
- Cuando alguien termina un aviso que **anotó otra persona o que le tocaba a otra**, a esa otra le
  llega «✅ Vicente terminó: comprar pan». Lo que uno anota y termina él mismo no avisa a nadie.
- Las envía `Notificar` en su vuelta de cada minuto, solo a los dispositivos de esa persona (donde
  activó la 🔔). Necesita la migración
  [`setup/migraciones/2026-10-09-te-toca.sql`](setup/migraciones/2026-10-09-te-toca.sql) y su
  prueba [`setup/pruebas/te-toca.md`](setup/pruebas/te-toca.md).

## Escribir como hablas

Al escribir un aviso en la barra (o dictarlo con el micrófono del teclado), la app busca la
fecha y la hora en el texto y las enseña encima de la barra antes de guardar: «📅 Mañana ·
18:00 · comprar pan». Al pulsar **+**, el aviso se guarda sin esas palabras y con su fecha y
hora. La **✕** de esa vista previa lo guarda tal cual, sin fecha. Todo se interpreta en el
dispositivo ([`interpretar.js`](interpretar.js)); el texto no se manda a ningún servicio.

- **Días:** hoy, mañana, pasado mañana, en 3 días, dentro de una semana, el lunes (el próximo;
  si hoy es lunes, el de la semana que viene), el 15, el 15 de octubre, 15/10.
- **Horas:** a las 18:30, a las 6 y media, y cuarto, menos cuarto, de la mañana / de la tarde /
  de la noche, 6pm, a mediodía (12:00), por la mañana (9:00), por la tarde (17:00), por la
  noche (21:00), esta tarde, esta noche.
- **«A las 6» a secas:** de la 1 a las 7 es por la tarde; de las 8 a las 12, por la mañana
  (para las 8 de la tarde, dilo: «a las 8 de la tarde» o «a las 20»). Con un cero delante
  («a las 07:30») es la hora tal cual.
- **Una hora sin día** es para hoy, o para mañana si ya pasó.

El botón **+** del widget de Android guarda el texto tal cual (no lo interpreta).

## Compartir → Aviso (Android)

Con la app instalada, al **Compartir** texto desde cualquier app puedes elegir **Avisos**:
el texto queda listo en la barra de escribir para revisarlo y agregarlo con **+**. Si "Avisos" no
aparece en el menú de compartir, quita el ícono de la pantalla de inicio y vuelve a instalarla.

## Panel personal (solo para su dueño)

Una pestaña **Panel**, al lado de Avisos, con lo de cada día: las clases y los bloques de estudio
de hoy, los ejercicios del día (con su solución y un «Hecho»), las entregas y los parciales con los
días que faltan, el resto de la semana, las novedades de Canvas y, más adelante, los proyectos.

- **Solo lo ve su dueño.** A las demás personas de la app no les aparece la pestaña, y la base no
  les devuelve nada: ni en la app, ni por la API, ni en tiempo real.
- **Lo llena el portátil del dueño**, con un programa que vive fuera de este repo y manda un JSON a
  la Edge Function `panel-subir` después de cada descarga. El formato exacto (Contrato C1), la
  tabla, la función y la vista están en [`docs/panel-contrato.md`](docs/panel-contrato.md).
- **La app nunca escribe en el panel.** La tabla `panel` solo tiene una política de lectura y la
  app no tiene permiso de escritura; la llena la función con la service role.
- **Sin conexión** se ve la última copia guardada en el dispositivo, marcada como tal. Al cerrar
  sesión se borra, junto con los «Hecho».

### Configuración (una vez)

1. **Tabla.** En el SQL Editor, ejecuta
   [`setup/migraciones/2026-10-08-panel.sql`](setup/migraciones/2026-10-08-panel.sql) y después el
   bloque de [`setup/pruebas/panel-rls.md`](setup/pruebas/panel-rls.md): todo tiene que salir
   `PASA`. Si la API dice que no encuentra la tabla, ejecuta `notify pgrst, 'reload schema';`.
2. **Clave del portátil.** En el portátil, en PowerShell. La clave no pasa por ningún chat ni se
   guarda en Windows: vive solo en esa ventana (`$env:PANEL_CLAVE`) y se copia al portapapeles:

   ```powershell
   $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $env:PANEL_CLAVE = -join ($b | ForEach-Object { $_.ToString("x2") }); Set-Clipboard $env:PANEL_CLAVE
   ```

   No cierres esa ventana hasta la prueba del paso 5. El programa del portátil necesita la misma
   clave: dásela como indique ese programa, nunca dentro de este repo.
3. **Secretos** (Edge Functions → Secrets): `PANEL_CLAVE`, pegando la clave, y `PANEL_DUENO`, el
   correo del dueño en minúsculas. El dueño sale de este secreto, nunca de la petición. Después,
   **borra el portapapeles** en la misma ventana:

   ```powershell
   Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::Clear()
   ```

   Si tienes activado el historial del portapapeles (Win+V), borra también ahí esa entrada.
4. **Función.** Edge Functions → *Deploy a new function* → *Via Editor*. En «Function name», el
   nombre `panel-subir`, tal cual. Hacen falta los dos archivos de
   [`supabase/functions/panel-subir/`](supabase/functions/panel-subir/): `index.ts` y `validar.mjs`
   (el segundo archivo que crea el editor hay que renombrarlo a `validar.mjs`). Despliégala y, en
   sus ajustes, apaga **Enforce JWT verification**: el portátil no tiene sesión, entra con la clave.
5. **Prueba.** En la misma ventana de PowerShell, desde la carpeta del repo:

   ```powershell
   Invoke-WebRequest -Method Post -Uri "https://TU_REF.supabase.co/functions/v1/panel-subir" -Headers @{ "x-panel-clave" = $env:PANEL_CLAVE } -ContentType "application/json" -Body ([IO.File]::ReadAllBytes("setup\panel-ejemplo.json")) -UseBasicParsing
   ```

   Tiene que responder **204**. Deja el ejemplo inventado en el panel hasta que el portátil mande
   los datos de verdad. Sin clave responde 401; con otro método, 405; y si el JSON no cumple el
   Contrato, 400 con los motivos.

Cada vez que cambie `validar.mjs` hay que volver a desplegar la función.

### Probar y desarrollar

- `node --test` desde la raíz del repo ejecuta las pruebas del validador y de la función, que están
  en `setup/pruebas/`.
- En la vista previa local, `?panel=ejemplo` (solo en `localhost`) carga
  [`setup/panel-ejemplo.json`](setup/panel-ejemplo.json), con datos inventados y sus fechas
  corridas a hoy; `&horas=5` simula que el portátil lleva 5 horas sin mandar datos.
- Las fórmulas se pintan con KaTeX 0.16.47 (jsDelivr, con SRI), que solo se descarga si hay panel.
