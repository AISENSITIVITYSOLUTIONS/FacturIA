// Representación impresa de CFDI 4.0 con la identidad de Z E-Scooters México.
//
// Se construye a partir del XML timbrado (fuente fiscal de verdad), así que
// incluye todos los datos que exige el Anexo 20: emisor, receptor, conceptos,
// impuestos, folio fiscal, sellos, cadena original del timbre, certificados y
// código QR de verificación del SAT.

import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(here, "..", "assets");
const FONT = (name) => path.join(ASSETS, "fonts", name);

const C = {
  ink: "#0C1422",
  text: "#24303F",
  muted: "#5B6679",
  faint: "#8A94A6",
  line: "#DCE3EC",
  hair: "#E9EEF4",
  panel: "#F4F7FB",
  navy: "#0E2147",
  navy2: "#173E7E",
  cobalt: "#2459C9",
  steel: "#7FA3D9",
  amberBg: "#FFF4DC",
  amberInk: "#7A5410"
};

/* ----------------------------------------------------------- Catálogos */

const REGIMEN = {
  601: "General de Ley Personas Morales", 603: "Personas Morales con Fines no Lucrativos",
  605: "Sueldos y Salarios", 606: "Arrendamiento", 607: "Enajenación o Adquisición de Bienes",
  608: "Demás ingresos", 610: "Residentes en el Extranjero", 611: "Dividendos",
  612: "Actividades Empresariales y Profesionales", 614: "Intereses", 615: "Obtención de premios",
  616: "Sin obligaciones fiscales", 620: "Sociedades Cooperativas de Producción",
  621: "Incorporación Fiscal", 622: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
  623: "Opcional para Grupos de Sociedades", 624: "Coordinados", 625: "Plataformas Tecnológicas",
  626: "Régimen Simplificado de Confianza"
};
const USO = {
  G01: "Adquisición de mercancías", G02: "Devoluciones, descuentos o bonificaciones", G03: "Gastos en general",
  I01: "Construcciones", I02: "Mobiliario y equipo de oficina", I03: "Equipo de transporte",
  I04: "Equipo de cómputo", I08: "Otra maquinaria y equipo", S01: "Sin efectos fiscales", CP01: "Pagos"
};
const FORMA = {
  "01": "Efectivo", "02": "Cheque nominativo", "03": "Transferencia electrónica de fondos",
  "04": "Tarjeta de crédito", "05": "Monedero electrónico", "06": "Dinero electrónico",
  "08": "Vales de despensa", "28": "Tarjeta de débito", "29": "Tarjeta de servicios", "99": "Por definir"
};
const METODO = { PUE: "Pago en una sola exhibición", PPD: "Pago en parcialidades o diferido" };
const TIPO = { I: "Ingreso", E: "Egreso", T: "Traslado", P: "Pago", N: "Nómina" };
const IMPUESTO = { "001": "ISR", "002": "IVA", "003": "IEPS" };
const EXPORTACION = { "01": "No aplica", "02": "Definitiva", "03": "Temporal" };

/* --------------------------------------------------------- Utilidades */

