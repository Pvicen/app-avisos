# Contrato del Panel personal (Fase 1)

Copia dentro del repo de los Contratos C1, C2 y C3 del encargo 113. El Panel es una pantalla de la
app que solo ve su dueño. La alimenta un JSON que manda su portátil cada hora desde un productor que
vive **fuera de este repo** (Caja P).

- Los valores del ejemplo de C1 son **inventados**: el repo es público.
- La tabla, la migración, la Edge Function `panel-subir` y la vista que nombra este Contrato se crean
  en las Cajas C1, C2 y C3 del encargo. Hasta entonces solo existen aquí.
- Un JSON completo de ejemplo que cumple C1 está en `setup/panel-ejemplo.json`.

## C1 — El JSON del panel, versión 1

Lo produce el portátil (Caja P, fuera de este repo) y lo consumen la Edge Function y la vista. **Es
exacto: ni campos de más ni de menos.**

```jsonc
{
  "version": 1,                                   // entero; siempre 1 en este Contrato
  "generado": "2026-10-08T17:10:00+02:00",        // ISO 8601 con zona: cuándo lo generó el portátil
  "dias": [                                       // de 1 a 7; el primero es HOY (zona Europe/Madrid)
    { "fecha": "2026-10-08",                      // AAAA-MM-DD
      "clases": "Astronomía 9-11 · Botánica 12-14",   // ≤ 200; "" si no hay clase
      "estudio": [                                // de 0 a 12 bloques
        { "materia": "Astronomía", "texto": "Repasar las leyes de Kepler", "duracion": "1h" } ] } ],
  "entregas": [                                   // de 0 a 50, ordenadas por "vence"
    { "materia": "Botánica", "titulo": "Informe del herbario", "vence": "2026-10-09T23:59:00+02:00",
      "url": "https://canvas.ucam.edu/courses/101/assignments/1001" } ],   // o null
  "parciales": [                                  // de 0 a 20, ordenados por "fecha"
    { "materia": "Astronomía", "fecha": "2026-10-27", "hora": "9:00-11:00" } ],   // hora ≤ 20, puede ser ""
  "novedades": [                                  // de 0 a 50, lo más nuevo primero (últimos 7 días)
    { "materia": "Música", "titulo": "Partitura del tema 2.pdf", "fecha": "2026-10-08T10:05:00+02:00",
      "tipo": "archivo" } ],                      // "archivo" | "tarea"
  "ejercicios": [                                 // de 0 a 10: los de HOY
    { "id": "ast-0001", "materia": "Astronomía", "tema": "Tercera ley de Kepler",
      "enunciado": "Con $T^2 = a^3$, ¿cuál es el periodo si $a = 4$ UA?", "solucion": "…", "nivel": 1 } ],
  "banco": [ { "materia": "Astronomía", "quedan": 23 } ],   // de 0 a 12: ejercicios sin usar por materia
  "proyectos": [                                  // de 0 a 20 (Fase 2: de momento llega vacío)
    { "nombre": "Proyecto de ejemplo", "estado": "Fase 2: 3 de 8 Cajas", "siguiente": "Revisar la Caja 4",
      "fecha": "2026-10-08" } ]
}
```

**Límites:**
- Cuerpo entero: 256 KB como máximo.
- Longitud de los textos:

  | Campo | Máximo |
  |---|---|
  | `materia`, `nombre` | 60 |
  | `titulo` | 200 |
  | `texto` | 300 |
  | `duracion` | 20 |
  | `tema` | 120 |
  | `estado`, `siguiente` | 200 |
  | `enunciado` | 4000 |
  | `solucion` | 8000 |
  | `url` | 300 |

- `id`: `^[a-z0-9-]{1,40}$`.
- `nivel`: 1, 2 o 3.
- `quedan`: entero de 0 a 9999.
- `url`: `null` o una cadena que empiece por `https://canvas.ucam.edu/`.

**Formato del texto:**
- Todos los textos son **texto plano**.
- Solo `enunciado` y `solucion` pueden llevar saltos de línea (`\n`) y fórmulas en LaTeX: `$…$` en línea y `$$…$$`
  en bloque.
- **Ningún campo lleva HTML.** La vista nunca lo interpreta.

## C2 — Dónde vive y cómo llega

**Tabla** (migración nueva en `setup/migraciones/`):

