// FacturAI — interfaz de facturación CFDI 4.0 de Z E-Scooters México.
// Toda operación fiscal pasa por /api (Firebase Functions); la llave de
// Facturapi vive como secreto en el servidor y nunca llega al navegador.

import { initAuth, signIn, signOut, idToken } from "/auth.js?v=5";

const GENERIC_RFC = new Set(["XAXX010101000", "XEXX010101000"]);
const RFC_RE = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const EMISOR_ZIP = "11800";
const IVA = 0.16;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const dateFmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

let lastInvoice = null;
// Identificador fijo de la factura en captura: se conserva en todos los
// reintentos para que el servidor nunca timbre dos veces la misma venta.
let captureId = crypto.randomUUID();
let customersCache = [];

/* ------------------------------------------------------------------ API */

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function api(path, { method = "GET", body, raw = false } = {}) {
  const token = await idToken();
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401) {
    const payload = await response.json().catch(() => ({}));
    showGate(payload.error || "Tu sesión expiró. Vuelve a entrar.");
    throw new ApiError("Acceso requerido", 401);
  }
  if (raw && response.ok) return response;

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new ApiError(friendlyError(payload, response.status), response.status);
  }
  return payload;
}

function friendlyError(payload, status) {
  const detail = payload?.details?.message
    || payload?.details?.errors?.map((e) => e.message).join(" · ")
    || payload?.error;
  const message = String(detail || "La operación fue rechazada.");
  if (/missing secret: facturapi/i.test(message)) {
    return "Falta configurar la llave secreta de Facturapi en Firebase (FACTURAPI_SECRET_KEY).";
  }
  if (/api ?key|invalid key|clave de api/i.test(message) || (status === 401 && /facturapi/i.test(message))) {
    return "Facturapi rechazó la llave secreta. Revisa FACTURAPI_SECRET_KEY en Firebase.";
  }
  if (/missing secret: google|sheets/i.test(message)) {
    return "Google Sheets aún no está conectado; esta sección se activará al configurarlo.";
  }
  return message;
}

/* --------------------------------------------------------------- Acceso */

const googleBtn = $("#btn-google");
const googleLabel = $("#btn-google-label");

function setGateBusy(text) {
  googleBtn.disabled = true;
  googleLabel.textContent = text;
}

function setGateReady() {
  googleBtn.disabled = false;
  googleLabel.textContent = "Entrar con Google";
}

function showGate(message = "", { switchAccount = false } = {}) {
  $("#gate").hidden = false;
  $("#gate-error").textContent = message;
  $("#btn-switch").hidden = !switchAccount;
  setGateReady();
}

async function openSession(user) {
  setGateBusy("Verificando acceso…");
  try {
    const { data } = await api("/session");
    $("#gate").hidden = true;
    $("#session-user").textContent = data.user?.email || user.email || "";
    paintConnection(data.facturapi);
    boot();
  } catch (error) {
    if (error.status === 401) return;
    showGate(error.message, { switchAccount: error.status === 403 });
  }
}

googleBtn.addEventListener("click", async () => {
  $("#gate-error").textContent = "";
  setGateBusy("Abriendo Google…");
  try {
    await signIn();
  } catch (error) {
    showGate(error.message);
    return;
  }
  setGateReady();
});

$("#btn-switch").addEventListener("click", async () => {
  await signOut();
  $("#gate-error").textContent = "";
  googleBtn.click();
});

$("#logout").addEventListener("click", async () => {
  await signOut();
  location.hash = "#facturar";
});

/* ---------------------------------------------------------- Navegación */

