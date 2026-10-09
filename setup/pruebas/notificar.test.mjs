// Pruebas de las reglas de la función Notificar (supabase/functions/notificar/reglas.mjs): cuándo
// suena cada aviso en hora de España y la vuelta entera con Supabase y el push falsos.
// Se ejecutan con `node --test` desde la raíz del repo. Solo datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ahoraEnEspana,
  cuerpoDelAviso,
  debeSonar,
  MAX_INTENTOS_EVENTO,
  mensajeDeEvento,
  repartir,
  repartirEventos,
  yaSono,
} from "../../supabase/functions/notificar/reglas.mjs";

const HOY = "2026-10-08";

/** Un aviso como lo devuelve la base (las horas, con segundos). */
function aviso(cambios = {}) {
  return {
    id: "a1",
    texto: "Regar las plantas",
    vence: HOY,
    hora: null,
    notificado_para: null,
    notificado_hora: null,
    ...cambios,
  };
}

const a = (hora, hoy = HOY) => ({ hoy, hora });

test("ahoraEnEspana: invierno UTC+1, verano UTC+2 y la medianoche es 00", () => {
  assert.deepEqual(ahoraEnEspana(new Date("2026-01-15T08:30:00Z")), a("09:30:00", "2026-01-15"));
  assert.deepEqual(ahoraEnEspana(new Date("2026-07-15T07:00:00Z")), a("09:00:00", "2026-07-15"));
  assert.deepEqual(ahoraEnEspana(new Date("2026-10-08T22:00:30Z")), a("00:00:30", "2026-10-09"));
});

test("ahoraEnEspana: los dos cambios de hora de 2026", () => {
  // 29 de marzo: a las 2:00 pasan a ser las 3:00
  assert.deepEqual(ahoraEnEspana(new Date("2026-03-29T00:59:00Z")), a("01:59:00", "2026-03-29"));
  assert.deepEqual(ahoraEnEspana(new Date("2026-03-29T01:00:00Z")), a("03:00:00", "2026-03-29"));
  // 25 de octubre: a las 3:00 vuelven a ser las 2:00
  assert.deepEqual(ahoraEnEspana(new Date("2026-10-25T00:59:00Z")), a("02:59:00", "2026-10-25"));
  assert.deepEqual(ahoraEnEspana(new Date("2026-10-25T01:00:00Z")), a("02:00:00", "2026-10-25"));
});

test("sin hora: suena el día que vence desde las 9:00, una vez", () => {
  assert.equal(debeSonar(aviso(), a("08:59:59")), false);
  assert.equal(debeSonar(aviso(), a("09:00:00")), true);
  assert.equal(debeSonar(aviso(), a("23:59:59")), true);
  assert.equal(debeSonar(aviso({ notificado_para: HOY }), a("10:00:00")), false);
  assert.equal(debeSonar(aviso({ vence: "2026-10-09" }), a("10:00:00")), false); // mañana
});

test("sin hora: si venció y no sonó, suena desde las 9:00; si cambia la fecha, vuelve a sonar", () => {
  const vencido = aviso({ vence: "2026-10-05" });
  assert.equal(debeSonar(vencido, a("08:00:00")), false);
  assert.equal(debeSonar(vencido, a("09:00:00")), true);
  assert.equal(debeSonar(aviso({ notificado_para: "2026-10-05" }), a("09:00:00")), true);
});

test("con hora: suena a esa hora, también antes de las 9:00, y no antes", () => {
  const tarde = aviso({ hora: "18:00:00" });
  assert.equal(debeSonar(tarde, a("17:59:59")), false);
  assert.equal(debeSonar(tarde, a("18:00:00")), true);
  assert.equal(debeSonar(tarde, a("18:00:59")), true);
  assert.equal(debeSonar(aviso({ hora: "07:30:00" }), a("07:30:00")), true);
  assert.equal(debeSonar(aviso({ hora: "00:00:00" }), a("00:00:00")), true);
  // con hora no entra en el aviso de las 9:00
  assert.equal(debeSonar(tarde, a("09:00:00")), false);
  // mañana a las 0:30 no suena hoy a las 23:00
  assert.equal(debeSonar(aviso({ vence: "2026-10-09", hora: "00:30:00" }), a("23:00:00")), false);
});

