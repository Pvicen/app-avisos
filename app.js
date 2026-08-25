"use strict";

const $ = (sel) => document.querySelector(sel);

const ui = {
  avisoConfig: $("#aviso-config"),
  login: $("#pantalla-login"),
  app: $("#pantalla-app"),
  historial: $("#pantalla-historial"),
  formLogin: $("#form-login"),
  email: $("#email"),
  password: $("#password"),
  errorLogin: $("#error-login"),
  formNuevo: $("#form-nuevo"),
  texto: $("#texto"),
  lista: $("#lista"),
  vacio: $("#vacio"),
  btnNotif: $("#btn-notif"),
  listaHistorial: $("#lista-historial"),
  vacioHistorial: $("#vacio-historial"),
  btnHistorial: $("#btn-historial"),
  btnVolver: $("#btn-volver"),
  btnVaciar: $("#btn-vaciar"),
  estado: $("#estado"),
  toast: $("#toast"),
  btnDeshacer: $("#btn-deshacer"),
  btnSalir: $("#btn-salir"),
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

let sb = null;
let canal = null;
let cargaSeq = 0;               // descarta respuestas obsoletas de cargar()
let histSeq = 0;                // ídem para el historial
let reintentoRealtime = null;   // timer de reintento del canal realtime
let completadosPendientes = []; // pila de ids completados, para el Deshacer rápido
let toastTimer = null;
let refrescoPospuesto = false;  // hubo un refresco mientras se editaba un aviso
let swRegistro = null;          // promesa del registro del service worker

function mostrar(el, visible) {
  el.classList.toggle("oculto", !visible);
}

function estado(msg) {
  ui.estado.textContent = msg || "";
  mostrar(ui.estado, Boolean(msg));
}

function vistaActual() {
  if (!ui.historial.classList.contains("oculto")) return "historial";
  if (!ui.app.classList.contains("oculto")) return "app";
  return null;
}

function refrescarVista() {
  const v = vistaActual();
  if (v === "historial") cargarHistorial();
  else if (v === "app") cargar();
}

// Texto llegado vía "Compartir → Avisos" desde otra app (Web Share Target)
function textoCompartido() {
  const p = new URLSearchParams(location.search);
  const partes = [p.get("titulo"), p.get("texto"), p.get("url")]
    .map((x) => (x || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!partes.length) return null;
  const unicos = partes.filter((x, i) => partes.indexOf(x) === i);
  return unicos.join(" — ").slice(0, 500);
}

async function init() {
  const compartido = textoCompartido();
  if (compartido) {
    // sessionStorage sobrevive a recargas (auto-actualización del SW, login pendiente)
    sessionStorage.setItem("borradorCompartido", compartido);
    history.replaceState(null, "", "./");
  }
  const borrador = sessionStorage.getItem("borradorCompartido");
  if (borrador && !ui.texto.value) {
    ui.texto.value = borrador; // queda listo en el cajón; el usuario revisa y pulsa Agregar
  }

  const configurado =
    typeof SUPABASE_URL === "string" && SUPABASE_URL.startsWith("https://") &&
    typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.length > 20;

  if (!configurado) {
    mostrar(ui.avisoConfig, true);
    return;
  }
  if (!window.supabase) {
    ui.avisoConfig.querySelector("p").textContent =
      "No se pudo cargar la librería de Supabase. Revisa tu conexión a internet y recarga la página.";
    mostrar(ui.avisoConfig, true);
    return;
  }

  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    entrarApp();
  } else {
    mostrar(ui.login, true);
  }

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") location.reload();
  });
}

function entrarApp() {
  mostrar(ui.login, false);
  mostrar(ui.app, true);
  cargar();
  suscribir();
  actualizarBotonNotif();
  if (ui.texto.value) ui.texto.focus(); // texto compartido esperando confirmación
}

// ---------- Pendientes ----------

