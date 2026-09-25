"use strict";

const $ = (sel) => document.querySelector(sel);
const SVG_NS = "http://www.w3.org/2000/svg";

const ui = {
  avisoConfig: $("#aviso-config"),
  login: $("#pantalla-login"),
  app: $("#pantalla-app"),
  historial: $("#pantalla-historial"),
  formLogin: $("#form-login"),
  email: $("#email"),
  password: $("#password"),
  errorLogin: $("#error-login"),
  saludo: $("#saludo"),
  ayudaIOS: $("#ayuda-ios"),
  btnAyudaIOS: $("#btn-ayuda-ios"),
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
  btnCuenta: $("#btn-cuenta"),
  dlgCuenta: $("#dlg-cuenta"),
  cuentaAvatar: $("#cuenta-avatar"),
  cuentaNombre: $("#cuenta-nombre"),
  cuentaCorreo: $("#cuenta-correo"),
  btnCambiarClave: $("#btn-cambiar-clave"),
  btnCerrarCuenta: $("#btn-cerrar-cuenta"),
  btnSalir: $("#btn-salir"),
  dlgClave: $("#dlg-clave"),
  formClave: $("#form-clave"),
  claveNueva: $("#clave-nueva"),
  claveRepetir: $("#clave-repetir"),
  errorClave: $("#error-clave"),
  btnCancelarClave: $("#btn-cancelar-clave"),
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const COLORES_PERSONA = 4;      // p0..p3 en style.css

let sb = null;
let canal = null;
let cargaSeq = 0;               // descarta respuestas obsoletas de cargar()
let histSeq = 0;                // ídem para el historial
let reintentoRealtime = null;   // timer de reintento del canal realtime
let completadosPendientes = []; // pila de ids completados, para el Deshacer rápido
let toastTimer = null;
let estadoTimer = null;
let refrescoPospuesto = false;  // hubo un refresco mientras se editaba un aviso
let swRegistro = null;          // promesa del registro del service worker
let personas = new Map();       // correo → { nombre, color }; vacío si la BD no está migrada
let miCorreo = null;            // correo de quien usa este dispositivo
let abiertoId = null;           // aviso con sus opciones desplegadas
let pendientesVisibles = null;  // para el saludo (null = aún sin cargar)

function mostrar(el, visible) {
  el.classList.toggle("oculto", !visible);
}

function icono(nombre) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", "#i-" + nombre);
  svg.append(use);
  return svg;
}

// Los errores quedan a la vista hasta el próximo refresco correcto; los "ok" se van solos
function estado(msg, tipo) {
  clearTimeout(estadoTimer);
  ui.estado.textContent = msg || "";
  ui.estado.classList.toggle("ok", tipo === "ok");
  mostrar(ui.estado, Boolean(msg));
  if (msg && tipo === "ok") estadoTimer = setTimeout(() => estado(""), 5000);
}

// El mensaje de estado se muestra bajo la cabecera de la pantalla visible
function ubicarEstado(pantalla) {
  (pantalla === ui.historial ? ui.listaHistorial : ui.lista).before(ui.estado);
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
    ui.texto.value = borrador; // queda listo en la barra; se revisa y se pulsa +
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
    entrarApp(session);
  } else {
    mostrar(ui.login, true);
  }

  sb.auth.onAuthStateChange((evento) => {
    if (evento === "SIGNED_OUT") location.reload();
  });
}

function entrarApp(session) {
  miCorreo = ((session && session.user && session.user.email) || "").toLowerCase() || null;
  mostrar(ui.login, false);
  mostrar(ui.app, true);
  pintarCuenta();
  cargar();
  suscribir();
  actualizarBotonNotif();
  mostrarAyudaIOS();
  cargarPersonas();
  if (ui.texto.value) ui.texto.focus(); // texto compartido esperando confirmación
}

// ---------- Personas (quién anotó y quién hizo cada aviso) ----------

