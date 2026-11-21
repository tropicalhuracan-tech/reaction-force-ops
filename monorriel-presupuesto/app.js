/** Clave distinta a la app principal Monorriel / nómina (mismo dominio = mismo localStorage). */
const STORAGE_KEY = "rfs-presupuesto-diario-monorriel-v1";
const LEGACY_STORAGE_KEYS = [
  "rfs-presupuesto-diario-monorriel-v1",
  "rfs-monorriel-presupuesto-v3",
  "rfs-monorriel-presupuesto-v2",
  "rfs-monorriel-presupuesto-v1",
];
const FERIADO_PAY = 800;
/** Keys "dia:puestos:0" while the roster name field is open */
const nameEditKeys = new Set();
/** Keys "dia:puestos:0" while the employee name field is open */
const employeeEditKeys = new Set();

const RATES = {
  dia: { puestos: 23, puestoPay: 1000, motos: 3, motoPay: 1153 },
  noche: { puestos: 24, puestoPay: 1040, motos: 3, motoPay: 1153 },
};

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 0 });
}

function emptySlot() {
  return { employee: "", paidDays: {}, feriado: false };
}

function emptyRosterShift(shift) {
  const r = RATES[shift];
  return {
    puestos: Array.from({ length: r.puestos }, () => ""),
    motos: Array.from({ length: r.motos }, () => ""),
  };
}

function emptyRoster() {
  return { dia: emptyRosterShift("dia"), noche: emptyRosterShift("noche") };
}

function ensureRosterNames(arr, len) {
  const out = (Array.isArray(arr) ? arr : []).slice(0, len).map((s) => String(s || "").trim());
  while (out.length < len) out.push("");
  return out;
}

function rosterEditKey(shift, kind, idx) {
  return `${shift}:${kind}:${idx}`;
}

function rosterName(shift, kind, idx) {
  if (!state.roster?.[shift]?.[kind]) return "";
  return String(state.roster[shift][kind][idx] || "").trim();
}

function setRosterName(shift, kind, idx, value) {
  state.roster[shift][kind][idx] = String(value || "").trim();
}

function employeeEditKey(shift, kind, idx) {
  return `${shift}:${kind}:${idx}`;
}

function workDateParts(st = state) {
  const raw = st.date || new Date().toISOString().slice(0, 10);
  const dom = Number(String(raw).split("-")[2]) || new Date().getDate();
  return { iso: raw, dom };
}

function workDayNumber() {
  return workDateParts().dom;
}

function quincenaBounds(st = state) {
  const q2 = st.quincena === 2;
  return { start: q2 ? 16 : 1, end: q2 ? 30 : 15 };
}

/** Ajusta quincena y «días contados» según la fecha de trabajo (hasta hoy en la quincena). */
function syncQuincenaFromWorkDate(st = state) {
  const { dom } = workDateParts(st);
  if (dom >= 16) st.quincena = 2;
  else if (dom >= 1 && dom <= 15) st.quincena = 1;
  const { start, end } = quincenaBounds(st);
  const last = Math.min(end, Math.max(start, dom));
  const elapsed = Math.min(15, Math.max(1, last - start + 1));
  st.daysDiaQ = elapsed;
  st.daysNocheQ = elapsed;
}

function quincenaDaysUpToWorkDate(st = state) {
  const { dom } = workDateParts(st);
  const { start, end } = quincenaBounds(st);
  const last = Math.min(end, dom);
  if (last < start) return [];
  const startQ = st.quincena === 2 ? 16 : 1;
  const nums = Array.from({ length: 15 }, (_, i) => startQ + i);
  return nums.filter((d) => d >= start && d <= last);
}

function snapshotShiftsFrom(st) {
  return {
    dia: migrateShift(st.dia, "dia"),
    noche: migrateShift(st.noche, "noche"),
  };
}

function saveReportForDate(iso, st = state) {
  if (!iso) return;
  if (!st.reports) st.reports = {};
  st.reports[iso] = snapshotShiftsFrom(st);
}

function loadReportForDate(iso, st = state) {
  const rep = st.reports?.[iso];
  st.dia = rep?.dia ? migrateShift(rep.dia, "dia") : emptyShiftState("dia");
  st.noche = rep?.noche ? migrateShift(rep.noche, "noche") : emptyShiftState("noche");
}

function getReportSnapshot(iso) {
  if (iso === state.date) return snapshotShiftsFrom(state);
  const rep = state.reports?.[iso];
  if (!rep) return { dia: emptyShiftState("dia"), noche: emptyShiftState("noche") };
  return {
    dia: migrateShift(rep.dia, "dia"),
    noche: migrateShift(rep.noche, "noche"),
  };
}

function reportDatesInQuincena(st = state) {
  const { start, end } = quincenaBounds(st);
  const dates = new Set(Object.keys(st.reports || {}));
  if (st.date) dates.add(st.date);
  return [...dates]
    .filter((iso) => {
      const dom = Number(String(iso).split("-")[2]);
      return dom >= start && dom <= end;
    })
    .sort();
}

function switchWorkDate(nextIso) {
  const prev = state.date;
  if (prev && prev !== nextIso) saveReportForDate(prev);
  state.date = nextIso;
  syncQuincenaFromWorkDate();
  loadReportForDate(nextIso);
}

function normalizeReports(raw, merged) {
  const out = raw && typeof raw === "object" ? { ...raw } : {};
  const iso = merged.date || new Date().toISOString().slice(0, 10);
  if (!out[iso]) out[iso] = { dia: merged.dia, noche: merged.noche };
  return out;
}

function employeeName(shift, kind, idx) {
  const slot = state[shift]?.[kind]?.[idx];
  if (!slot) return "";
  return String(slot.employee ?? "").trim();
}

function setEmployeeName(shift, kind, idx, value) {
  const slot = state[shift]?.[kind]?.[idx];
  if (!slot) return;
  slot.employee = String(value || "").trim();
}

