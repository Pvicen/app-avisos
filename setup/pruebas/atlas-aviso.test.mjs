// Pruebas de la Edge Function atlas-aviso (supabase/functions/atlas-aviso/index.ts) sin Deno: Node la
// importa quitando los tipos y se prueba `manejar` con una base falsa. Atlas (el asistente del PC) crea
// avisos solo para quien diga el secreto ATLAS_PARA. Se ejecutan con `node --test` desde la raíz del
// repo. Solo datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { manejar } from "../../supabase/functions/atlas-aviso/index.ts";
import { MARCA_ATLAS, MAX_AL_DIA, MAX_BYTES, revisarCuerpo } from "../../supabase/functions/atlas-aviso/validar.mjs";

const URL_FUNCION = "http://localhost/functions/v1/atlas-aviso";
const CLAVE = "c1a7e".repeat(12) + "0123"; // 64 caracteres, inventada
const PARA = "persona@ejemplo.com";
const ID = "3f1e2d4c-5b6a-4789-8abc-def012345678";
const BUENO = { id: ID, texto: "Llamar a la tutora", vence: "2026-10-24", hora: "09:30" };

function base({ existentes = new Set(), enDia = 0, fallo = null } = {}) {
  const filas = [];
  return {
    filas,
    entorno: {
      clave: CLAVE,
      para: ` ${PARA.toUpperCase()} `,
      contarDelDia: async () => enDia,
      insertar: async (fila) => {
        if (fallo) return fallo;
        if (existentes.has(fila.id)) return "existia";
        existentes.add(fila.id);
        filas.push(fila);
        return "creado";
      },
    },
  };
}

function post(cuerpo, cabeceras = { "x-atlas-clave": CLAVE }) {
  const datos = typeof cuerpo === "string" || cuerpo instanceof Uint8Array ? cuerpo : JSON.stringify(cuerpo);
  return new Request(URL_FUNCION, { method: "POST", headers: cabeceras, body: datos });
}

test("otro método → 405, con Allow: POST y sin CORS", async () => {
  for (const metodo of ["GET", "OPTIONS", "PUT", "DELETE", "PATCH"]) {
    const r = await manejar(new Request(URL_FUNCION, { method: metodo }), base().entorno);
    assert.equal(r.status, 405, metodo);
    assert.equal(r.headers.get("allow"), "POST");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
});

test("sin clave o con la clave mala → 401, y no se inserta nada", async () => {
  const { filas, entorno } = base();
  for (const cabeceras of [{}, { "x-atlas-clave": "otra" }, { "x-atlas-clave": CLAVE + "0" },
    { "x-atlas-clave": "" }, { "x-panel-clave": CLAVE }, { authorization: "Bearer " + CLAVE }]) {
    assert.equal((await manejar(post(BUENO, cabeceras), entorno)).status, 401);
  }
  assert.equal(filas.length, 0);
});

test("sin los secretos configurados → 500, sin insertar", async (t) => {
  t.mock.method(console, "error", () => {});
  const sinClave = base();
  sinClave.entorno.clave = "";
  assert.equal((await manejar(post(BUENO, { "x-atlas-clave": "" }), sinClave.entorno)).status, 500);
  const sinPara = base();
  sinPara.entorno.para = "";
  assert.equal((await manejar(post(BUENO), sinPara.entorno)).status, 500);
  assert.equal(sinClave.filas.length + sinPara.filas.length, 0);
});

test("el aviso bueno → 201, con «para» del secreto, la marca de Atlas y la hora con segundos", async () => {
  const { filas, entorno } = base();
  const r = await manejar(post(BUENO), entorno);
  assert.equal(r.status, 201);
  assert.deepEqual(filas, [{
    id: ID, texto: "Llamar a la tutora", vence: "2026-10-24", hora: "09:30:00", creado_por: MARCA_ATLAS,
    para: PARA,
  }]);
  assert.equal(MARCA_ATLAS, "atlas");
});

test("«para» y «creado_por» nunca salen de la petición: una clave de más es 400", async () => {
  const { filas, entorno } = base();
  for (const intruso of [{ para: "otra@ejemplo.com" }, { creado_por: "otra@ejemplo.com" }, { prioridad: true }]) {
    assert.equal((await manejar(post({ ...BUENO, ...intruso }), entorno)).status, 400);
  }
  assert.equal(filas.length, 0);
});

test("el mismo id otra vez → 200, sin insertar otro", async () => {
  const { filas, entorno } = base();
  assert.equal((await manejar(post(BUENO), entorno)).status, 201);
  assert.equal((await manejar(post(BUENO), entorno)).status, 200);
  assert.equal(filas.length, 1);
});

test("sin fecha y sin hora, o con fecha y sin hora, valen", async () => {
  const { filas, entorno } = base();
  assert.equal((await manejar(post({ ...BUENO, vence: null, hora: null }), entorno)).status, 201);
  const otro = { ...BUENO, id: "3f1e2d4c-5b6a-4789-8abc-def012345679", hora: null };
  assert.equal((await manejar(post(otro), entorno)).status, 201);
  assert.deepEqual(filas.map((f) => [f.vence, f.hora]), [[null, null], ["2026-10-24", null]]);
});

test("más de 4 KB → 413, lo diga Content-Length o no", async () => {
  assert.equal(MAX_BYTES, 4096);
  assert.equal((await manejar(post(new Uint8Array(MAX_BYTES + 1).fill(32)), base().entorno)).status, 413);
  const flujo = new ReadableStream({
    start(c) {
      for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(2048).fill(32));
      c.close();
    },
  });
  const req = new Request(URL_FUNCION, {
    method: "POST", headers: { "x-atlas-clave": CLAVE }, body: flujo, duplex: "half",
  });
  assert.equal((await manejar(req, base().entorno)).status, 413);
});

