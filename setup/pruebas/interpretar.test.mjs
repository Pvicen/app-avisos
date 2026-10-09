// Pruebas de «escribir como hablas» (interpretar.js): frases como las que se escriben o se dictan
// y la fecha y hora que tienen que salir. interpretar.js es un script clásico del navegador: aquí
// se ejecuta en un contexto aislado de Node y se toma su única global, `interpretarAviso`.
// Se ejecutan con `node --test` desde la raíz del repo. Solo datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const contexto = vm.createContext({});
vm.runInContext(readFileSync(new URL("../../interpretar.js", import.meta.url), "utf8"), contexto);
const { interpretarAviso } = contexto;

// Viernes 9 de octubre de 2026, 10:00 (hora local)
const AHORA = new Date(2026, 9, 9, 10, 0);

function caso(frase, texto, vence, hora, ahora = AHORA) {
  const r = interpretarAviso(frase, ahora);
  assert.deepEqual(r && { ...r }, { texto, vence, hora }, `«${frase}»`);
}

function nada(frase, ahora = AHORA) {
  assert.equal(interpretarAviso(frase, ahora), null, `«${frase}» no debería tener fecha`);
}

test("el ejemplo: «comprar pan mañana a las 6»", () => {
  caso("comprar pan mañana a las 6", "comprar pan", "2026-10-10", "18:00");
});

test("sin fecha ni hora no hace nada", () => {
  nada("Comprar pan");
  nada("Llamar a Ana");
  nada("Comprar 3 huevos y 2 litros de leche");
  nada("");
  nada("   ");
});

test("días: hoy, mañana, pasado mañana, en N días, dentro de una semana", () => {
  caso("Recoger el paquete hoy", "Recoger el paquete", "2026-10-09", null);
  caso("revisar la caldera mañana", "revisar la caldera", "2026-10-10", null);
  caso("pasado mañana a las 10 entregar práctica", "entregar práctica", "2026-10-11", "10:00");
  caso("en 3 días revisar", "revisar", "2026-10-12", null);
  caso("devolver el libro dentro de una semana", "devolver el libro", "2026-10-16", null);
  caso("renovar en dos semanas", "renovar", "2026-10-23", null);
  caso("llamar en un día", "llamar", "2026-10-10", null);
});

test("días de la semana: el próximo; si es hoy, el de la semana que viene", () => {
  caso("dentista el lunes a las 10:30", "dentista", "2026-10-12", "10:30");
  caso("reunión el viernes", "reunión", "2026-10-16", null); // hoy es viernes
  caso("cena el jueves", "cena", "2026-10-15", null);
  caso("ir al súper el sábado por la tarde", "ir al súper", "2026-10-10", "17:00");
  caso("Gimnasio a las 8 de la mañana del lunes", "Gimnasio", "2026-10-12", "08:00");
  caso("cita el miércoles que viene", "cita", "2026-10-14", null);
  nada("hacer los deberes los lunes"); // «los lunes» es cada lunes
});

test("fechas: el 15, el 15 de octubre, 15/10", () => {
  caso("pagar la luz el 15", "pagar la luz", "2026-10-15", null);
  caso("pagar el alquiler el 5", "pagar el alquiler", "2026-11-05", null); // el 5 de este mes ya pasó
  caso("pagar el día 20.", "pagar.", "2026-10-20", null);
  caso("cumple de Ana el 3 de noviembre", "cumple de Ana", "2026-11-03", null);
  caso("renovar DNI el 2 de enero", "renovar DNI", "2027-01-02", null);
  caso("boda el 12 de junio de 2027", "boda", "2027-06-12", null);
  caso("examen 20/10", "examen", "2026-10-20", null);
  caso("examen 20/10/2027", "examen", "2027-10-20", null);
  caso("ITV el 1/2", "ITV", "2027-02-01", null);
  caso("pagar el 31", "pagar", "2026-12-31", null, new Date(2026, 10, 5, 10, 0)); // noviembre no tiene 31
  nada("leer el 2 de Harry Potter");
  nada("comprar 1/2 kilo de carne");
  nada("pagar 15/20 euros"); // mes 20: no es una fecha
  nada("el 15% de descuento");
});

