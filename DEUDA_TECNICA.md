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

## Escribir como hablas (2026-10-09)

- **«A las 8» es por la mañana.** Por la regla decidida (de la 1 a las 7, tarde; de las 8 a las
  12, tal cual), «cenar a las 8» sale a las 8:00. La vista previa lo enseña antes de guardar;
  hay que decir «de la tarde» o «a las 20».
- **Falsos positivos.** Una frase como «dar de comer a las 2 gatas» se lee como 14:00. Para eso
  está la vista previa con su ✕.
- **La ✕ vale hasta vaciar la barra.** Si después de tocarla se sigue escribiendo una fecha, ya
  no se interpreta; hay que borrar y empezar de nuevo.
- **Lo que no entiende:** «la semana que viene», «a fin de mes», «todos los lunes» (avisos que se
  repiten) ni días festivos. Solo en español.
- **El widget no interpreta.** Su botón + guarda el texto tal cual.
- **Reloj del dispositivo.** «Hoy», «mañana» y «ya pasó» usan la fecha y la hora del teléfono o
  del PC (los dos en España).

## Hora exacta: la función `Notificar` (2026-10-08)

- **Puede llegar hasta un minuto tarde.** El cron la llama cada minuto: un aviso de las 18:00 suena
  en la vuelta de las 18:00 o en la siguiente.
- **Si la función se corta en mitad del envío, ese aviso no vuelve a sonar.** Antes de enviar se
  reserva (se escriben sus marcas) para que dos vueltas no lo repitan; si el corte llega entre la
  reserva y el envío, la marca se queda puesta. Se ve en la app, que sigue mostrando el aviso.
- **Si el push falla siempre (no por dispositivo caducado), se reintenta cada minuto** y deja una
  línea «Fallo push» en los logs de la función en cada vuelta.

## Hora exacta: la interfaz (2026-10-08)

- **«Hoy · 18:00» se rellena hasta 2 minutos tarde.** Con la app abierta, la lista se refresca cada
  2 minutos; la etiqueta cambia a «ya pasó» en ese refresco, no en el minuto justo.
- **Selector de hora en iPhone.** Como el de fecha: si la rueda dispara `change` antes de cerrarse,
  se guarda la primera hora tocada (luego se puede cambiar).
- **Todo en el reloj del dispositivo.** «Hoy», «ya pasó» y «hora sin fecha = hoy o mañana» usan la
  zona del teléfono o el PC; la notificación usa la de España. Con un dispositivo en otra zona
  horaria no cuadrarían.
- **La versión vieja de la app (en caché) no borra la hora al quitar la fecha.** La hora se queda
  guardada pero no se ve ni suena (sin fecha no cuenta); vuelve a verse si se pone fecha.

## Panel personal: Edge Function `panel-subir` (2026-10-08)

- **El validador no mira el reloj.** No comprueba que el primer día de `dias` sea hoy ni que las
  `novedades` sean de los últimos 7 días: con la hora de por medio, un JSON generado a las 23:59 y
  recibido a las 00:00 se rechazaría. Eso lo garantiza el productor; la vista ya decide qué es hoy.

## Panel personal: lo que queda para la Fase 2 (2026-10-08)

- **«Hecho» solo en local.** Los ejercicios hechos se guardan en el dispositivo (`localStorage`):
  no se sincronizan entre el celular y el PC.
- **Sin control de orden si llegan dos JSON a la vez.** El upsert se queda con el que llega último,
  aunque su `generado` sea más viejo.
- **El widget de Android aún no muestra el panel** (ni la próxima entrega).

## Panel personal: la vista (2026-10-08)

- **Color de cada materia por suma de letras.** Con solo cuatro colores, dos materias pueden
  salir del mismo color (en el ejemplo, Astronomía y Música). Se podría fijar un color por materia.
- **Fórmulas sin conexión la primera vez.** KaTeX se baja al ver el panel y queda en caché; si
  la primera apertura es sin red, las fórmulas se ven como texto (`$…$`) hasta que vuelva.
- **Se relee el panel entero** (hasta 256 KB) cada vez que la app vuelve a primer plano.
- **«Ver solución» y los días de «Esta semana» se cierran al recargar** (solo se recuerda «Hecho»).

## Diseño "Cálido" (2026-09-25)

- **Fuente Nunito desde Google Fonts.** Sin conexión y con la caché del navegador vencida,
  se ve la fuente del sistema (la app sigue funcionando).
- **Barra de escribir fija abajo en iPhone.** Se sube sobre el teclado con `visualViewport`;
  probado solo en simulación de ancho de celular, no en un iPhone real.
- **Editar el texto con el avatar al lado.** En pantallas angostas el campo de edición
  queda algo corto (el texto se desplaza); se puede ocultar el avatar mientras se edita.
- **Selector de fecha en iPhone.** Si el selector nativo dispara `change` antes de cerrar,
  el aviso se guarda con la primera fecha tocada (luego se puede cambiar).
