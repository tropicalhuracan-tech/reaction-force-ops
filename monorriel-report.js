/**
 * Reporte Monorriel con el mismo cuadro de quincena que Ramón Vargas.
 * Cuatro planillas: empleados día, empleados noche, motorizados día, motorizados noche.
 * Marca 1 = un día. Marca 2 = un día + volao de esa planilla. Día 31 se ve y no cuenta.
 * Todos cobran en efectivo: aquí no hay B/E. Los préstamos se cargan en la nómina.
 */
const MONOQ_KEY = "rfs-ops-monorriel-quincenas";
const MONOQ_SAFETY_KEY = "rfs-ops-monoq-payroll-safety";
const MONOQ_MANUAL_BACKUP_KEY = "rfs-ops-monoq-manual-backups";
const MONOQ_MANUAL_BACKUP_MAX = 12;
const MONOQ_UNDO_KEY = "rfs-ops-monoq-undo-stack";
const MONOQ_UNDO_MAX = 40;
let monoQUndoStack = [];
let monoQMemoColorPick = "yellow";
let monoQMemoPaintOn = false;

function monoQMemoTools() {
  return typeof window !== "undefined" ? window.RFSReportCells : null;
}

function setMonoQCellMemo(empIdx, fieldKey, colorId) {
  const current = monoQActive();
  const sheet = current && current.sheets[monoQSheet];
  const emp = sheet && sheet.employees && sheet.employees[empIdx];
  if (!emp) return false;
  const tools = monoQMemoTools();
  if (!tools) return false;
  monoQPushUndo("color");
  emp.memoColors = tools.normalizeMemoColors(emp.memoColors);
  const key = String(fieldKey || "").trim();
  if (!key) return false;
  const id = String(colorId || "").trim();
  if (!id) delete emp.memoColors[key];
  else if (tools.memoById(id)) emp.memoColors[key] = id;
  if (!Object.keys(emp.memoColors).length) delete emp.memoColors;
  current.updatedAt = new Date().toISOString();
  monoQSave(true);
  return true;
}

function monoQApplyPasteToCell(cell, text) {
  const raw = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  const field = cell.getAttribute("data-memo-field") || "";
  const idx = Number(cell.getAttribute("data-i"));
  const current = monoQActive();
  const sheet = current && current.sheets[monoQSheet];
  const emp = sheet && sheet.employees[idx];
  if (!emp) return;
  if (field.startsWith("d:")) {
    monoQSetMark(emp, field.slice(2), raw);
    current.updatedAt = new Date().toISOString();
    monoQSave(true);
    cell.textContent = raw;
    return;
  }
  if (field === "name") {
    if (!raw) return;
    emp.fullName = raw;
    emp.nameManual = true;
    emp.nameEditedAt = new Date().toISOString();
    current.updatedAt = emp.nameEditedAt;
    monoQSave(true);
    cell.textContent = raw;
    return;
  }
  if (field === "post") {
    emp.position = raw;
    current.updatedAt = new Date().toISOString();
    monoQSave(true);
    cell.textContent = raw;
    return;
  }
  if (field === "pagos") {
    emp.volaosPagos = monoQPagos(raw);
    cell.textContent = emp.volaosPagos === "" ? "" : String(emp.volaosPagos);
    current.updatedAt = new Date().toISOString();
    monoQSave(true);
    return;
  }
  if (field === "horas") {
    emp.horasExtras = monoQHoras(raw);
    cell.textContent = emp.horasExtras ? String(emp.horasExtras) : "";
    current.updatedAt = new Date().toISOString();
    monoQSave(true);
  }
}
const MONOQ_ACTIVE_KEY = "rfs-ops-monorriel-quincena-active";
const MONOQ_SHEETS = [
  { id: "dia", label: "Empleados día", volao: 850 },
  { id: "noche", label: "Empleados noche", volao: 900 },
  { id: "moto_dia", label: "Motorizados día", volao: 1000 },
  { id: "moto_noche", label: "Motorizados noche", volao: 1000 },
];
const MONOQ_MOTO_POSTS = { m24: 1, m25: 1, m26: 1 };

let monoQData = { reports: [] };
let monoQActiveId = "";
let monoQSheet = "dia";

function monoQEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Clave de borrado por fila (no por nombre solo). */
function monoQEmployeeDeleteKey(emp) {
  const id = String((emp && emp.employeeId) || "").trim();
  if (id) return `id:${id}`;
  const nk = monoQKey(emp && emp.fullName);
  const pos = monoQKey(emp && emp.position);
  const fp = monoQMarksFingerprint(emp);
  return `row:${nk}|${pos}|${fp || "0"}`;
}

