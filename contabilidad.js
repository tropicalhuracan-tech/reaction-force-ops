/* ==== MÓDULO CONTABILIDAD (DGII / NÓMINA OFICINA) ==== */
const CONTABILIDAD_KEY = "rfs-ops-contabilidad";
const ITBIS_RATE = 0.18;

let contabilidadData = emptyContabilidadData();
let contabTab = "gastos";
let selectedContabExpenseId = "";
let selectedOfficeEmpId = "";
let selectedPayrollId = "";

function emptyContabilidadData() {
  return {
    expenses: [],
    itbisCollected: [],
    officeEmployees: [],
    /** Empleados nómina LOTEDOM (misma forma que oficina; lista se carga al recibir el Excel). */
    lotedomEmployees: [],
    payrolls: [],
    /** Historial de seguridad: copias de nóminas al guardar / pagar / antes de borrar. */
    payrollBackups: [],
    /** Ids borrados a mano (evita que el sync los vuelva a traer desde la nube). */
    payrollBackupDeletedIds: [],
    settings: { defaultBook: "EDWARD" },
  };
}

/** Solo el último respaldo por nómina (una ranura; al guardar se sobrescribe). */
const PAYROLL_BACKUP_MAX = 40;
const PAYROLL_BACKUP_MAX_PER_ID = 1;
const PAYROLL_BACKUP_DELETED_MAX = 300;

