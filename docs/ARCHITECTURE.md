# Arquitectura FacturIA

## Objetivo

Resolver la facturacion cotidiana de Z E-Scooters Mexico con una web app ligera, ejecutiva y de baja friccion. La meta inicial es operar alrededor de 100 facturas al mes sin montar una base de datos pesada.

## Componentes

| Capa | Tecnologia | Funcion |
| --- | --- | --- |
| Interfaz | HTML/CSS/JS en Firebase Hosting | Captura rapida de clientes, conceptos y facturas |
| API | Firebase Functions Node.js 20 | Validacion, seguridad, timbrado, auditoria |
| Fiscal | Facturapi | CFDI 4.0, PDF, XML, email, cancelaciones |
| Datos operativos | Google Sheets | Clientes, conceptos, historial, pagos, auditoria |
| Secretos | Firebase Functions Secrets | API key, service account, Sheet ID |

## Por que Google Sheets

Para 100 facturas al mes, Sheets es suficiente si se usa como registro operativo y no como motor transaccional complejo. Permite visibilidad inmediata para administracion y contador, reduce costos y evita sobredimensionar la solucion.

## Limites sanos

- Hasta 100 facturas/mes: recomendado.
- 300-500 facturas/mes: viable con optimizacion.
- Mas de 1,000 facturas/mes: migrar a Firestore, PostgreSQL o base transaccional.

## Seguridad

- No guardar CSD, llaves privadas, contrasenas ni API keys en Google Sheets.
- Usar Firebase Secrets.
- Mantener el repositorio privado.
- Activar roles de usuario antes de produccion.
- Registrar auditoria de timbrado, cancelacion y envio.

## Flujo operativo

1. Usuario captura o selecciona cliente.
2. Usuario captura concepto y condiciones fiscales.
3. API valida RFC, CP y campos CFDI obligatorios.
4. API envia payload a Facturapi.
5. Facturapi timbra y genera XML/PDF.
6. API registra resultado en Sheets.
7. Facturapi envia correo si existe email del cliente.
8. Dashboard actualiza conteo mensual y monto facturado.