function monoQEnsureRowId(emp) {
  if (!emp || typeof emp !== "object") return "";
  if (String(emp.rowId || "").trim()) return String(emp.rowId).trim();
  emp.rowId = `mq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  return emp.rowId;
}

function monoQFindEmployee(sheet, el) {
  if (!sheet || !el) return null;
  const rid = el.getAttribute && el.getAttribute("data-row-id");
  if (rid) {
    const hit = (sheet.employees || []).find((e) => e && String(e.rowId || "") === rid);
    if (hit) return hit;
  }
  const idx = Number(el.getAttribute("data-i"));
  if (Number.isFinite(idx) && idx >= 0) return (sheet.employees || [])[idx] || null;
  return null;
}

function monoQKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function monoQDaysInMonth(period) {
  const [y, m] = String(period || "").split("-").map((n) => Number(n));
  if (!y || !m) return 30;
  return new Date(y, m, 0).getDate();
}

function monoQSpec(period, half) {
  const h = half === 2 || half === "2" ? 2 : 1;
  const per = String(period || "").slice(0, 7);
  const [y, m] = per.split("-").map((n) => Number(n));
  const last = monoQDaysInMonth(per);
  const start = h === 1 ? 1 : 16;
  const end = h === 1 ? 15 : last;
  const dayNums = [];
  for (let d = start; d <= end; d += 1) dayNums.push(d);
  const mm = String(m).padStart(2, "0");
  return {
    id: `monoq-${per}-h${h}`,
    period: per,
    half: h,
    label: `DESDE ${start} AL ${end}/${mm}/${y}`,
    dayNums,
  };
}

function monoQTitle(report) {
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

function monoQRoster(sheetId) {
  const root = typeof window !== "undefined" ? window.RFS_MONORRIEL : null;
  const list = root && Array.isArray(root.payrollTandas) ? root.payrollTandas : [];
  const tanda = list.find((t) => t && t.id === sheetId);
  return (tanda && tanda.roster) || [];
}

function monoQEmptySheets() {
  const sheets = {};
  MONOQ_SHEETS.forEach((s) => {
    const seen = new Set();
    const employees = [];
    monoQRoster(s.id).forEach((person) => {
      const fullName = String((person && person.name) || "").trim();
      const key = monoQKey(fullName);
      if (!key || seen.has(key)) return;
      seen.add(key);
      employees.push({
        fullName,
        employeeId: String((person && (person.employeeId || person.id)) || ""),
        position: String((person && person.position) || "").trim(),
        marks: {},
        volaosPagos: "",
        horasExtras: 0,
      });
    });
    employees.sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
    sheets[s.id] = { employees, deletedKeys: [] };
  });
  return sheets;
}

function monoQSheetDeleted(rawSheet) {
  return Array.isArray(rawSheet && rawSheet.deletedKeys)
    ? rawSheet.deletedKeys.map((k) => String(k || "").trim()).filter(Boolean)
    : [];
}

function monoQMarksFingerprint(emp) {
  const m = (emp && emp.marks) || {};
  const parts = Object.keys(m)
    .sort((a, b) => Number(a) - Number(b))
    .filter((d) => Number(m[d]) > 0)
    .map((d) => `${d}:${m[d]}`);
  return parts.length ? parts.join("|") : "";
}

function monoQMarkOverlapScore(a, b) {
  let n = 0;
  const ma = (a && a.marks) || {};
  const mb = (b && b.marks) || {};
  Object.keys(ma).forEach((d) => {
    if (Number(ma[d]) > 0 && Number(mb[d]) > 0) n += 1;
  });
  if (n >= 4) return 72;
  if (n >= 2) return 58;
  return 0;
}

function monoQEmpMatchScore(a, b) {
  if (!a || !b) return 0;
  const idA = String(a.employeeId || "").trim();
  const idB = String(b.employeeId || "").trim();
  if (idA && idB && idA === idB) return 100;
  const nkA = monoQKey(a.fullName);
  const nkB = monoQKey(b.fullName);
  if (nkA && nkA === nkB) return 80;
  const fa = monoQMarksFingerprint(a);
  const fb = monoQMarksFingerprint(b);
  if (fa && fa === fb) return 60;
  return monoQMarkOverlapScore(a, b);
}

function monoQFindBestMatch(emp, list, taken) {
  let best = null;
  let bestIdx = -1;
  let bestScore = 0;
  (list || []).forEach((other, idx) => {
    if (taken && taken.has(idx)) return;
    const score = monoQEmpMatchScore(emp, other);
    if (score > bestScore) {
      bestScore = score;
      best = other;
      bestIdx = idx;
    }
  });
  if (!best || bestScore < 60) return null;
  return { emp: best, idx: bestIdx, score: bestScore };
}

function mergeMonoEmployeeFields(winner, loser) {
  if (!winner || !loser) return;
  Object.keys(loser.marks || {}).forEach((d) => {
    const n = monoQParseMarkNumber(loser.marks[d]);
    if (!(n > 0)) return;
    const prev = monoQParseMarkNumber(winner.marks && winner.marks[d]) || 0;
    if (!winner.marks) winner.marks = {};
    if (n === 2 || prev === 2) winner.marks[d] = 2;
    else winner.marks[d] = Math.max(n, prev);
  });
  if (loser.nameManual) {
    if (!winner.nameManual || String(loser.nameEditedAt || "") > String(winner.nameEditedAt || "")) {
      winner.fullName = String(loser.fullName || "").trim() || winner.fullName;
      winner.nameManual = true;
      winner.nameEditedAt = loser.nameEditedAt || winner.nameEditedAt;
    }
  } else if (!winner.nameManual && String(loser.fullName || "").trim().length > String(winner.fullName || "").trim().length) {
    winner.fullName = String(loser.fullName || "").trim();
  }
  if (!winner.employeeId && loser.employeeId) winner.employeeId = String(loser.employeeId);
  if (!winner.position && loser.position) winner.position = String(loser.position).trim();
  if (!winner.volaosPagos && loser.volaosPagos) winner.volaosPagos = monoQPagos(loser.volaosPagos);
  if (!(Number(winner.horasExtras) > 0) && Number(loser.horasExtras) > 0) {
    winner.horasExtras = monoQHoras(loser.horasExtras);
  }
  const tools = monoQMemoTools();
  if (tools) tools.mergeEmployeeMemoColors(winner, loser);
}

function mergeMonoSheetSticky(baseSheet, otherSheet) {
  const deleted = new Set([...monoQSheetDeleted(baseSheet), ...monoQSheetDeleted(otherSheet)]);
  const out = ((baseSheet && baseSheet.employees) || []).map((e) => ({
    ...e,
    marks: { ...(e.marks || {}) },
  }));
  const taken = new Set();
  out.forEach((emp) => {
    const hit = monoQFindBestMatch(emp, (otherSheet && otherSheet.employees) || [], taken);
    if (!hit) return;
    taken.add(hit.idx);
    mergeMonoEmployeeFields(emp, hit.emp);
  });
  ((otherSheet && otherSheet.employees) || []).forEach((otherEmp, oi) => {
    if (taken.has(oi)) return;
    const rowKey = monoQEmployeeDeleteKey(otherEmp);
    const id = String(otherEmp.employeeId || "").trim();
    if (rowKey && deleted.has(rowKey)) return;
    if (id && deleted.has(`id:${id}`)) return;
    const legacy = monoQKey(otherEmp.fullName);
    if (legacy && deleted.has(legacy) && !monoQFindBestMatch(otherEmp, out)) return;
    if (monoQFindBestMatch(otherEmp, out)) return;
    const hasMarks = Object.keys(otherEmp.marks || {}).some((d) => Number(otherEmp.marks[d]) > 0);
    if (!hasMarks && !otherEmp.nameManual && !(Number(otherEmp.horasExtras) > 0)) return;
    out.push({
      ...otherEmp,
      marks: { ...(otherEmp.marks || {}) },
    });
  });
  const kept = out.filter((emp) => {
    const rowKey = monoQEmployeeDeleteKey(emp);
    const id = String(emp.employeeId || "").trim();
    if (rowKey && deleted.has(rowKey)) return false;
    if (id && deleted.has(`id:${id}`)) return false;
    return true;
  });
  return { employees: kept, deletedKeys: [...deleted] };
}

function mergeMonoReportSticky(base, other) {
  if (!base) return monoQNormalizeReport(other);
  if (!other) return monoQNormalizeReport(base);
  const sheets = {};
  MONOQ_SHEETS.forEach((s) => {
    sheets[s.id] = mergeMonoSheetSticky(base.sheets && base.sheets[s.id], other.sheets && other.sheets[s.id]);
  });
  const updatedAt =
    String(base.updatedAt || "") >= String(other.updatedAt || "") ? base.updatedAt : other.updatedAt;
  return monoQNormalizeReport({
    ...base,
    sheets,
    removedNameKeys: [
      ...new Set([...(base.removedNameKeys || []), ...(other.removedNameKeys || [])]),
    ],
    updatedAt,
  });
}

function monoQNormalizeReport(raw) {
  const spec = monoQSpec(raw && raw.period, raw && raw.half);
  const seed = !(raw && raw.sheets);
  const sheets = seed ? monoQEmptySheets() : {};
  MONOQ_SHEETS.forEach((s) => {
    if (!sheets[s.id]) {
      sheets[s.id] = {
        employees: [],
        deletedKeys: monoQSheetDeleted(raw && raw.sheets && raw.sheets[s.id]),
      };
    }
    const src = raw && raw.sheets && raw.sheets[s.id] && raw.sheets[s.id].employees;
    const seen = new Set((sheets[s.id].employees || []).map((e) => monoQKey(e.fullName)));
    const deleted = new Set(monoQSheetDeleted(sheets[s.id]));
    const removedNames = new Set(
      (Array.isArray(raw && raw.removedNameKeys) ? raw.removedNameKeys : []).map((k) => String(k || "").trim())
    );
    (src || []).forEach((emp) => {
      const fullName = String((emp && emp.fullName) || "").trim();
      const key = monoQKey(fullName);
      if (!key) return;
      if (removedNames.has(key)) return;
      if (deleted.has(key)) return;
      const eid = String((emp && emp.employeeId) || "").trim();
      const rowKey = monoQEmployeeDeleteKey(emp);
      if (rowKey && deleted.has(rowKey)) return;
      if (eid && deleted.has(`id:${eid}`)) return;
      const marks = emp && emp.marks && typeof emp.marks === "object" ? { ...emp.marks } : {};
      const existing = (sheets[s.id].employees || []).find((e) => monoQKey(e.fullName) === key);
      if (existing) {
        Object.keys(marks).forEach((d) => {
          const n = monoQParseMarkNumber(marks[d]);
          if (!(n > 0)) return;
          const prev = monoQParseMarkNumber(existing.marks[d]) || 0;
          if (!existing.marks) existing.marks = {};
          if (n === 2 || prev === 2) existing.marks[d] = 2;
          else existing.marks[d] = Math.max(n, prev);
        });
        if (!existing.employeeId && emp.employeeId) existing.employeeId = String(emp.employeeId);
        if (!existing.position && emp.position) existing.position = String(emp.position).trim();
        if (!existing.volaosPagos && emp.volaosPagos) existing.volaosPagos = monoQPagos(emp.volaosPagos);
        if (!(Number(existing.horasExtras) > 0) && Number(emp.horasExtras) > 0) {
          existing.horasExtras = monoQHoras(emp.horasExtras);
        }
        if (emp.nameManual) {
          existing.fullName = fullName;
          existing.nameManual = true;
          existing.nameEditedAt = emp.nameEditedAt || existing.nameEditedAt;
        }
        return;
      }
      if (seen.has(key)) return;
      seen.add(key);
      const rowId =
        String((emp && emp.rowId) || "").trim() ||
        `mq-${monoQKey(fullName) || "x"}-${Math.random().toString(36).slice(2, 8)}`;
      sheets[s.id].employees.push({
        rowId,
        fullName,
        employeeId: String((emp && emp.employeeId) || ""),
        position: String((emp && emp.position) || "").trim(),
        marks,
        volaosPagos: monoQPagos(emp && emp.volaosPagos),
        horasExtras: monoQHoras(emp && emp.horasExtras),
        nameManual: !!emp.nameManual,
        nameEditedAt: emp.nameEditedAt || "",
        memoColors: monoQMemoTools() ? monoQMemoTools().normalizeMemoColors(emp.memoColors) : {},
      });
    });
    sheets[s.id].deletedKeys = [...new Set(monoQSheetDeleted(sheets[s.id]))];
  });
  return {
    ...spec,
    sheets,
    removedNameKeys: Array.isArray(raw && raw.removedNameKeys)
      ? [...new Set(raw.removedNameKeys.map((k) => String(k || "").trim()).filter(Boolean))]
      : [],
    updatedAt: (raw && raw.updatedAt) || new Date().toISOString(),
  };
}

function monoQSheetOf(postId, shift) {
  const moto = !!MONOQ_MOTO_POSTS[String(postId || "")];
  const night = shift === "pm";
  if (moto) return night ? "moto_noche" : "moto_dia";
  return night ? "noche" : "dia";
}

function monoQFindEmp(list, name) {
  const key = monoQKey(name);
  if (!key) return null;
  return (list || []).find((e) => monoQKey(e.fullName) === key) || null;
}

/** Pasa los reportes diarios viejos al cuadro de quincena. No borra un día ya marcado. */
function buildMonorrielQuincenasFromDaily(dailyReports) {
  const byId = new Map();
  (dailyReports || []).forEach((report) => {
    const date = String((report && report.date) || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const period = date.slice(0, 7);
    const day = Number(date.slice(8, 10));
    if (!day) return;
    const half = day <= 15 ? 1 : 2;
    const spec = monoQSpec(period, half);
    if (!byId.has(spec.id)) byId.set(spec.id, monoQNormalizeReport(spec));
    const dest = byId.get(spec.id);
    const shift = report.shift === "pm" ? "pm" : "am";
    (report.assignments || []).forEach((a) => {
      const fullName = String((a && a.employeeName) || "").replace(/\s+/g, " ").trim();
      if (!fullName) return;
      const sheetId = monoQSheetOf(a.postId, shift);
      const sheet = dest.sheets[sheetId];
      if (!sheet) return;
      let emp = monoQFindEmp(sheet.employees, fullName);
      if (!emp) {
        emp = {
          fullName,
          employeeId: String((a && a.employeeId) || ""),
          position: "",
          marks: {},
          volaosPagos: "",
          horasExtras: 0,
        };
        sheet.employees.push(emp);
      } else if (!emp.employeeId && a.employeeId) {
        emp.employeeId = String(a.employeeId);
      }
      const prev = Number(emp.marks[String(day)]) || 0;
      if (prev !== 2) emp.marks[String(day)] = 1;
    });
  });
  const reports = [...byId.values()];
  reports.forEach((r) => {
    MONOQ_SHEETS.forEach((s) => {
      r.sheets[s.id].employees.sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
    });
  });
  reports.sort((a, b) => String(b.period).localeCompare(String(a.period)) || (b.half || 1) - (a.half || 1));
  return { reports };
}

function monoQReportMarkScore(report) {
  let n = 0;
  MONOQ_SHEETS.forEach((s) => {
    const list = (report && report.sheets && report.sheets[s.id] && report.sheets[s.id].employees) || [];
    list.forEach((emp) => {
      Object.keys(emp.marks || {}).forEach((d) => {
        if (Number(emp.marks[d]) > 0) n += 1;
      });
    });
  });
  return n;
}

function monoQDataMarkScore(data) {
  const reports = data && Array.isArray(data.reports) ? data.reports : [];
  return reports.reduce((s, r) => s + monoQReportMarkScore(r), 0);
}

function monoQLoadUndoStack() {
  if (monoQUndoStack.length) return;
  try {
    const raw = JSON.parse(sessionStorage.getItem(MONOQ_UNDO_KEY) || "[]");
    if (Array.isArray(raw)) monoQUndoStack = raw;
  } catch (_) {}
}

function monoQPersistUndoStack() {
  try {
    while (monoQUndoStack.length > MONOQ_UNDO_MAX) monoQUndoStack.shift();
    sessionStorage.setItem(MONOQ_UNDO_KEY, JSON.stringify(monoQUndoStack));
  } catch (_) {}
}

function monoQPushUndo(tag) {
  ensureMonorrielQuincenasLoaded();
  monoQLoadUndoStack();
  const snap = {
    at: Date.now(),
    tag: String(tag || "edit").slice(0, 24),
    reports: JSON.parse(JSON.stringify(monoQData.reports || [])),
    activeReportId: monoQActiveId,
    activeSheet: monoQSheet,
  };
  const prev = monoQUndoStack[monoQUndoStack.length - 1];
  if (prev && JSON.stringify(prev.reports) === JSON.stringify(snap.reports)) return;
  monoQUndoStack.push(snap);
  monoQPersistUndoStack();
}

function undoMonoQStep() {
  monoQLoadUndoStack();
  if (!monoQUndoStack.length) {
    if (typeof toast === "function") toast("Nada que deshacer (Ctrl+Z).");
    return { ok: false };
  }
  const snap = monoQUndoStack.pop();
  monoQPersistUndoStack();
  ensureMonorrielQuincenasLoaded();
  monoQData = { reports: JSON.parse(JSON.stringify(snap.reports || [])), _ready: true };
  monoQData.reports = (monoQData.reports || []).map((r) => monoQNormalizeReport(r));
  if (snap.activeReportId) monoQActiveId = snap.activeReportId;
  if (snap.activeSheet) monoQSheet = snap.activeSheet;
  monoQSave(true);
  try {
    if (typeof flushCloudSave === "function") flushCloudSave();
  } catch (_) {}
  renderMonorrielQuincenaModule();
  if (typeof toast === "function") toast("Deshecho · Ctrl+Z");
  return { ok: true };
}

function monoQBindUndoOnFocus(cell, tag) {
  if (!cell || cell.dataset.monoqUndoBound) return;
  cell.dataset.monoqUndoBound = "1";
  cell.addEventListener("focus", () => {
    if (cell.dataset.monoqUndoSnap) return;
    monoQPushUndo(tag || "celda");
    cell.dataset.monoqUndoSnap = "1";
  });
  cell.addEventListener(
    "blur",
    () => {
      delete cell.dataset.monoqUndoSnap;
    },
    true
  );
}

function pushMonoQManualBackup(reason) {
  ensureMonorrielQuincenasLoaded();
  const snapshot = {
    at: new Date().toISOString(),
    reason: String(reason || "manual").slice(0, 40),
    reports: JSON.parse(JSON.stringify(monoQData.reports || [])),
    activeReportId: monoQActiveId,
    activeSheet: monoQSheet,
  };
  try {
    const raw = JSON.parse(localStorage.getItem(MONOQ_MANUAL_BACKUP_KEY) || "[]");
    const list = Array.isArray(raw) ? raw : [];
    list.unshift(snapshot);
    while (list.length > MONOQ_MANUAL_BACKUP_MAX) list.pop();
    localStorage.setItem(MONOQ_MANUAL_BACKUP_KEY, JSON.stringify(list));
    return { ok: true, at: snapshot.at, count: list.length };
  } catch (_) {
    return { ok: false };
  }
}

function restoreMonoQFromStoredBackup() {
  let backup = null;
  try {
    const list = JSON.parse(localStorage.getItem(MONOQ_MANUAL_BACKUP_KEY) || "[]");
    if (Array.isArray(list) && list.length) backup = list[0];
  } catch (_) {}
  if (!backup) {
    try {
      const safety = JSON.parse(localStorage.getItem(MONOQ_SAFETY_KEY) || "null");
      if (safety && Array.isArray(safety.reports) && safety.reports.length) {
        backup = { at: "safety", reports: safety.reports };
      }
    } catch (_) {}
  }
  if (!backup || !backup.reports || !backup.reports.length) return { ok: false, reason: "no-backup" };
  ensureMonorrielQuincenasLoaded();
  const before = monoQDataMarkScore(monoQData);
  monoQData = monoQMerge(monoQData, { reports: backup.reports });
  monoQData._ready = true;
  monoQData.reports = (monoQData.reports || []).map((r) => monoQNormalizeReport(r));
  const after = monoQDataMarkScore(monoQData);
  if (backup.activeReportId && monoQData.reports.some((r) => r && r.id === backup.activeReportId)) {
    monoQActiveId = backup.activeReportId;
  }
  if (backup.activeSheet) monoQSheet = backup.activeSheet;
  monoQSave(true);
  try {
    if (typeof flushCloudSave === "function") flushCloudSave();
  } catch (_) {}
  return { ok: true, at: backup.at, gained: Math.max(0, after - before) };
}

function guardarMonoQRespaldo() {
  pushMonoQManualBackup("guardar");
  persistMonoQSafetyNet(monoQData);
  monoQSave(true);
  try {
    if (typeof flushCloudSave === "function") flushCloudSave();
  } catch (_) {}
  return { ok: true };
}

function monoQReportBanScore(report) {
  if (!report) return 0;
  let n = Array.isArray(report.removedNameKeys) ? report.removedNameKeys.length : 0;
  MONOQ_SHEETS.forEach((s) => {
    const sh = report.sheets && report.sheets[s.id];
    n += monoQSheetDeleted(sh).length;
  });
  return n;
}

function monoQDataBanScore(data) {
  return (data && Array.isArray(data.reports) ? data.reports : []).reduce((s, r) => s + monoQReportBanScore(r), 0);
}

function monoQPreserveLocalDeletes(merged, localRaw) {
  if (!merged || !localRaw) return;
  const local = localRaw.reports ? localRaw : { reports: localRaw.reports || [] };
  merged.removedNameKeys = [
    ...new Set([
      ...(merged.removedNameKeys || []),
      ...(local.reports || []).flatMap((r) => r.removedNameKeys || []),
    ]),
  ];
  (merged.reports || []).forEach((r) => {
    const lr = (local.reports || []).find((x) => x && x.id === r.id);
    if (!lr) return;
    r.removedNameKeys = [...new Set([...(r.removedNameKeys || []), ...(lr.removedNameKeys || [])])];
    MONOQ_SHEETS.forEach((s) => {
      const sh = r.sheets && r.sheets[s.id];
      const lsh = lr.sheets && lr.sheets[s.id];
      if (!sh) return;
      sh.deletedKeys = [...new Set([...monoQSheetDeleted(sh), ...monoQSheetDeleted(lsh)])];
      const removed = new Set([...(r.removedNameKeys || []), ...sh.deletedKeys]);
      sh.employees = (sh.employees || []).filter((emp) => {
        const nk = monoQKey(emp.fullName);
        if (nk && removed.has(nk)) return false;
        const id = String(emp.employeeId || "").trim();
        if (id && removed.has(`id:${id}`)) return false;
        const rk = monoQEmployeeDeleteKey(emp);
        if (rk && removed.has(rk)) return false;
        return true;
      });
    });
  });
}

function persistMonoQSafetyNet(data) {
  try {
    const current = {
      reports: (data && data.reports ? data.reports : monoQData.reports || []).map((r) => monoQNormalizeReport(r)),
    };
    const prev = JSON.parse(localStorage.getItem(MONOQ_SAFETY_KEY) || "null");
    const prevMarks = prev ? monoQDataMarkScore(prev) : 0;
    const prevBans = prev ? monoQDataBanScore(prev) : 0;
    const curMarks = monoQDataMarkScore(current);
    const curBans = monoQDataBanScore(current);
    if (curMarks >= prevMarks || curBans > prevBans || !prev) {
      if (curMarks > 0 || curBans > 0) {
        localStorage.setItem(MONOQ_SAFETY_KEY, JSON.stringify(current));
      }
    }
  } catch (_) {}
}

function restoreMonoQFromSafetyNet() {
  try {
    const raw = localStorage.getItem(MONOQ_SAFETY_KEY);
    if (!raw) return 0;
    const safety = JSON.parse(raw);
    if (!safety || !Array.isArray(safety.reports) || !safety.reports.length) return 0;
    ensureMonorrielQuincenasLoaded();
    const before = monoQDataMarkScore(monoQData);
    if (before > 2) return 0;
    const localSnap = JSON.parse(JSON.stringify(monoQData));
    const merged = monoQMerge(monoQData, safety);
    monoQPreserveLocalDeletes(merged, localSnap);
    const after = monoQDataMarkScore(merged);
    if (after > before) {
      monoQData = { ...merged, _ready: true };
      try {
        localStorage.setItem(MONOQ_KEY, JSON.stringify(monoQData));
      } catch (_) {}
      return after - before;
    }
  } catch (_) {}
  return 0;
}

function syncMonorrielQuincenasPacked(packed) {
  if (!packed || !Array.isArray(packed.reports)) return;
  ensureMonorrielQuincenasLoaded();
  if (typeof monoQDataMarkScore === "function") {
    const localScore = monoQDataMarkScore(monoQData);
    const packedScore = monoQDataMarkScore(packed);
    if (packedScore < localScore - 1 && localScore > 2) {
      console.warn("RFS: no se reemplaza quincena local (menos datos que lo actual)");
      return;
    }
  }
  const localSnap = JSON.parse(JSON.stringify(monoQData));
  monoQData = { reports: packed.reports.map((r) => monoQNormalizeReport(r)), _ready: true };
  monoQPreserveLocalDeletes(monoQData, localSnap);
  monoQSave(false);
}

function monoQMerge(localRaw, remoteRaw) {
  const local = localRaw && Array.isArray(localRaw.reports) ? localRaw.reports : [];
  const remote = remoteRaw && Array.isArray(remoteRaw.reports) ? remoteRaw.reports : [];
  const ids = new Set([...local, ...remote].map((r) => r && r.id).filter(Boolean));
  const reports = [];
  ids.forEach((id) => {
    const a = local.find((r) => r && r.id === id);
    const b = remote.find((r) => r && r.id === id);
    if (a && b) {
      const ls = monoQReportMarkScore(a);
      const rs = monoQReportMarkScore(b);
      const lb = monoQReportBanScore(a);
      const rb = monoQReportBanScore(b);
      let base;
      let other;
      if (lb > rb) {
        base = a;
        other = b;
      } else if (rb > lb) {
        base = b;
        other = a;
      } else if (ls > rs + 1) {
        base = a;
        other = b;
      } else if (rs > ls + 1) {
        base = b;
        other = a;
      } else {
        const localNewer = String(a.updatedAt || "") >= String(b.updatedAt || "");
        base = localNewer ? a : b;
        other = localNewer ? b : a;
      }
      const merged = mergeMonoReportSticky(base, other);
      merged.removedNameKeys = [
        ...new Set([...(merged.removedNameKeys || []), ...(a.removedNameKeys || []), ...(b.removedNameKeys || [])]),
      ];
      reports.push(merged);
    } else {
      reports.push(monoQNormalizeReport(a || b));
    }
  });
  reports.sort(
    (x, y) => String(y.period).localeCompare(String(x.period)) || (y.half || 1) - (x.half || 1)
  );
  return { reports };
}

function monoQBlankSheetsOnly() {
  const sheets = {};
  MONOQ_SHEETS.forEach((s) => {
    sheets[s.id] = { employees: [], deletedKeys: [] };
  });
  return sheets;
}

function monoQResetActiveQuincenaBlank() {
  ensureMonorrielQuincenasLoaded();
  const cur = monoQActive();
  const spec = cur ? monoQSpec(cur.period, cur.half) : monoQSpec("2026-11", 1);
  const report = monoQNormalizeReport({
    ...spec,
    sheets: monoQBlankSheetsOnly(),
    updatedAt: new Date().toISOString(),
  });
  monoQData.reports = [report];
  monoQActiveId = report.id;
  monoQData._ready = true;
  if (typeof markMonoQLocalAuthority === "function") markMonoQLocalAuthority();
  monoQSave(true);
  if (typeof flushCloudSave === "function") {
    try {
      flushCloudSave().catch(() => {});
    } catch (_) {}
  }
  return { ok: true, id: report.id };
}

function monoQSave(push) {
  if (typeof canSyncMonorrielQuincenaData === "function" && !canSyncMonorrielQuincenaData()) return;
  if (typeof markMonoQLocalAuthority === "function") markMonoQLocalAuthority();
  if (typeof markSensitiveReportEdit === "function") markSensitiveReportEdit();
  try {
    localStorage.setItem(MONOQ_KEY, JSON.stringify(monoQData));
    localStorage.setItem(MONOQ_ACTIVE_KEY, monoQActiveId);
    persistMonoQSafetyNet(monoQData);
  } catch (_) {}
  if (push && typeof queueCloudSave === "function") queueCloudSave();
}

function ensureMonorrielQuincenasLoaded() {
  if (monoQData && monoQData._ready) return monoQData;
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(MONOQ_KEY) || "null");
  } catch (_) {}
  const daily = typeof monorrielReports !== "undefined" && Array.isArray(monorrielReports) ? monorrielReports : [];
  if (stored && Array.isArray(stored.reports) && stored.reports.length) {
    monoQData = { reports: stored.reports.map((r) => monoQNormalizeReport(r)) };
  } else {
    monoQData = buildMonorrielQuincenasFromDaily(daily);
  }
  monoQData._ready = true;
  if (
    typeof canSyncMonorrielQuincenaData === "function" &&
    canSyncMonorrielQuincenaData() &&
    monoQDataMarkScore(monoQData) > 0 &&
    typeof markMonoQLocalAuthority === "function"
  ) {
    markMonoQLocalAuthority();
  }
  try {
    monoQActiveId = localStorage.getItem(MONOQ_ACTIVE_KEY) || "";
  } catch (_) {}
  if (!monoQData.reports.some((r) => r.id === monoQActiveId)) {
    const nov = monoQData.reports.find((r) => r.id === "monoq-2026-11-h1");
    monoQActiveId = (nov && nov.id) || (monoQData.reports[0] && monoQData.reports[0].id) || "";
  }
  monoQSave(false);
  return monoQData;
}

function monorrielQuincenasForCloud() {
  ensureMonorrielQuincenasLoaded();
  if (!(monoQData.reports || []).length) return null;
  return { reports: monoQData.reports };
}

function applyRemoteMonorrielQuincenas(remote) {
  if (
    typeof shouldSkipSensitiveRemoteMergeBeforeSave === "function" &&
    shouldSkipSensitiveRemoteMergeBeforeSave()
  ) {
    return;
  }
  if (!remote || !Array.isArray(remote.reports)) return;
  ensureMonorrielQuincenasLoaded();
  if (typeof canSyncMonorrielQuincenaData === "function" && canSyncMonorrielQuincenaData()) {
    const localMarks = monoQDataMarkScore(monoQData);
    if (typeof monoQExclusivePushOnly === "function" && monoQExclusivePushOnly()) {
      return;
    }
    if (localMarks > 0) {
      if (typeof markMonoQLocalAuthority === "function") markMonoQLocalAuthority();
      return;
    }
    monoQData = {
      reports: remote.reports.map((r) => monoQNormalizeReport(r)),
      _ready: true,
    };
    persistMonoQSafetyNet(monoQData);
    monoQSave(false);
    if (typeof markMonoQLocalAuthority === "function") markMonoQLocalAuthority();
    if (document.getElementById("monoQuincenaHost")) renderMonorrielQuincenaModule();
    return;
  }
  const localMarks = monoQDataMarkScore(monoQData);
  const remoteMarks = monoQDataMarkScore(remote);
  const localBans = monoQDataBanScore(monoQData);
  const remoteBans = monoQDataBanScore(remote);
  if (
    (localMarks > remoteMarks + 1 && localMarks > 2) ||
    (localBans > remoteBans && localMarks >= remoteMarks)
  ) {
    console.warn("RFS Monorriel: se conserva la copia local (más datos o más borrados).");
    return;
  }
  const localSnap = JSON.parse(JSON.stringify(monoQData));
  const before = monoQDataMarkScore(monoQData);
  monoQData = monoQMerge(monoQData, remote);
  monoQPreserveLocalDeletes(monoQData, localSnap);
  if (before < 2) restoreMonoQFromSafetyNet();
  monoQData._ready = true;
  persistMonoQSafetyNet(monoQData);
  monoQSave(false);
  if (document.getElementById("monoQuincenaHost")) renderMonorrielQuincenaModule();
}

function monoQActive() {
  ensureMonorrielQuincenasLoaded();
  return (monoQData.reports || []).find((r) => r.id === monoQActiveId) || monoQData.reports[0] || null;
}

function monoQHoras(v) {
  const s = String(v == null ? "" : v).trim().replace(",", ".");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(999, n) * 100) / 100;
}

function monoQPagos(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s || !/^\d+$/.test(s)) return "";
  const n = Number(s);
  if (!n) return "";
  return Math.min(99, Math.round(n));
}

function monoQMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const MONOQ_HOURS_PER_JORNADA = 12;

function monoQParseMarkNumber(mark) {
  if (mark == null || mark === "") return null;
  const s = String(mark).trim().replace(",", ".");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function monoQMarkPayrollParts(mark) {
  const n = monoQParseMarkNumber(mark);
  if (n == null || !(n > 0)) return { days: 0, extraHours: 0, volao: false };
  if (n === 2) return { days: 1, extraHours: 0, volao: true };
  const full = Math.floor(n);
  const frac = Math.round((n - full) * 1000) / 1000;
  const days = full > 0 ? full : 0;
  const extraHours = frac > 0.001 ? Math.round(frac * MONOQ_HOURS_PER_JORNADA * 100) / 100 : 0;
  return { days, extraHours, volao: false };
}

function monoQExtraHoursFromMarks(marks, dayNums) {
  let h = 0;
  (dayNums || []).forEach((d) => {
    if (Number(d) === 31) return;
    h += monoQMarkPayrollParts(marks && marks[String(d)]).extraHours;
  });
  return Math.round(h * 100) / 100;
}

function monoQFormatMarkCell(mark) {
  if (mark == null || mark === "") return "";
  const n = monoQParseMarkNumber(mark);
  if (n != null) return Number.isInteger(n) ? String(n) : String(n);
  return String(mark);
}

function monoQCount(marks, dayNums) {
  let days = 0;
  let volaoMarks = 0;
  let extraHoursFromMarks = 0;
  (dayNums || []).forEach((d) => {
    if (Number(d) === 31) return;
    const parts = monoQMarkPayrollParts(marks && marks[String(d)]);
    if (parts.volao) {
      days += 1;
      volaoMarks += 1;
      return;
    }
    if (parts.days <= 0 && parts.extraHours <= 0) return;
    days += parts.days;
    extraHoursFromMarks += parts.extraHours;
  });
  return {
    days,
    volaoMarks,
    extraHoursFromMarks: Math.round(extraHoursFromMarks * 100) / 100,
  };
}

function monoQSetMark(emp, day, raw) {
  const key = String(day);
  const text = String(raw == null ? "" : raw).trim().replace(",", ".");
  if (!text) {
    delete emp.marks[key];
    return;
  }
  const n = monoQParseMarkNumber(text);
  if (n == null) {
    delete emp.marks[key];
    return;
  }
  if (n === 2) emp.marks[key] = 2;
  else emp.marks[key] = Math.round(n * 100) / 100;
}

function monoQMarkScoreForEmp(emp) {
  let n = 0;
  Object.keys((emp && emp.marks) || {}).forEach((d) => {
    if (Number((emp.marks || {})[d]) > 0) n += 1;
  });
  return n;
}

function monoQDedupeSheet(sheet) {
  if (!sheet || !Array.isArray(sheet.employees)) return { removed: 0 };
  monoQPushUndo("dedupe");
  let removed = 0;
  const keepIdx = new Map();
  const list = sheet.employees;
  list.forEach((emp, idx) => {
    const nk = monoQKey(emp.fullName);
    if (!nk) return;
    const prev = keepIdx.get(nk);
    if (prev == null) {
      keepIdx.set(nk, idx);
      return;
    }
    const winnerIdx = monoQMarkScoreForEmp(list[prev]) >= monoQMarkScoreForEmp(emp) ? prev : idx;
    const loserIdx = winnerIdx === prev ? idx : prev;
    mergeMonoEmployeeFields(list[winnerIdx], list[loserIdx]);
    const loser = list[loserIdx];
    sheet.deletedKeys = monoQSheetDeleted(sheet);
    const dk = monoQKey(loser.fullName);
    if (dk && !sheet.deletedKeys.includes(dk)) sheet.deletedKeys.push(dk);
    if (loser.employeeId) {
      const idk = `id:${loser.employeeId}`;
      if (!sheet.deletedKeys.includes(idk)) sheet.deletedKeys.push(idk);
    }
    list.splice(loserIdx, 1);
    keepIdx.set(nk, winnerIdx > loserIdx ? winnerIdx - 1 : winnerIdx);
    removed += 1;
  });
  return { removed };
}

function renderMonorrielQuincenaModule() {
  const host = document.getElementById("monoQuincenaHost");
  const summary = document.getElementById("monorrielSummary");
  if (!host) return;
  if (typeof canAccessMonorrielQuincena === "function" && !canAccessMonorrielQuincena()) {
    host.innerHTML =
      '<div class="form-card"><p class="muted">Cuadro de quincena Monorriel: solo la usuaria <strong>Ashley28</strong> puede verlo y editarlo. Otros usuarios no sincronizan ni modifican esta planilla.</p></div>';
    if (summary) summary.textContent = "Monorriel · reportes diarios (cuadro de quincena restringido)";
    return;
  }
  const report = monoQActive();
  if (!report) {
    if (summary) summary.textContent = "Sin reporte de quincena.";
    host.innerHTML = '<div class="form-card"><p class="muted">No hay datos para armar el reporte.</p></div>';
    return;
  }
  const sheetMeta = MONOQ_SHEETS.find((s) => s.id === monoQSheet) || MONOQ_SHEETS[0];
  monoQSheet = sheetMeta.id;
  const employees = (report.sheets[sheetMeta.id] && report.sheets[sheetMeta.id].employees) || [];
  const withMarks = employees.filter((e) => Object.keys(e.marks || {}).length).length;
  if (summary) {
    summary.textContent = `${report.label} · ${sheetMeta.label} · ${employees.length} personas · ${withMarks} con días`;
  }
  const dayHeaders = (report.dayNums || [])
    .map((d) => `<th class="vargas-day${Number(d) === 31 ? " vargas-day-excl" : ""}">${d}</th>`)
    .join("");
  const body = employees
    .map((emp, idx) => {
      monoQEnsureRowId(emp);
      const rid = emp.rowId;
      const memoTools = monoQMemoTools();
      const memo = (emp.memoColors && typeof emp.memoColors === "object" ? emp.memoColors : {}) || {};
      const ms = (key) => (memoTools ? memoTools.memoStyleAttr(memo, key) : "");
      const count = monoQCount(emp.marks, report.dayNums);
      const cells = (report.dayNums || [])
        .map((d) => {
          const mark = emp.marks && emp.marks[String(d)];
          const val = monoQFormatMarkCell(mark);
          const n = monoQParseMarkNumber(mark);
          const cls = n === 2 ? " is-volao" : n > 0 ? " is-work" : "";
          const title =
            n === 2
              ? ` title="2 = día + volao"`
              : n > 0 && !Number.isInteger(n)
                ? ` title="${val}: fracción × 12 h = horas extras (1.5 = 6 h)"`
                : ` title="1 = día · 2 = día + volao · 1.5 = 1 día + 6 h extras"`;
          return `<td class="vargas-day-cell monoq-day${cls}${Number(d) === 31 ? " is-excl" : ""}" contenteditable="true" spellcheck="false" data-row-id="${monoQEsc(rid)}" data-i="${idx}" data-day="${d}" data-memo-field="d:${d}"${title}${ms(
            `d:${d}`
          )}>${monoQEsc(val)}</td>`;
        })
        .join("");
      const daysLabel = count.volaoMarks
        ? `${count.days}<span class="vargas-volao-hint" title="${count.volaoMarks} volao(s) × RD$${sheetMeta.volao}"> · V${count.volaoMarks * sheetMeta.volao}</span>`
        : String(count.days);
      const pagos = monoQPagos(emp.volaosPagos);
      const horas = monoQHoras(emp.horasExtras);
      const horasTxt = horas ? String(horas) : "";
      return `<tr data-row-id="${monoQEsc(rid)}">
        <td class="sticky-name vargas-name monoq-name" contenteditable="true" spellcheck="false" data-row-id="${monoQEsc(rid)}" data-i="${idx}" data-memo-field="name" title="${monoQEsc(emp.fullName)}"${ms(
          "name"
        )}>${monoQEsc(emp.fullName)}</td>
        <td class="vargas-post monoq-post" contenteditable="true" spellcheck="false" data-row-id="${monoQEsc(rid)}" data-i="${idx}" data-memo-field="post"${ms("post")}>${monoQEsc(
        emp.position || ""
      )}</td>
        <td class="vargas-days-total">${daysLabel}</td>
        <td class="vargas-pagos-cell monoq-pagos${pagos ? " is-paid" : ""}" contenteditable="true" spellcheck="false" data-row-id="${monoQEsc(rid)}" data-i="${idx}" data-memo-field="pagos" title="Volaos ya pagados. Solo control: no suma en la nómina"${ms(
          "pagos"
        )}>${monoQEsc(pagos === "" ? "" : String(pagos))}</td>
        <td class="vargas-hex-cell monoq-horas${horasTxt ? " has-hex" : ""}" contenteditable="true" spellcheck="false" data-row-id="${monoQEsc(rid)}" data-i="${idx}" data-memo-field="horas" title="Horas extras. RD$60 por hora, se suman a la nómina sin quitar lo ya calculado"${ms(
          "horas"
        )}>${monoQEsc(horasTxt)}</td>
        ${cells}
        <td class="vargas-del-cell"><button type="button" class="vargas-del-btn monoq-del" data-row-id="${monoQEsc(rid)}" data-i="${idx}" title="Quitar de esta planilla">✕</button></td>
      </tr>`;
    })
    .join("");
  const tabs = MONOQ_SHEETS.map((s) => {
    const n = ((report.sheets[s.id] && report.sheets[s.id].employees) || []).length;
    return `<button type="button" class="btn ${s.id === sheetMeta.id ? "primary" : "secondary"} btn-sm monoq-tab" data-sheet="${s.id}" style="width:auto">${monoQEsc(s.label)} (${n})</button>`;
  }).join("");
  const sendButtons = MONOQ_SHEETS.map((s) => {
    const on = s.id === sheetMeta.id;
    return `<button type="button" class="monoq-send" data-sheet="${s.id}" style="width:auto;background:${on ? "#ff7a00" : "#c2410c"};color:#1a1000;font-weight:800;font-size:${on ? "16px" : "14px"};padding:12px 14px;border:0;border-radius:10px;box-shadow:0 0 0 3px rgba(255,122,0,0.35)">Enviar a nómina · ${monoQEsc(s.label)}</button>`;
  }).join("");
  host.innerHTML = `
    <div class="form-card vargas-toolbar">
      <div class="vargas-toolbar-row">
        <label>Quincena
          <select id="monoQSelect">
            ${(monoQData.reports || [])
              .map((r) => `<option value="${monoQEsc(r.id)}" ${r.id === report.id ? "selected" : ""}>${monoQEsc(monoQTitle(r))}</option>`)
              .join("")}
          </select>
        </label>
      </div>
      ${monoQMemoTools() ? monoQMemoTools().renderMemoPaletteHtml(monoQMemoColorPick) : ""}
      <div class="vargas-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">${tabs}</div>
      <div class="vargas-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${sendButtons}</div>
      <div class="vargas-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="primary" id="btnMonoQGuardar">Guardar respaldo</button>
        <button type="button" class="secondary" id="btnMonoQRecuperar">Recuperar respaldo</button>
        <button type="button" class="secondary" id="btnMonoQImportExcel" title="Sube .xlsx: Nombre, Puesto, Planilla (dia/noche/moto) y días">Importar Excel</button>
        <button type="button" class="secondary danger-outline" id="btnMonoQBlank" title="Borra planillas de esta quincena; luego Importar Excel">Vaciar quincena (Excel nuevo)</button>
        <button type="button" class="secondary" id="btnMonoQDedupe">Quitar duplicados</button>
        <button type="button" class="secondary" id="btnMonoQNext">Abrir siguiente quincena</button>
      </div>
      <p class="muted tight" style="margin-top:6px">Excel: <strong>Nombre · Puesto · Planilla</strong> (dia, noche, moto_dia, moto_noche) y columnas de días. Una hoja por planilla o columna Planilla.</p>
      <p class="muted tight" style="margin-top:10px">
        Igual que Ramón. <strong>1</strong> = un día. <strong>1.5</strong> = 1 día + 6 h extras (automático).
        <strong>2</strong> = el mismo día + volao
        (día RD$ 850, noche RD$ 900, moto RD$ 1,000). <strong>Volaos pagos</strong> es solo control y no suma.
        <strong>Horas ext.</strong> = horas × RD$ 60, sumadas a la nómina sin quitar lo ya calculado.
        El día 31 se ve y no cuenta.         Cada botón naranja envía esa planilla a su nómina y deja solo esos nombres.
        Los de la nómina anterior que no están en esta planilla se quitan.
        El préstamo de quien se queda no se toca. Todos cobran en efectivo.
        <strong>✕ Quitar</strong> solo esa fila. <strong>Ctrl+Z</strong> deshace. <strong>Guardar respaldo</strong> para copias mayores.
      </p>
    </div>
    <div class="form-card">
      <h2 style="margin:0 0 10px;font-size:16px">Agregar a ${monoQEsc(sheetMeta.label)}</h2>
      <div class="vargas-add-grid">
        <label>Nombre<input id="monoQAddName" type="text" placeholder="Nombre completo" /></label>
        <label>Puesto<input id="monoQAddPost" type="text" placeholder="Puesto" /></label>
      </div>
      <button type="button" class="primary" id="btnMonoQAdd" style="margin-top:8px">Agregar</button>
    </div>
    <div class="form-card" style="padding:0;overflow:hidden">
      <div class="vargas-table-wrap">
        <table class="vargas-table">
          <colgroup>
            <col style="width:190px" />
            <col style="width:130px" />
            <col style="width:96px" />
            <col style="width:78px" />
            <col style="width:72px" />
            ${(report.dayNums || []).map(() => '<col style="width:36px" />').join("")}
            <col style="width:36px" />
          </colgroup>
          <thead><tr>
            <th class="sticky-name">Nombre</th>
            <th>Puesto</th>
            <th>Días</th>
            <th class="vargas-pagos-head" title="Solo control. No entra en la nómina">Volaos pagos</th>
            <th class="vargas-hex-head" title="Horas × RD$60, sumadas a Horas extras">Horas ext.</th>
            ${dayHeaders}
            <th class="vargas-del-head" title="Quitar de la lista">Quitar</th>
          </tr></thead>
          <tbody>${body || `<tr><td colspan="${(report.dayNums || []).length + 6}">Sin personas en esta planilla</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;
  bindMonorrielQuincenaUi(report);
}

