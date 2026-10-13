# Integracion con Facturapi

Facturapi es una buena eleccion para este caso porque esta pensada para desarrolladores y cubre el ciclo fiscal que Z E-Scooters necesita: creacion de facturas CFDI, PDF, XML, envio por correo, cancelaciones y complementos de pago.

Referencia usada: la documentacion de Facturapi muestra el flujo de creacion de CFDI de ingreso con `customer`, `items`, `use`, `payment_form` y `payment_method`.

## Variables necesarias

Configurar en Firebase Functions:

```powershell
firebase functions:secrets:set FACTURAPI_SECRET_KEY --project facturia
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON --project facturia
firebase functions:secrets:set GOOGLE_SHEET_ID --project facturia
```

## Datos del emisor

El emisor se configura en el panel de Facturapi con:

- RFC: `ZEM210611H42`
- Razon social: `Z E-SCOOTERS MEXICO`
- Regimen: `601`
- CP: `11800`

## Endpoints preparados

| Endpoint local | Funcion |
| --- | --- |
| `GET /api/health` | Estado de API |
| `GET /api/config` | Perfil fiscal emisor |
| `GET /api/dashboard` | Indicadores mensuales |
| `GET /api/customers` | Leer clientes |
| `POST /api/customers` | Crear cliente |
| `GET /api/products` | Leer conceptos |
| `POST /api/products` | Crear concepto |
| `POST /api/invoices/draft` | Crear borrador |
| `POST /api/invoices/stamp` | Timbrar CFDI |
| `POST /api/invoices/:id/cancel` | Cancelar CFDI |

## Pendientes antes de produccion

- Confirmar claves SAT con contador.
- Probar con API key de sandbox.
- Probar cancelacion con motivo SAT.
- Definir si las ventas son siempre PUE o si habra PPD con complemento de pago.
- Configurar logo y plantilla PDF desde Facturapi.
