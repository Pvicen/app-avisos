// Reglas de la función `Notificar`: cuándo suena cada aviso y con qué texto, en hora de España.
//
// JS puro, sin APIs de Deno ni de Node: lo importan la Edge Function (index.ts) y las pruebas de
// setup/pruebas/ (node --test). Supabase y el push llegan inyectados en `repartir`, así que todo
// se prueba sin red.
//
// Contrato (setup/migraciones/2026-10-08-hora.sql): `hora` es la hora de España del aviso
// (HH:MM:SS; null = sin hora) y solo cuenta si hay `vence`; `notificado_para` y `notificado_hora`
// dicen para qué fecha y a qué hora sonó ya. La cola de «te toca» y «terminado», en
// setup/migraciones/2026-10-09-te-toca.sql.

export const ZONA = "Europe/Madrid";
/** Los avisos sin hora suenan desde esta hora del día en que vencen. */
export const HORA_DE_LA_MANANA = "09:00:00";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// hourCycle h23: la medianoche es "00" (con hour12:false algunos motores dan "24")
const FORMATO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Fecha (AAAA-MM-DD) y hora (HH:MM:SS) de España en ese instante. */
export function ahoraEnEspana(instante = new Date()) {
  const p = Object.fromEntries(FORMATO.formatToParts(instante).map((x) => [x.type, x.value]));
  return { hoy: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

/**
 * ¿Ya sonó? Sin hora basta con haber sonado para esa fecha (quitarle la hora a un aviso que ya
 * sonó no lo repite); con hora, tiene que haber sonado para esa fecha y esa misma hora.
 */
export function yaSono(a) {
  if (a.notificado_para !== a.vence) return false;
  return !a.hora || a.notificado_hora === a.hora;
}

/** ¿Tiene que sonar ahora? `a` es un aviso pendiente; `ahora`, lo que da ahoraEnEspana. */
export function debeSonar(a, ahora) {
  if (!a.vence || a.vence > ahora.hoy || yaSono(a)) return false;
  if (a.hora) return a.vence < ahora.hoy || a.hora <= ahora.hora;
  return ahora.hora >= HORA_DE_LA_MANANA;
}

/** Texto de la notificación: «Vence hoy», «Hoy a las 18:00», «Venció el 7 oct a las 18:00». */
export function cuerpoDelAviso(a, hoy) {
  const aLasHora = a.hora ? ` a las ${a.hora.slice(0, 5)}` : "";
  if (a.vence === hoy) return a.hora ? `Hoy${aLasHora}` : "Vence hoy";
  return `Venció el ${fechaCorta(a.vence, hoy)}${aLasHora}`;
}

function fechaCorta(fecha, hoy) {
  const [anio, mes, dia] = fecha.split("-");
  return `${Number(dia)} ${MESES[Number(mes) - 1]}` + (anio !== hoy.slice(0, 4) ? ` ${anio}` : "");
}

/**
 * Una vuelta del cron. `e` trae la entrada y la salida:
 *   ahora                        { hoy, hora } de España
 *   leerAvisos(hoy)              pendientes con vence <= hoy: id, texto, vence, hora,
 *                                notificado_para, notificado_hora
 *   leerSuscripciones()          [{ endpoint, datos }]
 *   reservar(aviso)              pone sus marcas si siguen como se leyeron; true = lo envía esta vuelta
 *   devolver(aviso)              deja las marcas como estaban (no llegó a ningún dispositivo)
 *   enviar(suscripcion, mensaje) "ok" | "muerta" (el dispositivo ya no existe) | "fallo"
 *   borrarSuscripcion(endpoint)
 * Devuelve el resumen que responde la función.
 */
export async function repartir(e) {
  const pendientes = (await e.leerAvisos(e.ahora.hoy)).filter((a) => debeSonar(a, e.ahora));
  if (!pendientes.length) return { enviadas: 0 };

  const subs = await e.leerSuscripciones();
  if (!subs.length) return { enviadas: 0, motivo: "sin dispositivos suscritos" };

  let enviadas = 0;
  let fallos = 0;
  const muertas = new Set();

  for (const aviso of pendientes) {
    // Si otra vuelta ya lo tomó, o lo cambiaron entre medias, no se envía
    if (!(await e.reservar(aviso))) continue;
    const mensaje = {
      titulo: "📌 " + aviso.texto,
      cuerpo: cuerpoDelAviso(aviso, e.ahora.hoy),
      tag: "aviso-" + aviso.id,
    };
    let exitos = 0;
    for (const s of subs) {
      if (muertas.has(s.endpoint)) continue;
      const r = await e.enviar(s, mensaje);
      if (r === "ok") {
        enviadas++;
        exitos++;
      } else if (r === "muerta") {
        muertas.add(s.endpoint);
      } else {
        fallos++;
      }
    }
    // No llegó a ningún dispositivo: la vuelta siguiente lo reintenta
    if (exitos === 0) await e.devolver(aviso);
  }

  for (const endpoint of muertas) await e.borrarSuscripcion(endpoint);
  return { enviadas, fallos, dispositivos: subs.length - muertas.size };
}

// ---------- Resumen del lunes (marca en avisos_resumenes, migración 2026-10-09-resumen.sql) ----------

/** El resumen sale los lunes desde esta hora (de España), una vez por persona. */
export const HORA_DEL_RESUMEN = "09:00:00";

function sumarDias(fecha, dias) {
  const d = new Date(fecha + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes (AAAA-MM-DD) de la semana de esa fecha. */
export function lunesDe(fecha) {
  const diaSemana = new Date(fecha + "T00:00:00Z").getUTCDay(); // 0 = domingo
  return sumarDias(fecha, -((diaSemana + 6) % 7));
}

/** ¿Toca el resumen? Los lunes desde las 9:00. */
export function esHoraDelResumen(ahora) {
  return lunesDe(ahora.hoy) === ahora.hoy && ahora.hora >= HORA_DEL_RESUMEN;
}

function plural(n, uno, varios) {
  return n + " " + (n === 1 ? uno : varios);
}

/**
 * El resumen de una persona (`correo`) para la semana que empieza en `lunes`:
 *   pendientes  [{ vence, para }]                       los avisos sin completar
 *   hechos      [{ completado_en, completado_por }]     completados (los de la semana pasada cuentan)
 *   nombres     Map correo → nombre
 * «📋 Semana del 12 oct» · «Esta semana: 5 con fecha · 1 vencido · 2 para ti.» y
 * «La semana pasada hicisteis 12 (Ana 7, tú 5).»
 */
export function resumenDelLunes({ lunes, correo, pendientes, hechos, nombres }) {
  const domingo = sumarDias(lunes, 6);
  const lunesPasado = sumarDias(lunes, -7);
  const conFecha = pendientes.filter((a) => a.vence && a.vence >= lunes && a.vence <= domingo).length;
  const vencidos = pendientes.filter((a) => a.vence && a.vence < lunes).length;
  const paraTi = pendientes.filter((a) => a.para === correo).length;

  const semana = [conFecha ? `Esta semana: ${conFecha} con fecha` : "Semana tranquila: nada con fecha"];
  if (vencidos) semana.push(plural(vencidos, "vencido", "vencidos"));
  if (paraTi) semana.push(`${paraTi} para ti`);

  // Lo hecho entre el lunes pasado y el domingo, en días de España
  const porPersona = new Map();
  for (const h of hechos) {
    const dia = ahoraEnEspana(new Date(h.completado_en)).hoy;
    if (dia < lunesPasado || dia >= lunes) continue;
    const quien = h.completado_por || "";
    porPersona.set(quien, (porPersona.get(quien) || 0) + 1);
  }
  const total = [...porPersona.values()].reduce((a, b) => a + b, 0);
  let pasada;
  if (!total) {
    pasada = "La semana pasada no se completó nada.";
  } else if (nombres.size < 2) {
    pasada = `La semana pasada hiciste ${total}.`;
  } else {
    const desglose = [...porPersona]
      .sort((x, y) => y[1] - x[1])
      .map(([quien, n]) => (quien === correo ? "tú" : nombreDe(quien, nombres) || "otros") + " " + n);
    pasada = `La semana pasada hicisteis ${total} (${desglose.join(", ")}).`;
  }

  const [, mes, dia] = lunes.split("-");
  return {
    titulo: `📋 Semana del ${Number(dia)} ${MESES[Number(mes) - 1]}`,
    cuerpo: semana.join(" · ") + ".\n" + pasada,
    tag: "resumen-" + lunes,
  };
}

/**
 * Envía el resumen del lunes a quien aún no lo tenga. `e` trae:
 *   ahora                        { hoy, hora } de España
 *   forzar                       true: lo envía ya, sin mirar el día ni marcarlo (prueba manual)
 *   leerPersonas()               [{ correo, nombre }]
 *   leerEnviados(lunes)          correos que ya lo tienen
 *   leerPendientes()             [{ vence, para }]
 *   leerHechos()                 [{ completado_en, completado_por }] de los últimos días
 *   leerSuscripciones()          [{ endpoint, datos, correo }]
 *   reservarResumen(lunes, correo)   apunta el envío; true = lo envía esta vuelta
 *   devolverResumen(lunes, correo)   lo borra para reintentarlo (no llegó a ningún dispositivo)
 *   enviar(suscripcion, mensaje) "ok" | "muerta" | "fallo"
 *   borrarSuscripcion(endpoint)
 */
export async function repartirResumen(e) {
  if (!e.forzar && !esHoraDelResumen(e.ahora)) return { resumenes: 0 };
  const lunes = lunesDe(e.ahora.hoy);

  const personas = await e.leerPersonas();
  const enviados = e.forzar ? new Set() : new Set(await e.leerEnviados(lunes));
  const faltan = personas.filter((p) => !enviados.has(p.correo));
  if (!faltan.length) return { resumenes: 0 };

  const [pendientes, hechos, subs] = await Promise.all([e.leerPendientes(), e.leerHechos(), e.leerSuscripciones()]);
  const nombres = new Map(personas.map((p) => [p.correo, p.nombre]));
  let resumenes = 0;
  let fallos = 0;
  const muertas = new Set();

  for (const p of faltan) {
    if (!e.forzar && !(await e.reservarResumen(lunes, p.correo))) continue;
    const mensaje = resumenDelLunes({ lunes, correo: p.correo, pendientes, hechos, nombres });
    if (e.forzar) mensaje.titulo = "(prueba) " + mensaje.titulo;
    let exitos = 0;
    let fallosPersona = 0;
    for (const s of subs) {
      if (s.correo !== p.correo || muertas.has(s.endpoint)) continue;
      const r = await e.enviar(s, mensaje);
      if (r === "ok") exitos++;
      else if (r === "muerta") muertas.add(s.endpoint);
      else fallosPersona++;
    }
    if (exitos) resumenes++;
    fallos += fallosPersona;
    // No llegó a ninguno de sus dispositivos: la vuelta siguiente lo reintenta
    if (!e.forzar && exitos === 0 && fallosPersona > 0) await e.devolverResumen(lunes, p.correo);
  }

  for (const endpoint of muertas) await e.borrarSuscripcion(endpoint);
  return { resumenes, fallos };
}

// ---------- «Te toca a ti» y «terminado» (cola avisos_eventos, migración 2026-10-09-te-toca.sql) ----------

/** Un evento que lleva más de esto esperando ya no se envía (p. ej. si la función estuvo parada). */
export const MAX_HORAS_EVENTO = 12;
/** Envíos fallidos (sin llegar a ningún dispositivo) antes de rendirse con un evento. */
export const MAX_INTENTOS_EVENTO = 5;

/** El nombre de una persona; si no está en `personas`, lo de antes de la @. */
function nombreDe(correo, nombres) {
  if (!correo) return null;
  return nombres.get(correo) || correo.split("@")[0];
}

/** Texto de la notificación: «👉 Te toca: comprar pan» o «✅ Ana terminó: comprar pan». */
export function mensajeDeEvento(ev, nombres) {
  const quien = nombreDe(ev.quien, nombres);
  if (ev.tipo === "te_toca") {
    return {
      titulo: "👉 Te toca: " + ev.texto,
      cuerpo: quien ? `Te lo pasó ${quien}` : "Te lo pasaron",
      tag: "te-toca-" + ev.aviso_id,
    };
  }
  return {
    titulo: `✅ ${quien ? quien + " terminó" : "Terminado"}: ${ev.texto}`,
    cuerpo: "Ya está hecho",
    tag: "terminado-" + ev.aviso_id,
  };
}

/**
 * Envía los eventos pendientes de la cola a los dispositivos de su destinatario. `e` trae:
 *   ahoraMs                      Date.now()
 *   leerEventos()                pendientes por orden: id, tipo, aviso_id, texto, quien, para,
 *                                creado_en, intentos
 *   leerSuscripciones()          [{ endpoint, datos, correo }]
 *   leerPersonas()               [{ correo, nombre }]
 *   reservarEvento(ev)           lo marca como enviado si sigue pendiente; true = lo envía esta vuelta
 *   devolverEvento(ev)           lo deja pendiente otra vez, con un intento más
 *   enviar(suscripcion, mensaje) "ok" | "muerta" | "fallo"
 *   borrarSuscripcion(endpoint)
 * Los viejos, los que ya fallaron demasiado y los de quien no tiene dispositivos se quedan marcados
 * sin enviar.
 */
export async function repartirEventos(e) {
  const eventos = await e.leerEventos();
  if (!eventos.length) return { eventos: 0 };

  const [subs, personas] = await Promise.all([e.leerSuscripciones(), e.leerPersonas()]);
  const nombres = new Map(personas.map((p) => [p.correo, p.nombre]));
  let enviadas = 0;
  let fallos = 0;
  let descartados = 0;
  const muertas = new Set();

  for (const ev of eventos) {
    if (!(await e.reservarEvento(ev))) continue; // otra vuelta ya lo tomó
    const viejo = e.ahoraMs - Date.parse(ev.creado_en) > MAX_HORAS_EVENTO * 3600000;
    if (viejo || ev.intentos >= MAX_INTENTOS_EVENTO) {
      descartados++;
      continue;
    }
    const mensaje = mensajeDeEvento(ev, nombres);
    let exitos = 0;
    let fallosEvento = 0;
    for (const s of subs) {
      if (s.correo !== ev.para || muertas.has(s.endpoint)) continue;
      const r = await e.enviar(s, mensaje);
      if (r === "ok") {
        enviadas++;
        exitos++;
      } else if (r === "muerta") {
        muertas.add(s.endpoint);
      } else {
        fallos++;
        fallosEvento++;
      }
    }
    // Falló en todos sus dispositivos: la vuelta siguiente lo reintenta
    if (exitos === 0 && fallosEvento > 0) await e.devolverEvento(ev);
  }

  for (const endpoint of muertas) await e.borrarSuscripcion(endpoint);
  return { eventos: eventos.length, enviadas, fallos, descartados };
}