function bindMonorrielQuincenaUi(report) {
  const host = document.getElementById("monoQuincenaHost");
  if (!host) return;
  const tools = monoQMemoTools();
  if (tools) {
    tools.bindMemoPalette(host, {
      getSelected: () => monoQMemoColorPick,
      setSelected: (id) => {
        monoQMemoColorPick = id;
      },
      getMode: () => monoQMemoPaintOn,
      setMode: (on) => {
        monoQMemoPaintOn = !!on;
      },
      applyColor: (cell, colorId) => {
        const field = cell.getAttribute("data-memo-field") || "";
        const idx = Number(cell.getAttribute("data-i"));
        if (idx >= 0) setMonoQCellMemo(idx, field, colorId);
        const hit = tools.memoById(colorId);
        cell.style.backgroundColor = hit && hit.css ? hit.css : "";
      },
    });
    const view = document.getElementById("monorrielView");
    tools.bindReportClipboard(view || host, {
      cellSelector: "td[contenteditable][data-memo-field]",
      pasteToCell: monoQApplyPasteToCell,
    });
  }
  host.querySelectorAll(".monoq-name, .monoq-post, .monoq-pagos, .monoq-horas, .monoq-day").forEach((cell) => {
    monoQBindUndoOnFocus(cell, "editar");
  });
  document.getElementById("monoQSelect")?.addEventListener("change", (ev) => {
    monoQActiveId = ev.target.value;
    monoQSave(false);
    renderMonorrielQuincenaModule();
  });
  host.querySelectorAll(".monoq-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      monoQSheet = btn.getAttribute("data-sheet") || "dia";
      renderMonorrielQuincenaModule();
    });
  });
  document.getElementById("btnMonoQGuardar")?.addEventListener("click", () => {
    guardarMonoQRespaldo();
    if (typeof toast === "function") toast("Respaldo guardado (local + nube).");
  });
  document.getElementById("btnMonoQRecuperar")?.addEventListener("click", () => {
    if (
      !confirm(
        "¿Recuperar el último respaldo guardado?\n\nCombina con lo que tienes ahora (no borra marcas si el respaldo las trae)."
      )
    ) {
      return;
    }
    const r = restoreMonoQFromStoredBackup();
    if (!r.ok) {
      if (typeof toast === "function") toast("No hay respaldo guardado todavía. Pulsa Guardar respaldo primero.");
      return;
    }
    if (typeof toast === "function") {
      const when =
        r.at === "safety"
          ? "copia de seguridad"
          : new Date(r.at).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
      toast(r.gained ? `Recuperado (${when}). +${r.gained} marcas/datos.` : `Recuperado (${when}).`);
    }
    renderMonorrielQuincenaModule();
  });
  document.getElementById("btnMonoQBlank")?.addEventListener("click", () => {
    if (
      !confirm(
        "¿Vaciar esta quincena Monorriel?\n\nSe borran filas y marcas en las 4 planillas.\nLuego Importar Excel.\n\nNo se revierte con Ctrl+Z."
      )
    ) {
      return;
    }
    monoQResetActiveQuincenaBlank();
    if (typeof toast === "function") toast("Quincena vacía. Sube el Excel nuevo.");
    renderMonorrielQuincenaModule();
  });
  document.getElementById("btnMonoQDedupe")?.addEventListener("click", () => {
    const current = monoQActive();
    const sheet = current && current.sheets[monoQSheet];
    if (!sheet) return;
    const r = monoQDedupeSheet(sheet);
    if (r.removed) {
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
      if (typeof toast === "function") toast(`Se quitaron ${r.removed} duplicado(s) en esta planilla.`);
    } else if (typeof toast === "function") toast("No había duplicados.");
    renderMonorrielQuincenaModule();
  });
  document.getElementById("btnMonoQNext")?.addEventListener("click", () => {
    const cur = monoQActive();
    if (!cur) return;
    let period = cur.period;
    let half = cur.half === 2 ? 2 : 1;
    if (half === 1) half = 2;
    else {
      const [y, m] = period.split("-").map((n) => Number(n));
      const ny = m === 12 ? y + 1 : y;
      const nm = m === 12 ? 1 : m + 1;
      period = `${ny}-${String(nm).padStart(2, "0")}`;
      half = 1;
    }
    const spec = monoQSpec(period, half);
    if (!monoQData.reports.some((r) => r.id === spec.id)) {
      const created = monoQNormalizeReport(spec);
      MONOQ_SHEETS.forEach((s) => {
        const prev = (cur.sheets[s.id] && cur.sheets[s.id].employees) || [];
        created.sheets[s.id].employees = prev.map((e) => ({
          fullName: e.fullName,
          employeeId: e.employeeId || "",
          position: e.position || "",
          marks: {},
          volaosPagos: "",
          horasExtras: 0,
        }));
      });
      created.updatedAt = new Date().toISOString();
      monoQData.reports.unshift(created);
    }
    monoQActiveId = spec.id;
    monoQSave(true);
    renderMonorrielQuincenaModule();
    if (typeof toast === "function") toast("Quincena abierta. Los días quedan en blanco.");
  });
  document.getElementById("btnMonoQAdd")?.addEventListener("click", () => {
    const input = document.getElementById("monoQAddName");
    const fullName = String((input && input.value) || "").replace(/\s+/g, " ").trim();
    if (!fullName) return;
    const current = monoQActive();
    const sheet = current && current.sheets[monoQSheet];
    if (!sheet) return;
    if (!monoQFindEmp(sheet.employees, fullName)) {
      monoQPushUndo("agregar");
      const postInput = document.getElementById("monoQAddPost");
      sheet.employees.push({
        fullName,
        employeeId: "",
        position: String((postInput && postInput.value) || "").replace(/\s+/g, " ").trim(),
        marks: {},
        volaosPagos: "",
        horasExtras: 0,
      });
      sheet.employees.sort((a, b) => a.fullName.localeCompare(b.fullName, "es"));
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
    }
    renderMonorrielQuincenaModule();
  });
  host.querySelectorAll(".monoq-send").forEach((btn) => {
    btn.addEventListener("click", () => enviarMonorrielPlanillaANomina(btn.getAttribute("data-sheet")));
  });
  host.querySelectorAll(".monoq-post").forEach((cell) => {
    cell.addEventListener("focusout", () => {
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, cell);
      if (!emp) return;
      emp.position = String(cell.textContent || "").replace(/\s+/g, " ").trim();
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
    });
  });
  host.querySelectorAll(".monoq-pagos").forEach((cell) => {
    cell.addEventListener("focusout", () => {
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, cell);
      if (!emp) return;
      emp.volaosPagos = monoQPagos(cell.textContent);
      cell.textContent = emp.volaosPagos === "" ? "" : String(emp.volaosPagos);
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
    });
  });
  host.querySelectorAll(".monoq-horas").forEach((cell) => {
    cell.addEventListener("focusout", () => {
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, cell);
      if (!emp) return;
      emp.horasExtras = monoQHoras(cell.textContent);
      cell.textContent = emp.horasExtras ? String(emp.horasExtras) : "";
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
    });
  });
  host.querySelectorAll(".monoq-day").forEach((cell) => {
    cell.addEventListener("focusout", () => {
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, cell);
      if (!emp) return;
      monoQSetMark(emp, cell.getAttribute("data-day"), cell.textContent);
      current.updatedAt = new Date().toISOString();
      monoQSave(true);
      const count = monoQCount(emp.marks, current.dayNums);
      const meta = MONOQ_SHEETS.find((s) => s.id === monoQSheet) || MONOQ_SHEETS[0];
      const total = cell.parentElement && cell.parentElement.querySelector(".vargas-days-total");
      if (total) {
        total.textContent = count.volaoMarks ? `${count.days} · V${count.volaoMarks * meta.volao}` : String(count.days);
      }
    });
  });
  host.querySelectorAll(".monoq-name").forEach((cell) => {
    cell.addEventListener("focusout", () => {
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, cell);
      if (!emp) return;
      const next = String(cell.textContent || "").replace(/\s+/g, " ").trim();
      if (!next) {
        cell.textContent = emp.fullName;
        return;
      }
      if (monoQKey(next) === monoQKey(emp.fullName) && next === emp.fullName) return;
      const dup = sheet.employees.some(
        (e) => e !== emp && monoQKey(e.fullName) === monoQKey(next)
      );
      if (dup) {
        if (typeof toast === "function") toast("Ese nombre ya está en esta planilla.");
        cell.textContent = emp.fullName;
        return;
      }
      emp.fullName = next;
      emp.nameManual = true;
      emp.nameEditedAt = new Date().toISOString();
      current.updatedAt = emp.nameEditedAt;
      monoQSave(true);
      try {
        if (typeof flushCloudSave === "function") flushCloudSave();
      } catch (_) {}
    });
  });
  host.querySelectorAll(".monoq-del").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const current = monoQActive();
      const sheet = current && current.sheets[monoQSheet];
      const emp = sheet && monoQFindEmployee(sheet, btn);
      if (!emp) return;
      const idx = (sheet.employees || []).indexOf(emp);
      if (idx < 0) return;
      const name = emp.fullName;
      const tr = btn.closest("tr");
      monoQPushUndo("quitar");
      sheet.deletedKeys = sheet.deletedKeys || [];
      const nk = monoQKey(emp.fullName);
      const dk = monoQEmployeeDeleteKey(emp);
      if (nk && !sheet.deletedKeys.includes(nk)) sheet.deletedKeys.push(nk);
      if (emp.employeeId) {
        const idk = `id:${emp.employeeId}`;
        if (!sheet.deletedKeys.includes(idk)) sheet.deletedKeys.push(idk);
      }
      if (dk && !sheet.deletedKeys.includes(dk)) sheet.deletedKeys.push(dk);
      current.removedNameKeys = current.removedNameKeys || [];
      if (nk && !current.removedNameKeys.includes(nk)) current.removedNameKeys.push(nk);
      sheet.employees.splice(idx, 1);
      current.updatedAt = new Date().toISOString();
      current.deleteRevision = Date.now();
      monoQSave(true);
      try {
        if (typeof flushCloudSave === "function") flushCloudSave();
      } catch (_) {}
      if (tr && tr.parentElement) tr.remove();
      if (typeof toast === "function") toast(`Eliminado: ${name}`);
    });
  });
  if (typeof bindMonorrielExcelImport === "function") bindMonorrielExcelImport();
}

