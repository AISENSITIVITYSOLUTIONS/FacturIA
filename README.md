# FacturIA

Web app ejecutiva para acelerar la facturacion CFDI 4.0 de **Z E-SCOOTERS MEXICO, S.A. de C.V.** con una arquitectura ligera:

- Firebase Hosting para la interfaz.
- Firebase Functions para la API segura.
- Google Sheets como base operativa inicial.
- Facturapi como API fiscal para timbrado, PDF, email, cancelaciones y complementos de pago.

## Perfil fiscal base

Tomado de la CSF `ZEM210611H42`:

- RFC: `ZEM210611H42`
- Razon social: `Z E-SCOOTERS MEXICO`
- Regimen de capital: `SOCIEDAD ANONIMA DE CAPITAL VARIABLE`
- Regimen fiscal: `601 - General de Ley Personas Morales`
- Codigo postal fiscal: `11800`
- Domicilio: Av. Patriotismo 176, Escandon I Seccion, Miguel Hidalgo, Ciudad de Mexico.

## Crear repositorio GitHub

Si tienes GitHub CLI en Windows:

Carpeta local de trabajo:

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI"
gh repo create AISENSITIVITYSOLUTIONS/FacturIA --private --description "FacturIA - facturacion CFDI 4.0 agil para Z E-Scooters Mexico" --clone
```

Si el repositorio ya existe:

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI"
git clone https://github.com/AISENSITIVITYSOLUTIONS/FacturIA.git
```

## Crear proyecto Firebase

Firebase no acepta mayusculas en el ID del proyecto. Usa:

- Nombre visible: `FacturIA`
- Project ID sugerido: `facturia` o `facturia-zscooters`

```powershell
firebase projects:create facturia --display-name "FacturIA"
firebase use facturia
```

## Instalar y desplegar

```powershell
cd "H:\Telegram Desktop\0 NNI issues\App FacturAI\FacturIA"
cd functions
npm install
cd ..
firebase functions:secrets:set FACTURAPI_SECRET_KEY --project facturia
firebase functions:secrets:set GOOGLE_SERVICE_ACCOUNT_JSON --project facturia
firebase functions:secrets:set GOOGLE_SHEET_ID --project facturia
firebase deploy --only hosting,functions --project facturia
```

## Estado del producto

Esta version deja una base profesional para 100 facturas al mes: captura rapida, clientes frecuentes, catalogo de conceptos, historial operativo, preparacion de timbrado y estructura para complementos de pago.
