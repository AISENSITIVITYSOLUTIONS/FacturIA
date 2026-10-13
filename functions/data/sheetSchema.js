export const SHEETS = {
  customers: "Clientes",
  products: "Conceptos",
  invoices: "Facturas",
  payments: "Pagos",
  settings: "Configuracion",
  audit: "Auditoria"
};

export const HEADERS = {
  [SHEETS.customers]: [
    "id",
    "created_at",
    "legal_name",
    "tax_id",
    "tax_system",
    "zip",
    "email",
    "phone",
    "default_use",
    "notes"
  ],
  [SHEETS.products]: [
    "id",
    "created_at",
    "sku",
    "description",
    "product_key",
    "unit_key",
    "unit_name",
    "unit_price",
    "tax_rate",
    "active"
  ],
  [SHEETS.invoices]: [
    "id",
    "created_at",
    "status",
    "customer_tax_id",
    "customer_name",
    "facturapi_id",
    "uuid",
    "series",
    "folio",
    "subtotal",
    "tax",
    "total",
    "payment_form",
    "payment_method",
    "cfdi_use",
    "pdf_url",
    "xml_url",
    "error"
  ],
  [SHEETS.payments]: [
    "id",
    "created_at",
    "invoice_id",
    "amount",
    "payment_form",
    "payment_date",
    "facturapi_payment_id",
    "status",
    "notes"
  ],
  [SHEETS.settings]: [
    "key",
    "value",
    "description"
  ],
  [SHEETS.audit]: [
    "id",
    "created_at",
    "actor",
    "action",
    "resource",
    "payload"
  ]
};

export const DEFAULT_PRODUCTS = [
  {
    sku: "ZSC-VENTA-EV",
    description: "Venta de vehiculo electrico personal",
    product_key: "25101900",
    unit_key: "H87",
    unit_name: "Pieza",
    unit_price: 0,
    tax_rate: 0.16,
    active: "SI"
  },
  {
    sku: "ZSC-REFACCION",
    description: "Refacciones para vehiculo electrico personal",
    product_key: "25174000",
    unit_key: "H87",
    unit_name: "Pieza",
    unit_price: 0,
    tax_rate: 0.16,
    active: "SI"
  },
  {
    sku: "ZSC-SERVICIO",
    description: "Servicio tecnico y mantenimiento",
    product_key: "78181500",
    unit_key: "E48",
    unit_name: "Unidad de servicio",
    unit_price: 0,
    tax_rate: 0.16,
    active: "SI"
  }
];