function monoQReportForPayroll(period, half) {
  ensureMonorrielQuincenasLoaded();
  const id = monoQSpec(period, half).id;
  return (monoQData.reports || []).find((r) => r.id === id) || null;
}

/** Botón naranja de cada planilla: envía ese reporte a su nómina. */
function enviarMonorrielPlanillaANomina(sheetId) {
  const report = monoQActive();
  const sheetMeta = MONOQ_SHEETS.find((s) => s.id === sheetId) || MONOQ_SHEETS.find((s) => s.id === monoQSheet);
  if (!report || !sheetMeta) {
    if (typeof toast === "function") toast("No hay reporte para enviar.");
    return { ok: false };
  }
  const period = report.period;
  const half = report.half === 2 || report.half === "2" ? 2 : 1;
  ["nominaMonthFilter", "contabMonthFilter"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && period) el.value = period;
  });
  const halfEl = document.getElementById("contabPayrollHalf");
  if (halfEl) halfEl.value = String(half);
  const groupEl = document.getElementById("contabPayrollGroup");
  if (groupEl) groupEl.value = "monorriel";
  const tandaEl = document.getElementById("contabPayrollMonoTanda");
  if (tandaEl) tandaEl.value = sheetMeta.id;
  let p = typeof findPayrollByGroup === "function" ? findPayrollByGroup(period, half, "monorriel", sheetMeta.id) : null;
  if (!p && typeof generatePayrollForSelection === "function") {
    generatePayrollForSelection({
      period,
      half,
      group: "monorriel",
      tanda: sheetMeta.id,
      quiet: true,
      skipConfirm: true,
    });
    p = typeof findPayrollByGroup === "function" ? findPayrollByGroup(period, half, "monorriel", sheetMeta.id) : null;
  }
  if (p && typeof selectedPayrollId !== "undefined") selectedPayrollId = p.id;
  return llenarMonorrielNominaDesdeReporte(p);
}

