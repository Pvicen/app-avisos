// Edge Function "notificar" (desplegada como `Notificar`, con mayúscula: el cron apunta ahí).
// La invoca pg_cron cada minuto y envía las notificaciones push de los avisos, en hora de España:
// - con fecha y sin hora: una vez por fecha, desde las 9:00;
// - con fecha y hora: una vez por fecha y hora, a esa hora.
// Además envía la cola `avisos_eventos` («te toca» y «terminado») a los dispositivos de cada
// destinatario, y los lunes desde las 9:00 el resumen de la semana a cada persona (una vez,
// apuntado en `avisos_resumenes`). Con el cuerpo {"resumen":"prueba"} envía el resumen en el
// momento, sin marcarlo (para probarlo sin esperar al lunes).
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
import { ahoraEnEspana, repartir, repartirEventos, repartirResumen } from "./reglas.mjs";

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
  correo: string | null;
};

type Evento = {
  id: number;
  tipo: "te_toca" | "terminado";
  aviso_id: string;
  texto: string;
  quien: string | null;
  para: string;
  creado_en: string;
  intentos: number;
};

type Mensaje = { titulo: string; cuerpo: string; tag: string };

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
  // El cron manda {}; la prueba manual del resumen, {"resumen":"prueba"}
  const peticion = await req.json().catch(() => ({}));
  const probarResumen = peticion?.resumen === "prueba";

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

    // Lo que comparten los avisos que vencen y la cola de eventos
    const comun = {
      leerSuscripciones: async () => {
        const { data, error } = await sb.from("push_suscripciones").select("endpoint, datos, correo");
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      enviar: async (s: Suscripcion, mensaje: Mensaje) => {
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

      leerPersonas: async () => {
        const { data, error } = await sb.from("personas").select("correo, nombre");
        if (error) throw new Error(error.message);
        return data ?? [];
      },
    };

    const ahora = ahoraEnEspana();
    const resumen = await repartir({
      ...comun,
      ahora,

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
    });

    const eventos = await repartirEventos({
      ...comun,
      ahoraMs: Date.now(),

      leerEventos: async () => {
        const { data, error } = await sb
          .from("avisos_eventos")
          .select("id, tipo, aviso_id, texto, quien, para, creado_en, intentos")
          .is("enviado_en", null)
          .order("id")
          .limit(50);
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      // Se marca antes de enviar: si dos vueltas se pisan, solo una lo envía
      reservarEvento: async (ev: Evento) => {
        const { data, error } = await sb
          .from("avisos_eventos")
          .update({ enviado_en: new Date().toISOString() })
          .eq("id", ev.id)
          .is("enviado_en", null)
          .select("id");
        if (error) {
          console.error("No se pudo reservar el evento", ev.id, error.message);
          return false;
        }
        return (data?.length ?? 0) > 0;
      },

      devolverEvento: async (ev: Evento) => {
        const { error } = await sb
          .from("avisos_eventos")
          .update({ enviado_en: null, intentos: ev.intentos + 1 })
          .eq("id", ev.id);
        if (error) console.error("No se pudo devolver el evento", ev.id, error.message);
      },
    });

    const semanal = await repartirResumen({
      ...comun,
      ahora,
      forzar: probarResumen,

      leerEnviados: async (lunes: string) => {
        const { data, error } = await sb.from("avisos_resumenes").select("correo").eq("lunes", lunes);
        if (error) throw new Error(error.message);
        return (data ?? []).map((f: { correo: string }) => f.correo);
      },

      leerPendientes: async () => {
        const { data, error } = await sb.from("avisos").select("vence, para").is("completado_en", null);
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      // Ocho días bastan para cubrir la semana pasada entera en hora de España
      leerHechos: async () => {
        const desde = new Date(Date.now() - 8 * 86400000).toISOString();
        const { data, error } = await sb
          .from("avisos")
          .select("completado_en, completado_por")
          .gte("completado_en", desde);
        if (error) throw new Error(error.message);
        return data ?? [];
      },

      // Si ya hay fila (otra vuelta lo tomó), el insert no hace nada y no se envía
      reservarResumen: async (lunes: string, correo: string) => {
        const { data, error } = await sb
          .from("avisos_resumenes")
          .upsert({ lunes, correo }, { onConflict: "lunes,correo", ignoreDuplicates: true })
          .select("correo");
        if (error) {
          console.error("No se pudo reservar el resumen", lunes, error.message);
          return false;
        }
        return (data?.length ?? 0) > 0;
      },

      devolverResumen: async (lunes: string, correo: string) => {
        const { error } = await sb.from("avisos_resumenes").delete().eq("lunes", lunes).eq("correo", correo);
        if (error) console.error("No se pudo devolver el resumen", lunes, error.message);
      },
    });

    // Sin eventos ni resumen, la respuesta es la de siempre
    return json({
      ...resumen,
      ...(eventos.eventos ? { eventos } : {}),
      ...(semanal.resumenes || semanal.fallos ? { resumen: semanal } : {}),
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
