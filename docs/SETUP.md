# Setup operativo

## 1. Crear repo GitHub

Usar esta carpeta local:

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI"
gh repo create AISENSITIVITYSOLUTIONS/FacturIA --private --description "FacturIA - facturacion CFDI 4.0 agil para Z E-Scooters Mexico" --clone
```

Si el repo ya existe, clonar:

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI"
git clone https://github.com/AISENSITIVITYSOLUTIONS/FacturIA.git
```

Copiar esta base de codigo dentro del repo y subir:

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI\FacturIA"
git add .
git commit -m "Initial FacturIA MVP"
git push -u origin main
```

## 2. Crear Firebase

```powershell
firebase projects:create facturia --display-name "FacturIA"
firebase use facturia
copy .firebaserc.example .firebaserc
```

Si `facturia` no esta disponible, usar:

```powershell
firebase projects:create facturia-zscooters --display-name "FacturIA"
```

y cambiar `.firebaserc`.

## 3. Crear Google Sheet

Crear el spreadsheet `FacturIA - Z E-Scooters Mexico` con las pestanas de `docs/SHEETS_SCHEMA.md`.

## 4. Crear service account

En Google Cloud:

- Crear service account.
- Descargar JSON.
- Compartir el Google Sheet con el correo `client_email`.
- Guardar el JSON como secreto de Firebase, no en el repo.

## 5. Configurar secretos

```powershell
firebase functions:secrets:set FACTURAPI_SECRET_KEY --project facturia
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON --project facturia
firebase functions:secrets:set GOOGLE_SHEET_ID --project facturia
```

## 6. Instalar y desplegar

```powershell
cd functions
npm install
cd ..
firebase deploy --only hosting,functions --project facturia
```

## 7. Pruebas minimas

- Abrir `/api/health`.
- Abrir `/api/config`.
- Capturar cliente de prueba.
- Crear borrador.
- Timbrar en sandbox.
- Validar registro en Sheets.
- Validar PDF/XML.