/** Llena la nómina Monorriel abierta con la planilla del mismo corte. No toca préstamos. */
function llenarMonorrielNominaDesdeReporte(payroll) {
  let p = payroll;
  if (!p && typeof ensureOpenPayrollDraft === "function") p = ensureOpenPayrollDraft();
  const period = (p && p.period) || (typeof getSelectedMonth === "function" ? getSelectedMonth() : "");
  const half = p
    ? p.half === 2 || p.half === "2"
      ? 2
      : 1
    : typeof getSelectedPayrollHalf === "function" && getSelectedPayrollHalf() === 2
      ? 2
      : 1;
  const tanda = (p && p.tanda) || (typeof getSelectedMonorrielTanda === "function" ? getSelectedMonorrielTanda() : "dia");
  const sheetMeta = MONOQ_SHEETS.find((s) => s.id === tanda) || MONOQ_SHEETS[0];
  if (!p || p.group !== "monorriel") {
    if (typeof generatePayrollForSelection === "function") {
      generatePayrollForSelection({
        period,
        half,
        group: "monorriel",
        tanda: sheetMeta.id,
        quiet: true,
        skipConfirm: true,
      });
    }
    if (typeof findPayrollByGroup === "function") {
      p = findPayrollByGroup(period, half, "monorriel", sheetMeta.id);
    }
  }
  if (!p) {
    if (typeof toast === "function") toast("Abre primero la nómina de esa planilla.");
    return { ok: false };
  }
  const report = monoQReportForPayroll(p.period, p.half);
  if (!report) {
    if (typeof toast === "function") toast("No hay reporte Monorriel de esa quincena.");
    return { ok: false };
  }
  const employees = (report.sheets[sheetMeta.id] && report.sheets[sheetMeta.id].employees) || [];
  const opts = typeof payrollComputeOpts === "function" ? payrollComputeOpts(p) : {};
  const previous = new Map();
  (p.lines || []).forEach((line) => {
    const key = monoQKey(line && line.fullName);
    if (key && !previous.has(key)) previous.set(key, line);
  });
  const nextLines = [];
  employees.forEach((emp) => {
    const fullName = String(emp.fullName || "").trim();
    if (!fullName) return;
    const count = monoQCount(emp.marks, report.dayNums);
    const hoursFromMarks = count.extraHoursFromMarks || 0;
    const hours = monoQHoras(emp.horasExtras) + hoursFromMarks;
    const hasMark = Object.keys(emp.marks || {}).some((day) => Number(emp.marks[day]) > 0);
    if (!hasMark && !hours) return;
    const volaos = count.volaoMarks * sheetMeta.volao;
    const extraPay = monoQMoney(hours * 60);
    let line = previous.get(monoQKey(fullName));
    if (!line) {
      line = {
        employeeId: emp.employeeId || "",
        fullName,
        position: String(emp.position || "").trim() || sheetMeta.label,
        daysWorked: String(count.days),
        salaryMonthly: 24000,
        salaryQuincena: 0,
        sfs: 800,
        uniformes: 115,
        rifa: 85,
        volaos,
        adelantos: 0,
        prestamos: 0,
        incentivos: 0,
        horasExtras: 0,
        almuerzo: 0,
        feriado: 0,
      };
    }
    const keepPrestamos = Math.max(0, Number(line.prestamos) || 0);
    const keepAdelantos = Math.max(0, Number(line.adelantos) || 0);
    const keepIncentivos = Math.max(0, Number(line.incentivos) || 0);
    const keepAlmuerzo = Math.max(0, Number(line.almuerzo) || 0);
    const keepFeriado = Math.max(0, Number(line.feriado) || 0);
    const keepSfs = !!line.sfsManual;
    const keepHex = !!line.horasExtrasManual;
    const prevExtra = Math.max(0, Number(line.monoExtraPay) || 0);
    const manualBase = keepHex ? Math.max(0, (Number(line.horasExtras) || 0) - prevExtra) : 0;
    if (emp.position) line.position = String(emp.position).trim();
    line.fullName = fullName;
    line.daysWorked = String(count.days);
    line.daysFromMonorriel = true;
    line.volaos = volaos;
    line.horasExtras = keepHex ? manualBase : 0;
    line.horasExtrasManual = keepHex;
    if (!line.quincenaManual) line.salaryQuincena = 0;
    let next = typeof computePayrollLineTotals === "function"
      ? computePayrollLineTotals({
          ...line,
          volaos,
          horasExtras: keepHex ? manualBase : 0,
          horasExtrasManual: keepHex,
          salaryQuincena: line.quincenaManual ? line.salaryQuincena : 0,
        }, opts)
      : line;
    const baseExtras = keepHex ? manualBase : Math.max(0, Number(next.horasExtras) || 0);
    const finalExtras = monoQMoney(baseExtras + extraPay);
    if (typeof computePayrollLineTotals === "function") {
      next = computePayrollLineTotals({
        ...next,
        volaos,
        horasExtras: finalExtras,
        horasExtrasManual: keepHex,
      }, opts);
    }
    next.volaos = volaos;
    next.horasExtras = finalExtras;
    next.horasExtrasManual = keepHex;
    next.monoExtraHours = hours;
    next.monoExtraPay = extraPay;
    next.prestamos = keepPrestamos;
    next.adelantos = keepAdelantos;
    next.incentivos = keepIncentivos;
    next.almuerzo = keepAlmuerzo;
    next.feriado = keepFeriado;
    if (keepSfs) next.sfs = Math.max(0, Number(line.sfs) || 0);
    next.sfsManual = keepSfs;
    next.daysWorked = String(count.days);
    next.daysFromMonorriel = true;
    next.sentFromMonorriel = true;
    nextLines.push({ ...line, ...next });
  });
  if (!nextLines.length) {
    if (typeof toast === "function") toast("Esta planilla no tiene días ni horas para enviar.");
    return { ok: false, touched: 0 };
  }
  nextLines.sort((a, b) => String(a.fullName).localeCompare(String(b.fullName), "es"));
  p.lines = nextLines;
  p.rosterFromMonorriel = true;
  p.updatedAt = new Date().toISOString();
  if (typeof saveContabilidadData === "function") saveContabilidadData(true);
  if (typeof renderNominaTab === "function") renderNominaTab();
  if (typeof toast === "function") {
    toast(`${sheetMeta.label}: quedaron ${nextLines.length} del reporte. Los nombres viejos se quitaron.`);
  }
  return { ok: true, touched: nextLines.length };
}

if (typeof window !== "undefined") {
  window.buildMonorrielQuincenasFromDaily = buildMonorrielQuincenasFromDaily;
  window.monorrielQuincenasForCloud = monorrielQuincenasForCloud;
  window.applyRemoteMonorrielQuincenas = applyRemoteMonorrielQuincenas;
  window.renderMonorrielQuincenaModule = renderMonorrielQuincenaModule;
  window.llenarMonorrielNominaDesdeReporte = llenarMonorrielNominaDesdeReporte;
  window.enviarMonorrielPlanillaANomina = enviarMonorrielPlanillaANomina;
  window.monoQMerge = monoQMerge;
  window.monoQPreserveLocalDeletes = monoQPreserveLocalDeletes;
  window.monoQDataBanScore = monoQDataBanScore;
  window.monoQDataMarkScore = monoQDataMarkScore;
  window.restoreMonoQFromSafetyNet = restoreMonoQFromSafetyNet;
  window.syncMonorrielQuincenasPacked = syncMonorrielQuincenasPacked;
  window.undoMonoQStep = undoMonoQStep;
}
