/* ==== MÓDULO RAMÓN VARGAS — reporte diurno/nocturno → Reaction Banco / Efectivo ==== */
const VARGAS_KEY = "rfs-ops-vargas";

let vargasData = emptyVargasData();
let vargasFilterShift = "all"; // all | diurno | nocturno
let vargasFilterBucket = "all"; // all | B | E | none
let vargasSearch = "";
const VARGAS_ACTIVE_KEY = "rfs-ops-vargas-active";
let vargasActiveReportId = "";
try {
  vargasActiveReportId = localStorage.getItem(VARGAS_ACTIVE_KEY) || "";
} catch (_) {}

function emptyVargasData() {
  return { reports: [] };
}

function vargasReportId(period, half) {
  return `vargas-${period}-h${half === 2 ? 2 : 1}`;
}

function cloneVargasSeedReport(seed) {
  const src = seed && typeof seed === "object" ? seed : {};
  const half = src.half === 1 || src.half === "1" ? 1 : 2;
  const period = String(src.period || "").slice(0, 7) || "2026-10";
  const dayNums = Array.isArray(src.dayNums) && src.dayNums.length
    ? src.dayNums.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31)
    : half === 1
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
      : [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
  return {
    id: vargasReportId(period, half),
    period,
    half,
    from: String(src.from || "").slice(0, 10),
    to: String(src.to || "").slice(0, 10),
    label: String(src.label || "").trim(),
    dayNums,
    sections: (Array.isArray(src.sections) ? src.sections : []).map((sec) => ({
      shift: sec.shift === "nocturno" ? "nocturno" : "diurno",
      postName: String(sec.postName || "").trim() || "(sin puesto)",
      employees: (Array.isArray(sec.employees) ? sec.employees : []).map((emp) => ({
        fullName: String(emp.fullName || "").trim(),
        marks: emp.marks && typeof emp.marks === "object" ? { ...emp.marks } : {},
        payBucket: normalizeVargasPayBucket(emp.payBucket),
        payBucketSetAt: normalizeVargasPayBucket(emp.payBucket)
          ? String(emp.payBucketSetAt || "")
          : "",
        volaosPagos: normalizeVargasVolaosPagos(emp.volaosPagos),
        horasExtras: normalizeVargasHorasExtras(emp.horasExtras),
      })),
    })),
    // Fecha vieja: la semilla no puede ganar al reporte de la nube al abrir la app.
    updatedAt: String(src.updatedAt || "2026-10-16T00:00:00.000Z"),
  };
}

function normalizeVargasPayBucket(v) {
  const s = String(v || "")
    .trim()
    .toUpperCase();
  if (s === "B" || s === "BANCO") return "B";
  if (s === "E" || s === "EFECTIVO") return "E";
  return "";
}

/**
 * Casilla "Volaos pagos": control de volaos ya pagados (1 o 2).
 * Nunca entra a nómina — solo registro interno.
 */
function normalizeVargasVolaosPagos(v) {
  if (v == null || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    return Math.min(99, Math.round(v));
  }
  const s = String(v).trim();
  if (!s) return "";
  if (!/^\d+(\.\d+)?$/.test(s)) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "";
  return Math.min(99, Math.round(n));
}

function formatVargasVolaosPagos(v) {
  const n = normalizeVargasVolaosPagos(v);
  return n === "" ? "" : String(n);
}

/**
 * Horas extras en el reporte (ej. 2, 2.3, 12.6).
 * Monto nómina = horas × RD$60, sumado al cálculo previo de horas extras.
 */
function normalizeVargasHorasExtras(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.max(0, Math.min(999, Math.round(v * 100) / 100));
  }
  const s = String(v)
    .trim()
    .replace(",", ".");
  if (!s) return 0;
  if (!/^\d+(\.\d+)?$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(0, Math.min(999, Math.round(n * 100) / 100));
}

function formatVargasHorasExtras(v) {
  const n = normalizeVargasHorasExtras(v);
  if (!n) return "";
  return Number.isInteger(n) ? String(n) : String(n);
}

function vargasHorasExtrasPay(hours) {
  const h = normalizeVargasHorasExtras(hours);
  const rate =
    typeof roundMoney2 === "function"
      ? roundMoney2(h * VARGAS_EXTRA_HOUR_RATE)
      : Math.round(h * VARGAS_EXTRA_HOUR_RATE * 100) / 100;
  return rate;
}

/** Nombre o puesto con "-LA VEGA" → nómina La Vega Autopista, no Reaction General. */
function vargasTextSaysLaVega(text) {
  return /-\s*LA\s+VEGA\b/i.test(String(text || ""));
}

function vargasRowIsLaVega(row) {
  if (!row) return false;
  return vargasTextSaysLaVega(row.fullName) || vargasTextSaysLaVega(row.postName);
}

function vargasStripLaVegaTag(name) {
  return String(name || "")
    .replace(/\s*[-–—]?\s*\(?\s*LA\s+VEGA\s*\)?/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVargasReport(raw = {}) {
  const half = raw.half === 1 || raw.half === "1" ? 1 : 2;
  const period = String(raw.period || "").slice(0, 7);
  const dayNums = Array.isArray(raw.dayNums)
    ? raw.dayNums.map((d) => Number(d)).filter((d) => d >= 1 && d <= 31)
    : [];
  return {
    id: String(raw.id || vargasReportId(period, half)),
    period,
    half,
    from: String(raw.from || "").slice(0, 10),
    to: String(raw.to || "").slice(0, 10),
    label: String(raw.label || "").trim(),
    dayNums,
    sections: (Array.isArray(raw.sections) ? raw.sections : []).map((sec) => ({
      shift: sec.shift === "nocturno" ? "nocturno" : "diurno",
      postName: String(sec.postName || "").trim() || "(sin puesto)",
      employees: (Array.isArray(sec.employees) ? sec.employees : []).map((emp) => ({
        fullName: String(emp.fullName || "").trim(),
        marks: emp.marks && typeof emp.marks === "object" ? { ...emp.marks } : {},
        payBucket: normalizeVargasPayBucket(emp.payBucket),
        payBucketSetAt: normalizeVargasPayBucket(emp.payBucket)
          ? String(emp.payBucketSetAt || "")
          : "",
        volaosPagos: normalizeVargasVolaosPagos(emp.volaosPagos),
        horasExtras: normalizeVargasHorasExtras(emp.horasExtras),
      })),
    })),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

function normalizeVargasData(raw = {}) {
  const reports = (Array.isArray(raw.reports) ? raw.reports : [])
    .map(normalizeVargasReport)
    .filter((r) => r.period && r.sections);
  reports.sort((a, b) => {
    const c = String(b.period).localeCompare(String(a.period));
    if (c) return c;
    return (b.half || 0) - (a.half || 0);
  });
  return { reports };
}

function ensureVargasSeedLoaded() {
  vargasData = normalizeVargasData(vargasData);
  if (vargasData.reports.length) return false;
  const seed = typeof window !== "undefined" ? window.RFS_VARGAS_SEED : null;
  if (!seed || !Array.isArray(seed.sections) || !seed.sections.length) return false;
  const report = cloneVargasSeedReport(seed);
  vargasData = { reports: [report] };
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
  return true;
}

function saveVargasData(push = true) {
  vargasData = normalizeVargasData(vargasData);
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
  if (push && typeof queueCloudSave === "function") queueCloudSave();
}

function vargasEmployeeExactKey(section, emp) {
  const shift = section && section.shift === "nocturno" ? "nocturno" : "diurno";
  const post = vargasNameKey(section && section.postName);
  const name = vargasNameKey(emp && emp.fullName);
  return `${shift}|${post}|${name}`;
}

/** Si los dos lados tienen B/E distinto, gana el que se eligió más tarde. Vacío nunca pisa una elección. */
function pickStickyVargasPayBucket(baseEmp, otherEmp) {
  const baseBucket = normalizeVargasPayBucket(baseEmp && baseEmp.payBucket);
  const otherBucket = normalizeVargasPayBucket(otherEmp && otherEmp.payBucket);
  const baseAt = baseBucket ? String((baseEmp && baseEmp.payBucketSetAt) || "") : "";
  const otherAt = otherBucket ? String((otherEmp && otherEmp.payBucketSetAt) || "") : "";
  if (baseBucket && otherBucket && baseBucket !== otherBucket) {
    if (otherAt > baseAt) return { payBucket: otherBucket, payBucketSetAt: otherAt };
    return { payBucket: baseBucket, payBucketSetAt: baseAt };
  }
  if (baseBucket && otherBucket) {
    return { payBucket: baseBucket, payBucketSetAt: baseAt >= otherAt ? baseAt : otherAt };
  }
  if (baseBucket) return { payBucket: baseBucket, payBucketSetAt: baseAt };
  if (otherBucket) return { payBucket: otherBucket, payBucketSetAt: otherAt };
  return { payBucket: "", payBucketSetAt: "" };
}

function mergeVargasReportSticky(base, other) {
  if (!base) return other;
  if (!other) return base;
  const byExact = new Map();
  const byName = new Map();
  (other.sections || []).forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      byExact.set(vargasEmployeeExactKey(sec, emp), emp);
      const nk = vargasNameKey(emp.fullName);
      if (!nk) return;
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk).push(emp);
    });
  });
  (base.sections || []).forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      let prev = byExact.get(vargasEmployeeExactKey(sec, emp));
      if (!prev) {
        const list = byName.get(vargasNameKey(emp.fullName)) || [];
        if (list.length === 1) prev = list[0];
      }
      if (!prev) return;
      const picked = pickStickyVargasPayBucket(emp, prev);
      emp.payBucket = picked.payBucket;
      emp.payBucketSetAt = picked.payBucketSetAt;
    });
  });
  return base;
}

/** Une reportes. Los días los trae el más reciente. Banco/Efectivo no se borra si el otro lado viene vacío. */
function mergeVargasDataSticky(localRaw, remoteRaw) {
  const local = normalizeVargasData(localRaw || {});
  const remote = normalizeVargasData(remoteRaw || {});
  const map = new Map();
  [...local.reports, ...remote.reports].forEach((r) => {
    if (!r || !r.id) return;
    const prev = map.get(r.id);
    if (!prev) {
      map.set(r.id, r);
      return;
    }
    const prevIsNewer = String(prev.updatedAt || "") > String(r.updatedAt || "");
    const base = prevIsNewer ? prev : r;
    const other = prevIsNewer ? r : prev;
    map.set(r.id, mergeVargasReportSticky(base, other));
  });
  return { reports: [...map.values()] };
}

function applyRemoteVargasData(remote) {
  vargasData = mergeVargasDataSticky(vargasData, remote || {});
  ensureVargasSeedLoaded();
  vargasData = normalizeVargasData(vargasData);
  localStorage.setItem(VARGAS_KEY, JSON.stringify(vargasData));
}

