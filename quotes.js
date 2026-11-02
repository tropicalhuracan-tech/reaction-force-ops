/* ==== MÓDULO COTIZACIONES / PROPUESTAS ==== */
const QUOTES_KEY = "rfs-ops-quotes";
const QUOTE_DAYS = 30;
const QUOTE_ITBIS = 0.18;
/** Cada hombre trabaja siempre 12 horas */
const QUOTE_HOURS_PER_MAN = 12;

const RFS_COMPANY = {
  name: "Reaction Force Security, S.R.L.",
  slogan: "Tu mejor alternativa de seguridad",
  rnc: "1-31-14462-4",
  license: "Licencia de Operación No. 279",
  address: "Calle Penetración No. 2, sector El Paraíso, Gurabo, Santiago, R.D.",
  phones: "809-581-8181 / 809-694-3232",
  email: "reactionforce45@gmail.com",
  signerTitle: "Gerente de ventas",
};

const QUOTE_REF_CLIENTS = [
  "Acero Estrella",
  "Auto Chang",
  "Bancas La Suerte",
  "Casa Yanet",
  "Distribuidora 2000",
  "El Navidón",
  "Fernández Cáceres Comercial",
  "Fraga Industrial",
  "Industrias Dominca",
  "Monorriel de Santiago",
  "Óptica Klaridad",
  "Productos María",
  "Residencial Casa Club Mediterráneo",
  "Residencial Paseo del Prado I",
  "Residencial Porto Sole",
  "Supermercado Central",
  "Tienda Concepto",
  "Universidad ISA",
  "Vial Gas",
  "Vidmetal",
];

const QUOTE_MODELS = [
  {
    id: "ejecutiva",
    label: "Modelo 1 — Ejecutiva",
    blurb:
      "Propuesta comercial completa: quiénes somos, tecnología (GPS + Ponche RFS), alcance, inversión, clientes y cierre persuasivo.",
  },
  {
    id: "cotizacion",
    label: "Modelo 2 — Cotización formal",
    blurb:
      "Carta formal con tabla clara de diurnos/nocturnos, horas, subtotal, ITBIS y total. Ideal para envío rápido.",
  },
  {
    id: "institucional",
    label: "Modelo 3 — Institucional",
    blurb:
      "Enfoque en cobertura, beneficios, supervisión y confianza de clientes institucionales y comerciales.",
  },
];

let quotesHistory = [];
let selectedQuoteModel = "ejecutiva";
let lastSharedQuoteId = "";

function currentQuoteUserLabel() {
  if (typeof currentUser !== "undefined" && currentUser) {
    return String(currentUser.displayName || currentUser.username || "").trim() || "Usuario";
  }
  return "Usuario";
}

function currentQuoteUsername() {
  if (typeof currentUser !== "undefined" && currentUser) {
    return String(currentUser.username || "").trim().toLowerCase();
  }
  return "";
}

