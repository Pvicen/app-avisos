// Pruebas del validador del Contrato C1 (supabase/functions/panel-subir/validar.mjs).
// Se ejecutan con `node --test` desde la raíz del repo. Solo datos inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_BYTES, revisarCuerpo, validarPanel } from "../../supabase/functions/panel-subir/validar.mjs";

const EJEMPLO = readFileSync(new URL("../panel-ejemplo.json", import.meta.url));
const ejemplo = () => JSON.parse(EJEMPLO.toString("utf8")); // copia nueva en cada prueba

function rechaza(datos, pista) {
  const r = revisarCuerpo(JSON.stringify(datos));
  assert.equal(r.ok, false, "tenía que rechazarse");
  assert.equal(r.estado, 400);
  assert.ok(
    r.motivos.some((m) => m.includes(pista)),
    `ningún motivo menciona «${pista}»: ${r.motivos.join(" | ")}`
  );
}

function pasa(datos) {
  const r = revisarCuerpo(JSON.stringify(datos));
  assert.equal(r.ok, true, `tenía que pasar: ${(r.motivos || []).join(" | ")}`);
}

// ---------- Lo que pide el encargo ----------

test("el ejemplo pasa, en bytes y en texto", () => {
  const r = revisarCuerpo(new Uint8Array(EJEMPLO));
  assert.equal(r.ok, true, (r.motivos || []).join(" | "));
  assert.deepEqual(r.datos, ejemplo());
  assert.equal(revisarCuerpo(EJEMPLO.toString("utf8")).ok, true);
});

test("un campo de más se rechaza (en la raíz y dentro de un elemento)", () => {
  const a = ejemplo();
  a.extra = 1;
  rechaza(a, 'raíz: sobra el campo "extra"');
  const b = ejemplo();
  b.ejercicios[0].pista = "mira el tema 2";
  rechaza(b, 'ejercicios[0]: sobra el campo "pista"');
  const c = ejemplo();
  c.dias[0].estudio[1].lugar = "biblioteca";
  rechaza(c, 'dias[0].estudio[1]: sobra el campo "lugar"');
});

test("un campo que falta se rechaza (también url, aunque pueda ser null)", () => {
  const a = ejemplo();
  delete a.generado;
  rechaza(a, 'raíz: falta el campo "generado"');
  const b = ejemplo();
  delete b.entregas[1].url;
  rechaza(b, 'entregas[1]: falta el campo "url"');
  const c = ejemplo();
  delete c.banco[0].quedan;
  rechaza(c, 'banco[0]: falta el campo "quedan"');
});

test("un tipo malo se rechaza", () => {
  const casos = [
    [(d) => (d.version = "1"), "version"],
    [(d) => (d.ejercicios[0].nivel = "2"), "ejercicios[0].nivel"],
    [(d) => (d.dias = {}), "dias: tiene que ser una lista"],
    [(d) => (d.banco[0].quedan = 3.5), "banco[0].quedan"],
    [(d) => (d.dias[0].clases = null), "dias[0].clases: tiene que ser texto"],
    [(d) => (d.entregas[0] = "Práctica"), "entregas[0]: tiene que ser un objeto"],
    [(d) => (d.proyectos = null), "proyectos: tiene que ser una lista"],
  ];
  for (const [romper, pista] of casos) {
    const d = ejemplo();
    romper(d);
    rechaza(d, pista);
  }
  assert.deepEqual(validarPanel(null), ["raíz: tiene que ser un objeto"]);
  assert.deepEqual(validarPanel([]), ["raíz: tiene que ser un objeto"]);
});

test("un texto demasiado largo se rechaza; el límite cuenta letras, no bytes", () => {
  const a = ejemplo();
  a.entregas[0].titulo = "x".repeat(201);
  rechaza(a, "entregas[0].titulo: tiene 201 caracteres y el máximo es 200");
  const b = ejemplo();
  b.ejercicios[1].enunciado = "y".repeat(4001);
  rechaza(b, "ejercicios[1].enunciado: tiene 4001 caracteres");
  const c = ejemplo();
  c.banco[0].materia = "m".repeat(61);
  rechaza(c, "banco[0].materia");
  const d = ejemplo();
  d.banco[0].materia = "🌟".repeat(60); // 60 letras aunque sean 120 unidades UTF-16
  pasa(d);
  const e = ejemplo();
  e.ejercicios[2].solucion = "z".repeat(8000);
  pasa(e);
});