function ensureEmployeeMeta(parsed) {
  const employeeLast = { dia: emptyRoster(), noche: emptyRoster() };
  const employeeHistory = {
    dia: emptyRosterHistorySlots("dia"),
    noche: emptyRosterHistorySlots("noche"),
  };
  if (parsed?.employeeLast) {
    employeeLast.dia.puestos = ensureRosterNames(parsed.employeeLast.dia?.puestos, RATES.dia.puestos);
    employeeLast.dia.motos = ensureRosterNames(parsed.employeeLast.dia?.motos, RATES.dia.motos);
    employeeLast.noche.puestos = ensureRosterNames(parsed.employeeLast.noche?.puestos, RATES.noche.puestos);
    employeeLast.noche.motos = ensureRosterNames(parsed.employeeLast.noche?.motos, RATES.noche.motos);
  }
  if (parsed?.employeeHistory) {
    employeeHistory.dia = ensureRosterHistorySlots(parsed.employeeHistory.dia, "dia");
    employeeHistory.noche = ensureRosterHistorySlots(parsed.employeeHistory.noche, "noche");
  }
  return { employeeLast, employeeHistory };
}

function employeeHistoryOptions(shift, kind, idx) {
  const hist = state.employeeHistory?.[shift]?.[kind]?.[idx];
  const last = state.employeeLast?.[shift]?.[kind]?.[idx];
  const cur = employeeName(shift, kind, idx);
  const uniq = [];
  [cur, last, ...(hist || [])].forEach((n) => {
    const t = String(n || "").trim();
    if (t && !uniq.includes(t)) uniq.push(t);
  });
  return uniq;
}

function employeeInputPlaceholder(shift, kind, idx) {
  const last = state.employeeLast?.[shift]?.[kind]?.[idx];
  const puesto = rosterName(shift, kind, idx);
  if (last) return `Empleado (último aquí: ${last})`;
  return puesto ? `Quién cubrió ${puesto}` : "Nombre del empleado";
}

function commitEmployeeName(shift, kind, idx, rawValue) {
  const prev = employeeName(shift, kind, idx);
  const next = String(rawValue ?? "").trim();
  if (prev && prev !== next) {
    if (!state.employeeLast) state.employeeLast = { dia: emptyRoster(), noche: emptyRoster() };
    if (!state.employeeHistory) {
      state.employeeHistory = {
        dia: emptyRosterHistorySlots("dia"),
        noche: emptyRosterHistorySlots("noche"),
      };
    }
    state.employeeLast[shift][kind][idx] = prev;
    const list = state.employeeHistory[shift][kind][idx];
    [prev, next].filter(Boolean).forEach((n) => {
      const i = list.indexOf(n);
      if (i >= 0) list.splice(i, 1);
      list.unshift(n);
    });
    while (list.length > 8) list.pop();
  }
  setEmployeeName(shift, kind, idx, next);
}

function emptyRosterHistorySlots(shift) {
  const r = RATES[shift];
  return {
    puestos: Array.from({ length: r.puestos }, () => []),
    motos: Array.from({ length: r.motos }, () => []),
  };
}

function ensureRosterHistorySlots(raw, shift) {
  const r = RATES[shift];
  const base = emptyRosterHistorySlots(shift);
  if (!raw) return base;
  ["puestos", "motos"].forEach((kind) => {
    const len = kind === "puestos" ? r.puestos : r.motos;
    const src = raw[kind];
    if (!Array.isArray(src)) return;
    for (let i = 0; i < len; i++) {
      base[kind][i] = (Array.isArray(src[i]) ? src[i] : [])
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .slice(0, 8);
    }
  });
  return base;
}

function ensureRosterMeta(parsed) {
  const rosterLast = { dia: emptyRoster(), noche: emptyRoster() };
  const rosterHistory = {
    dia: emptyRosterHistorySlots("dia"),
    noche: emptyRosterHistorySlots("noche"),
  };
  if (parsed?.rosterLast) {
    rosterLast.dia.puestos = ensureRosterNames(parsed.rosterLast.dia?.puestos, RATES.dia.puestos);
    rosterLast.dia.motos = ensureRosterNames(parsed.rosterLast.dia?.motos, RATES.dia.motos);
    rosterLast.noche.puestos = ensureRosterNames(parsed.rosterLast.noche?.puestos, RATES.noche.puestos);
    rosterLast.noche.motos = ensureRosterNames(parsed.rosterLast.noche?.motos, RATES.noche.motos);
  }
  if (parsed?.rosterHistory) {
    rosterHistory.dia = ensureRosterHistorySlots(parsed.rosterHistory.dia, "dia");
    rosterHistory.noche = ensureRosterHistorySlots(parsed.rosterHistory.noche, "noche");
  }
  return { rosterLast, rosterHistory };
}

function rosterHistoryOptions(shift, kind, idx) {
  const hist = state.rosterHistory?.[shift]?.[kind]?.[idx];
  const last = state.rosterLast?.[shift]?.[kind]?.[idx];
  const cur = rosterName(shift, kind, idx);
  const uniq = [];
  [cur, last, ...(hist || [])].forEach((n) => {
    const t = String(n || "").trim();
    if (t && !uniq.includes(t)) uniq.push(t);
  });
  return uniq;
}

function rosterInputPlaceholder(shift, kind, idx) {
  const last = state.rosterLast?.[shift]?.[kind]?.[idx];
  if (last) return `Nombre del puesto (último aquí: ${last})`;
  return "Nombre del puesto (ej. garita, motor 2)";
}

function commitRosterName(shift, kind, idx, rawValue) {
  const prev = rosterName(shift, kind, idx);
  const next = String(rawValue ?? "").trim();
  if (prev && prev !== next) {
    if (!state.rosterLast) state.rosterLast = { dia: emptyRoster(), noche: emptyRoster() };
    if (!state.rosterHistory) {
      state.rosterHistory = {
        dia: emptyRosterHistorySlots("dia"),
        noche: emptyRosterHistorySlots("noche"),
      };
    }
    state.rosterLast[shift][kind][idx] = prev;
    const list = state.rosterHistory[shift][kind][idx];
    [prev, next].filter(Boolean).forEach((n) => {
      const i = list.indexOf(n);
      if (i >= 0) list.splice(i, 1);
      list.unshift(n);
    });
    while (list.length > 8) list.pop();
  }
  setRosterName(shift, kind, idx, next);
}