function setActiveVargasReport(id) {
  vargasActiveReportId = String(id || "");
  try {
    localStorage.setItem(VARGAS_ACTIVE_KEY, vargasActiveReportId);
  } catch (_) {}
}

function getActiveVargasReport() {
  ensureVargasSeedLoaded();
  vargasData = normalizeVargasData(vargasData);
  const wanted = vargasData.reports.find((r) => r && r.id === vargasActiveReportId);
  if (wanted) return wanted;
  return vargasData.reports[0] || null;
}

function vargasDaysInMonth(period) {
  const [y, m] = String(period || "").split("-").map((n) => Number(n));
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function vargasQuincenaSpec(period, half) {
  const h = half === 2 || half === "2" ? 2 : 1;
  const per = String(period || "").slice(0, 7);
  const [y, m] = per.split("-").map((n) => Number(n));
  const last = vargasDaysInMonth(per);
  const start = h === 1 ? 1 : 16;
  const end = h === 1 ? 15 : last;
  const dayNums = [];
  for (let d = start; d <= end; d += 1) dayNums.push(d);
  const mm = String(m).padStart(2, "0");
  const pad = (n) => String(n).padStart(2, "0");
  return {
    id: vargasReportId(per, h),
    period: per,
    half: h,
    from: `${y}-${mm}-${pad(start)}`,
    to: `${y}-${mm}-${pad(end)}`,
    label: `DESDE ${start} AL ${end}/${mm}/${y}`,
    dayNums,
  };
}

function vargasQuincenaTitle(report) {
  if (!report) return "";
  const months = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const [y, m] = String(report.period || "").split("-");
  const name = months[(Number(m) || 1) - 1] || report.period;
  const range = report.half === 2 || report.half === "2" ? "16–fin" : "1–15";
  return `${range} ${name} ${y}`;
}

function nextVargasQuincena(report) {
  const period = String((report && report.period) || "").slice(0, 7);
  const half = report && (report.half === 2 || report.half === "2") ? 2 : 1;
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  if (half === 1) return { period, half: 2 };
  const [y, m] = period.split("-").map((n) => Number(n));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { period: `${ny}-${String(nm).padStart(2, "0")}`, half: 1 };
}

function findVargasReport(period, half) {
  const id = vargasReportId(period, half === 2 || half === "2" ? 2 : 1);
  return (vargasData.reports || []).find((r) => r && r.id === id) || null;
}

/** Nueva quincena: mismos empleados y B/E. Días en blanco. La anterior no se toca. */
function createVargasQuincena(period, half, sourceReport) {
  const spec = vargasQuincenaSpec(period, half);
  if ((vargasData.reports || []).some((r) => r && r.id === spec.id)) {
    return { ok: true, existed: true, report: findVargasReport(period, half) };
  }
  const src = sourceReport || null;
  const report = {
    ...spec,
    sections: (src && src.sections ? src.sections : []).map((sec) => ({
      shift: sec.shift === "nocturno" ? "nocturno" : "diurno",
      postName: String(sec.postName || "").trim() || "(sin puesto)",
      employees: (sec.employees || [])
        .map((emp) => {
          const bucket = normalizeVargasPayBucket(emp.payBucket);
          return {
            fullName: String(emp.fullName || "").trim(),
            marks: {},
            payBucket: bucket,
            payBucketSetAt: bucket ? String(emp.payBucketSetAt || "") : "",
            volaosPagos: "",
            horasExtras: 0,
          };
        })
        .filter((emp) => emp.fullName),
    })),
    updatedAt: new Date().toISOString(),
  };
  vargasData.reports = vargasData.reports || [];
  vargasData.reports.push(report);
  saveVargasData(true);
  return { ok: true, existed: false, report: findVargasReport(period, half) || report };
}

/** Abre 1–15 de noviembre 2026 si todavía no existe. No modifica octubre. */
function ensureVargasNovember2026() {
  vargasData = normalizeVargasData(vargasData);
  if (findVargasReport("2026-11", 1)) return false;
  const src =
    findVargasReport("2026-10", 2) ||
    (vargasData.reports || [])[0] ||
    null;
  if (!src) return false;
  const created = createVargasQuincena("2026-11", 1, src);
  if (created && created.ok && !created.existed) setActiveVargasReport("vargas-2026-11-h1");
  return !!(created && created.ok && !created.existed);
}

function openNextVargasQuincena() {
  const current = getActiveVargasReport();
  if (!current) return { ok: false, reason: "no-report" };
  const next = nextVargasQuincena(current);
  if (!next) return { ok: false, reason: "no-next" };
  const spec = vargasQuincenaSpec(next.period, next.half);
  const existing = findVargasReport(next.period, next.half);
  if (existing) {
    setActiveVargasReport(existing.id);
    return { ok: true, existed: true, report: existing, title: vargasQuincenaTitle(existing) };
  }
  const created = createVargasQuincena(next.period, next.half, current);
  if (!created || !created.ok) return { ok: false, reason: "fail" };
  setActiveVargasReport(spec.id);
  return { ok: true, existed: false, report: created.report, title: vargasQuincenaTitle(spec) };
}

/** Marca 2 en el reporte = 1 día trabajado + RD$850 en Volaos (sin sumar día extra). */
const VARGAS_VOLAO_MARK = 2;
const VARGAS_VOLAO_AMOUNT = 850;
/** Horas extras del reporte: RD$60 por hora (admite decimales). Se suman al monto ya calculado en nómina. */
const VARGAS_EXTRA_HOUR_RATE = 60;

function vargasMarkIsWorked(mark) {
  if (mark == null || mark === "") return false;
  if (typeof mark === "number") return mark > 0;
  const s = String(mark).trim().toUpperCase();
  if (!s) return false;
  if (/^(FO|INC|N|RENUNCIA|TERMINADO|INICIO)$/i.test(s)) return false;
  if (/RETIRADO/i.test(s)) return false;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0;
}

/** Casilla con número 2 → volao RD$850 (el día sigue contando como 1). */
function vargasMarkIsVolao(mark) {
  if (mark == null || mark === "") return false;
  if (typeof mark === "number") return mark === VARGAS_VOLAO_MARK;
  const s = String(mark).trim();
  if (!s) return false;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n === VARGAS_VOLAO_MARK;
}

/** Días para nómina: cuenta marcas trabajadas (1 o 2 = 1 día); día 31 nunca entra. */
function countVargasPayrollDays(marks, dayNums) {
  const days = Array.isArray(dayNums) ? dayNums : [];
  let n = 0;
  days.forEach((d) => {
    if (Number(d) === 31) return;
    const m = marks && marks[String(d)];
    if (vargasMarkIsWorked(m)) n += 1;
  });
  return n;
}

/** Cuántas casillas tienen 2 → cada una suma RD$850 a Volaos. Día 31 no cuenta. */
function countVargasVolaoMarks(marks, dayNums) {
  const days = Array.isArray(dayNums) ? dayNums : [];
  let n = 0;
  days.forEach((d) => {
    if (Number(d) === 31) return;
    const m = marks && marks[String(d)];
    if (vargasMarkIsVolao(m)) n += 1;
  });
  return n;
}

function vargasVolaosFromMarks(marks, dayNums) {
  return countVargasVolaoMarks(marks, dayNums) * VARGAS_VOLAO_AMOUNT;
}

function formatVargasMarkCell(mark) {
  if (mark == null || mark === "") return "";
  if (typeof mark === "number") {
    if (mark === 0) return "0";
    if (mark === 1) return "1";
    return String(mark);
  }
  return String(mark).trim();
}

function vargasNameKey(name) {
  if (typeof monoPayrollNameKey === "function") return monoPayrollNameKey(name);
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function vargasNamesMatch(a, b) {
  if (typeof monoNamesLooselyMatch === "function") return monoNamesLooselyMatch(a, b);
  const ka = vargasNameKey(a);
  const kb = vargasNameKey(b);
  return !!ka && !!kb && (ka === kb || ka.includes(kb) || kb.includes(ka));
}

function findReactionRosterHit(name, kind) {
  if (typeof getReactionPayrollRoster !== "function") return null;
  const roster = getReactionPayrollRoster(kind === "efectivo" ? "efectivo" : "banco");
  return (roster || []).find((r) => vargasNamesMatch(r.name, name)) || null;
}

function suggestVargasPayBucketsFromRosters(overwrite = false) {
  const report = getActiveVargasReport();
  if (!report) return { filled: 0 };
  let filled = 0;
  report.sections.forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      if (!overwrite && emp.payBucket) return;
      const inB = findReactionRosterHit(emp.fullName, "banco");
      const inE = findReactionRosterHit(emp.fullName, "efectivo");
      let next = "";
      if (inB && !inE) next = "B";
      else if (inE && !inB) next = "E";
      else if (inB && inE) next = "B";
      if (next && emp.payBucket !== next) {
        emp.payBucket = next;
        filled += 1;
      }
    });
  });
  if (filled) {
    report.updatedAt = new Date().toISOString();
    saveVargasData(true);
  }
  return { filled };
}

function setVargasEmployeePayBucket(sectionIdx, empIdx, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return false;
  const section = report.sections[sectionIdx];
  const emp = section.employees[empIdx];
  if (!emp) return false;
  const next = normalizeVargasPayBucket(value);
  const prev = normalizeVargasPayBucket(emp.payBucket);
  // Una vez elegido B o E, no se borra solo. Solo cambia si eligen el otro.
  if (prev && !next) return false;
  if (prev === next) return true;
  emp.payBucket = next;
  emp.payBucketSetAt = new Date().toISOString();
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  stickVargasChoiceOnPayroll(report, section, emp);
  return true;
}

/**
 * Mueve a esa persona a la nómina Banco o Efectivo de este corte.
 * No toca al resto de la nómina.
 */
function stickVargasChoiceOnPayroll(report, section, emp) {
  const bucket = normalizeVargasPayBucket(emp && emp.payBucket);
  if (!bucket || !report || !emp) return;
  if (vargasRowIsLaVega({ fullName: emp.fullName, postName: section && section.postName })) return;
  if (typeof findPayrollByGroup !== "function" || typeof buildPayrollLineFromPerson !== "function") return;
  const period = report.period;
  const half = report.half === 2 || report.half === "2" ? 2 : 1;
  const dropGroup = bucket === "B" ? "efectivo" : "banco";
  const keepGroup = bucket === "B" ? "banco" : "efectivo";
  const keepLabel = bucket === "B" ? "Reaction Banco" : "Reaction Efectivo";
  const other = findPayrollByGroup(period, half, dropGroup, "");
  if (other) dropVargasNamedLines(other, [emp.fullName]);
  const rows = collectVargasPayrollRows(report, bucket).filter((r) =>
    vargasNamesMatch(r.fullName, emp.fullName)
  );
  if (!rows.length) return;
  const payroll = ensureVargasPayrollShell(period, half, keepGroup, keepLabel);
  if (!payroll) return;
  applyVargasRowsToPayroll(payroll, rows, keepLabel, { prune: false });
  if (typeof saveContabilidadData === "function") saveContabilidadData(true);
}

