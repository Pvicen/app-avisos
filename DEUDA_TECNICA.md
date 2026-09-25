# Deuda técnica

Errores o límites no críticos, anotados para no frenar el avance (método C.C.D. §3).
Nada de esto es bloqueante ni pone en riesgo datos o seguridad.

## App compartida (2026-09-25)

- **"Vaciar historial" borra el de todos.** La lista es común, así que vaciarlo la deja
  vacía para todas las personas. La confirmación lo avisa ("Se borra para todos").
- **La identidad es el correo.** `personas`, `creado_por`, `completado_por` y
  `push_suscripciones.correo` guardan correos. Si alguien cambia su correo en Supabase hay
  que actualizar su fila de `personas`; sus avisos antiguos seguirán con el correo viejo
  (se mostrarán sin nombre).
- **Las personas se gestionan solo desde el SQL Editor.** No hay pantalla para sumar o
  quitar personas; se hace con un `insert`/`delete` en `personas`.
- **Contraseña olvidada.** La app no tiene "recuperar contraseña"; se resuelve desde el
  panel de Supabase (Authentication → Users).
- **Widget de Android sin autoría.** Muestra la lista compartida, pero no quién anotó cada
  aviso. Funciona igual que antes gracias a los valores que fija el servidor.
- **Notificaciones sin autoría.** Llegan a todos los dispositivos de todas las personas,
  sin decir quién anotó el aviso.

## Diseño "Cálido" (2026-09-25)

- **Fuente Nunito desde Google Fonts.** Sin conexión y con la caché del navegador vencida,
  se ve la fuente del sistema (la app sigue funcionando).
- **Barra de escribir fija abajo en iPhone.** Se sube sobre el teclado con `visualViewport`;
  probado solo en simulación de ancho de celular, no en un iPhone real.
- **Editar el texto con el avatar al lado.** En pantallas angostas el campo de edición
  queda algo corto (el texto se desplaza); se puede ocultar el avatar mientras se edita.
- **Selector de fecha en iPhone.** Si el selector nativo dispara `change` antes de cerrar,
  el aviso se guarda con la primera fecha tocada (luego se puede cambiar).
