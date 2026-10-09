// Escribir como hablas: saca la fecha y la hora de un aviso escrito o dictado en español
// («comprar pan mañana a las 6» → «comprar pan», mañana, 18:00).
//
// Script clásico y JS puro, sin DOM: index.html lo carga antes de app.js y las pruebas de
// setup/pruebas/ lo ejecutan en Node. Solo deja una cosa global, `interpretarAviso`. Todo se
// interpreta en el dispositivo: el texto no sale de él.
//
// Contrato con app.js:
//   interpretarAviso(texto, ahora) → null | { texto, vence, hora }
//     texto  el aviso sin las palabras de fecha y hora (nunca vacío)
//     vence  "AAAA-MM-DD"
//     hora   "HH:MM" o null
//   Devuelve null si no entiende ninguna fecha ni hora, o si al quitarlas no queda texto.
//   `ahora` es un Date: cuentan su fecha y su hora locales (las del dispositivo).
//
// Reglas (decididas por Vicente el 2026-10-09):
//   - «a las 6» sin más: de la 1 a las 7 es por la tarde (13 a 19 h); de las 8 a las 12, tal cual.
//     «de la mañana», «de la tarde», «am», «pm»… mandan. «a las 07:30», con cero delante, es de 24 h.
//   - por la mañana 9:00 · a mediodía 12:00 · por la tarde 17:00 · por la noche 21:00.
//   - «el lunes» es el próximo lunes; si hoy es lunes, el de la semana que viene.
//   - una hora sin día es para hoy, o para mañana si ya pasó; «esta tarde» es siempre hoy.