function route() {
  const name = (location.hash || "#facturar").slice(1);
  const views = ["facturar", "clientes", "historial", "exito"];
  const target = views.includes(name) ? name : "facturar";
  $$(".view").forEach((v) => { v.hidden = v.dataset.view !== target; });
  $$("[data-view-link]").forEach((a) => {
    if (a.dataset.viewLink === (target === "exito" ? "facturar" : target)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (target === "clientes") loadCustomers();
  if (target === "historial") loadInvoices();
  if (target === "exito" && !lastInvoice) location.hash = "#facturar";
  window.scrollTo({ top: 0 });
}
window.addEventListener("hashchange", route);

/* ---------------------------------------------------- Estado de conexión */

function paintConnection(status) {
  const el = $("#conn");
  const title = $("#conn-title");
  const detail = $("#conn-detail");
  if (!status) return;
  if (status.connected && status.mode === "live") {
    el.dataset.state = "ok";
    title.textContent = "Facturapi conectado";
    detail.textContent = "Producción · los CFDI tienen validez fiscal.";
  } else if (status.connected && status.mode === "test") {
    el.dataset.state = "test";
    title.textContent = "Facturapi en modo prueba";
    detail.textContent = "Los CFDI de prueba no tienen validez ante el SAT.";
  } else {
    el.dataset.state = "error";
    title.textContent = "Facturapi sin conectar";
    detail.textContent = {
      missing: "Falta la llave secreta en Firebase.",
      invalid_format: "La llave guardada no tiene formato sk_test_ o sk_live_.",
      rejected: "Facturapi rechazó la llave guardada.",
      network: "No se pudo contactar a Facturapi."
    }[status.reason] || "Revisa la configuración del servidor.";
  }
}

async function loadMeter() {
  try {
    const { data } = await api("/dashboard");
    const count = Number(data.count || 0);
    const target = Number(data.invoiceTarget || 100);
    $("#meter-label").textContent = `${count} / ${target}`;
    $("#meter-fill").style.width = `${Math.min(100, (count / target) * 100)}%`;
  } catch {
    $("#meter-label").textContent = `— / 100`;
  }
}

/* ------------------------------------------------------------ Conceptos */

const form = $("#invoice-form");
const linesEl = $("#lines");

function addLine(values = {}) {
  const node = $("#line-template").content.firstElementChild.cloneNode(true);
  const uid = Math.random().toString(36).slice(2, 8);
  $$("[data-k]", node).forEach((input) => {
    input.id = `${input.dataset.k}-${uid}`;
    input.closest("label")?.setAttribute("for", input.id);
    if (values[input.dataset.k] !== undefined && values[input.dataset.k] !== "") input.value = values[input.dataset.k];
  });
  if (values.product_key === undefined && linesEl.children.length === 0) {
    // Valores iniciales que ya usaba la versión anterior.
    $("[data-k='product_key']", node).value = "25101900";
    $("[data-k='description']", node).value = "Venta de vehículo eléctrico personal";
  }
  $("[data-remove]", node).addEventListener("click", () => { node.remove(); refresh(); });
  linesEl.append(node);
  refresh();
  return node;
}

function readLines() {
  return $$(".line", linesEl).map((node) => {
    const get = (k) => $(`[data-k='${k}']`, node).value;
    const unit = $("[data-k='unit_key']", node);
    return {
      node,
      description: get("description").trim(),
      product_key: get("product_key").trim(),
      unit_key: unit.value,
      unit_name: unit.selectedOptions[0]?.textContent.split("·")[1]?.trim() || "Pieza",
      quantity: Number(get("quantity") || 0),
      price: Number(get("price") || 0),
      tax_rate: IVA
    };
  });
}

$("#add-line").addEventListener("click", () => {
  const node = addLine({ product_key: "" });
  $("[data-k='description']", node).focus();
});

async function loadCatalog() {
  try {
    const { data } = await api("/products");
    const active = data.filter((p) => String(p.active || "SI").toUpperCase() !== "NO").slice(0, 12);
    if (!active.length) return;
    const chips = $("#catalog-chips");
    chips.replaceChildren(...active.map((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = p.description;
      b.addEventListener("click", () => {
        const empty = readLines().find((l) => !l.price && (!l.description || l.description === "Venta de vehículo eléctrico personal"));
        const values = { description: p.description, product_key: p.product_key, unit_key: p.unit_key || "H87", quantity: 1, price: p.unit_price };
        if (empty) {
          Object.entries(values).forEach(([k, v]) => { const i = $(`[data-k='${k}']`, empty.node); if (i && v !== undefined) i.value = v; });
          refresh();
        } else {
          addLine(values);
        }
      });
      return b;
    }));
    $("#catalog").hidden = false;
  } catch { /* catálogo opcional */ }
}

/* ------------------------------------------------------- Vista previa */

function readForm() {
  const f = form.elements;
  return {
    customer: {
      legal_name: f.legal_name.value.trim().toUpperCase(),
      tax_id: f.tax_id.value.trim().toUpperCase(),
      tax_system: f.tax_system.value,
      email: f.email.value.trim(),
      address: { zip: f.zip.value.trim() }
    },
    use: f.use.value,
    payment_form: f.payment_form.value,
    payment_method: form.querySelector("[name='payment_method']:checked")?.value || "PUE",
    conditions: f.conditions.value.trim()
  };
}

function refresh() {
  const data = readForm();
  const lines = readLines();
  linesEl.dataset.single = String(lines.length <= 1);

  let subtotal = 0;
  const pv = $("#pv-lines");
  pv.replaceChildren(...lines.map((l) => {
    const amount = l.quantity * l.price;
    subtotal += amount;
    $("[data-amount]", l.node).textContent = money.format(amount);
    const row = document.createElement("div");
    row.className = "pv-line";
    const left = document.createElement("div");
    const name = document.createElement("span");
    name.className = "ellipsis";
    name.textContent = l.description || "Concepto sin descripción";
    const meta = document.createElement("small");
    meta.textContent = `${l.quantity || 0} × ${money.format(l.price)}`;
    left.append(name, meta);
    const amt = document.createElement("span");
    amt.className = "mono";
    amt.textContent = money.format(amount);
    row.append(left, amt);
    return row;
  }));

  const tax = Math.round(subtotal * IVA * 100) / 100;
  $("#pv-subtotal").textContent = money.format(subtotal);
  $("#pv-tax").textContent = money.format(tax);
  $("#pv-total").textContent = money.format(subtotal + tax);
  $("#pv-name").textContent = data.customer.legal_name || "Razón social del receptor";
  $("#pv-rfc").textContent = data.customer.tax_id || "RFC pendiente";

  const rfcOk = RFC_RE.test(data.customer.tax_id);
  const zipOk = /^\d{5}$/.test(data.customer.address.zip);
  const receptorOk = rfcOk && zipOk && !!data.customer.legal_name && !!data.customer.tax_system;
  const linesOk = lines.length > 0 && subtotal > 0 && lines.every((l) => l.description && l.product_key && l.quantity > 0 && l.price >= 0);
  const ppdConflict = data.payment_method === "PPD" && data.payment_form !== "99";
  $("#ppd-notice").hidden = !ppdConflict;

  const checks = [
    [rfcOk, "RFC con estructura válida"],
    [receptorOk, "Receptor completo (razón social, régimen y CP)"],
    [linesOk, "Conceptos con clave SAT e importe"],
    [!ppdConflict, "Método y forma de pago compatibles"]
  ];
  $("#checks").replaceChildren(...checks.map(([ok, label]) => {
    const li = document.createElement("li");
    li.dataset.ok = String(ok);
    li.textContent = label;
    return li;
  }));

  const ready = checks.every(([ok]) => ok);
  const btn = $("#btn-stamp");
  if (!btn.dataset.busy) {
    btn.disabled = !ready;
    $("#stamp-label").textContent = ready ? `Timbrar CFDI · ${money.format(subtotal + tax)}` : "Completa los datos para timbrar";
  }
  $("#btn-draft").disabled = !(receptorOk && linesOk);
  return { ready, payload: { ...data, items: lines.map(({ node, ...l }) => l) } };
}

form.addEventListener("input", refresh);
form.addEventListener("change", refresh);

/* --------------------------------------------------- Ayudas de captura */

const f = form.elements;

f.tax_id.addEventListener("input", () => {
  const pos = f.tax_id.selectionStart;
  f.tax_id.value = f.tax_id.value.toUpperCase().replace(/\s/g, "");
  f.tax_id.setSelectionRange(pos, pos);
  if (GENERIC_RFC.has(f.tax_id.value)) applyPublicoGeneral(false);
});
f.zip.addEventListener("input", () => { f.zip.value = f.zip.value.replace(/\D/g, "").slice(0, 5); });

function applyPublicoGeneral(fillRfc = true) {
  if (fillRfc) f.tax_id.value = "XAXX010101000";
  f.legal_name.value = "PUBLICO EN GENERAL";
  f.tax_system.value = "616";
  f.use.value = "S01";
  // CFDI 4.0: para público en general, el domicilio fiscal del receptor es el lugar de expedición.
  f.zip.value = EMISOR_ZIP;
  refresh();
}
$("#btn-publico").addEventListener("click", () => applyPublicoGeneral(true));

$("#fix-ppd").addEventListener("click", () => { f.payment_form.value = "99"; refresh(); });

function fillCustomer(c) {
  f.legal_name.value = c.legal_name || "";
  f.tax_id.value = c.tax_id || "";
  f.tax_system.value = c.tax_system || "";
  f.zip.value = c.zip || "";
  f.email.value = c.email || "";
  if (c.default_use) f.use.value = c.default_use;
  location.hash = "#facturar";
  refresh();
  toast(`Receptor cargado: ${c.legal_name}`);
}

/* ------------------------------------------------------------ Emisión */

function setStatus(text, tone = "") {
  const el = $("#form-status");
  el.textContent = text;
  el.dataset.tone = tone;
}

async function emit(kind) {
  const { ready, payload } = refresh();
  if (kind === "stamp" && !ready) return;
  const btn = $("#btn-stamp");
  btn.dataset.busy = "1";
  btn.disabled = true;
  $("#btn-draft").disabled = true;
  setStatus(kind === "stamp" ? "Timbrando ante el SAT…" : "Guardando borrador…", "busy");

  try {
    const { data } = await api(kind === "stamp" ? "/invoices/stamp" : "/invoices/draft", {
      method: "POST",
      body: { ...payload, external_id: captureId }
    });
    setStatus("");
    showSuccess(data, kind, payload);
    loadMeter();
  } catch (error) {
    if (error.status !== 401) setStatus(error.message, "error");
  } finally {
    delete btn.dataset.busy;
    refresh();
  }
}

form.addEventListener("submit", (event) => { event.preventDefault(); emit("stamp"); });
$("#btn-draft").addEventListener("click", () => emit("draft"));

function showSuccess(data, kind, payload) {
  const inv = data.invoice || {};
  lastInvoice = { id: inv.id, email: payload.customer.email };
  const isDraft = kind === "draft";
  const total = inv.total ?? data.row?.total;

  $("#sx-kicker").textContent = isDraft ? "Guardado en Facturapi" : "Timbrado ante el SAT";
  $("#sx-title").textContent = isDraft ? "Borrador guardado" : "Factura emitida";
  const copy = $("#sx-copy");
  copy.replaceChildren();
  if (isDraft) {
    copy.textContent = "El borrador quedó en Facturapi. Podrás timbrarlo desde su panel cuando esté listo.";
  } else if (data.emailed && payload.customer.email) {
    copy.append("El comprobante ya tiene validez fiscal. Se envió PDF y XML a ");
    const s = document.createElement("strong");
    s.textContent = payload.customer.email;
    copy.append(s, ".");
  } else {
    copy.textContent = "El comprobante ya tiene validez fiscal. Descarga el PDF y el XML para entregarlos al cliente.";
  }

  $("#sx-warnings").replaceChildren(...(data.warnings || []).map((w) => {
    const n = document.createElement("div");
    n.className = "notice";
    n.textContent = w;
    return n;
  }));

  const series = inv.series || data.row?.series || "";
  const folio = inv.folio_number || data.row?.folio || "";
  $("#sx-folio").textContent = folio ? `Serie ${series} · Folio ${folio}` : (isDraft ? "Borrador" : "—");
  $("#sx-uuid").textContent = inv.uuid || (isDraft ? "Se asigna al timbrar" : "—");
  $("#sx-name").textContent = payload.customer.legal_name;
  $("#sx-rfc").textContent = payload.customer.tax_id;
  $("#sx-date").textContent = inv.date ? dateFmt.format(new Date(inv.date)) : dateFmt.format(new Date());
  $("#sx-pay").textContent = `${payload.payment_method} · ${payload.payment_form}`;
  $("#sx-use").textContent = payload.use;
  $("#sx-total").textContent = total !== undefined ? money.format(Number(total)) : "—";
  const badge = $("#sx-badge");
  badge.className = isDraft ? "badge badge-draft" : "badge badge-live";
  badge.lastChild.textContent = isDraft ? "Borrador" : "Vigente";

  $$("[data-download]").forEach((b) => { b.hidden = isDraft || !inv.id; });
  $("#btn-resend").hidden = isDraft || !inv.id;
  location.hash = "#exito";
  if (!isDraft) playStamp();
}

async function download(id, format) {
  try {
    const response = await api(`/invoices/${encodeURIComponent(id)}/${format}`, { raw: true });
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CFDI-${id}.${format}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (error) {
    if (error.status !== 401) toast(error.message);
  }
}

$$("[data-download]").forEach((b) => b.addEventListener("click", () => lastInvoice?.id && download(lastInvoice.id, b.dataset.download)));

$("#btn-resend").addEventListener("click", async () => {
  if (!lastInvoice?.id) return;
  const email = window.prompt("Correo del destinatario", lastInvoice.email || "");
  if (!email) return;
  try {
    await api(`/invoices/${encodeURIComponent(lastInvoice.id)}/email`, { method: "POST", body: { email } });
    toast(`Factura enviada a ${email}`);
  } catch (error) {
    if (error.status !== 401) toast(error.message);
  }
});

$("#btn-new").addEventListener("click", () => {
  form.reset();
  captureId = crypto.randomUUID();
  linesEl.replaceChildren();
  addLine();
  lastInvoice = null;
  location.hash = "#facturar";
  f.legal_name.focus();
});

/* ------------------------------------------------------------ Clientes */

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function cell(text, cls) {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  td.textContent = text ?? "";
  return td;
}

function emptyState(el, title, text) {
  const h = document.createElement("h2");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = text;
  el.replaceChildren(h, p);
  el.hidden = false;
}

function renderCustomers() {
  const q = $("#customer-search").value.trim().toUpperCase();
  const base = [{ legal_name: "PUBLICO EN GENERAL", tax_id: "XAXX010101000", tax_system: "616", zip: EMISOR_ZIP, default_use: "S01", note: "Ventas de mostrador sin RFC" }];
  const all = base.concat(customersCache.slice().reverse());
  const rows = all.filter((c) => !q || String(c.legal_name).toUpperCase().includes(q) || String(c.tax_id).includes(q));
  $("#customers-body").replaceChildren(...rows.map((c) => {
    const tr = document.createElement("tr");
    const who = document.createElement("td");
    who.innerHTML = `<div class="who"><span class="avatar" aria-hidden="true"></span><span><strong></strong><small></small></span></div>`;
    $(".avatar", who).textContent = initials(c.legal_name);
    $("strong", who).textContent = c.legal_name;
    $("small", who).textContent = c.note || c.email || "";
    const act = document.createElement("td");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Facturar";
    btn.addEventListener("click", () => fillCustomer(c));
    const wrap = document.createElement("div");
    wrap.className = "row-actions";
    wrap.append(btn);
    act.append(wrap);
    tr.append(who, cell(c.tax_id, "mono"), cell(c.tax_system), cell(c.zip, "mono"), cell(c.default_use, "mono"), act);
    return tr;
  }));
  const empty = $("#customers-empty");
  if (!customersCache.length) {
    emptyState(empty, "Aún no hay clientes frecuentes", "Cada receptor que factures se guarda aquí automáticamente con su RFC, régimen y código postal.");
  } else {
    empty.hidden = true;
  }
}

async function loadCustomers() {
  try {
    const { data } = await api("/customers");
    customersCache = data || [];
    renderCustomers();
  } catch (error) {
    if (error.status === 401) return;
    customersCache = [];
    renderCustomers();
    emptyState($("#customers-empty"), "Directorio no disponible", error.message);
  }
}
$("#customer-search").addEventListener("input", renderCustomers);
$("#refresh-customers").addEventListener("click", loadCustomers);

/* ----------------------------------------------------------- Historial */

const STATUS = { stamped: ["Timbrada", "pill-stamped"], draft: ["Borrador", "pill-draft"], cancelled: ["Cancelada", "pill-cancelled"] };

async function loadInvoices() {
  const body = $("#invoices-body");
  const empty = $("#invoices-empty");
  try {
    const { data } = await api("/invoices");
    const rows = (data || []).filter((r) => r.status !== "cancelled" || r.customer_name);
    body.replaceChildren(...rows.map((r) => {
      const tr = document.createElement("tr");
      const date = r.created_at ? dateFmt.format(new Date(r.created_at)) : "";
      const [label, cls] = STATUS[r.status] || [r.status, "pill-draft"];
      const st = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = `pill ${cls}`;
      pill.textContent = label;
      st.append(pill);
      const act = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "row-actions";
      if (r.facturapi_id && r.status === "stamped") {
        ["pdf", "xml"].forEach((fmt) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "btn btn-ghost btn-sm";
          b.textContent = fmt.toUpperCase();
          b.setAttribute("aria-label", `Descargar ${fmt.toUpperCase()} de ${r.customer_name}`);
          b.addEventListener("click", () => download(r.facturapi_id, fmt));
          wrap.append(b);
        });
      }
      act.append(wrap);
      const folio = r.folio ? `${r.series || ""} ${r.folio}`.trim() : "—";
      tr.append(cell(date, "mono"), cell(r.customer_name), cell(folio, "mono"), st, cell(r.total ? money.format(Number(r.total)) : "", "mono num"), act);
      return tr;
    }));
    if (!rows.length) emptyState(empty, "Sin facturas todavía", "Las facturas que emitas desde FacturAI aparecerán aquí con su PDF y XML.");
    else empty.hidden = true;
  } catch (error) {
    if (error.status === 401) return;
    body.replaceChildren();
    emptyState(empty, "Historial no disponible", error.message);
  }
}
$("#refresh-invoices").addEventListener("click", loadInvoices);

/* --------------------------------------------------------------- Toast */

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}

/* ------------------------------------------------- Portada con relieve */

// La placa se inclina hacia el puntero y un reflejo especular lo sigue.
// Se desactiva en pantallas táctiles y con "reducir movimiento".
(function tiltHero() {
  const plate = $(".hero-plate");
  if (!plate) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  if (reduce || !finePointer) return;
  const MAX = 6;
  let frame = 0;
  plate.addEventListener("pointermove", (event) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const r = plate.getBoundingClientRect();
      const x = (event.clientX - r.left) / r.width;
      const y = (event.clientY - r.top) / r.height;
      plate.classList.add("is-tracking");
      plate.style.setProperty("--ry", `${((x - 0.5) * 2 * MAX).toFixed(2)}deg`);
      plate.style.setProperty("--rx", `${((0.5 - y) * 2 * MAX * 0.6).toFixed(2)}deg`);
      plate.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      plate.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    });
  });
  plate.addEventListener("pointerleave", () => {
    cancelAnimationFrame(frame);
    plate.classList.remove("is-tracking");
    plate.style.setProperty("--rx", "0deg");
    plate.style.setProperty("--ry", "0deg");
    plate.style.setProperty("--mx", "70%");
    plate.style.setProperty("--my", "20%");
  });
})();

