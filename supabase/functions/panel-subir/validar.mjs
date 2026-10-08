// Validador del Contrato C1: el JSON del panel, versión 1 (docs/panel-contrato.md).
//
// JS puro, sin APIs de Deno ni de Node (solo TextEncoder/TextDecoder, que tienen los dos): lo
// importan la Edge Function `panel-subir` y las pruebas de setup/pruebas/ (node --test).
//
// Los motivos de rechazo nombran el campo y la regla, nunca el valor: el JSON son datos personales.

export const MAX_BYTES = 256 * 1024;
const MAX_MOTIVOS = 10;
const PREFIJO_CANVAS = "https://canvas.ucam.edu/";

const RE_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const RE_INSTANTE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const RE_ID = /^[a-z0-9-]{1,40}$/;
// Algo con forma de etiqueta HTML (<b>, </p>, <img src=…>). Vale para todos los campos, también
// los ejercicios: las comparaciones de las fórmulas ($x<y$, $a < b > c$) no tienen esa forma.
const RE_ETIQUETA = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;

/**
 * Revisa el cuerpo tal como llega (bytes o texto).
 * Devuelve { ok: true, datos } o { ok: false, estado: 413 | 400, motivos: [...] }.
 */
export function revisarCuerpo(cuerpo) {
  const bytes = typeof cuerpo === "string" ? new TextEncoder().encode(cuerpo) : cuerpo;
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, estado: 400, motivos: ["el cuerpo no se pudo leer"] };
  }
  if (bytes.length > MAX_BYTES) {
    return { ok: false, estado: 413, motivos: ["el cuerpo pasa de 256 KB"] };
  }
  let texto;
  try {
    texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, estado: 400, motivos: ["el cuerpo no es UTF-8 válido"] };
  }
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    return { ok: false, estado: 400, motivos: ["el cuerpo no es JSON válido"] };
  }
  const motivos = validarPanel(datos);
  if (motivos.length > 0) return { ok: false, estado: 400, motivos: acortar(motivos) };
  return { ok: true, datos };
}