test("horas: a las 6 es por la tarde; de las 8 a las 12, tal cual", () => {
  caso("sacar la basura a las 21", "sacar la basura", "2026-10-09", "21:00");
  caso("desayunar a las 8", "desayunar", "2026-10-10", "08:00"); // las 8 ya pasaron hoy → mañana
  caso("cenar a las 8 de la tarde", "cenar", "2026-10-09", "20:00"); // para la tarde hay que decirlo
  caso("a las 6 y media pasear al perro", "pasear al perro", "2026-10-09", "18:30");
  caso("llamar a las 7 menos cuarto", "llamar", "2026-10-09", "18:45");
  caso("comer a la una", "comer", "2026-10-09", "13:00");
  caso("a las seis y media cenar", "cenar", "2026-10-09", "18:30");
  caso("18:30 pádel", "pádel", "2026-10-09", "18:30");
  caso("cena 6pm", "cena", "2026-10-09", "18:00");
  caso("tren a las 07:30", "tren", "2026-10-10", "07:30"); // con cero delante es de 24 h; ya pasó → mañana
  caso("partido sobre las 11h", "partido", "2026-10-09", "11:00");
});

test("horas: de la mañana, de la tarde, de la noche, am, pm, mediodía", () => {
  caso("correr a las 6 y cuarto de la mañana", "correr", "2026-10-10", "06:15"); // ya pasó → mañana
  caso("llamar a mamá hoy a las 8 de la tarde", "llamar a mamá", "2026-10-09", "20:00");
  caso("salir a las 10 de la noche", "salir", "2026-10-09", "22:00");
  caso("despertar a las 7 am", "despertar", "2026-10-10", "07:00");
  caso("llamar al banco a mediodía", "llamar al banco", "2026-10-09", "12:00");
  caso("comer a la 1 del mediodía", "comer", "2026-10-09", "13:00");
  caso("tomar la pastilla a las 12 de la noche", "tomar la pastilla", "2026-10-10", "00:00");
});

test("una hora sin día es para hoy, o para mañana si ya pasó", () => {
  caso("tomar la pastilla a las 9", "tomar la pastilla", "2026-10-10", "09:00");
  caso("tomar la pastilla a las 10", "tomar la pastilla", "2026-10-10", "10:00"); // justo ahora: ya pasó
  caso("tomar la pastilla a las 10:01", "tomar la pastilla", "2026-10-09", "10:01");
  caso("ver la serie a las 11", "ver la serie", "2026-10-10", "11:00", new Date(2026, 9, 9, 23, 0));
});

test("partes del día: por la mañana, esta tarde, esta noche", () => {
  caso("mañana por la mañana ir al médico", "ir al médico", "2026-10-10", "09:00");
  caso("esta noche ver la peli", "ver la peli", "2026-10-09", "21:00");
  caso("regar esta mañana", "regar", "2026-10-09", "09:00"); // «esta» es hoy aunque ya pasó
  caso("por la tarde llamar", "llamar", "2026-10-09", "17:00");
  caso("llamar por la noche", "llamar", "2026-10-09", "21:00");
  caso("por la tarde a las 5 recoger", "recoger", "2026-10-09", "17:00");
  caso("esta noche a las 10 llamar", "llamar", "2026-10-09", "22:00");
  caso("por la mañana a las 7 correr", "correr", "2026-10-10", "07:00"); // de la mañana; ya pasó
  nada("estudiar toda la mañana"); // la parte del día, no el día de mañana
  nada("el café de la mañana");
});

test("el texto que queda: sin conectores, con su puntuación y su mayúscula", () => {
  caso("Mañana comprar pan", "Comprar pan", "2026-10-10", null);
  caso("comprar pan para mañana", "comprar pan", "2026-10-10", null);
  caso("Para mañana: comprar pan", "Comprar pan", "2026-10-10", null);
  caso("Mañana, comprar pan", "Comprar pan", "2026-10-10", null);
  caso("Recoger el paquete hoy.", "Recoger el paquete.", "2026-10-09", null);
  caso("entregar el trabajo hasta el lunes", "entregar el trabajo", "2026-10-12", null);
  caso("Reunión el 15 de octubre a las 10 en la oficina", "Reunión en la oficina", "2026-10-15", "10:00");
  caso("MAÑANA REUNIÓN", "REUNIÓN", "2026-10-10", null);
  caso("🎂 cumple de Ana mañana", "🎂 cumple de Ana", "2026-10-10", null);
});

test("si al quitar la fecha no queda texto, no hace nada", () => {
  nada("mañana");
  nada("mañana a las 6");
  nada("el lunes por la tarde");
});

test("lo que parece una hora y no lo es se queda en el texto", () => {
  nada("a las 25");
  caso("cenar mañana a las 25", "cenar a las 25", "2026-10-10", null);
  nada("dar de comer a los 2 gatos"); // «a los», no «a las»
  nada("6 huevos");
});