/** Día calendario del respaldo (YYYY-MM-DD) → un solo respaldo por nómina y fecha. */
function payrollBackupDayKey(iso) {
  const s = String(iso || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function payrollBackupStableId(payrollId, day) {
  return `pb-${String(payrollId || "").trim()}-${payrollBackupDayKey(day)}`;
}

/** Marca «sin respaldo» para una nómina hasta el próximo guardado manual. */
function payrollBackupSuppressKey(payrollId) {
  return `pay:${String(payrollId || "").trim()}`;
}

function isPayrollBackupSuppressed(payrollId, deletedIds) {
  const id = String(payrollId || "").trim();
  if (!id) return false;
  const banned = new Set(normalizePayrollBackupDeletedIds(deletedIds));
  return banned.has(payrollBackupSuppressKey(id));
}

function normalizePayrollBackupDeletedIds(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((id) => {
    const s = String(id || "").trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  });
  return out.slice(0, PAYROLL_BACKUP_DELETED_MAX);
}

/** Cuántos empleados con nombre tiene una nómina (0 = vacía). */
function payrollNamedLineCount(p) {
  if (!p || !Array.isArray(p.lines)) return 0;
  return p.lines.filter((l) => String(l && l.fullName || "").trim()).length;
}

function payrollBackupNamedCount(b) {
  return payrollNamedLineCount(b && b.snapshot);
}

function moneyRd(n) {
  const v = Number(n) || 0;
  return `RD$ ${v.toLocaleString("es-DO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Monto sin RD$ (impresión / celdas densas) */
function moneyPlain(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  return v.toLocaleString("es-DO", {
    minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function monthKeyFromDate(isoDate) {
  const s = String(isoDate || "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym) {
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return "—";
  const [y, m] = ym.split("-").map(Number);
  const names = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  return `${names[m - 1] || m} ${y}`;
}

function emptyFiscalExpense() {
  return {
    id: `cfe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString().slice(0, 10),
    amount: 0,
    itbis: 0,
    vendor: "",
    ncf: "",
    rnc: "",
    book: "EDWARD",
    note: "",
    createdBy: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeFiscalExpense(e = {}) {
  const amount = Math.max(0, Number(e.amount) || 0);
  let itbis = Math.max(0, Number(e.itbis) || 0);
  if (!itbis && amount > 0 && e.autoItbis) {
    itbis = Math.round((amount - amount / (1 + ITBIS_RATE)) * 100) / 100;
  }
  return {
    id: e.id || `cfe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: String(e.date || "").slice(0, 10),
    amount,
    itbis,
    vendor: String(e.vendor || "").trim(),
    ncf: String(e.ncf || "").trim().toUpperCase(),
    rnc: String(e.rnc || "").replace(/\D/g, "").slice(0, 11),
    book: String(e.book || "EDWARD").trim() || "EDWARD",
    note: String(e.note || "").trim(),
    createdBy: e.createdBy || "",
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

function emptyItbisCollected() {
  return {
    id: `itc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString().slice(0, 10),
    client: "",
    invoiceRef: "",
    baseAmount: 0,
    itbis: 0,
    totalAmount: 0,
    note: "",
    createdBy: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeItbisCollected(r = {}) {
  let base = Math.max(0, Number(r.baseAmount) || 0);
  let itbis = Math.max(0, Number(r.itbis) || 0);
  let total = Math.max(0, Number(r.totalAmount) || 0);
  if (base > 0 && !itbis) itbis = Math.round(base * ITBIS_RATE * 100) / 100;
  if (base > 0 && !total) total = Math.round((base + itbis) * 100) / 100;
  if (total > 0 && !base && !itbis) {
    base = Math.round((total / (1 + ITBIS_RATE)) * 100) / 100;
    itbis = Math.round((total - base) * 100) / 100;
  }
  return {
    id: r.id || `itc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: String(r.date || "").slice(0, 10),
    client: String(r.client || "").trim(),
    invoiceRef: String(r.invoiceRef || "").trim(),
    baseAmount: base,
    itbis,
    totalAmount: total,
    note: String(r.note || "").trim(),
    createdBy: r.createdBy || "",
    createdAt: r.createdAt || new Date().toISOString(),
    updatedAt: r.updatedAt || new Date().toISOString(),
  };
}

function emptyOfficeEmployee() {
  return {
    id: `oemp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fullName: "",
    cedula: "",
    position: "",
    phone: "",
    email: "",
    bankAccount: "",
    bankName: "",
    salary: 0,
    active: true,
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeOfficeEmployee(e = {}) {
  return {
    id: e.id || `oemp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fullName: String(e.fullName || "").trim(),
    cedula: String(e.cedula || "").replace(/\D/g, "").slice(0, 11),
    position: String(e.position || "").trim(),
    phone: String(e.phone || "").trim(),
    email: String(e.email || "").trim(),
    bankAccount: String(e.bankAccount || "").trim(),
    bankName: String(e.bankName || "").trim(),
    salary: Math.max(0, Number(e.salary) || 0),
    active: e.active !== false,
    notes: String(e.notes || "").trim(),
    createdAt: e.createdAt || new Date().toISOString(),
    updatedAt: e.updatedAt || new Date().toISOString(),
  };
}

function emptyPayroll() {
  return {
    id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    period: currentMonthKey(),
    payDate: "",
    status: "draft",
    lines: [],
    note: "",
    createdBy: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const LVA_PAYROLL_DEFAULT_MONTHLY = 24000;
const LVA_PAYROLL_UNIFORMES = 115;
const LVA_PAYROLL_RIFA = 85;
const LVA_PAYROLL_SFS_RATE = 0.0591; // ~SFS/SVDS observado en nómina Excel
const LVA_PAYROLL_DAY_BASE = 26;
/** Seguro de vida (SVDA): fijo RD$ 90. Columna Comida / Seg. vida = comida (editable) + seguro. */
const LVA_PAYROLL_SVDA = 90;
/**
 * Días tipo "13+2": la quincena solo usa el primer número (12/13/15…).
 * El +N no entra en quincena: cada +1 = volao (tasa según grupo/tanda).
 */
const LVA_PAYROLL_VOLAO_PER_EXTRA_DAY = 800;
/** Horas extras por días laborados (La Vega / default): 13 días = RD$750. */
const LVA_PAYROLL_EXTRAS_DAYS_BLOCK = 13;
const LVA_PAYROLL_EXTRAS_FROM_DAYS_PAY = 750;
/** Monorriel por tanda: volao (+N) y horas extras (13 días base). */
const MONO_TANDA_FORMULA = {
  // Ejemplos: 12+1 → 850 · 12+3 → 2550; horas: 13 días → 1000
  dia: { volaoPerExtraDay: 850, extrasFromDaysPay: 1000, autoExtrasFromDays: true },
  noche: { volaoPerExtraDay: 900, extrasFromDaysPay: 1500, autoExtrasFromDays: true },
  moto_dia: { volaoPerExtraDay: 1000, extrasFromDaysPay: 0, autoExtrasFromDays: false },
  moto_noche: { volaoPerExtraDay: 1000, extrasFromDaysPay: 0, autoExtrasFromDays: false },
};
/** Nómina oficina: SFS fijo; quincena = sueldo mensual / 2 (días no influyen). */
const OFFICE_PAYROLL_SFS = 800;
const OFFICE_PAYROLL_RIFA = 85;

function roundMoney2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function roundTo50(n) {
  return Math.round((Number(n) || 0) / 50) * 50;
}

function parsePayrollDays(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { label: "", days: 0, baseDays: 0, extraDays: 0, incidental: false };
  if (/^inc/i.test(s)) return { label: s || "INC", days: 0, baseDays: 0, extraDays: 0, incidental: true };
  // Ej. "2+9INC": solo cuentan los días base; INC no genera volao
  const incMix = s.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)\s*inc\b/i);
  if (incMix) {
    const a = Number(incMix[1]) || 0;
    return { label: s, days: a, baseDays: a, extraDays: 0, incidental: true };
  }
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(?:\+\s*(\d+(?:\.\d+)?))?$/);
  if (!m) {
    const d = Math.max(0, Number(String(s).replace(",", ".")) || 0);
    return { label: s, days: d, baseDays: d, extraDays: 0, incidental: false };
  }
  const a = Number(m[1]) || 0;
  const b = Number(m[2]) || 0;
  // baseDays = primer número (prorrateo); extraDays = +N (volao a tasa del grupo/tanda)
  return { label: s, days: a + b, baseDays: a, extraDays: b, incidental: false };
}

/** Horas extras según días base (prorrateo lineal sobre el bloque de días). */
function extrasPayFromBaseDays(baseDays, extrasFromDaysPay, extrasDaysBlock) {
  const d = Math.max(0, Number(baseDays) || 0);
  const pay = Math.max(0, Number(extrasFromDaysPay) || 0);
  const block = Math.max(1, Number(extrasDaysBlock) || LVA_PAYROLL_EXTRAS_DAYS_BLOCK);
  if (!d || !pay) return 0;
  return roundMoney2((d / block) * pay);
}

/** Perfil de fórmula según nómina (Monorriel por tanda; resto LVA default). */
function getPayrollFormulaProfile(p) {
  const office = payrollIsOffice(p);
  const lavega = payrollUsesLvaParams(p);
  const rawTanda = p && p.group === "monorriel" ? String(p.tanda || "").trim() : "";
  const tanda = rawTanda && MONO_TANDA_FORMULA[rawTanda] ? rawTanda : "";
  const mono = tanda ? MONO_TANDA_FORMULA[tanda] : null;
  return {
    office,
    lavega,
    tanda,
    volaoPerExtraDay: mono
      ? mono.volaoPerExtraDay
      : LVA_PAYROLL_VOLAO_PER_EXTRA_DAY,
    extrasDaysBlock: LVA_PAYROLL_EXTRAS_DAYS_BLOCK,
    extrasFromDaysPay: mono ? mono.extrasFromDaysPay : LVA_PAYROLL_EXTRAS_FROM_DAYS_PAY,
    autoExtrasFromDays: mono ? !!mono.autoExtrasFromDays : !office && lavega,
  };
}

function payrollComputeOpts(p, extra = {}) {
  const profile = getPayrollFormulaProfile(p);
  return { ...profile, ...extra };
}

/** Empleado con trato especial: montos a mano, sin fórmulas de días/volao/extras. */
function isManualPayrollLine(line) {
  return !!(line && (line.manualEntry || line.manual));
}

function computePayrollLineTotals(line, opts = {}) {
  const office = !!(opts && opts.office);
  const lavega = !!(opts && opts.lavega);
  const manual = isManualPayrollLine(line);
  const volaoPerExtraDay = Math.max(
    0,
    Number(opts && opts.volaoPerExtraDay != null ? opts.volaoPerExtraDay : LVA_PAYROLL_VOLAO_PER_EXTRA_DAY) || 0
  );
  const extrasDaysBlock = Math.max(
    1,
    Number(opts && opts.extrasDaysBlock != null ? opts.extrasDaysBlock : LVA_PAYROLL_EXTRAS_DAYS_BLOCK) ||
      LVA_PAYROLL_EXTRAS_DAYS_BLOCK
  );
  const extrasFromDaysPay = Math.max(
    0,
    Number(
      opts && opts.extrasFromDaysPay != null ? opts.extrasFromDaysPay : LVA_PAYROLL_EXTRAS_FROM_DAYS_PAY
    ) || 0
  );
  const autoExtrasFromDays =
    opts && Object.prototype.hasOwnProperty.call(opts, "autoExtrasFromDays")
      ? !!opts.autoExtrasFromDays
      : !office && lavega;

  const salaryMonthly = Math.max(0, Number(line.salaryMonthly) || 0);
  const daysInfo = parsePayrollDays(line.daysWorked);
  let salaryQuincena = Math.max(0, Number(line.salaryQuincena) || 0);
  let sfs = Math.max(0, Number(line.sfs) || 0);
  let uniformes = Math.max(0, Number(line.uniformes) || 0);
  let volaos = Math.max(0, Number(line.volaos) || 0);
  let incentivos = Math.max(0, Number(line.incentivos) || 0);
  let horasExtras = Math.max(0, Number(line.horasExtras) || 0);
  let feriado = Math.max(0, Number(line.feriado) || 0);
  let almuerzo = Math.max(0, Number(line.almuerzo) || 0);
  let rifa = Math.max(0, Number(line.rifa) || 0);
  const adelantos = Math.max(0, Number(line.adelantos) || 0);
  const prestamos = Math.max(0, Number(line.prestamos) || 0);
  const hasName = !!String(line.fullName || "").trim();
  // Si el usuario tecleó SFS / horas extras (incluso 0), no pisar con la fórmula auto.
  const sfsManual = !!line.sfsManual;
  const horasExtrasManual = !!line.horasExtrasManual;

  const baseDays = Math.max(0, Number(daysInfo.baseDays != null ? daysInfo.baseDays : daysInfo.days) || 0);
  const extraDays = Math.max(0, Number(daysInfo.extraDays) || 0);
  const volaoFromDays = roundMoney2(extraDays * volaoPerExtraDay);

  if (manual) {
    // Trato especial: respetar todo lo tecleado; solo armar totales
  } else if (office) {
    // Oficina: quincena = mitad del sueldo; días no influyen. SFS por defecto fijo (editable a mano).
    salaryQuincena = salaryMonthly ? roundMoney2(salaryMonthly / 2) : 0;
    if (!sfsManual) sfs = hasName ? OFFICE_PAYROLL_SFS : 0;
    uniformes = 0;
    volaos = 0;
    if (!horasExtrasManual) horasExtras = 0;
    feriado = 0;
    almuerzo = 0;
    if (!hasName) rifa = 0;
  } else {
    // +N en días → solo Volaos (tasa × N); no se mezcla con la quincena
    if (extraDays > 0) {
      volaos = volaoFromDays;
    }
    // Horas extras auto: solo rellenar si están vacías y el usuario no las fijó.
    // No pisar un monto ya tecleado (protege datos al sync / al editar otras casillas).
    if (autoExtrasFromDays && !horasExtrasManual && !horasExtras && baseDays > 0) {
      horasExtras = extrasPayFromBaseDays(baseDays, extrasFromDaysPay, extrasDaysBlock);
    }
    if (!salaryQuincena && salaryMonthly && baseDays > 0) {
      // Quincena = solo primera cifra de días (12/13/15…); el +N no suma aquí
      salaryQuincena = roundMoney2((salaryMonthly * baseDays) / LVA_PAYROLL_DAY_BASE);
    }
    // SFS auto solo si no es manual (permite 0 = sin descuento de seguro)
    if (!sfsManual) {
      sfs = hasName && salaryQuincena ? roundMoney2(salaryQuincena * LVA_PAYROLL_SFS_RATE) : 0;
    }
  }

  // LVA (La Vega / Monorriel / Lotedom / Banco / Efectivo): comida editable + seguro de vida fijo 90
  const svda = lavega && hasName ? LVA_PAYROLL_SVDA : 0;
  const almuerzoSvda = roundMoney2(almuerzo + svda);

  // Restan: SFS/SVDS, uniformes, comida, seguro de vida, rifa, adelantos, préstamos
  const totalDescuentos = roundMoney2(sfs + uniformes + almuerzo + svda + rifa + adelantos + prestamos);
  // Suman al quincenal: volaos (+N), incentivos, horas extras, feriado
  const totalCobrar = roundMoney2(salaryQuincena + volaos + incentivos + horasExtras + feriado);
  const salarioDepositar = roundMoney2(Math.max(0, totalCobrar - totalDescuentos));
  const redondeo = roundTo50(salarioDepositar);
  const salary = salaryMonthly;
  const other = roundMoney2(volaos + incentivos + horasExtras + feriado);
  const deductions = totalDescuentos;
  const net = redondeo;
  return {
    ...line,
    manualEntry: manual,
    salaryMonthly,
    salaryQuincena,
    sfs,
    sfsManual,
    uniformes,
    volaos,
    incentivos,
    horasExtras,
    horasExtrasManual,
    feriado,
    almuerzo,
    svda,
    almuerzoSvda,
    rifa,
    adelantos,
    prestamos,
    totalDescuentos,
    totalCobrar,
    salarioDepositar,
    redondeo,
    salary,
    other,
    deductions,
    net,
    daysWorked: office ? "" : manual ? String(line.daysWorked || "").trim() : daysInfo.label || String(line.daysWorked || ""),
  };
}

function computePayrollLineTotalsForPayroll(p, line) {
  return computePayrollLineTotals(line, payrollComputeOpts(p));
}

function normalizePayrollLine(l = {}, opts = {}) {
  const office = !!(opts && opts.office);
  const lavega = !!(opts && opts.lavega);
  const base = {
    employeeId: l.employeeId || "",
    fullName: String(l.fullName || "").trim(),
    position: String(l.position || "").trim(),
    cedula: String(l.cedula || "").trim(),
    daysWorked: office
      ? ""
      : String(l.daysWorked != null ? l.daysWorked : l.days || "15").trim() || "15",
    salaryMonthly: Math.max(0, Number(l.salaryMonthly != null ? l.salaryMonthly : l.salary) || 0),
    salaryQuincena: Math.max(0, Number(l.salaryQuincena) || 0),
    sfs: Math.max(0, Number(l.sfs) || 0),
    /** Usuario fijó SFS a mano (incluso 0 = sin seguro). */
    sfsManual: !!l.sfsManual,
    uniformes: Math.max(0, Number(l.uniformes) || 0),
    volaos: Math.max(0, Number(l.volaos) || 0),
    incentivos: Math.max(0, Number(l.incentivos) || 0),
    horasExtras: Math.max(0, Number(l.horasExtras) || 0),
    /** Usuario fijó horas extras a mano (incluso 0). */
    horasExtrasManual: !!l.horasExtrasManual,
    feriado: Math.max(0, Number(l.feriado) || 0),
    almuerzo: Math.max(0, Number(l.almuerzo) || 0),
    rifa: Math.max(0, Number(l.rifa) || 0),
    adelantos: Math.max(0, Number(l.adelantos) || 0),
    prestamos: Math.max(0, Number(l.prestamos) || 0),
    totalDescuentos: Math.max(0, Number(l.totalDescuentos) || 0),
    totalCobrar: Math.max(0, Number(l.totalCobrar) || 0),
    salarioDepositar: Math.max(0, Number(l.salarioDepositar) || 0),
    redondeo: Math.max(0, Number(l.redondeo) || 0),
    salary: Math.max(0, Number(l.salary) || 0),
    other: Number(l.other) || 0,
    deductions: Math.max(0, Number(l.deductions) || 0),
    net: Math.max(0, Number(l.net) || 0),
    note: String(l.note || "").trim(),
    /** Solo edición en pantalla: empleado ya revisado en la nómina (no se imprime). */
    reviewed: !!l.reviewed,
    /** Trato especial: sin fórmulas (días/volao/extras/quincena auto). */
    manualEntry: !!(l.manualEntry || l.manual),
  };
  // Si viene de nómina oficina antigua (solo salary/net), conservar
  if (!base.salaryMonthly && base.salary) base.salaryMonthly = base.salary;
  const hasExcelShape =
    base.salaryQuincena ||
    base.sfs ||
    base.uniformes ||
    base.volaos ||
    base.rifa ||
    base.totalCobrar ||
    base.salarioDepositar ||
    base.redondeo ||
    (base.daysWorked && base.salaryMonthly) ||
    (office && base.salaryMonthly);
  if (hasExcelShape || base.salaryMonthly || base.manualEntry) {
    return computePayrollLineTotals(base, opts);
  }
  const salary = base.salary || base.salaryMonthly;
  const other = base.other;
  const deductions = base.deductions;
  const net = Math.max(0, salary + other - deductions);
  return { ...base, salary, other, deductions, net, salaryMonthly: salary, redondeo: net, salarioDepositar: net };
}

/** Fecha de pago canónica 5/20 (corrige borradores viejos con 15/30). */
function effectivePayrollPayDate(p) {
  if (!p) return "";
  const period = monthKeyFromDate(p.period) || String(p.period || "").slice(0, 7);
  const half = p.half === 2 || p.half === "2" ? 2 : 1;
  const canonical = /^\d{4}-\d{2}$/.test(period) ? payrollPayDateFor(period, half) : "";
  const raw = String(p.payDate || "").slice(0, 10);
  if (!raw) return canonical;
  const day = Number(String(raw).slice(8, 10));
  // Solo 5 y 20 son válidos para descuento de préstamos / depósito
  if (day === 5 || day === 20) {
    // Si el día es correcto pero no cuadra con la quincena, preferir canónica
    if (canonical && raw !== canonical) return canonical;
    return raw;
  }
  return canonical || raw;
}

function normalizePayroll(p = {}) {
  const period = monthKeyFromDate(p.period) || String(p.period || "").slice(0, 7);
  const half = p.half === 2 || p.half === "2" ? 2 : 1;
  let payDate = effectivePayrollPayDate({ ...p, period, half });
  if (!payDate && /^\d{4}-\d{2}$/.test(period)) {
    payDate = payrollPayDateFor(period, half) || payDate;
  }
  const status = ["draft", "paid", "cancelled"].includes(p.status) ? p.status : "draft";
  const group = [
    "oficina",
    "lavega",
    "monorriel",
    "lotedom",
    "banco",
    "efectivo",
    "reaction",
    "general",
  ].includes(p.group)
    ? p.group
    : p.group || "lavega";
  const office = group === "oficina";
  const lavega = payrollGroupUsesLvaParams(group);
  // Si no trae tanda, dejarla vacía (nómina Monorriel antigua). No forzar "dia".
  const tanda =
    group === "monorriel"
      ? String(p.tanda || "").trim()
        ? normalizeMonorrielTandaId(p.tanda)
        : ""
      : "";
  const formulaOpts = payrollComputeOpts({ group, tanda });
  return {
    id: p.id || `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    period: period || currentMonthKey(),
    half,
    group,
    tanda,
    payDate,
    status,
    showFeriado: office ? false : p.showFeriado === true,
    svdaMealSplit: p.svdaMealSplit === true,
    seedRevision: String(p.seedRevision || "").trim(),
    lines: Array.isArray(p.lines) ? p.lines.map((l) => normalizePayrollLine(l, formulaOpts)) : [],
    note: String(p.note || "").trim(),
    createdBy: p.createdBy || "",
    createdAt: p.createdAt || new Date().toISOString(),
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
}

function normalizePayrollBackup(b = {}) {
  const reason = ["save", "paid", "before_delete", "generate", "before_restore", "manual"].includes(b.reason)
    ? b.reason
    : "save";
  const snap = b.snapshot && typeof b.snapshot === "object" ? normalizePayroll(b.snapshot) : null;
  return {
    id: b.id || `pb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    payrollId: String(b.payrollId || (snap && snap.id) || "").trim(),
    reason,
    label: String(b.label || "").trim(),
    createdAt: b.createdAt || new Date().toISOString(),
    updatedAt: b.updatedAt || b.createdAt || new Date().toISOString(),
    createdBy: String(b.createdBy || "").trim(),
    snapshot: snap,
    totals: {
      redondeo: Number(b.totals && b.totals.redondeo) || 0,
      lines: Number(b.totals && b.totals.lines) || 0,
    },
  };
}

function prunePayrollBackups(list, deletedIds) {
  const banned = new Set(normalizePayrollBackupDeletedIds(deletedIds));
  const rows = (Array.isArray(list) ? list : [])
    .map(normalizePayrollBackup)
    .filter(
      (b) =>
        b.snapshot &&
        b.payrollId &&
        !banned.has(b.id) &&
        !banned.has(payrollBackupSuppressKey(b.payrollId)) &&
        !banned.has(payrollBackupStableId(b.payrollId, b.createdAt))
    );
  // Una sola ranura por nómina: el más reciente con empleados (si hay).
  const byPay = new Map();
  rows.forEach((b) => {
    if (!byPay.has(b.payrollId)) byPay.set(b.payrollId, []);
    byPay.get(b.payrollId).push(b);
  });
  const kept = [];
  byPay.forEach((arr) => {
    arr.sort((a, b) => {
      const filled = payrollBackupNamedCount(b) - payrollBackupNamedCount(a);
      if (filled) return filled;
      const dayCmp = payrollBackupDayKey(b.createdAt).localeCompare(payrollBackupDayKey(a.createdAt));
      if (dayCmp) return dayCmp;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    if (arr[0]) kept.push(arr[0]);
  });
  kept.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return kept.slice(0, PAYROLL_BACKUP_MAX);
}

function payrollBackupReasonLabel(reason) {
  if (reason === "paid") return "Al marcar pagada";
  if (reason === "before_delete") return "Antes de eliminar";
  if (reason === "generate") return "Antes de regenerar";
  if (reason === "before_restore") return "Antes de restaurar";
  if (reason === "manual") return "Manual";
  return "Al guardar";
}

/**
 * Un solo respaldo por nómina y fecha: si ya existe, se sobrescribe (mismo id estable).
 * Así al borrar no «renacen» copias con id nuevo al entrar de nuevo.
 */
function snapshotPayrollBackup(payroll, reason = "save") {
  if (!payroll || !payroll.id) return null;
  const snap = normalizePayroll(payroll);
  const named = (snap.lines || []).filter((l) => String(l.fullName || "").trim());
  // No guardar respaldos vacíos (evita ruido al regenerar / recuperar)
  if (!named.length && reason !== "before_delete") return null;
  const redondeo =
    (typeof sumPayrollField === "function"
      ? sumPayrollField(snap.lines, "redondeo") || sumPayrollField(snap.lines, "net")
      : 0) || 0;
  const gMeta =
    typeof payrollGroupMeta === "function"
      ? payrollGroupMeta(snap.group || "general")
      : { short: snap.group || "Nómina" };
  const day = payrollBackupDayKey(new Date().toISOString());
  const stableId = payrollBackupStableId(snap.id, day);
  const suppressKey = payrollBackupSuppressKey(snap.id);
  if (!Array.isArray(contabilidadData.payrollBackups)) contabilidadData.payrollBackups = [];
  let deleted = normalizePayrollBackupDeletedIds(contabilidadData.payrollBackupDeletedIds);
  const banned = new Set(deleted);
  const explicit = reason === "save" || reason === "paid" || reason === "before_delete";

  // Usuario borró el respaldo de esta nómina: no recrear solo (sí al guardar/pagar)
  if (!explicit && (banned.has(suppressKey) || isPayrollBackupSuppressed(snap.id, deleted))) {
    return null;
  }

  // Buscar ranura existente: misma fecha (id estable) o cualquier respaldo de esta nómina
  let idx = contabilidadData.payrollBackups.findIndex(
    (b) => b && (b.id === stableId || (b.payrollId === snap.id && payrollBackupDayKey(b.createdAt) === day))
  );
  if (idx < 0) {
    idx = contabilidadData.payrollBackups.findIndex((b) => b && b.payrollId === snap.id);
  }
  const prev = idx >= 0 ? contabilidadData.payrollBackups[idx] : null;
  const keepId = prev && prev.payrollId === snap.id ? prev.id : stableId;

  if (!explicit && (banned.has(keepId) || banned.has(stableId))) return null;

  // Guardar / pagar vuelve a habilitar la ranura
  if (explicit) {
    deleted = deleted.filter(
      (id) => id !== keepId && id !== stableId && id !== suppressKey && id !== prev?.id
    );
    contabilidadData.payrollBackupDeletedIds = deleted;
  }

  const entry = normalizePayrollBackup({
    id: keepId || stableId,
    payrollId: snap.id,
    reason,
    label: `${gMeta.short} · ${monthLabel(snap.period)} · ${halfLabel(snap.half || 1)} · ${
      snap.status === "paid" ? "Pagada" : "Borrador"
    }`,
    createdBy:
      typeof currentUser !== "undefined" && currentUser
        ? currentUser.displayName || currentUser.username
        : "",
    createdAt: prev && payrollBackupDayKey(prev.createdAt) === day ? prev.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    snapshot: snap,
    totals: { redondeo, lines: named.length },
  });

  // Quitar otros de la misma nómina (solo queda este)
  contabilidadData.payrollBackups = (contabilidadData.payrollBackups || []).filter(
    (b) => !(b && b.payrollId === snap.id)
  );
  contabilidadData.payrollBackups.unshift(entry);

  contabilidadData.payrollBackups = prunePayrollBackups(
    contabilidadData.payrollBackups,
    contabilidadData.payrollBackupDeletedIds
  );
  return entry;
}

function listPayrollBackups(payrollId) {
  const all = prunePayrollBackups(
    contabilidadData.payrollBackups || [],
    contabilidadData.payrollBackupDeletedIds
  );
  if (!payrollId) return all;
  return all.filter((b) => b.payrollId === payrollId);
}

/** Elimina un respaldo de nómina (local + nube). No toca la nómina activa. */
function deletePayrollBackup(backupId) {
  const id = String(backupId || "").trim();
  if (!id) return;
  const b = (contabilidadData.payrollBackups || [])
    .map(normalizePayrollBackup)
    .find((x) => x.id === id);
  if (!b) {
    toast("Respaldo no encontrado.");
    return;
  }
  const label = b.label || id;
  if (
    !confirm(
      `¿Eliminar este respaldo?\n\n${label}\n${payrollBackupReasonLabel(b.reason)} · ${new Date(
        b.createdAt
      ).toLocaleString("es")}\n\nNo se puede deshacer. La nómina abierta no se borra.`
    )
  ) {
    return;
  }
  const payrollId = String(b.payrollId || "").trim();
  const day = payrollBackupDayKey(b.createdAt);
  const samePayIds = (contabilidadData.payrollBackups || [])
    .filter((x) => x && String(x.payrollId || "") === payrollId)
    .map((x) => x.id);
  // Quitar todos los de esta nómina (solo se permite uno) y marcar suspensión hasta guardar
  contabilidadData.payrollBackups = (contabilidadData.payrollBackups || []).filter(
    (x) => String(x && x.payrollId || "") !== payrollId
  );
  const deleted = normalizePayrollBackupDeletedIds([
    id,
    payrollBackupStableId(payrollId, day),
    payrollBackupSuppressKey(payrollId),
    ...samePayIds,
    ...(contabilidadData.payrollBackupDeletedIds || []),
  ]);
  contabilidadData.payrollBackupDeletedIds = deleted;
  contabilidadData.payrollBackups = prunePayrollBackups(
    contabilidadData.payrollBackups,
    deleted
  );
  saveContabilidadData(true);
  if (typeof logActivity === "function") {
    logActivity(
      "payroll_backup_delete",
      `Respaldo eliminado: ${label} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  renderPayrollBackupsPanel(selectedPayrollId);
  toast("Respaldo eliminado. No volverá solo; al guardar se crea de nuevo el del día.");
}

function restorePayrollFromBackup(backupId) {
  const b = (contabilidadData.payrollBackups || []).map(normalizePayrollBackup).find((x) => x.id === backupId);
  if (!b || !b.snapshot) {
    toast("Respaldo no encontrado.");
    return;
  }
  const label = b.label || backupId;
  if (
    !confirm(
      `¿Restaurar nómina desde el respaldo?\n\n${label}\n${payrollBackupReasonLabel(b.reason)} · ${new Date(
        b.createdAt
      ).toLocaleString("es")}\n\nLa versión actual se respaldará antes.`
    )
  ) {
    return;
  }
  const current = (contabilidadData.payrolls || []).find((p) => p.id === b.payrollId);
  if (current) snapshotPayrollBackup(current, "before_restore");
  const restored = normalizePayroll({
    ...b.snapshot,
    id: b.payrollId || b.snapshot.id,
    updatedAt: new Date().toISOString(),
  });
  const idx = (contabilidadData.payrolls || []).findIndex((p) => p.id === restored.id);
  if (idx >= 0) contabilidadData.payrolls[idx] = restored;
  else contabilidadData.payrolls.unshift(restored);
  selectedPayrollId = restored.id;
  saveContabilidadData(true);
  if (typeof logActivity === "function") {
    logActivity(
      "payroll_restore",
      `Nómina restaurada desde respaldo: ${label} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  renderContabilidadModule();
  toast("Nómina restaurada desde el respaldo.");
}

/** Semilla de recuperación: La Vega 01–15 oct 2026 (snapshot 14-oct; días 13 por defecto). */
const LAVEGA_OCT_H1_RECOVERY_SEED = {"id":"pay-1791943152987-8l82","period":"2026-10","half":1,"group":"lavega","tanda":"","payDate":"2026-10-20","status":"draft","showFeriado":false,"svdaMealSplit":true,"seedRevision":"pdf-2026-10-16","note":"Nómina La Vega Autopista · 01 al 15 · Octubre 2026 · Restaurada desde PDF 16/10/2026 (17 empleados · redondeo 216,350)","createdBy":"EDWARD CRUZ","createdAt":"2026-10-14T01:59:12.987Z","updatedAt":"2026-10-19T21:19:36.614Z","lines":[{"employeeId":"emp-1791933177973-ebvz6l","fullName":"ANDRES CABRERA","position":"ENTRADA JARABACOA","cedula":"047-0134385-9","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":1545.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177971-tyaldy","fullName":"FRANCISCO GALAN","position":"BOTADERO 02","cedula":"","daysWorked":"15","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177974-l2dckb","fullName":"FRANKLIN AYBAR","position":"BURENDE","cedula":"047-0013450-7","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177973-r83kcb","fullName":"JORGE FELIX","position":"ENTRADA JARABACOA","cedula":"012-0108564-2","daysWorked":"14+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177969-oleb64","fullName":"JOSE TORRES","position":"miranda carpa","cedula":"","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177974-z6r26t","fullName":"JULIO MOLINA","position":"ARENOSO ABAJO","cedula":"047-0151191-9","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177971-z7cc5y","fullName":"LUIS CASTILLO","position":"traumatologico","cedula":"402-4281609-4","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177972-hwrpcb","fullName":"PABLO RODRIGUEZ","position":"ARROYO EL PINO","cedula":"034-002839-1","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177973-v3ukre","fullName":"RAFAEL TORRES","position":"GEREMIAS","cedula":"","daysWorked":"14+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177974-ujevqp","fullName":"RAFAEL SANTIAGO","position":"GUACO LA VEGA","cedula":"","daysWorked":"13","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-lva-joancabrer-776614","fullName":"JOAN CABRERA","position":"","cedula":"","daysWorked":"15+4","salaryMonthly":24000.0,"almuerzo":400.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177972-lhh81e","fullName":"RAFAEL CRUZ","position":"INGENIERIA ESTRELLA","cedula":"056-0096608-8","daysWorked":"9","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-lva-juancruz-776614","fullName":"JUAN CRUZ","position":"","cedula":"","daysWorked":"9","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-lva-gilbertoay-776614","fullName":"GILBERTO AYALA","position":"","cedula":"","daysWorked":"6+2","salaryMonthly":24000.0,"almuerzo":200.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-lva-darlinacev-776614","fullName":"DARLIN ACEVEDO","position":"","cedula":"","daysWorked":"7+2","salaryMonthly":24000.0,"almuerzo":200.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-1791933177971-epawy6","fullName":"JOSE FERREIRA","position":"botadero","cedula":"","daysWorked":"11","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":0.0,"incentivos":0,"feriado":0,"reviewed":false},{"employeeId":"emp-lva-angelabreu-776614","fullName":"ANGEL ABREU","position":"","cedula":"","daysWorked":"7.8","salaryMonthly":24000.0,"almuerzo":0.0,"rifa":85.0,"uniformes":115,"prestamos":0.0,"adelantos":450.0,"incentivos":0,"feriado":0,"reviewed":false}]};

/**
 * Restaura La Vega 01–15 oct desde el PDF corregido (17 empleados · redondeo 216,350).
 * Aplica si está vacía o si aún no tiene seedRevision del PDF (evita quedar con la copia vieja de 12).
 */
function recoverLavegaOctPayrollIfEmpty() {
  const seed = LAVEGA_OCT_H1_RECOVERY_SEED;
  if (!seed || !seed.id) return false;
  if (!contabilidadData || typeof contabilidadData !== "object") return false;
  if (!Array.isArray(contabilidadData.payrolls)) contabilidadData.payrolls = [];
  const seedRev = String(seed.seedRevision || "pdf-2026-10-16");
  const idx = contabilidadData.payrolls.findIndex(
    (p) =>
      p &&
      (p.id === seed.id ||
        (p.group === "lavega" &&
          p.period === "2026-10" &&
          (p.half === 1 || !p.half) &&
          p.status !== "cancelled"))
  );
  const existing = idx >= 0 ? contabilidadData.payrolls[idx] : null;
  const named = existing ? payrollNamedLineCount(existing) : 0;
  const alreadyPdf =
    existing &&
    String(existing.seedRevision || "") === seedRev &&
    named === (seed.lines || []).length;
  if (alreadyPdf) return false;
  // Preferir el PDF embebido sobre respaldos viejos (12 empleados / días 13).
  const lines = Array.isArray(seed.lines) && seed.lines.length ? seed.lines : [];
  if (!lines.length) return false;
  const restored = normalizePayroll({
    ...seed,
    id: (existing && existing.id) || seed.id,
    period: "2026-10",
    half: 1,
    group: "lavega",
    payDate: seed.payDate || "2026-10-20",
    status: "draft",
    showFeriado: false,
    svdaMealSplit: true,
    seedRevision: seedRev,
    lines,
    note:
      seed.note ||
      "Nómina La Vega Autopista · 01 al 15 · Octubre 2026 · Restaurada desde PDF 16/10/2026",
    createdBy: seed.createdBy || (existing && existing.createdBy) || "",
    createdAt: seed.createdAt || (existing && existing.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  if (payrollNamedLineCount(restored) === 0) return false;
  if (idx >= 0) contabilidadData.payrolls[idx] = restored;
  else contabilidadData.payrolls.unshift(restored);
  // Sin snapshot aquí: evita crear respaldos solos cada vez que se abre Contabilidad.
  return true;
}

function normalizeContabilidadData(raw = {}) {
  return {
    expenses: Array.isArray(raw.expenses) ? raw.expenses.map(normalizeFiscalExpense) : [],
    itbisCollected: Array.isArray(raw.itbisCollected)
      ? raw.itbisCollected.map(normalizeItbisCollected)
      : [],
    officeEmployees: Array.isArray(raw.officeEmployees)
      ? raw.officeEmployees.map(normalizeOfficeEmployee)
      : [],
    lotedomEmployees: Array.isArray(raw.lotedomEmployees)
      ? raw.lotedomEmployees.map(normalizeOfficeEmployee)
      : [],
    payrolls: Array.isArray(raw.payrolls) ? raw.payrolls.map(normalizePayroll) : [],
    payrollBackupDeletedIds: normalizePayrollBackupDeletedIds(raw.payrollBackupDeletedIds),
    payrollBackups: prunePayrollBackups(
      Array.isArray(raw.payrollBackups) ? raw.payrollBackups : [],
      raw.payrollBackupDeletedIds
    ),
    settings: {
      defaultBook: String((raw.settings && raw.settings.defaultBook) || "EDWARD").trim() || "EDWARD",
    },
  };
}

function saveContabilidadData(push = true) {
  contabilidadData = normalizeContabilidadData(contabilidadData);
  localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
  if (push && typeof queueCloudSave === "function") queueCloudSave();
}

function applyRemoteContabilidadData(remote) {
  // Conservar tecleo local de nómina antes de fusionar con la nube
  try {
    if (typeof flushOpenPayrollDraft === "function") flushOpenPayrollDraft(false);
  } catch (_) {}
  const remoteNorm = normalizeContabilidadData(remote || {});
  const local = normalizeContabilidadData(contabilidadData);

  function mergeById(a, b) {
    const map = new Map();
    [...a, ...b].forEach((row) => {
      if (!row || !row.id) return;
      const prev = map.get(row.id);
      if (!prev || String(row.updatedAt) > String(prev.updatedAt)) map.set(row.id, row);
    });
    return [...map.values()].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
  }

  /** Nunca dejar que una nómina vacía (0 empleados) pise una con datos. */
  function mergePayrollLinesPreserveAmounts(winner, other) {
    if (!winner) return other;
    if (!other) return winner;
    const otherByKey = new Map();
    (other.lines || []).forEach((l) => {
      if (!l) return;
      const id = String(l.employeeId || "").trim();
      const name = String(l.fullName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const key = id ? `id:${id}` : name ? `name:${name}` : "";
      if (key) otherByKey.set(key, l);
    });
    const lines = (winner.lines || []).map((l) => {
      if (!l) return l;
      const id = String(l.employeeId || "").trim();
      const name = String(l.fullName || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      const key = id ? `id:${id}` : name ? `name:${name}` : "";
      const o = key ? otherByKey.get(key) : null;
      if (!o) return l;
      const next = { ...l };
      ["adelantos", "prestamos", "incentivos", "almuerzo"].forEach((f) => {
        const wv = Number(next[f]) || 0;
        const ov = Number(o[f]) || 0;
        if (wv === 0 && ov > 0) next[f] = o[f];
      });
      if (!(Number(next.horasExtras) > 0) && Number(o.horasExtras) > 0 && !next.horasExtrasManual) {
        next.horasExtras = o.horasExtras;
        if (o.horasExtrasManual) next.horasExtrasManual = true;
      }
      return next;
    });
    return { ...winner, lines };
  }

  function mergePayrollsPreferFilled(a, b) {
    const map = new Map();
    function moneyScore(p) {
      let s = 0;
      (p.lines || []).forEach((l) => {
        if (!l || !String(l.fullName || "").trim()) return;
        if (Number(l.adelantos) > 0) s += 1;
        if (Number(l.prestamos) > 0) s += 1;
        if (Number(l.horasExtras) > 0) s += 1;
      });
      return s;
    }
    function consider(row) {
      if (!row || !row.id) return;
      const prev = map.get(row.id);
      if (!prev) {
        map.set(row.id, row);
        return;
      }
      const prevN = payrollNamedLineCount(prev);
      const rowN = payrollNamedLineCount(row);
      if (prevN > 0 && rowN === 0) return;
      if (rowN > 0 && prevN === 0) {
        map.set(row.id, row);
        return;
      }
      let winner = String(row.updatedAt) > String(prev.updatedAt) ? row : prev;
      let other = winner === row ? prev : row;
      if (moneyScore(other) > moneyScore(winner) + 2) {
        const tmp = winner;
        winner = other;
        other = tmp;
      }
      map.set(row.id, mergePayrollLinesPreserveAmounts(winner, other));
    }
    [...a, ...b].forEach(consider);
    return [...map.values()].sort((x, y) => String(y.updatedAt).localeCompare(String(x.updatedAt)));
  }

  function mergeBackupsPreferFilled(a, b, deletedIds) {
    const banned = new Set(normalizePayrollBackupDeletedIds(deletedIds));
    const map = new Map();
    function consider(row) {
      if (!row || !row.id || banned.has(row.id)) return;
      if (banned.has(payrollBackupSuppressKey(row.payrollId))) return;
      if (banned.has(payrollBackupStableId(row.payrollId, row.createdAt))) return;
      const prev = map.get(row.id);
      if (!prev) {
        map.set(row.id, row);
        return;
      }
      const prevN = payrollBackupNamedCount(prev);
      const rowN = payrollBackupNamedCount(row);
      if (prevN > 0 && rowN === 0) return;
      if (rowN > 0 && prevN === 0) {
        map.set(row.id, row);
        return;
      }
      if (String(row.updatedAt || row.createdAt) > String(prev.updatedAt || prev.createdAt)) {
        map.set(row.id, row);
      }
    }
    [...a, ...b].forEach(consider);
    return [...map.values()];
  }

  const deletedIds = normalizePayrollBackupDeletedIds([
    ...(local.payrollBackupDeletedIds || []),
    ...(remoteNorm.payrollBackupDeletedIds || []),
  ]);

  contabilidadData = {
    expenses: mergeById(local.expenses, remoteNorm.expenses),
    itbisCollected: mergeById(local.itbisCollected, remoteNorm.itbisCollected),
    officeEmployees: mergeById(local.officeEmployees, remoteNorm.officeEmployees),
    lotedomEmployees: mergeById(local.lotedomEmployees || [], remoteNorm.lotedomEmployees || []),
    payrolls: mergePayrollsPreferFilled(local.payrolls, remoteNorm.payrolls),
    payrollBackupDeletedIds: deletedIds,
    payrollBackups: prunePayrollBackups(
      mergeBackupsPreferFilled(local.payrollBackups || [], remoteNorm.payrollBackups || [], deletedIds),
      deletedIds
    ),
    settings: {
      defaultBook: remoteNorm.settings.defaultBook || local.settings.defaultBook || "EDWARD",
    },
  };
  try {
    recoverLavegaOctPayrollIfEmpty();
  } catch (_) {}
  localStorage.setItem(CONTABILIDAD_KEY, JSON.stringify(contabilidadData));
}

function canAccessContabilidad() {
  if (!currentUser) return false;
  if (currentUser.role === "owner") return true;
  return !!(currentUser.modules && currentUser.modules.contabilidad);
}

function setContabTab(tab) {
  // "nomina" ya no es sub-pestaña: abrir vista propia
  if (tab === "nomina") {
    openNominaView();
    return;
  }
  contabTab = tab || "gastos";
  document.querySelectorAll(".contab-tabs .emp-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.contabTab === contabTab);
  });
  const map = {
    gastos: "contabTabGastos",
    itbis: "contabTabItbis",
    liquidacion: "contabTabLiquidacion",
    oficina: "contabTabOficina",
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.hidden = contabTab !== key;
  });
  renderContabilidadModule();
}

function openNominaView() {
  if (typeof switchView === "function") switchView("nominaView");
  else {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    const el = document.getElementById("nominaView");
    if (el) el.classList.add("active");
    renderNominaModule();
  }
}

function renderNominaModule() {
  if (!canAccessContabilidad()) return;
  ensureMonthFilter();
  syncNominaMonthFilter();
  const summary = document.getElementById("nominaSummary");
  if (summary) {
    const n = (contabilidadData.payrolls || []).length;
    summary.textContent = `${monthLabel(getSelectedMonth())} · ${n} nómina(s) · cada una en su propio documento en la nube (hasta 1 MB).`;
  }
  renderNominaTab();
}

function getSelectedMonth() {
  const nominaEl = document.getElementById("nominaMonthFilter");
  const contabEl = document.getElementById("contabMonthFilter");
  const active = document.querySelector(".view.active");
  const preferNomina = active && active.id === "nominaView";
  const el = preferNomina ? nominaEl || contabEl : contabEl || nominaEl;
  const v = el && el.value;
  return monthKeyFromDate(v) || currentMonthKey();
}

function ensureMonthFilter() {
  const key = currentMonthKey();
  ["contabMonthFilter", "nominaMonthFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.value) el.value = key;
  });
}

function syncNominaMonthFilter() {
  const a = document.getElementById("nominaMonthFilter");
  const b = document.getElementById("contabMonthFilter");
  if (!a || !b) return;
  if (a.value && !b.value) b.value = a.value;
  else if (b.value && !a.value) a.value = b.value;
  else if (a.value && b.value && a.value !== b.value) {
    const active = document.querySelector(".view.active");
    if (active && active.id === "nominaView") b.value = a.value;
    else a.value = b.value;
  }
}

function filterByMonth(rows, dateField = "date") {
  const ym = getSelectedMonth();
  return (rows || []).filter((r) => monthKeyFromDate(r[dateField]) === ym);
}

function sumField(rows, field) {
  return (rows || []).reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
}

function fillExpenseForm(e) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = val == null ? "" : val;
  };
  set("cfeDate", e.date || "");
  set("cfeAmount", e.amount ? String(e.amount) : "");
  set("cfeItbis", e.itbis ? String(e.itbis) : "");
  set("cfeVendor", e.vendor || "");
  set("cfeNcf", e.ncf || "");
  set("cfeRnc", e.rnc || "");
  set("cfeBook", e.book || "EDWARD");
  set("cfeNote", e.note || "");
  const title = document.getElementById("cfeFormTitle");
  if (title) title.textContent = e.id && selectedContabExpenseId ? "Editar gasto fiscal" : "Nuevo gasto fiscal";
}

function clearExpenseForm() {
  selectedContabExpenseId = "";
  fillExpenseForm({
    ...emptyFiscalExpense(),
    book: (contabilidadData.settings && contabilidadData.settings.defaultBook) || "EDWARD",
  });
}

function readExpenseForm() {
  const amount = Math.max(0, Number(document.getElementById("cfeAmount")?.value) || 0);
  let itbis = Math.max(0, Number(document.getElementById("cfeItbis")?.value) || 0);
  if (!itbis && amount > 0) {
    itbis = Math.round((amount - amount / (1 + ITBIS_RATE)) * 100) / 100;
  }
  return normalizeFiscalExpense({
    id: selectedContabExpenseId || undefined,
    date: document.getElementById("cfeDate")?.value || "",
    amount,
    itbis,
    vendor: document.getElementById("cfeVendor")?.value || "",
    ncf: document.getElementById("cfeNcf")?.value || "",
    rnc: document.getElementById("cfeRnc")?.value || "",
    book: document.getElementById("cfeBook")?.value || "EDWARD",
    note: document.getElementById("cfeNote")?.value || "",
  });
}

function saveExpenseFromForm() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  const row = readExpenseForm();
  if (!row.date) {
    toast("Indica la fecha.");
    return;
  }
  if (!row.amount) {
    toast("Indica el monto.");
    return;
  }
  if (!row.vendor) {
    toast("Indica el nombre comercial.");
    return;
  }
  if (!row.ncf) {
    toast("Indica el NCF.");
    return;
  }
  row.updatedAt = new Date().toISOString();
  if (selectedContabExpenseId) {
    const idx = contabilidadData.expenses.findIndex((x) => x.id === selectedContabExpenseId);
    if (idx >= 0) {
      row.id = selectedContabExpenseId;
      row.createdAt = contabilidadData.expenses[idx].createdAt;
      row.createdBy = contabilidadData.expenses[idx].createdBy;
      contabilidadData.expenses[idx] = row;
    } else {
      contabilidadData.expenses.unshift(row);
    }
  } else {
    row.createdBy =
      typeof currentUser !== "undefined" && currentUser
        ? currentUser.displayName || currentUser.username
        : "";
    contabilidadData.expenses.unshift(row);
  }
  saveContabilidadData(true);
  clearExpenseForm();
  renderContabilidadModule();
  toast("Gasto fiscal guardado.");
}

function editExpense(id) {
  const row = contabilidadData.expenses.find((x) => x.id === id);
  if (!row) return;
  selectedContabExpenseId = row.id;
  fillExpenseForm(row);
  setContabTab("gastos");
  document.getElementById("cfeVendor")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function deleteExpense(id) {
  const row = contabilidadData.expenses.find((x) => x.id === id);
  if (!row) return;
  if (!confirm(`¿Eliminar gasto de ${row.vendor} · ${moneyRd(row.amount)}?`)) return;
  contabilidadData.expenses = contabilidadData.expenses.filter((x) => x.id !== id);
  if (selectedContabExpenseId === id) clearExpenseForm();
  saveContabilidadData(true);
  renderContabilidadModule();
  toast("Gasto eliminado.");
}

function renderExpensesTab() {
  const list = document.getElementById("contabExpenseList");
  const stats = document.getElementById("contabExpenseStats");
  if (!list) return;
  const rows = filterByMonth(contabilidadData.expenses).sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
  const totalMonto = sumField(rows, "amount");
  const totalItbis = sumField(rows, "itbis");
  if (stats) {
    stats.innerHTML = `<div class="stats-grid">
      <div class="stat-box"><span class="muted">Facturas</span><strong>${rows.length}</strong></div>
      <div class="stat-box"><span class="muted">Total monto</span><strong>${escapeHtml(moneyRd(totalMonto))}</strong></div>
      <div class="stat-box"><span class="muted">Total ITBIS</span><strong>${escapeHtml(moneyRd(totalItbis))}</strong></div>
    </div>`;
  }
  if (!rows.length) {
    list.innerHTML = `<p class="empty">No hay gastos fiscales en ${escapeHtml(monthLabel(getSelectedMonth()))}. Digita las facturas con NCF como en la relación de gastos.</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (e) => `<article class="report-card">
      <h3>${escapeHtml(e.vendor)}</h3>
      <p class="muted">${escapeHtml(e.date)} · NCF ${escapeHtml(e.ncf || "—")} · RNC ${escapeHtml(
        e.rnc || "—"
      )}</p>
      <p><strong>${escapeHtml(moneyRd(e.amount))}</strong>
        <span class="muted"> · ITBIS ${escapeHtml(moneyRd(e.itbis))} · ${escapeHtml(e.book || "")}</span></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="btn secondary btn-cfe-edit" data-id="${escapeHtml(
          e.id
        )}" style="width:auto;padding:8px 10px;font-size:12px">Editar</button>
        <button type="button" class="btn danger btn-cfe-del" data-id="${escapeHtml(
          e.id
        )}" style="width:auto;padding:8px 10px;font-size:12px">Eliminar</button>
      </div>
    </article>`
    )
    .join("");
  list.querySelectorAll(".btn-cfe-edit").forEach((btn) =>
    btn.addEventListener("click", () => editExpense(btn.dataset.id))
  );
  list.querySelectorAll(".btn-cfe-del").forEach((btn) =>
    btn.addEventListener("click", () => deleteExpense(btn.dataset.id))
  );
}

function clearItbisForm() {
  document.getElementById("itcDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("itcClient").value = "";
  document.getElementById("itcInvoice").value = "";
  document.getElementById("itcBase").value = "";
  document.getElementById("itcItbis").value = "";
  document.getElementById("itcTotal").value = "";
  document.getElementById("itcNote").value = "";
}

function saveItbisFromForm() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  const base = Math.max(0, Number(document.getElementById("itcBase")?.value) || 0);
  let itbis = Math.max(0, Number(document.getElementById("itcItbis")?.value) || 0);
  let total = Math.max(0, Number(document.getElementById("itcTotal")?.value) || 0);
  if (base > 0 && !itbis) itbis = Math.round(base * ITBIS_RATE * 100) / 100;
  if (base > 0 && !total) total = Math.round((base + itbis) * 100) / 100;
  if (!itbis && total > 0) {
    const b = Math.round((total / (1 + ITBIS_RATE)) * 100) / 100;
    itbis = Math.round((total - b) * 100) / 100;
  }
  const row = normalizeItbisCollected({
    date: document.getElementById("itcDate")?.value || "",
    client: document.getElementById("itcClient")?.value || "",
    invoiceRef: document.getElementById("itcInvoice")?.value || "",
    baseAmount: base,
    itbis,
    totalAmount: total,
    note: document.getElementById("itcNote")?.value || "",
    createdBy:
      typeof currentUser !== "undefined" && currentUser
        ? currentUser.displayName || currentUser.username
        : "",
  });
  if (!row.date) {
    toast("Indica la fecha.");
    return;
  }
  if (!row.itbis) {
    toast("Indica el ITBIS cobrado (o la base / total de la factura).");
    return;
  }
  contabilidadData.itbisCollected.unshift(row);
  saveContabilidadData(true);
  clearItbisForm();
  renderContabilidadModule();
  toast("ITBIS cobrado registrado.");
}

function deleteItbisCollected(id) {
  const row = contabilidadData.itbisCollected.find((x) => x.id === id);
  if (!row) return;
  if (!confirm(`¿Eliminar ITBIS de ${row.client || "cliente"} · ${moneyRd(row.itbis)}?`)) return;
  contabilidadData.itbisCollected = contabilidadData.itbisCollected.filter((x) => x.id !== id);
  saveContabilidadData(true);
  renderContabilidadModule();
  toast("Registro eliminado.");
}

function renderItbisTab() {
  const list = document.getElementById("contabItbisList");
  const stats = document.getElementById("contabItbisStats");
  if (!list) return;
  const rows = filterByMonth(contabilidadData.itbisCollected).sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
  const totalItbis = sumField(rows, "itbis");
  const totalFact = sumField(rows, "totalAmount");
  if (stats) {
    stats.innerHTML = `<div class="stats-grid">
      <div class="stat-box"><span class="muted">Cobros</span><strong>${rows.length}</strong></div>
      <div class="stat-box"><span class="muted">ITBIS cobrado</span><strong>${escapeHtml(moneyRd(totalItbis))}</strong></div>
      <div class="stat-box"><span class="muted">Total facturado</span><strong>${escapeHtml(moneyRd(totalFact))}</strong></div>
    </div>`;
  }
  if (!rows.length) {
    list.innerHTML = `<p class="empty">Aún no hay ITBIS cobrado en ${escapeHtml(
      monthLabel(getSelectedMonth())
    )}. Cuando cobras una factura, registra aquí el 18%.</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (r) => `<article class="report-card">
      <h3>${escapeHtml(r.client || "Cliente")}</h3>
      <p class="muted">${escapeHtml(r.date)}${r.invoiceRef ? ` · Factura ${escapeHtml(r.invoiceRef)}` : ""}</p>
      <p><strong>ITBIS ${escapeHtml(moneyRd(r.itbis))}</strong>
        <span class="muted"> · Base ${escapeHtml(moneyRd(r.baseAmount))} · Total ${escapeHtml(
        moneyRd(r.totalAmount)
      )}</span></p>
      <button type="button" class="btn danger btn-itc-del" data-id="${escapeHtml(
        r.id
      )}" style="width:auto;padding:8px 10px;font-size:12px;margin-top:8px">Eliminar</button>
    </article>`
    )
    .join("");
  list.querySelectorAll(".btn-itc-del").forEach((btn) =>
    btn.addEventListener("click", () => deleteItbisCollected(btn.dataset.id))
  );
}

function renderLiquidacionTab() {
  const box = document.getElementById("contabLiquidacionBox");
  if (!box) return;
  const ym = getSelectedMonth();
  const gastos = filterByMonth(contabilidadData.expenses);
  const cobros = filterByMonth(contabilidadData.itbisCollected);
  const itbisCompras = sumField(gastos, "itbis");
  const itbisVentas = sumField(cobros, "itbis");
  const aPagar = Math.round((itbisVentas - itbisCompras) * 100) / 100;
  const verb =
    aPagar > 0
      ? `A pagar a DGII: ${moneyRd(aPagar)}`
      : aPagar < 0
        ? `Saldo a favor / crédito: ${moneyRd(Math.abs(aPagar))}`
        : "Liquidación en cero";
  box.innerHTML = `
    <p class="muted">Mes: <strong>${escapeHtml(monthLabel(ym))}</strong></p>
    <div class="stats-grid" style="margin-top:10px">
      <div class="stat-box"><span class="muted">ITBIS cobrado (ventas)</span><strong>${escapeHtml(
        moneyRd(itbisVentas)
      )}</strong></div>
      <div class="stat-box"><span class="muted">ITBIS en compras (crédito)</span><strong>${escapeHtml(
        moneyRd(itbisCompras)
      )}</strong></div>
    </div>
    <div class="form-card finance-total" style="margin-top:12px">
      <p class="muted">ITBIS cobrado − ITBIS de gastos con NCF</p>
      <div class="money-big">${escapeHtml(verb)}</div>
      <p class="muted tight" style="margin-top:10px">Fórmula: impuestos que te pagaron los clientes menos el ITBIS de las facturas de compra con comprobante fiscal.</p>
    </div>
    <p class="muted tight" style="margin-top:12px">${gastos.length} factura(s) de gasto · ${
      cobros.length
    } cobro(s) de ITBIS</p>`;
}

function fillOfficeEmpForm(e) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!val;
    else el.value = val == null ? "" : val;
  };
  set("oempName", e.fullName || "");
  set("oempCedula", e.cedula || "");
  set("oempPosition", e.position || "");
  set("oempPhone", e.phone || "");
  set("oempEmail", e.email || "");
  set("oempSalary", e.salary ? String(e.salary) : "");
  set("oempBank", e.bankName || "");
  set("oempAccount", e.bankAccount || "");
  set("oempNotes", e.notes || "");
  set("oempActive", e.active !== false);
  const title = document.getElementById("oempFormTitle");
  if (title) title.textContent = selectedOfficeEmpId ? "Editar empleado de oficina" : "Nuevo empleado de oficina";
}

function clearOfficeEmpForm() {
  selectedOfficeEmpId = "";
  fillOfficeEmpForm(emptyOfficeEmployee());
}

function saveOfficeEmpFromForm() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  const row = normalizeOfficeEmployee({
    id: selectedOfficeEmpId || undefined,
    fullName: document.getElementById("oempName")?.value || "",
    cedula: document.getElementById("oempCedula")?.value || "",
    position: document.getElementById("oempPosition")?.value || "",
    phone: document.getElementById("oempPhone")?.value || "",
    email: document.getElementById("oempEmail")?.value || "",
    salary: document.getElementById("oempSalary")?.value || 0,
    bankName: document.getElementById("oempBank")?.value || "",
    bankAccount: document.getElementById("oempAccount")?.value || "",
    notes: document.getElementById("oempNotes")?.value || "",
    active: !!document.getElementById("oempActive")?.checked,
  });
  if (!row.fullName) {
    toast("Escribe el nombre del empleado.");
    return;
  }
  row.updatedAt = new Date().toISOString();
  if (selectedOfficeEmpId) {
    const idx = contabilidadData.officeEmployees.findIndex((x) => x.id === selectedOfficeEmpId);
    if (idx >= 0) {
      row.createdAt = contabilidadData.officeEmployees[idx].createdAt;
      contabilidadData.officeEmployees[idx] = row;
    } else contabilidadData.officeEmployees.unshift(row);
  } else {
    contabilidadData.officeEmployees.unshift(row);
  }
  saveContabilidadData(true);
  if (typeof ensureOfficeEmployeesImported === "function") {
    try {
      ensureOfficeEmployeesImported();
    } catch (_) {}
  }
  clearOfficeEmpForm();
  renderContabilidadModule();
  toast("Empleado de oficina guardado.");
}

function editOfficeEmp(id) {
  const row = contabilidadData.officeEmployees.find((x) => x.id === id);
  if (!row) return;
  selectedOfficeEmpId = row.id;
  fillOfficeEmpForm(row);
  setContabTab("oficina");
}

function deleteOfficeEmp(id) {
  const row = contabilidadData.officeEmployees.find((x) => x.id === id);
  if (!row) return;
  if (!confirm(`¿Eliminar a ${row.fullName} de la lista de oficina?`)) return;
  contabilidadData.officeEmployees = contabilidadData.officeEmployees.filter((x) => x.id !== id);
  if (selectedOfficeEmpId === id) clearOfficeEmpForm();
  saveContabilidadData(true);
  renderContabilidadModule();
  toast("Empleado eliminado de oficina.");
}

function renderOficinaTab() {
  const list = document.getElementById("contabOfficeList");
  if (!list) return;
  const rows = (contabilidadData.officeEmployees || []).slice().sort((a, b) =>
    String(a.fullName).localeCompare(String(b.fullName), "es")
  );
  if (!rows.length) {
    list.innerHTML = `<p class="empty">Todavía no hay empleados de oficina. Crea la lista aquí; luego armamos la nómina del día 30.</p>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (e) => `<article class="report-card">
      <h3>${escapeHtml(e.fullName)}${e.active ? "" : ' <span class="muted">(inactivo)</span>'}</h3>
      <p class="muted">${escapeHtml(e.position || "Sin cargo")}${
        e.cedula ? ` · ${escapeHtml(e.cedula)}` : ""
      }</p>
      <p><strong>${escapeHtml(moneyRd(e.salary))}</strong>
        <span class="muted">${e.phone ? ` · ${escapeHtml(e.phone)}` : ""}</span></p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button type="button" class="btn secondary btn-oemp-edit" data-id="${escapeHtml(
          e.id
        )}" style="width:auto;padding:8px 10px;font-size:12px">Editar</button>
        <button type="button" class="btn danger btn-oemp-del" data-id="${escapeHtml(
          e.id
        )}" style="width:auto;padding:8px 10px;font-size:12px">Eliminar</button>
      </div>
    </article>`
    )
    .join("");
  list.querySelectorAll(".btn-oemp-edit").forEach((btn) =>
    btn.addEventListener("click", () => editOfficeEmp(btn.dataset.id))
  );
  list.querySelectorAll(".btn-oemp-del").forEach((btn) =>
    btn.addEventListener("click", () => deleteOfficeEmp(btn.dataset.id))
  );
}

const PAYROLL_GROUP_META = {
  lavega: { label: "La Vega Autopista", short: "La Vega", title: "LA VEGA AUTOPISTA" },
  oficina: { label: "Oficina", short: "Oficina", title: "OFICINA" },
  monorriel: { label: "Monorriel", short: "Monorriel", title: "MONORRIEL" },
  lotedom: { label: "LOTEDOM", short: "LOTEDOM", title: "LOTEDOM" },
  reaction: { label: "Reaction General (Vargas)", short: "Reaction", title: "REACTION GENERAL" },
  banco: { label: "Reaction Banco", short: "Banco", title: "REACTION BANCO" },
  efectivo: { label: "Reaction Efectivo", short: "Efectivo", title: "REACTION EFECTIVO" },
  general: { label: "General / Otros", short: "General", title: "GENERAL / OTROS" },
};

/** Grupos con fórmula La Vega (Unif/Rifa, Comida/Seg. vida, nombres cortos). */
const PAYROLL_LVA_GROUPS = ["lavega", "monorriel", "lotedom", "reaction", "banco", "efectivo"];

function payrollGroupUsesLvaParams(group) {
  return PAYROLL_LVA_GROUPS.includes(group);
}

/**
 * Semilla nómina LOTEDOM (PDF Nómina Lotedom · 16-30 sep 2026).
 * Mismos parámetros que Monorriel/La Vega: Unif/Rifa 115/85, Comida + Seg. vida (90),
 * nombre corto (1+1). Seguro vida del PDF se une en SVDA; sueldos/días/extras/desc. del PDF.
 */
const LOTEDOM_PAYROLL_ROSTER = [
  {
    name: "GERARDO MERCECDES",
    cedula: "",
    position: "Puerta Tamboril",
    salaryMonthly: 22000,
    daysWorked: "13",
    horasExtras: 500,
    feriado: 700,
    sfs: 700,
    adelantos: 0,
    prestamos: 0,
  },
  {
    name: "LUIS ADONIS MARTINEZ",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 24000,
    daysWorked: "13",
    horasExtras: 500,
    feriado: 700,
    sfs: 800,
    adelantos: 0,
    prestamos: 0,
  },
  {
    name: "CARLOS VASQUEZ",
    cedula: "402-4549159-8",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "13",
    horasExtras: 0,
    feriado: 700,
    sfs: 700,
    adelantos: 0,
    prestamos: 1000,
  },
  {
    name: "NATHANAEL GIL",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "13",
    horasExtras: 0,
    feriado: 700,
    sfs: 700,
    adelantos: 800,
    prestamos: 0,
  },
  {
    name: "ALBERTO REYES",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "13",
    horasExtras: 0,
    feriado: 700,
    adelantos: 0,
    prestamos: 1319,
  },
  {
    name: "MAYLIN PARRA",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "13",
    horasExtras: 0,
    feriado: 700,
    sfs: 700,
    adelantos: 0,
    prestamos: 0,
  },
  {
    name: "JUAN AGUILAR",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "13",
    horasExtras: 0,
    feriado: 700,
    sfs: 700,
    adelantos: 0,
    prestamos: 0,
  },
  {
    name: "CARLOS POLANCO",
    cedula: "",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "12",
    horasExtras: 0,
    feriado: 0,
    sfs: 700,
    adelantos: 0,
    prestamos: 1628,
  },
  {
    name: "ROBERTO PIMENETEL",
    cedula: "031-0257662-0",
    position: "LOTEDOM",
    salaryMonthly: 21000,
    daysWorked: "2+9INC",
    horasExtras: 0,
    feriado: 0,
    sfs: 700,
    adelantos: 0,
    prestamos: 0,
  },
];

function payrollGroupMeta(group) {
  return PAYROLL_GROUP_META[group] || PAYROLL_GROUP_META.lavega;
}

function getSelectedPayrollGroup() {
  const el = document.getElementById("contabPayrollGroup");
  const v = el && el.value ? String(el.value) : "lavega";
  return PAYROLL_GROUP_META[v] ? v : "lavega";
}

function getSelectedPayrollPaper() {
  const el = document.getElementById("contabPayrollPaper");
  return el && el.value === "letter" ? "letter" : "legal";
}

/** Oficina: Carta horizontal. Resto (La Vega, Monorriel, etc.): Legal horizontal al PDF. */
function getPayrollPaperForExport(p) {
  if (payrollIsOffice(p) || getSelectedPayrollGroup() === "oficina") return "letter";
  // PDF/impresión de campo: siempre Legal (el selector no debe forzar Carta vertical)
  return "legal";
}

function syncPayrollPaperUiForGroup(group) {
  const office = group === "oficina";
  const paper = office ? "letter" : "legal";
  const main = document.getElementById("contabPayrollPaper");
  const detail = document.getElementById("contabPayrollPaper2");
  if (main) {
    main.value = paper;
    main.disabled = true;
    main.title = office
      ? "Oficina: Carta horizontal"
      : "PDF/impresión: Legal horizontal (centrado)";
  }
  if (detail) {
    detail.value = paper;
    detail.disabled = true;
    detail.title = main ? main.title : "";
  }
  const hint = document.getElementById("contabPayrollHint");
  if (hint) {
    hint.textContent = office
      ? `Mes: ${monthLabel(getSelectedMonth())} · PDF Carta horizontal`
      : `Mes: ${monthLabel(getSelectedMonth())} · PDF Legal horizontal`;
  }
  const receiptBtn = document.getElementById("btnContabPrintReceipts");
  if (receiptBtn) {
    const showReceipts =
      group === "banco" ||
      group === "efectivo" ||
      group === "lavega" ||
      group === "lotedom" ||
      group === "monorriel";
    receiptBtn.hidden = !showReceipts;
    receiptBtn.title = showReceipts
      ? group === "monorriel"
        ? "Recibos de esta tanda Monorriel · 2connect POS80 (80 mm)"
        : "Recibos individuales · Epson TM-U220 (76 mm)"
      : "Disponible en Banco, Efectivo, La Vega, Lotedom y Monorriel";
  }
}

function getLvaStaffForPayroll() {
  try {
    if (typeof lvaState === "undefined" || !lvaState) return [];
    return (lvaState.staff || [])
      .filter((s) => s && s.active !== false && String(s.name || "").trim())
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  } catch (_) {
    return [];
  }
}

function getOfficeStaffForPayroll() {
  return (contabilidadData.officeEmployees || [])
    .filter((e) => e && e.active !== false && String(e.fullName || "").trim())
    .slice()
    .sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "es"))
    .map((e) => ({
      id: e.id,
      employeeId: e.id,
      name: e.fullName,
      cedula: e.cedula || "",
      salaryMonthly: e.salary || 0,
      position: e.position || "Oficina",
    }));
}

/** Tandas de nómina dentro del cubículo Monorriel. */
const MONORRIEL_PAYROLL_TANDA_FALLBACK = [
  { id: "dia", label: "Empleados de día", short: "Día", roster: [] },
  { id: "moto_dia", label: "Motorizados de día", short: "Moto día", roster: [] },
  { id: "noche", label: "Empleados de noche", short: "Noche", roster: [] },
  { id: "moto_noche", label: "Motorizados de noche", short: "Moto noche", roster: [] },
];

function getMonorrielDataRoot() {
  try {
    // Preferir el objeto de datos (siempre con payrollTandas); monoData() puede
    // devolver un fallback vacío si se llama antes de cargar monorriel-data.js.
    if (typeof window !== "undefined" && window.RFS_MONORRIEL) return window.RFS_MONORRIEL;
    if (typeof monoData === "function") return monoData();
  } catch (_) {}
  return null;
}

/** Nómina Monorriel antigua (antes de tandas): no tiene p.tanda. */
function isLegacyMonorrielPayroll(p) {
  return !!(p && p.group === "monorriel" && !String(p.tanda || "").trim());
}

function getMonorrielPayrollTandas() {
  try {
    const data = getMonorrielDataRoot();
    const list = Array.isArray(data && data.payrollTandas) ? data.payrollTandas : [];
    if (list.length) {
      return list.map((t, idx) => ({
        id: String((t && t.id) || MONORRIEL_PAYROLL_TANDA_FALLBACK[idx]?.id || `tanda-${idx}`),
        label: String((t && t.label) || t.id || "Tanda"),
        short: String((t && t.short) || (t && t.label) || t.id || "Tanda"),
        roster: Array.isArray(t && t.roster) ? t.roster : [],
      }));
    }
  } catch (_) {}
  return MONORRIEL_PAYROLL_TANDA_FALLBACK.map((t) => ({ ...t, roster: [] }));
}

function normalizeMonorrielTandaId(raw) {
  const id = String(raw || "").trim();
  const tandas = getMonorrielPayrollTandas();
  if (tandas.some((t) => t.id === id)) return id;
  return (tandas[0] && tandas[0].id) || "dia";
}

function monorrielTandaMeta(tandaId) {
  const id = normalizeMonorrielTandaId(tandaId);
  return (
    getMonorrielPayrollTandas().find((t) => t.id === id) || {
      id,
      label: id,
      short: id,
      roster: [],
    }
  );
}

function getSelectedMonorrielTanda() {
  const el = document.getElementById("contabPayrollMonoTanda");
  return normalizeMonorrielTandaId(el && el.value);
}

function syncMonorrielTandaUi(group) {
  const wrap = document.getElementById("contabPayrollMonoTandaWrap");
  const sel = document.getElementById("contabPayrollMonoTanda");
  const genAll = document.getElementById("btnContabGenMonoTandas");
  const isMono = group === "monorriel";
  if (wrap) wrap.hidden = !isMono;
  if (genAll) genAll.hidden = !isMono;
  const feedBtn = document.getElementById("btnContabFeedMonoDays");
  if (feedBtn) feedBtn.hidden = !isMono;
  if (!sel || !isMono) return;
  const tandas = getMonorrielPayrollTandas();
  const prev = sel.value;
  sel.innerHTML = tandas
    .map(
      (t) =>
        `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)} (${(t.roster || []).length})</option>`
    )
    .join("");
  const keep = tandas.some((t) => t.id === prev) ? prev : tandas[0]?.id || "dia";
  sel.value = keep;
}

function getMonorrielPayrollRoster(tandaId) {
  try {
    const tanda = monorrielTandaMeta(tandaId || getSelectedMonorrielTanda());
    if (Array.isArray(tanda.roster) && tanda.roster.length) return tanda.roster;
    // Compat: roster plano antiguo (si alguna vez vuelve a llenarse)
    const data = getMonorrielDataRoot();
    return Array.isArray(data && data.payrollRoster) ? data.payrollRoster : [];
  } catch (_) {
    return [];
  }
}

function getLotedomStaffForPayroll() {
  const fromCloud = (contabilidadData.lotedomEmployees || [])
    .filter((e) => e && e.active !== false && String(e.fullName || "").trim())
    .map((e) => ({
      id: e.id,
      employeeId: e.id,
      name: e.fullName,
      cedula: e.cedula || "",
      salaryMonthly: e.salary || 0,
      position: e.position || "LOTEDOM",
    }));
  if (fromCloud.length) {
    return fromCloud.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
  }
  return (LOTEDOM_PAYROLL_ROSTER || [])
    .filter((r) => r && String(r.name || "").trim())
    .map((r, idx) => ({
      id: r.id || `lotedom-${idx}`,
      employeeId: r.employeeId || "",
      name: String(r.name || "").trim(),
      cedula: r.cedula || "",
      salaryMonthly: Math.max(0, Number(r.salaryMonthly) || 0),
      position: r.position || "LOTEDOM",
      daysWorked: r.daysWorked != null ? String(r.daysWorked) : undefined,
      horasExtras: r.horasExtras,
      feriado: r.feriado,
      sfs: r.sfs,
      adelantos: r.adelantos,
      prestamos: r.prestamos,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

function getMonorrielStaffForPayroll(tandaId) {
  try {
    const tanda = normalizeMonorrielTandaId(tandaId || getSelectedMonorrielTanda());
    const tandaMeta = monorrielTandaMeta(tanda);
    const roster = getMonorrielPayrollRoster(tanda);
    if (roster.length) {
      // Emparejar con empleados Monorriel existentes (id/cédula) si ya están en la app
      const byKey = new Map();
      try {
        if (typeof getMonorrielEmployees === "function") {
          getMonorrielEmployees(true).forEach((e) => {
            const base =
              typeof monoBaseName === "function" ? monoBaseName(e.name) : String(e.name || "");
            const k = String(base || e.name || "")
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();
            if (k) byKey.set(k, e);
          });
        }
      } catch (_) {}
      return roster
        .filter((r) => r && String(r.name || "").trim())
        .map((r, idx) => {
          const raw = String(r.name || "").trim();
          const k = raw
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .trim();
          const emp = byKey.get(k);
          return {
            id: (emp && emp.id) || `mono-pay-${tanda}-${idx}-${k.slice(0, 12)}`,
            employeeId: (emp && emp.id) || "",
            name: raw,
            cedula: (emp && emp.cedula) || r.cedula || "",
            salaryMonthly: Math.max(0, Number(r.salaryMonthly) || Number(emp && emp.salary) || 0),
            position:
              r.position || (emp && (emp.role || emp.position)) || tandaMeta.short || "Monorriel",
            tanda,
            daysWorked: r.daysWorked != null ? String(r.daysWorked) : undefined,
            horasExtras: r.horasExtras,
            feriado: r.feriado,
            sfs: r.sfs,
            adelantos: r.adelantos,
            prestamos: r.prestamos,
            volaos: r.volaos,
            incentivos: r.incentivos,
            almuerzo: r.almuerzo,
          };
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
    }
    // Sin Excel aún: no mezclar el personal operativo viejo en la nómina por tandas
    return [];
  } catch (_) {
    return [];
  }
}

function getReactionPayrollRoster(kind) {
  try {
    const data = typeof window !== "undefined" ? window.RFS_REACTION_PAYROLL : null;
    if (!data) return [];
    const key = kind === "efectivo" ? "efectivoRoster" : "bancoRoster";
    return Array.isArray(data[key]) ? data[key] : [];
  } catch (_) {
    return [];
  }
}

function mapReactionRosterToStaff(roster, prefix, defaultPosition) {
  return (roster || [])
    .filter((r) => r && String(r.name || "").trim())
    .map((r, idx) => ({
      id: r.id || `${prefix}-${idx}`,
      employeeId: r.employeeId || "",
      name: String(r.name || "").trim(),
      cedula: r.cedula || "",
      salaryMonthly: Math.max(0, Number(r.salaryMonthly) || 0),
      position: r.position || defaultPosition,
      daysWorked: r.daysWorked != null ? String(r.daysWorked) : undefined,
      horasExtras: r.horasExtras,
      feriado: r.feriado,
      sfs: r.sfs,
      adelantos: r.adelantos,
      prestamos: r.prestamos,
      volaos: r.volaos,
      incentivos: r.incentivos,
      almuerzo: r.almuerzo,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "es"));
}

function getReactionBancoStaffForPayroll() {
  return mapReactionRosterToStaff(getReactionPayrollRoster("banco"), "banco", "Reaction Banco");
}

function getReactionEfectivoStaffForPayroll() {
  return mapReactionRosterToStaff(
    getReactionPayrollRoster("efectivo"),
    "efectivo",
    "Reaction Efectivo"
  );
}

function getStaffForPayrollGroup(group, tandaId) {
  if (group === "oficina") return getOfficeStaffForPayroll();
  if (group === "monorriel") return getMonorrielStaffForPayroll(tandaId);
  if (group === "lotedom") return getLotedomStaffForPayroll();
  if (group === "banco") return getReactionBancoStaffForPayroll();
  if (group === "efectivo") return getReactionEfectivoStaffForPayroll();
  // Reaction General se arma solo desde el reporte Vargas (no roster fijo).
  if (group === "reaction" || group === "general") return [];
  return getLvaStaffForPayroll();
}

function getLvaPostLabel(staff) {
  if (!staff) return "";
  if (staff.postName) return String(staff.postName).trim();
  try {
    if (typeof getLvaPostName === "function") return getLvaPostName(staff.postId) || "";
  } catch (_) {}
  return "";
}

/** Limpia puesto / paréntesis del nombre. */
function payrollCleanEmployeeName(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Un nombre + un apellido (omite segundo nombre y segundo apellido). */
function payrollShortEmployeeName(name) {
  const clean = payrollCleanEmployeeName(name);
  if (!clean) return "";
  const parts = clean.split(" ").filter(Boolean);
  if (parts.length <= 2) return parts.join(" ");
  // Un nombre + un apellido (último token = apellido a imprimir)
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

function payrollIsOffice(p) {
  return !!(p && p.group === "oficina");
}

function payrollIsLavega(p) {
  if (!p) return false;
  if (p.group === "lavega") return true;
  if (!p.group && String(p.note || "").toLowerCase().includes("vega")) return true;
  return false;
}

function payrollIsMonorriel(p) {
  return !!(p && p.group === "monorriel");
}

function payrollIsLotedom(p) {
  return !!(p && p.group === "lotedom");
}

function payrollIsBanco(p) {
  return !!(p && p.group === "banco");
}

function payrollIsEfectivo(p) {
  return !!(p && p.group === "efectivo");
}

/** La Vega, Monorriel, LOTEDOM, Banco y Efectivo: mismas columnas / Unif-Rifa / Comida-Seg.vida / nombres cortos. */
function payrollUsesLvaParams(p) {
  if (!p) return false;
  if (payrollGroupUsesLvaParams(p.group)) return true;
  return payrollIsLavega(p);
}

/** Columnas editor/impresión exclusivas de nómina oficina. */
const PAYROLL_OFFICE_TABLE_COLS = [
  ["fullName", "Nombre", "name"],
  ["cedula", "Cédula", "text"],
  ["salaryMonthly", "Sueldo mes", "num"],
  ["salaryQuincena", "Quincena", "ro"],
  ["sfs", "SFS", "num"],
  ["rifa", "Rifa", "num"],
  ["incentivos", "Incent.", "num"],
  ["adelantos", "Adelantos", "num"],
  ["prestamos", "Préstamos", "num"],
  ["totalDescuentos", "Desc.", "ro"],
  ["totalCobrar", "Cobrar", "ro"],
  ["salarioDepositar", "Depositar", "ro"],
  ["redondeo", "Redondeo", "ro"],
];

const PAYROLL_OFFICE_PRINT_COLS = [
  ["fullName", "Nombre", "name"],
  ["salaryMonthly", "Sueldo mes", "num"],
  ["salaryQuincena", "Quincena", "num"],
  ["sfs", "SFS", "num"],
  ["rifa", "Rifa", "num"],
  ["incentivos", "Incent.", "num"],
  ["adelantos", "Adelantos", "num"],
  ["prestamos", "Préstamos", "num"],
  ["totalDescuentos", "Desc.", "ro"],
  ["totalCobrar", "Cobrar", "ro"],
  ["salarioDepositar", "Depositar", "ro"],
  ["redondeo", "Redondeo", "ro"],
];

function buildPayrollLineFromPerson(person, prev, defaultPosition, options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const isOffice = !!opts.office;
  const isLavega = !!opts.lavega;
  const rawName = String(person.name || person.fullName || "").trim();
  // Oficina y La Vega: un nombre + un apellido (compacto para Carta horizontal).
  const baseName = payrollShortEmployeeName(rawName) || payrollCleanEmployeeName(rawName) || rawName;
  const post =
    person.position ||
    (person.postName ? String(person.postName).trim() : "") ||
    getLvaPostLabel(person) ||
    defaultPosition ||
    "";
  const prevLine = prev || {};
  const hasPrev = !!prev;
  const pickSeedNum = (prevVal, personVal, fallback = 0) => {
    if (hasPrev && prevVal != null && prevVal !== "") return Math.max(0, Number(prevVal) || 0);
    if (personVal != null && personVal !== "") return Math.max(0, Number(personVal) || 0);
    return fallback;
  };
  const daysWorked = isOffice
    ? ""
    : (hasPrev && prevLine.daysWorked) ||
      (person.daysWorked != null && String(person.daysWorked).trim()) ||
      "15";
  const salaryMonthly =
    Math.max(0, Number(person.salaryMonthly) || 0) ||
    Math.max(0, Number(prevLine.salaryMonthly) || 0) ||
    (isOffice ? 0 : LVA_PAYROLL_DEFAULT_MONTHLY);
  const prevUniformes = Number(prevLine.uniformes);
  const prevRifa = Number(prevLine.rifa);
  return normalizePayrollLine(
    {
      employeeId: person.employeeId || person.id || "",
      fullName: baseName,
      position: post || defaultPosition || "",
      cedula: person.cedula || prevLine.cedula || "",
      daysWorked,
      salaryMonthly,
      salaryQuincena: 0,
      sfs: isOffice
        ? OFFICE_PAYROLL_SFS
        : pickSeedNum(prevLine.sfs, person.sfs, 0),
      // Oficina: sin uniforme/volao/comida/feriado/extras; sí rifa
      // La Vega/Monorriel/LOTEDOM: Unif/Rifa unidos (115/85); Seg. vida en Comida/Seg. vida
      uniformes: isOffice
        ? 0
        : prevLine.uniformes != null && Number.isFinite(prevUniformes)
          ? Math.max(0, prevUniformes)
          : LVA_PAYROLL_UNIFORMES,
      volaos: isOffice ? 0 : pickSeedNum(prevLine.volaos, person.volaos, 0),
      incentivos: pickSeedNum(prevLine.incentivos, person.incentivos, 0),
      // Si la tanda auto-calcula extras, dejar 0 para que compute aplique la tasa actual
      horasExtras: isOffice
        ? 0
        : opts.autoExtrasFromDays
          ? 0
          : pickSeedNum(prevLine.horasExtras, person.horasExtras, 0),
      feriado: isOffice ? 0 : pickSeedNum(prevLine.feriado, person.feriado, 0),
      almuerzo: isOffice ? 0 : pickSeedNum(prevLine.almuerzo, person.almuerzo, 0),
      rifa: isOffice
        ? prevLine.rifa != null && Number.isFinite(prevRifa)
          ? Math.max(0, prevRifa)
          : OFFICE_PAYROLL_RIFA
        : LVA_PAYROLL_RIFA,
      adelantos: pickSeedNum(prevLine.adelantos, person.adelantos, 0),
      prestamos: pickSeedNum(prevLine.prestamos, person.prestamos, 0),
      note: prevLine.note || "",
    },
    opts
  );
}

/** Descuento automático de cuota de préstamo (Monorriel) según fecha de pago 5/20. */
function autoLoanDeductionForPayrollLine(person, fullName, payDate) {
  if (typeof loanPayrollDeductionForName !== "function") return 0;
  const name = fullName || (person && (person.name || person.fullName)) || "";
  const id = (person && (person.employeeId || person.id)) || "";
  return loanPayrollDeductionForName(name, payDate, id);
}

function applyMonorrielLoanDeductionsToLines(lines, payDate, opts = {}) {
  const force = !!(opts && opts.forceClear);
  const skipManual = !!(opts && opts.skipManual);
  if (!payDate || typeof loanPayrollDeductionForName !== "function") {
    if (!force) return lines || [];
    // Sin fecha/función: al forzar, limpiar montos viejos de prueba
    return (lines || []).map((l) => (skipManual && isManualPayrollLine(l) ? l : { ...l, prestamos: 0 }));
  }
  return (lines || []).map((l) => {
    if (skipManual && isManualPayrollLine(l)) return l;
    const name = String(l.fullName || "").trim();
    if (!name) return force ? { ...l, prestamos: 0 } : l;
    const amt = loanPayrollDeductionForName(name, payDate, l.employeeId) || 0;
    // forceClear=true: borra lo cargado antes y deja solo la cuota real (o 0)
    if (!force && !amt) return l;
    return { ...l, prestamos: amt };
  });
}

/** Aplica cuotas de préstamo a una nómina Monorriel (borrador) y recalcula totales. */
function syncMonorrielPayrollLoanDeductions(p, forceClear = true) {
  if (!p || p.group !== "monorriel") return { changed: false, applied: 0 };
  if (p.status === "cancelled" || p.status === "paid") return { changed: false, applied: 0 };
  // Siempre 5/20: borradores viejos tenían payDate día 15 y no matcheaban cuotas
  const payDate = effectivePayrollPayDate(p) || payrollPayDateFor(p.period, p.half);
  const opts = typeof payrollComputeOpts === "function" ? payrollComputeOpts(p) : {};
  const prevPay = String(p.payDate || "").slice(0, 10);
  const prev = JSON.stringify((p.lines || []).map((l) => [l.fullName, Number(l.prestamos) || 0]));
  const nextLines = applyMonorrielLoanDeductionsToLines(p.lines || [], payDate, {
    forceClear: !!forceClear,
    skipManual: true,
  }).map((l) => computePayrollLineTotals(l, opts));
  const applied = nextLines.filter((l) => (Number(l.prestamos) || 0) > 0).length;
  const next = JSON.stringify(nextLines.map((l) => [l.fullName, Number(l.prestamos) || 0]));
  const payFixed = !!(payDate && payDate !== prevPay);
  if (prev === next && !payFixed) return { changed: false, applied };
  if (payDate) p.payDate = payDate;
  p.lines = nextLines;
  p.updatedAt = new Date().toISOString();
  return { changed: true, applied };
}

/**
 * Tras importar préstamos / al abrir nómina: limpia Préstamos en nóminas Monorriel borrador
 * y reaplica cuotas reales según fecha de pago (5/20).
 */
function refreshMonorrielPayrollLoanDeductions(forceClear = true) {
  if (typeof contabilidadData === "undefined" || !contabilidadData) return { updated: 0, applied: 0 };
  const list = Array.isArray(contabilidadData.payrolls) ? contabilidadData.payrolls : [];
  let updated = 0;
  let applied = 0;
  list.forEach((p) => {
    const r = syncMonorrielPayrollLoanDeductions(p, forceClear);
    if (r.changed) updated += 1;
    applied += r.applied || 0;
  });
  if (updated) {
    try {
      saveContabilidadData(true);
    } catch (_) {}
    try {
      if (typeof renderNominaTab === "function" && document.getElementById("nominaView")?.classList.contains("active")) {
        // Evitar bucle: el caller puede estar dentro de renderNominaTab
        if (!refreshMonorrielPayrollLoanDeductions._inRender) renderNominaTab();
      } else if (typeof renderContabilidadModule === "function") {
        renderContabilidadModule();
      }
    } catch (_) {}
  }
  return { updated, applied };
}

function buildLvaPayrollLineFromStaff(staff, prev) {
  return buildPayrollLineFromPerson(staff, prev, "La Vega Autopista");
}

function payrollPeriodKey(period, half) {
  return `${period}-q${half === 2 ? 2 : 1}`;
}

function findPayrollByGroup(period, half, group, tandaId) {
  const h = half === 2 || half === "2" ? 2 : 1;
  const g = group || "lavega";
  const tanda = g === "monorriel" ? normalizeMonorrielTandaId(tandaId || getSelectedMonorrielTanda()) : "";
  return (contabilidadData.payrolls || []).find((p) => {
    if (p.period !== period || p.status === "cancelled") return false;
    if (!(p.half === h || (!p.half && h === 1))) return false;
    if (g === "lavega") {
      return p.group === "lavega" || !p.group || String(p.note || "").toLowerCase().includes("vega");
    }
    if (p.group !== g) return false;
    if (g === "monorriel") {
      // No mezclar la nómina antigua (sin tanda) con Día/Noche/Moto
      if (isLegacyMonorrielPayroll(p)) return false;
      return normalizeMonorrielTandaId(p.tanda) === tanda;
    }
    return true;
  });
}

function findLvaPayroll(period, half) {
  return findPayrollByGroup(period, half, "lavega");
}

function getSelectedPayrollHalf() {
  const el = document.getElementById("contabPayrollHalf");
  return el && el.value === "2" ? 2 : 1;
}

function halfLabel(half) {
  // Corte de costos 15/30; depósito de nómina días 5 y 20
  return half === 2
    ? "Corte 16–30 · pago día 5"
    : "Corte 01–15 · pago día 20";
}

/** Fecha de depósito/pago de la nómina: días 5 y 20. */
function payrollPayDateFor(period, half) {
  const h = half === 2 || half === "2" ? 2 : 1;
  const [y0, m0] = String(period || "").split("-").map(Number);
  if (!y0 || !m0) return "";
  if (h === 1) {
    return `${period}-20`;
  }
  let y = y0;
  let m = m0 + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}-05`;
}

/**
 * Genera / actualiza una nómina.
 * opts: { group, half, period, tanda, quiet, skipConfirm }
 */


/** Mes actual + siguiente (para cubrir todos los cortes, incl. noviembre). */
function monoFeedPeriodList(anchorYm) {
  const ym = String(anchorYm || currentMonthKey()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return [currentMonthKey()];
  const [y0, m0] = ym.split("-").map(Number);
  let y = y0;
  let m = m0 + 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  const next = `${y}-${String(m).padStart(2, "0")}`;
  return ym === next ? [ym] : [ym, next];
}

/** Rango de fechas de una quincena Monorriel (corte 01–15 / 16–fin de mes). */
function monoPayrollPeriodRange(period, half) {
  const ym = String(period || "").slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(ym)) return { from: "", to: "" };
  const [y, m] = ym.split("-").map(Number);
  const h = half === 2 || half === "2" ? 2 : 1;
  if (h === 1) return { from: `${ym}-01`, to: `${ym}-15` };
  // Corte 16–30: el día 31 se reporta pero NO entra en nómina. Feb usa 28/29.
  const last = new Date(y, m, 0).getDate();
  const endDay = Math.min(30, last);
  return { from: `${ym}-16`, to: `${ym}-${String(endDay).padStart(2, "0")}` };
}

function monoPayrollNameKey(name) {
  return String(name || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function monoNamesLooselyMatch(a, b) {
  const ka = monoPayrollNameKey(a);
  const kb = monoPayrollNameKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.includes(kb) || kb.includes(ka)) return true;
  const pa = ka.split(" ").filter(Boolean);
  const pb = kb.split(" ").filter(Boolean);
  if (pa.length >= 2 && pb.length >= 2 && pa[0] === pb[0] && pa[pa.length - 1] === pb[pb.length - 1]) {
    return true;
  }
  return false;
}

/** Primera lectura del nombre queda fija en settings.monoNameLocks */
function lockMonoPayrollDisplayName(rawName) {
  if (!contabilidadData.settings || typeof contabilidadData.settings !== "object") {
    contabilidadData.settings = { defaultBook: "EDWARD" };
  }
  if (!contabilidadData.settings.monoNameLocks || typeof contabilidadData.settings.monoNameLocks !== "object") {
    contabilidadData.settings.monoNameLocks = {};
  }
  const locks = contabilidadData.settings.monoNameLocks;
  const key = monoPayrollNameKey(rawName);
  if (!key) return payrollCleanEmployeeName(rawName) || String(rawName || "").trim();
  if (!locks[key]) {
    locks[key] = payrollCleanEmployeeName(rawName) || String(rawName || "").trim();
  }
  return locks[key];
}

function findMonorrielRosterEntry(name, employeeId) {
  const tandas = getMonorrielPayrollTandas();
  for (const t of tandas) {
    for (const r of t.roster || []) {
      if (!r) continue;
      if (employeeId && (r.employeeId === employeeId || r.id === employeeId)) {
        return { tanda: t.id, person: r };
      }
      if (monoNamesLooselyMatch(r.name, name)) return { tanda: t.id, person: r };
    }
  }
  return null;
}

/** am → día/moto_día · pm → noche/moto_noche (según Excel si hay match). */
function resolveMonorrielTandaForReportWorker(name, employeeId, shift) {
  const family = shift === "pm" ? ["noche", "moto_noche"] : ["dia", "moto_dia"];
  const hit = findMonorrielRosterEntry(name, employeeId);
  if (hit && family.includes(hit.tanda)) return hit.tanda;
  if (hit) {
    const wantMoto = String(hit.tanda).startsWith("moto");
    const alt = family.find((id) => (wantMoto ? id.startsWith("moto") : !id.startsWith("moto")));
    if (alt) return alt;
  }
  return shift === "pm" ? "noche" : "dia";
}

/**
 * Cruza reportes Monorriel → columna Días de la nómina (quincena).
 * No pisa adelantos / préstamos / horas extras manuales.
 * opts: { period, half, quiet, createMissing }
 */
function feedMonorrielPayrollDaysFromReports(opts = {}) {
  if (typeof buildMonoEmployeeAttendance !== "function") {
    return { updated: 0, lines: 0, reason: "no-attendance-fn" };
  }
  if (typeof monorrielReports === "undefined" || !Array.isArray(monorrielReports)) {
    return { updated: 0, lines: 0, reason: "no-reports" };
  }
  const periods = Array.isArray(opts.periods) && opts.periods.length
    ? opts.periods.map((p) => String(p || "").slice(0, 7)).filter((p) => /^\d{4}-\d{2}$/.test(p))
    : null;
  const basePeriod =
    opts.period || (typeof getSelectedMonth === "function" ? getSelectedMonth() : currentMonthKey());
  // Todos los cortes del mes seleccionado; si no se limita, también el mes siguiente (ej. nov).
  const periodList = periods || (opts.onlySelectedPeriod ? [basePeriod] : monoFeedPeriodList(basePeriod));
  const halves =
    opts.half != null ? [opts.half === 2 || opts.half === "2" ? 2 : 1] : [1, 2];
  const createMissing = opts.createMissing !== false;
  let payrollsTouched = 0;
  let linesTouched = 0;

  periodList.forEach((period) => {
  halves.forEach((half) => {
    const range = monoPayrollPeriodRange(period, half);
    if (!range.from || !range.to) return;

    ["am", "pm"].forEach((shift) => {
      const attendance = buildMonoEmployeeAttendance(range.from, range.to, shift);
      if (!attendance.length) return;

      const byTanda = new Map();
      attendance.forEach((row) => {
        const tanda = resolveMonorrielTandaForReportWorker(row.name, row.employeeId, shift);
        if (!byTanda.has(tanda)) byTanda.set(tanda, []);
        byTanda.get(tanda).push(row);
      });

      byTanda.forEach((rows, tanda) => {
        let payroll = findPayrollByGroup(period, half, "monorriel", tanda);
        if (!payroll && createMissing) {
          const gen = generatePayrollForSelection({
            period,
            half,
            group: "monorriel",
            tanda,
            quiet: true,
            skipConfirm: true,
            skipReportFeed: true,
          });
          payroll = gen && gen.payroll;
        }
        if (!payroll) return;

        const formulaOpts = payrollComputeOpts(payroll);
        const prevById = new Map();
        const prevByName = new Map();
        (payroll.lines || []).forEach((l) => {
          if (!l) return;
          if (l.employeeId) prevById.set(String(l.employeeId), l);
          const nk = monoPayrollNameKey(l.fullName);
          if (nk) prevByName.set(nk, l);
        });

        let changed = false;
        rows.forEach((row) => {
          const daysCount = Math.max(0, Number(row.daysCount) || 0);
          if (!daysCount) return;
          const displayName = lockMonoPayrollDisplayName(row.name);
          const nameKey = monoPayrollNameKey(displayName);
          const rosterHit = findMonorrielRosterEntry(row.name, row.employeeId);
          let line =
            (row.employeeId && prevById.get(String(row.employeeId))) ||
            prevByName.get(nameKey) ||
            null;
          if (!line) {
            line =
              (payroll.lines || []).find((l) => monoNamesLooselyMatch(l.fullName, displayName)) ||
              null;
          }

          const keepAdelantos = line ? Math.max(0, Number(line.adelantos) || 0) : 0;
          const keepPrestamos = line ? Math.max(0, Number(line.prestamos) || 0) : 0;
          const keepExtrasManual = !!(line && line.horasExtrasManual);
          const keepExtras = keepExtrasManual ? Math.max(0, Number(line.horasExtras) || 0) : null;

          if (!line) {
            const person = rosterHit
              ? { ...rosterHit.person, name: displayName }
              : {
                  id: row.employeeId || "",
                  employeeId: row.employeeId || "",
                  name: displayName,
                  salaryMonthly: LVA_PAYROLL_DEFAULT_MONTHLY,
                };
            line = buildPayrollLineFromPerson(
              { ...person, name: displayName, daysWorked: String(daysCount) },
              null,
              "Monorriel",
              formulaOpts
            );
            payroll.lines = payroll.lines || [];
            payroll.lines.push(line);
            if (line.employeeId) prevById.set(String(line.employeeId), line);
            prevByName.set(nameKey, line);
            changed = true;
            linesTouched += 1;
          }

          const nextDays = String(daysCount);
          const prevDays = String(line.daysWorked || "").trim();
          if (prevDays !== nextDays || !line.daysFromReports) {
            line.daysWorked = nextDays;
            line.daysFromReports = true;
            if (!String(line.fullName || "").trim()) line.fullName = displayName;
            changed = true;
            linesTouched += 1;
          }

          line.adelantos = keepAdelantos;
          line.prestamos = keepPrestamos;
          if (keepExtrasManual) {
            line.horasExtras = keepExtras;
            line.horasExtrasManual = true;
          }
          let recomputed = computePayrollLineTotals(line, formulaOpts);
          recomputed.adelantos = keepAdelantos;
          recomputed.prestamos = keepPrestamos;
          if (keepExtrasManual) {
            recomputed.horasExtras = keepExtras;
            recomputed.horasExtrasManual = true;
            recomputed = computePayrollLineTotals(recomputed, formulaOpts);
            recomputed.adelantos = keepAdelantos;
            recomputed.prestamos = keepPrestamos;
            recomputed.horasExtras = keepExtras;
            recomputed.horasExtrasManual = true;
          }
          Object.assign(line, recomputed);
        });

        if (changed) {
          payroll.updatedAt = new Date().toISOString();
          payroll.note = String(payroll.note || "");
          if (!/días desde reportes/i.test(payroll.note)) {
            payroll.note = `${payroll.note} · Días desde reportes`.replace(/^\s·\s*/, "").trim();
          }
          payrollsTouched += 1;
        }
      });
    });
  });
  });

  if (payrollsTouched) {
    try {
      saveContabilidadData(true);
    } catch (_) {}
  }
  if (!opts.quiet && payrollsTouched) {
    toast(
      `Días Monorriel actualizados desde reportes · ${linesTouched} línea(s) · ${payrollsTouched} nómina(s).`
    );
  }
  return { updated: payrollsTouched, lines: linesTouched };
}

function generatePayrollForSelection(opts = {}) {
  const period = opts.period || getSelectedMonth();
  const half = opts.half != null ? (opts.half === 2 || opts.half === "2" ? 2 : 1) : getSelectedPayrollHalf();
  const group = opts.group || getSelectedPayrollGroup();
  const tanda = group === "monorriel" ? normalizeMonorrielTandaId(opts.tanda || getSelectedMonorrielTanda()) : "";
  const tandaMeta = group === "monorriel" ? monorrielTandaMeta(tanda) : null;
  const meta = payrollGroupMeta(group);
  const staff = getStaffForPayrollGroup(group, tanda);
  const labelShort =
    group === "monorriel" && tandaMeta ? `${meta.short} · ${tandaMeta.short}` : meta.short;
  const quiet = !!opts.quiet;
  if (group !== "general" && group !== "reaction" && !staff.length) {
    if (!quiet) {
      toast(
        group === "oficina"
          ? "No hay empleados activos en Oficina. Agrégalos en la pestaña Oficina."
          : group === "monorriel"
            ? `La tanda «${tandaMeta.label}» aún no tiene empleados en el Excel.`
            : group === "lotedom"
              ? "No hay personal activo de LOTEDOM."
              : group === "banco"
                ? "No hay personal activo de Reaction Banco."
                : group === "efectivo"
                  ? "No hay personal activo de Reaction Efectivo."
                  : "No hay empleados activos en La Vega Autopista."
      );
    }
    return null;
  }
  const existing = findPayrollByGroup(period, half, group, tanda);
  if (
    existing &&
    !opts.skipConfirm &&
    !quiet &&
    !confirm(`Ya hay nómina ${labelShort} de ${monthLabel(period)} (${halfLabel(half)}). ¿Actualizar?`)
  ) {
    return null;
  }
  const payDate = payrollPayDateFor(period, half);
  const prevById = new Map();
  const prevByName = new Map();
  (existing && existing.lines ? existing.lines : []).forEach((l) => {
    if (l.employeeId) prevById.set(l.employeeId, l);
    const key = String(l.fullName || "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toLowerCase();
    if (key) prevByName.set(key, l);
  });
  const isOffice = group === "oficina";
  const isLavega = payrollGroupUsesLvaParams(group);
  const formulaOpts = getPayrollFormulaProfile({
    group,
    tanda: group === "monorriel" ? tanda : "",
  });
  let lines;
  if (group === "general" || group === "reaction") {
    const kept = (existing && existing.lines ? existing.lines : []).map((l) =>
      computePayrollLineTotals(l, formulaOpts)
    );
    // Reaction General vacía: se llena desde Vargas. General/Otros: plantilla 8 filas.
    lines =
      kept.length
        ? kept
        : group === "reaction"
          ? []
          : Array.from({ length: 8 }, () => emptyPayrollLine());
  } else {
    lines = staff.map((s) => {
      const prev =
        prevById.get(s.employeeId) ||
        prevById.get(s.id) ||
        prevByName.get(String(s.name || "").trim().toLowerCase());
      const line = buildPayrollLineFromPerson(s, prev, meta.label, formulaOpts);
      if (group === "monorriel" && typeof autoLoanDeductionForPayrollLine === "function") {
        const ded = autoLoanDeductionForPayrollLine(s, line.fullName, payDate);
        if (ded > 0) line.prestamos = ded;
      }
      return line;
    });
    if (group === "monorriel") {
      lines = applyMonorrielLoanDeductionsToLines(lines, payDate, { forceClear: true }).map((l) =>
        computePayrollLineTotals(l, formulaOpts)
      );
    }
  }
  if (existing) snapshotPayrollBackup(existing, "generate");
  const payroll = normalizePayroll({
    id: existing && existing.status === "draft" ? existing.id : undefined,
    period,
    half,
    group,
    tanda: group === "monorriel" ? tanda : "",
    payDate,
    status: "draft",
    showFeriado: isOffice ? false : existing ? !!existing.showFeriado : false,
    lines,
    note: isOffice
      ? `Nómina Oficina · ${halfLabel(half)} · ${monthLabel(period)} · SFS ${OFFICE_PAYROLL_SFS} · con rifa · sin días/unif/volao/comida/feriado/extras`
      : group === "monorriel" && tandaMeta
        ? `Nómina Monorriel · ${tandaMeta.label} · ${halfLabel(half)} · ${monthLabel(period)}`
        : `Nómina ${meta.label} · ${halfLabel(half)} · ${monthLabel(period)}`,
    createdBy:
      typeof currentUser !== "undefined" && currentUser
        ? currentUser.displayName || currentUser.username
        : "",
  });
  if (existing) {
    const idx = contabilidadData.payrolls.findIndex((p) => p.id === existing.id);
    payroll.createdAt = existing.createdAt;
    if (idx >= 0) contabilidadData.payrolls[idx] = payroll;
    else contabilidadData.payrolls.unshift(payroll);
  } else {
    contabilidadData.payrolls.unshift(payroll);
  }
  if (group === "monorriel" && !opts.skipReportFeed) {
    try {
      feedMonorrielPayrollDaysFromReports({
        period,
        half,
        quiet: true,
        createMissing: false,
      });
      const refreshed = findPayrollByGroup(period, half, "monorriel", tanda);
      if (refreshed) payroll = refreshed;
    } catch (_) {}
  }
  return { payroll, labelShort, lines: payroll.lines || lines, period, half };
}

/** Genera / actualiza nómina del grupo seleccionado (mismo formato). */
function generateOfficePayroll() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  const result = generatePayrollForSelection({});
  if (!result) return;
  selectedPayrollId = result.payroll.id;
  saveContabilidadData(true);
  openNominaView();
  toast(
    `Nómina ${result.labelShort} ${halfLabel(result.half)} · ${monthLabel(result.period)} · ${
      result.lines.length
    } fila(s).`
  );
  renderNominaTab();
}

/**
 * Regenera las 4 tandas Monorriel del Excel (fórmula actual).
 * Archiva/ignora la nómina antigua sin tanda para el mismo período.
 */
function generateAllMonorrielTandas() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  const period = getSelectedMonth();
  const half = getSelectedPayrollHalf();
  const tandas = getMonorrielPayrollTandas();
  const totalRoster = tandas.reduce((n, t) => n + (t.roster || []).length, 0);
  if (!totalRoster) {
    toast("No hay empleados en las tandas del Excel.");
    return;
  }
  if (
    !confirm(
      `¿Generar / actualizar las 4 tandas Monorriel de ${monthLabel(period)} (${halfLabel(
        half
      )})?\n\nDía, Moto día, Noche y Moto noche (${totalRoster} personas del Excel).\nSe usan las fórmulas actuales de nómina.`
    )
  ) {
    return;
  }
  // Quitar de la vista activa las nóminas Monorriel antiguas (sin tanda) del mismo período
  const legacy = (contabilidadData.payrolls || []).filter(
    (p) =>
      isLegacyMonorrielPayroll(p) &&
      p.period === period &&
      (p.half === half || (!p.half && half === 1)) &&
      p.status !== "cancelled"
  );
  legacy.forEach((p) => {
    snapshotPayrollBackup(p, "before_delete");
    p.status = "cancelled";
    p.note = `${p.note || ""} · Reemplazada por tandas Excel`.trim();
    p.updatedAt = new Date().toISOString();
  });

  const counts = [];
  let lastId = "";
  tandas.forEach((t) => {
    const result = generatePayrollForSelection({
      group: "monorriel",
      tanda: t.id,
      period,
      half,
      quiet: true,
      skipConfirm: true,
    });
    if (result) {
      counts.push(`${t.short}: ${result.lines.length}`);
      lastId = result.payroll.id;
    } else {
      counts.push(`${t.short}: 0`);
    }
  });
  if (lastId) selectedPayrollId = lastId;
  const groupSel = document.getElementById("contabPayrollGroup");
  if (groupSel) groupSel.value = "monorriel";
  syncMonorrielTandaUi("monorriel");
  const tandaSel = document.getElementById("contabPayrollMonoTanda");
  if (tandaSel) tandaSel.value = "dia";
  selectedPayrollId = findPayrollByGroup(period, half, "monorriel", "dia")?.id || selectedPayrollId;
  saveContabilidadData(true);
  openNominaView();
  renderNominaTab();
  toast(`Monorriel ${halfLabel(half)} · ${counts.join(" · ")}`);
}

function markPayrollPaid(id) {
  const p = contabilidadData.payrolls.find((x) => x.id === id);
  if (!p) return;
  const gMeta = payrollGroupMeta(p.group || "general");
  const label = `${gMeta.short} · ${monthLabel(p.period)} · ${halfLabel(p.half || 1)}`;
  if (
    !confirm(
      `¿Marcar como PAGADA?\n\n${label}\n\nSe creará un respaldo automático en la nube. Esta acción es importante para el historial de pagos.`
    )
  ) {
    return;
  }
  p.status = "paid";
  p.updatedAt = new Date().toISOString();
  snapshotPayrollBackup(p, "paid");
  saveContabilidadData(true);
  if (typeof logActivity === "function") {
    logActivity(
      "payroll_paid",
      `Nómina pagada + respaldo: ${label} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  renderContabilidadModule();
  toast("Nómina marcada como pagada (con respaldo).");
}

function deletePayroll(id) {
  const p = contabilidadData.payrolls.find((x) => x.id === id);
  if (!p) return;
  const gMeta = payrollGroupMeta(p.group || "general");
  const label = `${gMeta.short} · ${monthLabel(p.period)} · ${halfLabel(p.half || 1)}`;
  const paidWarn =
    p.status === "paid"
      ? "\n\n⚠ Esta nómina está PAGADA. Se guardará un respaldo antes de borrarla."
      : "\n\nSe guardará un respaldo antes de borrarla.";
  if (!confirm(`¿Eliminar nómina?\n\n${label}${paidWarn}`)) return;
  if (p.status === "paid") {
    const ok = prompt(`Para confirmar, escribe PAGADA y acepta:`);
    if (String(ok || "").trim().toUpperCase() !== "PAGADA") {
      toast("Eliminación cancelada.");
      return;
    }
  }
  snapshotPayrollBackup(p, "before_delete");
  contabilidadData.payrolls = contabilidadData.payrolls.filter((x) => x.id !== id);
  if (selectedPayrollId === id) selectedPayrollId = "";
  saveContabilidadData(true);
  if (typeof logActivity === "function") {
    logActivity(
      "payroll_delete",
      `Nómina eliminada (respaldada): ${label} · por ${
        currentUser ? currentUser.displayName || currentUser.username : "—"
      }`
    );
  }
  renderContabilidadModule();
  toast("Nómina eliminada. Quedó un respaldo por si hay que recuperarla.");
}

function moneyCell(n) {
  // Sin RD$ para que el ancho de columna lo marque el título, no el prefijo
  const v = Number(n) || 0;
  return v ? moneyPlain(v) : "—";
}

function readPayrollLinesFromDom(payrollId) {
  const root = document.getElementById("contabPayrollDetail");
  if (!root) return null;
  const rows = [...root.querySelectorAll("tr[data-line-idx]")];
  const p = contabilidadData.payrolls.find((x) => x.id === payrollId);
  if (!p) return null;
  const lines = rows.map((tr, idx) => {
    const prev = (p.lines || [])[Number(tr.dataset.lineIdx)] || (p.lines || [])[idx] || {};
    const g = (name) => {
      const el = tr.querySelector(`[data-f="${name}"]`);
      return el ? el.value : "";
    };
    const isOffice = payrollIsOffice(p);
    const isLavega = payrollUsesLvaParams(p);
    const formulaOpts = payrollComputeOpts(p);
    const ur = isOffice ? { uniformes: 0, rifa: 0 } : parseUnifRifa(g("unifRifa"), prev);
    const showFer = !isOffice && payrollShowsFeriado(p);
    const rifaVal = isOffice
      ? g("rifa") !== "" && g("rifa") != null
        ? g("rifa")
        : prev.rifa != null
          ? prev.rifa
          : OFFICE_PAYROLL_RIFA
      : ur.rifa || LVA_PAYROLL_RIFA;
    const reviewedEl = tr.querySelector('[data-f="reviewed"]');
    return normalizePayrollLine(
      {
        ...prev,
        fullName: g("fullName") || prev.fullName,
        cedula: g("cedula") || prev.cedula,
        daysWorked: isOffice ? "" : g("daysWorked") || prev.daysWorked,
        salaryMonthly: g("salaryMonthly"),
        salaryQuincena: isOffice ? 0 : g("salaryQuincena"),
        sfs: g("sfs") === "" || g("sfs") == null ? prev.sfs : g("sfs"),
        sfsManual: !!prev.sfsManual,
        uniformes: isOffice ? 0 : ur.uniformes,
        rifa: rifaVal,
        volaos: isOffice ? 0 : g("volaos"),
        incentivos: g("incentivos"),
        horasExtras: isOffice
          ? prev.horasExtrasManual
            ? g("horasExtras") === "" || g("horasExtras") == null
              ? prev.horasExtras
              : g("horasExtras")
            : 0
          : g("horasExtras") === "" || g("horasExtras") == null
            ? prev.horasExtras
            : g("horasExtras"),
        horasExtrasManual: !!prev.horasExtrasManual,
        feriado: showFer ? g("feriado") : 0,
        almuerzo: isOffice
          ? 0
          : isLavega
            ? parseAlmuerzoSvda(g("almuerzoSvda") || g("almuerzo"), prev).almuerzo
            : g("almuerzo"),
        adelantos: g("adelantos"),
        prestamos: g("prestamos"),
        reviewed: reviewedEl ? !!reviewedEl.checked : !!prev.reviewed,
        manualEntry: !!(prev.manualEntry || prev.manual || tr.dataset.manual === "1"),
      },
      formulaOpts
    );
  });
  return lines;
}

function recalculateOpenPayroll(save = false) {
  const p = contabilidadData.payrolls.find((x) => x.id === selectedPayrollId);
  if (!p) {
    toast("No hay nómina abierta.");
    return;
  }
  const lines = readPayrollLinesFromDom(p.id);
  if (!lines) return;
  // Recalcular: La Vega / Monorriel desde días+sueldo; Oficina = sueldo/2 + SFS fijo
  const profile = getPayrollFormulaProfile(p);
  const opts = payrollComputeOpts(p);
  const payDate = effectivePayrollPayDate(p) || payrollPayDateFor(p.period, p.half);
  if (payDate && p.payDate !== payDate) p.payDate = payDate;
  // No reaplicar préstamos auto aquí: respeta lo escrito en la casilla Préstamos.
  // Para cuotas del módulo usar «Cargar préstamos».
  const workLines = lines;
  p.lines = workLines.map((l) => {
    if (isManualPayrollLine(l)) {
      return computePayrollLineTotals(l, opts);
    }
    const daysInfo = parsePayrollDays(l.daysWorked);
    const keepSfs = !!l.sfsManual;
    const keepHex = !!l.horasExtrasManual;
    return computePayrollLineTotals(
      {
        ...l,
        salaryQuincena: 0,
        // Respeta SFS / horas extras tecleados a mano (incluido 0)
        sfs: keepSfs ? Math.max(0, Number(l.sfs) || 0) : profile.office ? OFFICE_PAYROLL_SFS : 0,
        sfsManual: keepSfs,
        volaos: 0,
        horasExtras: keepHex
          ? Math.max(0, Number(l.horasExtras) || 0)
          : profile.office
            ? 0
            : profile.autoExtrasFromDays
              ? extrasPayFromBaseDays(
                  daysInfo.baseDays,
                  profile.extrasFromDaysPay,
                  profile.extrasDaysBlock
                )
              : Math.max(0, Number(l.horasExtras) || 0),
        horasExtrasManual: keepHex,
      },
      opts
    );
  });
  p.updatedAt = new Date().toISOString();
  if (save) saveContabilidadData(true);
  renderNominaTab();
  toast(save ? "Nómina recalculada y guardada." : "Totales recalculados.");
}

function saveOpenPayrollEdits() {
  const p = contabilidadData.payrolls.find((x) => x.id === selectedPayrollId);
  if (!p) {
    toast("No hay nómina abierta.");
    return;
  }
  const lines = readPayrollLinesFromDom(p.id);
  if (!lines) return;
  // Respaldo del estado anterior antes de sobrescribir
  snapshotPayrollBackup(p, "save");
  const opts = payrollComputeOpts(p);
  // Conservar Préstamos tecleados; «Cargar préstamos» es el único que pisa con cuotas auto.
  if (p.group === "monorriel") {
    const payDate = effectivePayrollPayDate(p) || payrollPayDateFor(p.period, p.half);
    if (payDate) p.payDate = payDate;
  }
  p.lines = lines.map((l) => computePayrollLineTotalsForPayroll(p, l));
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  toast("Cambios guardados (respaldo del día actualizado).");
}

/**
 * Botón por nómina: cargar cuotas de préstamos según fecha de pago 5/20.
 * Incluye filas manuales (trato especial) si el nombre coincide.
 */
function loadOpenPayrollLoans() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  syncOpenPayrollFromDom(false);
  const p = ensureOpenPayrollDraft();
  if (!p) {
    toast("Abre o genera una nómina primero.");
    return;
  }
  if (p.status === "paid") {
    toast("Nómina pagada: no se modifican préstamos.");
    return;
  }
  if (typeof loanPayrollDeductionForName !== "function") {
    toast("Módulo de préstamos no disponible.");
    return;
  }
  const payDate = effectivePayrollPayDate(p) || payrollPayDateFor(p.period, p.half);
  if (!payDate) {
    toast("No se pudo determinar la fecha de pago (5 o 20).");
    return;
  }
  p.payDate = payDate;
  const opts = payrollComputeOpts(p);
  const before = (p.lines || []).map((l) => Number(l.prestamos) || 0);
  let workLines = applyMonorrielLoanDeductionsToLines(p.lines || [], payDate, {
    forceClear: true,
    skipManual: false,
  }).map((l) => computePayrollLineTotals(l, opts));
  p.lines = workLines;
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  const applied = workLines.filter((l, i) => (Number(l.prestamos) || 0) > 0).length;
  const changed = workLines.filter((l, i) => (Number(l.prestamos) || 0) !== before[i]).length;
  toast(
    `Préstamos cargados · pago ${payDate} · ${applied} empleado(s) con cuota` +
      (changed ? ` · ${changed} fila(s) actualizada(s)` : "")
  );
}

/** Agrega filas de empleados con trato especial (sin fórmulas automáticas). */
function addManualPayrollRows() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  syncOpenPayrollFromDom(false);
  let p = ensureOpenPayrollDraft();
  if (!p) {
    const period = getSelectedMonth();
    const half = getSelectedPayrollHalf();
    const group = getSelectedPayrollGroup();
    const tanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
    const tandaMeta = group === "monorriel" ? monorrielTandaMeta(tanda) : null;
    const meta = payrollGroupMeta(group);
    p = normalizePayroll({
      period,
      half,
      group,
      tanda,
      payDate: payrollPayDateFor(period, half),
      status: "draft",
      lines: [],
      note:
        group === "monorriel" && tandaMeta
          ? `Nómina Monorriel · ${tandaMeta.label} · ${halfLabel(half)} · ${monthLabel(period)}`
          : `Nómina ${meta.label} · ${halfLabel(half)} · ${monthLabel(period)}`,
      createdBy:
        typeof currentUser !== "undefined" && currentUser
          ? currentUser.displayName || currentUser.username
          : "",
    });
    contabilidadData.payrolls.unshift(p);
    selectedPayrollId = p.id;
  }
  const countEl = document.getElementById("contabAddRowsCount");
  let n = Math.max(1, Math.min(40, Number(countEl && countEl.value) || 1));
  const blankFormulaOpts = payrollComputeOpts(p);
  for (let i = 0; i < n; i += 1) {
    p.lines.push(
      normalizePayrollLine(
        emptyPayrollLine({
          position: payrollIsOffice(p) ? "Oficina" : "Trato especial",
          daysWorked: "",
          uniformes: 0,
          rifa: 0,
          volaos: 0,
          almuerzo: 0,
          feriado: 0,
          horasExtras: 0,
          sfs: 0,
          salaryQuincena: 0,
          manualEntry: true,
          note: "Manual · sin fórmulas",
        }),
        blankFormulaOpts
      )
    );
  }
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  toast(`${n} fila(s) manual(es) agregada(s) · sin fórmulas (trato especial).`);
}

/**
 * Columnas editor. Solo Unif/Rifa va abreviado; el resto con nombre completo.
 * El ancho de cada columna numérica se limita al del encabezado (CSS).
 */
const PAYROLL_TABLE_COLS_BASE = [
  ["daysWorked", "Días", "days"],
  ["cedula", "Cédula", "text"],
  ["fullName", "Nombres", "name"],
  ["salaryMonthly", "Sueldo mes", "num"],
  ["salaryQuincena", "Sueldo quincena", "num"],
  ["sfs", "SFS", "num"],
  ["unifRifa", "Unif/Rifa", "unifRifa"],
  ["volaos", "Volaos", "num"],
  ["incentivos", "Incentivos", "num"],
  ["horasExtras", "Horas extras", "num"],
  ["feriado", "Feriado", "num"],
  ["almuerzo", "Almuerzo", "num"],
  ["adelantos", "Adelantos", "num"],
  ["prestamos", "Préstamos", "num"],
  ["totalDescuentos", "Total descuentos", "ro"],
  ["totalCobrar", "Total cobrar", "ro"],
  ["salarioDepositar", "A depositar", "ro"],
  ["redondeo", "Redondeo", "ro"],
];

/** Columnas impresión: sin cédula; mismos títulos (solo Unif/Rifa abreviado). */
const PAYROLL_PRINT_COLS_BASE = [
  ["daysWorked", "Días", "days"],
  ["fullName", "Nombres", "name"],
  ["salaryMonthly", "Sueldo mes", "num"],
  ["salaryQuincena", "Sueldo quincena", "num"],
  ["sfs", "SFS", "num"],
  ["unifRifa", "Unif/Rifa", "unifRifa"],
  ["volaos", "Volaos", "num"],
  ["incentivos", "Incentivos", "num"],
  ["horasExtras", "Horas extras", "num"],
  ["feriado", "Feriado", "num"],
  ["almuerzo", "Almuerzo", "num"],
  ["adelantos", "Adelantos", "num"],
  ["prestamos", "Préstamos", "num"],
  ["totalDescuentos", "Total descuentos", "ro"],
  ["totalCobrar", "Total cobrar", "ro"],
  ["salarioDepositar", "A depositar", "ro"],
  ["redondeo", "Redondeo", "ro"],
];

function payrollShowsFeriado(p) {
  if (payrollIsOffice(p)) return false;
  return !!(p && p.showFeriado);
}

function getPayrollEditorCols(p) {
  if (payrollIsOffice(p)) return PAYROLL_OFFICE_TABLE_COLS;
  const lavega = payrollUsesLvaParams(p);
  return PAYROLL_TABLE_COLS_BASE.filter(([key]) => {
    if (key === "feriado") return payrollShowsFeriado(p);
    return true;
  }).map(([key, label, kind]) => {
    if (lavega && key === "almuerzo") return ["almuerzo", "Comida / Seg. vida", "almuerzoSvda"];
    return [key, label, kind];
  });
}

function getPayrollPrintCols(p) {
  if (payrollIsOffice(p)) return PAYROLL_OFFICE_PRINT_COLS;
  const lavega = payrollUsesLvaParams(p);
  return PAYROLL_PRINT_COLS_BASE.filter(([key]) => {
    if (key === "feriado") return payrollShowsFeriado(p);
    return true;
  }).map(([key, label, kind]) => {
    if (lavega && key === "almuerzo") return ["almuerzo", "Comida / Seg. vida", "almuerzoSvda"];
    return [key, label, kind];
  });
}

// compat por si algo aún referencia PAYROLL_TABLE_COLS
const PAYROLL_TABLE_COLS = PAYROLL_TABLE_COLS_BASE;

function formatUnifRifa(line) {
  const u = Math.max(0, Number(line && line.uniformes) || 0);
  const r = Math.max(0, Number(line && line.rifa) || 0);
  if (!u && !r) return "";
  return `${u || 0}/${r || LVA_PAYROLL_RIFA}`;
}

/** Comida editable / Seguro de vida fijo 90 (todas las nóminas LVA). */
function formatAlmuerzoSvda(line) {
  const meal = Math.max(0, Number(line && line.almuerzo) || 0);
  const hasName = payrollLineHasEmployeeName(line);
  if (!hasName && !meal) return "";
  return `${meal || 0}/${LVA_PAYROLL_SVDA}`;
}

function parseAlmuerzoSvda(raw, prev = {}) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) {
    return { almuerzo: Math.max(0, Number(prev.almuerzo) || 0) };
  }
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*[\/|]\s*(\d+(?:[.,]\d+)?)?$/);
  if (m) {
    return { almuerzo: Math.max(0, Number(String(m[1]).replace(",", ".")) || 0) };
  }
  return { almuerzo: Math.max(0, Number(String(s).replace(",", ".")) || 0) };
}

function almuerzoSvdaAmount(line) {
  const meal = Math.max(0, Number(line && line.almuerzo) || 0);
  const svda = Math.max(0, Number(line && line.svda) || 0);
  if (svda) return roundMoney2(meal + svda);
  if (payrollLineHasEmployeeName(line)) return roundMoney2(meal + LVA_PAYROLL_SVDA);
  return meal;
}

function parseUnifRifa(raw, prev = {}) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) {
    return {
      uniformes: Math.max(0, Number(prev.uniformes) || 0),
      rifa: Math.max(0, Number(prev.rifa) || 0),
    };
  }
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*[/|]\s*(\d+(?:[.,]\d+)?)$/);
  if (m) {
    return {
      uniformes: Math.max(0, Number(String(m[1]).replace(",", ".")) || 0),
      rifa: Math.max(0, Number(String(m[2]).replace(",", ".")) || 0),
    };
  }
  // Solo un número → uniforme; rifa fija
  const only = Math.max(0, Number(String(s).replace(",", ".")) || 0);
  return {
    uniformes: only,
    rifa: Math.max(0, Number(prev.rifa) || LVA_PAYROLL_RIFA),
  };
}

function unifRifaAmount(line) {
  return roundMoney2((Number(line.uniformes) || 0) + (Number(line.rifa) || 0));
}

function payrollLineHasEmployeeName(line) {
  return !!(line && String(line.fullName || "").trim());
}

/** Solo filas con nombre de empleado entran en totales (las vacías no suman). */
function payrollLinesForTotals(lines) {
  return (lines || []).filter(payrollLineHasEmployeeName);
}

function sumPayrollField(lines, field) {
  return sumField(payrollLinesForTotals(lines), field);
}

function emptyPayrollLine(overrides = {}) {
  // Fila en blanco: sin montos por defecto para que no “parezca” sumar hasta poner nombre
  return normalizePayrollLine({
    employeeId: "",
    fullName: "",
    position: "La Vega Autopista",
    cedula: "",
    daysWorked: "",
    salaryMonthly: 0,
    salaryQuincena: 0,
    sfs: 0,
    uniformes: 0,
    volaos: 0,
    incentivos: 0,
    horasExtras: 0,
    feriado: 0,
    almuerzo: 0,
    rifa: 0,
    adelantos: 0,
    prestamos: 0,
    reviewed: false,
    ...overrides,
  });
}

function removePayrollLineAt(idx) {
  syncOpenPayrollFromDom(false);
  const p = ensureOpenPayrollDraft();
  if (!p) return;
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0 || i >= (p.lines || []).length) return;
  const name = (p.lines[i].fullName || "").trim() || `fila ${i + 1}`;
  if (!confirm(`¿Eliminar la fila de "${name}"?`)) return;
  p.lines.splice(i, 1);
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  toast("Fila eliminada.");
}

function ensureOpenPayrollDraft() {
  let p = contabilidadData.payrolls.find((x) => x.id === selectedPayrollId);
  if (p) return p;
  const period = getSelectedMonth();
  const half = getSelectedPayrollHalf();
  const group = getSelectedPayrollGroup();
  const tanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
  p = findPayrollByGroup(period, half, group, tanda);
  if (p) {
    selectedPayrollId = p.id;
    return p;
  }
  return null;
}

function syncOpenPayrollFromDom(recalc = false) {
  const p = ensureOpenPayrollDraft();
  if (!p) return null;
  const lines = readPayrollLinesFromDom(p.id);
  if (!lines) return p;
  const profile = getPayrollFormulaProfile(p);
  const opts = payrollComputeOpts(p);
  p.lines = lines.map((l) =>
    computePayrollLineTotals(
      recalc
        ? {
            ...l,
            salaryQuincena: 0,
            sfs: l.sfsManual
              ? Math.max(0, Number(l.sfs) || 0)
              : profile.office
                ? OFFICE_PAYROLL_SFS
                : 0,
          }
        : l,
      opts
    )
  );
  p.updatedAt = new Date().toISOString();
  return p;
}

function addBlankPayrollRows() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return;
  }
  syncOpenPayrollFromDom(false);
  let p = ensureOpenPayrollDraft();
  if (!p) {
    // crear borrador vacío del grupo seleccionado si aún no hay
    const period = getSelectedMonth();
    const half = getSelectedPayrollHalf();
    const group = getSelectedPayrollGroup();
    const tanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
    const tandaMeta = group === "monorriel" ? monorrielTandaMeta(tanda) : null;
    const meta = payrollGroupMeta(group);
    p = normalizePayroll({
      period,
      half,
      group,
      tanda,
      payDate: payrollPayDateFor(period, half),
      status: "draft",
      lines: [],
      note:
        group === "monorriel" && tandaMeta
          ? `Nómina Monorriel · ${tandaMeta.label} · ${halfLabel(half)} · ${monthLabel(period)}`
          : `Nómina ${meta.label} · ${halfLabel(half)} · ${monthLabel(period)}`,
      createdBy:
        typeof currentUser !== "undefined" && currentUser
          ? currentUser.displayName || currentUser.username
          : "",
    });
    contabilidadData.payrolls.unshift(p);
    selectedPayrollId = p.id;
  }
  const countEl = document.getElementById("contabAddRowsCount");
  let n = Math.max(1, Math.min(40, Number(countEl && countEl.value) || 1));
  const blankOpts = payrollIsOffice(p)
    ? {
        position: "Oficina",
        daysWorked: "",
        uniformes: 0,
        rifa: 0,
        volaos: 0,
        almuerzo: 0,
        feriado: 0,
        horasExtras: 0,
        sfs: 0,
      }
    : {};
  const blankFormulaOpts = payrollComputeOpts(p);
  for (let i = 0; i < n; i += 1) {
    p.lines.push(normalizePayrollLine(emptyPayrollLine(blankOpts), blankFormulaOpts));
  }
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  toast(`${n} fila(s) agregada(s) al final de la nómina.`);
}

function payrollShareCaption(p) {
  if (!p) return "Nómina Reaction";
  const g =
    p.group === "lavega" || (!p.group && String(p.note || "").toLowerCase().includes("vega"))
      ? "lavega"
      : p.group || "general";
  const meta = payrollGroupMeta(g);
  return `Nómina ${meta.short} - ${halfLabel(p.half || 1)} ${monthLabel(p.period)}`;
}

function buildPayrollPrintHtml(p) {
  const cols = getPayrollPrintCols(p);
  const isOffice = payrollIsOffice(p);
  const isLavega = payrollUsesLvaParams(p);
  const allLines = payrollLinesForTotals(p.lines || []).map((l) => {
    // Migrar uniforme viejo 215 → 115 (salvo que ya lo hayan cambiado a otro valor)
    let uniformes = Number(l.uniformes) || 0;
    if (!isOffice && uniformes === 215) uniformes = LVA_PAYROLL_UNIFORMES;
    if (isOffice) uniformes = 0;
    const named = {
      ...l,
      fullName: payrollShortEmployeeName(l.fullName) || payrollCleanEmployeeName(l.fullName) || l.fullName,
      uniformes,
      rifa: isOffice ? Number(l.rifa) || OFFICE_PAYROLL_RIFA : Number(l.rifa) || LVA_PAYROLL_RIFA,
      volaos: isOffice ? 0 : l.volaos,
      almuerzo: isOffice ? 0 : l.almuerzo,
      feriado: isOffice ? 0 : l.feriado,
      horasExtras: isOffice && !l.horasExtrasManual ? 0 : l.horasExtras,
      horasExtrasManual: !!l.horasExtrasManual,
      daysWorked: isOffice ? "" : l.daysWorked,
      salaryQuincena: isOffice ? 0 : l.salaryQuincena,
      sfs: isOffice && !l.sfsManual ? OFFICE_PAYROLL_SFS : l.sfs,
      sfsManual: !!l.sfsManual,
    };
    const printOpts = payrollComputeOpts(p);
    const computed = computePayrollLineTotals(named, printOpts);
    if (!payrollShowsFeriado(p) && Number(computed.feriado)) {
      return computePayrollLineTotals({ ...computed, feriado: 0 }, printOpts);
    }
    return computed;
  });
  const totals = {};
  cols.forEach(([key, , kind]) => {
    if (key === "unifRifa") {
      totals.unifRifa = roundMoney2(
        sumPayrollField(allLines, "uniformes") + sumPayrollField(allLines, "rifa")
      );
      return;
    }
    if (kind === "almuerzoSvda") {
      totals.almuerzo = roundMoney2(
        allLines.reduce((acc, l) => acc + almuerzoSvdaAmount(l), 0)
      );
      return;
    }
    if (kind === "ro" || kind === "num") totals[key] = sumPayrollField(allLines, key);
  });
  const head = cols
    .map(([key, label, kind]) => {
      const cls = key === "fullName" ? "col-name" : kind === "days" ? "col-days" : "col-num";
      return `<th class="${cls}">${escapeHtml(label)}</th>`;
    })
    .join("");
  const body = allLines
    .map((l) => {
      const tds = cols
        .map(([key, , kind]) => {
          if (key === "fullName") {
            return `<td class="col-name">${escapeHtml(String(l.fullName || ""))}</td>`;
          }
          if (key === "unifRifa") {
            return `<td class="right col-num">${escapeHtml(formatUnifRifa(l))}</td>`;
          }
          if (kind === "almuerzoSvda") {
            return `<td class="right col-num">${escapeHtml(formatAlmuerzoSvda(l))}</td>`;
          }
          if (kind === "ro" || kind === "num") {
            const v = Number(l[key]) || 0;
            return `<td class="right col-num">${escapeHtml(moneyPlain(v))}</td>`;
          }
          return `<td class="col-num">${escapeHtml(String(l[key] || ""))}</td>`;
        })
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");
  // TOTAL en la primera columna visible (Oficina empieza en Nombres, no en Días)
  const totalLabelKey = cols.some(([k]) => k === "daysWorked")
    ? "daysWorked"
    : cols.some(([k]) => k === "fullName")
      ? "fullName"
      : cols[0]
        ? cols[0][0]
        : "";
  const totalRow = cols
    .map(([key, , kind]) => {
      if (key === totalLabelKey) {
        const cls = key === "fullName" ? "col-name" : key === "daysWorked" ? "col-days" : "col-num";
        return `<td class="${cls}"><strong>TOTAL</strong></td>`;
      }
      if (key === "fullName") return `<td class="col-name"></td>`;
      if (key === "daysWorked") return `<td class="col-days"></td>`;
      if (key === "unifRifa") {
        return `<td class="right col-num"><strong>${escapeHtml(moneyPlain(totals.unifRifa))}</strong></td>`;
      }
      if (kind === "almuerzoSvda") {
        return `<td class="right col-num"><strong>${escapeHtml(moneyPlain(totals.almuerzo))}</strong></td>`;
      }
      if (key === "redondeo") {
        const v = Number(totals.redondeo) || 0;
        return `<td class="right col-num col-redondeo-total"><strong>${escapeHtml(moneyPlain(v))}</strong></td>`;
      }
      if (kind === "ro" || kind === "num") {
        const v = Number(totals[key]) || 0;
        return `<td class="right col-num"><strong>${escapeHtml(moneyPlain(v))}</strong></td>`;
      }
      return `<td></td>`;
    })
    .join("");
  const g =
    p.group === "lavega" || (!p.group && String(p.note || "").toLowerCase().includes("vega"))
      ? "lavega"
      : p.group || "general";
  const groupTitle = payrollGroupMeta(g).title;
  const tandaTitle =
    g === "monorriel" && p.tanda ? ` · ${monorrielTandaMeta(p.tanda).label.toUpperCase()}` : "";
  const paper = getPayrollPaperForExport(p);
  const paperLabel = paper === "letter" ? "Carta" : "Legal";
  return `
    <h2 class="nomina-print-title">
      NOMINA REACTION · ${escapeHtml(groupTitle)}${escapeHtml(tandaTitle)} · ${escapeHtml(halfLabel(p.half || 1).toUpperCase())} · ${escapeHtml(
        monthLabel(p.period).toUpperCase()
      )}
    </h2>
    <div class="meta" style="margin-bottom:4px;font-size:11px;justify-content:center">
      <div><strong>Pago:</strong> ${escapeHtml(p.payDate || "—")}</div>
      <div><strong>Empleados:</strong> ${allLines.length}</div>
      <div><strong>Total redondeo:</strong> ${escapeHtml(moneyPlain(totals.redondeo || 0))}</div>
      ${payrollShowsFeriado(p) ? "<div><strong>Feriado:</strong> activo</div>" : ""}
    </div>
    <table class="nomina-print${isOffice ? " nomina-print-office" : ""}${
      isLavega ? " nomina-print-lavega" : ""
    }">
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${cols.length}">Sin líneas</td></tr>`}</tbody>
      <tfoot><tr>${totalRow}</tr></tfoot>
    </table>
    <div class="sign-box${isOffice ? " sign-box-office" : ""}">
      <div class="sign-line">Preparado por / Contabilidad</div>
      <div class="sign-line">Autorizado / Operaciones</div>
    </div>
    <p class="footer">${escapeHtml(paperLabel)} horizontal · Reaction Force Security · ${escapeHtml(
      new Date().toLocaleString("es-DO")
    )}</p>`;
}

function payrollPrintCss(paperSize, options = {}) {
  const paper = paperSize === "letter" ? "letter" : "legal";
  const office = !!(options && options.office);
  const lavega = !!(options && options.lavega);
  const colored = office || lavega;
  // Keyword landscape evita hoja en blanco / orientación mal interpretada en Chrome
  const page =
    paper === "letter"
      ? "@page{size:letter landscape;margin:7mm}"
      : "@page{size:legal landscape;margin:6mm}";
  return `
    ${page}
    html,body.print-nomina{width:100% !important;max-width:none !important;min-height:0;overflow:visible !important;background:#fff !important;color:#111 !important}
    body.print-nomina{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:8px 10px;font-size:${
      office ? "12px" : "12px"
    };line-height:1.15;margin:0}
    body.print-nomina .brand{margin:0 auto 8px;justify-content:center;text-align:center;display:flex;align-items:center;gap:10px}
    body.print-nomina .brand img{width:${office ? "44px" : "38px"};height:${office ? "44px" : "38px"}}
    body.print-nomina h1{font-size:${office ? "17px" : "15px"};font-weight:900}
    body.print-nomina h2{
      font-size:${office ? "13px" : "12px"};margin:0 0 6px;font-weight:900;text-align:center;
      color:#fff !important;background:#b71c1c !important;padding:6px 10px;letter-spacing:0.02em
    }
    #rfsPrintRoot{max-width:none;width:100%;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;align-items:stretch;background:#fff;color:#111}
    #rfsPrintRoot > .footer{text-align:center;align-self:center}
    /* Ancho completo de la hoja (como la impresión / foto de referencia) */
    table.nomina-print{width:100% !important;max-width:100%;border-collapse:collapse;table-layout:auto;font-size:${
      office ? "11px" : "10.5px"
    };margin:0 auto}
    table.nomina-print th,table.nomina-print td{border:1px solid #222;padding:${
      office ? "4px 5px" : "2px 4px"
    };vertical-align:middle}
    table.nomina-print th{background:${colored ? "#b71c1c" : "#e8e8e8"} !important;color:${
      colored ? "#fff" : "#111"
    } !important;font-weight:900;font-size:${office ? "11px" : "11px"};line-height:1.15;white-space:nowrap;letter-spacing:0.01em}
    /* color explícito: el tema oscuro de la app hereda texto claro y el PDF sale con números blancos */
    table.nomina-print td{white-space:nowrap;padding:${
      office ? "4px 5px" : "2px 4px"
    };color:#111 !important;background:#fff}
    table.nomina-print th.col-name,table.nomina-print td.col-name{text-align:left;font-weight:700;padding:${
      office ? "4px 6px" : "2px 5px"
    };max-width:11em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap !important;word-break:normal}
    table.nomina-print th.col-num{text-align:right}
    table.nomina-print td.col-num{text-align:right;color:#111 !important}
    table.nomina-print th.col-days{text-align:center}
    table.nomina-print td.col-days{text-align:center;color:#111 !important}
    table.nomina-print tfoot td{background:${
      colored ? "#ffe082" : "#efefef"
    } !important;font-weight:900;color:#111 !important}
    table.nomina-print tfoot td.col-redondeo-total{font-size:${office ? "12px" : "11.5px"}}
    table.nomina-print-office{width:100% !important}
    table.nomina-print-office tbody tr:nth-child(even) td,
    table.nomina-print-lavega tbody tr:nth-child(even) td{background:#f3f3f3}
    table.nomina-print-office tbody tr:nth-child(odd) td,
    table.nomina-print-lavega tbody tr:nth-child(odd) td{background:#ffffff}
    table.nomina-print-office tbody tr:nth-child(even) td.col-name,
    table.nomina-print-lavega tbody tr:nth-child(even) td.col-name{background:#eceff1}
    table.nomina-print-office td.col-name,
    table.nomina-print-lavega td.col-name{color:#0d47a1;font-weight:800}
    .meta{font-size:11px;display:flex;gap:14px;flex-wrap:wrap;justify-content:center}
    .sign-box{margin-top:${office ? "16px" : "12px"};display:grid;grid-template-columns:1fr 1fr;gap:18px;width:${
      office ? "min(100%,640px)" : "min(100%,520px)"
    };align-self:center;margin-left:auto;margin-right:auto}
    .sign-line{border-top:1px solid #111;margin-top:${office ? "28px" : "26px"};padding-top:3px;text-align:center;font-size:${
      office ? "11px" : "10px"
    }}
    .footer{font-size:9px;margin-top:6px;text-align:center}
    @media print{
      html,body.print-nomina{overflow:visible !important;height:auto !important;background:#fff !important}
      body.print-nomina{padding:0 !important;margin:0 !important}
      .no-print{display:none !important}
      #rfsPrintRoot{width:100% !important;align-items:stretch;visibility:visible !important}
      table.nomina-print{font-size:${office ? "11.5px" : "11.5px"};width:${
        office ? "100%" : "auto"
      };margin:0 auto}
      table.nomina-print th{font-size:${office ? "11px" : "11px"};font-weight:900}
      table.nomina-print-office{width:100% !important}
      table.nomina-print td,table.nomina-print th{white-space:nowrap !important}
    }
  `;
}

function togglePayrollFeriado() {
  syncOpenPayrollFromDom(false);
  const p = ensureOpenPayrollDraft();
  if (!p) {
    toast("Abre o genera una nómina primero.");
    return;
  }
  if (payrollIsOffice(p)) {
    toast("La nómina de oficina no usa feriado.");
    return;
  }
  p.showFeriado = !p.showFeriado;
  if (!p.showFeriado) {
    p.lines = (p.lines || []).map((l) =>
      computePayrollLineTotals({ ...l, feriado: 0 }, payrollComputeOpts(p))
    );
  }
  p.updatedAt = new Date().toISOString();
  saveContabilidadData(true);
  renderNominaTab();
  toast(p.showFeriado ? "Columna Feriado habilitada." : "Columna Feriado oculta.");
}

function resolveOpenPayrollForExport() {
  if (!canAccessContabilidad()) {
    toast("No tienes acceso a Contabilidad.");
    return null;
  }
  try {
    syncOpenPayrollFromDom(false);
  } catch (_) {}
  const p = ensureOpenPayrollDraft();
  if (!p || !payrollLinesForTotals(p.lines || []).length) {
    toast("Abre o genera una nómina con empleados antes de imprimir o compartir.");
    return null;
  }
  try {
    saveContabilidadData(true);
  } catch (_) {}
  return p;
}

function payrollPdfFileName(p) {
  const caption = payrollShareCaption(p);
  const safe = String(caption || "nomina")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${safe || "nomina"}.pdf`;
}

/** Tamaño de página PDF nómina: siempre horizontal. Oficina=Carta; resto=Legal. */
function payrollPdfPageSpec(p) {
  const isOffice = payrollIsOffice(p);
  // Legal landscape 14×8.5 in → 355.6 × 215.9 mm; Carta landscape 11×8.5 → 279.4 × 215.9 mm
  if (isOffice) {
    return {
      format: "letter",
      orientation: "landscape",
      widthMm: 279.4,
      heightMm: 215.9,
      marginMm: 6,
      cssPx: 1100,
    };
  }
  return {
    format: "legal",
    orientation: "landscape",
    widthMm: 355.6,
    heightMm: 215.9,
    marginMm: 5,
    cssPx: 1340,
  };
}

function resolveJsPdfConstructor() {
  try {
    if (window.jspdf && typeof window.jspdf.jsPDF === "function") return window.jspdf.jsPDF;
  } catch (_) {}
  try {
    if (typeof window.jsPDF === "function") return window.jsPDF;
  } catch (_) {}
  return null;
}

/**
 * PDF nómina = mismo HTML/CSS que Imprimir, Legal/Carta horizontal.
 * Importante: capturar el HOST (incluye <style>) y forzar tamaño del logo en línea
 * (logo.jpg es 1500×1500; sin CSS en el clone salía gigante solo el logo).
 */
/**
 * PDF nómina = MISMA ventana / HTML / CSS / tamaño que Imprimir.
 * Ya no hay captura aparte (evita logo gigante o hoja en blanco).
 */
function openPayrollPrintWindowForPdf(p, opts = {}) {
  if (!p) return null;
  if (typeof openPrintWindow !== "function") return null;
  const caption = payrollShareCaption(p);
  const paper = getPayrollPaperForExport(p);
  const isOffice = payrollIsOffice(p);
  const isLavega = payrollUsesLvaParams(p);
  return openPrintWindow(caption, buildPayrollPrintHtml(p), {
    bodyClass: "print-nomina",
    pageSize: paper,
    orientation: "landscape",
    pdfFormat: paper,
    pdfOrientation: "landscape",
    wide: true,
    autoPrint: false,
    autoDownloadPdf: !!opts.autoDownloadPdf,
    returnPdfToOpener: !!opts.returnPdfToOpener,
    extraCss: payrollPrintCss(paper, { office: isOffice, lavega: isLavega }),
    share: {
      text: caption,
      subject: caption,
      fileName: payrollPdfFileName(p),
    },
  });
}

async function buildPayrollPdfBlob(p) {
  if (!p) throw new Error("Sin nómina");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, blob) => {
      if (settled) return;
      settled = true;
      try {
        window.__rfsPayrollPdfCallback = null;
      } catch (_) {}
      clearTimeout(timer);
      if (err || !blob || !blob.size) reject(err || new Error("PDF vacío"));
      else resolve(blob);
    };
    const timer = setTimeout(() => finish(new Error("Tiempo agotado al generar PDF")), 90000);
    window.__rfsPayrollPdfCallback = (err, blob) => finish(err, blob);
    const win = openPayrollPrintWindowForPdf(p, { returnPdfToOpener: true });
    if (!win) {
      finish(new Error("Permite ventanas emergentes para descargar el PDF"));
    }
  });
}

function printOpenPayrollSheet() {
  const p = resolveOpenPayrollForExport();
  if (!p) return;
  const paper = getPayrollPaperForExport(p);
  const paperLabel = paper === "letter" ? "Carta" : "Legal";
  const win = openPayrollPrintWindowForPdf(p, {});
  if (!win) {
    toast("Permite ventanas emergentes para imprimir.");
    return;
  }
  toast(`${paperLabel} horizontal · usa Imprimir o Descargar PDF en la barra.`);
}

async function downloadOpenPayrollPdf() {
  const p = resolveOpenPayrollForExport();
  if (!p) return;
  toast("Generando PDF (mismo ajuste que Imprimir)…");
  try {
    // Misma ventana de impresión → mismo HTML/CSS/tamaño; el PDF vuelve al opener
    const blob = await buildPayrollPdfBlob(p);
    const name = payrollPdfFileName(p);
    if (typeof downloadBlobFile === "function") downloadBlobFile(blob, name);
    else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
    }
    toast("PDF descargado.");
  } catch (err) {
    console.error(err);
    const msg = String((err && err.message) || err || "");
    if (/emergente|popup|bloquead/i.test(msg)) {
      toast("Permite ventanas emergentes y pulsa Descargar PDF otra vez.");
    } else {
      toast("No se pudo crear el PDF. Abre Imprimir y usa Descargar PDF ahí.");
    }
  }
}

/** Recibos individuales: Banco/Efectivo/La Vega/Lotedom → Epson 76 mm; Monorriel → POS80 80 mm. */
function payrollSupportsReceiptPrint(p) {
  if (!p) return false;
  if (payrollIsBanco(p) || payrollIsEfectivo(p) || payrollIsLavega(p) || payrollIsLotedom(p)) return true;
  if (payrollIsMonorriel(p)) return true;
  return false;
}

/** Perfil de impresora de rollo según nómina. */
function payrollReceiptProfile(p) {
  return payrollIsMonorriel(p) ? "pos80" : "epson76";
}

function payrollReceiptPrinterHint(p) {
  return payrollReceiptProfile(p) === "pos80"
    ? "2connect POS80 · papel 80 mm"
    : "Epson TM-U220 · papel 76 mm";
}

function payrollReceiptAmt(n) {
  const v = Number(n) || 0;
  if (!v) return "";
  return v.toLocaleString("es-DO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function payrollReceiptPayDateLabel(p) {
  const raw = String((p && (p.payDate || effectivePayrollPayDate(p))) || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "—";
  const [y, m, d] = raw.split("-");
  return `${d}/${m}/${y}`;
}

function payrollReceiptCss(profile = "epson76") {
  // epson76 = TM-U220 (Reaction / La Vega / Lotedom). pos80 = 2connect POS80 (Monorriel).
  const pos80 = profile === "pos80";
  const pageW = pos80 ? "80mm" : "76mm";
  const pad = pos80 ? "3mm 5mm 3mm 5mm" : "3mm 4mm 3mm 8mm";
  const ticketMax = pos80 ? "68mm" : "62mm";
  return `
    @page{size:${pageW} auto;margin:0}
    html,body.print-recibo{
      width:${pageW} !important;max-width:${pageW} !important;margin:0 !important;
      padding:${pad} !important;box-sizing:border-box !important;
      background:#fff !important;color:#000 !important;
      font-family:Cambria,"Times New Roman",Times,serif;
      font-size:11pt;line-height:1.35;font-weight:700
    }
    body.print-recibo .brand,
    body.print-recibo .print-bar + #rfsPrintRoot > .brand,
    body.print-recibo #rfsPrintRoot > .brand,
    body.print-recibo #rfsPrintRoot > .footer{display:none !important}
    #rfsPrintRoot{width:100% !important;max-width:100% !important;padding:0 !important;margin:0 !important;box-sizing:border-box}
    .recibo-ticket{
      width:100%;max-width:${ticketMax};box-sizing:border-box;
      page-break-after:always;break-after:page;
      padding:2mm 0 12mm;margin:0 0 8mm;color:#000;
      border-bottom:1px dashed #000
    }
    .recibo-ticket:last-child{
      page-break-after:auto;break-after:auto;border-bottom:0;margin-bottom:0;padding-bottom:4mm
    }
    .recibo-ticket .co{
      text-align:center;font-weight:900;font-size:11pt;margin:0 0 2px;letter-spacing:0.01em
    }
    .recibo-ticket .title{
      text-align:center;font-weight:900;font-size:12pt;margin:0 0 4px;text-transform:uppercase
    }
    .recibo-ticket .group-tag{
      text-align:center;font-size:10pt;font-weight:700;margin:0 0 6px
    }
    .recibo-ticket .meta-line{margin:0 0 2px;font-size:11pt;font-weight:700}
    .recibo-ticket .meta-line strong{font-weight:900}
    .recibo-ticket .sep{
      border:0;border-top:1.5px solid #000;margin:6px 0
    }
    .recibo-ticket .rows{width:100%;margin:0;padding:0}
    .recibo-ticket .row{
      display:flex;justify-content:space-between;align-items:baseline;
      gap:6px;margin:0 0 3px;font-size:11pt;font-weight:700
    }
    .recibo-ticket .row .lab{flex:1 1 auto;min-width:0;font-weight:700}
    .recibo-ticket .row .val{
      flex:0 0 auto;text-align:right;font-weight:900;font-variant-numeric:tabular-nums;
      min-width:18mm
    }
    .recibo-ticket .head-row{
      font-weight:900;border-bottom:1.5px solid #000;padding-bottom:3px;margin-bottom:5px
    }
    .recibo-ticket .neto-box{
      margin:8px 0 10px;padding:5px 4px;border:2px solid #000;text-align:center;
      font-weight:900;font-size:11pt
    }
    .recibo-ticket .signs{
      display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px
    }
    .recibo-ticket .sign-line{
      border-top:1.5px solid #000;margin-top:22px;padding-top:3px;text-align:center;
      font-size:10pt;font-weight:700
    }
    .recibo-ticket .cut-hint{
      text-align:center;font-size:8pt;font-weight:700;margin:10px 0 0;letter-spacing:0.08em
    }
    @media print{
      html,body.print-recibo{
        width:${pageW} !important;max-width:${pageW} !important;margin:0 !important;
        padding:${pad} !important;box-sizing:border-box !important
      }
      .recibo-ticket{page-break-after:always;padding-bottom:12mm;margin-bottom:8mm}
      .recibo-ticket:last-child{page-break-after:auto;margin-bottom:0}
    }
  `;
}

function buildPayrollReceiptTicketHtml(p, line) {
  const opts = payrollComputeOpts(p);
  const l = computePayrollLineTotals(line, opts);
  const name =
    (typeof payrollShortEmployeeName === "function"
      ? payrollShortEmployeeName(l.fullName)
      : "") ||
    String(l.fullName || "").trim() ||
    "—";
  const days = String(l.daysWorked || "").trim();
  const fecha = payrollReceiptPayDateLabel(p);
  const groupMeta = payrollGroupMeta(p.group || "banco");
  const tandaMeta = payrollIsMonorriel(p) ? monorrielTandaMeta(p.tanda) : null;
  const groupLine = tandaMeta
    ? `${groupMeta.short} · ${tandaMeta.short} · ${halfLabel(p.half || 1)}`
    : `${groupMeta.short} · ${halfLabel(p.half || 1)}`;
  const extras = roundMoney2((Number(l.horasExtras) || 0) + (Number(l.feriado) || 0));
  // Todas las nóminas con recibo (Banco/Efectivo/La Vega/Lotedom/Monorriel):
  // SVDA fijo 90 = Seguro de vida; Cena/Comida = solo almuerzo editable.
  const splitMealInsurance = payrollSupportsReceiptPrint(p) || payrollUsesLvaParams(p);
  const comida = roundMoney2(Number(l.almuerzo) || 0);
  const seguroVida = roundMoney2(
    Number(l.svda) ||
      (splitMealInsurance && payrollLineHasEmployeeName(l) ? LVA_PAYROLL_SVDA : 0)
  );
  const unifRifa = roundMoney2((Number(l.uniformes) || 0) + (Number(l.rifa) || 0));
  const mealOrInsuranceRows = splitMealInsurance
    ? [
        ["Seguro de vida", seguroVida],
        ["Cena / Comida", comida],
      ]
    : [["Cena / Comida", roundMoney2(comida + seguroVida)]];
  const rows = [
    ["Sueldo bruto", l.salaryQuincena],
    ["SFS / SVDS", l.sfs],
    ["Incentivos", l.incentivos],
    ["Volao", l.volaos],
    ["Hrs extras / feriado", extras],
    ...mealOrInsuranceRows,
    ["Unif / Rifa", unifRifa],
    ["Adelantos", l.adelantos],
    ["Prestamos", l.prestamos],
  ]
    .map(
      ([label, val]) =>
        `<div class="row"><span class="lab">${escapeHtml(label)}</span><span class="val">${escapeHtml(
          payrollReceiptAmt(val) || "—"
        )}</span></div>`
    )
    .join("");
  const neto = Number(l.redondeo) || Number(l.salarioDepositar) || 0;
  return `<article class="recibo-ticket">
    <p class="co">REACTION FORCE SECURITY LS, SRL</p>
    <p class="title">RECIBO DE PAGO</p>
    <p class="group-tag">${escapeHtml(groupLine)}</p>
    <hr class="sep" />
    <p class="meta-line"><strong>Empleado:</strong> ${escapeHtml(String(name).toUpperCase())}</p>
    <p class="meta-line"><strong>Fecha:</strong> ${escapeHtml(fecha)}</p>
    <p class="meta-line"><strong>Días:</strong> ${escapeHtml(days || "—")}</p>
    <hr class="sep" />
    <div class="rows">
      <div class="row head-row"><span class="lab">Concepto</span><span class="val">Monto RD$</span></div>
      ${rows}
    </div>
    <div class="neto-box">SUELDO NETO: RD$ ${escapeHtml(payrollReceiptAmt(neto) || "0.00")}</div>
    <div class="signs">
      <div><div class="sign-line">Autorizado</div></div>
      <div><div class="sign-line">Recibido</div></div>
    </div>
    <p class="cut-hint">· · · cortar aquí · · ·</p>
  </article>`;
}

function buildPayrollReceiptsHtml(p) {
  const lines = payrollLinesForTotals(p.lines || []).map((l) =>
    computePayrollLineTotals(l, payrollComputeOpts(p))
  );
  if (!lines.length) return `<p>Sin empleados en esta nómina.</p>`;
  return lines.map((l) => buildPayrollReceiptTicketHtml(p, l)).join("\n");
}

function printOpenPayrollReceipts() {
  const p = resolveOpenPayrollForExport();
  if (!p) return;
  if (!payrollSupportsReceiptPrint(p)) {
    toast("Recibos disponibles en Banco, Efectivo, La Vega, Lotedom y Monorriel.");
    return;
  }
  const n = payrollLinesForTotals(p.lines || []).length;
  if (!n) {
    toast("No hay empleados para imprimir recibos.");
    return;
  }
  if (typeof openPrintWindow !== "function") {
    toast("Impresión no disponible.");
    return;
  }
  const profile = payrollReceiptProfile(p);
  const tandaMeta = payrollIsMonorriel(p) ? monorrielTandaMeta(p.tanda) : null;
  const groupBit = tandaMeta
    ? `${payrollGroupMeta(p.group).short}-${tandaMeta.short}`
    : payrollGroupMeta(p.group).short;
  const caption = `Recibos ${groupBit} · ${halfLabel(p.half || 1)} · ${monthLabel(p.period)}`;
  const win = openPrintWindow(caption, buildPayrollReceiptsHtml(p), {
    bodyClass: "print-recibo",
    pageSize: "",
    orientation: "portrait",
    wide: false,
    autoPrint: false,
    extraCss: payrollReceiptCss(profile),
    share: {
      text: caption,
      subject: caption,
      fileName: `recibos-${String(groupBit || "nomina")
        .toLowerCase()
        .replace(/\s+/g, "-")}-${p.period || ""}.pdf`,
    },
  });
  if (!win) {
    toast("Permite ventanas emergentes para imprimir los recibos.");
    return;
  }
  toast(`${n} recibo(s) · elige ${payrollReceiptPrinterHint(p)}`);
}

async function shareOpenPayrollSheet(mode = "share") {
  const p = resolveOpenPayrollForExport();
  if (!p) return;
  const caption = payrollShareCaption(p);
  const wantMail = mode === "mail" || mode === "gmail" || mode === "email";
  toast(wantMail ? "Preparando PDF para Gmail / correo…" : "Preparando PDF para compartir…");
  try {
    const blob = await buildPayrollPdfBlob(p);
    const file = new File([blob], payrollPdfFileName(p), { type: "application/pdf" });
    if (typeof trySharePdfFile === "function") {
      const shared = await trySharePdfFile(file, caption, caption);
      if (shared) {
        toast(wantMail ? "Elige Gmail o Correo en el menú y adjunta el PDF." : "Elige WhatsApp o Gmail en el menú.");
        return;
      }
    } else if (navigator.share) {
      try {
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ title: caption, text: caption, files: [file] });
          toast(wantMail ? "Elige Gmail en el menú." : "PDF listo para enviar.");
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    // Fallback: descargar PDF y abrir correo o WhatsApp
    if (typeof downloadBlobFile === "function") downloadBlobFile(file, file.name);
    else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2500);
    }
    if (wantMail) {
      window.location.href = `mailto:?subject=${encodeURIComponent(caption)}&body=${encodeURIComponent(
        `${caption}\n\nAdjunta el PDF descargado (${file.name}).`
      )}`;
      toast("PDF descargado. Adjúntalo en Gmail / correo.");
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(caption)}`, "_blank");
    toast("PDF descargado. Adjúntalo en WhatsApp.");
  } catch (err) {
    console.error(err);
    toast("No se pudo preparar el PDF. Usa Descargar PDF e intenta de nuevo.");
  }
}

function emailOpenPayrollPdf() {
  return shareOpenPayrollSheet("mail");
}


let payrollLiveTimer = null;
let payrollSaveTimer = null;
let payrollCloudPushTimer = null;
let lastPayrollEditAt = 0;

/** True si hay teclado/foco en la tabla de nómina (otra PC no debe pisar la UI). */
function isPayrollBeingEdited() {
  const active = document.querySelector(".view.active");
  if (!active || active.id !== "nominaView") return false;
  const root = document.getElementById("contabPayrollDetail");
  if (root && document.activeElement && root.contains(document.activeElement)) return true;
  return Date.now() - lastPayrollEditAt < 25000;
}

function markPayrollEdited() {
  lastPayrollEditAt = Date.now();
  if (typeof lastLocalEditAt !== "undefined") lastLocalEditAt = Date.now();
}

/** Copia DOM → memoria local (sin subir a la nube). */
function flushOpenPayrollDraft(push = false) {
  try {
    const p = typeof ensureOpenPayrollDraft === "function" ? ensureOpenPayrollDraft() : null;
    if (!p) return false;
    const lines = typeof readPayrollLinesFromDom === "function" ? readPayrollLinesFromDom(p.id) : null;
    if (!lines) return false;
    p.lines = lines;
    p.updatedAt = new Date().toISOString();
    saveContabilidadData(!!push);
    return true;
  } catch (_) {
    return false;
  }
}

function schedulePayrollAutosave() {
  markPayrollEdited();
  clearTimeout(payrollSaveTimer);
  // Local inmediato: no perder tecleo si hay sync
  payrollSaveTimer = setTimeout(() => {
    try {
      flushOpenPayrollDraft(false);
    } catch (_) {}
  }, 500);
  // Nube más lento: evita que cada tecla dispare sync en la otra PC
  clearTimeout(payrollCloudPushTimer);
  payrollCloudPushTimer = setTimeout(() => {
    try {
      flushOpenPayrollDraft(true);
    } catch (_) {}
  }, 12000);
}

function updatePayrollReadonlyDom(p) {
  const root = document.getElementById("contabPayrollDetail");
  if (!root || !p) return;
  const lines = p.lines || [];
  root.querySelectorAll("tr[data-line-idx]").forEach((tr) => {
    const idx = Number(tr.dataset.lineIdx);
    const l = lines[idx];
    if (!l) return;
    tr.classList.toggle("nomina-row-empty", !payrollLineHasEmployeeName(l));
    tr.classList.toggle("nomina-row-reviewed", !!(payrollLineHasEmployeeName(l) && l.reviewed));
    ["salaryQuincena", "sfs", "totalDescuentos", "totalCobrar", "salarioDepositar", "redondeo"].forEach((key) => {
      const td = [...tr.children].find((cell) => cell.dataset && cell.dataset.ro === key);
      if (td) td.textContent = moneyCell(l[key]);
    });
    // also sync computed quincena/sfs / Almuerzo-SVDA when auto-forced (La Vega)
    const q = tr.querySelector('[data-f="salaryQuincena"]');
    const s = tr.querySelector('[data-f="sfs"]');
    const asv = tr.querySelector('[data-f="almuerzoSvda"]');
    const vol = tr.querySelector('[data-f="volaos"]');
    const hex = tr.querySelector('[data-f="horasExtras"]');
    if (q && document.activeElement !== q) q.value = l.salaryQuincena || "";
    // Mostrar 0 cuando el usuario lo puso a mano (|| "" lo ocultaba)
    if (s && document.activeElement !== s) s.value = String(Number(l.sfs) || 0);
    if (asv && document.activeElement !== asv) asv.value = formatAlmuerzoSvda(l);
    if (vol && document.activeElement !== vol) vol.value = l.volaos || "";
    if (hex && document.activeElement !== hex) hex.value = String(Number(l.horasExtras) || 0);
    const prest = tr.querySelector('[data-f="prestamos"]');
    if (prest && document.activeElement !== prest) prest.value = l.prestamos || "";
    const prestRo = [...tr.children].find((cell) => cell.dataset && cell.dataset.ro === "prestamos");
    if (prestRo) prestRo.textContent = moneyCell(l.prestamos);
  });
  const totals = {
    salaryMonthly: sumPayrollField(lines, "salaryMonthly"),
    salaryQuincena: sumPayrollField(lines, "salaryQuincena"),
    sfs: sumPayrollField(lines, "sfs"),
    uniformes: sumPayrollField(lines, "uniformes"),
    volaos: sumPayrollField(lines, "volaos"),
    incentivos: sumPayrollField(lines, "incentivos"),
    horasExtras: sumPayrollField(lines, "horasExtras"),
    feriado: sumPayrollField(lines, "feriado"),
    almuerzo: payrollUsesLvaParams(p)
      ? roundMoney2(payrollLinesForTotals(lines).reduce((acc, l) => acc + almuerzoSvdaAmount(l), 0))
      : sumPayrollField(lines, "almuerzo"),
    rifa: sumPayrollField(lines, "rifa"),
    adelantos: sumPayrollField(lines, "adelantos"),
    prestamos: sumPayrollField(lines, "prestamos"),
    totalDescuentos: sumPayrollField(lines, "totalDescuentos"),
    totalCobrar: sumPayrollField(lines, "totalCobrar"),
    salarioDepositar: sumPayrollField(lines, "salarioDepositar"),
    redondeo: sumPayrollField(lines, "redondeo"),
    unifRifa: roundMoney2(sumPayrollField(lines, "uniformes") + sumPayrollField(lines, "rifa")),
  };
  const foot = root.querySelector("tfoot tr.nomina-total-row");
  if (foot) {
    const cells = [...foot.children];
    const cols = getPayrollEditorCols(p);
    cols.forEach((col, i) => {
      const [key] = col;
      if (!cells[i]) return;
      if (key === "daysWorked" || key === "cedula" || key === "fullName") return;
      if (key === "redondeo") {
        const v = Number(totals.redondeo) || 0;
        cells[i].innerHTML = `<strong>${escapeHtml(moneyPlain(v) || "0")}</strong>`;
        return;
      }
      cells[i].textContent = moneyCell(totals[key]);
    });
  }
  const summary = root.querySelector("[data-nomina-total-summary]");
  if (summary) {
    const named = payrollLinesForTotals(lines).length;
    const reviewed = payrollLinesForTotals(lines).filter((l) => !!l.reviewed).length;
    summary.innerHTML = `<strong>Total redondeo: ${escapeHtml(moneyRd(totals.redondeo))}</strong>
      <span class="muted"> · A depositar ${escapeHtml(moneyRd(totals.salarioDepositar))} · A cobrar ${escapeHtml(
        moneyRd(totals.totalCobrar)
      )} · ${named} con nombre · ${reviewed} revisado(s) (auto)</span>`;
  }
}

function applyPayrollLiveUpdate(ev) {
  const field = ev && ev.target && ev.target.dataset ? ev.target.dataset.f : "";
  const tr = ev && ev.target && ev.target.closest ? ev.target.closest("tr[data-line-idx]") : null;
  const idx = tr ? Number(tr.dataset.lineIdx) : -1;
  const p = ensureOpenPayrollDraft();
  if (!p) return;
  const lines = readPayrollLinesFromDom(p.id);
  if (!lines) return;
  const profile = getPayrollFormulaProfile(p);
  const opts = payrollComputeOpts(p);
  const forceBase = field === "daysWorked" || field === "salaryMonthly";
  const editSfs = field === "sfs";
  const editHex = field === "horasExtras";
  let workLines = lines.map((l, i) => {
    if (isManualPayrollLine(l)) {
      return computePayrollLineTotals(l, opts);
    }
    if (i === idx && (editSfs || editHex)) {
      return computePayrollLineTotals(
        {
          ...l,
          sfsManual: editSfs ? true : !!l.sfsManual,
          horasExtrasManual: editHex ? true : !!l.horasExtrasManual,
          sfs: Math.max(0, Number(l.sfs) || 0),
          horasExtras: Math.max(0, Number(l.horasExtras) || 0),
        },
        opts
      );
    }
    if (forceBase && i === idx) {
      const daysInfo = parsePayrollDays(l.daysWorked);
      // Al cambiar días: quincena, volao (+N) y extras auto (si no están a mano)
      let nextHoras = Math.max(0, Number(l.horasExtras) || 0);
      if (field === "daysWorked" && !profile.office && !l.horasExtrasManual) {
        nextHoras = profile.autoExtrasFromDays
          ? extrasPayFromBaseDays(
              daysInfo.baseDays,
              profile.extrasFromDaysPay,
              profile.extrasDaysBlock
            )
          : nextHoras;
      }
      return computePayrollLineTotals(
        {
          ...l,
          salaryQuincena: 0,
          sfs: l.sfsManual
            ? Math.max(0, Number(l.sfs) || 0)
            : profile.office
              ? OFFICE_PAYROLL_SFS
              : 0,
          volaos: field === "daysWorked" ? 0 : l.volaos,
          horasExtras: nextHoras,
        },
        opts
      );
    }
    return computePayrollLineTotals(l, opts);
  });
  // Monorriel: no pisar Préstamos en vivo (el usuario puede teclear montos).
  if (p.group === "monorriel") {
    const payDate = effectivePayrollPayDate(p) || payrollPayDateFor(p.period, p.half);
    if (payDate) p.payDate = payDate;
  }
  p.lines = workLines;
  p.updatedAt = new Date().toISOString();
  updatePayrollReadonlyDom(p);
  schedulePayrollAutosave();
}

function schedulePayrollLiveUpdate(ev) {
  clearTimeout(payrollLiveTimer);
  payrollLiveTimer = setTimeout(() => applyPayrollLiveUpdate(ev), 220);
}

function bindPayrollLiveTotals() {
  const root = document.getElementById("contabPayrollDetail");
  if (!root) return;
  if (root.dataset.liveBound === "1") return;
  root.dataset.liveBound = "1";
  root.addEventListener("input", (ev) => {
    if (ev.target && ev.target.classList && ev.target.classList.contains("nomina-inp")) {
      schedulePayrollLiveUpdate(ev);
    }
  });
  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.matches && t.matches('input[data-f="reviewed"]')) {
      schedulePayrollLiveUpdate(ev);
      return;
    }
    if (t.classList && t.classList.contains("nomina-inp")) {
      schedulePayrollLiveUpdate(ev);
    }
  });
}

function renderNominaTab() {
  const list = document.getElementById("contabPayrollList");
  const detail = document.getElementById("contabPayrollDetail");
  if (!list) return;
  const halfSel = document.getElementById("contabPayrollHalf");
  const groupSel = document.getElementById("contabPayrollGroup");
  const group = getSelectedPayrollGroup();
  if (group === "monorriel" && !renderNominaTab._feedingDays) {
    renderNominaTab._feedingDays = true;
    try {
      feedMonorrielPayrollDaysFromReports({
        period: getSelectedMonth(),
        half: getSelectedPayrollHalf(),
        quiet: true,
        createMissing: true,
        onlySelectedPeriod: true,
      });
    } catch (_) {}
    renderNominaTab._feedingDays = false;
  }
  const meta = payrollGroupMeta(group);
  syncPayrollPaperUiForGroup(group);
  syncMonorrielTandaUi(group);
  const monoTanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
  const monoTandaMeta = group === "monorriel" ? monorrielTandaMeta(monoTanda) : null;
  const titleEl = document.getElementById("contabNominaTitle");
  if (titleEl) {
    titleEl.textContent =
      group === "monorriel" && monoTandaMeta
        ? `Nómina · Monorriel · ${monoTandaMeta.label}`
        : `Nómina · ${meta.label}`;
  }
  const genBtn = document.getElementById("btnContabGenPayroll");
  if (genBtn) {
    genBtn.textContent =
      group === "general"
        ? "Crear / abrir plantilla General"
        : group === "monorriel" && monoTandaMeta
          ? `Generar / actualizar · ${monoTandaMeta.short}`
          : `Generar / actualizar · ${meta.short}`;
  }

  const rows = (contabilidadData.payrolls || [])
    .filter((p) => {
      if (group === "lavega") {
        return p.group === "lavega" || !p.group || String(p.note || "").toLowerCase().includes("vega");
      }
      if (p.group !== group) return false;
      if (group === "monorriel") {
        if (isLegacyMonorrielPayroll(p)) return false;
        return normalizeMonorrielTandaId(p.tanda) === monoTanda;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      const pk = String(b.period).localeCompare(String(a.period));
      if (pk) return pk;
      return (b.half || 1) - (a.half || 1);
    });
  const legacyMono = (contabilidadData.payrolls || []).filter(
    (p) =>
      isLegacyMonorrielPayroll(p) &&
      p.status !== "cancelled" &&
      p.period === getSelectedMonth()
  );
  if (!rows.length) {
    const nStaff = getStaffForPayrollGroup(group, monoTanda).length;
    const emptyLabel =
      group === "monorriel" && monoTandaMeta ? `Monorriel · ${monoTandaMeta.short}` : meta.short;
    const legacyHint =
      group === "monorriel" && legacyMono.length
        ? ` Hay ${legacyMono.length} nómina(s) antigua(s) sin tanda: pulsa «Generar las 4 tandas» para reemplazarlas.`
        : "";
    list.innerHTML = `<p class="empty">Aún no hay nómina ${escapeHtml(emptyLabel)}. ${
      group === "monorriel" && !nStaff
        ? "Falta el Excel de esta tanda."
        : group === "monorriel"
          ? `Hay ${nStaff} persona(s) en el Excel. Pulsa «Generar las 4 tandas» o «Generar / actualizar».${legacyHint}`
          : group === "reaction"
            ? "Ábrela desde Ramón Vargas → «1. Nómina general» (solo empleados del reporte)."
            : `Pulsa «Generar / actualizar»${
                group === "general" ? " para crear la plantilla" : ` (${nStaff} persona(s) disponibles)`
              }.`
    }</p>`;
  } else {
    list.innerHTML = rows
      .map((p) => {
        const total = sumPayrollField(p.lines, "redondeo") || sumPayrollField(p.lines, "net");
        const st = p.status === "paid" ? "Pagada" : p.status === "cancelled" ? "Cancelada" : "Borrador";
        const gMeta = payrollGroupMeta(
          p.group === "lavega" || (!p.group && String(p.note || "").toLowerCase().includes("vega"))
            ? "lavega"
            : p.group || "general"
        );
        const tMeta = p.group === "monorriel" ? monorrielTandaMeta(p.tanda) : null;
        const headLabel = tMeta ? `${gMeta.short} · ${tMeta.short}` : gMeta.short;
        return `<article class="report-card">
          <h3>${escapeHtml(headLabel)} · ${escapeHtml(monthLabel(p.period))} · ${escapeHtml(halfLabel(p.half || 1))}</h3>
          <p class="muted">Pago ${escapeHtml(p.payDate || "—")} · ${escapeHtml(st)} · ${
            payrollLinesForTotals(p.lines).length
          } empleado(s)</p>
          <p><strong>${escapeHtml(moneyRd(total))}</strong> <span class="muted">(redondeo)</span></p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <button type="button" class="btn secondary btn-pay-open" data-id="${escapeHtml(
              p.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Abrir tabla</button>
            <button type="button" class="btn secondary btn-pay-print" data-id="${escapeHtml(
              p.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Imprimir</button>
            <button type="button" class="btn secondary btn-pay-download" data-id="${escapeHtml(
              p.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Descargar PDF</button>
            ${
              payrollSupportsReceiptPrint(p)
                ? `<button type="button" class="btn primary btn-pay-receipts" data-id="${escapeHtml(
                    p.id
                  )}" style="width:auto;padding:8px 10px;font-size:12px">Imprimir recibos</button>`
                : ""
            }
            ${
              p.status === "draft"
                ? `<button type="button" class="btn primary btn-pay-paid" data-id="${escapeHtml(
                    p.id
                  )}" style="width:auto;padding:8px 10px;font-size:12px">Marcar pagada</button>`
                : ""
            }
            <button type="button" class="btn danger btn-pay-del" data-id="${escapeHtml(
              p.id
            )}" style="width:auto;padding:8px 10px;font-size:12px">Eliminar</button>
          </div>
        </article>`;
      })
      .join("");
    list.querySelectorAll(".btn-pay-open").forEach((btn) =>
      btn.addEventListener("click", () => {
        selectedPayrollId = btn.dataset.id;
        const p = contabilidadData.payrolls.find((x) => x.id === btn.dataset.id);
        if (p && halfSel) halfSel.value = String(p.half || 1);
        if (p && groupSel && p.group && PAYROLL_GROUP_META[p.group]) groupSel.value = p.group;
        const tandaSel = document.getElementById("contabPayrollMonoTanda");
        if (p && p.group === "monorriel" && tandaSel) {
          syncMonorrielTandaUi("monorriel");
          tandaSel.value = normalizeMonorrielTandaId(p.tanda);
        }
        renderNominaTab();
      })
    );
    list.querySelectorAll(".btn-pay-print").forEach((btn) =>
      btn.addEventListener("click", () => {
        selectedPayrollId = btn.dataset.id;
        const p = contabilidadData.payrolls.find((x) => x.id === btn.dataset.id);
        if (p && halfSel) halfSel.value = String(p.half || 1);
        if (p && groupSel && p.group && PAYROLL_GROUP_META[p.group]) groupSel.value = p.group;
        const tandaSel = document.getElementById("contabPayrollMonoTanda");
        if (p && p.group === "monorriel" && tandaSel) {
          syncMonorrielTandaUi("monorriel");
          tandaSel.value = normalizeMonorrielTandaId(p.tanda);
        }
        renderNominaTab();
        setTimeout(() => printOpenPayrollSheet(), 50);
      })
    );
    list.querySelectorAll(".btn-pay-download").forEach((btn) =>
      btn.addEventListener("click", () => {
        selectedPayrollId = btn.dataset.id;
        const p = contabilidadData.payrolls.find((x) => x.id === btn.dataset.id);
        if (p && halfSel) halfSel.value = String(p.half || 1);
        if (p && groupSel && p.group && PAYROLL_GROUP_META[p.group]) groupSel.value = p.group;
        const tandaSel = document.getElementById("contabPayrollMonoTanda");
        if (p && p.group === "monorriel" && tandaSel) {
          syncMonorrielTandaUi("monorriel");
          tandaSel.value = normalizeMonorrielTandaId(p.tanda);
        }
        renderNominaTab();
        setTimeout(() => {
          downloadOpenPayrollPdf().catch(() => {});
        }, 50);
      })
    );
    list.querySelectorAll(".btn-pay-receipts").forEach((btn) =>
      btn.addEventListener("click", () => {
        selectedPayrollId = btn.dataset.id;
        const p = contabilidadData.payrolls.find((x) => x.id === btn.dataset.id);
        if (p && halfSel) halfSel.value = String(p.half || 1);
        if (p && groupSel && p.group && PAYROLL_GROUP_META[p.group]) groupSel.value = p.group;
        const tandaSel = document.getElementById("contabPayrollMonoTanda");
        if (p && p.group === "monorriel" && tandaSel) {
          syncMonorrielTandaUi("monorriel");
          tandaSel.value = normalizeMonorrielTandaId(p.tanda);
        }
        renderNominaTab();
        setTimeout(() => printOpenPayrollReceipts(), 50);
      })
    );
    list.querySelectorAll(".btn-pay-paid").forEach((btn) =>
      btn.addEventListener("click", () => markPayrollPaid(btn.dataset.id))
    );
    list.querySelectorAll(".btn-pay-del").forEach((btn) =>
      btn.addEventListener("click", () => deletePayroll(btn.dataset.id))
    );
  }

  if (!detail) return;
  const period = getSelectedMonth();
  const half = getSelectedPayrollHalf();
  let p =
    contabilidadData.payrolls.find((x) => x.id === selectedPayrollId) ||
    findPayrollByGroup(period, half, group, monoTanda) ||
    rows[0];
  if (!p) {
    detail.innerHTML = payrollIsOffice({ group })
      ? `<p class="muted">Genera la nómina de Oficina (01–15 o 16–fin) para cargar los ${getOfficeStaffForPayroll().length} empleado(s): nombre, cédula, cargo y sueldo. Quincena = sueldo/2, SFS fijo RD$ ${OFFICE_PAYROLL_SFS}, con rifa. Sin días, unif, volao, comida, feriado ni horas extras.</p>`
      : group === "monorriel" && monoTandaMeta
        ? `<p class="muted">Tanda <strong>${escapeHtml(monoTandaMeta.label)}</strong> · ${
            getStaffForPayrollGroup("monorriel", monoTanda).length
          } persona(s) en el Excel. Pulsa <strong>Generar las 4 tandas</strong> (Día volao 850 / extras 1000·13d · Noche volao 900 / extras 1500·13d · Moto volao 1000 / extras manual).</p>`
      : `<p class="muted">Genera la nómina ${escapeHtml(
          meta.short
        )} para ver la tabla (mismo formato: días, sueldo, SFS, Unif/Rifa, volaos, extras, descuentos, depósito y redondeo).</p>`;
    renderPayrollBackupsPanel("");
    return;
  }
  selectedPayrollId = p.id;
  if (halfSel && !document.activeElement?.id?.includes("contabPayrollHalf")) {
    // keep user selection unless opening a different payroll
  }
  // Oficina: reglas propias + nombre corto (1 nombre + 1 apellido)
  if (payrollIsOffice(p)) {
    p.showFeriado = false;
    const officeStaffById = new Map();
    try {
      getOfficeStaffForPayroll().forEach((s) => {
        if (s.employeeId) officeStaffById.set(s.employeeId, s);
        if (s.id) officeStaffById.set(s.id, s);
      });
    } catch (_) {}
    let cleanedOffice = false;
    p.lines = (p.lines || []).map((l) => {
      const staff = officeStaffById.get(l.employeeId);
      const short = staff
        ? payrollShortEmployeeName(staff.name || staff.fullName)
        : payrollShortEmployeeName(l.fullName);
      let next = computePayrollLineTotals(
        {
          ...l,
          fullName: short || l.fullName,
          daysWorked: "",
          salaryQuincena: 0,
          sfs: OFFICE_PAYROLL_SFS,
          uniformes: 0,
          volaos: 0,
          almuerzo: 0,
          feriado: 0,
          horasExtras: 0,
          rifa: l.rifa != null && l.rifa !== "" ? l.rifa : OFFICE_PAYROLL_RIFA,
        },
        { office: true }
      );
      if (
        (short && short !== String(l.fullName || "").trim()) ||
        Number(l.salaryQuincena) !== Number(next.salaryQuincena) ||
        Number(l.sfs) !== Number(next.sfs) ||
        Number(l.uniformes) ||
        Number(l.volaos) ||
        Number(l.almuerzo) ||
        Number(l.feriado) ||
        Number(l.horasExtras) ||
        String(l.daysWorked || "") !== ""
      ) {
        cleanedOffice = true;
      }
      return next;
    });
    if (cleanedOffice) {
      p.updatedAt = new Date().toISOString();
      saveContabilidadData(true);
    }
  }
  // La Vega / Monorriel: nombre corto + uniforme 215→115; comida editable + Seg. vida 90
  if (payrollUsesLvaParams(p)) {
    const openFormulaOpts = payrollComputeOpts(p);
    const staffById = new Map();
    try {
      getLvaStaffForPayroll().forEach((s) => {
        if (s.employeeId) staffById.set(s.employeeId, s);
        if (s.id) staffById.set(s.id, s);
      });
    } catch (_) {}
    let cleaned = false;
    // v110 metió SVDA dentro de almuerzo (=90); una sola vez dejar comida en 0
    if (!p.svdaMealSplit) {
      p.lines = (p.lines || []).map((l) => {
        if (Number(l.almuerzo) === LVA_PAYROLL_SVDA) {
          cleaned = true;
          return { ...l, almuerzo: 0 };
        }
        return l;
      });
      p.svdaMealSplit = true;
      cleaned = true;
    }
    p.lines = (p.lines || []).map((l) => {
      let next = l;
      const staff = staffById.get(l.employeeId);
      const short = staff
        ? payrollShortEmployeeName(staff.name)
        : payrollShortEmployeeName(l.fullName);
      if (short && short !== String(l.fullName || "").trim()) {
        cleaned = true;
        next = { ...next, fullName: short };
      }
      if (Number(next.uniformes) === 215) {
        cleaned = true;
        next = computePayrollLineTotals(
          {
            ...next,
            uniformes: LVA_PAYROLL_UNIFORMES,
            rifa: Number(next.rifa) || LVA_PAYROLL_RIFA,
          },
          openFormulaOpts
        );
      } else {
        next = computePayrollLineTotals(next, openFormulaOpts);
      }
      return next;
    });
    if (cleaned) {
      p.updatedAt = new Date().toISOString();
      saveContabilidadData(true);
    }
  }
  // Monorriel: no reescribir Préstamos al abrir/renderizar (borra lo tecleado).
  // Usar el botón «Cargar préstamos» o regenerar la nómina para cuotas auto.
  const cols = getPayrollEditorCols(p);
  const formulaProfile = getPayrollFormulaProfile(p);
  const lines = p.lines || [];
  const namedCount = payrollLinesForTotals(lines).length;
  const reviewedCount = payrollLinesForTotals(lines).filter((l) => !!l.reviewed).length;
  const totals = {
    salaryMonthly: sumPayrollField(lines, "salaryMonthly"),
    salaryQuincena: sumPayrollField(lines, "salaryQuincena"),
    sfs: sumPayrollField(lines, "sfs"),
    uniformes: sumPayrollField(lines, "uniformes"),
    volaos: sumPayrollField(lines, "volaos"),
    incentivos: sumPayrollField(lines, "incentivos"),
    horasExtras: sumPayrollField(lines, "horasExtras"),
    feriado: sumPayrollField(lines, "feriado"),
    almuerzo: payrollUsesLvaParams(p)
      ? roundMoney2(payrollLinesForTotals(lines).reduce((acc, l) => acc + almuerzoSvdaAmount(l), 0))
      : sumPayrollField(lines, "almuerzo"),
    rifa: sumPayrollField(lines, "rifa"),
    adelantos: sumPayrollField(lines, "adelantos"),
    prestamos: sumPayrollField(lines, "prestamos"),
    totalDescuentos: sumPayrollField(lines, "totalDescuentos"),
    totalCobrar: sumPayrollField(lines, "totalCobrar"),
    salarioDepositar: sumPayrollField(lines, "salarioDepositar"),
    redondeo: sumPayrollField(lines, "redondeo"),
    unifRifa: roundMoney2(sumPayrollField(lines, "uniformes") + sumPayrollField(lines, "rifa")),
  };
  const head =
    cols
      .map(([key, label, kind]) => {
        let cls = "nomina-col-fit";
        if (key === "fullName") cls = "sticky-name";
        else if (key === "sfs") cls = "nomina-col-fit nomina-col-sfs";
        else if (key === "redondeo") cls = "nomina-col-fit nomina-col-redondeo";
        else if (kind === "days") cls = "nomina-col-fit nomina-col-days";
        const tip =
          key === "fullName"
            ? `${label} · casilla = revisado (solo edición, no sale en impresión)`
            : key === "daysWorked"
              ? `${label} · Ej. 13+2: quincena con 13 días; el +2 = RD$ ${formulaProfile.volaoPerExtraDay}×2 solo en Volaos`
              : key === "horasExtras"
                ? `${label} · Editable: pon el monto o 0 si no aplica.${
                    formulaProfile.autoExtrasFromDays
                      ? ` Auto (si no tocas): ${formulaProfile.extrasDaysBlock} días = RD$ ${formulaProfile.extrasFromDaysPay}.`
                      : ""
                  }`
                : key === "sfs"
                  ? `${label} · Editable: pon el monto o 0 si no lleva descuento de seguro`
                : kind === "almuerzoSvda"
                  ? `${label} · comida editable / Seguro de vida fijo RD$ ${LVA_PAYROLL_SVDA}`
                  : label;
        const headLabel =
          key === "fullName"
            ? `<span class="nomina-review-th" title="Revisado (no se imprime)" aria-hidden="true">☐</span> ${escapeHtml(label)}`
            : escapeHtml(label);
        return `<th class="${cls}" title="${escapeHtml(tip)}">${headLabel}</th>`;
      })
      .join("") +
    `<th class="nomina-col-del" title="Eliminar fila (no se imprime)">−</th>`;
  const body = lines
    .map((l, idx) => {
      const empty = !payrollLineHasEmployeeName(l);
      const manual = isManualPayrollLine(l);
      const tds = cols
        .map(([key, , kind]) => {
          if (key === "fullName") {
            const checked = l.reviewed ? " checked" : "";
            const manualTag = manual
              ? `<span class="nomina-manual-tag" title="Trato especial · sin fórmulas">M</span>`
              : "";
            return `<td class="sticky-name"><div class="nomina-name-cell">
              <label class="nomina-review-check" title="Marcar como revisado en esta nómina (no se imprime)">
                <input type="checkbox" data-f="reviewed"${checked} />
              </label>
              ${manualTag}
              <input class="nomina-inp nomina-inp-wide" data-f="fullName" type="text" value="${escapeHtml(
                String(l.fullName || "")
              )}" placeholder="${manual ? "Nombre (manual)" : ""}" />
            </div></td>`;
          }
          let fit = "nomina-col-fit";
          if (key === "sfs") fit += " nomina-col-sfs";
          if (key === "redondeo") fit += " nomina-col-redondeo";
          // Totales siempre RO; en filas manuales quincena/sfs/etc. ya vienen como num
          if (kind === "ro") {
            return `<td class="right ${fit}" data-ro="${key}">${escapeHtml(moneyCell(l[key]))}</td>`;
          }
          if (kind === "unifRifa") {
            return `<td class="${fit}"><input class="nomina-inp nomina-inp-unifrifa" data-f="unifRifa" type="text" inputmode="decimal" placeholder="115/85" value="${escapeHtml(
              formatUnifRifa(l)
            )}" title="Uniforme/Rifa (uniforme editable · rifa fija 85)" /></td>`;
          }
          if (kind === "almuerzoSvda") {
            return `<td class="${fit}"><input class="nomina-inp nomina-inp-unifrifa" data-f="almuerzoSvda" type="text" inputmode="decimal" placeholder="0/${LVA_PAYROLL_SVDA}" value="${escapeHtml(
              formatAlmuerzoSvda(l)
            )}" title="Comida editable / Seguro de vida fijo RD$ ${LVA_PAYROLL_SVDA} (ambas suman)" /></td>`;
          }
          const cls = kind === "days" ? "nomina-inp nomina-inp-days" : kind === "text" ? "nomina-inp nomina-inp-ced" : "nomina-inp";
          // SFS / horas extras: mostrar 0 si el usuario lo fijó (o el valor calculado)
          const val =
            key === "sfs" || key === "horasExtras"
              ? Number(l[key]) || 0
              : l[key] == null
                ? ""
                : l[key];
          const type = kind === "num" ? "number" : "text";
          const step = kind === "num" ? ' step="0.01" min="0"' : "";
          let title = "";
          if (manual && kind === "num") {
            title = ' title="Manual: escribe el monto (sin fórmula automática)"';
          } else if (key === "sfs") {
            title = ' title="Editable: pon el monto o 0 si no lleva seguro"';
          } else if (key === "horasExtras") {
            title = ' title="Editable: pon el monto o 0 si no lleva horas extras"';
          }
          return `<td class="${fit}"><input class="${cls}" data-f="${key}" type="${type}"${step}${title} value="${escapeHtml(
            String(val)
          )}" /></td>`;
        })
        .join("");
      const rowCls = [
        empty ? "nomina-row-empty" : "",
        !empty && l.reviewed ? "nomina-row-reviewed" : "",
        manual ? "nomina-row-manual" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<tr data-line-idx="${idx}" class="${rowCls}"${manual ? ' data-manual="1"' : ""}>${tds}<td class="nomina-col-del"><button type="button" class="btn-row-del" data-idx="${idx}" title="Eliminar fila" aria-label="Eliminar fila">−</button></td></tr>`;
    })
    .join("");
  const totalRow =
    cols
      .map(([key, , kind]) => {
        if (key === "daysWorked") return `<td class="nomina-col-fit"><strong>TOTAL</strong></td>`;
        if (key === "cedula") return `<td class="nomina-col-fit"></td>`;
        if (key === "fullName") return `<td class="sticky-name"></td>`;
        if (key === "unifRifa") {
          return `<td class="right nomina-col-fit" data-ro="unifRifa">${escapeHtml(moneyCell(totals.unifRifa))}</td>`;
        }
        if (kind === "almuerzoSvda") {
          return `<td class="right nomina-col-fit" data-ro="almuerzo">${escapeHtml(moneyCell(totals.almuerzo))}</td>`;
        }
        if (key === "redondeo") {
          return `<td class="right nomina-col-fit nomina-col-redondeo nomina-total-redondeo" data-ro="redondeo"><strong>${escapeHtml(
            moneyPlain(totals.redondeo || 0) || "0"
          )}</strong></td>`;
        }
        if (key === "sfs") {
          return `<td class="right nomina-col-fit nomina-col-sfs">${escapeHtml(moneyCell(totals.sfs))}</td>`;
        }
        return `<td class="right nomina-col-fit">${escapeHtml(moneyCell(totals[key]))}</td>`;
      })
      .join("") + `<td class="nomina-col-del"></td>`;
  const openMeta = payrollGroupMeta(
    p.group === "lavega" || (!p.group && String(p.note || "").toLowerCase().includes("vega"))
      ? "lavega"
      : p.group || getSelectedPayrollGroup()
  );
  const openTandaMeta = p.group === "monorriel" ? monorrielTandaMeta(p.tanda) : null;
  const openTitle =
    openTandaMeta ? `${openMeta.title} · ${openTandaMeta.label.toUpperCase()}` : openMeta.title;
  const exportPaper = getPayrollPaperForExport(p);
  const paperLabel = exportPaper === "letter" ? "Carta" : "Legal";
  const isOfficeOpen = payrollIsOffice(p);
  const extrasHelp = formulaProfile.autoExtrasFromDays
    ? `Horas extras: ${formulaProfile.extrasDaysBlock} días = RD$ ${formulaProfile.extrasFromDaysPay} (prorrateo).`
    : `Horas extras: manual.`;
  const loanAutoN = payrollLinesForTotals(lines).filter((l) => (Number(l.prestamos) || 0) > 0).length;
  const manualN = payrollLinesForTotals(lines).filter((l) => isManualPayrollLine(l)).length;
  const helpLine = isOfficeOpen
    ? `Pago ${escapeHtml(p.payDate || "—")} (depósito 5/20; corte 15/30) · ${
        p.status === "paid" ? "Pagada" : "Borrador"
      } · ${namedCount}/${lines.length} con nombre · ${reviewedCount} revisado(s). Casilla junto al nombre = revisado (solo edición). Nombre = 1 nombre + 1 apellido · Quincena = sueldo/2 · SFS RD$ ${OFFICE_PAYROLL_SFS}. Impresión ${paperLabel} horizontal.`
    : `Pago ${escapeHtml(p.payDate || "—")} (depósito días 5 y 20; corte de costos 15 y 30) · ${
        p.status === "paid" ? "Pagada" : "Borrador"
      } · ${namedCount}/${lines.length} con nombre · ${reviewedCount} revisado(s). Días "13+2": quincena solo con 13; el +N = RD$ ${formulaProfile.volaoPerExtraDay} c/u solo en Volaos. ${extrasHelp} Unif/Rifa 115/85.${
        payrollUsesLvaParams(p)
          ? ` Comida editable + Seguro de vida RD$ ${LVA_PAYROLL_SVDA}.`
          : ""
      } Usa «Cargar préstamos» para la cuota del pago ${escapeHtml((p.payDate || "").slice(8, 10) || "5/20")} (${loanAutoN} con cuota).${
        manualN ? ` ${manualN} fila(s) manual(es) sin fórmulas.` : " «＋ Manual» = trato especial sin fórmulas."
      } Feriado ${p.showFeriado ? "ON" : "OFF"}. Impresión centrada (${paperLabel}) sin cédula ni RD$.`;
  detail.innerHTML = `
    <h2>NOMINA REACTION · ${escapeHtml(openTitle)} · ${escapeHtml(halfLabel(p.half || 1).toUpperCase())} · ${escapeHtml(
      monthLabel(p.period).toUpperCase()
    )}</h2>
    <p class="muted tight">${helpLine}</p>
    ${
      isOfficeOpen
        ? ""
        : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 10px">
      <button type="button" class="btn secondary btn-sm" id="btnToggleFeriado" style="width:auto">${
        p.showFeriado ? "Ocultar feriado" : "Habilitar feriado"
      }</button>
    </div>`
    }
    <div class="nomina-table-wrap${isOfficeOpen ? " nomina-table-wrap-office" : ""}">
      <table class="nomina-table${isOfficeOpen ? " nomina-table-office" : ""}">
        <thead><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${cols.length + 1}">Sin líneas</td></tr>`}</tbody>
        <tfoot><tr class="nomina-total-row">${totalRow}</tr></tfoot>
      </table>
    </div>
    <p style="margin-top:12px" data-nomina-total-summary><strong>Total redondeo: ${escapeHtml(moneyRd(totals.redondeo))}</strong>
      <span class="muted"> · A depositar ${escapeHtml(moneyRd(totals.salarioDepositar))} · A cobrar ${escapeHtml(
        moneyRd(totals.totalCobrar)
      )} · ${namedCount} con nombre (auto)</span></p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:end">
      <label class="muted tight" style="margin:0">Hoja
        <select id="contabPayrollPaper2" style="display:block;margin-top:4px"${isOfficeOpen ? " disabled" : ""}>
          <option value="legal"${exportPaper === "legal" ? " selected" : ""}>Legal</option>
          <option value="letter"${exportPaper === "letter" ? " selected" : ""}>Carta</option>
        </select>
      </label>
      <button type="button" class="btn secondary" id="btnContabLoadLoans2" style="width:auto" title="Carga cuotas según pago día 5 o 20">Cargar préstamos</button>
      <button type="button" class="btn secondary" id="btnContabAddManual2" style="width:auto" title="Fila sin fórmulas (trato especial)">＋ Manual</button>
      ${
        payrollSupportsReceiptPrint(p)
          ? `<button type="button" class="btn primary" id="btnContabPrintReceipts2" style="width:auto" title="${escapeHtml(
              payrollReceiptPrinterHint(p)
            )}">Imprimir recibos</button>`
          : ""
      }
      <button type="button" class="btn secondary" id="btnContabPrintPayroll2" style="width:auto">Imprimir ↔</button>
      <button type="button" class="btn secondary" id="btnContabDownloadPayroll2" style="width:auto">Descargar PDF</button>
      <button type="button" class="btn secondary" id="btnContabSharePayroll2" style="width:auto">Compartir PDF</button>
      <button type="button" class="btn secondary" id="btnContabMailPayroll2" style="width:auto">Correo / Gmail</button>
    </div>`;
  document.querySelectorAll(".btn-row-del").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      removePayrollLineAt(btn.dataset.idx);
    });
  });
  document.getElementById("btnToggleFeriado")?.addEventListener("click", togglePayrollFeriado);
  document.getElementById("contabPayrollPaper2")?.addEventListener("change", (ev) => {
    const main = document.getElementById("contabPayrollPaper");
    if (main) main.value = ev.target.value;
  });
  document.getElementById("btnContabLoadLoans2")?.addEventListener("click", () => loadOpenPayrollLoans());
  document.getElementById("btnContabAddManual2")?.addEventListener("click", () => addManualPayrollRows());
  document.getElementById("btnContabPrintReceipts2")?.addEventListener("click", () => printOpenPayrollReceipts());
  document.getElementById("btnContabPrintPayroll2")?.addEventListener("click", () => printOpenPayrollSheet());
  document.getElementById("btnContabDownloadPayroll2")?.addEventListener("click", () => {
    downloadOpenPayrollPdf().catch(() => {});
  });
  document.getElementById("btnContabSharePayroll2")?.addEventListener("click", () => {
    shareOpenPayrollSheet().catch(() => {});
  });
  document.getElementById("btnContabMailPayroll2")?.addEventListener("click", () => {
    emailOpenPayrollPdf().catch(() => {});
  });
  const detailRoot = document.getElementById("contabPayrollDetail");
  if (detailRoot) detailRoot.dataset.liveBound = "";
  bindPayrollLiveTotals();
  renderPayrollBackupsPanel(selectedPayrollId);
}

function renderPayrollBackupsPanel(payrollId) {
  let box = document.getElementById("contabPayrollBackups");
  if (!box) {
    const host = document.getElementById("contabTabNomina");
    if (!host) return;
    box = document.createElement("div");
    box.id = "contabPayrollBackups";
    box.className = "form-card";
    host.appendChild(box);
  }
  const focusId = payrollId || selectedPayrollId || "";
  const related = focusId
    ? listPayrollBackups(focusId)
    : listPayrollBackups("").slice(0, 12);
  const allCount = (contabilidadData.payrollBackups || []).length;
  if (!related.length) {
    box.innerHTML = `<h2>Respaldos de nómina</h2>
      <p class="muted tight">Solo <strong>1 respaldo por nómina</strong> (se sobrescribe al guardar el mismo día). Total: ${allCount}.</p>
      <p class="empty" style="margin:8px 0 0">Sin respaldo${focusId ? " de esta nómina" : ""} todavía.</p>`;
    return;
  }
  box.innerHTML = `<h2>Respaldos de nómina</h2>
    <p class="muted tight">Última copia de cada nómina (${allCount}). Al guardar se actualiza el del día; no se acumulan versiones.</p>
    <div class="card-list" style="margin-top:8px">${related
      .map((b) => {
        const when = b.createdAt ? new Date(b.createdAt).toLocaleString("es") : "—";
        return `<article class="report-card">
          <h3 style="font-size:14px">${escapeHtml(b.label || b.payrollId)}</h3>
          <p class="muted">${escapeHtml(payrollBackupReasonLabel(b.reason))} · ${escapeHtml(when)}${
            b.createdBy ? ` · ${escapeHtml(b.createdBy)}` : ""
          }</p>
          <p><strong>${escapeHtml(moneyRd(b.totals && b.totals.redondeo))}</strong>
            <span class="muted"> · ${(b.totals && b.totals.lines) || 0} empleado(s)</span></p>
          <div class="row-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
            <button type="button" class="btn secondary btn-pay-restore" data-id="${escapeHtml(
              b.id
            )}" style="width:auto;padding:8px 12px;font-size:12px">Restaurar</button>
            <button type="button" class="btn danger btn-pay-delete-backup" data-id="${escapeHtml(
              b.id
            )}" style="width:auto;padding:8px 12px;font-size:12px">Eliminar</button>
          </div>
        </article>`;
      })
      .join("")}</div>`;
  box.querySelectorAll(".btn-pay-restore").forEach((btn) => {
    btn.addEventListener("click", () => restorePayrollFromBackup(btn.dataset.id));
  });
  box.querySelectorAll(".btn-pay-delete-backup").forEach((btn) => {
    btn.addEventListener("click", () => deletePayrollBackup(btn.dataset.id));
  });
}

function renderContabilidadModule() {
  if (!canAccessContabilidad()) return;
  try {
    if (recoverLavegaOctPayrollIfEmpty()) {
      saveContabilidadData(true);
      toast("Nómina La Vega 01–15 oct restaurada desde PDF (17 empleados · RD$ 216,350).");
    }
  } catch (_) {}
  ensureMonthFilter();
  const summary = document.getElementById("contabSummary");
  if (summary) {
    summary.textContent = `${monthLabel(getSelectedMonth())} · Gastos con NCF, ITBIS cobrado, liquidación DGII y personal de oficina.`;
  }
  if (contabTab === "gastos") renderExpensesTab();
  else if (contabTab === "itbis") renderItbisTab();
  else if (contabTab === "liquidacion") renderLiquidacionTab();
  else if (contabTab === "oficina") renderOficinaTab();
}

function onItbisBaseOrTotalInput() {
  const baseEl = document.getElementById("itcBase");
  const itbisEl = document.getElementById("itcItbis");
  const totalEl = document.getElementById("itcTotal");
  if (!baseEl || !itbisEl || !totalEl) return;
  const base = Math.max(0, Number(baseEl.value) || 0);
  if (base > 0 && document.activeElement === baseEl) {
    const itbis = Math.round(base * ITBIS_RATE * 100) / 100;
    itbisEl.value = String(itbis);
    totalEl.value = String(Math.round((base + itbis) * 100) / 100);
  }
}

function onExpenseAmountInput() {
  const amountEl = document.getElementById("cfeAmount");
  const itbisEl = document.getElementById("cfeItbis");
  if (!amountEl || !itbisEl) return;
  if (document.activeElement !== amountEl) return;
  const amount = Math.max(0, Number(amountEl.value) || 0);
  if (!amount) return;
  if (itbisEl.value && Number(itbisEl.value) > 0) return;
  const itbis = Math.round((amount - amount / (1 + ITBIS_RATE)) * 100) / 100;
  itbisEl.value = String(itbis);
}

function bindContabilidadUi() {
  document.querySelectorAll(".contab-tabs .emp-tab").forEach((btn) => {
    btn.addEventListener("click", () => setContabTab(btn.dataset.contabTab));
  });
  document.getElementById("contabMonthFilter")?.addEventListener("change", () => {
    const n = document.getElementById("nominaMonthFilter");
    const cEl = document.getElementById("contabMonthFilter");
    if (n && cEl) n.value = cEl.value;
    renderContabilidadModule();
  });
  document.getElementById("nominaMonthFilter")?.addEventListener("change", () => {
    const n = document.getElementById("nominaMonthFilter");
    const cEl = document.getElementById("contabMonthFilter");
    if (n && cEl) cEl.value = n.value;
    renderNominaModule();
  });
  document.getElementById("btnCfeSave")?.addEventListener("click", saveExpenseFromForm);
  document.getElementById("btnCfeClear")?.addEventListener("click", clearExpenseForm);
  document.getElementById("cfeAmount")?.addEventListener("input", onExpenseAmountInput);
  document.getElementById("btnItcSave")?.addEventListener("click", saveItbisFromForm);
  document.getElementById("btnItcClear")?.addEventListener("click", clearItbisForm);
  document.getElementById("itcBase")?.addEventListener("input", onItbisBaseOrTotalInput);
  document.getElementById("btnOempSave")?.addEventListener("click", saveOfficeEmpFromForm);
  document.getElementById("btnOempClear")?.addEventListener("click", clearOfficeEmpForm);
  document.getElementById("btnOempGenPayroll")?.addEventListener("click", () => {
    const groupSel = document.getElementById("contabPayrollGroup");
    if (groupSel) groupSel.value = "oficina";
    // Misma lógica quincenal (01–15 / 16–fin); por defecto la quincena seleccionada o 01–15
    const halfSel = document.getElementById("contabPayrollHalf");
    if (halfSel && !halfSel.value) halfSel.value = "1";
    generateOfficePayroll();
  });
  document.getElementById("btnContabGenPayroll")?.addEventListener("click", generateOfficePayroll);
  document.getElementById("btnContabGenMonoTandas")?.addEventListener("click", generateAllMonorrielTandas);
  document.getElementById("btnContabFeedMonoDays")?.addEventListener("click", () => {
    const r = feedMonorrielPayrollDaysFromReports({
      period: getSelectedMonth(),
      quiet: false,
      createMissing: true,
      // Ambos cortes del mes + mes siguiente (nov, etc.)
    });
    renderNominaTab();
    if (!(r && r.updated)) toast("No había días nuevos que actualizar desde reportes.");
  });
  document.getElementById("btnContabLoadLoans")?.addEventListener("click", loadOpenPayrollLoans);
  document.getElementById("btnContabSavePayroll")?.addEventListener("click", saveOpenPayrollEdits);
  document.getElementById("btnContabAddRows")?.addEventListener("click", addBlankPayrollRows);
  document.getElementById("btnContabAddManualRows")?.addEventListener("click", addManualPayrollRows);
  document.getElementById("btnContabPrintReceipts")?.addEventListener("click", () => printOpenPayrollReceipts());
  document.getElementById("btnContabPrintPayroll")?.addEventListener("click", () => printOpenPayrollSheet());
  document.getElementById("btnContabDownloadPayroll")?.addEventListener("click", () => {
    downloadOpenPayrollPdf().catch(() => {});
  });
  document.getElementById("btnContabSharePayroll")?.addEventListener("click", () => {
    shareOpenPayrollSheet().catch(() => {});
  });
  document.getElementById("btnContabMailPayroll")?.addEventListener("click", () => {
    emailOpenPayrollPdf().catch(() => {});
  });
  document.getElementById("contabPayrollGroup")?.addEventListener("change", () => {
    const period = getSelectedMonth();
    const half = getSelectedPayrollHalf();
    const group = getSelectedPayrollGroup();
    syncPayrollPaperUiForGroup(group);
    syncMonorrielTandaUi(group);
    const tanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
    const found = findPayrollByGroup(period, half, group, tanda);
    selectedPayrollId = found ? found.id : "";
    renderNominaTab();
  });
  document.getElementById("contabPayrollMonoTanda")?.addEventListener("change", () => {
    const period = getSelectedMonth();
    const half = getSelectedPayrollHalf();
    const group = getSelectedPayrollGroup();
    const tanda = getSelectedMonorrielTanda();
    const found = findPayrollByGroup(period, half, group, tanda);
    selectedPayrollId = found ? found.id : "";
    renderNominaTab();
  });
  document.getElementById("contabPayrollHalf")?.addEventListener("change", () => {
    const period = getSelectedMonth();
    const half = getSelectedPayrollHalf();
    const group = getSelectedPayrollGroup();
    const tanda = group === "monorriel" ? getSelectedMonorrielTanda() : "";
    const found = findPayrollByGroup(period, half, group, tanda);
    selectedPayrollId = found ? found.id : selectedPayrollId;
    renderNominaTab();
  });
  document.getElementById("contabPayrollPaper")?.addEventListener("change", () => {
    const detailPaper = document.getElementById("contabPayrollPaper2");
    const main = document.getElementById("contabPayrollPaper");
    if (detailPaper && main) detailPaper.value = main.value;
  });
  document.getElementById("cfeRnc")?.addEventListener("input", (e) => {
    e.target.value = String(e.target.value || "").replace(/\D/g, "").slice(0, 11);
  });
  document.getElementById("oempCedula")?.addEventListener("input", (e) => {
    e.target.value = String(e.target.value || "").replace(/\D/g, "").slice(0, 11);
  });
  clearExpenseForm();
  clearItbisForm();
  clearOfficeEmpForm();
}

/* ==== FIN CONTABILIDAD ==== */