test("con hora: una vez por fecha y hora; si cambian, vuelve a sonar", () => {
  const sonado = { notificado_para: HOY, notificado_hora: "18:00:00" };
  assert.equal(debeSonar(aviso({ hora: "18:00:00", ...sonado }), a("18:01:00")), false);
  assert.equal(debeSonar(aviso({ hora: "20:00:00", ...sonado }), a("19:00:00")), false);
  assert.equal(debeSonar(aviso({ hora: "20:00:00", ...sonado }), a("20:00:00")), true);
  // sonó a las 9:00 sin hora y luego se le puso a las 18:00
  const sinHora = { notificado_para: HOY, notificado_hora: null };
  assert.equal(debeSonar(aviso({ hora: "18:00:00", ...sinHora }), a("10:00:00")), false);
  assert.equal(debeSonar(aviso({ hora: "18:00:00", ...sinHora }), a("18:00:00")), true);
});

test("quitarle la hora a un aviso que ya sonó no lo repite", () => {
  const avisoSinHora = aviso({ notificado_para: HOY, notificado_hora: "18:00:00" });
  assert.equal(yaSono(avisoSinHora), true);
  assert.equal(debeSonar(avisoSinHora, a("19:00:00")), false);
});

test("con hora y vencido sin sonar: suena enseguida, a cualquier hora", () => {
  assert.equal(debeSonar(aviso({ vence: "2026-10-07", hora: "22:00:00" }), a("03:00:00")), true);
});

test("sin fecha no suena nunca, aunque tenga hora", () => {
  assert.equal(debeSonar(aviso({ vence: null }), a("12:00:00")), false);
  assert.equal(debeSonar(aviso({ vence: null, hora: "08:00:00" }), a("12:00:00")), false);
});

test("textos de la notificación", () => {
  assert.equal(cuerpoDelAviso(aviso(), HOY), "Vence hoy");
  assert.equal(cuerpoDelAviso(aviso({ hora: "18:00:00" }), HOY), "Hoy a las 18:00");
  assert.equal(cuerpoDelAviso(aviso({ vence: "2026-10-07" }), HOY), "Venció el 7 oct");
  assert.equal(
    cuerpoDelAviso(aviso({ vence: "2026-10-07", hora: "09:05:00" }), HOY),
    "Venció el 7 oct a las 09:05",
  );
  assert.equal(cuerpoDelAviso(aviso({ vence: "2025-12-31" }), HOY), "Venció el 31 dic 2025");
});

// ---------- La vuelta entera, con Supabase y el push falsos ----------

function entorno({ avisos = [], subs = [], reservar = () => true, enviar = () => "ok", hora = "18:00:00" } = {}) {
  const log = { reservados: [], devueltos: [], enviados: [], borradas: [], leyoSuscripciones: false };
  const e = {
    ahora: a(hora),
    leerAvisos: async (hoy) => {
      assert.equal(hoy, HOY);
      return avisos;
    },
    leerSuscripciones: async () => {
      log.leyoSuscripciones = true;
      return subs;
    },
    reservar: async (av) => {
      log.reservados.push(av.id);
      return reservar(av);
    },
    devolver: async (av) => log.devueltos.push(av.id),
    enviar: async (s, mensaje) => {
      log.enviados.push({ endpoint: s.endpoint, ...mensaje });
      return enviar(s, mensaje);
    },
    borrarSuscripcion: async (endpoint) => log.borradas.push(endpoint),
  };
  return { e, log };
}

const SUBS = [
  { endpoint: "https://push.ejemplo/1", datos: {} },
  { endpoint: "https://push.ejemplo/2", datos: {} },
];

test("vuelta: nada que sonar → ni mira los dispositivos", async () => {
  const { e, log } = entorno({ avisos: [aviso({ hora: "20:00:00" })], subs: SUBS });
  assert.deepEqual(await repartir(e), { enviadas: 0 });
  assert.equal(log.leyoSuscripciones, false);
  assert.deepEqual(log.reservados, []);
});

test("vuelta: sin dispositivos no reserva nada (se reintenta en la siguiente)", async () => {
  const { e, log } = entorno({ avisos: [aviso({ hora: "18:00:00" })] });
  assert.deepEqual(await repartir(e), { enviadas: 0, motivo: "sin dispositivos suscritos" });
  assert.deepEqual(log.reservados, []);
});

test("vuelta: reserva, envía a todos los dispositivos y no devuelve", async () => {
  const avisos = [aviso({ hora: "18:00:00" }), aviso({ id: "a2", hora: "20:00:00" }), aviso({ id: "a3" })];
  const { e, log } = entorno({ avisos, subs: SUBS });
  assert.deepEqual(await repartir(e), { enviadas: 4, fallos: 0, dispositivos: 2 });
  assert.deepEqual(log.reservados, ["a1", "a3"]);
  assert.deepEqual(log.devueltos, []);
  assert.deepEqual(log.enviados[0], {
    endpoint: "https://push.ejemplo/1",
    titulo: "📌 Regar las plantas",
    cuerpo: "Hoy a las 18:00",
    tag: "aviso-a1",
  });
  assert.equal(log.enviados[2].cuerpo, "Vence hoy");
});

