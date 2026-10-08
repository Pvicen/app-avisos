# App de avisos — Reglas del proyecto

Lista de pendientes compartida (PWA en HTML/JS sin build + Supabase), publicada en GitHub Pages
en https://pvicen.github.io/app-avisos/ (siempre con la barra final). Estas reglas complementan (y
en conflicto, prevalecen sobre) el `AGENTS.md` general de `C:\Dev`. Vicente decide; la IA ejecuta
la Caja que él manda.

## Método C.C.D. y escalada de modelos

**C**ajas, **C**ontratos y **D**euda Técnica. Documento maestro de Vicente (2026-09-25; §6
añadido el 2026-10-08), piedra angular de todo repo bajo `C:\Dev`; se reproduce igual en cada
`AGENTS.md`. La IA solo ejecuta lo que Vicente manda por Cajas.

### 1. Ley primera: avance sobre perfección
El objetivo del desarrollador y las IAs es alcanzar el Producto Mínimo Viable (MVP). Si el «Camino
Feliz» funciona y no hay riesgos graves, se aprueba y se avanza.
* **Prohibido:** los bucles de refutación. La IA no decide si el código está perfecto; el
  desarrollador (Arquitecto) es el árbitro final.

### 2. Arquitectura por Cajas y Contratos
* **Las Cajas:** todo se programa de forma aislada (Caja Red, Caja BD, Caja Interfaz).
* **Aislamiento de contexto:** al programar una Caja, NUNCA se pasa a la IA el código de las demás
  Cajas.
* **Los Contratos:** el único puente entre Cajas es el Contrato (el formato exacto de los datos que
  entran y salen, p. ej. un JSON). A la IA solo se le pasa este Contrato como contexto para que
  programe la Caja correspondiente.

### 3. Gestión de deuda técnica
* **Errores medios/bajos:** optimizaciones, estética o casos de borde improbables NO se arreglan en
  la fase de construcción.
* **Archivo `DEUDA_TECNICA.md`:** cada proyecto tiene este archivo en su raíz. Todo error no crítico
  se anota aquí con su explicación y se ignora temporalmente.
* Solo se detiene el avance ante errores **Bloqueantes** (crasheos absolutos) o **Altos** (brechas
  de seguridad, pérdida de datos).

### 4. La regla de los subagentes (solo exploración)
* **Prohibido:** usar subagentes para debatir, buscar bugs o criticar código ya escrito.
* **Uso permitido:** «Exploradores de Contratos». Antes de programar se pueden lanzar un número
  estricto y limitado de subagentes (2 o 3) SOLO para leer Cajas distintas y proponer el Contrato
  que las va a unir. Una vez hecho el molde, los subagentes desaparecen.

### 5. Matriz de escalada de modelos (uso eficiente de tokens)
* **Nivel 1 — El día a día (Opus 5.5, modo estándar):** el 90 % del trabajo. Hacer moldes,
  programar Cajas individuales a partir de Contratos, lanzar subagentes de exploración. Consumo
  eficiente.
* **Nivel 2 — El refactorizador menor (Fable 5.1, modo estándar):** cuando hay un cambio de rumbo
  arquitectónico y hay que reescribir varios archivos para que sigan una nueva lógica. Mantiene
  excelente coherencia narrativa.
* **Nivel 3 — El botón nuclear algorítmico (Opus 5.5, UltraCode):** uso quirúrgico y
  ultra-restringido. Solo para crear desde cero cuellos de botella lógicos o matemáticos muy
  complejos (p. ej. el motor del Análisis Financiero). Se usa, se copia el código y se vuelve al
  Nivel 1.
* **Nivel 4 — El mega-refactor / cataclismo (Fable 5.1, UltraCode):** solo en migraciones masivas
  de tecnología o cambios estructurales que reescriben la mayoría del proyecto manteniendo lógica
  compleja de fondo.
* **Nivel 5 — El Tribunal Supremo / auditor final (GPT-6 Astra Ultra):** la última fase de la
  inteligencia. Cero programación. Misiones exclusivas: (1) **Auditoría final:** al terminar una
  Caja crítica se le pasa el código a GPT para buscar ÚNICAMENTE vulnerabilidades Altas o
  Bloqueantes; si está limpio, responde «CAJA APROBADA». (2) **El Solucionador (fallback):** si los
  modelos anteriores fracasan resolviendo un crasheo grave, se le pasa el problema a Astra para que
  diagnostique y repare.

### 6. Lotes y Cajas críticas (enmienda de Vicente, 2026-10-08)
Antes de programar, cada Caja se clasifica. **Ante la duda, es crítica.**
* **Caja de lote (fácil):** documentación o código satélite, con su Contrato aprobado, que no usa
  la salida de otra Caja del mismo lote ni toca el núcleo del repo (esquema de la base de datos,
  migraciones, protocolo, seguridad, núcleo protegido). Se hacen **hasta 5 seguidas**, una detrás
  de otra y sin pedir permiso entre ellas, cada una programada solo contra su Contrato, con su gate
  en verde y su propio commit en la rama. Si necesita mirar el código de otra, no es de lote.
* **Caja crítica:** la que toca el núcleo (p. ej. crear la base de datos) o un algoritmo central.
  Se hace **sola**, de una en una.
