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
// - El tope del día y la inserción van en UN paso, la función de la base `atlas_crear_aviso`
//   (setup/migraciones/2026-10-24-atlas-aviso-tope.sql), bajo un cerrojo: contar aquí y luego
//   insertar dejaba que varias peticiones a la vez se saltaran el tope.
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
  /**
   * En un solo paso y bajo el cerrojo de la base: "existia" si el id ya existe, "tope" si ya hay
   * MAX_AL_DIA de Atlas en 24 horas, "creado" si lo inserta, o un código de error corto.
   */
  crear: (fila: Fila) => Promise<string>;
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

  const { id, texto, vence, hora } = revision.datos;
  const resultado = await entorno.crear({
    id,
    texto,
    vence,
    hora: hora === null ? null : hora + ":00",
    creado_por: MARCA_ATLAS,
    para,
  });
  if (resultado === "creado") return respuesta(201, { estado: "creado" });
  if (resultado === "existia") return respuesta(200, { estado: "ya existía" });
  if (resultado === "tope") return respuesta(429, { error: `ya hay ${MAX_AL_DIA} avisos de Atlas en 24 horas` });
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

/**
 * Llama con la service role a `atlas_crear_aviso`, que mira el id, cuenta y solo entonces inserta,
 * todo bajo su cerrojo. La marca y el tope los pone la base; aquí solo viajan los datos del aviso y
 * `para`. PostgREST devuelve el texto de la función como una cadena JSON.
 */
async function crearEnSupabase(fila: Fila): Promise<string> {
  const c = credenciales();
  if (!c) return "faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY";
  try {
    const r = await fetch(`${c.url}/rest/v1/rpc/atlas_crear_aviso`, {
      method: "POST",
      headers: { apikey: c.llave, Authorization: `Bearer ${c.llave}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_id: fila.id,
        p_texto: fila.texto,
        p_vence: fila.vence,
        p_hora: fila.hora,
        p_para: fila.para,
      }),
    });
    if (!r.ok) return await codigoDeError(r);
    const dicho = await r.json();
    return dicho === "creado" || dicho === "existia" || dicho === "tope" ? dicho : "respuesta rara de la base";
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
      crear: crearEnSupabase,
    })
  );
}
