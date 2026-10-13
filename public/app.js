const api = (path, options = {}) => fetch(`/api${path}`, {
  ...options,
  headers: {
    "Content-Type": "application/json",
    ...(options.headers || {})
  }
}).then(async (response) => {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Operacion rechazada");
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
      tax_id: data.tax_id,
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
  try {
    const { data } = await api("/dashboard");
    document.querySelector("#metric-count").textContent = data.count ?? 0;
    document.querySelector("#metric-total").textContent = money.format(data.total ?? 0);
    document.querySelector("#metric-remaining").textContent = data.remainingCapacity ?? 100;
  } catch {
    document.querySelector("#metric-count").textContent = "-";
    document.querySelector("#metric-total").textContent = "Sin conexion";
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

document.querySelector("#refresh-dashboard").addEventListener("click", loadDashboard);
document.querySelector("#refresh-customers").addEventListener("click", loadCustomers);

updatePreview();
loadDashboard();
loadCustomers();
