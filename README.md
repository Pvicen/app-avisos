# 📌 App de avisos

Lista de pendientes compartida entre todos tus dispositivos (PCs, notebook y celular),
sincronizada en tiempo real. Agregas un aviso en un dispositivo y aparece al instante
en los demás; lo marcas como hecho y desaparece en todos (con botón "Deshacer" por si
te equivocas).

## Cómo funciona

- Una sola página web (`index.html`) que se abre desde el navegador de cualquier dispositivo.
- Los avisos se guardan en **Supabase** (base de datos gratuita en la nube).
- Protegida con usuario y contraseña: inicias sesión una vez en cada dispositivo y queda
  guardada. Las políticas de seguridad (RLS) solo dejan ver y tocar los avisos a tu correo.
- Si la conexión en tiempo real se cae, la app reintenta sola y además refresca la lista
  al volver a la pestaña, al recuperar internet y cada 2 minutos.

## Configuración inicial (una sola vez)

1. **Crear cuenta en Supabase**: entra a <https://supabase.com>, pulsa "Start your project"
   y crea una cuenta gratis.
2. **Crear un proyecto**: nombre `avisos` (o el que quieras), inventa una contraseña de base
   de datos (guárdala, aunque no la vas a necesitar en el día a día) y elige la región
   más cercana (South America / São Paulo).
3. **Crear la tabla**: abre [`setup/supabase.sql`](setup/supabase.sql), reemplaza
   `TU_CORREO@ejemplo.com` (aparece 3 veces) por tu correo real, pega todo el contenido
   en el **SQL Editor** de Supabase y pulsa **Run**.
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
- **PC (Chrome/Edge)**: abre la dirección y pulsa el icono de **instalar** a la derecha
  de la barra de direcciones (o menú ⋮ → "Instalar Avisos"). Queda con ventana propia
  e icono en la barra de tareas, y puedes dejarla como ventanita chica en el escritorio.