/**
 * Si el reporte perdió B/E, las recupera de la nómina Banco/Efectivo de ese corte
 * (la que ya se armó desde este reporte). No pisa una elección que ya esté.
 */
function restoreVargasPayBucketsFromPayrolls(report) {
  if (!report || typeof findPayrollByGroup !== "function") return 0;
  const period = report.period;
  const half = report.half === 2 || report.half === "2" ? 2 : 1;
  const banco = findPayrollByGroup(period, half, "banco", "");
  const efectivo = findPayrollByGroup(period, half, "efectivo", "");
  const bancoPay = banco && banco.rosterFromVargas ? banco : null;
  const efectivoPay = efectivo && efectivo.rosterFromVargas ? efectivo : null;
  if (!bancoPay && !efectivoPay) return 0;
  const keysOf = (payroll) => {
    const set = new Set();
    (payroll && payroll.lines ? payroll.lines : []).forEach((line) => {
      const k = vargasNameKey(line && line.fullName);
      if (k) set.add(k);
    });
    return set;
  };
  const bancoKeys = keysOf(bancoPay);
  const efectivoKeys = keysOf(efectivoPay);
  let filled = 0;
  (report.sections || []).forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      if (normalizeVargasPayBucket(emp.payBucket)) return;
      if (vargasRowIsLaVega({ fullName: emp.fullName, postName: sec.postName })) return;
      const k = vargasNameKey(emp.fullName);
      if (!k) return;
      const onB = bancoKeys.has(k);
      const onE = efectivoKeys.has(k);
      let next = "";
      let stamp = "";
      if (onB && !onE) {
        next = "B";
        stamp = String((bancoPay && bancoPay.updatedAt) || "");
      } else if (onE && !onB) {
        next = "E";
        stamp = String((efectivoPay && efectivoPay.updatedAt) || "");
      }
      if (!next) return;
      emp.payBucket = next;
      emp.payBucketSetAt = stamp || new Date().toISOString();
      filled += 1;
    });
  });
  if (filled) saveVargasData(true);
  return filled;
}

/** Corrige el nombre en el reporte (misma fila / puesto). */
function setVargasEmployeeName(sectionIdx, empIdx, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return { ok: false, reason: "no-section" };
  const sec = report.sections[sectionIdx];
  const emp = sec.employees && sec.employees[empIdx];
  if (!emp) return { ok: false, reason: "no-emp" };
  const next = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (!next) return { ok: false, reason: "no-name" };
  const prev = String(emp.fullName || "").trim();
  if (vargasNameKey(prev) === vargasNameKey(next) && prev === next) {
    return { ok: true, fullName: next, unchanged: true };
  }
  const dup = (sec.employees || []).some(
    (e, i) => i !== empIdx && vargasNameKey(e.fullName) === vargasNameKey(next)
  );
  if (dup) return { ok: false, reason: "duplicate", fullName: next };
  emp.fullName = next;
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  return { ok: true, fullName: next, previous: prev };
}

/** Guarda/restaura scroll de la vista Vargas (página + tabla) tras re-render. */
function captureVargasScroll() {
  const view = document.getElementById("vargasView");
  const wrap = document.querySelector("#vargasReportHost .vargas-table-wrap");
  return {
    viewTop: view ? view.scrollTop : 0,
    wrapTop: wrap ? wrap.scrollTop : 0,
    wrapLeft: wrap ? wrap.scrollLeft : 0,
  };
}

function restoreVargasScroll(pos) {
  if (!pos) return;
  const apply = () => {
    const view = document.getElementById("vargasView");
    const wrap = document.querySelector("#vargasReportHost .vargas-table-wrap");
    if (view) view.scrollTop = pos.viewTop;
    if (wrap) {
      wrap.scrollTop = pos.wrapTop;
      wrap.scrollLeft = pos.wrapLeft;
    }
  };
  apply();
  requestAnimationFrame(apply);
}

/** Actualiza contadores sin reconstruir la tabla (no mueve el scroll). */
function refreshVargasSummaryBar() {
  const report = getActiveVargasReport();
  const summary = document.getElementById("vargasSummary");
  if (!report) return null;
  const stats = vargasReportStats(report);
  if (summary) {
    summary.textContent = `${report.label || report.period} · ${stats.total} empleados · Diurno ${stats.diurno} · Nocturno ${stats.nocturno}`;
  }
  const shift = document.getElementById("vargasFilterShift");
  if (shift) {
    const optD = shift.querySelector('option[value="diurno"]');
    const optN = shift.querySelector('option[value="nocturno"]');
    if (optD) optD.textContent = `Diurno (${stats.diurno})`;
    if (optN) optN.textContent = `Nocturno (${stats.nocturno})`;
  }
  return stats;
}

/** Si el filtro actual haría desaparecer la fila tras cambiar B/E. */
function vargasBucketChangeLeavesFilter(newBucket) {
  const f = vargasFilterBucket;
  if (f === "all") return false;
  const b = normalizeVargasPayBucket(newBucket);
  if (f === "none") return !!b;
  if (f === "B" || f === "E") return b !== f;
  return false;
}