test("vuelta: si otra vuelta ya lo reservó, no se envía", async () => {
  const { e, log } = entorno({ avisos: [aviso({ hora: "18:00:00" })], subs: SUBS, reservar: () => false });
  assert.deepEqual(await repartir(e), { enviadas: 0, fallos: 0, dispositivos: 2 });
  assert.deepEqual(log.enviados, []);
  assert.deepEqual(log.devueltos, []);
});

test("vuelta: si no llega a ningún dispositivo, devuelve las marcas", async () => {
  const { e, log } = entorno({ avisos: [aviso({ hora: "18:00:00" })], subs: SUBS, enviar: () => "fallo" });
  assert.deepEqual(await repartir(e), { enviadas: 0, fallos: 2, dispositivos: 2 });
  assert.deepEqual(log.devueltos, ["a1"]);
});

test("vuelta: si llega a uno, no devuelve; los dispositivos muertos se borran una vez", async () => {
  const avisos = [aviso({ hora: "18:00:00" }), aviso({ id: "a2" })];
  const { e, log } = entorno({
    avisos,
    subs: SUBS,
    enviar: (s) => (s.endpoint.endsWith("/1") ? "muerta" : "ok"),
  });
  assert.deepEqual(await repartir(e), { enviadas: 2, fallos: 0, dispositivos: 1 });
  assert.deepEqual(log.devueltos, []);
  assert.deepEqual(log.borradas, ["https://push.ejemplo/1"]);
  // al segundo aviso ya no se le intenta enviar al dispositivo muerto
  assert.deepEqual(log.enviados.map((x) => x.endpoint), [
    "https://push.ejemplo/1",
    "https://push.ejemplo/2",
    "https://push.ejemplo/2",
  ]);
});

test("vuelta: si falla la lectura de avisos, la vuelta falla (la función responde 500)", async () => {
  const { e } = entorno();
  e.leerAvisos = async () => {
    throw new Error("sin conexión");
  };
  await assert.rejects(repartir(e), /sin conexión/);
});

// ---------- «Te toca a ti» y «terminado» ----------

const ANA = "ana@ejemplo.com";
const BETO = "beto@ejemplo.com";
const NOMBRES = new Map([[ANA, "Ana"], [BETO, "Beto"]]);
const AHORA_MS = Date.parse("2026-10-09T18:00:00Z");

function evento(cambios = {}) {
  return {
    id: 1,
    tipo: "te_toca",
    aviso_id: "a1",
    texto: "Comprar pan",
    quien: BETO,
    para: ANA,
    creado_en: "2026-10-09T17:59:30Z",
    intentos: 0,
    ...cambios,
  };
}

test("mensajes: te toca y terminado, con el nombre de quien lo hizo", () => {
  assert.deepEqual(mensajeDeEvento(evento(), NOMBRES), {
    titulo: "👉 Te toca: Comprar pan",
    cuerpo: "Te lo pasó Beto",
    tag: "te-toca-a1",
  });
  assert.deepEqual(mensajeDeEvento(evento({ tipo: "terminado", quien: ANA, para: BETO }), NOMBRES), {
    titulo: "✅ Ana terminó: Comprar pan",
    cuerpo: "Ya está hecho",
    tag: "terminado-a1",
  });
  // Sin quien (desde el SQL Editor) o alguien que ya no está en personas
  assert.equal(mensajeDeEvento(evento({ quien: null }), NOMBRES).cuerpo, "Te lo pasaron");
  assert.equal(mensajeDeEvento(evento({ tipo: "terminado", quien: null }), NOMBRES).titulo, "✅ Terminado: Comprar pan");
  assert.equal(mensajeDeEvento(evento({ quien: "carla@ejemplo.com" }), NOMBRES).cuerpo, "Te lo pasó carla");
});

function entornoEventos({ eventos = [], subs = [], reservar = () => true, enviar = () => "ok" } = {}) {
  const log = { reservados: [], devueltos: [], enviados: [], borradas: [], leyoSubs: false };
  const e = {
    ahoraMs: AHORA_MS,
    leerEventos: async () => eventos,
    leerSuscripciones: async () => {
      log.leyoSubs = true;
      return subs;
    },
    leerPersonas: async () => [...NOMBRES].map(([correo, nombre]) => ({ correo, nombre })),
    reservarEvento: async (ev) => {
      log.reservados.push(ev.id);
      return reservar(ev);
    },
    devolverEvento: async (ev) => log.devueltos.push(ev.id),
    enviar: async (s, mensaje) => {
      log.enviados.push({ endpoint: s.endpoint, titulo: mensaje.titulo });
      return enviar(s, mensaje);
    },
    borrarSuscripcion: async (endpoint) => log.borradas.push(endpoint),
  };
  return { e, log };
}