test("una URL que no es de Canvas se rechaza; null está permitido", () => {
  for (const url of [
    "https://otro-sitio.example/tarea",
    "http://canvas.ucam.edu/courses/1",
    "https://canvas.ucam.edu.otro-sitio.example/x",
    "javascript:alert(1)",
    "",
  ]) {
    const d = ejemplo();
    d.entregas[0].url = url;
    rechaza(d, "entregas[0].url");
  }
  const d = ejemplo();
  d.entregas[0].url = null;
  pasa(d);
});

test("la versión 2 se rechaza", () => {
  const d = ejemplo();
  d.version = 2;
  rechaza(d, "version: tiene que ser el entero 1");
});

test("demasiados (o muy pocos) elementos se rechazan", () => {
  const a = ejemplo();
  a.entregas = Array.from({ length: 51 }, () => ({ ...a.entregas[0] }));
  rechaza(a, "entregas: tiene 51 elementos y tienen que ser de 0 a 50");
  const b = ejemplo();
  b.dias = Array.from({ length: 8 }, () => ({ ...b.dias[2] }));
  rechaza(b, "dias: tiene 8 elementos");
  const c = ejemplo();
  c.dias = [];
  rechaza(c, "dias: tiene 0 elementos y tienen que ser de 1 a 7");
  const d = ejemplo();
  d.ejercicios = Array.from({ length: 11 }, (_, i) => ({ ...d.ejercicios[0], id: `x-${i}` }));
  rechaza(d, "ejercicios: tiene 11 elementos");
  const e = ejemplo();
  e.dias[0].estudio = Array.from({ length: 13 }, () => ({ ...e.dias[0].estudio[0] }));
  rechaza(e, "dias[0].estudio: tiene 13 elementos");
});

test("más de 256 KB se rechaza con 413; justo 256 KB todavía se lee", () => {
  const base = JSON.stringify(ejemplo());
  const justo = base + " ".repeat(MAX_BYTES - Buffer.byteLength(base));
  assert.equal(Buffer.byteLength(justo), MAX_BYTES);
  assert.equal(revisarCuerpo(justo).ok, true);
  const r = revisarCuerpo(justo + " ");
  assert.equal(r.ok, false);
  assert.equal(r.estado, 413);
  assert.equal(revisarCuerpo(new Uint8Array(MAX_BYTES + 1)).estado, 413);
});

// ---------- Más reglas de C1 ----------

test("lo que no es JSON o no es UTF-8 se rechaza con 400", () => {
  assert.deepEqual(revisarCuerpo("{ esto no es json").motivos, ["el cuerpo no es JSON válido"]);
  assert.deepEqual(revisarCuerpo("").motivos, ["el cuerpo no es JSON válido"]);
  assert.deepEqual(revisarCuerpo(new Uint8Array([0xff, 0xfe, 0x00])).motivos, ["el cuerpo no es UTF-8 válido"]);
});

test("texto plano: sin saltos de línea fuera de los ejercicios, sin HTML y sin nulos", () => {
  const a = ejemplo();
  a.entregas[0].titulo = "Informe\ndel herbario";
  rechaza(a, "entregas[0].titulo: no puede llevar saltos de línea");
  const b = ejemplo();
  b.novedades[0].titulo = "Tema <b>2</b>";
  rechaza(b, "novedades[0].titulo: no puede llevar HTML");
  const c = ejemplo();
  c.dias[0].clases = "Música\u0000";
  rechaza(c, "dias[0].clases: lleva un carácter nulo");
  // En los ejercicios sí hay saltos de línea, y < y > son fórmulas, no HTML
  const d = ejemplo();
  d.ejercicios[0].enunciado = "Si $a<b$ y $b>c$:\n$$a<b>c$$";
  pasa(d);
});

