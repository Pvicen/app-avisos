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
  vistaPrevia: $("#vista-previa"),
  vistaPreviaChip: $("#vista-previa-chip"),
  vistaPreviaTexto: $("#vista-previa-texto"),
  vistaPreviaQuitar: $("#vista-previa-quitar"),
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
  pestanas: $("#pestanas"),
  tabAvisos: $("#tab-avisos"),
  tabPanel: $("#tab-panel"),
  vistaAvisos: $("#vista-avisos"),
  vistaPanel: $("#vista-panel"),
  panelContenido: $("#panel-contenido"),
};

// Panel personal (Contrato C3 de docs/panel-contrato.md). KaTeX se carga solo si hay panel.
const KATEX_BASE = "https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/";
const KATEX_JS_SRI = "sha384-CwjPRVHTvLiMBFjEoij+QZViMV5rhTOIp7CJzl24JEqpRDA1sJFHVXXLURktbYYp";
const KATEX_CSS_SRI = "sha384-nH0MfJ44wi1dd7w6jinlyBgljjS8EJAh2JBoRad8a3VDw2K69vfaaqm4WnR+gXtA";
const PREFIJO_CANVAS = "https://canvas.ucam.edu/";
const CLAVE_COPIA_PANEL = "panel-copia";
const PREFIJO_HECHO = "panel-hecho:";
const CLAVE_VISTA = "vista-recordada";
const HORAS_PANEL_ANTIGUO = 3;
const MIN_EJERCICIOS_BANCO = 5;
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

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
let vista = "avisos";           // pestaña visible: "avisos" | "panel"
let panelActual = null;         // { datos, sinConexion } o null si no hay panel
let panelVisto = false;         // ya se aplicó la pestaña recordada
let panelSeq = 0;               // descarta respuestas obsoletas de cargarPanel()
let canalPanel = null;
let reintentoPanel = null;
let panelResincronizar = false; // la próxima suscripción es una reconexión
let katexPromesa = null;
const formulas = new WeakMap(); // <span> → { valor, bloque } pendiente de KaTeX

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
    actualizarVistaPrevia();
  }

  // Prueba local del panel con datos inventados: ni sesión ni Supabase
  if (modoEjemploPanel()) {
    entrarEjemploPanel();
    return;
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

  sb.auth.onAuthStateChange((evento, sesion) => {
    if (evento === "SIGNED_OUT") {
      borrarPanelLocal(); // también si la sesión se cerró desde otro sitio
      location.reload();
      return;
    }
    // Otra pestaña entró con OTRA cuenta: esta no puede seguir con la anterior (ni con su panel).
    // Con la misma cuenta, o antes de entrar (miCorreo vacío), no se hace nada: sin bucles.
    const correo = ((sesion && sesion.user && sesion.user.email) || "").toLowerCase();
    if (miCorreo && correo && correo !== miCorreo) location.reload();
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
  // El panel: primero la copia local (si es de esta cuenta), luego lo que diga Supabase
  const copia = leerCopiaPanel();
  if (copia) mostrarPanel({ datos: copia, sinConexion: false, actualizando: true });
  cargarPanel();
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
    .order("hora", { ascending: true, nullsFirst: false }) // en el mismo día, primero los que tienen hora
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

// "AAAA-MM-DD" del día local (la app la usan dos personas en España: el reloj del dispositivo)
function fechaISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// "HH:MM" de ahora, para comparar con la hora de un aviso
function horaActual() {
  return horaCorta(new Date());
}

// "09:30:00" (como la guarda la base) → "9:30"
function horaLegible(hora) {
  const [h, m] = hora.split(":");
  return Number(h) + ":" + m;
}

// La hora solo cuenta si hay fecha (contrato de la migración 2026-10-08-hora.sql)
function infoVence(vence, hora) {
  if (!vence) return null;
  const [a, m, d] = vence.split("-").map(Number);
  const fecha = new Date(a, m - 1, d);
  const dias = Math.round((fecha - hoyLocal()) / 86400000);
  const corta = d + " " + MESES[m - 1] + (a !== hoyLocal().getFullYear() ? " " + a : "");
  let info;
  if (dias < 0) info = { clase: "vencido", texto: "Venció el " + corta };
  else if (dias === 0) info = { clase: hora && hora.slice(0, 5) <= horaActual() ? "vencido" : "hoy", texto: "Hoy" };
  else if (dias === 1) info = { clase: "pronto", texto: "Mañana" };
  else if (dias < 7) info = { clase: dias <= 3 ? "pronto" : "normal", texto: DIAS[fecha.getDay()] + " " + d };
  else info = { clase: "normal", texto: corta };
  if (hora) info.texto += " · " + horaLegible(hora);
  return info;
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
  input.addEventListener("click", () => abrirSelectorEnPC(input));
  pildoraEl.append(icono("calendario"), document.createTextNode("Fecha"), input);
  return pildoraEl;
}

// Píldora de hora: igual que la de fecha, con un <input type="time"> invisible encima
function pildoraHora(aviso) {
  const pildoraEl = document.createElement("label");
  pildoraEl.className = "pildora";
  const input = document.createElement("input");
  input.type = "time";
  input.value = aviso.hora ? aviso.hora.slice(0, 5) : "";
  input.setAttribute("aria-label", aviso.vence && aviso.hora ? "Cambiar hora" : "Poner hora");
  input.addEventListener("change", () => cambiarHora(aviso, input.value));
  input.addEventListener("click", () => abrirSelectorEnPC(input));
  pildoraEl.append(icono("reloj"), document.createTextNode("Hora"), input);
  return pildoraEl;
}

// En PC con ratón, un clic sobre el campo no abre el selector por sí solo
function abrirSelectorEnPC(input) {
  if (!window.matchMedia("(pointer: fine)").matches) return;
  try {
    input.showPicker();
  } catch {
    // navegador sin showPicker: el campo recibe el foco y se puede escribir a mano
  }
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
    const info = infoVence(aviso.vence, aviso.hora);
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
      pildoraFecha(aviso),
      pildoraHora(aviso)
    );
    if (aviso.vence) {
      acciones.append(pildora("x", "Sin fecha", () => cambiarVence(aviso, "")));
    }
    if (aviso.vence && aviso.hora) {
      acciones.append(pildora("x", "Sin hora", () => cambiarHora(aviso, "")));
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
  // Sin fecha, la hora no cuenta: se quita también
  const cambios = valor ? { vence: valor } : { vence: null, hora: null };
  const r = await actualizarAviso(aviso.id, cambios, "cambiar la fecha");
  if (r) {
    estado(r.fallo);
    if (r.desaparecido) cargar();
    return;
  }
  cargar();
}

// Una hora sin fecha es para hoy, o para mañana si esa hora ya pasó
async function cambiarHora(aviso, valor) {
  const cambios = { hora: valor || null };
  if (valor && !aviso.vence) {
    const dia = hoyLocal();
    if (valor <= horaActual()) dia.setDate(dia.getDate() + 1);
    cambios.vence = fechaISO(dia);
  }
  const r = await actualizarAviso(aviso.id, cambios, "cambiar la hora");
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

// ---------- Panel personal ----------
// Solo lo ve su dueño: la RLS de `panel` no devuelve filas a nadie más, y sin fila no hay pestaña.

const solucionesAbiertas = new Set(); // ids de ejercicios con la solución desplegada
const diasAbiertos = new Set();       // fechas de «Esta semana» desplegadas

function leerLocal(clave) {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    // sin almacenamiento: el panel funciona igual, sin recordar
  }
}

function borrarLocal(clave) {
  try {
    localStorage.removeItem(clave);
  } catch {
    // ídem
  }
}

/** Al cerrar sesión: fuera la copia del panel y todos los «Hecho». */
function borrarPanelLocal() {
  borrarLocal(CLAVE_COPIA_PANEL);
  try {
    const claves = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave && clave.startsWith(PREFIJO_HECHO)) claves.push(clave);
    }
    for (const clave of claves) localStorage.removeItem(clave);
  } catch {
    // sin almacenamiento: no hay nada que borrar
  }
}

/** La última copia del panel, solo si es de la cuenta abierta (el dispositivo puede ser compartido). */
function leerCopiaPanel() {
  try {
    const copia = JSON.parse(leerLocal(CLAVE_COPIA_PANEL) || "null");
    return copia && miCorreo && copia.correo === miCorreo && copia.datos ? copia.datos : null;
  } catch {
    return null;
  }
}

function guardarCopiaPanel(datos) {
  if (miCorreo) guardarLocal(CLAVE_COPIA_PANEL, JSON.stringify({ correo: miCorreo, datos }));
}

// Prueba local: ?panel=ejemplo SOLO en localhost carga setup/panel-ejemplo.json (no se publica en Pages)
function modoEjemploPanel() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  return local && new URLSearchParams(location.search).get("panel") === "ejemplo";
}