function migrateRoster(parsed) {
  const base = emptyRoster();
  if (parsed?.roster) {
    base.dia.puestos = ensureRosterNames(parsed.roster.dia?.puestos, RATES.dia.puestos);
    base.dia.motos = ensureRosterNames(parsed.roster.dia?.motos, RATES.dia.motos);
    base.noche.puestos = ensureRosterNames(parsed.roster.noche?.puestos, RATES.noche.puestos);
    base.noche.motos = ensureRosterNames(parsed.roster.noche?.motos, RATES.noche.motos);
  }
  for (const shift of ["dia", "noche"]) {
    const slots = parsed?.[shift];
    if (!slots) continue;
    (slots.puestos || []).forEach((slot, i) => {
      const n = slot && typeof slot === "object" ? slot.name : slot;
      if (!base[shift].puestos[i] && n) base[shift].puestos[i] = String(n).trim();
    });
    (slots.motos || []).forEach((slot, i) => {
      const n = slot && typeof slot === "object" ? slot.name : slot;
      if (!base[shift].motos[i] && n) base[shift].motos[i] = String(n).trim();
    });
  }
  return base;
}

function shiftMaxBudget(shift) {
  const r = RATES[shift];
  return r.puestos * r.puestoPay + r.motos * r.motoPay;
}

function normalizeSlot(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      employee: String(raw.employee ?? "").trim(),
      paidDays: raw.paidDays && typeof raw.paidDays === "object" ? { ...raw.paidDays } : {},
      feriado: !!raw.feriado,
    };
  }
  if (typeof raw === "string") {
    return { employee: String(raw || "").trim(), paidDays: {}, feriado: false };
  }
  return emptySlot();
}

function ensureSlots(arr, len) {
  const out = (Array.isArray(arr) ? arr : []).slice(0, len).map(normalizeSlot);
  while (out.length < len) out.push(emptySlot());
  return out;
}

function emptyShiftState(shift) {
  const r = RATES[shift];
  return {
    puestos: Array.from({ length: r.puestos }, () => emptySlot()),
    motos: Array.from({ length: r.motos }, () => emptySlot()),
    feriadoQuincena: false,
  };
}

function emptyState() {
  const date = new Date().toISOString().slice(0, 10);
  const dia = emptyShiftState("dia");
  const noche = emptyShiftState("noche");
  return {
    date,
    roster: emptyRoster(),
    reports: { [date]: { dia, noche } },
    dia,
    noche,
    daysDiaQ: 15,
    daysNocheQ: 15,
    quincena: 1,
  };
}

function migrateShift(s, shift) {
  if (!s || typeof s !== "object") return emptyShiftState(shift);
  const r = RATES[shift];
  return {
    feriadoQuincena: !!s.feriadoQuincena,
    puestos: ensureSlots(s.puestos, r.puestos),
    motos: ensureSlots(s.motos, r.motos),
  };
}

function loadState() {
  try {
    let raw = null;
    for (const key of LEGACY_STORAGE_KEYS) {
      raw = localStorage.getItem(key);
      if (raw) break;
    }
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    const base = emptyState();
    const merged = {
      ...base,
      ...s,
      dia: migrateShift(s.dia, "dia"),
      noche: migrateShift(s.noche, "noche"),
    };
    merged.roster = migrateRoster(merged);
    const meta = ensureRosterMeta(merged);
    merged.rosterLast = meta.rosterLast;
    merged.rosterHistory = meta.rosterHistory;
    const empMeta = ensureEmployeeMeta(merged);
    merged.employeeLast = empMeta.employeeLast;
    merged.employeeHistory = empMeta.employeeHistory;
    merged.reports = normalizeReports(s.reports, merged);
    syncQuincenaFromWorkDate(merged);
    loadReportForDate(merged.date, merged);
    return merged;
  } catch (_) {
    return emptyState();
  }
}

let state = loadState();
syncQuincenaFromWorkDate();