async function cargarPersonas() {
  const { data, error } = await sb.from("personas").select("correo, nombre").order("creado_en");
  if (error || !data) return; // base sin migrar: la app funciona igual, sin nombres
  personas = new Map(
    data.map((p, i) => [p.correo, { nombre: p.nombre, color: i % COLORES_PERSONA }])
  );
  pintarCuenta();
  refrescarVista();
}

function persona(correo) {
  return correo ? personas.get(correo.toLowerCase()) || null : null;
}

function inicial(texto) {
  const primera = Array.from((texto || "").trim())[0];
  return primera ? primera.toUpperCase() : "?";
}

function avatar(correo, extra) {
  const p = persona(correo);
  const el = document.createElement("span");
  el.className = "avatar " + (p ? "p" + p.color : "px") + (extra ? " " + extra : "");
  el.textContent = inicial(p ? p.nombre : correo);
  return el;
}

function pintarCuenta() {
  const yo = persona(miCorreo);
  ui.btnCuenta.replaceChildren(avatar(miCorreo));
  ui.cuentaAvatar.replaceChildren(avatar(miCorreo, "grande"));
  ui.cuentaNombre.textContent = yo ? yo.nombre : "Tu cuenta";
  ui.cuentaCorreo.textContent = miCorreo || "";
  actualizarSaludo();
}

function actualizarSaludo() {
  const yo = persona(miCorreo);
  let cuenta = "";
  if (pendientesVisibles !== null) {
    cuenta = pendientesVisibles === 0 ? "nada pendiente"
      : pendientesVisibles === 1 ? "1 pendiente"
      : pendientesVisibles + " pendientes";
  }
  if (yo) {
    ui.saludo.textContent = "Hola, " + yo.nombre + (cuenta ? " · " + cuenta : "");
  } else {
    ui.saludo.textContent = cuenta ? cuenta.charAt(0).toUpperCase() + cuenta.slice(1) : "";
  }
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
  const fecha = new Date(a, m - 1, d);
  const dias = Math.round((fecha - hoyLocal()) / 86400000);
  const corta = d + " " + MESES[m - 1] + (a !== hoyLocal().getFullYear() ? " " + a : "");
  if (dias < 0) return { clase: "vencido", texto: "Venció el " + corta };
  if (dias === 0) return { clase: "hoy", texto: "Hoy" };
  if (dias === 1) return { clase: "pronto", texto: "Mañana" };
  if (dias < 7) return { clase: dias <= 3 ? "pronto" : "normal", texto: DIAS[fecha.getDay()] + " " + d };
  return { clase: "normal", texto: corta };
}

function aplicarRefrescoPospuesto() {
  if (refrescoPospuesto) {
    refrescoPospuesto = false;
    refrescarVista();
  }
}

function pildora(nombreIcono, texto, alTocar, activa) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "pildora" + (activa ? " activa" : "");
  b.append(icono(nombreIcono), document.createTextNode(texto));
  b.addEventListener("click", alTocar);
  return b;
}

// Píldora de fecha: un <input type="date"> invisible la cubre entera, así al
// tocarla se abre el selector nativo (también en iPhone, sin trucos)
function pildoraFecha(aviso) {
  const pildoraEl = document.createElement("label");
  pildoraEl.className = "pildora";
  const input = document.createElement("input");
  input.type = "date";
  input.value = aviso.vence || "";
  input.setAttribute("aria-label", aviso.vence ? "Cambiar fecha límite" : "Poner fecha límite");
  input.addEventListener("change", () => cambiarVence(aviso, input.value));
  // En PC con ratón, un clic sobre el campo no abre el calendario por sí solo
  input.addEventListener("click", () => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    try {
      input.showPicker();
    } catch {
      // navegador sin showPicker: el campo recibe el foco y se puede escribir la fecha
    }
  });
  pildoraEl.append(icono("calendario"), document.createTextNode("Fecha"), input);
  return pildoraEl;
}

function alternarAbierto(id) {
  abiertoId = abiertoId === id ? null : id;
  for (const li of ui.lista.children) {
    li.classList.toggle("abierto", li.dataset.id === abiertoId);
  }
}

