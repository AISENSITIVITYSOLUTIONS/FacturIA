# Puesta en producción de FacturAI

Pasos únicos para activar el acceso con Google, el candado contra timbrados duplicados y el registro en Google Sheets.

## 1. Acceso con Google (Firebase Authentication)

1. Abrir https://console.firebase.google.com/project/facturia-zscooters/authentication
2. **Comenzar** → pestaña **Método de acceso** → **Google** → **Habilitar**.
3. Elegir el correo de asistencia y **Guardar**.

Los dominios `facturia-zscooters.web.app` y `facturia-zscooters.firebaseapp.com` ya vienen autorizados.

## 2. Base de datos Firestore (candado de timbrado)

1. Abrir https://console.firebase.google.com/project/facturia-zscooters/firestore
2. **Crear base de datos** → modo **producción** → ubicación `nam5 (United States)`.

Solo la función del servidor escribe en ella; las reglas de producción bloquean cualquier acceso desde el navegador.

## 3. Google Sheets

1. Crear una hoja vacía en Google Drive, por ejemplo «FacturAI · Z E-Scooters».
2. Copiar su ID desde la URL: `https://docs.google.com/spreadsheets/d/<ID>/edit`.
3. **Compartir** la hoja como **Editor** con la cuenta de servicio de la función:
   `150962657236-compute@developer.gserviceaccount.com`
4. Habilitar la API de Google Sheets:
   https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=facturia-zscooters

Al primer uso, la función crea las pestañas Clientes, Conceptos, Facturas, Pagos, Configuracion y Auditoria con sus encabezados, y siembra tres conceptos base en el catálogo.

No hace falta descargar llaves JSON. Si el secreto `GOOGLE_SERVICE_ACCOUNT_JSON` contiene una llave válida, se usa; si no, se usa la cuenta de servicio de la función.

## 4. Secretos

```powershell
firebase functions:secrets:set FACTURAI_ALLOWED_EMAILS
firebase functions:secrets:set GOOGLE_SHEET_ID
```

- `FACTURAI_ALLOWED_EMAILS`: correos autorizados separados por comas. También acepta dominios completos con arroba inicial, por ejemplo `@zescootersmx.com`.
- `GOOGLE_SHEET_ID`: el ID copiado en el paso 3.

El secreto `FACTURAI_ACCESS_CODE` ya no se usa. Puede borrarse con `firebase functions:secrets:destroy FACTURAI_ACCESS_CODE`.

## 5. Publicar

```powershell
git checkout main
git pull
cd functions
npm install
cd ..
firebase deploy --only hosting,functions
```

Verificar en https://facturia-zscooters.web.app/api/health que `version` sea `2026-10-13.3`.

## Cómo funciona el candado de timbrado

El navegador asigna un identificador a cada factura en captura y lo conserva en todos los reintentos. Antes de llamar a Facturapi, el servidor reserva ese identificador en Firestore:

- si ya se timbró, devuelve el mismo CFDI sin timbrar otro;
- si hay un intento en curso, responde «ya se está timbrando»;
- si el intento anterior falló, permite reintentar.

«Nueva factura» genera un identificador nuevo.