function moneyRD(n) {
  const v = Number(n);
  const safe = Number.isFinite(v) ? v : 0;
  return `RD$${safe.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function emptyQuoteForm() {
  return {
    modelId: "ejecutiva",
    clientName: "",
    clientRnc: "",
    attentionTo: "",
    dayMen: 1,
    nightMen: 0,
    dayHourlyRate: 155,
    nightHourlyRate: 175,
    hourlyRate: 155,
    dayDiscountType: "none",
    dayDiscountValue: 0,
    nightDiscountType: "none",
    nightDiscountValue: 0,
    discountType: "none",
    discountValue: 0,
    includeItbis: true,
    note: "",
    date: new Date().toISOString().slice(0, 10),
  };
}

function calcQuoteTotals(input = {}) {
  // Compat: cotizaciones viejas con menCount/shiftHours
  let dayMen = Math.max(0, Number(input.dayMen));
  let nightMen = Math.max(0, Number(input.nightMen));
  if (!Number.isFinite(dayMen)) dayMen = 0;
  if (!Number.isFinite(nightMen)) nightMen = 0;
  if (!dayMen && !nightMen && Number(input.menCount) > 0) {
    const legacyHours = Number(input.shiftHours) === 24 ? 24 : 12;
    const legacyMen = Math.max(0, Number(input.menCount) || 0);
    // Aprox: si era 24h con N "cupos", equivalía a N hombres de 12h en la lógica nueva
    // mantenemos menCount como total y lo ponemos en día por defecto
    dayMen = legacyMen;
    nightMen = 0;
    if (legacyHours === 24 && legacyMen >= 1) {
      // 24h legacy facturaba hours=24*men; nueva lógica men*12 — documentamos en UI
      dayMen = legacyMen;
    }
  }

  const men = dayMen + nightMen;
  const hoursPerMan = QUOTE_HOURS_PER_MAN;
  const hoursPerDay = men * hoursPerMan;
  const legacyRate = Math.max(0, Number(input.hourlyRate) || 0);
  let dayRate = Math.max(0, Number(input.dayHourlyRate));
  let nightRate = Math.max(0, Number(input.nightHourlyRate));
  if (!Number.isFinite(dayRate) || (dayRate <= 0 && legacyRate > 0 && input.dayHourlyRate == null)) {
    dayRate = legacyRate;
  }
  if (!Number.isFinite(nightRate) || (nightRate <= 0 && legacyRate > 0 && input.nightHourlyRate == null)) {
    nightRate = legacyRate;
  }
  if (!Number.isFinite(dayRate)) dayRate = 0;
  if (!Number.isFinite(nightRate)) nightRate = 0;
  // Compat: cotizaciones viejas solo con hourlyRate
  if (!dayRate && !nightRate && legacyRate) {
    dayRate = legacyRate;
    nightRate = legacyRate;
  }
  const days = QUOTE_DAYS;
  const dayHoursMonth = dayMen * hoursPerMan * days;
  const nightHoursMonth = nightMen * hoursPerMan * days;
  const hoursMonth = dayHoursMonth + nightHoursMonth;
  const dayGross = dayHoursMonth * dayRate;
  const nightGross = nightHoursMonth * nightRate;
  const gross = dayGross + nightGross;
  const rate = men > 0 ? gross / Math.max(1, hoursMonth) : dayRate || nightRate || legacyRate;

  function shiftDiscount(grossPart, type, value) {
    const t = type || "none";
    const v = Math.max(0, Number(value) || 0);
    if (!grossPart || t === "none" || v <= 0) return 0;
    if (t === "percent") return grossPart * (Math.min(v, 100) / 100);
    if (t === "amount") return Math.min(v, grossPart);
    return 0;
  }

  let dayDiscountType = input.dayDiscountType;
  let nightDiscountType = input.nightDiscountType;
  let dayDiscountValue = input.dayDiscountValue;
  let nightDiscountValue = input.nightDiscountValue;
  // Compat: cotización vieja con un solo descuento global
  const legacyDtype = input.discountType || "none";
  const legacyDval = Math.max(0, Number(input.discountValue) || 0);
  const hasSplitDiscount =
    Object.prototype.hasOwnProperty.call(input, "dayDiscountType") ||
    Object.prototype.hasOwnProperty.call(input, "nightDiscountType") ||
    Object.prototype.hasOwnProperty.call(input, "dayDiscountValue") ||
    Object.prototype.hasOwnProperty.call(input, "nightDiscountValue");

  let dayDiscount = 0;
  let nightDiscount = 0;
  let discount = 0;
  if (hasSplitDiscount) {
    dayDiscountType = dayDiscountType || "none";
    nightDiscountType = nightDiscountType || "none";
    dayDiscount = shiftDiscount(dayGross, dayDiscountType, dayDiscountValue);
    nightDiscount = shiftDiscount(nightGross, nightDiscountType, nightDiscountValue);
    discount = dayDiscount + nightDiscount;
  } else if (legacyDtype === "percent") {
    discount = gross * (Math.min(legacyDval, 100) / 100);
    dayDiscountType = "none";
    nightDiscountType = "none";
  } else if (legacyDtype === "amount") {
    discount = Math.min(legacyDval, gross);
    dayDiscountType = "none";
    nightDiscountType = "none";
  } else {
    dayDiscountType = "none";
    nightDiscountType = "none";
  }

  const subtotal = Math.max(0, gross - discount);
  const includeItbis = input.includeItbis !== false;
  const itbis = includeItbis ? subtotal * QUOTE_ITBIS : 0;
  const total = subtotal + itbis;

  return {
    dayMen,
    nightMen,
    men,
    hoursPerMan,
    hoursPerDay,
    days,
    dayRate,
    nightRate,
    rate,
    dayHoursMonth,
    nightHoursMonth,
    hoursMonth,
    dayGross,
    nightGross,
    gross,
    dayDiscount,
    nightDiscount,
    dayDiscountType,
    dayDiscountValue: Math.max(0, Number(dayDiscountValue) || 0),
    nightDiscountType,
    nightDiscountValue: Math.max(0, Number(nightDiscountValue) || 0),
    discount,
    discountType: hasSplitDiscount ? "split" : legacyDtype,
    discountValue: hasSplitDiscount ? discount : legacyDval,
    includeItbis,
    subtotal,
    itbis,
    total,
  };
}

function loadQuotesHistory() {
  try {
    const raw = localStorage.getItem(QUOTES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    quotesHistory = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    quotesHistory = [];
  }
  return quotesHistory;
}

function saveQuotesHistory() {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(quotesHistory.slice(0, 80)));
}

function readQuoteForm() {
  const modelId = selectedQuoteModel || document.querySelector(".quote-model-card.active")?.dataset.model || "ejecutiva";
  const dayDiscountType = document.getElementById("quoteDayDiscountType")?.value || "none";
  const nightDiscountType = document.getElementById("quoteNightDiscountType")?.value || "none";
  return {
    modelId,
    clientName: String(document.getElementById("quoteClientName")?.value || "").trim(),
    clientRnc: String(document.getElementById("quoteClientRnc")?.value || "").trim(),
    attentionTo: String(document.getElementById("quoteAttentionTo")?.value || "").trim(),
    dayMen: Number(document.getElementById("quoteDayMen")?.value || 0),
    nightMen: Number(document.getElementById("quoteNightMen")?.value || 0),
    dayHourlyRate: Number(document.getElementById("quoteDayRate")?.value || 0),
    nightHourlyRate: Number(document.getElementById("quoteNightRate")?.value || 0),
    hourlyRate: Number(
      document.getElementById("quoteDayRate")?.value || document.getElementById("quoteNightRate")?.value || 0
    ),
    dayDiscountType,
    dayDiscountValue: Number(document.getElementById("quoteDayDiscountValue")?.value || 0),
    nightDiscountType,
    nightDiscountValue: Number(document.getElementById("quoteNightDiscountValue")?.value || 0),
    discountType: "split",
    discountValue: 0,
    includeItbis: !!document.getElementById("quoteIncludeItbis")?.checked,
    note: String(document.getElementById("quoteNote")?.value || "").trim(),
    date: document.getElementById("quoteDate")?.value || new Date().toISOString().slice(0, 10),
  };
}

function quoteCompanySignBlock() {
  return `<div class="sign-line">${escapeHtml(RFS_COMPANY.signerTitle)}<br/>${escapeHtml(RFS_COMPANY.name)}<br/>Tel: ${escapeHtml(
    RFS_COMPANY.phones
  )}<br/>${escapeHtml(RFS_COMPANY.email)}</div>`;
}

function quotePrintCss() {
  return `
  body.quote-print{color:#141414}
  body.quote-print .brand{
    background:#0b0b0c;
    color:#fff;
    border:1px solid #0b0b0c;
    border-left:6px solid #d41414;
    border-radius:10px;
    padding:12px 14px;
    margin-bottom:14px;
    gap:14px;
  }
  body.quote-print .brand img{
    width:64px;height:64px;border:2px solid #d41414;border-radius:12px;background:#fff;
  }
  body.quote-print .brand h1{color:#fff;margin:0 0 2px;font-size:20px;letter-spacing:.04em}
  body.quote-print .brand > div > div{color:#f0f0f0;font-size:12px}
  body.quote-print .brand > div > div::before{
    content:"";display:inline-block;width:18px;height:3px;background:#d41414;margin-right:8px;vertical-align:middle;border-radius:2px;
  }
  .q-doc h2.q-title{
    margin:0 0 8px;font-size:16px;font-weight:800;color:#0b0b0c;letter-spacing:.01em;
    border-bottom:2px solid #d41414;padding-bottom:6px;
  }
  .q-doc h3{
    margin:18px 0 8px;font-size:13px;font-weight:800;color:#0b0b0c;
    border-left:4px solid #d41414;padding:4px 0 4px 10px;background:linear-gradient(90deg,#f5f5f5 0%,#fff 70%);
  }
  .q-doc .q-date{margin:0 0 14px;color:#444;font-size:12px}
  .q-doc .meta{gap:10px;margin:0 0 16px}
  .q-doc .meta > div{
    min-width:148px;flex:1 1 148px;background:#fafafa;border:1px solid #ddd;
    border-top:3px solid #d41414;border-radius:6px;padding:8px 10px;
  }
  .q-doc .meta > div strong{display:block;color:#d41414;font-size:10px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px}
  .q-doc table{border:1px solid #0b0b0c;margin:10px 0 6px}
  .q-doc th{background:#0b0b0c;color:#fff;border-color:#0b0b0c;font-size:11px;letter-spacing:.03em}
  .q-doc td{border-color:#bbb}
  .q-doc tbody tr:nth-child(even){background:#f7f7f7}
  .q-doc tbody tr:last-child{background:#0b0b0c;color:#fff}
  .q-doc tbody tr:last-child td{border-color:#0b0b0c;font-size:13px}
  .q-doc tbody tr:last-child strong{color:#fff}
  .q-note{
    margin:14px 0;padding:10px 12px;border:1px solid #ccc;border-left:5px solid #d41414;
    background:#f8f8f8;font-size:11px;line-height:1.45;color:#333;
  }
  .q-note strong{color:#d41414}
  .q-letterhead{
    margin:0 0 14px;padding:0 0 12px;border-bottom:1px solid #ddd;
  }
  .q-letterhead .q-co{font-size:11.5px;color:#333;line-height:1.45}
  .q-letterhead .q-co strong{color:#0b0b0c;font-size:12.5px}
  body.quote-print .brand > div > div{display:none}
  .q-rule{height:4px;margin:0 0 16px;border-radius:3px;background:linear-gradient(90deg,#0b0b0c 0%,#d41414 45%,#0b0b0c 100%)}
  .q-clients img{border:1px solid #bbb;border-top:3px solid #d41414;border-radius:8px}
  .q-doc .sign-box{margin-top:28px;padding-top:8px;border-top:1px dashed #bbb}
  .q-doc .sign-line{border-top:2px solid #0b0b0c;margin-top:48px;padding-top:8px;font-size:11px}
  .q-contact{
    margin:16px 0 0;padding:10px 12px;background:#0b0b0c;color:#fff;border-radius:8px;
    border-left:5px solid #d41414;font-size:12px;
  }
  .q-contact strong{color:#d41414}
  .q-footer-bar{height:6px;margin:22px 0 8px;border-radius:3px;background:linear-gradient(90deg,#d41414 0%,#0b0b0c 55%,#d41414 100%)}
  @media print{
    body.quote-print .brand{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .q-doc th,.q-doc tbody tr:last-child,.q-contact,.q-rule,.q-footer-bar,.q-doc h3,.q-doc .meta > div{
      -webkit-print-color-adjust:exact;print-color-adjust:exact
    }
  }`;
}

function quoteMandatoryNoteHtml() {
  return `<p class="q-note"><strong>Nota importante:</strong> ${escapeHtml(quoteNoteBlock())}</p>`;
}

function quoteAttentionHtml(data) {
  if (!data.attentionTo && !data.clientRnc) return "";
  return `
    <div class="meta">
      ${data.clientRnc ? `<div><strong>RNC</strong>${escapeHtml(data.clientRnc)}</div>` : ""}
      ${data.attentionTo ? `<div><strong>Atención a</strong>${escapeHtml(data.attentionTo)}</div>` : ""}
    </div>`;
}

function formatQuoteDate(iso) {
  try {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString("es-DO", { day: "numeric", month: "long", year: "numeric" });
  } catch (_) {
    return iso;
  }
}

function quoteShiftLabel(calc) {
  const parts = [];
  if (calc.dayMen > 0) parts.push(`${calc.dayMen} diurno${calc.dayMen === 1 ? "" : "s"}`);
  if (calc.nightMen > 0) parts.push(`${calc.nightMen} nocturno${calc.nightMen === 1 ? "" : "s"}`);
  return parts.join(" + ") || "Sin personal";
}

function quoteNoteBlock() {
  return "Los valores fueron calculados para un período de 30 días. Cada hombre labora 12 horas por jornada. La facturación puede variar en meses de 28, 29 o 31 días, así como por la incidencia de días feriados, conforme al calendario y a las condiciones del servicio.";
}

function buildQuoteHeader() {
  return `
    <div class="q-rule"></div>
    <div class="q-letterhead">
      <div class="q-co">
        <strong>${escapeHtml(RFS_COMPANY.name)}</strong><br/>
        “${escapeHtml(RFS_COMPANY.slogan)}”<br/>
        RNC: ${escapeHtml(RFS_COMPANY.rnc)} · ${escapeHtml(RFS_COMPANY.license)}<br/>
        ${escapeHtml(RFS_COMPANY.address)}<br/>
        Tel: ${escapeHtml(RFS_COMPANY.phones)} · ${escapeHtml(RFS_COMPANY.email)}
      </div>
    </div>`;
}

function buildTechBlock() {
  return `
    <h3>Tecnología y control operativo</h3>
    <ul>
      <li><strong>Monitoreo con GPS:</strong> seguimiento de supervisión y recorridos para mayor control del servicio en tiempo real.</li>
      <li><strong>Aplicación exclusiva Ponche Reaction Force Security:</strong> registro digital de entrada y salida del personal, con evidencia operativa para la empresa y el cliente.</li>
      <li><strong>Entrega de reportes a clientes:</strong> novedades, incidencias y seguimiento del puesto, para que usted tenga visibilidad clara de lo que ocurre en su instalación.</li>
      <li><strong>Supervisión permanente:</strong> refuerzo operativo y respuesta ante irregularidades.</li>
    </ul>`;
}

function buildClientsBlock() {
  return `
    <h3>Algunos de nuestros clientes</h3>
    <p>La confianza de empresas e instituciones que ya operan con Reaction Force Security respalda nuestra propuesta. Trabajamos con clientes de alto tráfico, industria, comercio, residenciales y proyectos de infraestructura, manteniendo supervisión, disciplina y respuesta oportuna.</p>
    <p style="font-size:12px;line-height:1.45"><strong>Referencias:</strong> ${escapeHtml(QUOTE_REF_CLIENTS.join(" · "))}</p>
    <p style="margin:10px 0 6px;font-size:12px;color:#444">Logotipos / cartera de clientes (material RFS):</p>
    <div class="q-clients" style="display:grid;gap:10px;margin:8px 0 14px">
      <img src="quote-assets/clientes-rfs-1.jpg" alt="Clientes Reaction Force Security 1"
        style="width:100%;max-width:640px" />
      <img src="quote-assets/clientes-rfs-2.jpg" alt="Clientes Reaction Force Security 2"
        style="width:100%;max-width:640px" />
    </div>
    <p style="font-size:12px;color:#444">Esta cartera demuestra experiencia comprobada y la tranquilidad de quienes ya nos eligieron como su aliado de seguridad.</p>`;
}

function buildQuoteTotalsTable(data, calc) {
  const discountRows = [];
  if (calc.dayDiscount > 0) {
    const label =
      calc.dayDiscountType === "percent"
        ? `Descuento turno diurno (${calc.dayDiscountValue}%)`
        : "Descuento turno diurno";
    discountRows.push(
      `<tr><td colspan="3"><strong>${label}</strong></td><td class="right">− ${moneyRD(calc.dayDiscount)}</td></tr>`
    );
  }
  if (calc.nightDiscount > 0) {
    const label =
      calc.nightDiscountType === "percent"
        ? `Descuento turno nocturno (${calc.nightDiscountValue}%)`
        : "Descuento turno nocturno";
    discountRows.push(
      `<tr><td colspan="3"><strong>${label}</strong></td><td class="right">− ${moneyRD(calc.nightDiscount)}</td></tr>`
    );
  }
  if (!discountRows.length && calc.discount > 0) {
    discountRows.push(
      `<tr><td colspan="3"><strong>Descuento especial${
        calc.discountType === "percent" ? ` (${calc.discountValue}%)` : ""
      }</strong></td><td class="right">− ${moneyRD(calc.discount)}</td></tr>`
    );
  }
  const discountRow = discountRows.join("");
  const serviceLines = [];
  if (calc.dayMen > 0) {
    serviceLines.push(
      `<tr>
        <td>Turno diurno · ${QUOTE_HOURS_PER_MAN} h/hombre · ${moneyRD(calc.dayRate)}/h</td>
        <td>${calc.dayMen}</td>
        <td>${calc.dayMen} × ${QUOTE_HOURS_PER_MAN} h × ${calc.days} días × ${moneyRD(calc.dayRate)}</td>
        <td class="right">${moneyRD(calc.dayGross)}</td>
      </tr>`
    );
  }
  if (calc.nightMen > 0) {
    serviceLines.push(
      `<tr>
        <td>Turno nocturno · ${QUOTE_HOURS_PER_MAN} h/hombre · ${moneyRD(calc.nightRate)}/h</td>
        <td>${calc.nightMen}</td>
        <td>${calc.nightMen} × ${QUOTE_HOURS_PER_MAN} h × ${calc.days} días × ${moneyRD(calc.nightRate)}</td>
        <td class="right">${moneyRD(calc.nightGross)}</td>
      </tr>`
    );
  }
  if (!serviceLines.length) {
    serviceLines.push(`<tr><td colspan="4">Sin personal asignado</td></tr>`);
  }
  return `
    <table>
      <thead>
        <tr>
          <th>Servicio</th>
          <th>Hombres</th>
          <th>Detalle</th>
          <th class="right">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${serviceLines.join("")}
        <tr>
          <td colspan="3">Horas diarias totales (${calc.men} × ${QUOTE_HOURS_PER_MAN} h)</td>
          <td class="right"><strong>${calc.hoursPerDay} h/día</strong></td>
        </tr>
        <tr>
          <td colspan="3">Horas mensuales (${calc.hoursPerDay} × ${calc.days} días)</td>
          <td class="right"><strong>${calc.hoursMonth.toLocaleString("es-DO")} h</strong></td>
        </tr>
        ${discountRow}
        <tr><td colspan="3"><strong>Subtotal</strong></td><td class="right"><strong>${moneyRD(calc.subtotal)}</strong></td></tr>
        ${
          calc.includeItbis
            ? `<tr><td colspan="3">ITBIS (18%)</td><td class="right">${moneyRD(calc.itbis)}</td></tr>`
            : `<tr><td colspan="3">ITBIS</td><td class="right">No incluido</td></tr>`
        }
        <tr><td colspan="3"><strong>TOTAL MENSUAL</strong></td><td class="right"><strong>${moneyRD(calc.total)}</strong></td></tr>
      </tbody>
    </table>`;
}

function buildModelEjecutiva(data, calc) {
  return `
    ${buildQuoteHeader()}
    <h2 class="q-title">Propuesta ejecutiva de servicios de seguridad privada</h2>
    <p class="q-date">Santiago, ${escapeHtml(formatQuoteDate(data.date))}</p>
    <div class="meta">
      <div><strong>Cliente</strong>${escapeHtml(data.clientName)}</div>
      <div><strong>RNC</strong>${escapeHtml(data.clientRnc || "—")}</div>
      <div><strong>Atención a</strong>${escapeHtml(data.attentionTo || "—")}</div>
      <div><strong>Turnos</strong>${escapeHtml(quoteShiftLabel(calc))}</div>
      <div><strong>Personal</strong>${calc.men} hombre${calc.men === 1 ? "" : "s"} · ${calc.hoursPerDay} h/día</div>
    </div>

    <h3>Presentación</h3>
    <p>Reaction Force Security agradece la oportunidad de presentar esta propuesta comercial. Nuestro objetivo es brindar un servicio de seguridad privada confiable, preventivo y orientado a la protección de las personas, instalaciones y activos de nuestros clientes, respaldado por personal profesional, supervisión permanente y herramientas tecnológicas de control.</p>

    <h3>¿Quiénes somos?</h3>
    <p>Reaction Force Security cuenta con más de 12 años de experiencia en el sector de la seguridad privada. Operamos bajo la ${escapeHtml(
      RFS_COMPANY.license
    )}, emitida por la Superintendencia de Vigilancia y Seguridad Privada. Oficinas: ${escapeHtml(RFS_COMPANY.address)}.</p>
    <p>Disponemos de personal previamente evaluado y capacitado, armas con licencia operativa, supervisión constante y seguro de responsabilidad civil por daños a terceros. Nuestro compromiso es convertir la seguridad en un servicio medible, disciplinado y transparente para el cliente.</p>

    ${buildTechBlock()}

    <h3>Alcance del servicio</h3>
    <ul>
      <li>Vigilancia física y control de accesos</li>
      <li>Cobertura diurna y/o nocturna según el personal contratado (cada hombre: ${QUOTE_HOURS_PER_MAN} horas)</li>
      <li>Supervisión operativa permanente</li>
      <li>Reportes de novedades e incidencias para el cliente</li>
      <li>Reemplazos por vacaciones y licencias</li>
      <li>Personal uniformado y debidamente identificado</li>
    </ul>

    <h3>Inversión del servicio</h3>
    ${buildQuoteTotalsTable(data, calc)}
    ${quoteMandatoryNoteHtml()}
    ${data.note ? `<p><strong>Nota adicional:</strong> ${escapeHtml(data.note)}</p>` : ""}

    ${buildClientsBlock()}

    <h3>Nuestra recomendación</h3>
    <p>Definir la cantidad de hombres diurnos y nocturnos según el riesgo y el horario de su operación permite una cobertura precisa. Con monitoreo GPS, la app de ponche Reaction Force Security y la entrega de reportes, usted mantiene control real del servicio día a día.</p>

    <h3>Mensaje final</h3>
    <p>Agradecemos el tiempo dedicado a evaluar nuestra propuesta. En Reaction Force Security estamos convencidos de que podemos convertirnos en un aliado estratégico para la protección de <strong>${escapeHtml(
      data.clientName
    )}</strong>. Será un honor contar con su confianza.</p>

    <p class="q-contact"><strong>Contacto:</strong> ${escapeHtml(RFS_COMPANY.phones)} · ${escapeHtml(RFS_COMPANY.email)}</p>
    <div class="sign-box">
      <div>${quoteCompanySignBlock()}</div>
      <div><div class="sign-line">Recibido por el cliente<br/>${
        data.attentionTo ? escapeHtml(data.attentionTo) + "<br/>" : ""
      }Nombre / Firma</div></div>
    </div>
    <div class="q-footer-bar"></div>`;
}

function buildModelCotizacion(data, calc) {
  return `
    ${buildQuoteHeader()}
    <p class="q-date">Santiago, Rep. Dom. · ${escapeHtml(formatQuoteDate(data.date))}</p>
    <p style="margin:0 0 4px"><strong>Señores:</strong> ${escapeHtml(data.clientName)}</p>
    ${quoteAttentionHtml(data)}
    <p>Después de saludarles, le remitimos la cotización requerida para el servicio de seguridad privada, con personal diurno y/o nocturno, supervisión y herramientas de control (GPS, app de ponche Reaction Force Security y reportes al cliente).</p>
    <h2 class="q-title">Cotización</h2>
    <p style="font-size:12px;color:#444;margin:0 0 8px">Turnos: <strong>${escapeHtml(
      quoteShiftLabel(calc)
    )}</strong> · Cada hombre: ${QUOTE_HOURS_PER_MAN} h · Horas/día: <strong>${calc.hoursPerDay}</strong></p>
    ${buildQuoteTotalsTable(data, calc)}
    ${quoteMandatoryNoteHtml()}
    ${data.note ? `<p><strong>Nota:</strong> ${escapeHtml(data.note)}</p>` : ""}
    ${buildTechBlock()}
    ${buildClientsBlock()}
    <p style="margin-top:18px">Atentamente,</p>
    <div class="sign-box">
      <div>${quoteCompanySignBlock()}</div>
      <div><div class="sign-line">Recibido por el cliente<br/>${
        data.attentionTo ? escapeHtml(data.attentionTo) + "<br/>" : ""
      }Nombre / Firma</div></div>
    </div>
    <div class="q-footer-bar"></div>`;
}

function buildModelInstitucional(data, calc) {
  return `
    ${buildQuoteHeader()}
    <h2 class="q-title">Propuesta de servicios de seguridad</h2>
    <p class="q-date">Santiago de los Caballeros, ${escapeHtml(formatQuoteDate(data.date))}</p>
    <p><strong>Señores:</strong> ${escapeHtml(data.clientName)}</p>
    ${quoteAttentionHtml(data)}
    <p>En nombre de ${escapeHtml(
      RFS_COMPANY.name
    )}, nos complace presentar nuestra propuesta de servicios de seguridad, orientada a brindar protección integral a sus instalaciones. Detallamos cobertura, personal (diurno/nocturno), logística tecnológica y esquema económico, con el compromiso de profesionalidad, supervisión y respuesta inmediata.</p>

    <h3>Presentación de la empresa</h3>
    <p>REACTION FORCE SECURITY es una empresa especializada en seguridad privada, con experiencia en resguardo de instalaciones de alta importancia: industria, comercio, residenciales, campus y proyectos de infraestructura. Contamos con personal capacitado y armado, supervisión permanente y ${escapeHtml(
      RFS_COMPANY.license
    )}.</p>

    <h3>Objetivo</h3>
    <p>Brindar un servicio integral de seguridad a <strong>${escapeHtml(
      data.clientName
    )}</strong>${
      data.attentionTo ? `, a la atención de <strong>${escapeHtml(data.attentionTo)}</strong>` : ""
    }, garantizando la protección de personas, activos e instalaciones mediante agentes asignados en turnos diurnos y/o nocturnos, con soporte de supervisión y evidencia digital del servicio.</p>

    <h3>Cobertura propuesta</h3>
    <ul>
      <li><strong>${calc.men}</strong> hombre${calc.men === 1 ? "" : "s"} de seguridad (${escapeHtml(quoteShiftLabel(calc))})</li>
      <li>Cada hombre labora <strong>${QUOTE_HOURS_PER_MAN} horas</strong> por jornada</li>
      <li>Horas diarias totales: <strong>${calc.hoursPerDay} h</strong></li>
      <li>Cálculo base: <strong>${QUOTE_DAYS} días</strong> al mes</li>
      <li>Tarifa día: <strong>${moneyRD(calc.dayRate)}</strong>/h · Tarifa noche: <strong>${moneyRD(
        calc.nightRate
      )}</strong>/h</li>
    </ul>

    ${buildTechBlock()}

    <h3>Detalle económico</h3>
    ${buildQuoteTotalsTable(data, calc)}
    ${quoteMandatoryNoteHtml()}
    ${data.note ? `<p><strong>Observaciones:</strong> ${escapeHtml(data.note)}</p>` : ""}

    <h3>Beneficios de elegirnos</h3>
    <ul>
      <li>Personal armado y altamente capacitado</li>
      <li>Supervisión constante y capacidad de respuesta</li>
      <li>Monitoreo con GPS y app exclusiva de ponche Reaction Force Security</li>
      <li>Reportes y control operativo para el cliente</li>
      <li>Experiencia comprobada en proyectos de gran magnitud</li>
      <li>Respuesta inmediata ante incidencias</li>
    </ul>

    ${buildClientsBlock()}

    <p style="margin-top:16px">${escapeHtml(RFS_COMPANY.name)} reitera su compromiso de ser la mejor alternativa de seguridad para ${escapeHtml(
    data.clientName
  )}, asegurando tranquilidad, disciplina y resguardo permanente.</p>
    <p class="q-contact"><strong>Contacto:</strong> ${escapeHtml(RFS_COMPANY.phones)} · ${escapeHtml(RFS_COMPANY.email)}</p>
    <div class="sign-box">
      <div>${quoteCompanySignBlock()}</div>
      <div><div class="sign-line">Aceptación del cliente<br/>${
        data.attentionTo ? escapeHtml(data.attentionTo) + "<br/>" : ""
      }Nombre / Firma / Sello</div></div>
    </div>
    <div class="q-footer-bar"></div>`;
}

function buildQuoteBodyHtml(data, calc) {
  let inner = "";
  if (data.modelId === "cotizacion") inner = buildModelCotizacion(data, calc);
  else if (data.modelId === "institucional") inner = buildModelInstitucional(data, calc);
  else inner = buildModelEjecutiva(data, calc);
  return `<div class="q-doc">${inner}</div>`;
}

function updateQuoteTotalsUi() {
  const data = readQuoteForm();
  const calc = calcQuoteTotals(data);
  const box = document.getElementById("quoteTotalsBox");
  const totalMenEl = document.getElementById("quoteTotalMenLabel");
  if (totalMenEl) {
    totalMenEl.textContent = `${calc.men} hombre${calc.men === 1 ? "" : "s"} · ${calc.hoursPerDay} h/día · ${calc.hoursMonth.toLocaleString(
      "es-DO"
    )} h/mes`;
  }
  if (!box) return;
  box.innerHTML = `
    <div class="detail-grid">
      <div><span>Diurnos</span><strong>${calc.dayMen} · ${moneyRD(calc.dayRate)}/h</strong></div>
      <div><span>Nocturnos</span><strong>${calc.nightMen} · ${moneyRD(calc.nightRate)}/h</strong></div>
      <div><span>Horas / día</span><strong>${calc.hoursPerDay}</strong></div>
      <div><span>Horas / mes</span><strong>${calc.hoursMonth.toLocaleString("es-DO")}</strong></div>
      <div><span>Bruto día</span><strong>${moneyRD(calc.dayGross)}</strong></div>
      <div><span>Bruto noche</span><strong>${moneyRD(calc.nightGross)}</strong></div>
      <div><span>Bruto total</span><strong>${moneyRD(calc.gross)}</strong></div>
      <div><span>Desc. día</span><strong>${calc.dayDiscount ? "− " + moneyRD(calc.dayDiscount) : "—"}</strong></div>
      <div><span>Desc. noche</span><strong>${calc.nightDiscount ? "− " + moneyRD(calc.nightDiscount) : "—"}</strong></div>
      <div><span>Desc. total</span><strong>${calc.discount ? "− " + moneyRD(calc.discount) : "—"}</strong></div>
      <div><span>Subtotal</span><strong>${moneyRD(calc.subtotal)}</strong></div>
      <div><span>${calc.includeItbis ? "ITBIS 18%" : "ITBIS"}</span><strong>${
        calc.includeItbis ? moneyRD(calc.itbis) : "No incluido"
      }</strong></div>
      <div><span>Total mensual</span><strong>${moneyRD(calc.total)}</strong></div>
    </div>
    <p class="muted tight" style="margin-top:8px">Cada hombre = ${QUOTE_HOURS_PER_MAN} h · Cálculo a ${QUOTE_DAYS} días${
      calc.includeItbis ? "" : " · sin ITBIS"
    }</p>`;
}

function selectQuoteModel(modelId) {
  selectedQuoteModel = QUOTE_MODELS.some((m) => m.id === modelId) ? modelId : "ejecutiva";
  document.querySelectorAll(".quote-model-card").forEach((card) => {
    card.classList.toggle("active", card.dataset.model === selectedQuoteModel);
  });
  updateQuoteTotalsUi();
}

function renderQuoteModelCards() {
  const box = document.getElementById("quoteModelCards");
  if (!box) return;
  box.innerHTML = QUOTE_MODELS.map(
    (m) => `<button type="button" class="quote-model-card${m.id === selectedQuoteModel ? " active" : ""}" data-model="${m.id}">
      <strong>${escapeHtml(m.label)}</strong>
      <span>${escapeHtml(m.blurb)}</span>
    </button>`
  ).join("");
  box.querySelectorAll(".quote-model-card").forEach((btn) => {
    btn.addEventListener("click", () => selectQuoteModel(btn.dataset.model));
  });
}

function renderQuotesHistory() {
  const list = document.getElementById("quoteHistoryList");
  if (!list) return;
  const items = loadQuotesHistory();
  if (!items.length) {
    list.innerHTML = `<p class="empty">Aún no hay cotizaciones guardadas en este equipo.</p>`;
    return;
  }
  list.innerHTML = items
    .map((q) => {
      const calc = calcQuoteTotals(q);
      const model = QUOTE_MODELS.find((m) => m.id === q.modelId);
      const creator = q.createdBy || q.createdByUsername || "—";
      const when = q.createdAt
        ? new Date(q.createdAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })
        : q.date || "";
      return `<article class="report-card">
        <h3>${escapeHtml(q.clientName || "Sin cliente")}</h3>
        <p class="muted">${escapeHtml(model?.label || q.modelId)} · ${escapeHtml(q.date || "")} · ${escapeHtml(
        quoteShiftLabel(calc)
      )} · ${calc.hoursPerDay} h/día</p>
        <p class="quote-creator-line">Creada por: <strong>${escapeHtml(creator)}</strong>${
          when ? ` · ${escapeHtml(when)}` : ""
        }</p>
        <p><strong>${moneyRD(calc.total)}</strong> <span class="muted">${
          calc.includeItbis ? "(con ITBIS)" : "(sin ITBIS)"
        }</span></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          <button type="button" class="btn secondary btn-quote-load" data-id="${escapeHtml(q.id)}" style="width:auto;padding:8px 10px;font-size:12px">Cargar</button>
          <button type="button" class="btn primary btn-quote-reprint" data-id="${escapeHtml(q.id)}" style="width:auto;padding:8px 10px;font-size:12px">Imprimir</button>
          <button type="button" class="btn secondary btn-quote-wa" data-id="${escapeHtml(q.id)}" style="width:auto;padding:8px 10px;font-size:12px">WhatsApp PDF</button>
          <button type="button" class="btn secondary btn-quote-mail" data-id="${escapeHtml(q.id)}" style="width:auto;padding:8px 10px;font-size:12px">Correo PDF</button>
          <button type="button" class="btn danger btn-quote-delete" data-id="${escapeHtml(q.id)}" style="width:auto;padding:8px 10px;font-size:12px">Eliminar</button>
        </div>
      </article>`;
    })
    .join("");
  list.querySelectorAll(".btn-quote-load").forEach((btn) => {
    btn.addEventListener("click", () => loadQuoteIntoForm(btn.dataset.id));
  });
  list.querySelectorAll(".btn-quote-reprint").forEach((btn) => {
    btn.addEventListener("click", () => reprintSavedQuote(btn.dataset.id));
  });
  list.querySelectorAll(".btn-quote-wa").forEach((btn) => {
    btn.addEventListener("click", () => shareQuoteByWhatsApp(btn.dataset.id));
  });
  list.querySelectorAll(".btn-quote-mail").forEach((btn) => {
    btn.addEventListener("click", () => shareQuoteByEmail(btn.dataset.id));
  });
  list.querySelectorAll(".btn-quote-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteSavedQuote(btn.dataset.id));
  });
}

function deleteSavedQuote(id) {
  const q = quotesHistory.find((x) => x.id === id);
  if (!q) return;
  const label = q.clientName || "esta cotización";
  if (!confirm(`¿Eliminar la cotización de ${label}?`)) return;
  quotesHistory = quotesHistory.filter((x) => x.id !== id);
  saveQuotesHistory();
  renderQuotesHistory();
  if (typeof logActivity === "function") {
    logActivity("quote_delete", `Cotización eliminada: ${label}`);
  }
  toast("Cotización eliminada.");
}

function fillQuoteForm(data) {
  const d = { ...emptyQuoteForm(), ...(data || {}) };
  // Migrar historial viejo
  if ((d.dayMen == null || d.nightMen == null) && d.menCount) {
    d.dayMen = Number(d.menCount) || 1;
    d.nightMen = 0;
  }
  selectedQuoteModel = d.modelId || "ejecutiva";
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };
  set("quoteClientName", d.clientName || "");
  set("quoteClientRnc", d.clientRnc || "");
  set("quoteAttentionTo", d.attentionTo || "");
  set("quoteDayMen", d.dayMen ?? 1);
  set("quoteNightMen", d.nightMen ?? 0);
  const legacyRate = d.hourlyRate ?? 155;
  set("quoteDayRate", d.dayHourlyRate != null ? d.dayHourlyRate : legacyRate);
  set("quoteNightRate", d.nightHourlyRate != null ? d.nightHourlyRate : legacyRate);
  // Migrar descuento global viejo → día (si no hay split)
  let dayDiscType = d.dayDiscountType;
  let nightDiscType = d.nightDiscountType;
  let dayDiscVal = d.dayDiscountValue;
  let nightDiscVal = d.nightDiscountValue;
  if (dayDiscType == null && nightDiscType == null && d.discountType && d.discountType !== "none" && d.discountType !== "split") {
    dayDiscType = d.discountType;
    dayDiscVal = d.discountValue || 0;
    nightDiscType = "none";
    nightDiscVal = 0;
  }
  set("quoteDayDiscountType", dayDiscType || "none");
  set("quoteDayDiscountValue", dayDiscVal || 0);
  set("quoteNightDiscountType", nightDiscType || "none");
  set("quoteNightDiscountValue", nightDiscVal || 0);
  set("quoteNote", d.note || "");
  set("quoteDate", d.date || new Date().toISOString().slice(0, 10));
  const itbisEl = document.getElementById("quoteIncludeItbis");
  if (itbisEl) itbisEl.checked = d.includeItbis !== false;
  renderQuoteModelCards();
  toggleQuoteDiscountField();
  updateQuoteTotalsUi();
}

function loadQuoteIntoForm(id) {
  const q = quotesHistory.find((x) => x.id === id);
  if (!q) return;
  fillQuoteForm(q);
  toast("Cotización cargada. Puedes ajustar e imprimir.");
}

function reprintSavedQuote(id) {
  const q = quotesHistory.find((x) => x.id === id);
  if (!q) return;
  printQuoteProposal(q);
}

function toggleQuoteDiscountField() {
  const dayType = document.getElementById("quoteDayDiscountType")?.value || "none";
  const nightType = document.getElementById("quoteNightDiscountType")?.value || "none";
  const dayWrap = document.getElementById("quoteDayDiscountValueWrap");
  const nightWrap = document.getElementById("quoteNightDiscountValueWrap");
  if (dayWrap) dayWrap.hidden = dayType === "none";
  if (nightWrap) nightWrap.hidden = nightType === "none";
}

function validateQuoteForm(data, calc) {
  if (!data.clientName) {
    toast("Escribe el nombre del cliente.");
    return false;
  }
  if (!calc.men || calc.men < 1) {
    toast("Indica al menos 1 hombre en Día y/o Noche.");
    return false;
  }
  if (calc.dayMen > 0 && (!calc.dayRate || calc.dayRate <= 0)) {
    toast("Indica el precio por hora del turno de día.");
    return false;
  }
  if (calc.nightMen > 0 && (!calc.nightRate || calc.nightRate <= 0)) {
    toast("Indica el precio por hora del turno de noche.");
    return false;
  }
  if ((!calc.dayMen || calc.dayMen <= 0) && (!calc.nightMen || calc.nightMen <= 0)) {
    toast("Indica al menos 1 hombre en Día y/o Noche.");
    return false;
  }
  return true;
}

function persistQuote(data, calc) {
  const existing = data.id ? quotesHistory.find((q) => q.id === data.id) : null;
  const now = new Date().toISOString();
  const row = {
    ...data,
    id: data.id || `quote-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: (existing && existing.createdAt) || data.createdAt || now,
    createdBy: (existing && existing.createdBy) || data.createdBy || currentQuoteUserLabel(),
    createdByUsername:
      (existing && existing.createdByUsername) || data.createdByUsername || currentQuoteUsername(),
    updatedAt: now,
    updatedBy: currentQuoteUserLabel(),
    menCount: calc.men,
    total: calc.total,
  };
  // Nunca enviar createdBy al PDF del cliente: solo vive en historial interno
  quotesHistory = [row, ...quotesHistory.filter((q) => q.id !== row.id)].slice(0, 80);
  saveQuotesHistory();
  renderQuotesHistory();
  lastSharedQuoteId = row.id;
  showQuoteShareBox(row);
  return row;
}

function showQuoteShareBox(row) {
  const box = document.getElementById("quoteShareBox");
  const hint = document.getElementById("quoteShareHint");
  if (!box) return;
  box.hidden = false;
  if (hint) {
    hint.textContent = `Propuesta de ${row.clientName || "cliente"} lista · Creada por ${
      row.createdBy || "—"
    }. WhatsApp y correo envían el PDF de la propuesta.`;
  }
}

/** Título corto para WhatsApp / correo / nombre del PDF (el detalle va en el adjunto). */
function quoteShareCaption(data, calc) {
  return `Propuesta de seguridad — ${data.clientName || "Cliente"} · ${moneyRD(
    (calc && calc.total) || data.total || 0
  )} · Reaction Force Security`;
}

function quotePdfFileName(data) {
  const client = String((data && data.clientName) || "cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const day = String((data && data.date) || new Date().toISOString().slice(0, 10)).slice(0, 10);
  return `propuesta-rfs-${client || "cliente"}-${day}.pdf`;
}

function quoteLogoUrl() {
  try {
    return new URL("logo.jpg", window.location.href).href;
  } catch (_) {
    return "logo.jpg";
  }
}

/**
 * html2canvas ignora el CSS y pinta cada JPG a su tamaño real.
 * El logo mide 1500×1500 y tapa toda la cotización. Aquí se achica antes.
 */
async function rasterizeQuoteImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          const finish = () => resolve();
          const go = () => {
            const nw = img.naturalWidth || 0;
            const nh = img.naturalHeight || 0;
            if (!nw || !nh) {
              finish();
              return;
            }
            const brand = !!(img.closest && img.closest(".brand"));
            const rect = img.getBoundingClientRect();
            const laidW = Math.round(rect.width || 0);
            const laidH = Math.round(rect.height || 0);
            const maxW = brand ? (laidW >= 40 && laidW <= 140 ? laidW : 72) : 640;
            const maxH = brand ? (laidH >= 40 && laidH <= 140 ? laidH : 72) : 880;
            let tw = maxW;
            let th = brand ? maxH : Math.max(1, Math.round((nh * tw) / nw));
            if (!brand) {
              const rect = img.getBoundingClientRect();
              const rw = Math.round(rect.width || 0);
              const rh = Math.round(rect.height || 0);
              if (rw >= 80 && rw <= maxW && rh >= 40 && rh <= maxH) {
                tw = rw;
                th = rh;
              } else if (th > maxH) {
                th = maxH;
                tw = Math.max(80, Math.round((nw * th) / nh));
              }
            }
            img.setAttribute("width", String(tw));
            img.setAttribute("height", String(th));
            img.style.width = `${tw}px`;
            img.style.height = `${th}px`;
            img.style.maxWidth = `${tw}px`;
            img.style.maxHeight = `${th}px`;
            img.style.objectFit = "contain";
            img.style.display = "block";
            if (nw <= tw + 2 && nh <= th + 2) {
              finish();
              return;
            }
            try {
              const canvas = document.createElement("canvas");
              canvas.width = tw;
              canvas.height = th;
              const ctx = canvas.getContext("2d");
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(0, 0, tw, th);
              const scale = Math.min(tw / nw, th / nh);
              const dw = Math.max(1, Math.round(nw * scale));
              const dh = Math.max(1, Math.round(nh * scale));
              ctx.drawImage(img, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
              img.src = canvas.toDataURL("image/jpeg", 0.9);
            } catch (_) {}
            finish();
          };
          if (img.complete && img.naturalWidth) go();
          else {
            img.onload = go;
            img.onerror = finish;
          }
        })
    )
  );
}

/** Genera el PDF de la misma propuesta que Imprimir (html2pdf en esta ventana). */
async function buildQuotePdfBlob(data, calc) {
  if (typeof ensureHtml2Pdf !== "function") throw new Error("PDF no disponible");
  const html2pdf = await ensureHtml2Pdf();
  const caption = quoteShareCaption(data, calc);
  const host = document.createElement("div");
  host.className = "quote-print";
  host.setAttribute("data-rfs-quote-pdf", "1");
  host.style.cssText =
    "width:700px;max-width:700px;background:#fff;color:#111;padding:16px;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.35;";
  host.innerHTML = `
    <style>
      ${quotePrintCss()}
      [data-rfs-quote-pdf] .brand{display:flex;align-items:center;gap:12px;margin-bottom:14px}
      [data-rfs-quote-pdf] .brand img{width:112px;height:112px;max-width:112px;max-height:112px;object-fit:contain;display:block}
      [data-rfs-quote-pdf] .brand h1{font-size:18px;margin:0 0 2px}
      [data-rfs-quote-pdf] table{width:100%;border-collapse:collapse}
      [data-rfs-quote-pdf] th,td{border:1px solid #333;padding:6px 8px;text-align:left}
      [data-rfs-quote-pdf] .right{text-align:right}
      [data-rfs-quote-pdf] .meta{display:flex;gap:10px;flex-wrap:wrap}
      [data-rfs-quote-pdf] .sign-box{margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:28px}
      [data-rfs-quote-pdf] .sign-line{border-top:2px solid #0b0b0c;margin-top:48px;padding-top:8px;font-size:11px;text-align:center}
      [data-rfs-quote-pdf] ul{padding-left:18px;margin:6px 0}
      [data-rfs-quote-pdf] .q-clients img{width:100%;max-width:640px;height:auto}
    </style>
    <div id="rfsQuotePdfInner" style="width:668px;background:#fff;color:#111;">
      <div class="brand" style="display:block;width:100%;background:#0b0b0c;color:#fff;border-left:6px solid #d41414;padding:12px 14px;margin:0 0 14px;box-sizing:border-box;">
        <img src="${escapeHtml(quoteLogoUrl())}" alt="RFS" width="72" height="72" crossorigin="anonymous"
          style="width:72px;height:72px;max-width:72px;max-height:72px;object-fit:contain;display:block;background:#fff;margin:0 0 8px;" />
        <h1 style="color:#fff;font-size:18px;margin:0 0 2px;">Reaction Force Security</h1>
        <div style="color:#fff;">${escapeHtml(caption)}</div>
      </div>
      ${buildQuoteBodyHtml(data, calc)}
    </div>
  `;
  // Rutas relativas (quote-assets/…) → absolutas para html2canvas
  host.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
    try {
      img.setAttribute("src", new URL(src, window.location.href).href);
    } catch (_) {}
  });
  const prevBodyOverflow = document.body.style.overflow;
  const prevHtmlOverflow = document.documentElement.style.overflow;
  document.body.style.overflow = "visible";
  document.documentElement.style.overflow = "visible";
  document.body.insertBefore(host, document.body.firstChild);
  try {
    if (typeof waitForImages === "function") await waitForImages(host);
    await rasterizeQuoteImages(host);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const target = host.querySelector("#rfsQuotePdfInner") || host;
    const opt = {
      margin: [10, 10, 12, 10],
      filename: quotePdfFileName(data),
      image: { type: "jpeg", quality: 0.92 },
      html2canvas: {
        scale: 1.5,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: "#ffffff",
      },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["css", "legacy"] },
    };
    let blob = null;
    try {
      blob = await html2pdf().set(opt).from(target).outputPdf("blob");
    } catch (_) {
      blob = await html2pdf().set(opt).from(target).toPdf().get("pdf").then((pdf) => pdf.output("blob"));
    }
    if (!blob || !blob.size) throw new Error("PDF vacío");
    return blob;
  } finally {
    document.body.style.overflow = prevBodyOverflow;
    document.documentElement.style.overflow = prevHtmlOverflow;
    host.remove();
  }
}

async function buildQuotePdfFile(data, calc) {
  const blob = await buildQuotePdfBlob(data, calc);
  return new File([blob], quotePdfFileName(data), { type: "application/pdf" });
}

function resolveQuoteForShare(id) {
  if (id) {
    const found = quotesHistory.find((q) => q.id === id);
    if (found) return found;
  }
  if (lastSharedQuoteId) {
    const last = quotesHistory.find((q) => q.id === lastSharedQuoteId);
    if (last) return last;
  }
  const data = readQuoteForm();
  const calc = calcQuoteTotals(data);
  if (!validateQuoteForm(data, calc)) return null;
  return persistQuote(data, calc);
}

async function shareQuoteByWhatsApp(id) {
  const q = resolveQuoteForShare(id);
  if (!q) return;
  const calc = calcQuoteTotals(q);
  const caption = quoteShareCaption(q, calc);
  toast("Preparando PDF de la propuesta para WhatsApp…");
  try {
    const file = await buildQuotePdfFile(q, calc);
    let shared = false;
    if (typeof trySharePdfFile === "function") {
      shared = await trySharePdfFile(file, caption, caption);
    }
    if (shared) {
      toast("Elige WhatsApp en el menú para enviar el PDF.");
    } else {
      if (typeof downloadBlobFile === "function") downloadBlobFile(file, file.name);
      window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
      toast("PDF descargado. Adjúntalo en WhatsApp.");
    }
    if (typeof logActivity === "function") {
      logActivity("quote_share_wa", `Cotización WhatsApp PDF: ${q.clientName} · ${moneyRD(calc.total)}`);
    }
  } catch (err) {
    console.error(err);
    window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
    toast("No se pudo crear el PDF; se abrió WhatsApp solo con el título. Usa Imprimir / PDF.");
  }
}

async function shareQuoteByEmail(id) {
  const q = resolveQuoteForShare(id);
  if (!q) return;
  const calc = calcQuoteTotals(q);
  const caption = quoteShareCaption(q, calc);
  toast("Preparando PDF de la propuesta para correo…");
  try {
    const file = await buildQuotePdfFile(q, calc);
    let shared = false;
    if (typeof trySharePdfFile === "function") {
      shared = await trySharePdfFile(file, caption, caption);
    }
    if (shared) {
      toast("Elige Correo / Gmail en el menú para enviar el PDF.");
    } else {
      if (typeof downloadBlobFile === "function") downloadBlobFile(file, file.name);
      window.location.href = `mailto:?subject=${encodeURIComponent(caption)}&body=${encodeURIComponent(
        `${caption}\n\nAdjunta el PDF descargado (${file.name}).`
      )}`;
      toast("PDF descargado. Adjúntalo al correo.");
    }
    if (typeof logActivity === "function") {
      logActivity("quote_share_mail", `Cotización correo PDF: ${q.clientName} · ${moneyRD(calc.total)}`);
    }
  } catch (err) {
    console.error(err);
    window.location.href = `mailto:?subject=${encodeURIComponent(caption)}&body=${encodeURIComponent(caption)}`;
    toast("No se pudo crear el PDF; se abrió el correo solo con el título. Usa Imprimir / PDF.");
  }
}

function printQuoteProposal(dataIn) {
  if (typeof openPrintWindow !== "function") {
    toast("No se pudo abrir la ventana de impresión.");
    return;
  }
  const data = dataIn || readQuoteForm();
  const calc = calcQuoteTotals(data);
  if (!validateQuoteForm(data, calc)) return;
  const saved = persistQuote(data, calc);
  const model = QUOTE_MODELS.find((m) => m.id === saved.modelId);
  const body = buildQuoteBodyHtml(saved, calc);
  const caption = quoteShareCaption(saved, calc);
  openPrintWindow("Propuesta de servicios de seguridad", body, {
    bodyClass: "quote-print",
    extraCss: quotePrintCss(),
    contentMaxWidth: 700,
    share: {
      text: caption,
      subject: caption,
      fileName: quotePdfFileName(saved),
    },
  });
  if (typeof logActivity === "function") {
    logActivity(
      "quote_print",
      `Cotización ${saved.modelId || model?.id || ""}: ${saved.clientName} · por ${saved.createdBy || "—"} · ${quoteShiftLabel(calc)} · ${calc.hoursPerDay}h/día · ${moneyRD(calc.total)}`
    );
  }
  toast("Propuesta lista. Usa WhatsApp PDF o Correo PDF en la barra, o Imprimir.");
}

function renderQuotesModule() {
  loadQuotesHistory();
  if (!document.getElementById("quoteClientName")?.value && !document.getElementById("quoteDayMen")?.value) {
    fillQuoteForm(emptyQuoteForm());
  } else {
    renderQuoteModelCards();
    updateQuoteTotalsUi();
  }
  renderQuotesHistory();
}

function wireQuotesModule() {
  renderQuoteModelCards();
  fillQuoteForm(emptyQuoteForm());
  renderQuotesHistory();

  [
    "quoteClientName",
    "quoteClientRnc",
    "quoteAttentionTo",
    "quoteDayMen",
    "quoteNightMen",
    "quoteDayRate",
    "quoteNightRate",
    "quoteDayDiscountValue",
    "quoteNightDiscountValue",
    "quoteNote",
    "quoteDate",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateQuoteTotalsUi);
    document.getElementById(id)?.addEventListener("change", updateQuoteTotalsUi);
  });
  document.getElementById("quoteIncludeItbis")?.addEventListener("change", updateQuoteTotalsUi);
  ["quoteDayDiscountType", "quoteNightDiscountType"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      toggleQuoteDiscountField();
      updateQuoteTotalsUi();
    });
  });
  document.getElementById("btnQuotePrint")?.addEventListener("click", () => printQuoteProposal());
  document.getElementById("btnQuoteWhatsApp")?.addEventListener("click", () => shareQuoteByWhatsApp());
  document.getElementById("btnQuoteEmail")?.addEventListener("click", () => shareQuoteByEmail());
  document.getElementById("btnQuoteShareWa")?.addEventListener("click", () => shareQuoteByWhatsApp(lastSharedQuoteId));
  document.getElementById("btnQuoteShareMail")?.addEventListener("click", () => shareQuoteByEmail(lastSharedQuoteId));
  document.getElementById("btnQuoteReset")?.addEventListener("click", () => {
    fillQuoteForm(emptyQuoteForm());
    const box = document.getElementById("quoteShareBox");
    if (box) box.hidden = true;
    lastSharedQuoteId = "";
    toast("Formulario limpio.");
  });
}
