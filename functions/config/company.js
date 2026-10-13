export const COMPANY_PROFILE = {
  commercialName: "Z E-SCOOTERS MEXICO",
  legalName: "Z E-SCOOTERS MEXICO",
  capitalRegime: "SOCIEDAD ANONIMA DE CAPITAL VARIABLE",
  taxId: "ZEM210611H42",
  taxSystem: "601",
  taxSystemLabel: "General de Ley Personas Morales",
  zip: "11800",
  status: "ACTIVO",
  operationStartDate: "2021-06-11",
  address: {
    street: "PATRIOTISMO",
    exterior: "176",
    interior: "",
    neighborhood: "ESCANDON I SECCION",
    municipality: "MIGUEL HIDALGO",
    state: "CIUDAD DE MEXICO",
    country: "MEX"
  },
  businessActivities: [
    {
      share: 70,
      description: "Comercio al por menor de automoviles y camionetas nuevos cuya propulsion sea a traves de baterias electricas recargable"
    },
    {
      share: 20,
      description: "Comercio al por menor de partes y refacciones nuevas para automoviles, camionetas y camiones"
    },
    {
      share: 10,
      description: "Otros servicios profesionales, cientificos y tecnicos"
    }
  ],
  monthlyInvoiceEstimate: 100
};

export const DEFAULT_INVOICE_SETTINGS = {
  currency: "MXN",
  invoiceType: "I",
  defaultUse: "G03",
  defaultPaymentForm: "03",
  defaultPaymentMethod: "PUE",
  ivaRate: 0.16,
  series: "ZSC"
};