function addVargasEmployee(opts = {}) {
  const report = getActiveVargasReport();
  if (!report) return { ok: false, reason: "no-report" };
  const fullName = String(opts.fullName || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  const postName = String(opts.postName || "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase() || "(SIN PUESTO)";
  const shift = opts.shift === "nocturno" ? "nocturno" : "diurno";
  const payBucket = normalizeVargasPayBucket(opts.payBucket);
  if (!fullName) return { ok: false, reason: "no-name" };

  let section = (report.sections || []).find(
    (s) => s.shift === shift && String(s.postName || "").trim().toUpperCase() === postName
  );
  if (!section) {
    section = { shift, postName, employees: [] };
    report.sections = report.sections || [];
    report.sections.push(section);
  }
  const dup = (section.employees || []).some((e) => vargasNameKey(e.fullName) === vargasNameKey(fullName));
  if (dup) return { ok: false, reason: "duplicate" };

  section.employees.push({
    fullName,
    marks: {},
    payBucket,
    payBucketSetAt: payBucket ? new Date().toISOString() : "",
    volaosPagos: "",
    horasExtras: 0,
  });
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  const added = section.employees[section.employees.length - 1];
  if (added && added.payBucket) stickVargasChoiceOnPayroll(report, section, added);
  return { ok: true, fullName, postName, shift };
}

/** Solo control: volaos ya pagados. No alimenta días ni Volaos de nómina. */
function setVargasEmployeeVolaosPagos(sectionIdx, empIdx, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return false;
  const emp = report.sections[sectionIdx].employees[empIdx];
  if (!emp) return false;
  const next = normalizeVargasVolaosPagos(value);
  if (emp.volaosPagos === next) return true;
  emp.volaosPagos = next;
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  return true;
}

/** Horas extras del reporte (decimales OK) → nómina RD$60/h sumado al cálculo previo. */
function setVargasEmployeeHorasExtras(sectionIdx, empIdx, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return false;
  const emp = report.sections[sectionIdx].employees[empIdx];
  if (!emp) return false;
  const next = normalizeVargasHorasExtras(value);
  if (emp.horasExtras === next) return true;
  emp.horasExtras = next;
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  return true;
}

function removeVargasEmployee(sectionIdx, empIdx) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return { ok: false };
  const sec = report.sections[sectionIdx];
  const emp = sec.employees && sec.employees[empIdx];
  if (!emp) return { ok: false };
  const name = emp.fullName;
  sec.employees.splice(empIdx, 1);
  if (!sec.employees.length) {
    report.sections.splice(sectionIdx, 1);
  }
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
  return { ok: true, fullName: name };
}

function listVargasPostNames(report, shiftFilter) {
  const set = new Set();
  (report && report.sections ? report.sections : []).forEach((sec) => {
    if (shiftFilter && shiftFilter !== "all" && sec.shift !== shiftFilter) return;
    const p = String(sec.postName || "").trim();
    if (p) set.add(p);
  });
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

function buildVargasPrintHtml(report, rows) {
  const dayNums = report.dayNums || [];
  const dayHeads = dayNums
    .map((d) => `<th class="vd">${d}${Number(d) === 31 ? "*" : ""}</th>`)
    .join("");
  const body = rows
    .map((row, i) => {
      const cells = dayNums
        .map((d) => {
          const mark = row.marks[String(d)];
          const val = formatVargasMarkCell(mark);
          const cls = vargasMarkIsVolao(mark) ? " wk vol" : vargasMarkIsWorked(mark) ? " wk" : "";
          return `<td class="vd${cls}">${escapeVargasHtml(val)}</td>`;
        })
        .join("");
      const daysCell =
        row.volaoMarks > 0 ? `${row.daysPayroll} · V${row.volaosAmount}` : String(row.daysPayroll);
      const pagosCell = formatVargasVolaosPagos(row.volaosPagos) || "—";
      const hexCell = formatVargasHorasExtras(row.horasExtras) || "—";
      return `<tr>
        <td class="right">${i + 1}</td>
        <td>${row.shift === "nocturno" ? "N" : "D"}</td>
        <td>${escapeVargasHtml(row.fullName)}</td>
        <td>${escapeVargasHtml(row.postName)}</td>
        <td class="center">${daysCell}</td>
        <td class="center">${escapeVargasHtml(pagosCell)}</td>
        <td class="center">${escapeVargasHtml(hexCell)}</td>
        ${cells}
      </tr>`;
    })
    .join("");
  const stats = vargasReportStats(report);
  return `
    <h2>${escapeVargasHtml(report.label || report.period)} · Corte ${report.half === 2 ? "16–30" : "01–15"}</h2>
    <div class="meta">
      <div><strong>Empleados:</strong><br/>${stats.total}</div>
      <div><strong>Diurno / Nocturno:</strong><br/>${stats.diurno} / ${stats.nocturno}</div>
    </div>
    <table class="vargas-print-table">
      <thead>
        <tr>
          <th class="right">#</th>
          <th>T</th>
          <th>Empleado</th>
          <th>Puesto</th>
          <th>Días</th>
          <th>Volaos pagos</th>
          <th>Horas ext.</th>
          ${dayHeads}
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="${8 + dayNums.length}">Sin empleados</td></tr>`}</tbody>
    </table>
    <p class="footer">* Día 31 no entra en nómina. 1 = turno; 2 = +RD$${VARGAS_VOLAO_AMOUNT} volao. Volaos pagos = control. Horas ext. = horas × RD$${VARGAS_EXTRA_HOUR_RATE} sumadas a Horas extras de nómina.</p>
    <div class="sign-box">
      <div class="sign-line">Ramón Vargas / Supervisión</div>
      <div class="sign-line">Operaciones RFS</div>
    </div>`;
}

function printVargasReport() {
  if (typeof canAccessVargas === "function" && !canAccessVargas()) {
    if (typeof toast === "function") toast("Sin acceso a Ramón Vargas.");
    return;
  }
  const report = getActiveVargasReport();
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Vargas para imprimir.");
    return;
  }
  if (typeof openPrintWindow !== "function") {
    if (typeof toast === "function") toast("Impresión no disponible.");
    return;
  }
  const rows = flattenVargasEmployees(report, {
    shift: vargasFilterShift,
    bucket: vargasFilterBucket,
    search: vargasSearch,
  });
  const title = `Reporte Ramón Vargas — ${report.label || report.period}`;
  const stamp = new Date().toISOString().slice(0, 10);
  openPrintWindow(title, buildVargasPrintHtml(report, rows), {
    pageSize: "legal",
    orientation: "landscape",
    wide: true,
    autoPrint: false,
    share: {
      subject: title,
      text: `Reporte Ramón Vargas ${report.label || report.period} · ${rows.length} empleados · Reaction Force Security`,
      fileName: `vargas-reporte-${report.period}-h${report.half}-${stamp}.pdf`,
    },
    extraCss: `
      .vargas-print-table{font-size:9px}
      .vargas-print-table th,.vargas-print-table td{padding:3px 4px;white-space:nowrap}
      .vargas-print-table th.vd,.vargas-print-table td.vd{text-align:center;min-width:1.4em}
      .vargas-print-table td.wk{font-weight:700;background:#e8f8ee}
      .center{text-align:center}
    `,
  });
}

function setVargasEmployeeMark(sectionIdx, empIdx, day, value) {
  const report = getActiveVargasReport();
  if (!report || !report.sections[sectionIdx]) return;
  const emp = report.sections[sectionIdx].employees[empIdx];
  if (!emp) return;
  const key = String(day);
  const raw = String(value == null ? "" : value).trim();
  if (!raw) {
    delete emp.marks[key];
  } else if (/^\d+(\.\d+)?$/.test(raw)) {
    emp.marks[key] = Number(raw);
  } else {
    emp.marks[key] = raw;
  }
  report.updatedAt = new Date().toISOString();
  saveVargasData(true);
}

function flattenVargasEmployees(report, opts = {}) {
  const rows = [];
  if (!report) return rows;
  const shift = opts.shift || "all";
  const bucket = opts.bucket || "all";
  const q = String(opts.search || "")
    .trim()
    .toLowerCase();
  (report.sections || []).forEach((sec, sIdx) => {
    if (shift !== "all" && sec.shift !== shift) return;
    (sec.employees || []).forEach((emp, eIdx) => {
      if (bucket === "none" && emp.payBucket) return;
      if (bucket === "B" && emp.payBucket !== "B") return;
      if (bucket === "E" && emp.payBucket !== "E") return;
      if (q) {
        const hay = `${emp.fullName} ${sec.postName}`.toLowerCase();
        if (!hay.includes(q)) return;
      }
      const volaoMarks = countVargasVolaoMarks(emp.marks, report.dayNums);
      const horasExtras = normalizeVargasHorasExtras(emp.horasExtras);
      rows.push({
        sectionIdx: sIdx,
        empIdx: eIdx,
        shift: sec.shift,
        postName: sec.postName,
        fullName: emp.fullName,
        marks: emp.marks || {},
        payBucket: emp.payBucket || "",
        volaosPagos: normalizeVargasVolaosPagos(emp.volaosPagos),
        horasExtras,
        horasExtrasPay: vargasHorasExtrasPay(horasExtras),
        daysPayroll: countVargasPayrollDays(emp.marks, report.dayNums),
        volaoMarks,
        volaosAmount: volaoMarks * VARGAS_VOLAO_AMOUNT,
      });
    });
  });
  return rows;
}

function vargasReportStats(report) {
  const rows = flattenVargasEmployees(report, { shift: "all", bucket: "all" });
  return {
    total: rows.length,
    banco: rows.filter((r) => r.payBucket === "B").length,
    efectivo: rows.filter((r) => r.payBucket === "E").length,
    sinMarca: rows.filter((r) => !r.payBucket).length,
    diurno: rows.filter((r) => r.shift === "diurno").length,
    nocturno: rows.filter((r) => r.shift === "nocturno").length,
  };
}

/**
 * Restaura nombres y apellidos completos del reporte Vargas en una nómina
 * Reaction / Banco / Efectivo (si el período/corte coinciden).
 * No crea ni elimina filas; solo alarga el nombre cuando hay match.
 */
function expandPayrollNamesFromVargas(payroll, opts = {}) {
  if (!payroll) return false;
  const g = String(payroll.group || "").trim();
  const lavegaFromVargas = g === "lavega" && !!payroll.rosterFromVargas;
  if (g !== "reaction" && g !== "banco" && g !== "efectivo" && !lavegaFromVargas) return false;
  if (
    typeof payrollKeepsFullVargasNames === "function" &&
    !payrollKeepsFullVargasNames(payroll) &&
    !lavegaFromVargas
  ) {
    return false;
  }
  const report = opts.report || getActiveVargasReport();
  if (!report) return false;
  const perP = String(payroll.period || "").slice(0, 7);
  const perR = String(report.period || "").slice(0, 7);
  if (!perP || perP !== perR) return false;
  const halfP = payroll.half === 2 || payroll.half === "2" ? 2 : 1;
  const halfR = report.half === 2 || report.half === "2" ? 2 : 1;
  if (halfP !== halfR) return false;

  let bucketFilter = "all";
  if (g === "banco") bucketFilter = "B";
  else if (g === "efectivo") bucketFilter = "E";
  let rows = collectVargasPayrollRows(report, bucketFilter);
  if (g === "lavega") rows = rows.filter(vargasRowIsLaVega);
  if (!rows.length) return false;

  let changed = false;
  (payroll.lines || []).forEach((line) => {
    if (!line) return;
    const cur = String(line.fullName || "").trim();
    if (!cur) return;
    const hit = rows.find((r) => {
      const raw = String(r.fullName || "");
      const stripped = vargasStripLaVegaTag(raw);
      return vargasNamesMatch(raw, cur) || (stripped && vargasNamesMatch(stripped, cur));
    });
    if (!hit) return;
    let next = vargasStripLaVegaTag(String(hit.fullName || "").trim());
    if (typeof payrollCleanEmployeeName === "function") {
      next = payrollCleanEmployeeName(next) || next;
    }
    if (!next || next === cur) return;
    const curHadTag = vargasStripLaVegaTag(cur) !== cur;
    // Preferir el nombre más completo del reporte (más tokens / más largo)
    const curParts = cur.split(/\s+/).filter(Boolean).length;
    const nextParts = next.split(/\s+/).filter(Boolean).length;
    if (!curHadTag && nextParts < curParts && next.length <= cur.length) return;
    line.fullName = next;
    line.fromVargasReport = true;
    changed = true;
  });
  if (g === "lavega") {
    const sorted = sortVargasLinesByName(payroll.lines);
    const moved = sorted.some((line, i) => line !== payroll.lines[i]);
    if (moved) {
      payroll.lines = sorted;
      changed = true;
    }
  }
  return changed;
}

function sortVargasLinesByName(lines) {
  return [...(lines || [])].sort((a, b) =>
    String((a && a.fullName) || "").localeCompare(String((b && b.fullName) || ""), "es", {
      sensitivity: "base",
    })
  );
}

/** Filas del reporte Vargas listas para nómina (días sin 31). */
function collectVargasPayrollRows(report, bucketFilter = "all") {
  const rows = [];
  const seen = new Set();
  (report.sections || []).forEach((sec) => {
    (sec.employees || []).forEach((emp) => {
      const bucket = normalizeVargasPayBucket(emp.payBucket);
      if (bucketFilter === "B" && bucket !== "B") return;
      if (bucketFilter === "E" && bucket !== "E") return;
      if (bucketFilter === "marked" && bucket !== "B" && bucket !== "E") return;
      const displayName =
        typeof payrollCleanEmployeeName === "function"
          ? payrollCleanEmployeeName(emp.fullName)
          : String(emp.fullName || "").trim();
      const key = vargasNameKey(displayName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      // Volaos a nómina = marcas "2" en días. "volaosPagos" es solo control (ya pagados).
      const volaoMarks = countVargasVolaoMarks(emp.marks, report.dayNums);
      const horasExtras = normalizeVargasHorasExtras(emp.horasExtras);
      rows.push({
        fullName: displayName,
        postName: sec.postName,
        shift: sec.shift,
        payBucket: bucket,
        daysCount: countVargasPayrollDays(emp.marks, report.dayNums),
        volaoMarks,
        volaosAmount: volaoMarks * VARGAS_VOLAO_AMOUNT,
        horasExtras,
        horasExtrasPay: vargasHorasExtrasPay(horasExtras),
      });
    });
  });
  return rows;
}

/** Crea nómina vacía del grupo (sin sembrar roster viejo / mal escrito). */
function ensureVargasPayrollShell(period, half, group, label) {
  if (typeof contabilidadData === "undefined" || !contabilidadData) return null;
  contabilidadData.payrolls = contabilidadData.payrolls || [];
  let payroll =
    typeof findPayrollByGroup === "function" ? findPayrollByGroup(period, half, group, "") : null;
  if (payroll) return payroll;
  if (typeof normalizePayroll !== "function") return null;
  const payDate =
    typeof payrollPayDateFor === "function" ? payrollPayDateFor(period, half) : `${period}-20`;
  payroll = normalizePayroll({
    period,
    half,
    group,
    tanda: "",
    payDate,
    status: "draft",
    lines: [],
    note: `Nómina ${label} · ${half === 2 ? "16–30" : "01–15"} · desde reporte Vargas`,
    createdBy:
      typeof currentUser !== "undefined" && currentUser
        ? currentUser.displayName || currentUser.username
        : "",
  });
  contabilidadData.payrolls.unshift(payroll);
  return payroll;
}

const VARGAS_TYPED_MONEY_FIELDS = ["adelantos", "prestamos", "incentivos", "almuerzo", "feriado"];

function vargasDonorLinesForMoney(payroll, displayName) {
  if (!payroll || typeof findPayrollByGroup !== "function") return [];
  const period = payroll.period;
  const half = payroll.half === 2 || payroll.half === "2" ? 2 : 1;
  const out = [];
  ["reaction", "banco", "efectivo", "lavega"].forEach((group) => {
    if (group === String(payroll.group || "")) return;
    const other = findPayrollByGroup(period, half, group, "");
    if (!other) return;
    const hit = (other.lines || []).find((l) => {
      if (!l) return false;
      const a = vargasStripLaVegaTag(l.fullName);
      const b = vargasStripLaVegaTag(displayName);
      return vargasNamesMatch(l.fullName, displayName) || (a && b && vargasNamesMatch(a, b));
    });
    if (hit) out.push(hit);
  });
  return out;
}

/** Si el monto está en 0, lo toma de otra nómina del mismo corte. No pisa un monto ya escrito. */
function fillVargasTypedMoney(line, payroll, displayName) {
  if (!line) return line;
  const donors = vargasDonorLinesForMoney(payroll, displayName);
  VARGAS_TYPED_MONEY_FIELDS.forEach((field) => {
    if (Number(line[field]) > 0) return;
    const donor = donors.find((d) => Number(d[field]) > 0);
    if (!donor) return;
    line[field] = donor[field];
  });
  if (!String(line.cedula || "").trim()) {
    const donor = donors.find((d) => String(d.cedula || "").trim());
    if (donor) line.cedula = donor.cedula;
  }
  return line;
}

/**
 * Aplica filas Vargas a una nómina.
 * prune=true: deja SOLO a quienes están en el reporte (elimina mal escritos / sobrantes).
 * Conserva adelantos, préstamos y extras manuales.
 */
function applyVargasRowsToPayroll(payroll, rows, label, opts = {}) {
  if (!payroll || typeof buildPayrollLineFromPerson !== "function") {
    return { changed: false, linesTouched: 0, removed: 0, kept: 0 };
  }
  const prune = opts.prune !== false;
  const formulaOpts =
    typeof payrollComputeOpts === "function" ? payrollComputeOpts(payroll) : {};
  // Reaction / Banco / Efectivo: nombre completo. La Vega: nombre sin la etiqueta -LA VEGA.
  if (opts.keepFullName !== false) formulaOpts.keepFullName = true;
  const rosterKind = payroll.group === "efectivo" ? "efectivo" : "banco";
  const prevByName = new Map();
  (payroll.lines || []).forEach((l) => {
    if (!l) return;
    const nk = vargasNameKey(l.fullName);
    if (nk) prevByName.set(nk, l);
  });

  const nextLines = [];
  const usedKeys = new Set();
  let linesTouched = 0;
  let changed = false;

  rows.forEach((row) => {
    const displayName = String(row.fullName || "").trim();
    const nameKey = vargasNameKey(displayName);
    if (!nameKey || usedKeys.has(nameKey)) return;
    usedKeys.add(nameKey);

    let line =
      prevByName.get(nameKey) ||
      (payroll.lines || []).find((l) => vargasNamesMatch(l.fullName, displayName)) ||
      null;
    if (!line && row.seedLine) {
      line = { ...row.seedLine, fullName: displayName };
    }

    const rosterHit =
      typeof findReactionRosterHit === "function"
        ? findReactionRosterHit(displayName, rosterKind)
        : null;
    let keepAdelantos = line ? Math.max(0, Number(line.adelantos) || 0) : 0;
    let keepPrestamos = line ? Math.max(0, Number(line.prestamos) || 0) : 0;
    const keepExtrasManual = !!(line && line.horasExtrasManual);
    const keepExtras = keepExtrasManual ? Math.max(0, Number(line.horasExtras) || 0) : null;
    // Quitar el tramo Vargas previo para no duplicar al re-sincronizar.
    const prevVargasExtraPay = Math.max(0, Number(line && line.vargasExtraPay) || 0);
    const manualExtrasBase = keepExtrasManual
      ? Math.max(0, (keepExtras || 0) - prevVargasExtraPay)
      : null;

    // Marca 2 → Volaos RD$850 c/u. Horas extras reporte → +RD$60/h sobre el cálculo previo.
    const nextVolaos = Math.max(0, Number(row.volaosAmount) || 0);
    const nextExtraHours = normalizeVargasHorasExtras(row.horasExtras);
    const nextVargasExtraPay = Math.max(0, Number(row.horasExtrasPay) || vargasHorasExtrasPay(nextExtraHours));

    if (!line) {
      const person = rosterHit
        ? {
            ...rosterHit,
            name: displayName,
            position: rosterHit.position || row.postName || label,
            daysWorked: String(row.daysCount),
            volaos: nextVolaos,
          }
        : {
            id: "",
            employeeId: "",
            name: displayName,
            position: row.postName || label,
            salaryMonthly:
              typeof LVA_PAYROLL_DEFAULT_MONTHLY !== "undefined" ? LVA_PAYROLL_DEFAULT_MONTHLY : 24000,
            daysWorked: String(row.daysCount),
            volaos: nextVolaos,
          };
      line = buildPayrollLineFromPerson(person, null, label, formulaOpts);
      changed = true;
      linesTouched += 1;
    }

    const nextDays = String(Math.max(0, Number(row.daysCount) || 0));
    const prevDays = String(line.daysWorked || "").trim();
    const prevVolaos = Math.max(0, Number(line.volaos) || 0);
    const prevExtraHours = normalizeVargasHorasExtras(line.vargasExtraHours);
    if (
      prevDays !== nextDays ||
      prevVolaos !== nextVolaos ||
      prevExtraHours !== nextExtraHours ||
      prevVargasExtraPay !== nextVargasExtraPay ||
      !line.daysFromVargas ||
      line.fullName !== displayName
    ) {
      line.daysWorked = nextDays;
      line.volaos = nextVolaos;
      line.daysFromVargas = true;
      line.fromVargasReport = true;
      line.fullName = displayName;
      if (row.postName && (!line.position || /reaction/i.test(String(line.position)))) {
        line.position = row.postName;
      }
      changed = true;
      linesTouched += 1;
    }

    // Días y volaos vienen del reporte. Adelantos, préstamos, incentivos y comida no se borran.
    fillVargasTypedMoney(line, payroll, displayName);
    keepAdelantos = Math.max(keepAdelantos, Number(line.adelantos) || 0);
    keepPrestamos = Math.max(keepPrestamos, Number(line.prestamos) || 0);
    line.daysWorked = nextDays;
    line.volaos = nextVolaos;
    line.adelantos = keepAdelantos;
    line.prestamos = keepPrestamos;
    // Recalcular base limpia (sin el tramo Vargas anterior) para no duplicar.
    if (keepExtrasManual) {
      line.horasExtras = manualExtrasBase;
      line.horasExtrasManual = true;
    } else {
      line.horasExtras = 0;
      line.horasExtrasManual = false;
    }
    if (typeof computePayrollLineTotals === "function") {
      let recomputed = computePayrollLineTotals(
        {
          ...line,
          volaos: nextVolaos,
          horasExtras: keepExtrasManual ? manualExtrasBase : 0,
          horasExtrasManual: keepExtrasManual,
        },
        formulaOpts
      );
      recomputed.volaos = nextVolaos;
      recomputed.adelantos = keepAdelantos;
      recomputed.prestamos = keepPrestamos;
      // Base = fórmula auto o monto manual; luego + horas del reporte × RD$60.
      const baseExtras = keepExtrasManual
        ? manualExtrasBase
        : Math.max(0, Number(recomputed.horasExtras) || 0);
      const finalExtras =
        typeof roundMoney2 === "function"
          ? roundMoney2(baseExtras + nextVargasExtraPay)
          : Math.round((baseExtras + nextVargasExtraPay) * 100) / 100;
      recomputed = computePayrollLineTotals(
        {
          ...recomputed,
          volaos: nextVolaos,
          horasExtras: finalExtras,
          horasExtrasManual: keepExtrasManual,
        },
        formulaOpts
      );
      recomputed.volaos = nextVolaos;
      recomputed.horasExtras = finalExtras;
      recomputed.horasExtrasManual = keepExtrasManual;
      recomputed.vargasExtraHours = nextExtraHours;
      recomputed.vargasExtraPay = nextVargasExtraPay;
      recomputed.adelantos = keepAdelantos;
      recomputed.prestamos = keepPrestamos;
      recomputed.daysFromVargas = true;
      recomputed.fromVargasReport = true;
      recomputed.fullName = displayName;
      Object.assign(line, recomputed);
      if (String(payroll.group || "") === "reaction") {
        const already = normalizePayrollPayBucket(line.payBucket);
        const seeded = normalizePayrollPayBucket(row.payBucket);
        line.payBucket = already || seeded || "";
      }
    } else {
      line.fullName = displayName;
      line.volaos = nextVolaos;
      const baseExtras = keepExtrasManual ? manualExtrasBase : 0;
      line.horasExtras =
        typeof roundMoney2 === "function"
          ? roundMoney2(baseExtras + nextVargasExtraPay)
          : baseExtras + nextVargasExtraPay;
      line.horasExtrasManual = keepExtrasManual;
      line.vargasExtraHours = nextExtraHours;
      line.vargasExtraPay = nextVargasExtraPay;
      line.daysFromVargas = true;
      line.fromVargasReport = true;
    }
    nextLines.push(line);
  });

  const removed = prune ? Math.max(0, (payroll.lines || []).length - nextLines.length) : 0;
  let ordered = nextLines;
  if (!prune) {
    const byKey = new Map((payroll.lines || []).map((l) => [vargasNameKey(l.fullName), l]));
    nextLines.forEach((l) => byKey.set(vargasNameKey(l.fullName), l));
    ordered = [...byKey.values()];
  }
  if (payroll.group === "lavega") ordered = sortVargasLinesByName(ordered);
  if (prune) {
    if (removed > 0) changed = true;
    payroll.lines = ordered;
  } else {
    payroll.lines = ordered;
  }

  // Marca siempre updatedAt al podar desde Vargas (aunque el contenido coincida)
  if (changed || prune) {
    payroll.updatedAt = new Date().toISOString();
    if (prune) payroll.rosterFromVargas = true;
    payroll.note = String(payroll.note || "");
    if (!/días desde Vargas|reporte Vargas/i.test(payroll.note)) {
      payroll.note = `${payroll.note} · Días desde Vargas`.replace(/^\s·\s*/, "").trim();
    }
  }
  return { changed: !!(changed || (prune && removed > 0)), linesTouched, removed, kept: nextLines.length };
}

function vargasPayrollHalf(report, opts) {
  if (opts && opts.half != null) return opts.half === 2 || opts.half === "2" ? 2 : 1;
  return report && (report.half === 2 || report.half === "2") ? 2 : 1;
}

/** Quita de una nómina a quienes coinciden con estos nombres (con o sin -LA VEGA). */
function dropVargasNamedLines(payroll, names) {
  if (!payroll || !Array.isArray(payroll.lines) || !names || !names.length) return 0;
  const variants = [];
  names.forEach((n) => {
    const raw = String(n || "").trim();
    if (!raw) return;
    variants.push(raw);
    const stripped = vargasStripLaVegaTag(raw);
    if (stripped && stripped !== raw) variants.push(stripped);
  });
  const before = payroll.lines.length;
  payroll.lines = payroll.lines.filter((line) => {
    if (!line) return false;
    return !variants.some((n) => vargasNamesMatch(line.fullName, n));
  });
  const removed = before - payroll.lines.length;
  if (removed > 0) payroll.updatedAt = new Date().toISOString();
  return removed;
}

function findVargasLineOnGroups(period, half, groups, name) {
  if (typeof findPayrollByGroup !== "function") return null;
  const stripped = vargasStripLaVegaTag(name);
  const variants = [name, stripped].filter(Boolean);
  for (const group of groups) {
    const payroll = findPayrollByGroup(period, half, group, "");
    if (!payroll) continue;
    const hit = (payroll.lines || []).find(
      (line) => line && variants.some((n) => vargasNamesMatch(line.fullName, n))
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Quienes dicen "-LA VEGA" salen de Reaction (general / banco / efectivo)
 * y La Vega Autopista de ese corte queda SOLO con ellos (el resto se borra).
 */
function routeVargasLaVegaEmployees(report, opts = {}) {
  const period = (opts && opts.period) || (report && report.period);
  const half = vargasPayrollHalf(report, opts);
  const tagged = collectVargasPayrollRows(report, "all").filter(vargasRowIsLaVega);
  const names = tagged.map((r) => r.fullName);
  let dropped = 0;
  ["banco", "efectivo"].forEach((group) => {
    if (typeof findPayrollByGroup !== "function") return;
    const payroll = findPayrollByGroup(period, half, group, "");
    dropped += dropVargasNamedLines(payroll, names);
  });
  if (!tagged.length) {
    return { moved: 0, dropped, payroll: null };
  }
  const rows = tagged.map((row) => {
    const cleanName = vargasStripLaVegaTag(row.fullName) || row.fullName;
    const cleanPost = vargasStripLaVegaTag(row.postName) || row.postName;
    const seed =
      findVargasLineOnGroups(period, half, ["lavega", "reaction", "banco", "efectivo"], row.fullName) ||
      null;
    return {
      ...row,
      fullName: cleanName,
      postName: cleanPost,
      seedLine: seed
        ? {
            ...seed,
            fullName: cleanName,
          }
        : null,
    };
  });
  const payroll = ensureVargasPayrollShell(period, half, "lavega", "La Vega Autopista");
  if (!payroll) return { moved: 0, dropped, payroll: null };
  const result = applyVargasRowsToPayroll(payroll, rows, "La Vega Autopista", {
    prune: true,
    keepFullName: true,
  });
  return {
    moved: result.kept,
    touched: result.linesTouched,
    removed: result.removed,
    dropped,
    changed: result.changed,
    payroll,
  };
}

/** 1) Nómina Reaction General: SOLO empleados del reporte Vargas que no dicen -LA VEGA. */
function syncVargasGeneralPayroll(opts = {}) {
  const report = opts.report || getActiveVargasReport();
  if (!report) return { updated: 0, reason: "no-report" };
  if (typeof findPayrollByGroup !== "function" || typeof buildPayrollLineFromPerson !== "function") {
    return { updated: 0, reason: "no-payroll-api" };
  }
  const period = opts.period || report.period;
  const half = vargasPayrollHalf(report, opts);
  const quiet = opts.quiet !== false;
  const allRows = collectVargasPayrollRows(report, "all");
  const rows = allRows.filter((r) => !vargasRowIsLaVega(r));
  const payroll = ensureVargasPayrollShell(period, half, "reaction", "Reaction General");
  if (!payroll) return { updated: 0, reason: "no-payroll" };

  // Primero copiar a La Vega (aún están en general para conservar adelantos/préstamos).
  const lavega = routeVargasLaVegaEmployees(report, { period, half });
  const result = applyVargasRowsToPayroll(payroll, rows, "Reaction General", { prune: true });
  // Guardar siempre si hay filas del reporte (aunque no haya "cambios" detectados)
  if (
    (result.changed || result.kept > 0 || (lavega && (lavega.changed || lavega.moved || lavega.dropped))) &&
    typeof saveContabilidadData === "function"
  ) {
    saveContabilidadData(true);
  }
  if (!quiet && typeof toast === "function") {
    toast(
      `Nómina general: ${result.kept} del reporte` +
        (result.removed ? ` · se quitaron ${result.removed} que no estaban` : "") +
        (lavega && lavega.moved
          ? ` · La Vega: ${lavega.moved}` + (lavega.removed ? ` (se borraron ${lavega.removed} viejos)` : "")
          : "") +
        (result.linesTouched ? ` · ${result.linesTouched} actualizado(s)` : "")
    );
  }
  return {
    updated: result.changed || (lavega && lavega.changed) ? 1 : 0,
    kept: result.kept,
    removed: result.removed,
    lines: result.linesTouched,
    lavegaMoved: lavega ? lavega.moved : 0,
    payroll,
    period,
    half,
  };
}

/** Abre Nómina en Reaction General del período/corte del reporte Vargas. */
function openVargasGeneralPayrollView(payroll, period, half) {
  const p = payroll || null;
  const per = String(period || (p && p.period) || "").slice(0, 7);
  const h = half === 2 || half === "2" || (p && (p.half === 2 || p.half === "2")) ? 2 : 1;
  ["nominaMonthFilter", "contabMonthFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && per) el.value = per;
  });
  const halfEl = document.getElementById("contabPayrollHalf");
  if (halfEl) halfEl.value = String(h);
  const groupEl = document.getElementById("contabPayrollGroup");
  if (groupEl) groupEl.value = "reaction";
  if (p && p.id && typeof selectedPayrollId !== "undefined") {
    selectedPayrollId = p.id;
  }
  if (typeof switchView === "function") switchView("nominaView");
  else if (typeof openNominaView === "function") openNominaView();
  else if (typeof renderNominaModule === "function") renderNominaModule();
  else if (typeof renderNominaTab === "function") renderNominaTab();
}

/** 2) Envía a Banco / Efectivo según B/E; solo nombres del reporte (poda el resto). */
function sendVargasPayrollToBuckets(opts = {}) {
  const report = opts.report || getActiveVargasReport();
  if (!report) return { updated: 0, reason: "no-report" };
  restoreVargasPayBucketsFromPayrolls(report);
  if (typeof findPayrollByGroup !== "function" || typeof buildPayrollLineFromPerson !== "function") {
    return { updated: 0, reason: "no-payroll-api" };
  }
  const period = opts.period || report.period;
  const half = opts.half != null ? (opts.half === 2 || opts.half === "2" ? 2 : 1) : report.half;
  const quiet = opts.quiet !== false;
  // Si solo envían B/E, igual mover -LA VEGA a La Vega y no dejarlos en Banco/Efectivo.
  routeVargasLaVegaEmployees(report, { period, half });

  const summary = { banco: 0, efectivo: 0, removedB: 0, removedE: 0, updated: 0 };
  [
    { filter: "B", group: "banco", label: "Reaction Banco", key: "banco", rem: "removedB" },
    { filter: "E", group: "efectivo", label: "Reaction Efectivo", key: "efectivo", rem: "removedE" },
  ].forEach(({ filter, group, label, key, rem }) => {
    const rows = collectVargasPayrollRows(report, filter).filter((r) => !vargasRowIsLaVega(r));
    // Crear shell vacío aunque no haya filas, para poder podar sobrantes del roster viejo
    const payroll = ensureVargasPayrollShell(period, half, group, label);
    if (!payroll) return;
    const result = applyVargasRowsToPayroll(payroll, rows, label, { prune: true });
    summary[key] = result.kept;
    summary[rem] = result.removed;
    if (result.changed) summary.updated += 1;
  });

  if (typeof saveContabilidadData === "function") saveContabilidadData(true);
  if (!quiet && typeof toast === "function") {
    toast(
      `Enviado: Banco ${summary.banco}` +
        (summary.removedB ? ` (−${summary.removedB})` : "") +
        ` · Efectivo ${summary.efectivo}` +
        (summary.removedE ? ` (−${summary.removedE})` : "") +
        ` · solo del reporte`
    );
  }
  summary.period = period;
  summary.half = half;
  return summary;
}

/** Compat: general + envío B/E. */
function feedVargasPayrollFromReport(opts = {}) {
  const general = syncVargasGeneralPayroll(opts);
  return {
    updated: general.updated || 0,
    kept: general.kept || 0,
    removed: general.removed || 0,
    banco: 0,
    efectivo: 0,
    skipped: 0,
  };
}

function refreshVargasPayrollUi() {
  if (typeof renderNominaTab === "function") {
    try {
      renderNominaTab();
    } catch (_) {}
  }
  renderVargasModule();
}

function syncVargasGeneralPayrollAction() {
  if (!canAccessVargas()) {
    if (typeof toast === "function") toast("Sin acceso a Ramón Vargas.");
    return;
  }
  const report = getActiveVargasReport();
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Vargas cargado.");
    return;
  }
  const rows = collectVargasPayrollRows(report, "all");
  if (
    !confirm(
      `¿Actualizar Nómina Reaction General?\n\n` +
        `Período ${report.period} · corte ${report.half === 2 ? "16–30" : "01–15"}\n` +
        `Empleados del reporte: ${rows.length}\n` +
        `A La Vega Autopista (dicen -LA VEGA): ${rows.filter(vargasRowIsLaVega).length}\n\n` +
        `El reporte solo actualiza la nómina general.\n` +
        `Banco o Efectivo se marca en esa nómina, antes del nombre, y se reparte con su botón.\n` +
        `Quienes dicen -LA VEGA pasan a La Vega Autopista del mismo corte.\n` +
        `En La Vega solo quedan los del reporte.\n` +
        `Día 31 no suma. Se conservan adelantos y préstamos.`
    )
  ) {
    return;
  }
  const synced = syncVargasGeneralPayroll({ report, quiet: false });
  if (!synced || synced.reason) {
    if (typeof toast === "function") {
      toast(
        synced && synced.reason === "no-payroll-api"
          ? "Contabilidad aún no está lista. Abre Nómina y vuelve a intentar."
          : synced && synced.reason === "no-payroll"
            ? "No se pudo crear la nómina general."
            : "No se pudo cargar el reporte a la nómina."
      );
    }
    return;
  }
  // Primero fijar selectores y abrir Nómina (refreshVargas re-renderiza Vargas al final)
  openVargasGeneralPayrollView(synced.payroll, synced.period || report.period, synced.half != null ? synced.half : report.half);
  if (typeof renderNominaTab === "function") {
    try {
      renderNominaTab();
    } catch (_) {}
  }
}

function sendVargasToBucketsAction() {
  if (!canAccessVargas()) {
    if (typeof toast === "function") toast("Sin acceso a Ramón Vargas.");
    return;
  }
  const report = getActiveVargasReport();
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Vargas cargado.");
    return;
  }
  const stats = vargasReportStats(report);
  if (!stats.banco && !stats.efectivo) {
    if (typeof toast === "function") {
      toast("Marca B o E en la columna Pago y vuelve a enviar.");
    }
    return;
  }
  if (
    !confirm(
      `¿Enviar a Banco / Efectivo?\n\n` +
        `Período ${report.period} · corte ${report.half === 2 ? "16–30" : "01–15"}\n` +
        `Banco (B): ${stats.banco}\nEfectivo (E): ${stats.efectivo}\n` +
        `Sin marca: ${stats.sinMarca} (se quedan solo en General)\n\n` +
        `En Banco/Efectivo solo quedan los del reporte con B o E.\n` +
        `Sobrantes del roster viejo se eliminan de esas nóminas.`
    )
  ) {
    return;
  }
  // Asegura general al día antes de repartir
  syncVargasGeneralPayroll({ report, quiet: true });
  const sent = sendVargasPayrollToBuckets({ report, quiet: false });
  const period = report.period;
  const half = report.half === 2 || report.half === "2" ? 2 : 1;
  const preferGroup = sent && sent.banco > 0 ? "banco" : sent && sent.efectivo > 0 ? "efectivo" : "banco";
  let payroll = typeof findPayrollByGroup === "function" ? findPayrollByGroup(period, half, preferGroup, "") : null;
  ["nominaMonthFilter", "contabMonthFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && period) el.value = period;
  });
  const halfEl = document.getElementById("contabPayrollHalf");
  if (halfEl) halfEl.value = String(half);
  const groupEl = document.getElementById("contabPayrollGroup");
  if (groupEl) groupEl.value = preferGroup;
  if (payroll && payroll.id && typeof selectedPayrollId !== "undefined") selectedPayrollId = payroll.id;
  if (typeof switchView === "function") switchView("nominaView");
  else if (typeof openNominaView === "function") openNominaView();
  if (typeof renderNominaTab === "function") {
    try { renderNominaTab(); } catch (_) {}
  }
}

function reorganizeVargasToPayroll() {
  if (!canAccessVargas()) {
    if (typeof toast === "function") toast("Sin acceso a Ramón Vargas.");
    return;
  }
  const report = getActiveVargasReport();
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Vargas cargado.");
    return;
  }
  const stats = vargasReportStats(report);
  if (
    !confirm(
      `¿Nómina general + enviar a B/E?\n\n` +
        `Período ${report.period} · corte ${report.half === 2 ? "16–30" : "01–15"}\n` +
        `En reporte: ${stats.total}\n` +
        `Banco (B): ${stats.banco} · Efectivo (E): ${stats.efectivo}\n` +
        `Sin marca: ${stats.sinMarca} (solo General)\n\n` +
        `1) Reaction General = solo el reporte\n` +
        `2) Banco/Efectivo = según B/E (sin sobrantes)\n` +
        `Día 31 no suma.`
    )
  ) {
    return;
  }
  const result = feedVargasPayrollFromReport({ report, quiet: false, createMissing: true });
  refreshVargasPayrollUi();
  return result;
}

function renderVargasModule() {
  if (typeof canAccessVargas === "function" && !canAccessVargas()) return;
  const scrollPos = captureVargasScroll();
  ensureVargasSeedLoaded();
  ensureVargasNovember2026();
  const report = getActiveVargasReport();
  const summary = document.getElementById("vargasSummary");
  const host = document.getElementById("vargasReportHost");
  if (!host) return;

  if (!report) {
    if (summary) {
      summary.textContent = "Sin reporte. Carga la semilla Excel o sincroniza la nube.";
    }
    host.innerHTML =
      '<div class="form-card"><p class="muted">No hay datos del reporte de Ramón Vargas.</p></div>';
    return;
  }

  const stats = vargasReportStats(report);
  if (summary) {
    summary.textContent = `${report.label || report.period} · ${stats.total} empleados · Diurno ${stats.diurno} · Nocturno ${stats.nocturno}`;
  }

  const rows = flattenVargasEmployees(report, {
    shift: vargasFilterShift,
    bucket: vargasFilterBucket,
    search: vargasSearch,
  });

  const dayHeaders = (report.dayNums || [])
    .map((d) => {
      const excl = Number(d) === 31 ? ' title="Día 31: se ve en reporte, no entra en nómina"' : "";
      return `<th class="vargas-day${Number(d) === 31 ? " vargas-day-excl" : ""}"${excl}>${d}</th>`;
    })
    .join("");

  const body = rows
    .map((row) => {
      const markCells = (report.dayNums || [])
        .map((d) => {
          const mark = row.marks[String(d)];
          const val = formatVargasMarkCell(mark);
          const worked = vargasMarkIsWorked(mark);
          const volao = vargasMarkIsVolao(mark);
          const excl = Number(d) === 31;
          const title = volao
            ? ` title="2 = turno + RD$${VARGAS_VOLAO_AMOUNT} volao (días no cambian)"`
            : "";
          return `<td class="vargas-day-cell${worked ? " is-work" : ""}${volao ? " is-volao" : ""}${excl ? " is-excl" : ""}" data-s="${row.sectionIdx}" data-e="${row.empIdx}" data-day="${d}" contenteditable="true" spellcheck="false"${title}>${escapeVargasHtml(val)}</td>`;
        })
        .join("");
      const daysLabel =
        row.volaoMarks > 0
          ? `${row.daysPayroll}<span class="vargas-volao-hint" title="${row.volaoMarks} volao(s) × RD$${VARGAS_VOLAO_AMOUNT}"> · V${row.volaosAmount}</span>`
          : String(row.daysPayroll);
      const pagosVal = formatVargasVolaosPagos(row.volaosPagos);
      const pagosFilled = pagosVal !== "";
      const hexVal = formatVargasHorasExtras(row.horasExtras);
      const hexFilled = hexVal !== "";
      const hexTitle = hexFilled
        ? ` title="${hexVal} h × RD$${VARGAS_EXTRA_HOUR_RATE} = RD$${row.horasExtrasPay} (se suma a Horas extras de nómina)"`
        : ` title="Horas extras (ej. 2 o 2.3). RD$${VARGAS_EXTRA_HOUR_RATE}/h sumadas a la nómina"`;
      return `<tr data-shift="${row.shift}">
        <td class="vargas-shift">${row.shift === "nocturno" ? "N" : "D"}</td>
        <td class="sticky-name vargas-name" contenteditable="true" spellcheck="false" data-s="${row.sectionIdx}" data-e="${row.empIdx}" title="Toca para corregir el nombre">${escapeVargasHtml(row.fullName)}</td>
        <td class="vargas-post">${escapeVargasHtml(row.postName)}</td>
        <td class="vargas-days-total">${daysLabel}</td>
        <td class="vargas-pagos-cell${pagosFilled ? " is-paid" : ""}" data-s="${row.sectionIdx}" data-e="${row.empIdx}" contenteditable="true" spellcheck="false" title="Volaos ya pagados (1 o 2). Solo control: no suma en nómina">${escapeVargasHtml(pagosVal)}</td>
        <td class="vargas-hex-cell${hexFilled ? " has-hex" : ""}" data-s="${row.sectionIdx}" data-e="${row.empIdx}" contenteditable="true" spellcheck="false"${hexTitle}>${escapeVargasHtml(hexVal)}</td>
        ${markCells}
        <td class="vargas-del-cell">
          <button type="button" class="vargas-del-btn" data-s="${row.sectionIdx}" data-e="${row.empIdx}" data-name="${escapeVargasAttr(row.fullName)}" title="Eliminar empleado" aria-label="Eliminar">✕</button>
        </td>
      </tr>`;
    })
    .join("");

  const postNames = listVargasPostNames(report, "all");
  const postOptions = postNames
    .map((p) => `<option value="${escapeVargasAttr(p)}"></option>`)
    .join("");

  host.innerHTML = `
    <div class="form-card vargas-toolbar">
      <div class="vargas-toolbar-row">
        <label>Quincena
          <select id="vargasReportSelect">
            ${(vargasData.reports || [])
              .map(
                (r) =>
                  `<option value="${escapeVargasAttr(r.id)}" ${r.id === report.id ? "selected" : ""}>${escapeVargasHtml(
                    vargasQuincenaTitle(r)
                  )}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>Buscar
          <input id="vargasSearchInput" type="search" placeholder="Nombre o puesto" value="${escapeVargasAttr(vargasSearch)}" />
        </label>
        <label>Turno
          <select id="vargasFilterShift">
            <option value="all" ${vargasFilterShift === "all" ? "selected" : ""}>Todos</option>
            <option value="diurno" ${vargasFilterShift === "diurno" ? "selected" : ""}>Diurno (${stats.diurno})</option>
            <option value="nocturno" ${vargasFilterShift === "nocturno" ? "selected" : ""}>Nocturno (${stats.nocturno})</option>
          </select>
        </label>
      </div>
      <div class="vargas-actions">
        <button type="button" class="secondary" id="btnVargasNuevaQuincena">Abrir siguiente quincena</button>
        <button type="button" class="secondary" id="btnVargasPrint">Imprimir / Compartir</button>
        <button type="button" class="primary" id="btnVargasNominaGeneral">Enviar a nómina general</button>
      </div>
      <p class="muted tight" style="margin-top:10px">
        <strong>1</strong> = turno (1 día). <strong>2</strong> en un día = +RD$${VARGAS_VOLAO_AMOUNT} volao.
        <strong>Volaos pagos</strong> = ya pagados (control, no suma).
        <strong>Horas ext.</strong> = horas (2, 2.3…) × RD$${VARGAS_EXTRA_HOUR_RATE}, sumadas a Horas extras de nómina sin quitar el monto ya calculado.
        Este reporte solo envía a la <strong>nómina general</strong>. Banco (B) o Efectivo (E) se marca ahí, antes del nombre, y se reparte con un botón.
        Cada 15 días se abre otra quincena: se copian los empleados, los días quedan en blanco y la quincena anterior no se borra.
        Si el nombre o el puesto dice <strong>-LA VEGA</strong>, en <strong>La Vega Autopista</strong> queda el nombre completo del reporte (todos los nombres y apellidos, sin la palabra La Vega) y la lista va en orden alfabético.
        Día 31 no suma.
      </p>
    </div>

    <div class="form-card" id="vargasAddBox">
      <h2 style="margin:0 0 10px;font-size:16px">Agregar empleado</h2>
      <div class="vargas-add-grid">
        <label>Nombre
          <input id="vargasAddName" type="text" autocomplete="name" placeholder="Nombre completo" />
        </label>
        <label>Puesto
          <input id="vargasAddPost" type="text" list="vargasPostList" placeholder="Puesto / cliente" />
          <datalist id="vargasPostList">${postOptions}</datalist>
        </label>
        <label>Turno
          <select id="vargasAddShift">
            <option value="diurno">Diurno</option>
            <option value="nocturno">Nocturno</option>
          </select>
        </label>
      </div>
      <button type="button" class="primary" id="btnVargasAddEmp" style="margin-top:12px">Agregar al reporte</button>
    </div>

    <div class="form-card" style="padding:0; overflow:hidden">
      <div class="vargas-table-wrap">
        <table class="vargas-table">
          <thead>
            <tr>
              <th>T</th>
              <th class="sticky-name">Empleado</th>
              <th>Puesto</th>
              <th>Días</th>
              <th class="vargas-pagos-head" title="Volaos ya pagados — no entran a nómina">Volaos pagos</th>
              <th class="vargas-hex-head" title="Horas × RD$${VARGAS_EXTRA_HOUR_RATE} sumadas a Horas extras de nómina">Horas ext.</th>
              ${dayHeaders}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${body || `<tr><td colspan="${7 + (report.dayNums || []).length}" class="muted" style="padding:16px">Ningún empleado con este filtro.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindVargasUiHandlers();
  restoreVargasScroll(scrollPos);
}

function escapeVargasHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeVargasAttr(s) {
  return escapeVargasHtml(s).replace(/'/g, "&#39;");
}

function bindVargasUiHandlers() {
  const search = document.getElementById("vargasSearchInput");
  if (search) {
    search.addEventListener("input", () => {
      vargasSearch = search.value || "";
      renderVargasModule();
      const el = document.getElementById("vargasSearchInput");
      if (el) {
        el.focus();
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch (_) {}
      }
    });
  }
  const shift = document.getElementById("vargasFilterShift");
  if (shift) {
    shift.addEventListener("change", () => {
      vargasFilterShift = shift.value || "all";
      renderVargasModule();
    });
  }
  const bucket = document.getElementById("vargasFilterBucket");
  if (bucket) {
    bucket.addEventListener("change", () => {
      vargasFilterBucket = bucket.value || "all";
      renderVargasModule();
    });
  }
  document.querySelectorAll(".vargas-bucket").forEach((sel) => {
    sel.addEventListener("change", () => {
      const s = Number(sel.dataset.s);
      const e = Number(sel.dataset.e);
      const next = sel.value;
      if (!setVargasEmployeePayBucket(s, e, next)) {
        const report = getActiveVargasReport();
        const emp = report && report.sections[s] && report.sections[s].employees[e];
        sel.value = emp && emp.payBucket ? emp.payBucket : "";
        return;
      }
      // Si el filtro sigue mostrando la fila, no reconstruir (evita salto al inicio).
      if (vargasBucketChangeLeavesFilter(next)) {
        renderVargasModule();
        return;
      }
      refreshVargasSummaryBar();
    });
  });
  document.querySelectorAll(".vargas-day-cell").forEach((cell) => {
    cell.addEventListener("blur", () => {
      const s = Number(cell.dataset.s);
      const e = Number(cell.dataset.e);
      const day = Number(cell.dataset.day);
      setVargasEmployeeMark(s, e, day, cell.textContent);
    });
  });
  document.querySelectorAll(".vargas-pagos-cell").forEach((cell) => {
    cell.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        cell.blur();
      }
    });
    cell.addEventListener("blur", () => {
      const s = Number(cell.dataset.s);
      const e = Number(cell.dataset.e);
      setVargasEmployeeVolaosPagos(s, e, cell.textContent);
      const report = getActiveVargasReport();
      const emp = report && report.sections[s] && report.sections[s].employees[e];
      const shown = emp ? formatVargasVolaosPagos(emp.volaosPagos) : "";
      cell.textContent = shown;
      cell.classList.toggle("is-paid", shown !== "");
    });
  });
  document.querySelectorAll(".vargas-hex-cell").forEach((cell) => {
    cell.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        cell.blur();
      }
    });
    cell.addEventListener("blur", () => {
      const s = Number(cell.dataset.s);
      const e = Number(cell.dataset.e);
      setVargasEmployeeHorasExtras(s, e, cell.textContent);
      const report = getActiveVargasReport();
      const emp = report && report.sections[s] && report.sections[s].employees[e];
      const hours = emp ? normalizeVargasHorasExtras(emp.horasExtras) : 0;
      const shown = formatVargasHorasExtras(hours);
      cell.textContent = shown;
      cell.classList.toggle("has-hex", shown !== "");
      if (shown) {
        const pay = vargasHorasExtrasPay(hours);
        cell.title = `${shown} h × RD$${VARGAS_EXTRA_HOUR_RATE} = RD$${pay} (se suma a Horas extras de nómina)`;
      } else {
        cell.title = `Horas extras (ej. 2 o 2.3). RD$${VARGAS_EXTRA_HOUR_RATE}/h sumadas a la nómina`;
      }
    });
  });
  document.querySelectorAll("td.vargas-name").forEach((cell) => {
    cell.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        cell.blur();
      }
    });
    cell.addEventListener("blur", () => {
      const s = Number(cell.dataset.s);
      const e = Number(cell.dataset.e);
      const raw = String(cell.textContent || "").replace(/\s+/g, " ").trim();
      const result = setVargasEmployeeName(s, e, raw);
      if (!result.ok) {
        const report = getActiveVargasReport();
        const emp = report && report.sections[s] && report.sections[s].employees[e];
        cell.textContent = emp ? emp.fullName : raw;
        if (typeof toast === "function") {
          toast(
            result.reason === "duplicate"
              ? "Ese nombre ya está en este puesto."
              : result.reason === "no-name"
                ? "El nombre no puede quedar vacío."
                : "No se pudo guardar el nombre."
          );
        }
        return;
      }
      cell.textContent = result.fullName;
      if (!result.unchanged) {
        // Actualizar data-name del botón borrar de la misma fila
        const row = cell.closest("tr");
        const del = row && row.querySelector(".vargas-del-btn");
        if (del) del.dataset.name = result.fullName;
        if (typeof toast === "function") toast(`Nombre: ${result.fullName}`);
      }
    });
  });
  const reportSel = document.getElementById("vargasReportSelect");
  if (reportSel) {
    reportSel.addEventListener("change", () => {
      setActiveVargasReport(reportSel.value || "");
      renderVargasModule();
    });
  }
  const btnNextQ = document.getElementById("btnVargasNuevaQuincena");
  if (btnNextQ) {
    btnNextQ.addEventListener("click", () => {
      const current = getActiveVargasReport();
      const next = current ? nextVargasQuincena(current) : null;
      const spec = next ? vargasQuincenaSpec(next.period, next.half) : null;
      const title = spec ? vargasQuincenaTitle(spec) : "la siguiente";
      const already = next ? findVargasReport(next.period, next.half) : null;
      if (!already) {
        if (
          !confirm(
            `¿Abrir la quincena ${title}?\n\nSe copian los empleados y Banco/Efectivo.\nLos días quedan en blanco.\nLa quincena que estás viendo no se borra.`
          )
        ) {
          return;
        }
      }
      const opened = openNextVargasQuincena();
      if (!opened || !opened.ok) {
        if (typeof toast === "function") toast("No se pudo abrir la quincena.");
        return;
      }
      if (typeof toast === "function") {
        toast(opened.existed ? `Quincena abierta: ${opened.title}` : `Nueva quincena: ${opened.title}`);
      }
      renderVargasModule();
    });
  }
  const btnSug = document.getElementById("btnVargasSuggestBE");
  if (btnSug) {
    btnSug.addEventListener("click", () => {
      const r = suggestVargasPayBucketsFromRosters(false);
      if (typeof toast === "function") {
        toast(r.filled ? `Sugeridos ${r.filled} B/E desde nómina existente.` : "No hubo cambios (ya marcados o sin coincidencia).");
      }
      renderVargasModule();
    });
  }
  const btnGeneral = document.getElementById("btnVargasNominaGeneral");
  if (btnGeneral) {
    btnGeneral.addEventListener("click", () => syncVargasGeneralPayrollAction());
  }
  const btnEnviar = document.getElementById("btnVargasEnviarBE");
  if (btnEnviar) {
    btnEnviar.addEventListener("click", () => sendVargasToBucketsAction());
  }
  const btnReorg = document.getElementById("btnVargasReorganizar");
  if (btnReorg) {
    btnReorg.addEventListener("click", () => reorganizeVargasToPayroll());
  }
  const btnPrint = document.getElementById("btnVargasPrint");
  if (btnPrint) {
    btnPrint.addEventListener("click", () => printVargasReport());
  }
  const btnAdd = document.getElementById("btnVargasAddEmp");
  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      const nameEl = document.getElementById("vargasAddName");
      const postEl = document.getElementById("vargasAddPost");
      const shiftEl = document.getElementById("vargasAddShift");
      const bucketEl = document.getElementById("vargasAddBucket");
      const result = addVargasEmployee({
        fullName: nameEl ? nameEl.value : "",
        postName: postEl ? postEl.value : "",
        shift: shiftEl ? shiftEl.value : "diurno",
        payBucket: bucketEl ? bucketEl.value : "",
      });
      if (!result.ok) {
        if (typeof toast === "function") {
          toast(
            result.reason === "duplicate"
              ? "Ese empleado ya está en ese puesto."
              : result.reason === "no-name"
                ? "Escribe el nombre del empleado."
                : "No se pudo agregar."
          );
        }
        return;
      }
      if (typeof toast === "function") toast(`Agregado: ${result.fullName}`);
      if (typeof logActivity === "function") {
        logActivity("vargas_add", `Vargas + ${result.fullName} · ${result.postName} · ${result.shift}`);
      }
      renderVargasModule();
    });
  }
  document.querySelectorAll(".vargas-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name || "este empleado";
      if (!confirm(`¿Eliminar a ${name} del reporte Vargas?`)) return;
      const s = Number(btn.dataset.s);
      const e = Number(btn.dataset.e);
      const result = removeVargasEmployee(s, e);
      if (result.ok && typeof toast === "function") toast(`Eliminado: ${result.fullName}`);
      if (result.ok && typeof logActivity === "function") {
        logActivity("vargas_del", `Vargas − ${result.fullName}`);
      }
      renderVargasModule();
    });
  });
}

// Expose for cloud / app wiring
window.RFSVargas = {
  emptyVargasData,
  normalizeVargasData,
  applyRemoteVargasData,
  mergeVargasDataSticky,
  saveVargasData,
  ensureVargasSeedLoaded,
  getActiveVargasReport,
  feedVargasPayrollFromReport,
  syncVargasGeneralPayroll,
  sendVargasPayrollToBuckets,
  reorganizeVargasToPayroll,
  renderVargasModule,
  addVargasEmployee,
  removeVargasEmployee,
  setVargasEmployeeName,
  openVargasGeneralPayrollView,
  printVargasReport,
};