/** Todos los motivos por los que `datos` no cumple C1 (lista vacía = lo cumple). */
export function validarPanel(datos) {
  const v = new Revision();
  if (!v.objeto("raíz", datos, [
    "version", "generado", "dias", "entregas", "parciales", "novedades", "ejercicios", "banco", "proyectos",
  ])) {
    return v.motivos;
  }

  if (datos.version !== 1) v.mal("version", "tiene que ser el entero 1");
  v.instante("generado", datos.generado);

  v.lista("dias", datos.dias, 1, 7, (dia, r) => {
    if (!v.objeto(r, dia, ["fecha", "clases", "estudio"])) return;
    v.fecha(`${r}.fecha`, dia.fecha);
    v.texto(`${r}.clases`, dia.clases, 200, { vacio: true });
    v.lista(`${r}.estudio`, dia.estudio, 0, 12, (b, rb) => {
      if (!v.objeto(rb, b, ["materia", "texto", "duracion"])) return;
      v.texto(`${rb}.materia`, b.materia, 60);
      v.texto(`${rb}.texto`, b.texto, 300);
      v.texto(`${rb}.duracion`, b.duracion, 20, { vacio: true });
    });
  });

  const entregas = v.lista("entregas", datos.entregas, 0, 50, (e, r) => {
    if (!v.objeto(r, e, ["materia", "titulo", "vence", "url"])) return;
    v.texto(`${r}.materia`, e.materia, 60);
    v.texto(`${r}.titulo`, e.titulo, 200);
    v.instante(`${r}.vence`, e.vence);
    if (e.url !== null) {
      if (v.texto(`${r}.url`, e.url, 300) && !e.url.startsWith(PREFIJO_CANVAS)) {
        v.mal(`${r}.url`, `tiene que ser null o empezar por ${PREFIJO_CANVAS}`);
      }
    }
  });
  v.orden("entregas", entregas, (e) => Date.parse(e.vence), "vence", false);

  const parciales = v.lista("parciales", datos.parciales, 0, 20, (p, r) => {
    if (!v.objeto(r, p, ["materia", "fecha", "hora"])) return;
    v.texto(`${r}.materia`, p.materia, 60);
    v.fecha(`${r}.fecha`, p.fecha);
    v.texto(`${r}.hora`, p.hora, 20, { vacio: true });
  });
  v.orden("parciales", parciales, (p) => Date.parse(p.fecha + "T00:00:00Z"), "fecha", false);

  const novedades = v.lista("novedades", datos.novedades, 0, 50, (n, r) => {
    if (!v.objeto(r, n, ["materia", "titulo", "fecha", "tipo"])) return;
    v.texto(`${r}.materia`, n.materia, 60);
    v.texto(`${r}.titulo`, n.titulo, 200);
    v.instante(`${r}.fecha`, n.fecha);
    if (n.tipo !== "archivo" && n.tipo !== "tarea") v.mal(`${r}.tipo`, 'tiene que ser "archivo" o "tarea"');
  });
  v.orden("novedades", novedades, (n) => Date.parse(n.fecha), "fecha (lo más nuevo primero)", true);

  const ids = new Set();
  v.lista("ejercicios", datos.ejercicios, 0, 10, (x, r) => {
    if (!v.objeto(r, x, ["id", "materia", "tema", "enunciado", "solucion", "nivel"])) return;
    if (typeof x.id !== "string" || !RE_ID.test(x.id)) {
      v.mal(`${r}.id`, "tiene que cumplir ^[a-z0-9-]{1,40}$");
    } else if (ids.has(x.id)) {
      v.mal(`${r}.id`, "está repetido");
    } else {
      ids.add(x.id);
    }
    v.texto(`${r}.materia`, x.materia, 60);
    v.texto(`${r}.tema`, x.tema, 120);
    v.texto(`${r}.enunciado`, x.enunciado, 4000, { lineas: true });
    v.texto(`${r}.solucion`, x.solucion, 8000, { lineas: true });
    if (x.nivel !== 1 && x.nivel !== 2 && x.nivel !== 3) v.mal(`${r}.nivel`, "tiene que ser 1, 2 o 3");
  });

  v.lista("banco", datos.banco, 0, 12, (b, r) => {
    if (!v.objeto(r, b, ["materia", "quedan"])) return;
    v.texto(`${r}.materia`, b.materia, 60);
    if (!Number.isInteger(b.quedan) || b.quedan < 0 || b.quedan > 9999) {
      v.mal(`${r}.quedan`, "tiene que ser un entero de 0 a 9999");
    }
  });

  v.lista("proyectos", datos.proyectos, 0, 20, (p, r) => {
    if (!v.objeto(r, p, ["nombre", "estado", "siguiente", "fecha"])) return;
    v.texto(`${r}.nombre`, p.nombre, 60);
    v.texto(`${r}.estado`, p.estado, 200, { vacio: true });
    v.texto(`${r}.siguiente`, p.siguiente, 200, { vacio: true });
    v.fecha(`${r}.fecha`, p.fecha);
  });

  return v.motivos;
}

function acortar(motivos) {
  if (motivos.length <= MAX_MOTIVOS) return motivos;
  return [...motivos.slice(0, MAX_MOTIVOS), `… y ${motivos.length - MAX_MOTIVOS} motivo(s) más`];
}

// Acumula los motivos de rechazo; cada comprobación devuelve true si el valor pasa.
class Revision {
  constructor() {
    this.motivos = [];
  }

  mal(ruta, regla) {
    this.motivos.push(`${ruta}: ${regla}`);
    return false;
  }