function saveState() {
  saveReportForDate(state.date);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function quincenaDayNumbers() {
  const n = 15;
  const start = state.quincena === 2 ? 16 : 1;
  return Array.from({ length: n }, (_, i) => start + i);
}

function shiftWorkDays(shift) {
  return Math.min(15, Math.max(0, Number(shift === "dia" ? state.daysDiaQ : state.daysNocheQ) || 0));
}

function usedBudgetToday(shift) {
  const r = RATES[shift];
  const slots = state[shift];
  let u = 0;
  slots.puestos.forEach((_, i) => {
    if (employeeName(shift, "puestos", i)) u += r.puestoPay;
  });
  slots.motos.forEach((_, i) => {
    if (employeeName(shift, "motos", i)) u += r.motoPay;
  });
  return u;
}

function slotRate(shift, kind) {
  const r = RATES[shift];
  return kind === "motos" ? r.motoPay : r.puestoPay;
}

/** Ganado en quincena = un reporte guardado con empleado en este puesto × tarifa. */
function computeSlotQuincenaTotals(shift, kind, idx) {
  const rate = slotRate(shift, kind);
  let adelantado = 0;
  let pendiente = 0;
  let daysPaid = 0;
  let daysPending = 0;
  let appearances = 0;
  const paidList = [];
  let feriadoOn = false;
  reportDatesInQuincena().forEach((iso) => {
    const snap = getReportSnapshot(iso);
    const slot = snap[shift]?.[kind]?.[idx];
    if (!slot) return;
    const emp = String(slot.employee || "").trim();
    if (!emp) return;
    appearances += 1;
    const dom = Number(iso.split("-")[2]);
    const key = String(dom);
    if (slot.paidDays?.[key]) {
      adelantado += rate;
      daysPaid += 1;
      paidList.push(dom);
    } else {
      pendiente += rate;
      daysPending += 1;
    }
    if (snap[shift].feriadoQuincena && slot.feriado) feriadoOn = true;
  });
  if (!appearances) return null;
  const feriado = feriadoOn ? FERIADO_PAY : 0;
  pendiente += feriado;
  return {
    total: adelantado + pendiente,
    adelantado,
    pendiente,
    feriado,
    feriadoOn,
    daysPaid,
    daysPending,
    dayCount: appearances,
    appearances,
    paidList,
  };
}

function renderEmployeeEarningsSummary(shift, kind, idx) {
  const t = computeSlotQuincenaTotals(shift, kind, idx);
  if (!t || !t.dayCount) {
    return `<span class="employee-earnings muted">Sin días en el reporte</span>`;
  }
  const title = `${t.appearances} reporte(s) con empleado en la quincena · ${t.daysPaid} pagado · ${t.daysPending} pendiente${
    t.feriadoOn ? ` · feriado ${money(t.feriado)}` : ""
  }`;
  return `<span class="employee-earnings" title="${escapeAttr(title)}">
    <span class="earn-total">Ganado ${money(t.total)}</span>
    <span class="earn-sep">·</span>
    <span class="earn-paid">Pagado ${money(t.adelantado)}</span>
    <span class="earn-sep">·</span>
    <span class="earn-rest">Resta ${money(t.pendiente)}</span>
  </span>`;
}

function computeShiftQuincena(shift) {
  const slots = state[shift];
  const workDays = shiftWorkDays(shift);
  const days = quincenaDayNumbers().slice(0, workDays);
  let pendiente = 0;
  let adelantado = 0;
  let feriado = 0;
  const feriadoOn = !!slots.feriadoQuincena;

  function walk(list, kind) {
    list.forEach((_, idx) => {
      const t = computeSlotQuincenaTotals(shift, kind, idx);
      if (!t) return;
      adelantado += t.adelantado;
      pendiente += t.pendiente;
      if (t.feriadoOn) feriado += t.feriado;
    });
  }
  walk(slots.puestos, "puestos");
  walk(slots.motos, "motos");
  return { pendiente, adelantado, feriado, total: pendiente + adelantado + feriado };
}

function renderRates() {
  const diaMax = shiftMaxBudget("dia");
  const nocheMax = shiftMaxBudget("noche");
  const both = diaMax + nocheMax;
  document.getElementById("ratesGrid").innerHTML = `
    <div class="stat"><span>Turno día (23×1,000 + 3×1,153)</span><div class="val">${money(diaMax)}</div><span class="hint">por día al límite</span></div>
    <div class="stat"><span>Turno noche (24×1,040 + 3×1,153)</span><div class="val">${money(nocheMax)}</div><span class="hint">por día al límite</span></div>
    <div class="stat"><span>Día + noche mismo día</span><div class="val">${money(both)}</div><span class="hint">tope si operan ambos</span></div>
    <div class="stat"><span>Feriado quincena (por empleado)</span><div class="val">${money(FERIADO_PAY)}</div><span class="hint">si marca feriado en la fila</span></div>
    <div class="stat"><span>Quincena 15 días (tope)</span><div class="val">${money(diaMax * 15)} / ${money(nocheMax * 15)}</div></div>
    <div class="stat"><span>Mes 30 días (sin 31)</span><div class="val">${money(both * 30)}</div></div>
  `;
}

function renderDayGrid(shift, kind, idx, slot) {
  if (!employeeName(shift, kind, idx)) return "";
  const dayNum = workDayNumber();
  const paid = !!slot.paidDays[String(dayNum)];
  const cell = `<button type="button" class="day-cell day-today${paid ? " day-paid" : ""}" title="${
    paid ? "Pagado adelantado — doble clic quita" : "Doble clic = pagado adelantado (este reporte)"
  }" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" data-day="${dayNum}">${dayNum}</button>`;
  return `<div class="day-grid" aria-label="Día de este reporte"><span class="day-grid-lbl muted">Este reporte · día</span>${cell}</div>`;
}

function escapeText(s) {
  return escapeAttr(s);
}

function renderNameBlock(shift, kind, idx) {
  const name = rosterName(shift, kind, idx);
  const key = rosterEditKey(shift, kind, idx);
  const editing = nameEditKeys.has(key) || !name;
  const listId = `roster-dl-${shift}-${kind}-${idx}`;
  const options = rosterHistoryOptions(shift, kind, idx)
    .map((n) => `<option value="${escapeAttr(n)}"></option>`)
    .join("");
  const idxBadge = `<span class="slot-idx" title="Número de casilla">#${idx + 1}</span>`;
  if (editing) {
    return `<div class="roster-row editing">
      ${idxBadge}
      <input type="text" class="roster-input" list="${listId}" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" value="${escapeAttr(
      name
    )}" placeholder="${escapeAttr(rosterInputPlaceholder(shift, kind, idx))}" autofocus />
      <datalist id="${listId}">${options}</datalist>
      <button type="button" class="btn-icon btn-done" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Guardar nombre del puesto">✓</button>
    </div>`;
  }
  return `<div class="roster-row">
    <strong class="roster-name">${escapeText(name)}</strong>
    ${idxBadge}
    <button type="button" class="btn-icon btn-edit" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Cambiar nombre del puesto" aria-label="Editar puesto">✎</button>
  </div>`;
}

function finishRosterEdit(shift, kind, idx, inputEl) {
  commitRosterName(shift, kind, idx, inputEl ? inputEl.value : rosterName(shift, kind, idx));
  nameEditKeys.delete(rosterEditKey(shift, kind, idx));
  saveState();
  renderShift(shift);
  renderProjection();
}

function renderEmployeeBlock(shift, kind, idx) {
  const ename = employeeName(shift, kind, idx);
  const key = employeeEditKey(shift, kind, idx);
  const editing = employeeEditKeys.has(key) || !ename;
  const listId = `emp-dl-${shift}-${kind}-${idx}`;
  const options = employeeHistoryOptions(shift, kind, idx)
    .map((n) => `<option value="${escapeAttr(n)}"></option>`)
    .join("");
  if (editing) {
    return `<div class="employee-row editing">
      <span class="employee-label">Empleado</span>
      <input type="text" class="employee-input" list="${listId}" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" value="${escapeAttr(
      ename
    )}" placeholder="${escapeAttr(employeeInputPlaceholder(shift, kind, idx))}" />
      <datalist id="${listId}">${options}</datalist>
      <button type="button" class="btn-icon btn-emp-done" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Guardar empleado">✓</button>
      ${renderEmployeeEarningsSummary(shift, kind, idx)}
    </div>`;
  }
  return `<div class="employee-row">
    <span class="employee-label">Empleado</span>
    <strong class="employee-name">${escapeText(ename) || "—"}</strong>
    <button type="button" class="btn-icon btn-emp-edit" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Cambiar empleado" aria-label="Editar empleado">✎</button>
    ${renderEmployeeEarningsSummary(shift, kind, idx)}
  </div>`;
}

function finishEmployeeEdit(shift, kind, idx, inputEl) {
  commitEmployeeName(shift, kind, idx, inputEl ? inputEl.value : employeeName(shift, kind, idx));
  employeeEditKeys.delete(employeeEditKey(shift, kind, idx));
  saveState();
  renderShift(shift);
  renderProjection();
}

function bindRosterUi(panel, shift) {
  panel.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      nameEditKeys.add(rosterEditKey(btn.dataset.shift, btn.dataset.kind, Number(btn.dataset.idx)));
      renderShift(shift);
    });
  });
  panel.querySelectorAll(".btn-done").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = panel.querySelector(
        `.roster-input[data-shift="${btn.dataset.shift}"][data-kind="${btn.dataset.kind}"][data-idx="${btn.dataset.idx}"]`
      );
      finishRosterEdit(btn.dataset.shift, btn.dataset.kind, Number(btn.dataset.idx), inp);
    });
  });
  panel.querySelectorAll(".roster-input").forEach((inp) => {
    const commit = () => finishRosterEdit(inp.dataset.shift, inp.dataset.kind, Number(inp.dataset.idx), inp);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        nameEditKeys.delete(rosterEditKey(inp.dataset.shift, inp.dataset.kind, Number(inp.dataset.idx)));
        renderShift(shift);
      }
    });
    inp.addEventListener("blur", () => {
      setTimeout(() => commit(), 120);
    });
  });
}

