# Esquema de Google Sheets

Crear un spreadsheet llamado:

`FacturIA - Z E-Scooters Mexico`

Compartirlo con el correo `client_email` de la cuenta de servicio de Google Cloud.

## Pestañas requeridas

### Clientes

| Campo | Descripcion |
| --- | --- |
| id | UUID interno |
| created_at | Fecha ISO |
| legal_name | Razon social del receptor |
| tax_id | RFC |
| tax_system | Regimen fiscal |
| zip | Codigo postal fiscal |
| email | Correo para envio |
| phone | Telefono o WhatsApp |
| default_use | Uso CFDI frecuente |
| notes | Observaciones |

### Conceptos

| Campo | Descripcion |
| --- | --- |
| id | UUID |
| sku | Clave interna |
| description | Descripcion comercial |
| product_key | Clave SAT producto/servicio |
| unit_key | Clave unidad SAT |
| unit_name | Nombre de unidad |
| unit_price | Precio base |
| tax_rate | IVA |
| active | SI/NO |

### Facturas

Guarda el historial operativo: ID local, estatus, RFC cliente, Facturapi ID, UUID, subtotal, IVA, total, links XML/PDF y error si existiera.

### Pagos

Preparada para complementos de pago cuando se use `PPD`.

### Configuracion

Llaves operativas no sensibles: serie, folio interno, textos PDF, email de copia, telefono.

### Auditoria

Bitacora de acciones relevantes.

## Conceptos iniciales sugeridos

| SKU | Concepto | Clave SAT tentativa | Unidad |
| --- | --- | --- | --- |
| ZSC-VENTA-EV | Venta de vehiculo electrico personal | 25101900 | H87 |
| ZSC-REFACCION | Refacciones para vehiculo electrico personal | 25174000 | H87 |
| ZSC-SERVICIO | Servicio tecnico y mantenimiento | 78181500 | E48 |

Las claves deben validarse con el contador antes de produccion.
