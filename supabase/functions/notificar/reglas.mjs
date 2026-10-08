// Reglas de la función `Notificar`: cuándo suena cada aviso y con qué texto, en hora de España.
//
// JS puro, sin APIs de Deno ni de Node: lo importan la Edge Function (index.ts) y las pruebas de
// setup/pruebas/ (node --test). Supabase y el push llegan inyectados en `repartir`, así que todo
// se prueba sin red.
//
// Contrato (setup/migraciones/2026-10-08-hora.sql): `hora` es la hora de España del aviso
// (HH:MM:SS; null = sin hora) y solo cuenta si hay `vence`; `notificado_para` y `notificado_hora`
// dicen para qué fecha y a qué hora sonó ya.

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
