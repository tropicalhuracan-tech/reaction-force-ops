/**
 * Colores de recordatorio y copiar/pegar en tablas Vargas / Monorriel.
 */
(function () {
  const MEMO_COLORS = [
    { id: "", label: "Quitar color", css: "" },
    { id: "red", label: "Rojo", css: "#e53935" },
    { id: "orange", label: "Naranja", css: "#fb8c00" },
    { id: "yellow", label: "Amarillo", css: "#fdd835" },
    { id: "green", label: "Verde", css: "#43a047" },
    { id: "blue", label: "Azul", css: "#1e88e5" },
    { id: "purple", label: "Morado", css: "#8e24aa" },
    { id: "pink", label: "Rosa", css: "#ec407a" },
    { id: "gray", label: "Gris", css: "#78909c" },
  ];

  const CLIP_KEY = "rfs-report-clip-text";

  function memoById(id) {
    return MEMO_COLORS.find((c) => c.id === id) || null;
  }

  function normalizeMemoColors(raw) {
    const out = {};
    if (!raw || typeof raw !== "object") return out;
    Object.keys(raw).forEach((k) => {
      const key = String(k || "").trim();
      const id = String(raw[k] || "").trim();
      if (!key || !id) return;
      if (!memoById(id)) return;
      out[key] = id;
    });
    return out;
  }

  function mergeEmployeeMemoColors(winner, loser) {
    if (!winner) return;
    winner.memoColors = normalizeMemoColors(winner.memoColors);
    const other = normalizeMemoColors(loser && loser.memoColors);
    Object.keys(other).forEach((k) => {
      if (!winner.memoColors[k]) winner.memoColors[k] = other[k];
    });
  }

  function memoStyleAttr(memoColors, fieldKey) {
    const id = normalizeMemoColors(memoColors)[fieldKey];
    const hit = id ? memoById(id) : null;
    if (!hit || !hit.css) return "";
    return ` style="background-color:${hit.css} !important"`;
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;");
  }

  function renderMemoPaletteHtml(selectedId) {
    const sel = String(selectedId || "");
    const swatches = MEMO_COLORS.map((c) => {
      const active = c.id === sel ? " is-selected" : "";
      const bg = c.css || "transparent";
      const border = c.id === "yellow" || c.id === "" ? "border:1px solid rgba(255,255,255,.35);" : "";
      return `<button type="button" class="report-memo-swatch${active}" data-memo-id="${escapeAttr(c.id)}" title="${escapeAttr(
        c.label
      )}" aria-label="${escapeAttr(c.label)}" style="background:${bg};${border}"></button>`;
    }).join("");
    const table = `<table class="report-memo-table" aria-label="Colores primarios">
      <thead><tr><th colspan="4">Colores para recordar</th></tr></thead>
      <tbody>
        <tr><td>Rojo</td><td>Naranja</td><td>Amarillo</td><td>Verde</td></tr>
        <tr><td>Azul</td><td>Morado</td><td>Rosa</td><td>Gris</td></tr>
      </tbody>
    </table>`;
    return `<div class="report-memo-bar">
      ${table}
      <div class="report-memo-swatches" role="group" aria-label="Elegir color">${swatches}</div>
      <button type="button" class="secondary report-memo-toggle">Modo color: OFF</button>
      <span class="muted tight report-memo-hint">Activa modo color, elige un color y toca la casilla. Copiar/pegar: Ctrl+C / Ctrl+V.</span>
    </div>`;
  }

  function bindMemoPalette(host, opts) {
    const getSelected = opts.getSelected;
    const setSelected = opts.setSelected;
    const getMode = opts.getMode;
    const setMode = opts.setMode;
    const toggleBtn = host.querySelector(".report-memo-toggle");
    const syncToggle = () => {
      if (!toggleBtn) return;
      const on = getMode();
      toggleBtn.textContent = on ? "Modo color: ON" : "Modo color: OFF";
      toggleBtn.classList.toggle("primary", on);
      toggleBtn.classList.toggle("secondary", !on);
    };
    host.querySelectorAll(".report-memo-swatch").forEach((btn) => {
      btn.addEventListener("click", () => {
        setSelected(btn.getAttribute("data-memo-id") || "");
        host.querySelectorAll(".report-memo-swatch").forEach((b) => b.classList.remove("is-selected"));
        btn.classList.add("is-selected");
        if (!getMode()) {
          setMode(true);
          syncToggle();
        }
      });
    });
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        setMode(!getMode());
        syncToggle();
      });
    }
    syncToggle();
    const table = host.querySelector(".vargas-table, .vargas-table");
    if (!table) return;
    table.addEventListener(
      "click",
      (ev) => {
        if (!getMode()) return;
        const cell = ev.target.closest("td[data-memo-field]");
        if (!cell || ev.target.closest(".vargas-del-btn, .monoq-del, button")) return;
        ev.preventDefault();
        ev.stopPropagation();
        const colorId = getSelected();
        if (typeof opts.applyColor === "function") opts.applyColor(cell, colorId);
      },
      true
    );
  }

  function bindReportClipboard(root, opts) {
    if (!root || root.dataset.clipboardBound) return;
    root.dataset.clipboardBound = "1";
    const cellSel = opts.cellSelector || "td[contenteditable]";
    const onCopy = (cell) => {
      const t = String(cell.textContent || "").replace(/\s+/g, " ").trim();
      try {
        sessionStorage.setItem(CLIP_KEY, t);
      } catch (_) {}
      return t;
    };
    root.addEventListener("copy", (e) => {
      const cell = e.target.closest(cellSel);
      if (!cell) return;
      const t = onCopy(cell);
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", t);
        e.preventDefault();
      }
    });
    root.addEventListener("cut", (e) => {
      const cell = e.target.closest(cellSel);
      if (!cell || typeof opts.pasteToCell !== "function") return;
      const t = onCopy(cell);
      if (e.clipboardData) {
        e.clipboardData.setData("text/plain", t);
        e.preventDefault();
      }
      opts.pasteToCell(cell, "", { fromCut: true });
    });
    root.addEventListener("paste", (e) => {
      const cell = e.target.closest(cellSel);
      if (!cell || typeof opts.pasteToCell !== "function") return;
      const t =
        (e.clipboardData && e.clipboardData.getData("text/plain")) ||
        (typeof sessionStorage !== "undefined" ? sessionStorage.getItem(CLIP_KEY) : "") ||
        "";
      e.preventDefault();
      opts.pasteToCell(cell, t, { fromPaste: true });
    });
    root.addEventListener("keydown", (e) => {
      const cell = e.target.closest(cellSel);
      if (!cell) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = String(e.key || "").toLowerCase();
      if (key === "c") {
        onCopy(cell);
        return;
      }
      if (key === "v" && typeof opts.pasteToCell === "function") {
        e.preventDefault();
        let t = "";
        try {
          t = sessionStorage.getItem(CLIP_KEY) || "";
        } catch (_) {}
        if (!t && navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(
            (txt) => opts.pasteToCell(cell, txt, { fromPaste: true }),
            () => opts.pasteToCell(cell, t, { fromPaste: true })
          );
          return;
        }
        opts.pasteToCell(cell, t, { fromPaste: true });
      }
    });
  }

  window.RFSReportCells = {
    MEMO_COLORS,
    memoById,
    normalizeMemoColors,
    mergeEmployeeMemoColors,
    memoStyleAttr,
    renderMemoPaletteHtml,
    bindMemoPalette,
    bindReportClipboard,
  };
})();