* **Parada:** al terminar un lote o una Caja crítica, la IA se detiene para la verificación y el
  arbitraje de Vicente. El push y el merge, solo con su orden.
* **Errores dentro de un lote:** lo medio y lo bajo va a `DEUDA_TECNICA.md` y el lote sigue. Ante
  algo Bloqueante o Alto, el lote se detiene: esa Caja no se commitea, las anteriores se quedan y
  se avisa a Vicente.
* **Modelo:** lo fija la matriz (§5). Un lote es Nivel 1; una Caja crítica también, salvo si es un
  cuello de botella algorítmico (Nivel 3). Un cambio de rumbo sigue siendo Nivel 2 o 4.

## Cajas de este repo

| Caja | Ficheros | Contrato que la une al resto |
|---|---|---|
| Interfaz | `index.html`, `app.js`, `style.css` | Columnas de `avisos` y `personas` |
| Cáscara PWA | `sw.js`, `manifest.webmanifest`, `icons/` | Lista `ASSETS` y número `CACHE` de `sw.js` |
| BD | `setup/supabase.sql` y `setup/migraciones/` (en orden) | Cabecera «Contrato de datos» de `setup/migraciones/2026-09-25-app-compartida.sql` |
| Notificaciones | `supabase/functions/notificar/index.ts` | Lee `avisos` y `push_suscripciones` con la service role |
| Configuración | `config.js` | Solo claves públicas: URL, clave anon y llave VAPID pública |
| Panel | `supabase/functions/panel-subir/`, la tabla `panel` y su vista en `app.js` | Contratos C1, C2 y C3 de `docs/panel-contrato.md` |

Fuera de este repo, y sin romperlos: el widget de Android (repo `Pvicen/avisos-widget`, que lee
`avisos` con `creado_por` y `personas`) y la app instalada en iPhone.

**Lotes (C.C.D. §6):** son críticas toda migración o cambio de RLS, toda Edge Function y lo que
toque sesión, permisos o datos de otra persona; la documentación y los ajustes de estilo pueden ir
en lote.

## Qué no hacer

- **No meter datos personales en el repo.** Es PÚBLICO y se sirve en Pages: ni el plan de Vicente,
  ni sus asignaturas reales, ni correos, ni claves. Ejemplos y pruebas, con datos inventados.
- **No exponer lo de una persona a otra.** La lista de avisos es común a todas las personas de la
  tabla `personas` (función `es_persona()`) y eso no cambia. Lo que sea solo de Vicente (su panel)
  no lo ve nadie más: ni por la app, ni por la API, ni por realtime.
- **No romper lo que funciona:** avisos, historial, notificaciones, widget e instalación en
  iPhone. La Edge Function desplegada se llama `Notificar`, con mayúscula (el cron apunta ahí),
  aunque en el repo viva en `supabase/functions/notificar/`.
- **No poner secretos en el repo ni en el chat, ni pedírselos a Vicente.** Los pone él en Supabase
  (Edge Functions → Secrets). En `config.js` solo va lo público.
- **No ejecutar SQL ni desplegar.** Lo hace Vicente desde el panel de Supabase: se le deja el
  archivo y los pasos exactos. Toda migración va en `setup/migraciones/`, se puede ejecutar dos
  veces y es compatible con la app publicada y con el widget.
- **No añadir build ni librerías sueltas.** Las de CDN, con versión fijada y SRI (como supabase-js
  en `index.html`). Si cambia un asset o una URL de CDN, sube el número de `CACHE` en `sw.js`.
- **No usar `innerHTML` con datos** de la base o de un JSON: nodos de texto y `textContent`.
- **No salirse del estilo «Cálido»** (variables de color al principio de `style.css`, con su modo
  oscuro) ni del español en textos, código, docs y commits.
- **No hacer push ni merge sin su orden.** Ramas desde `main`, un commit por Caja.

## Dónde mirar

- `README.md` — qué hace la app, instalación en cada dispositivo, notificaciones y cómo sumar a
  otra persona.
- `DEUDA_TECNICA.md` — errores no críticos anotados.
- `setup/migraciones/2026-09-25-app-compartida.sql` — el Contrato de datos vigente y la RLS.
- `docs/panel-contrato.md` — el Contrato del panel personal (JSON, tabla, función y vista).
- `setup/pruebas/` — las pruebas `node --test` y las comprobaciones de RLS del panel.
- `_config.yml` — lo que NO se publica en Pages (aquí va todo lo que no es la app).

## Ejecutar y verificar

Vista previa local: configuración `avisos` de `C:\Dev\.claude\launch.json` (puerto 8123,
http://localhost:8123/). Sin sesión solo se ve la entrada; para mirar la lista se pintan datos
inventados desde la consola, sin tocar Supabase. El panel se prueba con `?panel=ejemplo`, que
solo funciona en localhost y lee `setup/panel-ejemplo.json`.

Las pruebas automáticas son las del panel (`setup/pruebas/`). Gate mínimo antes de commitear:

```powershell
node --check app.js; node --check sw.js; node --test
```

y abrir la vista previa sin errores en la consola. Lo que toque la lista se prueba a 360 px y en
escritorio, en claro y en oscuro.