function bindEmployeeUi(panel, shift) {
  panel.querySelectorAll(".btn-emp-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      employeeEditKeys.add(employeeEditKey(btn.dataset.shift, btn.dataset.kind, Number(btn.dataset.idx)));
      renderShift(shift);
    });
  });
  panel.querySelectorAll(".btn-emp-done").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = panel.querySelector(
        `.employee-input[data-shift="${btn.dataset.shift}"][data-kind="${btn.dataset.kind}"][data-idx="${btn.dataset.idx}"]`
      );
      finishEmployeeEdit(btn.dataset.shift, btn.dataset.kind, Number(btn.dataset.idx), inp);
    });
  });
  panel.querySelectorAll(".employee-input").forEach((inp) => {
    const commit = () => finishEmployeeEdit(inp.dataset.shift, inp.dataset.kind, Number(inp.dataset.idx), inp);
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") {
        employeeEditKeys.delete(employeeEditKey(inp.dataset.shift, inp.dataset.kind, Number(inp.dataset.idx)));
        renderShift(shift);
      }
    });
    inp.addEventListener("blur", () => {
      setTimeout(() => commit(), 120);
    });
  });
}

function renderShift(shift) {
  const panel = document.getElementById(shift === "dia" ? "panelDia" : "panelNoche");
  const r = RATES[shift];
  const slots = state[shift];
  const maxShift = shiftMaxBudget(shift);
  const used = usedBudgetToday(shift);
  const left = maxShift - used;
  const q = computeShiftQuincena(shift);
  const title = shift === "dia" ? "Turno de día" : "Turno de noche";
  const feriadoLabel = slots.feriadoQuincena ? "Quitar feriado quincena" : `Feriado quincena (RD$ ${FERIADO_PAY} por empleado marcado)`;

  const repDate = state.date || new Date().toISOString().slice(0, 10);
  let html = `
    <h2>${title} <span class="report-date-badge">Reporte ${escapeHtml(repDate)}</span></h2>
    <div class="toolbar">
      <button type="button" class="btn secondary btn-feriado" data-shift="${shift}">${feriadoLabel}</button>
      <span class="muted toolbar-hint">Cada <strong>fecha</strong> es un reporte aparte. Cambiar fecha guarda y abre otro día. <strong>Ganado</strong> (al lado del ✎) suma todos los reportes de la quincena.</span>
    </div>
    <div class="budget-bar">
      <div><span>Presupuesto del día (lista)</span><strong>${money(maxShift)}</strong></div>
      <div><span>Gasto hoy (con empleado)</span><strong>${money(used)}</strong></div>
      <div><span>Disponible hoy</span><strong class="${left < 0 ? "over" : "ok"}">${money(left)}</strong></div>
      <div><span>Quincena pendiente</span><strong>${money(q.pendiente + q.feriado)}</strong></div>
      <div><span>Pagado adelantado</span><strong class="paid-adv">${money(q.adelantado)}</strong></div>
    </div>
    <h3 class="section-title">Puestos (${r.puestos} × ${money(r.puestoPay)})</h3>
    <div class="slot-grid wide">
  `;
  slots.puestos.forEach((slot, i) => {
    const ename = employeeName(shift, "puestos", i);
    const slotQ = computeSlotQuincenaTotals(shift, "puestos", i);
    html += `<div class="slot slot-wide">
      <div class="slot-head">
        ${renderNameBlock(shift, "puestos", i)}
        ${
          slotQ && slots.feriadoQuincena
            ? `<label class="feriado-chk"><input type="checkbox" data-shift="${shift}" data-kind="puestos" data-idx="${i}" data-f="feriado"${
                slot.feriado ? " checked" : ""
              } /> Feriado</label>`
            : ""
        }
      </div>
      ${rosterName(shift, "puestos", i) ? renderEmployeeBlock(shift, "puestos", i) : ""}
      ${rosterName(shift, "puestos", i) ? renderDayGrid(shift, "puestos", i, slot) : ""}
    </div>`;
  });
  html += `</div>
    <h3 class="section-title">Motorizados (${r.motos} × ${money(r.motoPay)})</h3>
    <div class="slot-grid wide">`;
  slots.motos.forEach((slot, i) => {
    const ename = employeeName(shift, "motos", i);
    const slotQ = computeSlotQuincenaTotals(shift, "motos", i);
    html += `<div class="slot slot-wide moto">
      <div class="slot-head">
        ${renderNameBlock(shift, "motos", i)}
        ${
          slotQ && slots.feriadoQuincena
            ? `<label class="feriado-chk"><input type="checkbox" data-shift="${shift}" data-kind="motos" data-idx="${i}" data-f="feriado"${
                slot.feriado ? " checked" : ""
              } /> Feriado</label>`
            : ""
        }
      </div>
      ${rosterName(shift, "motos", i) ? renderEmployeeBlock(shift, "motos", i) : ""}
      ${rosterName(shift, "motos", i) ? renderDayGrid(shift, "motos", i, slot) : ""}
    </div>`;
  });
  html += "</div>";
  panel.innerHTML = html;

  bindRosterUi(panel, shift);
  bindEmployeeUi(panel, shift);

  panel.querySelectorAll("input[data-f='feriado']").forEach((inp) => {
    inp.addEventListener("change", () => {
      const sh = inp.dataset.shift;
      const kind = inp.dataset.kind;
      const idx = Number(inp.dataset.idx);
      state[sh][kind][idx].feriado = inp.checked;
      saveState();
      renderShift(sh);
      renderProjection();
    });
  });

  panel.querySelector(".btn-feriado")?.addEventListener("click", () => {
    state[shift].feriadoQuincena = !state[shift].feriadoQuincena;
    if (!state[shift].feriadoQuincena) {
      state[shift].puestos.forEach((s) => {
        s.feriado = false;
      });
      state[shift].motos.forEach((s) => {
        s.feriado = false;
      });
    }
    saveState();
    renderShift(shift);
    renderProjection();
  });

  panel.querySelectorAll(".day-cell").forEach((btn) => {
    btn.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const sh = btn.dataset.shift;
      const kind = btn.dataset.kind;
      const idx = Number(btn.dataset.idx);
      const day = String(btn.dataset.day);
      const slot = state[sh][kind][idx];
      if (slot.paidDays[day]) delete slot.paidDays[day];
      else slot.paidDays[day] = true;
      saveState();
      renderShift(sh);
      renderProjection();
    });
  });
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function escapeHtml(s) {
  return escapeAttr(s);
}

