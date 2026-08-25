// Edge Function "notificar": revisa qué avisos vencen y envía notificaciones push.
// La invoca pg_cron cada hora; solo actúa desde las 9:00 (hora de Chile) y
// notifica una sola vez por fecha de vencimiento (columna notificado_para).
//
// Secretos requeridos (Edge Functions → Secrets):
//   VAPID_KEYS    → JSON con {publicKey, privateKey} en formato JWK
//   VAPID_SUBJECT → mailto:tu-correo
//   CRON_SECRET   → el mismo valor usado en el cron de pg_cron

import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush";

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "no autorizado" }, 401);
  }

  // Fecha y hora locales de Chile
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  });
  const partes = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hoy = `${partes.year}-${partes.month}-${partes.day}`;
  const hora = Number(partes.hour);
  if (hora < 9) return json({ enviadas: 0, motivo: "antes de las 9:00" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: avisos, error } = await sb
    .from("avisos")
    .select("id, texto, vence, notificado_para")
    .is("completado_en", null)
    .not("vence", "is", null)
    .lte("vence", hoy);
  if (error) return json({ error: error.message }, 500);

  const pendientes = (avisos ?? []).filter((a) => a.notificado_para !== a.vence);
  if (!pendientes.length) return json({ enviadas: 0 });

  const { data: subs, error: e2 } = await sb
    .from("push_suscripciones")
    .select("endpoint, datos");
  if (e2) return json({ error: e2.message }, 500);
  if (!subs?.length) return json({ enviadas: 0, motivo: "sin dispositivos suscritos" });

  const vapidKeys = await webpush.importVapidKeys(
    JSON.parse(Deno.env.get("VAPID_KEYS")!),
    { extractable: false },
  );
  const app = await webpush.ApplicationServer.new({
    contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:avisos@ejemplo.com",
    vapidKeys,
  });

  let enviadas = 0;
  let fallos = 0;
  const muertas = new Set<string>();

  for (const aviso of pendientes) {
    const cuerpo = aviso.vence === hoy ? "Vence hoy" : `Venció el ${aviso.vence}`;
    let exitos = 0;
    for (const s of subs) {
      if (muertas.has(s.endpoint)) continue;
      try {
        const destino = app.subscribe(s.datos);
        await destino.pushTextMessage(
          JSON.stringify({ titulo: "📌 " + aviso.texto, cuerpo, tag: "aviso-" + aviso.id }),
          {},
        );
        enviadas++;
        exitos++;
      } catch (err) {
        // 410/404: la suscripción caducó o el dispositivo se desuscribió → limpiar
        if (
          err instanceof webpush.PushMessageError &&
          (err.isGone() || err.response.status === 404)
        ) {
          muertas.add(s.endpoint);
        } else {
          fallos++;
          console.error(
            "Fallo push",
            s.endpoint,
            err instanceof webpush.PushMessageError ? err.toString() : err,
          );
        }
      }
    }
    // Solo marcar como notificado si al menos un dispositivo lo recibió;
    // si todo falló, la corrida de la próxima hora lo reintenta.
    if (exitos > 0) {
      const { error: eUpd } = await sb
        .from("avisos")
        .update({ notificado_para: aviso.vence })
        .eq("id", aviso.id);
      if (eUpd) console.error("No se pudo marcar notificado_para del aviso", aviso.id, eUpd.message);
    }
  }

  for (const endpoint of muertas) {
    await sb.from("push_suscripciones").delete().eq("endpoint", endpoint);
  }

  return json({ enviadas, fallos, dispositivos: subs.length - muertas.size });
});