function entrarEjemploPanel() {
  mostrar(ui.login, false);
  mostrar(ui.app, true);
  for (const elemento of [ui.btnNotif, ui.btnHistorial, ui.btnCuenta, ui.formNuevo]) mostrar(elemento, false);
  ui.saludo.textContent = "Modo de prueba · datos inventados";
  ui.vacio.querySelector(".vacio-titulo").textContent = "Los avisos necesitan sesión";
  ui.vacio.querySelector(".vacio-texto").textContent = "En el modo de prueba solo se ve el panel.";
  mostrar(ui.vacio, true);
  mostrar(ui.pestanas, true);
  cambiarVista("panel", false);
  pintarPanelCargando();
  cargarPanel();
}

function aFechaISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
}

function fechaLocal(texto) {
  const [a, m, d] = String(texto).split("-").map(Number);
  return new Date(a, m - 1, d);
}

/** El ejemplo tiene fechas fijas: se corren para que su primer día sea hoy y nada salga vencido. */
function acercarEjemploAHoy(original) {
  const d = JSON.parse(JSON.stringify(original));
  const primero = d.dias && d.dias[0] ? fechaLocal(d.dias[0].fecha) : hoyLocal();
  const delta = Math.round((hoyLocal() - primero) / 86400000);
  const moverDia = (f) => {
    const x = fechaLocal(f);
    x.setDate(x.getDate() + delta);
    return aFechaISO(x);
  };
  const moverInstante = (iso) => new Date(Date.parse(iso) + delta * 86400000).toISOString();
  for (const x of d.dias || []) x.fecha = moverDia(x.fecha);
  for (const x of d.parciales || []) x.fecha = moverDia(x.fecha);
  for (const x of d.proyectos || []) x.fecha = moverDia(x.fecha);
  for (const x of d.entregas || []) x.vence = moverInstante(x.vence);
  for (const x of d.novedades || []) x.fecha = moverInstante(x.fecha);
  // ?horas=N simula que el portátil lleva N horas sin mandar datos
  const horas = Number(new URLSearchParams(location.search).get("horas"));
  d.generado = new Date(Date.now() - (horas > 0 ? horas * 3600000 : 25 * 60000)).toISOString();
  return d;
}

