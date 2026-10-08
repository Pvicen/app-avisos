// Pruebas de la Edge Function panel-subir (supabase/functions/panel-subir/index.ts) sin Deno:
// Node la importa quitando los tipos y se prueba `manejar` con un `guardar` falso.
// Se ejecutan con `node --test` desde la raíz del repo. Solo datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { manejar } from "../../supabase/functions/panel-subir/index.ts";

const EJEMPLO = readFileSync(new URL("../panel-ejemplo.json", import.meta.url));
const URL_FUNCION = "http://localhost/functions/v1/panel-subir";
const CLAVE = "clave-de-prueba-inventada";

function entorno(guardadas = [], fallo = null) {
  return {
    clave: CLAVE,
    dueno: " Dueno@Ejemplo.COM ",
    guardar: async (fila) => {
      guardadas.push(fila);
      return fallo;
    },
  };
}

function post(cuerpo, cabeceras = { "x-panel-clave": CLAVE }) {
  return new Request(URL_FUNCION, { method: "POST", headers: cabeceras, body: cuerpo });
}

test("otro método → 405, con Allow: POST y sin CORS", async () => {
  for (const metodo of ["GET", "OPTIONS", "PUT", "DELETE"]) {
    const r = await manejar(new Request(URL_FUNCION, { method: metodo }), entorno());
    assert.equal(r.status, 405, metodo);
    assert.equal(r.headers.get("allow"), "POST");
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  }
});

test("sin clave o con la clave mala → 401, y no se guarda nada", async () => {
  const guardadas = [];
  for (const cabeceras of [{}, { "x-panel-clave": "otra" }, { "x-panel-clave": CLAVE + "x" }, { "x-panel-clave": "" }]) {
    const r = await manejar(post(EJEMPLO, cabeceras), entorno(guardadas));
    assert.equal(r.status, 401);
  }
  assert.equal(guardadas.length, 0);
});

test("sin los secretos configurados → 500, sin guardar", async (t) => {
  t.mock.method(console, "error", () => {});
  const guardadas = [];
  const sinClave = { ...entorno(guardadas), clave: "" };
  assert.equal((await manejar(post(EJEMPLO, { "x-panel-clave": "" }), sinClave)).status, 500);
  const sinDueno = { ...entorno(guardadas), dueno: "" };
  assert.equal((await manejar(post(EJEMPLO), sinDueno)).status, 500);
  assert.equal(guardadas.length, 0);
});

test("más de 256 KB → 413, lo diga Content-Length o no", async () => {
  const grande = new Uint8Array(256 * 1024 + 1).fill(32);
  assert.equal((await manejar(post(grande), entorno())).status, 413);
  // Sin Content-Length: el cuerpo llega a trozos y se corta al pasarse
  const flujo = new ReadableStream({
    start(c) {
      for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(64 * 1024).fill(32));
      c.close();
    },
  });
  const req = new Request(URL_FUNCION, {
    method: "POST",
    headers: { "x-panel-clave": CLAVE },
    body: flujo,
    duplex: "half",
  });
  assert.equal(req.headers.get("content-length"), null);
  assert.equal((await manejar(req, entorno())).status, 413);
});

test("JSON que no cumple C1 → 400 con la lista de motivos, sin guardar", async () => {
  const guardadas = [];
  const malo = JSON.parse(EJEMPLO.toString("utf8"));
  malo.version = 2;
  const r = await manejar(post(JSON.stringify(malo)), entorno(guardadas));
  assert.equal(r.status, 400);
  const cuerpo = await r.json();
  assert.ok(Array.isArray(cuerpo.motivos) && cuerpo.motivos.length > 0);
  assert.ok(cuerpo.motivos.some((m) => m.startsWith("version")));
  assert.equal(guardadas.length, 0);
  assert.equal((await manejar(post("no es json"), entorno(guardadas))).status, 400);
});

test("el ejemplo → 204 y se guarda con el dueño del secreto, nunca de la petición", async () => {
  const guardadas = [];
  const r = await manejar(post(EJEMPLO), entorno(guardadas));
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  assert.equal(guardadas.length, 1);
  const fila = guardadas[0];
  assert.deepEqual(Object.keys(fila).sort(), ["datos", "dueno", "generado", "recibido", "version"]);
  assert.equal(fila.dueno, "dueno@ejemplo.com"); // del secreto, recortado y en minúsculas
  assert.deepEqual(fila.datos, JSON.parse(EJEMPLO.toString("utf8")));
  assert.equal(fila.version, 1);
  assert.equal(fila.generado, "2026-10-08T17:10:00+02:00");
  assert.ok(!Number.isNaN(Date.parse(fila.recibido)));

  // Un "dueno" metido en el JSON no cuela: C1 no tiene ese campo y se rechaza entero
  const intruso = JSON.parse(EJEMPLO.toString("utf8"));
  intruso.dueno = "otra-persona@ejemplo.com";
  assert.equal((await manejar(post(JSON.stringify(intruso)), entorno(guardadas))).status, 400);
  assert.equal(guardadas.length, 1);
});

test("si la base falla → 500, y el log no lleva nada del cuerpo", async (t) => {
  const errores = t.mock.method(console, "error", () => {});
  const r = await manejar(post(EJEMPLO), entorno([], "HTTP 500 XX000"));
  assert.equal(r.status, 500);
  const escrito = errores.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.ok(escrito.length > 0, "tenía que avisar en el log");
  for (const dato of ["Astronomía", "Kepler", "herbario", "canvas.ucam.edu", "Dueno@Ejemplo"]) {
    assert.ok(!escrito.includes(dato), `el log incluye «${dato}»`);
  }
});

test("en el camino feliz y en los rechazos no se escribe nada en el log", async (t) => {
  const errores = t.mock.method(console, "error", () => {});
  const logs = t.mock.method(console, "log", () => {});
  await manejar(post(EJEMPLO), entorno());
  await manejar(post(EJEMPLO, { "x-panel-clave": "mala" }), entorno());
  await manejar(post('{"version": 2}'), entorno());
  assert.equal(errores.mock.callCount(), 0);
  assert.equal(logs.mock.callCount(), 0);
});