async function cargar() {
  const seq = ++cargaSeq;
  const { data, error } = await sb
    .from("avisos")
    .select("*")
    .is("completado_en", null)
    .order("prioridad", { ascending: false })
    .order("vence", { ascending: true, nullsFirst: false })
    .order("creado_en", { ascending: true });
  if (seq !== cargaSeq) return; // llegó tarde: ya hay una petición más nueva en vuelo
  if (error) {
    estado("No se pudieron cargar los avisos: " + error.message);
    return;
  }
  estado("");
  render(data);
}

function hoyLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function infoVence(vence) {
  if (!vence) return null;
  const [a, m, d] = vence.split("-").map(Number);
  const dias = Math.round((new Date(a, m - 1, d) - hoyLocal()) / 86400000);
  if (dias < 0) return { clase: "vencido", texto: "vencido" };
  if (dias === 0) return { clase: "vencido", texto: "vence hoy" };
  if (dias === 1) return { clase: "pronto", texto: "vence mañana" };
  const etiqueta =
    "vence " + d + " " + MESES[m - 1] + (a !== hoyLocal().getFullYear() ? " " + a : "");
  return { clase: dias <= 3 ? "pronto" : "normal", texto: etiqueta };
}

function aplicarRefrescoPospuesto() {
  if (refrescoPospuesto) {
    refrescoPospuesto = false;
    refrescarVista();
  }
}

function render(avisos) {
  // No destruir una edición en curso: el refresco se aplica al terminar de editar
  if (ui.lista.querySelector("input.editar, textarea.editar-nota")) {
    refrescoPospuesto = true;
    return;
  }
  ui.lista.textContent = "";
  for (const aviso of avisos) {
    const li = document.createElement("li");
    if (aviso.prioridad) li.classList.add("importante");

    const check = document.createElement("button");
    check.className = "check";
    check.title = "Marcar como hecho";
    check.addEventListener("click", () => completar(aviso, li));

    const contenido = document.createElement("div");
    contenido.className = "contenido";

    const span = document.createElement("span");
    span.className = "texto";
    span.textContent = aviso.texto;
    contenido.append(span);

    if (aviso.nota) {
      const nota = document.createElement("span");
      nota.className = "nota";
      nota.textContent = aviso.nota;
      contenido.append(nota);
    }

    const info = infoVence(aviso.vence);
    if (info) {
      const badge = document.createElement("span");
      badge.className = "badge " + info.clase;
      badge.textContent = info.texto + " ";
      const btnSinFecha = document.createElement("button");
      btnSinFecha.className = "quitar-fecha";
      btnSinFecha.textContent = "✕";
      btnSinFecha.title = "Quitar fecha límite";
      btnSinFecha.addEventListener("click", () => cambiarVence(aviso, ""));
      badge.append(btnSinFecha);
      contenido.append(badge);
    }

    const btnNota = document.createElement("button");
    btnNota.className = "accion" + (aviso.nota ? " activa-nota" : "");
    btnNota.textContent = "📝";
    btnNota.title = aviso.nota ? "Editar la nota" : "Agregar una nota";
    btnNota.addEventListener("click", () => editarNota(aviso, contenido));

    const btnEditar = document.createElement("button");
    btnEditar.className = "accion";
    btnEditar.textContent = "✎";
    btnEditar.title = "Editar";
    btnEditar.addEventListener("click", () => editar(aviso, span));

    const btnPrio = document.createElement("button");
    btnPrio.className = "accion prio" + (aviso.prioridad ? " activa" : "");
    btnPrio.textContent = "⚑";
    btnPrio.title = aviso.prioridad ? "Quitar importancia" : "Marcar como importante";
    btnPrio.addEventListener("click", () => cambiarPrioridad(aviso));

    const inputFecha = document.createElement("input");
    inputFecha.type = "date";
    inputFecha.className = "fecha-input";
    inputFecha.value = aviso.vence || "";
    inputFecha.addEventListener("change", () => cambiarVence(aviso, inputFecha.value));

    const btnFecha = document.createElement("button");
    btnFecha.className = "accion";
    btnFecha.textContent = "📅";
    btnFecha.title = aviso.vence ? "Cambiar fecha límite" : "Poner fecha límite";
    btnFecha.addEventListener("click", () => {
      try {
        inputFecha.showPicker();
      } catch {
        inputFecha.classList.add("visible");
        inputFecha.focus();
      }
    });

    li.append(check, contenido, btnEditar, btnNota, btnPrio, btnFecha, inputFecha);
    ui.lista.append(li);
  }
  mostrar(ui.vacio, avisos.length === 0);
}