test("el tope del día: con 30 de Atlas en las últimas 24 h, 429 y no se inserta", async () => {
  assert.equal(MAX_AL_DIA, 30);
  const lleno = base({ enDia: MAX_AL_DIA });
  assert.equal((await manejar(post(BUENO), lleno.entorno)).status, 429);
  assert.equal(lleno.filas.length, 0);
  const casi = base({ enDia: MAX_AL_DIA - 1 });
  assert.equal((await manejar(post(BUENO), casi.entorno)).status, 201);
});

test("si la base falla → 500, y el log no lleva nada del cuerpo ni del destinatario", async (t) => {
  const errores = t.mock.method(console, "error", () => {});
  const { entorno } = base({ fallo: "HTTP 500 XX000" });
  assert.equal((await manejar(post(BUENO), entorno)).status, 500);
  const escrito = errores.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.ok(escrito.length > 0, "tenía que avisar en el log");
  for (const dato of ["tutora", "persona@", "PERSONA@", CLAVE, ID]) {
    assert.ok(!escrito.includes(dato), `el log incluye «${dato}»`);
  }
});

test("en el camino feliz y en los rechazos no se escribe nada en el log", async (t) => {
  const errores = t.mock.method(console, "error", () => {});
  const logs = t.mock.method(console, "log", () => {});
  await manejar(post(BUENO), base().entorno);
  await manejar(post(BUENO, { "x-atlas-clave": "mala" }), base().entorno);
  await manejar(post({ ...BUENO, texto: "" }), base().entorno);
  assert.equal(errores.mock.callCount(), 0);
  assert.equal(logs.mock.callCount(), 0);
});

// --- el validador -------------------------------------------------------------------------------------------
function revisar(objeto) {
  return revisarCuerpo(new TextEncoder().encode(JSON.stringify(objeto)));
}

test("revisarCuerpo: los cuerpos buenos", () => {
  for (const cuerpo of [
    BUENO,
    { ...BUENO, vence: null, hora: null },
    { ...BUENO, hora: null },
    { ...BUENO, texto: "x" },
    { ...BUENO, texto: "ñ".repeat(200) },
    { ...BUENO, texto: "Café con Ana 👍🏽" },
    { ...BUENO, vence: "2028-02-29", hora: "00:00" },
    { ...BUENO, hora: "23:59" },
  ]) {
    assert.equal(revisar(cuerpo).ok, true, JSON.stringify(cuerpo));
  }
});

test("revisarCuerpo: los cuerpos malos son 400", () => {
  const malos = [
    {},
    [],
    "texto",
    { ...BUENO, id: "no-es-un-uuid" },
    { ...BUENO, id: ID.toUpperCase() },
    { ...BUENO, id: 5 },
    { ...BUENO, texto: "" },
    { ...BUENO, texto: "x".repeat(201) },
    { ...BUENO, texto: "con\nsalto" },
    { ...BUENO, texto: "con\ttab" },
    { ...BUENO, texto: "con\u202eRLO" },
    { ...BUENO, texto: "con\u200eLRM" },
    { ...BUENO, texto: "con\u2028separador" },
    { ...BUENO, texto: "con\u0085NEL" },
    { ...BUENO, texto: 5 },
    { ...BUENO, vence: "2026-02-30" },
    { ...BUENO, vence: "24/10/2026" },
    { ...BUENO, vence: "" },
    { ...BUENO, hora: "9:30" },
    { ...BUENO, hora: "24:00" },
    { ...BUENO, hora: "09:60" },
    { ...BUENO, hora: "09:30:00" },
    { ...BUENO, vence: null, hora: "09:30" },
    { id: ID, texto: "x", vence: null },
  ];
  for (const cuerpo of malos) {
    const r = revisar(cuerpo);
    assert.equal(r.ok, false, JSON.stringify(cuerpo));
    assert.equal(r.estado, 400);
  }
  assert.equal(revisarCuerpo(new TextEncoder().encode("no es json")).estado, 400);
  // Un sustituto suelto escapado en el JSON no es texto válido
  assert.equal(revisarCuerpo(new TextEncoder().encode(JSON.stringify({ ...BUENO, texto: "x" }).replace('"x"', '"\\ud800"'))).ok,
    false);
});