var interpretarAviso = (function () {
  "use strict";

  const ACENTOS = { "á": "a", "é": "e", "í": "i", "ó": "o", "ú": "u", "ü": "u", "ñ": "n" };
  const MESES = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
    septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  };
  const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const NUMEROS = {
    un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
    nueve: 9, diez: 10, once: 11, doce: 12, quince: 15,
  };
  const MOMENTOS = { manana: "09:00", mediodia: "12:00", tarde: "17:00", noche: "21:00" };

  const N_HORA = "(\\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)";
  const PERIODO =
    "(de\\s+la\\s+manana|de\\s+la\\s+madrugada|de\\s+la\\s+tarde|de\\s+la\\s+noche|del\\s+mediodia" +
    "|a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)";
  const FIN = "(?![a-z0-9])";

  // Horas, de la forma más clara a la más suelta
  const RE_A_LAS = new RegExp(
    "\\b(?:a|sobre|hacia|para)\\s+las?\\s+" + N_HORA +
      "(?:[:.h](\\d{2}))?" +
      "(?:\\s*(?:h|hs|horas?))?" +
      "(?:\\s+(y\\s+media|y\\s+cuarto|menos\\s+cuarto|en\\s+punto))?" +
      "(?:\\s*" + PERIODO + ")?" + FIN,
    "g"
  );
  const RE_HH_MM = new RegExp("\\b(\\d{1,2}):(\\d{2})(?:\\s*" + PERIODO + ")?(?![\\d:])", "g");
  const RE_H_SUELTA = new RegExp("\\b(\\d{1,2})\\s*(am|pm|h)" + FIN, "g");
  const RE_MEDIODIA = /\b(?:a|al)\s+mediodia\b/g;
  const RE_ESTA = /\besta\s+(manana|tarde|noche)\b/g;
  const RE_MOMENTO = /\b(?:por|en|a)\s+la\s+(manana|tarde|noche)\b/g;

  // Días
  const RE_PASADO_MANANA = /\bpasado\s+manana\b/g;
  const RE_MANANA = /\bmanana\b/g;
  const RE_HOY = /\bhoy\b/g;
  const RE_EN = /\b(?:en|dentro\s+de)\s+(\d{1,3}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince)\s+(dias?|semanas?)\b/g;
  const RE_BARRA = /\b(?:el\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;
  const RE_DE_MES = new RegExp(
    "\\b(?:el\\s+(?:dia\\s+)?)?(\\d{1,2})\\s+de\\s+(" + Object.keys(MESES).join("|") + ")" +
      "(?:\\s+(?:de|del)\\s+(\\d{4}))?\\b",
    "g"
  );
  const RE_EL_DIA = /\b(?:el\s+(?:dia\s+)?|dia\s+)(\d{1,2})(?![\d/:%ºª°€]|[.,]\d)/g;
  // «1/2 kilo», «3/4 de leche»: fracciones, no fechas (salvo «el 1/2»)
  const FRACCIONES = ["1/2", "1/3", "2/3", "1/4", "3/4"];
  const RE_SEMANA = new RegExp(
    "\\b(?:(?:el|este|esta|al|del)\\s+)?(?:proximo\\s+)?(" + DIAS_SEMANA.join("|") + ")" +
      "(?:\\s+(?:que\\s+viene|proximo))?\\b",
    "g"
  );

  // Palabras que unían el aviso con la fecha y sobran al quitarla: «para mañana», «hasta el lunes»
  const RE_CONECTOR = /(?:^|[\s,])(?:para|a|al|de|del|el|y|hasta|antes\s+de|antes\s+del)\s*$/i;

  /** Minúsculas y sin tildes, letra a letra: las posiciones son las mismas que en el original. */
  function normalizar(texto) {
    let s = "";
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      const minuscula = c.toLowerCase();
      const letra = minuscula.length === 1 ? minuscula : c;
      s += ACENTOS[letra] || letra;
    }
    return s;
  }

  function dos(n) {
    return String(n).padStart(2, "0");
  }

  function iso(fecha) {
    return fecha.getFullYear() + "-" + dos(fecha.getMonth() + 1) + "-" + dos(fecha.getDate());
  }

  function masDias(fecha, dias) {
    return new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + dias);
  }

  /** El día pedido, o null si no existe (31 de noviembre…). */
  function crearFecha(anio, mes, dia) {
    const f = new Date(anio, mes - 1, dia);
    return f.getFullYear() === anio && f.getMonth() === mes - 1 && f.getDate() === dia ? f : null;
  }

  function numero(palabra) {
    return /^\d+$/.test(palabra) ? Number(palabra) : NUMEROS[palabra];
  }

  function periodoDe(texto) {
    if (!texto) return null;
    if (texto.includes("mediodia")) return "mediodia";
    if (texto.includes("noche")) return "noche";
    if (texto.includes("tarde") || texto[0] === "p") return "tarde";
    return "manana"; // de la mañana, de la madrugada, am
  }

  /** "HH:MM" de una hora dicha, o null si no es una hora válida. */
  function resolverHora(textoHora, textoMinutos, ajuste, periodo) {
    let h = numero(textoHora);
    let min = textoMinutos ? Number(textoMinutos) : 0;
    if (h === undefined || h > 23 || min > 59) return null;
    if (periodo && h <= 12) {
      if (periodo === "manana") {
        if (h === 12) h = 0;
      } else if (periodo === "noche" && h === 12) {
        h = 0; // las 12 de la noche
      } else if (h < 12) {
        h += 12; // tarde, noche, del mediodía
      }
    } else if (!periodo && h >= 1 && h <= 7 && !/^0\d$/.test(textoHora)) {
      h += 12; // «a las 6»: por la tarde
    }
    if (ajuste === "y media") min += 30;
    else if (ajuste === "y cuarto") min += 15;
    else if (ajuste === "menos cuarto") {
      h = (h + 23) % 24;
      min = 45;
    }
    if (min > 59) return null;
    return dos(h) + ":" + dos(min);
  }

  /** Recorre las coincidencias de `re` que no pisan lo ya usado; la primera que `crear` acepta gana. */
  function primera(re, s, usados, crear) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s)) !== null) {
      const ini = m.index;
      const fin = ini + m[0].length;
      if (usados.some(([a, b]) => ini < b && a < fin)) continue;
      const valor = crear(m, ini, fin);
      if (valor) return { valor, tramo: [ini, fin] };
    }
    return null;
  }

  /** La hora dicha, sin resolver todavía: { hora, minutos, ajuste, periodo } o { fija }. */
  function buscarHora(s, usados) {
    const deHora = (m) => ({ hora: m[1], minutos: m[2], ajuste: m[3] && m[3].replace(/\s+/g, " "), periodo: periodoDe(m[4]) });
    return (
      primera(RE_A_LAS, s, usados, (m) => numero(m[1]) !== undefined && deHora(m)) ||
      primera(RE_HH_MM, s, usados, (m) => ({ hora: m[1], minutos: m[2], periodo: periodoDe(m[3]) })) ||
      primera(RE_H_SUELTA, s, usados, (m) => ({ hora: m[1], periodo: m[2] === "h" ? null : periodoDe(m[2]) })) ||
      primera(RE_MEDIODIA, s, usados, () => ({ fija: MOMENTOS.mediodia }))
    );
  }

  /** El día dicho, como Date local, o null. */
  function buscarFecha(s, usados, hoy) {
    return (
      primera(RE_PASADO_MANANA, s, usados, () => masDias(hoy, 2)) ||
      primera(RE_MANANA, s, usados, (m, ini) => {
        // «por la mañana», «esta mañana»: es la parte del día, no el día siguiente
        if (/(?:\bla|\besta)\s+$/.test(s.slice(0, ini))) return null;
        return masDias(hoy, 1);
      }) ||
      primera(RE_HOY, s, usados, () => hoy) ||
      primera(RE_EN, s, usados, (m) => {
        const n = numero(m[1]);
        return n === undefined ? null : masDias(hoy, m[2].startsWith("semana") ? n * 7 : n);
      }) ||
      primera(RE_BARRA, s, usados, (m) => {
        if (!m[3] && !m[0].startsWith("el") && FRACCIONES.includes(m[1] + "/" + m[2])) return null;
        return fechaSinAnio(hoy, Number(m[2]), Number(m[1]), m[3]);
      }) ||
      primera(RE_DE_MES, s, usados, (m) => fechaSinAnio(hoy, MESES[m[2]], Number(m[1]), m[3])) ||
      primera(RE_EL_DIA, s, usados, (m, ini, fin) => {
        // «el 2 de Harry Potter» no es una fecha; «el 15 de octubre» ya lo cogió RE_DE_MES
        if (/^\s+de\s/.test(s.slice(fin))) return null;
        return proximoDiaDelMes(hoy, Number(m[1]));
      }) ||
      primera(RE_SEMANA, s, usados, (m, ini) => {
        if (/\blos\s+$/.test(s.slice(0, ini))) return null; // «los lunes» es cada lunes
        const dia = DIAS_SEMANA.indexOf(m[1]);
        return masDias(hoy, ((dia - hoy.getDay() + 6) % 7) + 1);
      })
    );
  }

  /** Día y mes, con o sin año: sin año, este año o el que viene si ya pasó. */
  function fechaSinAnio(hoy, mes, dia, textoAnio) {
    if (textoAnio) {
      const anio = textoAnio.length === 2 ? 2000 + Number(textoAnio) : Number(textoAnio);
      return crearFecha(anio, mes, dia);
    }
    const esteAnio = crearFecha(hoy.getFullYear(), mes, dia);
    if (esteAnio && esteAnio >= hoy) return esteAnio;
    return crearFecha(hoy.getFullYear() + 1, mes, dia);
  }

  /** «El 15»: este mes si aún no pasó; si no, el siguiente mes que tenga ese día. */
  function proximoDiaDelMes(hoy, dia) {
    if (dia < 1 || dia > 31) return null;
    for (let i = 0; i < 4; i++) {
      const f = crearFecha(hoy.getFullYear(), hoy.getMonth() + 1 + i, dia);
      if (f && f >= hoy) return f;
    }
    return null;
  }

  /** Quita los tramos y las palabras que los unían; deja el texto limpio de espacios y comas. */
  function quitarTramos(texto, tramos) {
    let resultado = "";
    let desde = 0;
    for (const [ini, fin] of [...tramos].sort((x, y) => x[0] - y[0])) {
      let trozo = resultado + texto.slice(desde, ini);
      let antes;
      do {
        antes = trozo;
        trozo = trozo.replace(RE_CONECTOR, "");
      } while (trozo !== antes);
      resultado = trozo + " ";
      desde = fin;
    }
    resultado += texto.slice(desde);
    return resultado
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, "");
  }

  return function interpretarAviso(texto, ahora) {
    if (typeof texto !== "string" || !texto.trim()) return null;
    const s = normalizar(texto);
    const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const usados = [];

    // 1. La hora
    const hallada = buscarHora(s, usados);
    if (hallada) usados.push(hallada.tramo);

    // 2. «Esta tarde» o «por la tarde»: dicen el momento del día (y «esta», además, que es hoy)
    const esta = primera(RE_ESTA, s, usados, (m) => m[1]);
    if (esta) usados.push(esta.tramo);
    const momento = esta ? null : primera(RE_MOMENTO, s, usados, (m) => m[1]);
    if (momento) usados.push(momento.tramo);
    const parteDelDia = esta ? esta.valor : momento ? momento.valor : null;

    let hora = null;
    if (hallada && hallada.valor.fija) {
      hora = hallada.valor.fija;
    } else if (hallada) {
      const v = hallada.valor;
      hora = resolverHora(v.hora, v.minutos, v.ajuste, v.periodo || parteDelDia);
      if (!hora) usados.splice(usados.indexOf(hallada.tramo), 1); // «a las 25»: no era una hora
    }
    if (!hora && parteDelDia) hora = MOMENTOS[parteDelDia];

    // 3. El día
    const dia = buscarFecha(s, usados, hoy);
    if (dia) usados.push(dia.tramo);
    let fecha = dia ? dia.valor : null;
    if (!fecha && esta) fecha = hoy;
    if (!fecha && hora) {
      const ya = dos(ahora.getHours()) + ":" + dos(ahora.getMinutes());
      fecha = hora <= ya ? masDias(hoy, 1) : hoy;
    }
    if (!fecha) return null;

    // 4. El texto que queda
    let limpio = quitarTramos(texto, usados);
    if (!limpio) return null;
    const primeraLetra = texto.trim()[0];
    if (primeraLetra !== primeraLetra.toLowerCase()) limpio = limpio[0].toUpperCase() + limpio.slice(1);
    return { texto: limpio, vence: iso(fecha), hora };
  };
})();
