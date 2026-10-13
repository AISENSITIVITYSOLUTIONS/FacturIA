const RFC_RE = /^([A-Z&Ñ]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{3})$/;
const ZIP_RE = /^\d{5}$/;
const GENERIC_RFC = new Set(["XAXX010101000", "XEXX010101000"]);

export function assertRequired(value, field) {
  if (value === undefined || value === null || value === "") {
    throw httpError(400, `Falta el campo obligatorio: ${field}`);
  }
}

export function assertRfc(value, field = "tax_id") {
  assertRequired(value, field);
  if (!RFC_RE.test(String(value).toUpperCase())) {
    throw httpError(400, `RFC invalido en ${field}`);
  }
}

export function assertZip(value, field = "zip") {
  assertRequired(value, field);
  if (!ZIP_RE.test(String(value))) {
    throw httpError(400, `Codigo postal invalido en ${field}`);
  }
}

export function validateCustomer(customer) {
  assertRequired(customer?.legal_name, "customer.legal_name");
  assertRfc(customer?.tax_id, "customer.tax_id");
  assertRequired(customer?.tax_system, "customer.tax_system");
  assertZip(customer?.address?.zip || customer?.zip, "customer.zip");
  const taxId = String(customer.tax_id).trim().toUpperCase();
  const isGenericRfc = GENERIC_RFC.has(taxId);
  return {
    legal_name: isGenericRfc ? "PUBLICO EN GENERAL" : String(customer.legal_name).trim().toUpperCase(),
    tax_id: taxId,
    tax_system: isGenericRfc ? "616" : String(customer.tax_system).trim(),
    email: customer.email ? String(customer.email).trim().toLowerCase() : "",
    phone: customer.phone ? String(customer.phone).trim() : "",
    address: {
      zip: String(customer.address?.zip || customer.zip).trim()
    }
  };
}

export function validateInvoiceDraft(payload) {
  const customer = validateCustomer(payload.customer || {});
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw httpError(400, "La factura necesita al menos un concepto");
  }

  const items = payload.items.map((item, index) => {
    assertRequired(item.description, `items[${index}].description`);
    assertRequired(item.product_key, `items[${index}].product_key`);
    assertRequired(item.unit_key, `items[${index}].unit_key`);
    const quantity = Number(item.quantity || 1);
    const price = Number(item.price);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw httpError(400, `Cantidad invalida en concepto ${index + 1}`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw httpError(400, `Precio invalido en concepto ${index + 1}`);
    }

    return {
      quantity,
      product: {
        description: String(item.description).trim(),
        product_key: String(item.product_key).trim(),
        price,
        tax_included: false,
        taxability: "02",
        taxes: [
          {
            type: "IVA",
            rate: Number(item.tax_rate ?? 0.16)
          }
        ],
        unit_key: String(item.unit_key).trim(),
        unit_name: item.unit_name || "Unidad"
      }
    };
  });

  const isGenericRfc = GENERIC_RFC.has(customer.tax_id);

  return {
    customer,
    items,
    use: isGenericRfc ? "S01" : payload.use || "G03",
    payment_form: payload.payment_form || "03",
    payment_method: payload.payment_method || "PUE",
    conditions: payload.conditions || "",
    external_id: payload.external_id || crypto.randomUUID()
  };
}

export function httpError(status, message, details = undefined) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

export function sendError(res, error) {
  const status = error.status || 500;
  res.status(status).json({
    ok: false,
    error: error.message || "Error interno",
    details: error.details || null
  });
}
