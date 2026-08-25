"use strict";

const $ = (sel) => document.querySelector(sel);

const ui = {
  avisoConfig: $("#aviso-config"),
  login: $("#pantalla-login"),
  app: $("#pantalla-app"),
  formLogin: $("#form-login"),
  email: $("#email"),
  password: $("#password"),
  errorLogin: $("#error-login"),
  formNuevo: $("#form-nuevo"),
  texto: $("#texto"),
  lista: $("#lista"),
  vacio: $("#vacio"),
  estado: $("#estado"),
  toast: $("#toast"),
  btnDeshacer: $("#btn-deshacer"),
  btnSalir: $("#btn-salir"),
};

let sb = null;
let canal = null;
let cargaSeq = 0;               // descarta respuestas obsoletas de cargar()
let reintentoRealtime = null;   // timer de reintento del canal realtime
let completadosPendientes = []; // pila de avisos completados, para deshacer
let toastTimer = null;

function mostrar(el, visible) {
  el.classList.toggle("oculto", !visible);
}

function estado(msg) {
  ui.estado.textContent = msg || "";
  mostrar(ui.estado, Boolean(msg));
}

function sesionActiva() {
  return sb !== null && !ui.app.classList.contains("oculto");
}

async function init() {
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
}

async function cargar() {
  const seq = ++cargaSeq;
  const { data, error } = await sb
    .from("avisos")
    .select("*")
    .order("creado_en", { ascending: true });
  if (seq !== cargaSeq) return; // llegó tarde: ya hay una petición más nueva en vuelo
  if (error) {
    estado("No se pudieron cargar los avisos: " + error.message);
    return;
  }
  estado("");
  render(data);
}

function render(avisos) {
  ui.lista.textContent = "";
  for (const aviso of avisos) {
    const li = document.createElement("li");

    const check = document.createElement("button");
    check.className = "check";
    check.title = "Marcar como hecho";
    check.addEventListener("click", () => completar(aviso, li));

    const span = document.createElement("span");
    span.textContent = aviso.texto;

    li.append(check, span);
    ui.lista.append(li);
  }
  mostrar(ui.vacio, avisos.length === 0);
}

async function completar(aviso, li) {
  li.classList.add("completado");
  const { error } = await sb.from("avisos").delete().eq("id", aviso.id);
  if (error) {
    li.classList.remove("completado");
    estado("No se pudo completar: " + error.message);
    return;
  }
  completadosPendientes.push({ texto: aviso.texto });
  mostrarToast();
  setTimeout(cargar, 250); // deja verse la animación y refresca
}

function mostrarToast() {
  mostrar(ui.toast, true);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => mostrar(ui.toast, false), 5000);
}

function suscribir() {
  clearTimeout(reintentoRealtime);
  const c = sb
    .channel("avisos-cambios")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "avisos" },
      () => cargar()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        cargar(); // re-sincroniza tras cada (re)conexión del canal
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
  cargar();
});

ui.btnDeshacer.addEventListener("click", async () => {
  if (completadosPendientes.length === 0) {
    mostrar(ui.toast, false);
    return;
  }
  const ultimo = completadosPendientes[completadosPendientes.length - 1];
  const { error } = await sb.from("avisos").insert({ texto: ultimo.texto });
  if (error) {
    estado("No se pudo deshacer: " + error.message);
    mostrarToast(); // el aviso sigue en la pila: se puede reintentar
    return;
  }
  completadosPendientes.pop();
  mostrar(ui.toast, false);
  if (completadosPendientes.length > 0) mostrarToast(); // quedan más por deshacer
  cargar();
});

ui.btnSalir.addEventListener("click", async () => {
  // scope local: cierra sesión SOLO en este dispositivo
  const { error } = await sb.auth.signOut({ scope: "local" });
  if (error) estado("No se pudo cerrar sesión: revisa tu conexión e inténtalo de nuevo.");
});

// Red de seguridad de sincronización: refresca al volver a la pestaña,
// al recuperar internet, al volver del segundo plano (celular) y cada 2 min.
function refrescar() {
  if (sesionActiva()) cargar();
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
  navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW no registrado:", err));
}