function render(avisos) {
  // No destruir una edición en curso: el refresco se aplica al terminar de editar
  if (ui.lista.querySelector("input.editar, textarea.editar-nota")) {
    refrescoPospuesto = true;
    return;
  }
  pendientesVisibles = avisos.length;
  actualizarSaludo();
  const conAutores = personas.size > 1;
  ui.lista.textContent = "";

  for (const aviso of avisos) {
    const li = document.createElement("li");
    li.className = "aviso";
    li.dataset.id = aviso.id;
    if (aviso.prioridad) li.classList.add("importante");
    if (aviso.id === abiertoId) li.classList.add("abierto");

    const check = document.createElement("button");
    check.type = "button";
    check.className = "check";
    check.title = "Marcar como hecho";
    check.setAttribute("aria-label", "Marcar como hecho");
    check.append(icono("check"));
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

    const chips = document.createElement("div");
    chips.className = "chips";
    const info = infoVence(aviso.vence);
    if (info) {
      const chip = document.createElement("span");
      chip.className = "chip " + info.clase;
      chip.textContent = info.texto;
      chips.append(chip);
    }
    contenido.append(chips);

    li.append(check, contenido);

    if (conAutores && aviso.creado_por) {
      const quien = avatar(aviso.creado_por);
      const p = persona(aviso.creado_por);
      quien.title = "Lo anotó " + (p ? p.nombre : aviso.creado_por);
      li.append(quien);
    }

    // Opciones: fila a todo el ancho que aparece al tocar la tarjeta
    const acciones = document.createElement("div");
    acciones.className = "acciones";
    acciones.append(
      pildora("editar", "Editar", () => editar(aviso, span)),
      pildora("nota", "Nota", () => editarNota(aviso, contenido)),
      pildora("bandera", "Importante", () => cambiarPrioridad(aviso), aviso.prioridad),
      pildoraFecha(aviso)
    );
    if (aviso.vence) {
      acciones.append(pildora("x", "Sin fecha", () => cambiarVence(aviso, "")));
    }
    li.append(acciones);

    // Tocar la tarjeta despliega o recoge sus opciones
    li.addEventListener("click", (e) => {
      if (e.target.closest("button, input, textarea, label, .edicion")) return;
      alternarAbierto(aviso.id);
    });

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
        "(si pasa siempre, revisa que tu correo esté en la tabla «personas» de Supabase).",
      desaparecido: true,
    };
  }
  return null;
}

function botonEdicion(clase, nombreIcono, titulo) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "accion " + clase;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  b.append(icono(nombreIcono));
  return b;
}

function editar(aviso, span) {
  if (!span.isConnected) return; // ya está en edición (el span fue reemplazado)
  const input = document.createElement("input");
  input.type = "text";
  input.className = "editar";
  input.maxLength = 500;
  input.value = aviso.texto;

  const btnOk = botonEdicion("ok", "check", "Guardar");
  const btnNo = botonEdicion("no", "x", "Cancelar");

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

  const btnOk = botonEdicion("ok", "check", "Guardar nota");
  const btnNo = botonEdicion("no", "x", "Cancelar");

  const caja = document.createElement("span");
  caja.className = "edicion edicion-nota";
  caja.append(area, btnOk, btnNo);
  if (notaVisible) notaVisible.replaceWith(caja);
  else contenido.insertBefore(caja, contenido.querySelector(".chips"));
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
  if (li.classList.contains("completando")) return; // candado anti doble toque
  li.classList.add("completando");
  const r = await actualizarAviso(aviso.id, { completado_en: new Date().toISOString() }, "completar");
  if (r) {
    li.classList.remove("completando");
    estado(r.fallo);
    if (r.desaparecido) cargar();
    return;
  }
  if (abiertoId === aviso.id) abiertoId = null;
  completadosPendientes.push(aviso.id);
  mostrarToast();
  setTimeout(cargar, 450); // deja verse la animación y refresca
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
  return d.getDate() + " " + MESES[d.getMonth()] + ", " + hh + ":" + mm;
}