function slotQuincenaLine(shift, kind, idx) {
  const puesto = rosterName(shift, kind, idx);
  const emp = employeeName(shift, kind, idx);
  if (!emp) return "";
  const slot = state[shift][kind][idx];
  const rate = slotRate(shift, kind);
  const dom = workDayNumber();
  const paid = !!slot.paidDays[String(dom)];
  const feriadoOn = !!state[shift].feriadoQuincena && slot.feriado;
  const feriado = feriadoOn ? FERIADO_PAY : 0;
  const adelantado = paid ? rate : 0;
  let pendiente = paid ? 0 : rate;
  pendiente += feriado;
  const total = adelantado + pendiente;
  const paidTxt = paid ? String(dom) : "—";
  return `<tr>
    <td class="c">${idx + 1}</td>
    <td>${escapeHtml(puesto || "—")}</td>
    <td>${escapeHtml(emp)}</td>
    <td class="c">${feriadoOn ? "Sí" : "—"}</td>
    <td class="c">${paidTxt}</td>
    <td class="n">${money(total)}</td>
    <td class="n adv">${money(adelantado)}</td>
    <td class="n">${money(pendiente)}</td>
  </tr>`;
}

function buildShiftPrintBlock(shift, title) {
  const r = RATES[shift];
  const q = computeShiftQuincena(shift);
  const used = usedBudgetToday(shift);
  let rows = "";
  state[shift].puestos.forEach((_, i) => {
    rows += slotQuincenaLine(shift, "puestos", i);
  });
  state[shift].motos.forEach((_, i) => {
    rows += slotQuincenaLine(shift, "motos", i);
  });
  if (!rows) rows = `<tr><td colspan="8" class="c muted">Sin filas con empleado asignado</td></tr>`;
  return `
    <h2>${escapeHtml(title)}</h2>
    <p class="meta">Gasto hoy (plantilla llena): <strong>${money(used)}</strong> · Quincena pendiente: <strong>${money(
    q.pendiente + q.feriado
  )}</strong> · Adelantado: <strong>${money(q.adelantado)}</strong></p>
    <table class="pt">
      <thead><tr>
        <th>#</th><th>Puesto</th><th>Empleado</th><th>Feriado</th><th>Días adelant. (nº)</th><th>Ganado</th><th>Pagado</th><th>Resta</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="5" class="r"><strong>Subtotal ${escapeHtml(title)}</strong></td>
        <td class="n"><strong>${money(q.total)}</strong></td>
        <td class="n adv"><strong>${money(q.adelantado)}</strong></td>
        <td class="n"><strong>${money(q.pendiente + q.feriado)}</strong></td>
      </tr></tfoot>
    </table>`;
}

function buildPresupuestoPrintHtml() {
  const diaQ = computeShiftQuincena("dia");
  const nocheQ = computeShiftQuincena("noche");
  const qLabel = state.quincena === 2 ? "16 – 30" : "01 – 15";
  const fecha = state.date || new Date().toISOString().slice(0, 10);
  const pendTotal = diaQ.pendiente + diaQ.feriado + nocheQ.pendiente + nocheQ.feriado;
  const advTotal = diaQ.adelantado + nocheQ.adelantado;
  return `
    <div class="brand">
      <h1>Reaction Force Security</h1>
      <div>RFS — Presupuesto diario Monorriel</div>
    </div>
    <p class="meta"><strong>Fecha trabajo:</strong> ${escapeHtml(fecha)} · <strong>Quincena:</strong> ${escapeHtml(
    qLabel
  )} · Días contados: día ${shiftWorkDays("dia")}, noche ${shiftWorkDays("noche")}</p>
    ${buildShiftPrintBlock("dia", "Turno día")}
    ${buildShiftPrintBlock("noche", "Turno noche")}
    <div class="totals">
      <p><strong>Total pendiente de pago</strong> (quincena): ${money(pendTotal)}</p>
      <p><strong>Total pagado adelantado</strong>: ${money(advTotal)}</p>
      <p class="small">Feriado RD$ ${FERIADO_PAY} por puesto marcado. Día 31 no cuenta al mes.</p>
    </div>
    <p class="small foot">Generado ${new Date().toLocaleString("es-DO")} · RFS Presupuesto diario (local)</p>`;
}

