// Validador del cuerpo de `atlas-aviso`: el aviso que crea Atlas, el asistente del PC.
//
// JS puro, sin APIs de Deno ni de Node (solo TextDecoder, que tienen los dos): lo importan la Edge
// Function `atlas-aviso` y las pruebas de setup/pruebas/ (node --test). `Notificar` lleva su propia
// copia de MARCA_ATLAS, y una prueba ata las dos.
//
// El cuerpo es exactamente {id, texto, vence, hora}: el id lo pone Atlas (un UUID en minúsculas), el
// texto es una línea de 1 a 200 caracteres, `vence` es AAAA-MM-DD o null, y `hora` es HH:MM o null
// (solo con fecha). Ni `para` ni `creado_por`: los pone la función.

/** La marca de los avisos de Atlas en `creado_por`: no es un correo, así que no es de nadie de la lista. */
export const MARCA_ATLAS = "atlas";
/** El cuerpo, como mucho. */
export const MAX_BYTES = 4096;
/** Avisos de Atlas en 24 horas, como mucho. */
export const MAX_AL_DIA = 30;
/** Caracteres del texto, como mucho (contados como letras: un emoji cuenta uno). */
export const MAX_TEXTO = 200;

const CLAVES = ["id", "texto", "vence", "hora"];
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
// Controles (C0, DEL y C1), los separadores de línea y de párrafo, y los de dirección del texto,
// que harían que se leyera en otro orden.
const RE_PROHIBIDOS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
// Un sustituto UTF-16 suelto (un JSON puede traerlo escapado): no es texto.
const RE_SUSTITUTO_SUELTO = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/**
 * Revisa el cuerpo tal como llega (bytes).
 * Devuelve { ok: true, datos: {id, texto, vence, hora} } o { ok: false, estado: 413 | 400 }. Sin motivos: el
 * cuerpo es un dato personal y no se cuenta.
 */
export function revisarCuerpo(bytes) {
  if (!(bytes instanceof Uint8Array)) return { ok: false, estado: 400 };
  if (bytes.length > MAX_BYTES) return { ok: false, estado: 413 };
  let datos;
  try {
    datos = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, estado: 400 };
  }
  if (!objetoConClaves(datos)) return { ok: false, estado: 400 };
  const { id, texto, vence, hora } = datos;
  const bien =
    typeof id === "string" && RE_UUID.test(id) &&
    textoValido(texto) &&
    (vence === null || fechaValida(vence)) &&
    (hora === null || (vence !== null && typeof hora === "string" && RE_HORA.test(hora)));
  if (!bien) return { ok: false, estado: 400 };
  return { ok: true, datos: { id, texto, vence, hora } };
}

function objetoConClaves(valor) {
  if (valor === null || typeof valor !== "object" || Array.isArray(valor)) return false;
  const claves = Object.keys(valor);
  return claves.length === CLAVES.length && CLAVES.every((c) => Object.prototype.hasOwnProperty.call(valor, c));
}

function textoValido(texto) {
  if (typeof texto !== "string" || texto.trim() === "") return false;
  if (RE_SUSTITUTO_SUELTO.test(texto) || RE_PROHIBIDOS.test(texto)) return false;
  return [...texto].length <= MAX_TEXTO;
}

/** AAAA-MM-DD de un día que existe. */
function fechaValida(valor) {
  const m = typeof valor === "string" ? RE_FECHA.exec(valor) : null;
  if (!m) return false;
  const [anio, mes, dia] = [+m[1], +m[2], +m[3]];
  const t = new Date(Date.UTC(anio, mes - 1, dia));
  return t.getUTCFullYear() === anio && t.getUTCMonth() === mes - 1 && t.getUTCDate() === dia;
}