// Ejecuta un update verificando que realmente haya afectado una fila:
// PostgREST responde "éxito" aunque RLS filtre todo o la fila ya no exista.
async function actualizarAviso(id, cambios, accion) {
  const { data, error } = await sb.from("avisos").update(cambios).eq("id", id).select("id");
  if (error) {
    return { fallo: "No se pudo " + accion + ": " + error.message, desaparecido: false };
  }
  if (!data || data.length === 0) {
    return {
      fallo:
        "No se pudo " + accion + ": el aviso ya no existe o el cambio no se guardó " +
        "(si pasa siempre, revisa el correo de la política \"editar avisos\" en Supabase).",
      desaparecido: true,
    };
  }
  return null;
}

function editar(aviso, span) {
  if (!span.isConnected) return; // ya está en edición (el span fue reemplazado)
  const input = document.createElement("input");
  input.type = "text";
  input.className = "editar";
  input.maxLength = 500;
  input.value = aviso.texto;

  const btnOk = document.createElement("button");
  btnOk.className = "accion ok";
  btnOk.textContent = "✓";
  btnOk.title = "Guardar";

  const btnNo = document.createElement("button");
  btnNo.className = "accion no";
  btnNo.textContent = "✕";
  btnNo.title = "Cancelar";

  const caja = document.createElement("span");
  caja.className = "edicion";
  caja.append(input, btnOk, btnNo);
  span.replaceWith(caja);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  let cerrado = false;
  const cancelar = () => {
    if (cerrado) return;
    cerrado = true;
    caja.replaceWith(span);
    aplicarRefrescoPospuesto();
  };
  const guardar = async () => {
    if (cerrado) return;
    const nuevo = input.value.trim();
    if (!nuevo || nuevo === aviso.texto) {
      cancelar();
      return;
    }
    cerrado = true;
    input.disabled = true;
    const r = await actualizarAviso(aviso.id, { texto: nuevo }, "editar");
    if (r) {
      estado(r.fallo);
      caja.replaceWith(span);
      aplicarRefrescoPospuesto();
      return;
    }
    caja.replaceWith(span); // quitar el editor ANTES de refrescar, o render() se pospone eterno
    refrescoPospuesto = false;
    cargar();
  };

  // mousedown/touchstart llegan ANTES que el blur del input: así ✕ cancela de verdad
  btnNo.addEventListener("mousedown", (e) => { e.preventDefault(); cancelar(); });
  btnNo.addEventListener("touchstart", (e) => { e.preventDefault(); cancelar(); }, { passive: false });
  btnOk.addEventListener("mousedown", (e) => { e.preventDefault(); guardar(); });
  btnOk.addEventListener("touchstart", (e) => { e.preventDefault(); guardar(); }, { passive: false });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    else if (e.key === "Escape") cancelar();
  });
  input.addEventListener("blur", guardar);
}

