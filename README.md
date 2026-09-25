# 📌 App de avisos

Lista de pendientes compartida entre personas y dispositivos (PCs, notebook, Android e
iPhone), sincronizada en tiempo real. Agregas un aviso en un dispositivo y aparece al
instante en los demás; lo marcas como hecho y pasa al historial en todos. Al tocar un
aviso aparecen sus opciones: editarlo, agregarle una nota, marcarlo como importante (sube
al principio con una franja coral) y ponerle fecha límite (se destaca cuando está por
vencer). Cada aviso muestra quién lo anotó y el historial quién lo hizo; desde ahí se
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
una Edge Function en Supabase que revisa cada hora y envía el push. Configuración (una vez):

1. **Función**: Dashboard → **Edge Functions** → *Deploy a new function* → nombre `notificar`,
   pega el contenido de [`supabase/functions/notificar/index.ts`](supabase/functions/notificar/index.ts)
   y despliega. En los detalles de la función, **desactiva "Verify JWT"** (la protege el
   secreto del cron).
2. **Secretos**: en Edge Functions → **Secrets** agrega:
   - `VAPID_KEYS`: el JSON con las llaves VAPID (generadas al configurar el proyecto)
   - `VAPID_SUBJECT`: `mailto:tu-correo`
   - `CRON_SECRET`: una cadena aleatoria larga
3. **Migración**: ejecuta [`setup/migraciones/2026-08-25-notas-notificaciones.sql`](setup/migraciones/2026-08-25-notas-notificaciones.sql)
   en el SQL Editor (reemplazando el correo).
4. **Cron**: en el SQL Editor, con tu ref de proyecto y tu CRON_SECRET:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select cron.schedule('avisos-notificar', '5 * * * *', $$
     select net.http_post(
       url := 'https://TU_REF.supabase.co/functions/v1/notificar',
       headers := '{"Content-Type":"application/json","x-cron-secret":"TU_CRON_SECRET"}'::jsonb,
       body := '{}'::jsonb
     );
   $$);
   ```

5. En la app, toca **🔔** en cada dispositivo donde quieras recibir avisos y acepta el permiso.

La función notifica **una vez por aviso** el día en que vence (desde las 9:00, hora de Chile).
La llave pública VAPID va en `config.js`; la privada solo vive en los secretos de Supabase.

## Compartir → Aviso (Android)

Con la app instalada, al **Compartir** texto desde cualquier app puedes elegir **Avisos**:
el texto queda listo en la barra de escribir para revisarlo y agregarlo con **+**. Si "Avisos" no
aparece en el menú de compartir, quita el ícono de la pantalla de inicio y vuelve a instalarla.
