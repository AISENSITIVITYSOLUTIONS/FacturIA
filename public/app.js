const api = (path, options = {}) => fetch(`/api${path}`, {
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...(options.headers || {})
  }
}).then(async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const detail = payload.details?.message || payload.details?.errors?.[0]?.message;
    const message = detail || payload.error || "Operacion rechazada";
    if (/api key|llave|key/i.test(message)) {
      throw new Error("La llave secreta de Facturapi guardada en Firebase no es valida. Reemplaza FACTURAPI_SECRET_KEY con una Secret Key de Facturapi.");
    }
    throw new Error(message);
  }
  return payload;
});

const money = new Intl.NumberFormat("es-MX", {
  style: "currency",
  currency: "MXN"
});

const form = document.querySelector("#invoice-form");
const statusEl = document.querySelector("#form-status");
let mode = "stamp";

function formData() {
  const data = Object.fromEntries(new FormData(form));
  return {
    customer: {
      legal_name: data.legal_name,
      tax_id: String(data.tax_id || "").toUpperCase(),
      tax_system: data.tax_system,
      email: data.email,
      address: { zip: data.zip }
    },
    use: data.use,
    payment_form: data.payment_form,
    payment_method: data.payment_method,
    conditions: data.conditions,
    items: [{
      description: data.description,
      product_key: data.product_key,
      unit_key: data.unit_key,
      unit_name: "Pieza",
      quantity: Number(data.quantity || 1),
      price: Number(data.price || 0),
      tax_rate: Number(data.tax_rate || 0.16)
    }]
  };
}

function updatePreview() {
  const data = formData();
  const item = data.items[0];
  const subtotal = item.quantity * item.price;
  const tax = subtotal * item.tax_rate;
  const total = subtotal + tax;
  document.querySelector("#preview-subtotal").textContent = money.format(subtotal);
  document.querySelector("#preview-tax").textContent = money.format(tax);
  document.querySelector("#preview-total").textContent = money.format(total);
}

async function loadDashboard() {
  const countEl = document.querySelector("#metric-count");
  const totalEl = document.querySelector("#metric-total");
  const remainingEl = document.querySelector("#metric-remaining");
  if (!countEl || !totalEl || !remainingEl) return;

  try {
    const { data } = await api("/dashboard");
    countEl.textContent = data.count ?? 0;
    totalEl.textContent = money.format(data.total ?? 0);
    remainingEl.textContent = data.remainingCapacity ?? 100;
  } catch {
    countEl.textContent = "-";
    totalEl.textContent = "Sin conexion";
  }
}

async function loadCustomers() {
  const list = document.querySelector("#customers-list");
  try {
    const { data } = await api("/customers");
    if (!data.length) {
      list.textContent = "Aun no hay clientes registrados.";
      return;
    }
    list.innerHTML = data.slice(-8).reverse().map((customer) => `
      <div class="customer-row">
        <strong>${customer.legal_name}</strong>
        <span>${customer.tax_id} · Regimen ${customer.tax_system} · CP ${customer.zip}</span>
      </div>
    `).join("");
  } catch {
    list.textContent = "Conecta Google Sheets para cargar clientes.";
  }
}

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach((entry) => entry.classList.remove("active"));
    button.classList.add("active");
  });
});

const rfcInput = form.elements.tax_id;
rfcInput.addEventListener("input", () => {
  const cursor = rfcInput.selectionStart;
  rfcInput.value = rfcInput.value.toUpperCase().replace(/\s/g, "");
  rfcInput.setSelectionRange(cursor, cursor);
  if (["XAXX010101000", "XEXX010101000"].includes(rfcInput.value)) {
    form.elements.tax_system.value = "616";
    form.elements.use.value = "S01";
  }
});

form.addEventListener("input", updatePreview);
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = mode === "stamp" ? "Timbrando CFDI..." : "Creando borrador...";
  try {
    const endpoint = mode === "stamp" ? "/invoices/stamp" : "/invoices/draft";
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(formData())
    });
    const invoice = result.data.invoice;
    statusEl.textContent = invoice.uuid
      ? `CFDI timbrado. UUID: ${invoice.uuid}`
      : "Borrador creado correctamente.";
    await Promise.allSettled([loadDashboard(), loadCustomers()]);
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

document.querySelector("#refresh-customers").addEventListener("click", loadCustomers);

updatePreview();
loadDashboard();
loadCustomers();