const money = (n, cur = "MXN") => new Intl.NumberFormat("es-MX", { style: "currency", currency: cur === "XXX" ? "MXN" : cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
const num = (n, d = 2) => new Intl.NumberFormat("es-MX", { minimumFractionDigits: d, maximumFractionDigits: 6 }).format(Number(n || 0));
const arr = (x) => (x === undefined || x === null ? [] : Array.isArray(x) ? x : [x]);
const fmtDate = (s) => String(s || "").replace("T", " · ");

function words(n) {
  const U = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
  const D = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
  const H = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
  const hundreds = (x) => {
    if (x === 0) return "";
    if (x === 100) return "CIEN";
    const h = Math.floor(x / 100); const r = x % 100;
    let out = H[h];
    if (r) {
      const t = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " Y " + U[r % 10] : "");
      out = (out ? out + " " : "") + t;
    }
    return out;
  };
  const int = Math.floor(n);
  if (int === 0) return "CERO";
  const millions = Math.floor(int / 1e6); const thousands = Math.floor((int % 1e6) / 1000); const rest = int % 1000;
  const parts = [];
  if (millions) parts.push(millions === 1 ? "UN MILLÓN" : hundreds(millions) + " MILLONES");
  if (thousands) parts.push(thousands === 1 ? "MIL" : hundreds(thousands) + " MIL");
  if (rest) parts.push(hundreds(rest));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function amountInWords(total, currency) {
  const t = Math.round(Number(total || 0) * 100) / 100;
  const cents = String(Math.round((t - Math.floor(t)) * 100)).padStart(2, "0");
  const name = currency === "USD" ? "DÓLARES" : "PESOS";
  return `${words(t)} ${name} ${cents}/100 ${currency || "MXN"}`;
}

/* --------------------------------------------------------------- Parseo */

export function parseCfdi(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    removeNSPrefix: true,
    parseAttributeValue: false,
    isArray: (name) => ["Concepto", "Traslado", "Retencion"].includes(name)
  });
  const doc = parser.parse(xml);
  const c = doc.Comprobante;
  if (!c) throw new Error("XML sin nodo Comprobante");
  const tfd = c.Complemento?.TimbreFiscalDigital || {};
  return {
    version: c.Version, serie: c.Serie || "", folio: c.Folio || "", fecha: c.Fecha,
    sello: c.Sello, noCertificado: c.NoCertificado, formaPago: c.FormaPago, metodoPago: c.MetodoPago,
    condiciones: c.CondicionesDePago || "", subtotal: c.SubTotal, descuento: c.Descuento, moneda: c.Moneda,
    tipoCambio: c.TipoCambio, total: c.Total, tipo: c.TipoDeComprobante, exportacion: c.Exportacion,
    lugar: c.LugarExpedicion,
    emisor: c.Emisor || {}, receptor: c.Receptor || {},
    conceptos: arr(c.Conceptos?.Concepto),
    traslados: arr(c.Impuestos?.Traslados?.Traslado),
    retenciones: arr(c.Impuestos?.Retenciones?.Retencion),
    tfd
  };
}

function cadenaTfd(t) {
  return `||${t.Version || "1.1"}|${t.UUID}|${t.FechaTimbrado}|${t.RfcProvCertif}|${t.Leyenda ? t.Leyenda + "|" : ""}${t.SelloCFD}|${t.NoCertificadoSAT}||`;
}

