const STORAGE_KEY = "rfs-monorriel-presupuesto-v2";
const FERIADO_PAY = 800;
/** Keys "dia:puestos:0" while the roster name field is open */
const nameEditKeys = new Set();

const RATES = {
  dia: { puestos: 23, puestoPay: 1000, motos: 3, motoPay: 1153 },
  noche: { puestos: 24, puestoPay: 1040, motos: 3, motoPay: 1153 },
};

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString("es-DO", { style: "currency", currency: "DOP", minimumFractionDigits: 0 });
}

function emptySlot() {
  return { paidDays: {}, feriado: false };
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
      paidDays: raw.paidDays && typeof raw.paidDays === "object" ? { ...raw.paidDays } : {},
      feriado: !!raw.feriado,
    };
  }
  return { paidDays: {}, feriado: false };
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
  return {
    date: new Date().toISOString().slice(0, 10),
    roster: emptyRoster(),
    dia: emptyShiftState("dia"),
    noche: emptyShiftState("noche"),
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
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const v1 = localStorage.getItem("rfs-monorriel-presupuesto-v1");
      if (v1) raw = v1;
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
    return merged;
  } catch (_) {
    return emptyState();
  }
}

let state = loadState();

function saveState() {
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
    if (rosterName(shift, "puestos", i)) u += r.puestoPay;
  });
  slots.motos.forEach((_, i) => {
    if (rosterName(shift, "motos", i)) u += r.motoPay;
  });
  return u;
}

function slotRate(shift, kind) {
  const r = RATES[shift];
  return kind === "motos" ? r.motoPay : r.puestoPay;
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
    const rate = slotRate(shift, kind);
    list.forEach((slot, idx) => {
      if (!rosterName(shift, kind, idx)) return;
      days.forEach((dayNum) => {
        if (slot.paidDays[String(dayNum)]) adelantado += rate;
        else pendiente += rate;
      });
      if (feriadoOn && slot.feriado) feriado += FERIADO_PAY;
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
  if (!rosterName(shift, kind, idx)) return "";
  const days = quincenaDayNumbers();
  const work = shiftWorkDays(shift);
  const cells = days
    .slice(0, work)
    .map((dayNum) => {
      const paid = !!slot.paidDays[String(dayNum)];
      return `<button type="button" class="day-cell${paid ? " day-paid" : ""}" title="${
        paid ? "Pagado adelantado — doble clic quita" : "Doble clic = pagado adelantado"
      }" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" data-day="${dayNum}">${dayNum}</button>`;
    })
    .join("");
  return `<div class="day-grid" aria-label="Días quincena">${cells}</div>`;
}

function escapeText(s) {
  return escapeAttr(s);
}

function renderNameBlock(shift, kind, idx, label) {
  const name = rosterName(shift, kind, idx);
  const key = rosterEditKey(shift, kind, idx);
  const editing = nameEditKeys.has(key) || !name;
  if (editing) {
    return `<div class="roster-row editing">
      <span class="slot-num">${label}</span>
      <input type="text" class="roster-input" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" value="${escapeAttr(
      name
    )}" placeholder="Nombre fijo (se guarda para siempre)" autofocus />
      ${
        name
          ? `<button type="button" class="btn-icon btn-done" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Listo">✓</button>`
          : ""
      }
    </div>`;
  }
  return `<div class="roster-row">
    <span class="slot-num">${label}</span>
    <strong class="roster-name">${escapeText(name)}</strong>
    <button type="button" class="btn-icon btn-edit" data-shift="${shift}" data-kind="${kind}" data-idx="${idx}" title="Editar nombre" aria-label="Editar nombre">✎</button>
  </div>`;
}

function finishRosterEdit(shift, kind, idx, inputEl) {
  setRosterName(shift, kind, idx, inputEl ? inputEl.value : rosterName(shift, kind, idx));
  nameEditKeys.delete(rosterEditKey(shift, kind, idx));
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

  let html = `
    <h2>${title}</h2>
    <div class="toolbar">
      <button type="button" class="btn secondary btn-feriado" data-shift="${shift}">${feriadoLabel}</button>
      <span class="muted toolbar-hint">Nombres de puesto se guardan en esta PC (lápiz para cambiar). Doble clic en un día = pagado adelantado (rojo).</span>
    </div>
    <div class="budget-bar">
      <div><span>Presupuesto del día (lista)</span><strong>${money(maxShift)}</strong></div>
      <div><span>Gasto hoy (nombres)</span><strong>${money(used)}</strong></div>
      <div><span>Disponible hoy</span><strong class="${left < 0 ? "over" : "ok"}">${money(left)}</strong></div>
      <div><span>Quincena pendiente</span><strong>${money(q.pendiente + q.feriado)}</strong></div>
      <div><span>Pagado adelantado</span><strong class="paid-adv">${money(q.adelantado)}</strong></div>
    </div>
    <h3 class="section-title">Puestos (${r.puestos} × ${money(r.puestoPay)})</h3>
    <div class="slot-grid wide">
  `;
  slots.puestos.forEach((slot, i) => {
    const pname = rosterName(shift, "puestos", i);
    html += `<div class="slot slot-wide">
      <div class="slot-head">
        ${renderNameBlock(shift, "puestos", i, `Puesto ${i + 1}`)}
        ${
          pname && slots.feriadoQuincena
            ? `<label class="feriado-chk"><input type="checkbox" data-shift="${shift}" data-kind="puestos" data-idx="${i}" data-f="feriado"${
                slot.feriado ? " checked" : ""
              } /> Feriado</label>`
            : ""
        }
      </div>
      ${renderDayGrid(shift, "puestos", i, slot)}
    </div>`;
  });
  html += `</div>
    <h3 class="section-title">Motorizados (${r.motos} × ${money(r.motoPay)})</h3>
    <div class="slot-grid wide">`;
  slots.motos.forEach((slot, i) => {
    const mname = rosterName(shift, "motos", i);
    html += `<div class="slot slot-wide moto">
      <div class="slot-head">
        ${renderNameBlock(shift, "motos", i, `Motorizado ${i + 1}`)}
        ${
          mname && slots.feriadoQuincena
            ? `<label class="feriado-chk"><input type="checkbox" data-shift="${shift}" data-kind="motos" data-idx="${i}" data-f="feriado"${
                slot.feriado ? " checked" : ""
              } /> Feriado</label>`
            : ""
        }
      </div>
      ${renderDayGrid(shift, "motos", i, slot)}
    </div>`;
  });
  html += "</div>";
  panel.innerHTML = html;

  bindRosterUi(panel, shift);

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
    state.date = e.target.value;
    saveState();
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
    alert("Guardado en este navegador.");
  });

  document.getElementById("btnExport").addEventListener("click", () => {
    saveState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    const d = state.date || new Date().toISOString().slice(0, 10);
    a.download = `monorriel-presupuesto-${d}.json`;
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
    if (!confirm(`¿Quitar feriado y días pagados del turno ${active}? (Los nombres de puesto no se borran.)`)) return;
    state[active] = emptyShiftState(active);
    saveState();
    renderShift(active);
    renderProjection();
  });
}

function init() {
  renderRates();
  renderShift("dia");
  renderShift("noche");
  renderProjection();
  bindUi();
}

init();