// Edge Function "notificar" (desplegada como `Notificar`, con mayúscula: el cron apunta ahí).
// La invoca pg_cron cada minuto y envía las notificaciones push de los avisos, en hora de España:
// - con fecha y sin hora: una vez por fecha, desde las 9:00;
// - con fecha y hora: una vez por fecha y hora, a esa hora.
// Las reglas viven en reglas.mjs (con pruebas en setup/pruebas/); aquí solo van Supabase y el push.
//
// Para que dos vueltas que se pisen no envíen lo mismo, cada aviso se «reserva» antes de enviarlo:
// se escriben sus marcas solo si siguen como se leyeron. Si no llega a ningún dispositivo, se
// devuelven y la vuelta siguiente lo reintenta.
//
// Secretos requeridos (Edge Functions → Secrets):
//   VAPID_KEYS    → JSON con {publicKey, privateKey} en formato JWK
//   VAPID_SUBJECT → mailto:tu-correo
//   CRON_SECRET   → el mismo valor usado en el cron de pg_cron

import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush";
import { ahoraEnEspana, repartir } from "./reglas.mjs";

type Aviso = {
  id: string;
  texto: string;
  vence: string;
  hora: string | null;
  notificado_para: string | null;
  notificado_hora: string | null;
};

type Suscripcion = {
  endpoint: string;
  datos: Parameters<webpush.ApplicationServer["subscribe"]>[0];
};

function json(cuerpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// PostgREST no compara null con eq: para null hay que filtrar con is
// deno-lint-ignore no-explicit-any
function igualA(consulta: any, columna: string, valor: string | null) {
  return valor === null ? consulta.is(columna, null) : consulta.eq(columna, valor);
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return json({ error: "no autorizado" }, 401);
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Antes de reservar nada: si las llaves VAPID fallan, la vuelta para aquí (500)
    const vapidKeys = await webpush.importVapidKeys(
      JSON.parse(Deno.env.get("VAPID_KEYS")!),
      { extractable: false },
    );
    const servidor = await webpush.ApplicationServer.new({
      contactInformation: Deno.env.get("VAPID_SUBJECT") ?? "mailto:avisos@ejemplo.com",
      vapidKeys,
    });

    const resumen = await repartir({
      ahora: ahoraEnEspana(),

      leerAvisos: async (hoy: string) => {
        const { data, error } = await sb
          .from("avisos")
          .select("id, texto, vence, hora, notificado_para, notificado_hora")
          .is("completado_en", null)
          .not("vence", "is", null)
          .lte("vence", hoy);
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      leerSuscripciones: async () => {
        const { data, error } = await sb.from("push_suscripciones").select("endpoint, datos");
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      // Solo si sigue pendiente, con la misma fecha y hora y las mismas marcas que se leyeron
      reservar: async (a: Aviso) => {
        let consulta = sb
          .from("avisos")
          .update({ notificado_para: a.vence, notificado_hora: a.hora })
          .eq("id", a.id)
          .eq("vence", a.vence)
          .is("completado_en", null);
        consulta = igualA(consulta, "hora", a.hora);
        consulta = igualA(consulta, "notificado_para", a.notificado_para);
        consulta = igualA(consulta, "notificado_hora", a.notificado_hora);
        const { data, error } = await consulta.select("id");
        if (error) {
          console.error("No se pudo reservar el aviso", a.id, error.message);
          return false;
        }
        return (data?.length ?? 0) > 0;
      },

      // Solo si las marcas siguen siendo las que puso esta vuelta
      devolver: async (a: Aviso) => {
        const consulta = igualA(
          sb
            .from("avisos")
            .update({ notificado_para: a.notificado_para, notificado_hora: a.notificado_hora })
            .eq("id", a.id)
            .eq("notificado_para", a.vence),
          "notificado_hora",
          a.hora,
        );
        const { error } = await consulta;
        if (error) console.error("No se pudieron devolver las marcas del aviso", a.id, error.message);
      },

      enviar: async (s: Suscripcion, mensaje: { titulo: string; cuerpo: string; tag: string }) => {
        try {
          await servidor.subscribe(s.datos).pushTextMessage(JSON.stringify(mensaje), {});
          return "ok";
        } catch (err) {
          // 410/404: la suscripción caducó o el dispositivo se desuscribió → se limpia
          if (
            err instanceof webpush.PushMessageError &&
            (err.isGone() || err.response.status === 404)
          ) {
            return "muerta";
          }
          console.error(
            "Fallo push",
            s.endpoint,
            err instanceof webpush.PushMessageError ? err.toString() : err,
          );
          return "fallo";
        }
      },

      borrarSuscripcion: async (endpoint: string) => {
        const { error } = await sb.from("push_suscripciones").delete().eq("endpoint", endpoint);
        if (error) console.error("No se pudo borrar la suscripción", endpoint, error.message);
      },
    });

    return json(resumen);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
