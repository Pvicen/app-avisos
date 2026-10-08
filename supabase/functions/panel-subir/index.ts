// Edge Function "panel-subir": recibe el JSON del panel (Contrato C1) que manda el portátil y lo
// guarda en la tabla `panel` (Contrato C2, docs/panel-contrato.md).
//
// - Solo POST. Se autentica con la cabecera `x-panel-clave`, comparada en tiempo constante con
//   el secreto PANEL_CLAVE. Se despliega con «Verify JWT» APAGADO: el portátil no tiene sesión.
// - El dueño sale del secreto PANEL_DUENO (su correo), NUNCA de la petición: una clave filtrada
//   solo puede pisar ese panel, no crear filas para otros.
// - 405 otro método · 401 clave mala · 413 más de 256 KB · 400 no cumple C1 · 204 guardado.
// - Sin CORS (no la llama ningún navegador) y nunca escribe el cuerpo en los logs.
//
// Secretos (Edge Functions → Secrets): PANEL_CLAVE y PANEL_DUENO. SUPABASE_URL y
// SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.

import { MAX_BYTES, revisarCuerpo } from "./validar.mjs";

/** Fila de la tabla `panel`. */
export type Fila = {
  dueno: string;
  datos: unknown;
  version: number;
  generado: string;
  recibido: string;
};

export type Entorno = {
  clave: string;
  dueno: string;
  /** Guarda (upsert por dueño). Devuelve null si fue bien o un código de error corto. */
  guardar: (fila: Fila) => Promise<string | null>;
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

  const dueno = entorno.dueno.trim().toLowerCase();
  if (!entorno.clave || !dueno.includes("@")) {
    console.error("panel-subir: faltan los secretos PANEL_CLAVE o PANEL_DUENO");
    return respuesta(500, { error: "la función no está configurada" });
  }

  if (!(await mismaClave(req.headers.get("x-panel-clave") ?? "", entorno.clave))) {
    return respuesta(401, { error: "clave incorrecta" });
  }

  const bytes = await leerCuerpo(req);
  if (bytes === null) return respuesta(413, { error: "el cuerpo pasa de 256 KB" });

  const revision = revisarCuerpo(bytes);
  if (!revision.ok) {
    return respuesta(revision.estado, { error: "no cumple el Contrato C1", motivos: revision.motivos });
  }

  const datos = revision.datos;
  const fallo = await entorno.guardar({
    dueno,
    datos,
    version: datos.version,
    generado: datos.generado,
    recibido: new Date().toISOString(),
  });
  if (fallo) {
    console.error("panel-subir: no se pudo guardar el panel:", fallo);
    return respuesta(500, { error: "no se pudo guardar el panel" });
  }
  return respuesta(204);
}

/** Upsert en `panel` con la service role, directo contra la API REST de la base. */
async function guardarEnSupabase(fila: Fila): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const llave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !llave) return "faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY";
  try {
    const r = await fetch(`${url}/rest/v1/panel?on_conflict=dueno`, {
      method: "POST",
      headers: {
        apikey: llave,
        Authorization: `Bearer ${llave}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(fila),
    });
    if (r.ok) return null;
    // Solo el código: el mensaje de la base podría citar valores de la fila
    let codigo = "";
    try {
      codigo = (await r.json())?.code ?? "";
    } catch {
      // sin cuerpo JSON
    }
    return `HTTP ${r.status}${codigo ? " " + codigo : ""}`;
  } catch {
    return "sin conexión con la base";
  }
}

// En Supabase (Deno) se sirve; en las pruebas (Node) solo se importa `manejar`.
if (typeof Deno !== "undefined") {
  Deno.serve((req) =>
    manejar(req, {
      clave: Deno.env.get("PANEL_CLAVE") ?? "",
      dueno: Deno.env.get("PANEL_DUENO") ?? "",
      guardar: guardarEnSupabase,
    })
  );
}