function editarNota(aviso, contenido) {
  if (contenido.querySelector("textarea.editar-nota")) return; // ya en edición
  const notaVisible = contenido.querySelector(".nota");

  const area = document.createElement("textarea");
  area.className = "editar-nota";
  area.maxLength = 2000;
  area.rows = 3;
  area.placeholder = "Nota (deja vacío para quitarla)";
  area.value = aviso.nota || "";

  const btnOk = document.createElement("button");
  btnOk.className = "accion ok";
  btnOk.textContent = "✓";
  btnOk.title = "Guardar nota";

  const btnNo = document.createElement("button");
  btnNo.className = "accion no";
  btnNo.textContent = "✕";
  btnNo.title = "Cancelar";

  const caja = document.createElement("span");
  caja.className = "edicion edicion-nota";
  caja.append(area, btnOk, btnNo);
  if (notaVisible) notaVisible.replaceWith(caja);
  else contenido.append(caja);
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);

  let cerrado = false;
  const restaurar = () => {
    if (notaVisible) caja.replaceWith(notaVisible);
    else caja.remove();
  };
  const cancelar = () => {
    if (cerrado) return;
    cerrado = true;
    restaurar();
    aplicarRefrescoPospuesto();
  };
  const guardar = async () => {
    if (cerrado) return;
    const nueva = area.value.trim();
    if (nueva === (aviso.nota || "")) {
      cancelar();
      return;
    }
    cerrado = true;
    area.disabled = true;
    const r = await actualizarAviso(aviso.id, { nota: nueva || null }, "guardar la nota");
    if (r) {
      estado(r.fallo);
      restaurar();
      aplicarRefrescoPospuesto();
      return;
    }
    restaurar(); // quitar el editor ANTES de refrescar, o render() se pospone eterno
    refrescoPospuesto = false;
    cargar();
  };

  btnNo.addEventListener("mousedown", (e) => { e.preventDefault(); cancelar(); });
  btnNo.addEventListener("touchstart", (e) => { e.preventDefault(); cancelar(); }, { passive: false });
  btnOk.addEventListener("mousedown", (e) => { e.preventDefault(); guardar(); });
  btnOk.addEventListener("touchstart", (e) => { e.preventDefault(); guardar(); }, { passive: false });

  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancelar();
  });
  area.addEventListener("blur", guardar);
}

async function completar(aviso, li) {
  if (li.classList.contains("completado")) return; // candado anti doble toque
  li.classList.add("completado");
  const r = await actualizarAviso(aviso.id, { completado_en: new Date().toISOString() }, "completar");
  if (r) {
    li.classList.remove("completado");
    estado(r.fallo);
    if (r.desaparecido) cargar();
    return;
  }
  completadosPendientes.push(aviso.id);
  mostrarToast();
  setTimeout(cargar, 250); // deja verse la animación y refresca
}

async function cambiarPrioridad(aviso) {
  const r = await actualizarAviso(aviso.id, { prioridad: !aviso.prioridad }, "cambiar la prioridad");
  if (r) {
    estado(r.fallo);
    if (r.desaparecido) cargar();
    return;
  }
  cargar();
}

async function cambiarVence(aviso, valor) {
  const r = await actualizarAviso(aviso.id, { vence: valor || null }, "cambiar la fecha");
  if (r) {
    estado(r.fallo);
    if (r.desaparecido) cargar();
    return;
  }
  cargar();
}

// ---------- Historial ----------

async function cargarHistorial() {
  const seq = ++histSeq;
  const { data, error } = await sb
    .from("avisos")
    .select("*")
    .not("completado_en", "is", null)
    .order("completado_en", { ascending: false })
    .limit(100);
  if (seq !== histSeq) return;
  if (error) {
    estado("No se pudo cargar el historial: " + error.message);
    return;
  }
  estado("");
  renderHistorial(data);
}

function formatearFechaHora(iso) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return "el " + d.getDate() + " " + MESES[d.getMonth()] + " a las " + hh + ":" + mm;
}

function renderHistorial(avisos) {
  ui.listaHistorial.textContent = "";
  for (const aviso of avisos) {
    const li = document.createElement("li");
    li.className = "hecho";

    const contenido = document.createElement("div");
    contenido.className = "contenido";
    const span = document.createElement("span");
    span.className = "texto";
    span.textContent = aviso.texto;
    const fecha = document.createElement("span");
    fecha.className = "badge normal";
    fecha.textContent = "completado " + formatearFechaHora(aviso.completado_en);
    contenido.append(span, fecha);

    const btnRestaurar = document.createElement("button");
    btnRestaurar.className = "accion restaurar";
    btnRestaurar.textContent = "↩";
    btnRestaurar.title = "Devolver a pendientes";
    btnRestaurar.addEventListener("click", () => restaurar(aviso.id));

    li.append(contenido, btnRestaurar);
    ui.listaHistorial.append(li);
  }
  mostrar(ui.vacioHistorial, avisos.length === 0);
  mostrar(ui.btnVaciar, avisos.length > 0);
}