test("vacíos: solo donde C1 lo permite", () => {
  const a = ejemplo();
  a.dias[0].clases = "";
  a.parciales[1].hora = "";
  a.dias[0].estudio[0].duracion = "";
  pasa(a);
  const b = ejemplo();
  b.entregas[0].titulo = "  ";
  rechaza(b, "entregas[0].titulo: no puede estar vacío");
  const c = ejemplo();
  c.ejercicios[0].materia = "";
  rechaza(c, "ejercicios[0].materia: no puede estar vacío");
});

test("fechas: AAAA-MM-DD reales e instantes ISO 8601 con zona", () => {
  const casos = [
    [(d) => (d.dias[0].fecha = "2026-02-30"), "dias[0].fecha"],
    [(d) => (d.dias[0].fecha = "08/10/2026"), "dias[0].fecha"],
    [(d) => (d.generado = "2026-10-08T17:10:00"), "generado"],
    [(d) => (d.generado = "2026-10-08 17:10:00+02:00"), "generado"],
    [(d) => (d.entregas[0].vence = "2026-10-09T25:00:00+02:00"), "entregas[0].vence"],
    [(d) => (d.novedades[0].fecha = "ayer"), "novedades[0].fecha"],
    [(d) => (d.parciales[0].fecha = "2026-13-01"), "parciales[0].fecha"],
  ];
  for (const [romper, pista] of casos) {
    const d = ejemplo();
    romper(d);
    rechaza(d, pista);
  }
  const ok = ejemplo();
  ok.generado = "2026-10-08T15:10:00.123456Z"; // con microsegundos y en UTC, como lo escribe Python
  pasa(ok);
});

test("ids, niveles, tipos y cantidades del banco", () => {
  const casos = [
    [(d) => (d.ejercicios[0].id = "Ast-0001"), "ejercicios[0].id"],
    [(d) => (d.ejercicios[0].id = "a".repeat(41)), "ejercicios[0].id"],
    [(d) => (d.ejercicios[1].id = d.ejercicios[0].id), "ejercicios[1].id: está repetido"],
    [(d) => (d.ejercicios[0].nivel = 4), "ejercicios[0].nivel"],
    [(d) => (d.novedades[0].tipo = "video"), "novedades[0].tipo"],
    [(d) => (d.banco[0].quedan = -1), "banco[0].quedan"],
    [(d) => (d.banco[0].quedan = 10000), "banco[0].quedan"],
  ];
  for (const [romper, pista] of casos) {
    const d = ejemplo();
    romper(d);
    rechaza(d, pista);
  }
});

test("el orden de entregas, parciales y novedades", () => {
  const a = ejemplo();
  a.entregas.reverse();
  rechaza(a, "entregas: tiene que ir ordenada por vence");
  const b = ejemplo();
  b.parciales.reverse();
  rechaza(b, "parciales: tiene que ir ordenada por fecha");
  const c = ejemplo();
  c.novedades.reverse();
  rechaza(c, "novedades: tiene que ir ordenada por fecha (lo más nuevo primero)");
  const d = ejemplo();
  d.entregas[1].vence = d.entregas[0].vence; // los empates valen
  pasa(d);
});

test("los proyectos de la Fase 2 ya se aceptan con su forma", () => {
  const d = ejemplo();
  d.proyectos = [{ nombre: "Huerto", estado: "", siguiente: "Regar", fecha: "2026-10-08" }];
  pasa(d);
  d.proyectos[0].fecha = "pronto";
  rechaza(d, "proyectos[0].fecha");
});

test("la lista de motivos es corta y no repite los valores", () => {
  const d = ejemplo();
  d.entregas = d.entregas.map((e) => ({ ...e, url: "https://dato-secreto.example/" }));
  d.novedades = d.novedades.map((n) => ({ ...n, tipo: "secreto" }));
  d.ejercicios = d.ejercicios.map((x) => ({ ...x, nivel: 9 }));
  d.banco = d.banco.map((b) => ({ ...b, quedan: -5 }));
  const r = revisarCuerpo(JSON.stringify(d));
  assert.equal(r.ok, false);
  assert.ok(r.motivos.length <= 11, `demasiados motivos: ${r.motivos.length}`);
  assert.match(r.motivos.at(-1), /^… y \d+ motivo\(s\) más$/);
  assert.ok(!r.motivos.join(" ").includes("secreto"), "un motivo repite un valor del JSON");
});