function renderHistorial(avisos) {
  ui.listaHistorial.textContent = "";
  const conAutores = personas.size > 1;
  for (const aviso of avisos) {
    const li = document.createElement("li");
    li.className = "aviso hecho";

    const marca = document.createElement("span");
    marca.className = "check lleno";
    marca.append(icono("check"));

    const contenido = document.createElement("div");
    contenido.className = "contenido";
    const span = document.createElement("span");
    span.className = "texto";
    span.textContent = aviso.texto;
    const meta = document.createElement("span");
    meta.className = "meta";
    const quien = persona(aviso.completado_por);
    const cuando = formatearFechaHora(aviso.completado_en);
    meta.textContent = conAutores && quien ? "Lo hizo " + quien.nombre + " · " + cuando : "Hecho el " + cuando;
    contenido.append(span, meta);

    const btnRestaurar = document.createElement("button");
    btnRestaurar.type = "button";
    btnRestaurar.className = "icono";
    btnRestaurar.title = "Devolver a pendientes";
    btnRestaurar.setAttribute("aria-label", "Devolver a pendientes");
    btnRestaurar.append(icono("deshacer"));
    btnRestaurar.addEventListener("click", () => restaurar(aviso.id));

    li.append(marca, contenido, btnRestaurar);
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

function pintarCampana(activa, titulo) {
  ui.btnNotif.replaceChildren(icono(activa ? "campana" : "campana-off"));
  ui.btnNotif.classList.toggle("activa", activa);
  ui.btnNotif.title = titulo;
  ui.btnNotif.setAttribute("aria-label", titulo);
}

async function actualizarBotonNotif() {
  if (!soportaPush()) {
    mostrar(ui.btnNotif, false);
    return;
  }
  if (Notification.permission === "denied") {
    mostrar(ui.btnNotif, true);
    pintarCampana(false, "Notificaciones bloqueadas por el navegador (revísalo en la configuración del sitio)");
    return;
  }
  try {
    const reg = await swListo();
    const sus = await reg.pushManager.getSubscription();
    mostrar(ui.btnNotif, true);
    pintarCampana(
      Boolean(sus),
      sus
        ? "Notificaciones activadas en este dispositivo (toca para desactivar)"
        : "Activar notificaciones en este dispositivo"
    );
  } catch {
    mostrar(ui.btnNotif, false); // sin SW no hay push que ofrecer
  }
}

async function alternarNotificaciones() {
  if (!soportaPush()) return;
  // iPhone exige pedir el permiso en el mismo toque, antes de cualquier espera
  const permisoEnCurso =
    Notification.permission === "default" ? Notification.requestPermission() : null;
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
        estado("Notificaciones desactivadas en este dispositivo.", "ok");
      }
    } else {
      const permiso = permisoEnCurso ? await permisoEnCurso : Notification.permission;
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
      estado("Notificaciones activadas: este dispositivo avisará cuando algo venza.", "ok");
    }
  } catch (err) {
    estado("No se pudieron cambiar las notificaciones: " + err.message);
  } finally {
    ui.btnNotif.disabled = false;
    actualizarBotonNotif();
  }
}

ui.btnNotif.addEventListener("click", alternarNotificaciones);

// ---------- iPhone: cómo instalarla ----------

function esIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function estaInstalada() {
  return window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
}

function mostrarAyudaIOS() {
  let cerrada = false;
  try {
    cerrada = localStorage.getItem("ayudaIOSCerrada") === "1";
  } catch {
    // almacenamiento bloqueado: se muestra igual
  }
  mostrar(ui.ayudaIOS, esIOS() && !estaInstalada() && !cerrada);
}

ui.btnAyudaIOS.addEventListener("click", () => {
  try {
    localStorage.setItem("ayudaIOSCerrada", "1");
  } catch {
    // sin almacenamiento: se cierra solo por ahora
  }
  mostrar(ui.ayudaIOS, false);
});

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

// ---------- Cuenta ----------