async function restaurar(id) {
  const r = await actualizarAviso(id, { completado_en: null }, "restaurar");
  if (r) {
    estado(r.fallo);
    cargarHistorial();
    return;
  }
  completadosPendientes = completadosPendientes.filter((x) => x !== id);
  cargarHistorial();
}

// ---------- Notificaciones push ----------

function base64urlABytes(cadena) {
  const b64 = cadena.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function soportaPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Espera al service worker, pero sin colgarse si el registro falló
async function swListo() {
  if (!swRegistro) throw new Error("el service worker no está disponible");
  await swRegistro; // rechaza si el registro falló
  return await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rechazar) =>
      setTimeout(() => rechazar(new Error("el service worker no respondió")), 5000)
    ),
  ]);
}

async function actualizarBotonNotif() {
  if (!soportaPush()) {
    mostrar(ui.btnNotif, false);
    return;
  }
  if (Notification.permission === "denied") {
    mostrar(ui.btnNotif, true);
    ui.btnNotif.textContent = "🔕";
    ui.btnNotif.title = "Notificaciones bloqueadas por el navegador (revísalo en la configuración del sitio)";
    return;
  }
  try {
    const reg = await swListo();
    const sus = await reg.pushManager.getSubscription();
    mostrar(ui.btnNotif, true);
    ui.btnNotif.textContent = sus ? "🔔" : "🔕";
    ui.btnNotif.title = sus
      ? "Notificaciones activadas en este dispositivo (toca para desactivar)"
      : "Activar notificaciones en este dispositivo";
  } catch {
    mostrar(ui.btnNotif, false); // sin SW no hay push que ofrecer
  }
}

async function alternarNotificaciones() {
  if (!soportaPush()) return;
  ui.btnNotif.disabled = true;
  try {
    const reg = await swListo();
    const actual = await reg.pushManager.getSubscription();

    if (actual) {
      // primero lo local (si falla, no se ha tocado nada); después la BD
      await actual.unsubscribe();
      const { error } = await sb
        .from("push_suscripciones")
        .delete()
        .eq("endpoint", actual.endpoint);
      if (error) {
        estado("Notificaciones desactivadas aquí, pero no se pudo borrar el registro del servidor: " + error.message);
      } else {
        estado("Notificaciones desactivadas en este dispositivo.");
      }
    } else {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        estado("No se dio permiso de notificaciones.");
        return;
      }
      const nueva = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64urlABytes(VAPID_PUBLIC_KEY),
      });
      const { error } = await sb
        .from("push_suscripciones")
        .upsert({ endpoint: nueva.endpoint, datos: nueva.toJSON() }, { onConflict: "endpoint" });
      if (error) {
        estado("No se pudo registrar el dispositivo: " + error.message);
        await nueva.unsubscribe();
        return;
      }
      estado("🔔 Notificaciones activadas: te avisaré cuando algo venza.");
    }
  } catch (err) {
    estado("No se pudieron cambiar las notificaciones: " + err.message);
  } finally {
    ui.btnNotif.disabled = false;
    actualizarBotonNotif();
  }
}

ui.btnNotif.addEventListener("click", alternarNotificaciones);

// ---------- Toast / deshacer rápido ----------

function mostrarToast() {
  mostrar(ui.toast, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => mostrar(ui.toast, false), 5000);
}

// ---------- Realtime ----------

function suscribir() {
  clearTimeout(reintentoRealtime);
  const c = sb
    .channel("avisos-cambios")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "avisos" },
      () => refrescarVista()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        refrescarVista(); // re-sincroniza tras cada (re)conexión del canal
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (canal !== c) return; // aviso tardío de un canal ya reemplazado
        sb.removeChannel(c);
        canal = null;
        clearTimeout(reintentoRealtime);
        reintentoRealtime = setTimeout(suscribir, 5000); // reintenta en 5 s
      }
    });
  canal = c;
}

// ---------- Eventos de la interfaz ----------