function openPrintWindow(title, bodyHtml, options = {}) {
  const share = (options && options.share) || {};
  const win = window.open("", "_blank");
  if (!win) {
    alert("Permite ventanas emergentes para imprimir.");
    return null;
  }
  const shareText = String(share.text || title || "");
  const shareSubject = String(share.subject || title || "");
  const fileName = String(share.fileName || "rfs-presupuesto-diario-monorriel.pdf");
  const extraCss = options && options.extraCss ? String(options.extraCss) : "";
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;max-width:920px;margin:0 auto;font-size:11px;line-height:1.35}
  .print-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#111;color:#fff;padding:12px;margin:-22px -22px 18px}
  .print-bar button{padding:11px 14px;font-weight:800;border:0;border-radius:10px;cursor:pointer}
  .btn-back{background:#fff;color:#111}.btn-print{background:#d41414;color:#fff}.btn-wa{background:#25d366;color:#053b1a}.btn-mail{background:#3b82f6;color:#fff}.btn-pdf{background:#f5f5f5;color:#111}
  .status{font-size:12px;color:#fde68a;width:100%}
  #rfsPrintRoot{background:#fff;color:#111}
  @media print{.no-print{display:none!important}}
  ${extraCss}</style></head><body>
  <div class="print-bar no-print">
    <button class="btn-back" id="btnPrintBack" type="button">← Volver</button>
    <button class="btn-print" id="btnPrintNow" type="button">Imprimir</button>
    <button class="btn-wa" id="btnPrintWhatsApp" type="button">WhatsApp PDF</button>
    <button class="btn-mail" id="btnPrintEmail" type="button">Correo PDF</button>
    <button class="btn-pdf" id="btnPrintPdf" type="button">Descargar PDF</button>
    <div class="status" id="printShareStatus" hidden></div>
  </div>
  <div id="rfsPrintRoot">${bodyHtml}</div>
  <script>
    (function () {
      var shareCfg = {
        text: ${JSON.stringify(shareText)},
        subject: ${JSON.stringify(shareSubject)},
        fileName: ${JSON.stringify(fileName)}
      };
      function setStatus(msg) {
        var el = document.getElementById("printShareStatus");
        if (!el) return;
        if (!msg) { el.hidden = true; el.textContent = ""; return; }
        el.hidden = false;
        el.textContent = msg;
      }
      function loadPdfLib() {
        if (window.html2pdf) return Promise.resolve(window.html2pdf);
        return new Promise(function (resolve, reject) {
          var s = document.createElement("script");
          s.src = "https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js";
          s.onload = function () {
            if (window.html2pdf) resolve(window.html2pdf);
            else reject(new Error("html2pdf"));
          };
          s.onerror = function () { reject(new Error("cdn")); };
          document.head.appendChild(s);
        });
      }
      function makePdfBlob() {
        var root = document.getElementById("rfsPrintRoot");
        if (!root) return Promise.reject(new Error("root"));
        return loadPdfLib().then(function (html2pdf) {
          var opt = {
            margin: [8, 8, 8, 8],
            filename: shareCfg.fileName || "monorriel.pdf",
            image: { type: "jpeg", quality: 0.92 },
            html2canvas: { scale: 2, useCORS: true, logging: false },
            jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
          };
          return html2pdf().set(opt).from(root).outputPdf("blob");
        });
      }
      function downloadBlob(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name || "monorriel.pdf";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }
      function tryNativeShare(file) {
        if (!navigator.share) return Promise.resolve(false);
        var payload = { title: shareCfg.subject || shareCfg.text, text: shareCfg.text, files: [file] };
        try {
          if (navigator.canShare && !navigator.canShare(payload)) {
            return navigator.share({ title: payload.title, text: payload.text }).then(function () { return true; });
          }
        } catch (e0) {}
        return navigator.share(payload).then(function () { return true; }).catch(function (err) {
          if (err && err.name === "AbortError") return true;
          return false;
        });
      }
      function sharePdf(mode) {
        setStatus("Generando PDF…");
        makePdfBlob().then(function (blob) {
          var file = new File([blob], shareCfg.fileName || "monorriel.pdf", { type: "application/pdf" });
          if (mode === "pdf") {
            downloadBlob(blob, file.name);
            setStatus("PDF descargado.");
            return;
          }
          return tryNativeShare(file).then(function (ok) {
            if (ok) {
              setStatus(mode === "wa" ? "Elige WhatsApp en el menú." : "Elige Correo / Gmail en el menú.");
              return;
            }
            downloadBlob(blob, file.name);
            if (mode === "wa") {
              window.open("https://wa.me/?text=" + encodeURIComponent(shareCfg.text || ""), "_blank");
              setStatus("PDF descargado. Adjúntalo en WhatsApp.");
            } else {
              window.location.href = "mailto:?subject=" + encodeURIComponent(shareCfg.subject || "") +
                "&body=" + encodeURIComponent(shareCfg.text || "");
              setStatus("PDF descargado. Adjúntalo al correo.");
            }
          });
        }).catch(function () {
          setStatus("No se pudo crear el PDF. Revisa conexión.");
        });
      }
      document.getElementById("btnPrintBack").onclick = function () { try { window.close(); } catch (e) {} };
      document.getElementById("btnPrintNow").onclick = function () { window.print(); };
      document.getElementById("btnPrintWhatsApp").onclick = function () { sharePdf("wa"); };
      document.getElementById("btnPrintEmail").onclick = function () { sharePdf("mail"); };
      document.getElementById("btnPrintPdf").onclick = function () { sharePdf("pdf"); };
    })();
  <\/script></body></html>`);
  win.document.close();
  return win;
}

function printAndSharePresupuesto() {
  saveState();
  const qLabel = state.quincena === 2 ? "16-30" : "01-15";
  const fecha = state.date || new Date().toISOString().slice(0, 10);
  const diaQ = computeShiftQuincena("dia");
  const nocheQ = computeShiftQuincena("noche");
  const pend = diaQ.pendiente + diaQ.feriado + nocheQ.pendiente + nocheQ.feriado;
  const title = `RFS Presupuesto diario — ${fecha} · Q ${qLabel}`;
  const text = `RFS Presupuesto diario Monorriel ${fecha} · Quincena ${qLabel}\nPendiente: ${money(pend)}\nAdelantado: ${money(diaQ.adelantado + nocheQ.adelantado)}\nReaction Force Security`;
  openPrintWindow(title, buildPresupuestoPrintHtml(), {
    share: {
      subject: title,
      text,
      fileName: `rfs-presupuesto-diario-monorriel-${fecha}-q${state.quincena}.pdf`,
    },
    extraCss: `
      .brand{border-bottom:3px solid #d41414;padding-bottom:8px;margin-bottom:12px}
      .brand h1{margin:0;font-size:18px;color:#d41414}
      .meta{color:#444;margin:0 0 10px}
      h2{font-size:14px;margin:16px 0 6px;color:#111}
      table.pt{width:100%;border-collapse:collapse;margin-bottom:8px}
      table.pt th,table.pt td{border:1px solid #ccc;padding:4px 5px;text-align:left}
      table.pt th{background:#f3f4f6;font-size:10px}
      table.pt td.c,table.pt th:nth-child(3),table.pt th:nth-child(4),table.pt th:nth-child(5){text-align:center}
      table.pt td.n,table.pt th:nth-child(6),table.pt th:nth-child(7),table.pt th:nth-child(8){text-align:right;white-space:nowrap}
      table.pt td.adv{color:#b91c1c}
      table.pt tfoot td.r{text-align:right}
      .totals{background:#fef3c7;border:1px solid #f59e0b;padding:10px;border-radius:6px;margin-top:12px}
      .small{font-size:10px;color:#555}
      .foot{margin-top:14px}
      @media print{
        .brand,.totals{-webkit-print-color-adjust:exact;print-color-adjust:exact}
        table.pt td.adv{color:#b91c1c!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      }
    `,
  });
}

function renderProjection() {
  const diaToday = usedBudgetToday("dia");
  const nocheToday = usedBudgetToday("noche");
  const diaQ = computeShiftQuincena("dia");
  const nocheQ = computeShiftQuincena("noche");
  const qLabel = state.quincena === 2 ? "16 – 30" : "01 – 15";

  document.getElementById("projectionGrid").innerHTML = `
    <div class="stat"><span>Hoy turno día</span><div class="val">${money(diaToday)}</div></div>
    <div class="stat"><span>Hoy turno noche</span><div class="val">${money(nocheToday)}</div></div>
    <div class="stat"><span>Quincena día — pendiente</span><div class="val">${money(diaQ.pendiente + diaQ.feriado)}</div></div>
    <div class="stat"><span>Quincena día — adelantado</span><div class="val paid-adv">${money(diaQ.adelantado)}</div></div>
    <div class="stat"><span>Quincena noche — pendiente</span><div class="val">${money(nocheQ.pendiente + nocheQ.feriado)}</div></div>
    <div class="stat"><span>Quincena noche — adelantado</span><div class="val paid-adv">${money(nocheQ.adelantado)}</div></div>
  `;

  document.getElementById("quincenaTotals").innerHTML = `
    <p><strong>Quincena ${qLabel}</strong> · días contados: día ${shiftWorkDays("dia")}, noche ${shiftWorkDays(
    "noche"
  )}</p>
    <ul>
      <li><strong>Pendiente de pago</strong> (días no rojos + feriado): ${money(
    diaQ.pendiente + diaQ.feriado + nocheQ.pendiente + nocheQ.feriado
  )}</li>
      <li><strong>Pagado adelantado</strong> (días rojos): ${money(diaQ.adelantado + nocheQ.adelantado)}</li>
      <li>Feriado incluido arriba: día ${money(diaQ.feriado)} · noche ${money(nocheQ.feriado)}</li>
    </ul>
    <p class="hint">El día 31 del mes no entra en el mes. Los días rojos no suman al pendiente; cuentan como ya pagados en la quincena.</p>
  `;
}

function bindUi() {
  document.getElementById("workDate").value = state.date || new Date().toISOString().slice(0, 10);
  document.getElementById("daysDiaQ").value = state.daysDiaQ;
  document.getElementById("daysNocheQ").value = state.daysNocheQ;
  document.getElementById("quincenaSel").value = String(state.quincena || 1);

  document.getElementById("workDate").addEventListener("change", (e) => {
    switchWorkDate(e.target.value);
    document.getElementById("daysDiaQ").value = state.daysDiaQ;
    document.getElementById("daysNocheQ").value = state.daysNocheQ;
    document.getElementById("quincenaSel").value = String(state.quincena || 1);
    saveState();
    renderShift("dia");
    renderShift("noche");
    renderProjection();
  });

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const t = btn.dataset.tab;
      document.getElementById("panelDia").classList.toggle("hidden", t !== "dia");
      document.getElementById("panelNoche").classList.toggle("hidden", t !== "noche");
    });
  });

  const onQ = () => {
    state.daysDiaQ = Number(document.getElementById("daysDiaQ").value) || 0;
    state.daysNocheQ = Number(document.getElementById("daysNocheQ").value) || 0;
    state.quincena = Number(document.getElementById("quincenaSel").value) || 1;
    saveState();
    renderShift("dia");
    renderShift("noche");
    renderProjection();
  };
  ["daysDiaQ", "daysNocheQ", "quincenaSel"].forEach((id) => {
    document.getElementById(id).addEventListener("input", onQ);
    document.getElementById(id).addEventListener("change", onQ);
  });

  document.getElementById("btnSave").addEventListener("click", () => {
    saveState();
    alert("Presupuesto diario guardado (almacenamiento aparte de la app Monorriel nómina).");
  });

  document.getElementById("btnPrintShare").addEventListener("click", () => printAndSharePresupuesto());

  document.getElementById("btnExport").addEventListener("click", () => {
    saveState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = state.date || new Date().toISOString().slice(0, 10);
    a.download = `rfs-presupuesto-diario-monorriel-${d}.json`;
    a.href = URL.createObjectURL(blob);
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("btnImport").addEventListener("click", () => {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const base = emptyState();
        state = {
          ...base,
          ...parsed,
          dia: migrateShift(parsed.dia, "dia"),
          noche: migrateShift(parsed.noche, "noche"),
        };
        state.roster = migrateRoster(state);
        const meta = ensureRosterMeta(state);
        state.rosterLast = meta.rosterLast;
        state.rosterHistory = meta.rosterHistory;
        const empMeta = ensureEmployeeMeta(state);
        state.employeeLast = empMeta.employeeLast;
        state.employeeHistory = empMeta.employeeHistory;
        state.reports = normalizeReports(parsed.reports, state);
        syncQuincenaFromWorkDate();
        loadReportForDate(state.date);
        saveState();
        document.getElementById("workDate").value = state.date;
        document.getElementById("daysDiaQ").value = state.daysDiaQ;
        document.getElementById("daysNocheQ").value = state.daysNocheQ;
        document.getElementById("quincenaSel").value = String(state.quincena || 1);
        renderShift("dia");
        renderShift("noche");
        renderProjection();
        alert("Respaldo cargado. Revisa fecha y quincena.");
      } catch (err) {
        alert("No se pudo leer el archivo JSON.");
      }
    };
    reader.readAsText(file, "utf-8");
  });

  document.getElementById("btnClear").addEventListener("click", () => {
    const active = document.querySelector(".tab.active").dataset.tab;
    if (!confirm(`¿Vaciar el reporte del ${state.date} (turno ${active})? Los puestos fijos no se borran.`)) return;
    state[active] = emptyShiftState(active);
    saveState();
    renderShift(active);
    renderProjection();
  });
}

function init() {
  syncQuincenaFromWorkDate();
  loadReportForDate(state.date);
  saveState();
  renderRates();
  renderShift("dia");
  renderShift("noche");
  renderProjection();
  bindUi();
  document.getElementById("daysDiaQ").value = state.daysDiaQ;
  document.getElementById("daysNocheQ").value = state.daysNocheQ;
  document.getElementById("quincenaSel").value = String(state.quincena || 1);
}

init();