async function cargarPanel() {
  const seq = ++panelSeq;
  if (modoEjemploPanel()) {
    try {
      const r = await fetch("setup/panel-ejemplo.json", { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const datos = acercarEjemploAHoy(await r.json());
      if (seq === panelSeq) mostrarPanel({ datos, sinConexion: false });
    } catch (err) {
      if (seq === panelSeq) pintarPanelError("No se pudo leer setup/panel-ejemplo.json (" + err.message + ").");
    }
    return;
  }
  if (!sb) return;
  const { data, error } = await sb.from("panel").select("datos").maybeSingle();
  if (seq !== panelSeq) return;
  if (error) {
    // Sin red (o la API caída): se enseña la última copia, marcada
    const copia = leerCopiaPanel();
    if (copia) mostrarPanel({ datos: copia, sinConexion: true });
    return;
  }
  if (!data) {
    quitarPanel();
    return;
  }
  guardarCopiaPanel(data.datos);
  mostrarPanel({ datos: data.datos, sinConexion: false });
  suscribirPanel();
}

function mostrarPanel(estado) {
  panelActual = estado;
  mostrar(ui.pestanas, true);
  if (!panelVisto) {
    panelVisto = true;
    if (leerLocal(CLAVE_VISTA) === "panel") cambiarVista("panel", false);
  }
  pintarPanel();
}

function quitarPanel() {
  panelActual = null;
  mostrar(ui.pestanas, false);
  if (vista === "panel") cambiarVista("avisos", false);
  ui.panelContenido.textContent = "";
  borrarLocal(CLAVE_COPIA_PANEL);
  if (canalPanel && sb) {
    const c = canalPanel;
    canalPanel = null;
    sb.removeChannel(c);
  }
}

function cambiarVista(nueva, recordar = true) {
  if (nueva === "panel" && !panelActual && !modoEjemploPanel()) nueva = "avisos";
  vista = nueva;
  const enPanel = nueva === "panel";
  ui.tabAvisos.setAttribute("aria-selected", String(!enPanel));
  ui.tabPanel.setAttribute("aria-selected", String(enPanel));
  ui.tabAvisos.tabIndex = enPanel ? -1 : 0;
  ui.tabPanel.tabIndex = enPanel ? 0 : -1;
  mostrar(ui.vistaAvisos, !enPanel);
  mostrar(ui.vistaPanel, enPanel);
  ui.app.classList.toggle("viendo-panel", enPanel);
  if (recordar) guardarLocal(CLAVE_VISTA, nueva);
}

function suscribirPanel() {
  if (canalPanel || !sb || !miCorreo) return;
  clearTimeout(reintentoPanel);
  const c = sb
    .channel("panel-cambios")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "panel", filter: "dueno=eq." + miCorreo },
      () => cargarPanel()
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        if (panelResincronizar) cargarPanel(); // tras una reconexión, ponerse al día
        panelResincronizar = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (canalPanel !== c) return; // aviso tardío de un canal ya quitado
        sb.removeChannel(c);
        canalPanel = null;
        clearTimeout(reintentoPanel);
        reintentoPanel = setTimeout(suscribirPanel, 5000);
      }
    });
  canalPanel = c;
}

