// Edge Function "atlas-aviso": Atlas, el asistente del PC, crea un aviso en la lista, solo para quien
// diga el secreto ATLAS_PARA. Calcada de `panel-subir`.
//
// - Solo POST. Se autentica con la cabecera `x-atlas-clave`, comparada en tiempo constante con el
//   secreto ATLAS_CLAVE. Se despliega con «Verify JWT» APAGADO: el PC no tiene sesión.
// - El destinatario (`para`) sale del secreto ATLAS_PARA, NUNCA de la petición, y `creado_por` es la
//   marca fija de Atlas (MARCA_ATLAS): una clave filtrada solo puede crear avisos para esa persona.
//   `Notificar` los manda solo a sus dispositivos; la lista la sigue viendo quien la comparte.
// - El cuerpo, 4 KB como mucho: {id, texto, vence, hora} (validar.mjs). SOLO inserta: si el id ya
//   existe, no toca nada.
// - 201 creado · 200 el id ya existía · 400 cuerpo malo · 401 clave mala · 405 otro método ·
//   413 más de 4 KB · 429 más de 30 avisos de Atlas en 24 h · 500 sin configurar o la base falla.
// - Sin CORS (no la llama ningún navegador) y nunca escribe el cuerpo, el destinatario ni la clave en
//   los logs.
//
// Secretos (Edge Functions → Secrets): ATLAS_CLAVE y ATLAS_PARA. SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo: la service role vive solo aquí.

import { MARCA_ATLAS, MAX_AL_DIA, MAX_BYTES, revisarCuerpo } from "./validar.mjs";

/** Fila nueva de la tabla `avisos`. */
export type Fila = {
  id: string;
  texto: string;
  vence: string | null;
  hora: string | null;
  creado_por: string;
  para: string;
};

export type Entorno = {
  clave: string;
  para: string;
  /** Cuántos avisos de Atlas se crearon en las últimas 24 horas; null si no se pudo contar. */
  contarDelDia: () => Promise<number | null>;
  /** Inserta si el id no existe: "creado", "existia" o un código de error corto. */
  insertar: (fila: Fila) => Promise<string>;
};

function respuesta(status: number, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Response {
  if (cuerpo === undefined) return new Response(null, { status, headers: cabeceras });
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cabeceras },
  });
}

/** Compara en tiempo constante: los dos resúmenes SHA-256 miden siempre lo mismo. */
async function mismaClave(dada: string, secreta: string): Promise<boolean> {
  const codificador = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", codificador.encode(dada)),
    crypto.subtle.digest("SHA-256", codificador.encode(secreta)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diferencia = 0;
  for (let i = 0; i < x.length; i++) diferencia |= x[i] ^ y[i];
  return diferencia === 0;
}

/** Lee el cuerpo sin pasar de MAX_BYTES; null si se pasa. */
async function leerCuerpo(req: Request): Promise<Uint8Array | null> {
  const declarado = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declarado) && declarado > MAX_BYTES) return null;
  if (!req.body) return new Uint8Array(0);

  const lector = req.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  const todo = new Uint8Array(total);
  let posicion = 0;
  for (const trozo of trozos) {
    todo.set(trozo, posicion);
    posicion += trozo.length;
  }
  return todo;
}

export async function manejar(req: Request, entorno: Entorno): Promise<Response> {
  if (req.method !== "POST") return respuesta(405, { error: "solo se acepta POST" }, { Allow: "POST" });

  const para = entorno.para.trim().toLowerCase();
  if (!entorno.clave || !para.includes("@")) {
    console.error("atlas-aviso: faltan los secretos ATLAS_CLAVE o ATLAS_PARA");
    return respuesta(500, { error: "la función no está configurada" });
  }

  if (!(await mismaClave(req.headers.get("x-atlas-clave") ?? "", entorno.clave))) {
    return respuesta(401, { error: "clave incorrecta" });
  }

  const bytes = await leerCuerpo(req);
  if (bytes === null) return respuesta(413, { error: "el cuerpo pasa de 4 KB" });

  const revision = revisarCuerpo(bytes);
  if (!revision.ok) return respuesta(revision.estado, { error: "el aviso no tiene la forma de Atlas" });

  const delDia = await entorno.contarDelDia();
  if (delDia === null) {
    console.error("atlas-aviso: no se pudieron contar los avisos del día");
    return respuesta(500, { error: "no se pudo crear el aviso" });
  }
  if (delDia >= MAX_AL_DIA) return respuesta(429, { error: "ya hay 30 avisos de Atlas en 24 horas" });

  const { id, texto, vence, hora } = revision.datos;
  const resultado = await entorno.insertar({
    id,
    texto,
    vence,
    hora: hora === null ? null : hora + ":00",
    creado_por: MARCA_ATLAS,
    para,
  });
  if (resultado === "creado") return respuesta(201, { estado: "creado" });
  if (resultado === "existia") return respuesta(200, { estado: "ya existía" });
  console.error("atlas-aviso: no se pudo crear el aviso:", resultado);
  return respuesta(500, { error: "no se pudo crear el aviso" });
}

/** La URL y la service role de Supabase, o null si faltan. */
function credenciales(): { url: string; llave: string } | null {
  const url = Deno.env.get("SUPABASE_URL");
  const llave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return url && llave ? { url, llave } : null;
}

/** Solo el código de un error de la base: su mensaje podría citar valores de la fila. */
async function codigoDeError(r: Response): Promise<string> {
  let codigo = "";
  try {
    codigo = (await r.json())?.code ?? "";
  } catch {
    // sin cuerpo JSON
  }
  return `HTTP ${r.status}${codigo ? " " + codigo : ""}`;
}

/** Cuenta los avisos de Atlas de las últimas 24 horas, sin traer ninguno (solo la cabecera del total). */
async function contarDelDiaEnSupabase(): Promise<number | null> {
  const c = credenciales();
  if (!c) return null;
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  try {
    const r = await fetch(
      `${c.url}/rest/v1/avisos?select=id&creado_por=eq.${MARCA_ATLAS}&creado_en=gte.${encodeURIComponent(desde)}`,
      {
        method: "HEAD",
        headers: { apikey: c.llave, Authorization: `Bearer ${c.llave}`, Prefer: "count=exact" },
      },
    );
    if (!r.ok) return null;
    const total = Number((r.headers.get("content-range") ?? "").split("/")[1]);
    return Number.isInteger(total) && total >= 0 ? total : null;
  } catch {
    return null;
  }
}

/** Inserta con la service role; si el id ya existe, no hace nada (ON CONFLICT DO NOTHING). */
async function insertarEnSupabase(fila: Fila): Promise<string> {
  const c = credenciales();
  if (!c) return "faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY";
  try {
    const r = await fetch(`${c.url}/rest/v1/avisos?on_conflict=id&select=id`, {
      method: "POST",
      headers: {
        apikey: c.llave,
        Authorization: `Bearer ${c.llave}`,
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(fila),
    });
    if (!r.ok) return await codigoDeError(r);
    const filas = await r.json();
    if (!Array.isArray(filas)) return "respuesta rara de la base";
    return filas.length > 0 ? "creado" : "existia";
  } catch {
    return "sin conexión con la base";
  }
}

// En Supabase (Deno) se sirve; en las pruebas (Node) solo se importa `manejar`.
if (typeof Deno !== "undefined") {
  Deno.serve((req) =>
    manejar(req, {
      clave: Deno.env.get("ATLAS_CLAVE") ?? "",
      para: Deno.env.get("ATLAS_PARA") ?? "",
      contarDelDia: contarDelDiaEnSupabase,
      insertar: insertarEnSupabase,
    })
  );
}