/* ------------------------------------------------------- Timbre 3D */

// El módulo WebGL se carga solo si el equipo lo soporta y no se pidió
// reducir movimiento; si falla, la interfaz sigue completa sin él.
const motionOK = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let coinModule = null;
let stampCoin = null;

async function loadCoin() {
  if (!motionOK) return null;
  if (!coinModule) {
    coinModule = import("/coin3d.js?v=4").catch(() => null);
  }
  const mod = await coinModule;
  return mod && mod.webglAvailable() ? mod : null;
}

async function mountHeroCoin() {
  const mod = await loadCoin();
  const host = $("#hero-coin");
  if (!mod || !host || host.childElementCount) return;
  try {
    await mod.mountCoin(host, { mode: "hero" });
    $("#hero").classList.add("has-3d");
  } catch { /* sin WebGL: portada estática */ }
}

async function playStamp() {
  const badge = $(".success-badge");
  stampCoin?.destroy();
  stampCoin = null;
  badge.classList.remove("has-3d");
  const mod = await loadCoin();
  if (!mod) return;
  try {
    stampCoin = await mod.mountCoin($("#stamp-coin"), { mode: "stamp" });
    badge.classList.add("has-3d");
  } catch { /* se queda la palomita */ }
}

/* ---------------------------------------------------------------- Boot */

let booted = false;
function boot() {
  if (booted) { route(); return; }
  booted = true;
  route();
  mountHeroCoin();
  loadMeter();
  loadCatalog();
  loadCustomers();
}

addLine();
refresh();

$("#gate").hidden = false;
setGateBusy("Verificando sesión…");
initAuth((user) => {
  if (user) {
    openSession(user);
  } else {
    $("#session-user").textContent = "";
    showGate();
  }
}).catch((error) => {
  console.error(error);
  showGate("No se pudo cargar el inicio de sesión. Revisa tu conexión y recarga la página.");
  googleBtn.disabled = true;
});
