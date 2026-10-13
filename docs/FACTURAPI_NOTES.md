# Integracion con Facturapi

Facturapi es una buena eleccion para este caso porque esta pensada para desarrolladores y cubre el ciclo fiscal que Z E-Scooters necesita: creacion de facturas CFDI, PDF, XML, envio por correo, cancelaciones y complementos de pago.

Referencia usada: la documentacion de Facturapi muestra el flujo de creacion de CFDI de ingreso con `customer`, `items`, `use`, `payment_form` y `payment_method`.

## Variables necesarias

Configurar en Firebase Functions:

```powershell
firebase functions:secrets:set FACTURAPI_SECRET_KEY --project facturia
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON --project facturia
firebase functions:secrets:set GOOGLE_SHEET_ID --project facturia
firebase functions:secrets:set FACTURAI_ACCESS_CODE --project facturia
```

`FACTURAI_ACCESS_CODE` es el codigo que el equipo de Z E-Scooters escribe al entrar a la app. Sin el, la API rechaza toda operacion (excepto `/api/health`). Usar una frase larga y compartirla solo con quien factura.

La llave de Facturapi debe iniciar con `sk_test_` (pruebas) o `sk_live_` (produccion). La barra lateral muestra en que modo esta conectada.

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
| `GET /api/session` | Valida el codigo de acceso y el estado de Facturapi |
| `GET /api/config` | Perfil fiscal emisor |
| `GET /api/dashboard` | Indicadores mensuales |
| `GET /api/customers` | Leer clientes |
| `POST /api/customers` | Crear cliente |
| `GET /api/products` | Leer conceptos |
| `POST /api/products` | Crear concepto |
| `POST /api/invoices/draft` | Crear borrador |
| `POST /api/invoices/stamp` | Timbrar CFDI |
| `GET /api/invoices` | Historial (desde Sheets) |
| `GET /api/invoices/:id/pdf` | Descargar PDF (proxy seguro) |
| `GET /api/invoices/:id/xml` | Descargar XML (proxy seguro) |
| `POST /api/invoices/:id/email` | Reenviar por correo |
| `POST /api/invoices/:id/cancel` | Cancelar CFDI |

Todas las rutas, salvo `/api/health`, exigen el encabezado `X-Access-Code`.

## Pendientes antes de produccion

- Confirmar claves SAT con contador.
- Probar con API key de sandbox.
- Probar cancelacion con motivo SAT.
- Definir si las ventas son siempre PUE o si habra PPD con complemento de pago.
- Configurar logo y plantilla PDF desde Facturapi.