function verificationUrl(d) {
  const tt = Number(d.total || 0).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${d.tfd.UUID}&re=${d.emisor.Rfc}&rr=${d.receptor.Rfc}&tt=${tt}&fe=${String(d.sello || "").slice(-8)}`;
}

/* ---------------------------------------------------------------- Dibujo */

export async function renderCfdiPdf(xml, meta = {}) {
  const d = parseCfdi(xml);
  const qr = await QRCode.toBuffer(meta.verificationUrl || verificationUrl(d), {
    errorCorrectionLevel: "M", margin: 0, scale: 6, color: { dark: C.ink, light: "#FFFFFF" }
  });

  const doc = new PDFDocument({
    size: "LETTER", margins: { top: 40, bottom: 56, left: 40, right: 40 }, bufferPages: true,
    info: { Title: `CFDI ${d.serie}${d.folio} · ${d.tfd.UUID || ""}`, Author: d.emisor.Nombre || "", Subject: "Representación impresa de CFDI 4.0" }
  });
  doc.registerFont("R", FONT("Geist-Regular.ttf"));
  doc.registerFont("M", FONT("Geist-Medium.ttf"));
  doc.registerFont("S", FONT("Geist-SemiBold.ttf"));
  doc.registerFont("B", FONT("Geist-Bold.ttf"));
  doc.registerFont("Mono", FONT("GeistMono-Regular.ttf"));
  doc.registerFont("MonoM", FONT("GeistMono-Medium.ttf"));

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const L = 40; const R = doc.page.width - 40; const W = R - L;
  const BOTTOM = doc.page.height - 70;
  let y = 40;

  const label = (text, x, yy, w, opts = {}) => {
    doc.font("S").fontSize(6.6).fillColor(opts.color || C.muted)
      .text(String(text).toUpperCase(), x, yy, { width: w, characterSpacing: 0.9, align: opts.align || "left", lineBreak: false });
  };
  const value = (text, x, yy, w, opts = {}) => {
    doc.font(opts.font || "R").fontSize(opts.size || 8.6).fillColor(opts.color || C.ink)
      .text(String(text ?? ""), x, yy, { width: w, align: opts.align || "left", lineGap: opts.lineGap ?? 1 });
    return doc.y;
  };
  const hline = (yy, x1 = L, x2 = R, color = C.line, w = 0.6) => {
    doc.save().moveTo(x1, yy).lineTo(x2, yy).lineWidth(w).strokeColor(color).stroke().restore();
  };

  /* ---- Aviso de modo prueba */
  if (meta.livemode === false) {
    doc.save().rect(0, 0, doc.page.width, 22).fill(C.amberBg).restore();
    doc.font("M").fontSize(7.6).fillColor(C.amberInk)
      .text("Comprobante emitido en modo de pruebas · sin validez fiscal", 0, 7.5, { width: doc.page.width, align: "center" });
    y = 44;
  }

  /* ---- Encabezado: placa con logotipo en la esquina */
  const plateW = 196; const plateH = 82;
  const g = doc.linearGradient(L, y, L + plateW, y + plateH);
  g.stop(0, "#0A1730").stop(0.55, C.navy2).stop(1, "#0A1A38");
  doc.save().roundedRect(L, y, plateW, plateH, 10).fill(g).restore();
  // fino bisel claro en el canto superior
  doc.save().roundedRect(L + 0.5, y + 0.5, plateW - 1, plateH - 1, 9.5).lineWidth(0.6).strokeColor("#5E86C9").strokeOpacity(0.55).stroke().restore();
  doc.image(path.join(ASSETS, "logo.png"), L + 16, y + 16, { fit: [plateW - 32, plateH - 32], align: "center", valign: "center" });

  const hx = L + plateW + 24;
  doc.font("S").fontSize(24).fillColor(C.ink).text("Factura", hx, y + 6, { lineBreak: false });
  doc.font("M").fontSize(8.4).fillColor(C.cobalt)
    .text(`CFDI ${d.version} · ${TIPO[d.tipo] || d.tipo}`, hx, y + 38, { lineBreak: false, characterSpacing: 0.4 });
  doc.font("R").fontSize(8).fillColor(C.muted)
    .text(`Expedido en ${d.lugar} · ${fmtDate(d.fecha)}`, hx, y + 52, { lineBreak: false });

  // Serie y folio a la derecha
  const fw = 120;
  label("Serie · Folio", R - fw, y + 6, fw, { align: "right" });
  doc.font("S").fontSize(20).fillColor(C.ink)
    .text(`${d.serie ? d.serie + " " : ""}${d.folio || "—"}`, R - fw - 40, y + 18, { width: fw + 40, align: "right", lineBreak: false });
  doc.font("M").fontSize(7.6).fillColor(C.cobalt)
    .text(meta.livemode === false ? "PRUEBA" : "VIGENTE", R - fw, y + 46, { width: fw, align: "right", characterSpacing: 1 });

  y += plateH + 18;

  /* ---- Banda de acento: degradado cobalto → acero */
  const band = doc.linearGradient(L, 0, R, 0);
  band.stop(0, C.navy).stop(0.45, C.cobalt).stop(1, C.steel);
  doc.save().rect(L, y, W, 2).fill(band).restore();
  y += 14;

  /* ---- Datos del timbre */
  const cols = [
    ["Folio fiscal (UUID)", d.tfd.UUID, "MonoM", 2],
    ["Fecha de certificación", fmtDate(d.tfd.FechaTimbrado), "R", 1],
    ["No. certificado emisor", d.noCertificado, "Mono", 1]
  ];
  const unit = W / 4;
  let cx = L;
  cols.forEach(([k, v, f, span]) => {
    const w = unit * span - 12;
    label(k, cx, y, w);
    value(v, cx, y + 11, w, { font: f, size: f.startsWith("Mono") ? 8.4 : 8.6 });
    cx += unit * span;
  });
  y += 34;
  hline(y);
  y += 14;

  /* ---- Emisor / Receptor */
  const half = (W - 16) / 2;
  const party = (title, x, p) => {
    doc.save().roundedRect(x, y, half, 96, 8).fill(C.panel).restore();
    doc.save().rect(x, y + 14, 2, 22).fill(C.cobalt).restore();
    label(title, x + 14, y + 12, half - 28, { color: C.cobalt });
    let yy = y + 25;
    yy = value(p.name, x + 14, yy, half - 28, { font: "S", size: 10.4 });
    value(p.rfc, x + 14, yy + 2, half - 28, { font: "MonoM", size: 8.6 });
    let ly = y + 60;
    p.rows.forEach(([k, v]) => {
      label(k, x + 14, ly + 1.5, 70);
      value(v, x + 86, ly, half - 100, { size: 8 });
      ly += 12;
    });
  };
  party("Emisor", L, {
    name: d.emisor.Nombre, rfc: d.emisor.Rfc,
    rows: [["Régimen", `${d.emisor.RegimenFiscal} · ${REGIMEN[d.emisor.RegimenFiscal] || ""}`], ["Expedición", `C.P. ${d.lugar}`]]
  });
  party("Receptor", L + half + 16, {
    name: d.receptor.Nombre, rfc: d.receptor.Rfc,
    rows: [
      ["Régimen", `${d.receptor.RegimenFiscalReceptor} · ${REGIMEN[d.receptor.RegimenFiscalReceptor] || ""}`],
      ["Uso · C.P.", `${d.receptor.UsoCFDI} ${USO[d.receptor.UsoCFDI] || ""} · ${d.receptor.DomicilioFiscalReceptor}`]
    ]
  });
  y += 96 + 22;

  /* ---- Conceptos */
  const col = { clave: L, desc: L + 78, cant: R - 222, pu: R - 160, imp: R - 80 };
  const tableHeader = () => {
    const tg = doc.linearGradient(L, 0, R, 0);
    tg.stop(0, C.navy).stop(1, C.navy2);
    doc.save().roundedRect(L, y, W, 22, 6).fill(tg).restore();
    const hy = y + 8;
    label("Clave · Unidad", col.clave + 10, hy, 70, { color: "#C9D7F0" });
    label("Descripción", col.desc, hy, col.cant - col.desc - 8, { color: "#C9D7F0" });
    label("Cant.", col.cant, hy, 54, { color: "#C9D7F0", align: "right" });
    label("P. unitario", col.pu, hy, 72, { color: "#C9D7F0", align: "right" });
    label("Importe", col.imp, hy, 70, { color: "#C9D7F0", align: "right" });
    y += 30;
  };
  const newPage = () => { doc.addPage(); y = 44; };
  tableHeader();

  d.conceptos.forEach((it, i) => {
    const tr = arr(it.Impuestos?.Traslados?.Traslado);
    const rt = arr(it.Impuestos?.Retenciones?.Retencion);
    const taxLine = [
      `Objeto imp. ${it.ObjetoImp}`,
      ...tr.map((t) => `${IMPUESTO[t.Impuesto] || t.Impuesto} ${t.TipoFactor === "Exento" ? "exento" : (Number(t.TasaOCuota) * 100).toFixed(2).replace(/\.00$/, "") + "%"} · base ${money(t.Base, d.moneda)} · ${t.Importe ? money(t.Importe, d.moneda) : ""}`),
      ...rt.map((t) => `Ret. ${IMPUESTO[t.Impuesto] || t.Impuesto} ${money(t.Importe, d.moneda)}`)
    ].join("   ");
    const dw = col.cant - col.desc - 12;
    doc.font("M").fontSize(8.8);
    const h1 = doc.heightOfString(it.Descripcion, { width: dw });
    doc.font("R").fontSize(7);
    const h2 = doc.heightOfString(taxLine, { width: dw });
    const rowH = Math.max(h1 + h2 + 8, 30);
    if (y + rowH > BOTTOM) { newPage(); tableHeader(); }
    if (i % 2 === 1) doc.save().rect(L, y - 6, W, rowH + 6).fill("#FAFBFD").restore();
    value(it.ClaveProdServ, col.clave + 10, y, 66, { font: "MonoM", size: 8.2 });
    value(`${it.ClaveUnidad}${it.Unidad ? " · " + it.Unidad : ""}`, col.clave + 10, y + 11, 66, { size: 7, color: C.muted });
    value(it.Descripcion, col.desc, y, dw, { font: "M", size: 8.8 });
    value(taxLine, col.desc, y + h1 + 3, dw, { size: 7, color: C.muted });
    value(num(it.Cantidad, 0), col.cant, y, 54, { font: "Mono", size: 8.6, align: "right" });
    value(money(it.ValorUnitario, d.moneda), col.pu - 10, y, 82, { font: "Mono", size: 8.6, align: "right" });
    value(money(it.Importe, d.moneda), col.imp - 10, y, 80, { font: "MonoM", size: 8.6, align: "right" });
    y += rowH;
    hline(y - 3, L, R, C.hair);
    y += 6;
  });

  /* ---- Totales y condiciones */
  if (y + 150 > BOTTOM) newPage();
  y += 8;
  const tw = 214; const tx = R - tw;
  let ty = y;
  const totalRow = (k, v) => {
    value(k, tx + 4, ty, 110, { size: 8.6, color: C.muted });
    value(v, tx + 100, ty, tw - 104, { font: "Mono", size: 8.8, align: "right" });
    ty += 15;
  };
  totalRow("Subtotal", money(d.subtotal, d.moneda));
  if (Number(d.descuento || 0) > 0) totalRow("Descuento", "−" + money(d.descuento, d.moneda));
  d.traslados.forEach((t) => totalRow(`${IMPUESTO[t.Impuesto] || t.Impuesto} ${(Number(t.TasaOCuota) * 100).toFixed(0)}%`, money(t.Importe, d.moneda)));
  d.retenciones.forEach((t) => totalRow(`Ret. ${IMPUESTO[t.Impuesto] || t.Impuesto}`, "−" + money(t.Importe, d.moneda)));
  ty += 4;
  const pg = doc.linearGradient(tx, ty, R, ty + 46);
  pg.stop(0, C.navy).stop(1, C.navy2);
  doc.save().roundedRect(tx, ty, tw, 46, 8).fill(pg).restore();
  label(`Total ${d.moneda}`, tx + 14, ty + 18, 80, { color: "#C9D7F0" });
  doc.font("S").fontSize(17).fillColor("#FFFFFF").text(money(d.total, d.moneda), tx + 70, ty + 13, { width: tw - 84, align: "right", lineBreak: false });
  ty += 46;

  const lw = W - tw - 28;
  let ly = y;
  const kv = [
    ["Forma de pago", `${d.formaPago || "—"} · ${FORMA[d.formaPago] || ""}`],
    ["Método de pago", `${d.metodoPago || "—"} · ${METODO[d.metodoPago] || ""}`],
    ["Moneda · Exportación", `${d.moneda}${d.tipoCambio ? " (TC " + d.tipoCambio + ")" : ""} · ${d.exportacion} ${EXPORTACION[d.exportacion] || ""}`]
  ];
  if (d.condiciones) kv.push(["Condiciones", d.condiciones]);
  const kw = (lw - 16) / 2;
  for (let i = 0; i < kv.length; i += 2) {
    let rowBottom = ly;
    kv.slice(i, i + 2).forEach(([k, v], j) => {
      const x = L + j * (kw + 16);
      label(k, x, ly, kw);
      rowBottom = Math.max(rowBottom, value(v, x, ly + 11, kw, { size: 8.4 }));
    });
    ly = rowBottom + 10;
  }
  label("Importe con letra", L, ly, lw);
  value(amountInWords(d.total, d.moneda), L, ly + 11, lw, { font: "M", size: 8.4 });
  y = Math.max(ty, doc.y) + 22;

  /* ---- Sello fiscal */
  const sealH = 150;
  if (y + sealH > BOTTOM) newPage();
  hline(y, L, R, C.line);
  y += 14;
  const qs = 104;
  doc.save().roundedRect(L, y, qs + 16, qs + 16, 8).lineWidth(0.6).strokeColor(C.line).stroke().restore();
  doc.image(qr, L + 8, y + 8, { width: qs, height: qs });
  doc.font("R").fontSize(6.4).fillColor(C.faint)
    .text("Verifica en sat.gob.mx", L, y + qs + 22, { width: qs + 16, align: "center" });

  const sx = L + qs + 32; const sw = R - sx;
  let sy = y - 2;
  const sealBlock = (k, v) => {
    label(k, sx, sy, sw);
    doc.font("Mono").fontSize(6).fillColor(C.text).text(v, sx, sy + 10, { width: sw, lineGap: 0.6 });
    sy = doc.y + 7;
  };
  sealBlock("Sello digital del CFDI", d.tfd.SelloCFD || d.sello || "");
  sealBlock("Sello digital del SAT", d.tfd.SelloSAT || "");
  sealBlock("Cadena original del complemento de certificación digital del SAT", cadenaTfd(d.tfd));
  label("Certificado SAT · PAC", sx, sy, sw);
  value(`No. ${d.tfd.NoCertificadoSAT || "—"}   ·   RFC proveedor de certificación ${d.tfd.RfcProvCertif || "—"}`, sx, sy + 10, sw, { font: "Mono", size: 6.6, color: C.text });

  /* ---- Pie en todas las páginas */
  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 42;
    const fg = doc.linearGradient(L, 0, R, 0);
    fg.stop(0, C.line).stop(0.5, C.steel).stop(1, C.line);
    doc.save().rect(L, fy, W, 0.8).fill(fg).restore();
    doc.font("R").fontSize(6.8).fillColor(C.muted)
      .text("Este documento es una representación impresa de un CFDI 4.0", L, fy + 8, { width: W / 2, lineBreak: false });
    doc.font("R").fontSize(6.8).fillColor(C.muted)
      .text(`${d.emisor.Nombre || ""} · ${d.emisor.Rfc || ""}   ·   Página ${p - range.start + 1} de ${range.count}`, L + W / 2, fy + 8, { width: W / 2, align: "right", lineBreak: false });
  }

  doc.end();
  return done;
}