ui.formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  mostrar(ui.errorLogin, false);
  const boton = ui.formLogin.querySelector("button");
  boton.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: ui.email.value.trim(),
    password: ui.password.value,
  });
  boton.disabled = false;
  if (error) {
    ui.errorLogin.textContent =
      error.status === 400
        ? "Correo o contraseña incorrectos."
        : "No se pudo conectar. Revisa tu internet o, si llevas semanas sin usar la app, restaura el proyecto en Supabase (ver README).";
    mostrar(ui.errorLogin, true);
    return;
  }
  entrarApp();
});

ui.formNuevo.addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = ui.texto.value.trim();
  if (!texto) return;
  ui.texto.value = "";
  const { error } = await sb.from("avisos").insert({ texto });
  if (error) {
    estado("No se pudo agregar: " + error.message);
    ui.texto.value = texto;
    return;
  }
  sessionStorage.removeItem("borradorCompartido");
  cargar();
});

// Si el usuario retoca un texto compartido, mantener el borrador al día
ui.texto.addEventListener("input", () => {
  if (sessionStorage.getItem("borradorCompartido") !== null) {
    sessionStorage.setItem("borradorCompartido", ui.texto.value);
  }
});

ui.btnDeshacer.addEventListener("click", async () => {
  if (completadosPendientes.length === 0) {
    mostrar(ui.toast, false);
    return;
  }
  const id = completadosPendientes[completadosPendientes.length - 1];
  const r = await actualizarAviso(id, { completado_en: null }, "deshacer");
  if (r) {
    estado(r.fallo);
    if (r.desaparecido) {
      completadosPendientes.pop(); // borrado desde otro dispositivo: el id ya no sirve
      mostrar(ui.toast, false);
      if (completadosPendientes.length > 0) mostrarToast();
      refrescarVista();
    } else {
      mostrarToast(); // error de red: el aviso sigue en la pila, se puede reintentar
    }
    return;
  }
  completadosPendientes.pop();
  mostrar(ui.toast, false);
  if (completadosPendientes.length > 0) mostrarToast(); // quedan más por deshacer
  refrescarVista();
});

ui.btnHistorial.addEventListener("click", () => {
  mostrar(ui.app, false);
  mostrar(ui.historial, true);
  cargarHistorial();
});

ui.btnVolver.addEventListener("click", () => {
  mostrar(ui.historial, false);
  mostrar(ui.app, true);
  cargar();
});

ui.btnVaciar.addEventListener("click", async () => {
  if (!window.confirm("¿Borrar definitivamente todo el historial?")) return;
  const { error } = await sb.from("avisos").delete().not("completado_en", "is", null);
  if (error) {
    estado("No se pudo vaciar el historial: " + error.message);
    return;
  }
  completadosPendientes = [];
  cargarHistorial();
});

ui.btnSalir.addEventListener("click", async () => {
  // Apagar las notificaciones de este dispositivo mientras aún hay sesión (RLS)
  if (soportaPush()) {
    try {
      const reg = await swListo();
      const sus = await reg.pushManager.getSubscription();
      if (sus) {
        await sb.from("push_suscripciones").delete().eq("endpoint", sus.endpoint);
        await sus.unsubscribe();
      }
    } catch {
      // no bloquear el cierre de sesión por esto
    }
  }
  // scope local: cierra sesión SOLO en este dispositivo
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) estado("No se pudo cerrar sesión: revisa tu conexión e inténtalo de nuevo.");
});

// Red de seguridad de sincronización: refresca al volver a la pestaña,
// al recuperar internet, al volver del segundo plano (celular) y cada 2 min.
function refrescar() {
  if (sb && vistaActual()) refrescarVista();
}
window.addEventListener("focus", refrescar);
window.addEventListener("online", refrescar);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refrescar();
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) refrescar();
});
setInterval(() => {
  if (document.visibilityState === "visible") refrescar();
}, 120000);

init();

// PWA: permite instalar la app y que la cáscara funcione sin conexión
if ("serviceWorker" in navigator) {
  swRegistro = navigator.serviceWorker.register("./sw.js");
  swRegistro.catch((err) => console.warn("SW no registrado:", err));
  // Al publicarse una versión nueva de la app, recargar para no seguir con código viejo
  let teniaControlador = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (teniaControlador) location.reload();
    teniaControlador = true;
  });
}