function abrirHoja(dlg) {
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

function cerrarHoja(dlg) {
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
}

// Tocar fuera de la hoja (en el velo) la cierra
for (const dlg of [ui.dlgCuenta, ui.dlgClave]) {
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) cerrarHoja(dlg);
  });
}

ui.btnCuenta.addEventListener("click", () => abrirHoja(ui.dlgCuenta));
ui.btnCerrarCuenta.addEventListener("click", () => cerrarHoja(ui.dlgCuenta));

ui.btnCambiarClave.addEventListener("click", () => {
  cerrarHoja(ui.dlgCuenta);
  ui.formClave.reset();
  mostrar(ui.errorClave, false);
  abrirHoja(ui.dlgClave);
  ui.claveNueva.focus();
});

ui.btnCancelarClave.addEventListener("click", () => cerrarHoja(ui.dlgClave));

function errorClave(msg) {
  ui.errorClave.textContent = msg;
  mostrar(ui.errorClave, true);
}

ui.formClave.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nueva = ui.claveNueva.value;
  if (nueva.length < 8) {
    errorClave("Usa al menos 8 caracteres.");
    return;
  }
  if (nueva !== ui.claveRepetir.value) {
    errorClave("Las dos contraseñas no coinciden.");
    return;
  }
  mostrar(ui.errorClave, false);
  const boton = ui.formClave.querySelector("button[type='submit']");
  boton.disabled = true;
  const { error } = await sb.auth.updateUser({ password: nueva });
  boton.disabled = false;
  if (error) {
    const codigo = error.code || "";
    if (codigo === "same_password") errorClave("Tiene que ser distinta de la actual.");
    else if (codigo === "weak_password") errorClave("Es muy débil: prueba con una más larga.");
    else if (codigo === "reauthentication_needed") {
      errorClave("Por seguridad, cierra sesión, vuelve a entrar y repite el cambio.");
    } else errorClave("No se pudo cambiar: " + error.message);
    return;
  }
  ui.formClave.reset();
  cerrarHoja(ui.dlgClave);
  estado("Contraseña cambiada. Úsala la próxima vez que entres.", "ok");
});

// ---------- Eventos de la interfaz ----------

ui.formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  mostrar(ui.errorLogin, false);
  const boton = ui.formLogin.querySelector("button");
  boton.disabled = true;
  const { data, error } = await sb.auth.signInWithPassword({
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
  entrarApp(data.session);
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

// Tocar fuera de la lista recoge las opciones del aviso desplegado
document.addEventListener("click", (e) => {
  if (abiertoId && !e.target.closest("#lista")) alternarAbierto(abiertoId);
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
  mostrar(ui.toast, false);
  mostrar(ui.historial, true);
  ubicarEstado(ui.historial);
  estado("");
  window.scrollTo(0, 0);
  cargarHistorial();
});

ui.btnVolver.addEventListener("click", () => {
  mostrar(ui.historial, false);
  mostrar(ui.app, true);
  ubicarEstado(ui.app);
  estado("");
  window.scrollTo(0, 0);
  cargar();
});

ui.btnVaciar.addEventListener("click", async () => {
  const aviso = personas.size > 1
    ? "¿Borrar definitivamente todo el historial? Se borra para todos."
    : "¿Borrar definitivamente todo el historial?";
  if (!window.confirm(aviso)) return;
  const { error } = await sb.from("avisos").delete().not("completado_en", "is", null);
  if (error) {
    estado("No se pudo vaciar el historial: " + error.message);
    return;
  }
  completadosPendientes = [];
  cargarHistorial();
});

ui.btnSalir.addEventListener("click", async () => {
  cerrarHoja(ui.dlgCuenta);
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

// iPhone: el teclado tapa lo que está fijo abajo; se sube la barra de escribir.
// (En Android lo resuelve interactive-widget=resizes-content y esto da 0.)
function ajustarTeclado() {
  const vv = window.visualViewport;
  if (!vv) return;
  const tapado = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  document.documentElement.style.setProperty("--teclado", tapado + "px");
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", ajustarTeclado);
  window.visualViewport.addEventListener("scroll", ajustarTeclado);
}

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