  /** Objeto con exactamente estas claves: ni de más ni de menos. */
  objeto(ruta, valor, claves) {
    if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
      return this.mal(ruta, "tiene que ser un objeto");
    }
    let bien = true;
    for (const c of claves) {
      if (!Object.prototype.hasOwnProperty.call(valor, c)) bien = this.mal(ruta, `falta el campo "${c}"`);
    }
    for (const c of Object.keys(valor)) {
      if (!claves.includes(c)) bien = this.mal(ruta, `sobra el campo "${c}"`);
    }
    return bien;
  }

  /** Lista con entre `min` y `max` elementos; revisa cada uno y devuelve los que pasaron. */
  lista(ruta, valor, min, max, revisarElemento) {
    if (!Array.isArray(valor)) {
      this.mal(ruta, "tiene que ser una lista");
      return [];
    }
    if (valor.length < min || valor.length > max) {
      this.mal(ruta, `tiene ${valor.length} elementos y tienen que ser de ${min} a ${max}`);
      if (valor.length > max) return []; // no se revisa elemento a elemento algo que ya sobra
    }
    const buenos = [];
    valor.forEach((elemento, i) => {
      const antes = this.motivos.length;
      revisarElemento(elemento, `${ruta}[${i}]`);
      if (this.motivos.length === antes) buenos.push(elemento);
    });
    return buenos;
  }

  /**
   * Texto plano de como mucho `max` caracteres (contados como letras, no como unidades de
   * UTF-16: un emoji cuenta uno). Por defecto, sin vacíos ni saltos de línea.
   */
  texto(ruta, valor, max, { vacio = false, lineas = false } = {}) {
    if (typeof valor !== "string") return this.mal(ruta, "tiene que ser texto");
    let bien = true;
    const largo = [...valor].length;
    if (largo > max) bien = this.mal(ruta, `tiene ${largo} caracteres y el máximo es ${max}`);
    if (!vacio && valor.trim() === "") bien = this.mal(ruta, "no puede estar vacío");
    if (valor.includes("\u0000")) bien = this.mal(ruta, "lleva un carácter nulo");
    if (!lineas && /[\r\n]/.test(valor)) bien = this.mal(ruta, "no puede llevar saltos de línea");
    if (RE_ETIQUETA.test(valor)) bien = this.mal(ruta, "no puede llevar HTML");
    return bien;
  }

  /** AAAA-MM-DD de un día que existe. */
  fecha(ruta, valor) {
    const m = typeof valor === "string" ? RE_FECHA.exec(valor) : null;
    if (!m || !diaExiste(+m[1], +m[2], +m[3])) return this.mal(ruta, "tiene que ser una fecha AAAA-MM-DD válida");
    return true;
  }

  /** ISO 8601 con zona horaria (Z o ±HH:MM), de un instante que existe. */
  instante(ruta, valor) {
    const m = typeof valor === "string" ? RE_INSTANTE.exec(valor) : null;
    const bien =
      m &&
      diaExiste(+m[1], +m[2], +m[3]) &&
      +m[4] < 24 && +m[5] < 60 && (m[6] === undefined || +m[6] < 60) &&
      (m[7] === undefined || (+m[7] <= 14 && +m[8] < 60)) &&
      !Number.isNaN(Date.parse(valor));
    if (!bien) return this.mal(ruta, "tiene que ser una fecha y hora ISO 8601 con zona horaria");
    return true;
  }

  /** La lista va ordenada (empates permitidos). Solo mira los elementos que ya pasaron. */
  orden(ruta, elementos, clave, nombre, descendente) {
    for (let i = 1; i < elementos.length; i++) {
      const a = clave(elementos[i - 1]);
      const b = clave(elementos[i]);
      if (descendente ? a < b : a > b) return this.mal(ruta, `tiene que ir ordenada por ${nombre}`);
    }
    return true;
  }
}

function diaExiste(anio, mes, dia) {
  const t = new Date(Date.UTC(anio, mes - 1, dia));
  return t.getUTCFullYear() === anio && t.getUTCMonth() === mes - 1 && t.getUTCDate() === dia;
}