const SUBS_PAREJA = [
  { endpoint: "https://push.ejemplo/ana-movil", datos: {}, correo: ANA },
  { endpoint: "https://push.ejemplo/beto-movil", datos: {}, correo: BETO },
  { endpoint: "https://push.ejemplo/beto-pc", datos: {}, correo: BETO },
];

test("eventos: sin cola no mira ni los dispositivos", async () => {
  const { e, log } = entornoEventos({ subs: SUBS_PAREJA });
  assert.deepEqual(await repartirEventos(e), { eventos: 0 });
  assert.equal(log.leyoSubs, false);
});

test("eventos: cada uno va solo a los dispositivos de su destinatario", async () => {
  const eventos = [evento(), evento({ id: 2, tipo: "terminado", quien: ANA, para: BETO, aviso_id: "a2" })];
  const { e, log } = entornoEventos({ eventos, subs: SUBS_PAREJA });
  assert.deepEqual(await repartirEventos(e), { eventos: 2, enviadas: 3, fallos: 0, descartados: 0 });
  assert.deepEqual(log.enviados, [
    { endpoint: "https://push.ejemplo/ana-movil", titulo: "👉 Te toca: Comprar pan" },
    { endpoint: "https://push.ejemplo/beto-movil", titulo: "✅ Ana terminó: Comprar pan" },
    { endpoint: "https://push.ejemplo/beto-pc", titulo: "✅ Ana terminó: Comprar pan" },
  ]);
  assert.deepEqual(log.devueltos, []);
});

test("eventos: si otra vuelta ya lo reservó, no se envía", async () => {
  const { e, log } = entornoEventos({ eventos: [evento()], subs: SUBS_PAREJA, reservar: () => false });
  assert.deepEqual(await repartirEventos(e), { eventos: 1, enviadas: 0, fallos: 0, descartados: 0 });
  assert.deepEqual(log.enviados, []);
});

test("eventos: los viejos y los que fallaron demasiado se descartan sin enviar", async () => {
  const eventos = [
    evento({ creado_en: "2026-10-09T05:59:00Z" }), // 12 h y 1 min
    evento({ id: 2, intentos: MAX_INTENTOS_EVENTO }),
    evento({ id: 3, creado_en: "2026-10-09T06:01:00Z", intentos: MAX_INTENTOS_EVENTO - 1 }),
  ];
  const { e, log } = entornoEventos({ eventos, subs: SUBS_PAREJA });
  assert.deepEqual(await repartirEventos(e), { eventos: 3, enviadas: 1, fallos: 0, descartados: 2 });
  assert.deepEqual(log.reservados, [1, 2, 3]); // reservados = marcados: no se vuelven a mirar
});

test("eventos: sin dispositivos del destinatario queda marcado, sin reintentos", async () => {
  const { e, log } = entornoEventos({ eventos: [evento()], subs: SUBS_PAREJA.slice(1) });
  assert.deepEqual(await repartirEventos(e), { eventos: 1, enviadas: 0, fallos: 0, descartados: 0 });
  assert.deepEqual(log.enviados, []);
  assert.deepEqual(log.devueltos, []);
});

test("eventos: si falla en todos sus dispositivos, se devuelve para reintentar", async () => {
  const { e, log } = entornoEventos({ eventos: [evento()], subs: SUBS_PAREJA, enviar: () => "fallo" });
  assert.deepEqual(await repartirEventos(e), { eventos: 1, enviadas: 0, fallos: 1, descartados: 0 });
  assert.deepEqual(log.devueltos, [1]);
});

test("eventos: un dispositivo muerto se borra una vez y no se reintenta", async () => {
  const eventos = [
    evento({ tipo: "terminado", quien: ANA, para: BETO }),
    evento({ id: 2, tipo: "terminado", quien: ANA, para: BETO, aviso_id: "a2" }),
  ];
  const { e, log } = entornoEventos({
    eventos,
    subs: SUBS_PAREJA,
    enviar: (s) => (s.endpoint.endsWith("beto-pc") ? "muerta" : "ok"),
  });
  assert.deepEqual(await repartirEventos(e), { eventos: 2, enviadas: 2, fallos: 0, descartados: 0 });
  assert.deepEqual(log.borradas, ["https://push.ejemplo/beto-pc"]);
  assert.deepEqual(log.devueltos, []);
  assert.equal(log.enviados.filter((x) => x.endpoint.endsWith("beto-pc")).length, 1);
});