```sql
create table if not exists public.panel (
  dueno     text primary key check (dueno = lower(dueno)),
  datos     jsonb not null,
  version   int not null,
  generado  timestamptz not null,
  recibido  timestamptz not null default now()
);
alter table public.panel enable row level security;
-- Solo su dueño la lee; el cliente NUNCA escribe (no hay políticas de insert, update ni delete)
create policy "leer mi panel" on public.panel for select to authenticated
  using (dueno = (select lower(auth.jwt()->>'email')) and (select public.es_persona()));
alter publication supabase_realtime add table public.panel;   -- que no falle si ya está
```

**Edge Function `panel-subir`** (en minúsculas, exactamente):
- Solo acepta `POST`.
- La autenticación es la cabecera `x-panel-clave`, comparada en tiempo constante con el secreto `PANEL_CLAVE`.
  - Se despliega con «Verify JWT» **apagado**: el portátil no tiene sesión de usuario.
- **El dueño sale del secreto `PANEL_DUENO`**, el correo en minúsculas, **nunca de la petición**. Así, una clave que
  se filtre solo puede pisar el panel de su dueño, no crear filas para otros.
- Cuerpo de más de 256 KB → 413. JSON que no cumple C1 → 400, con una lista corta de motivos.
- Si está bien: hace un `upsert` en `panel` con la service role (`on conflict (dueno)`) y responde 204.
- Errores: clave mala → 401; otro método → 405.
- Sin CORS: no la llama ningún navegador.
- Nunca escribe el cuerpo en los logs: son datos personales.
- **La validación de C1 va en un módulo aparte, `supabase/functions/panel-subir/validar.mjs`**, en JS puro sin APIs de
  Deno. Lo importan la función y las pruebas. En la laptop hay Node y no hay Deno ni la CLI de Supabase.

## C3 — La vista

- Botón o pestaña **«Panel»** en la cabecera. Solo aparece si la consulta a `panel` devuelve una fila: a las demás
  personas de la app no les sale.
- **Lo que se ve, en este orden:**
  1. **Hoy:** las clases y los bloques de estudio.
  2. **Ejercicios de hoy:**
     - cada uno con su materia, su tema y su nivel;
     - un botón «Ver solución» que despliega la solución;
     - «Hecho», guardado en `localStorage` con la clave `panel-hecho:<id>`.
  3. **Entregas y parciales:**
     - juntos y ordenados por fecha;
     - con el texto «hoy», «mañana» o «faltan N días»;
     - color por urgencia: dos días o menos, coral; siete o menos, ámbar; el resto, neutro;
     - lo vencido no se muestra;
     - el enlace a Canvas, si lo hay.
  4. **Esta semana:** los días siguientes, plegables.
  5. **Novedades de Canvas.**
  6. **Proyectos:** solo si el array no viene vacío.
  7. **Al pie:**
     - «Actualizado hace X»;
     - si el JSON tiene más de 3 horas, un aviso: «Tu portátil no manda datos desde …»;
     - si a alguna materia le quedan menos de 5 ejercicios en `banco`: «Quedan pocos ejercicios de X».
- **Fórmulas:** KaTeX desde jsDelivr, la última 0.16.x estable, con versión fijada y SRI.
  - Se pinta a mano: partes el texto en trozos de texto plano y trozos de fórmula. El texto va como nodos de texto.
  - Cada fórmula va con `katex.render(formula, span, { throwOnError: false, trust: false, displayMode })`.
  - **Nunca `innerHTML` con datos del JSON.** Los enlaces solo si empiezan por `https://canvas.ucam.edu/`.
- **Tiempo real:**
  - suscripción a los cambios de `panel`, como ya se hace con los avisos;
  - se vuelve a cargar al volver a la app (`visibilitychange`).
- **Sin conexión:**
  - se guarda el último panel en `localStorage` y se enseña marcado como «sin conexión»;
  - **al cerrar sesión se borra** esa copia y todas las claves `panel-hecho:*`.
- **Para probarlo en local:**
  - con `?panel=ejemplo` y **solo en `localhost`**, la vista carga `setup/panel-ejemplo.json` en vez de Supabase;
  - `setup/` no se publica en Pages.
- **Que se vea profesional, dentro del estilo «Cálido»:**
  - tarjetas con jerarquía clara;
  - pensado primero para un móvil de 360 px;
  - modo oscuro;
  - estados de carga y vacíos cuidados;
  - accesible (roles, `aria-label`, buen contraste);
  - la pestaña que se usó la última vez se recuerda en `localStorage`;
  - la app sigue abriendo en Avisos si no hay panel.