// --- Pintado (siempre nodos de texto: nada del JSON pasa por innerHTML) ---

function el(etiqueta, clase, texto) {
  const e = document.createElement(etiqueta);
  if (clase) e.className = clase;
  if (texto !== undefined && texto !== null) e.textContent = texto;
  return e;
}

const comoLista = (x) => (Array.isArray(x) ? x : []);
const comoTexto = (x) => (typeof x === "string" ? x : "");
const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function colorMateria(materia) {
  let h = 0;
  for (const c of comoTexto(materia)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return "p" + (h % COLORES_PERSONA);
}

function chipMateria(materia) {
  return el("span", "chip-materia " + colorMateria(materia), comoTexto(materia));
}

function tarjetaPanel(id, nombreIcono, titulo, subtitulo) {
  const s = el("section", "tarjeta-panel");
  s.setAttribute("aria-labelledby", "panel-" + id);
  const cabeza = el("div", "tarjeta-cabeza");
  const h = el("h2", "tarjeta-titulo");
  h.id = "panel-" + id;
  h.append(icono(nombreIcono), document.createTextNode(titulo));
  cabeza.append(h);
  if (subtitulo) cabeza.append(el("span", "tarjeta-sub", subtitulo));
  s.append(cabeza);
  return s;
}

function vacioPanel(texto) {
  return el("p", "panel-vacio", texto);
}

function avisoPanel(nombreIcono, texto) {
  const p = el("p", "aviso-panel");
  p.setAttribute("role", "status");
  p.append(icono(nombreIcono), document.createTextNode(texto));
  return p;
}

function diasHasta(fecha) {
  const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  return Math.round((d - hoyLocal()) / 86400000);
}

function fechaLarga(d) {
  return DIAS_SEMANA[d.getDay()] + " " + d.getDate() + " de " + MESES_LARGOS[d.getMonth()];
}

function horaCorta(d) {
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function haceCuanto(ms) {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// Fórmulas: el texto se parte en trozos normales ($…$ en línea, $$…$$ en bloque, \$ es un dólar)
function trozosConFormulas(texto) {
  const trozos = [];
  let normal = "";
  let i = 0;
  const cerrarNormal = () => {
    if (normal) trozos.push({ formula: false, valor: normal });
    normal = "";
  };
  while (i < texto.length) {
    if (texto[i] === "\\" && texto[i + 1] === "$") {
      normal += "$";
      i += 2;
      continue;
    }
    if (texto[i] === "$") {
      const bloque = texto[i + 1] === "$";
      const abre = bloque ? 2 : 1;
      const fin = buscarCierre(texto, i + abre, bloque);
      if (fin > i + abre) {
        cerrarNormal();
        trozos.push({ formula: true, bloque, valor: texto.slice(i + abre, fin) });
        i = fin + abre;
        continue;
      }
    }
    normal += texto[i];
    i++;
  }
  cerrarNormal();
  // Una fórmula en bloque ya va en su propia línea: el salto de línea que la rodea sobra
  trozos.forEach((t, k) => {
    if (t.formula) return;
    if (trozos[k + 1]?.bloque) t.valor = t.valor.replace(/\r?\n$/, "");
    if (trozos[k - 1]?.bloque) t.valor = t.valor.replace(/^\r?\n/, "");
  });
  return trozos.filter((t) => t.formula || t.valor);
}

function buscarCierre(texto, desde, bloque) {
  for (let j = desde; j < texto.length; j++) {
    if (texto[j] === "\\") {
      j++; // \$ y demás escapes dentro de la fórmula no cierran
      continue;
    }
    if (texto[j] === "$" && (!bloque || texto[j + 1] === "$")) return j;
  }
  return -1;
}

function pintarConFormulas(contenedor, texto) {
  for (const t of trozosConFormulas(comoTexto(texto))) {
    if (!t.formula) {
      contenedor.append(document.createTextNode(t.valor));
      continue;
    }
    // Mientras KaTeX no carga (o si no carga), se ve la fórmula tal cual
    const span = el("span", t.bloque ? "formula formula-bloque" : "formula",
      t.bloque ? "$$" + t.valor + "$$" : "$" + t.valor + "$");
    formulas.set(span, t);
    contenedor.append(span);
  }
}

function pintarFormulas(raiz) {
  if (!window.katex) return;
  for (const span of raiz.querySelectorAll("span.formula")) {
    const t = formulas.get(span);
    if (!t) continue;
    formulas.delete(span);
    try {
      window.katex.render(t.valor, span, {
        throwOnError: false,
        trust: false,
        displayMode: t.bloque,
        strict: "ignore",
      });
    } catch {
      // se queda la fórmula como texto
    }
  }
}

function cargarKatex() {
  if (window.katex) return Promise.resolve(true);
  if (katexPromesa) return katexPromesa;
  katexPromesa = new Promise((resolver) => {
    if (!document.querySelector("link[data-katex]")) {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = KATEX_BASE + "katex.min.css";
      css.integrity = KATEX_CSS_SRI;
      css.crossOrigin = "anonymous";
      css.dataset.katex = "1";
      document.head.append(css);
    }
    const js = document.createElement("script");
    js.src = KATEX_BASE + "katex.min.js";
    js.integrity = KATEX_JS_SRI;
    js.crossOrigin = "anonymous";
    js.onload = () => resolver(Boolean(window.katex));
    js.onerror = () => {
      js.remove();
      katexPromesa = null; // se reintenta la próxima vez
      resolver(false);
    };
    document.head.append(js);
  });
  return katexPromesa;
}

function pintarPanelCargando() {
  const caja = el("div", "panel-cargando");
  caja.setAttribute("aria-busy", "true");
  caja.setAttribute("aria-label", "Cargando el panel");
  for (let i = 0; i < 3; i++) caja.append(el("div", "esqueleto"));
  ui.panelContenido.replaceChildren(caja);
}

function pintarPanelError(texto) {
  ui.panelContenido.replaceChildren(avisoPanel("alerta", texto));
}

function pintarPanel() {
  if (!panelActual) return;
  const { datos, sinConexion, actualizando } = panelActual;
  const raiz = ui.panelContenido;
  raiz.textContent = "";
  if (sinConexion) raiz.append(avisoPanel("sin-red", "Sin conexión: es la última copia guardada."));
  const dias = comoLista(datos.dias);
  raiz.append(
    seccionHoy(dias[0]),
    seccionEjercicios(comoLista(datos.ejercicios)),
    seccionPlazos(comoLista(datos.entregas), comoLista(datos.parciales))
  );
  if (dias.length > 1) raiz.append(seccionSemana(dias.slice(1)));
  raiz.append(seccionNovedades(comoLista(datos.novedades)));
  if (comoLista(datos.proyectos).length > 0) raiz.append(seccionProyectos(comoLista(datos.proyectos)));
  raiz.append(piePanel(datos, sinConexion, actualizando));
  cargarKatex().then((ok) => {
    if (ok) pintarFormulas(raiz);
  });
}

function contenidoDia(dia, sinClases) {
  const caja = el("div", "dia-contenido");
  const clases = el("p", "panel-clases" + (comoTexto(dia.clases) ? "" : " apagado"));
  clases.append(icono("reloj"), document.createTextNode(comoTexto(dia.clases) || sinClases));
  caja.append(clases);
  const bloques = comoLista(dia.estudio);
  if (bloques.length === 0) {
    caja.append(vacioPanel("Sin bloques de estudio."));
    return caja;
  }
  const ul = el("ul", "bloques");
  ul.setAttribute("aria-label", "Bloques de estudio");
  for (const b of bloques) {
    const li = el("li", "bloque");
    const cabeza = el("div", "bloque-cabeza");
    cabeza.append(chipMateria(b.materia));
    if (comoTexto(b.duracion)) cabeza.append(el("span", "bloque-duracion", comoTexto(b.duracion)));
    li.append(cabeza, el("p", "bloque-texto", comoTexto(b.texto)));
    ul.append(li);
  }
  caja.append(ul);
  return caja;
}

function seccionHoy(dia) {
  const fecha = dia ? fechaLocal(dia.fecha) : hoyLocal();
  const s = tarjetaPanel("hoy", "hoy", "Hoy", capitalizar(fechaLarga(fecha)));
  if (!dia) s.append(vacioPanel("Sin datos de hoy."));
  else s.append(contenidoDia(dia, "Sin clases hoy."));
  return s;
}

function estaHecho(id) {
  return leerLocal(PREFIJO_HECHO + id) === "1";
}

function textoHechos(seccion) {
  const total = seccion.querySelectorAll(".ejercicio").length;
  const hechos = seccion.querySelectorAll(".ejercicio.hecho").length;
  return `${hechos} de ${total} hechos`;
}

function seccionEjercicios(ejercicios) {
  const s = tarjetaPanel("ejercicios", "editar", "Ejercicios de hoy", ejercicios.length ? " " : "");
  if (ejercicios.length === 0) {
    s.append(vacioPanel("Hoy no tocan ejercicios."));
    return s;
  }
  const ol = el("ol", "ejercicios");
  ejercicios.forEach((x, i) => ol.append(ejercicio(x, i, s)));
  s.append(ol);
  s.querySelector(".tarjeta-sub").textContent = textoHechos(s);
  return s;
}

function ejercicio(x, i, seccion) {
  const id = comoTexto(x.id);
  const li = el("li", "ejercicio");
  const cabeza = el("div", "ejercicio-cabeza");
  const nivel = Number(x.nivel);
  const etiquetaNivel = el("span", "nivel nivel-" + nivel, "Nivel " + nivel);
  etiquetaNivel.setAttribute("aria-label", `Nivel ${nivel} de 3`);
  cabeza.append(chipMateria(x.materia), etiquetaNivel);
  li.append(cabeza, el("h3", "ejercicio-tema", comoTexto(x.tema)));

  const enunciado = el("div", "texto-formulas");
  pintarConFormulas(enunciado, x.enunciado);
  li.append(enunciado);

  const solucion = el("div", "texto-formulas solucion");
  solucion.id = "solucion-" + i;
  solucion.hidden = !solucionesAbiertas.has(id);
  const cuerpoSolucion = el("div");
  pintarConFormulas(cuerpoSolucion, x.solucion);
  solucion.append(el("p", "solucion-titulo", "Solución"), cuerpoSolucion);

  const acciones = el("div", "ejercicio-acciones");
  const ver = el("button", "boton-panel");
  ver.type = "button";
  ver.setAttribute("aria-controls", solucion.id);
  const pintarVer = () => {
    ver.setAttribute("aria-expanded", String(!solucion.hidden));
    ver.replaceChildren(icono("ojo"), document.createTextNode(solucion.hidden ? "Ver solución" : "Ocultar solución"));
  };
  ver.addEventListener("click", () => {
    solucion.hidden = !solucion.hidden;
    if (solucion.hidden) solucionesAbiertas.delete(id);
    else solucionesAbiertas.add(id);
    pintarVer();
  });
  pintarVer();

  const hecho = el("button", "boton-panel boton-hecho");
  hecho.type = "button";
  const pintarHecho = () => {
    const si = estaHecho(id);
    hecho.setAttribute("aria-pressed", String(si));
    hecho.replaceChildren(icono("check"), document.createTextNode("Hecho"));
    li.classList.toggle("hecho", si);
  };
  hecho.addEventListener("click", () => {
    if (estaHecho(id)) borrarLocal(PREFIJO_HECHO + id);
    else guardarLocal(PREFIJO_HECHO + id, "1");
    pintarHecho();
    seccion.querySelector(".tarjeta-sub").textContent = textoHechos(seccion);
  });
  pintarHecho();

  acciones.append(ver, hecho);
  li.append(acciones, solucion);
  return li;
}

function claseUrgencia(dias) {
  if (dias <= 2) return "urgente";
  if (dias <= 7) return "pronto";
  return "normal";
}

function textoPlazo(dias) {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  return `faltan ${dias} días`;
}

function seccionPlazos(entregas, parciales) {
  const ahora = Date.now();
  const items = [];
  for (const e of entregas) {
    const t = Date.parse(e.vence);
    if (Number.isNaN(t) || t < ahora) continue; // lo vencido no se muestra
    items.push({ tipo: "entrega", cuando: new Date(t), dato: e });
  }
  for (const p of parciales) {
    const f = fechaLocal(p.fecha);
    if (Number.isNaN(f.getTime()) || diasHasta(f) < 0) continue;
    items.push({ tipo: "parcial", cuando: f, dato: p });
  }
  items.sort((a, b) => a.cuando - b.cuando);

  const s = tarjetaPanel("plazos", "calendario", "Entregas y parciales", items.length ? String(items.length) : "");
  if (items.length === 0) {
    s.append(vacioPanel("Nada pendiente a la vista."));
    return s;
  }
  const ul = el("ul", "plazos");
  for (const item of items) ul.append(plazo(item));
  s.append(ul);
  return s;
}

function plazo({ tipo, cuando, dato }) {
  const dias = diasHasta(cuando);
  const li = el("li", "plazo " + claseUrgencia(dias));
  const fecha = el("div", "plazo-fecha");
  fecha.setAttribute("aria-hidden", "true");
  fecha.append(el("span", "plazo-dia", String(cuando.getDate())), el("span", "plazo-mes", MESES[cuando.getMonth()]));

  const cuerpo = el("div", "plazo-cuerpo");
  cuerpo.append(el("span", "solo-lector", capitalizar(fechaLarga(cuando)) + ". "));
  const meta = el("p", "plazo-meta");
  const pie = el("div", "plazo-pie");
  pie.append(el("span", "plazo-cuanto", textoPlazo(dias)));
  if (tipo === "entrega") {
    cuerpo.append(el("p", "plazo-titulo", comoTexto(dato.titulo)));
    meta.append(chipMateria(dato.materia), document.createTextNode("Entrega · " + horaCorta(cuando)));
    const url = dato.url;
    if (typeof url === "string" && url.startsWith(PREFIJO_CANVAS)) {
      const a = el("a", "plazo-enlace");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.setAttribute("aria-label", "Abrir en Canvas: " + comoTexto(dato.titulo));
      a.append(document.createTextNode("Abrir en Canvas"), icono("enlace"));
      pie.append(a);
    }
  } else {
    cuerpo.append(el("p", "plazo-titulo", "Parcial"));
    meta.append(chipMateria(dato.materia),
      document.createTextNode(comoTexto(dato.hora) ? "Examen · " + comoTexto(dato.hora) : "Examen"));
  }
  cuerpo.append(meta, pie);
  li.append(fecha, cuerpo);
  return li;
}

function seccionSemana(dias) {
  const s = tarjetaPanel("semana", "calendario", "Esta semana", "");
  for (const dia of dias) {
    const clave = comoTexto(dia.fecha);
    const detalle = el("details", "dia");
    detalle.open = diasAbiertos.has(clave);
    detalle.addEventListener("toggle", () => {
      if (detalle.open) diasAbiertos.add(clave);
      else diasAbiertos.delete(clave);
    });
    const n = comoLista(dia.estudio).length;
    const meta = n === 0 ? (comoTexto(dia.clases) ? "solo clases" : "día libre") : n === 1 ? "1 bloque" : `${n} bloques`;
    const resumen = el("summary", "dia-resumen");
    resumen.append(el("span", "dia-nombre", capitalizar(fechaLarga(fechaLocal(clave)))), el("span", "dia-meta", meta),
      icono("abajo"));
    detalle.append(resumen, contenidoDia(dia, "Sin clases."));
    s.append(detalle);
  }
  return s;
}

function cuandoNovedad(ms) {
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const dias = diasHasta(d);
  if (dias === 0) return "hoy, " + horaCorta(d);
  if (dias === -1) return "ayer, " + horaCorta(d);
  return haceCuanto(ms);
}

function seccionNovedades(novedades) {
  const s = tarjetaPanel("novedades", "bandeja", "Novedades de Canvas", novedades.length ? String(novedades.length) : "");
  if (novedades.length === 0) {
    s.append(vacioPanel("Sin novedades esta semana."));
    return s;
  }
  const ul = el("ul", "novedades");
  for (const n of novedades) {
    const esTarea = n.tipo === "tarea";
    const li = el("li", "novedad");
    const marca = el("span", "novedad-icono");
    marca.append(icono(esTarea ? "tarea" : "archivo"));
    const cuerpo = el("div", "novedad-cuerpo");
    const meta = el("p", "plazo-meta");
    meta.append(chipMateria(n.materia),
      document.createTextNode((esTarea ? "Tarea" : "Archivo") + " · " + cuandoNovedad(Date.parse(n.fecha))));
    cuerpo.append(el("p", "novedad-titulo", comoTexto(n.titulo)), meta);
    li.append(marca, cuerpo);
    ul.append(li);
  }
  s.append(ul);
  return s;
}

function seccionProyectos(proyectos) {
  const s = tarjetaPanel("proyectos", "carpeta", "Proyectos", String(proyectos.length));
  const ul = el("ul", "proyectos");
  for (const p of proyectos) {
    const li = el("li", "proyecto");
    li.append(el("p", "proyecto-nombre", comoTexto(p.nombre)));
    if (comoTexto(p.estado)) li.append(el("p", "proyecto-estado", comoTexto(p.estado)));
    if (comoTexto(p.siguiente)) li.append(el("p", "proyecto-siguiente", "Siguiente: " + comoTexto(p.siguiente)));
    ul.append(li);
  }
  s.append(ul);
  return s;
}

function piePanel(datos, sinConexion, actualizando) {
  const pie = el("footer", "pie-panel");
  const generado = Date.parse(datos.generado);
  const linea = el("p", "pie-linea");
  linea.append(icono(sinConexion ? "sin-red" : "reloj"), document.createTextNode(
    (Number.isNaN(generado) ? "Sin fecha de actualización" : "Actualizado " + haceCuanto(generado)) +
    (actualizando ? " · comprobando…" : "")
  ));
  pie.append(linea);
  if (!Number.isNaN(generado) && Date.now() - generado > HORAS_PANEL_ANTIGUO * 3600000) {
    const d = new Date(generado);
    pie.append(avisoPanel("alerta",
      `Tu portátil no manda datos desde el ${DIAS_SEMANA[d.getDay()]} ${d.getDate()} a las ${horaCorta(d)}.`));
  }
  for (const b of comoLista(datos.banco)) {
    if (Number.isInteger(b.quedan) && b.quedan < MIN_EJERCICIOS_BANCO) {
      pie.append(avisoPanel("libro", `Quedan pocos ejercicios de ${comoTexto(b.materia)} (${b.quedan}).`));
    }
  }
  return pie;
}

ui.tabAvisos.addEventListener("click", () => cambiarVista("avisos"));
ui.tabPanel.addEventListener("click", () => cambiarVista("panel"));
// Pestañas accesibles: flechas, Inicio y Fin
ui.pestanas.addEventListener("keydown", (e) => {
  const destino = { ArrowLeft: null, ArrowRight: null, Home: "avisos", End: "panel" };
  if (!(e.key in destino)) return;
  e.preventDefault();
  const nueva = destino[e.key] || (vista === "avisos" ? "panel" : "avisos");
  cambiarVista(nueva);
  (nueva === "panel" ? ui.tabPanel : ui.tabAvisos).focus();
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

// ---------- Escribir como hablas ----------
// interpretar.js (cargado antes que este archivo) saca la fecha y la hora del texto de la barra.
// Se enseña antes de guardar; con ✕ el aviso se guarda tal cual, hasta vaciar la barra.

let interpretacionDescartada = false;

function interpretarBarra(texto) {
  if (interpretacionDescartada || typeof interpretarAviso !== "function") return null;
  return interpretarAviso(texto, new Date());
}

function actualizarVistaPrevia() {
  const texto = ui.texto.value.trim();
  if (!texto) interpretacionDescartada = false;
  const r = texto ? interpretarBarra(texto) : null;
  const info = r && infoVence(r.vence, r.hora);
  mostrar(ui.vistaPrevia, Boolean(info));
  ui.app.classList.toggle("con-vista-previa", Boolean(info));
  if (!info) return;
  ui.vistaPreviaChip.className = "chip " + info.clase;
  ui.vistaPreviaChip.textContent = info.texto;
  ui.vistaPreviaTexto.textContent = r.texto;
  ui.vistaPreviaTexto.title = "Se guardará como: " + r.texto;
}

// mousedown sin efecto: así tocar ✕ no le quita el foco a la barra (ni cierra el teclado)
ui.vistaPreviaQuitar.addEventListener("mousedown", (e) => e.preventDefault());
ui.vistaPreviaQuitar.addEventListener("click", () => {
  interpretacionDescartada = true;
  actualizarVistaPrevia();
  ui.texto.focus();
});

ui.formNuevo.addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = ui.texto.value.trim();
  if (!texto) return;
  // Se vuelve a interpretar al guardar: «a las 6» depende de la hora que sea ahora
  const r = interpretarBarra(texto);
  const fila = r ? { texto: r.texto, vence: r.vence, hora: r.hora } : { texto };
  ui.texto.value = "";
  actualizarVistaPrevia();
  const { error } = await sb.from("avisos").insert(fila);
  if (error) {
    estado("No se pudo agregar: " + error.message);
    ui.texto.value = texto;
    actualizarVistaPrevia();
    return;
  }
  sessionStorage.removeItem("borradorCompartido");
  cargar();
});

ui.texto.addEventListener("input", () => {
  actualizarVistaPrevia();
  // Si el usuario retoca un texto compartido, mantener el borrador al día
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
  borrarPanelLocal(); // la copia del panel y los «Hecho» no se quedan en el dispositivo
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
// El panel pesa más: se relee al volver a la app o a internet, no cada 2 min (para eso está realtime)
function refrescarPanel() {
  if (sb && vistaActual() === "app") cargarPanel();
}
window.addEventListener("focus", refrescar);
window.addEventListener("online", () => {
  refrescar();
  refrescarPanel();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refrescar();
    refrescarPanel();
  }
});
window.addEventListener("pageshow", (e) => {
  if (e.persisted) {
    refrescar();
    refrescarPanel();
  }
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
