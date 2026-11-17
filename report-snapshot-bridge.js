/**
 * Historial de respaldos en nube (nivel A) + auto-respaldo + aviso otra pestaña.
 */
(function () {
  const AUTO_SNAPSHOT_MS = 5 * 60 * 1000;
  const TAB_CHANNEL_VARGAS = "rfs-report-tab-vargas";
  const TAB_CHANNEL_MONOQ = "rfs-report-tab-monoq";
  let vargasAutoTimer = null;
  let monoQAutoTimer = null;
  let lastVargasAutoMarks = -1;
  let lastMonoQAutoMarks = -1;
  let tabWarnVargas = "";
  let tabWarnMonoQ = "";

  function sessionUser() {
    if (typeof sessionUsernameLower === "function") return sessionUsernameLower();
    return "";
  }

  function formatSnapshotWhen(iso) {
    if (!iso || iso === "safety") return String(iso || "");
    try {
      return new Date(iso).toLocaleString("es-DO", { dateStyle: "short", timeStyle: "short" });
    } catch (_) {
      return String(iso);
    }
  }

  function buildVargasSnapshotEntry(reason) {
    if (typeof ensureVargasSeedLoaded === "function") ensureVargasSeedLoaded();
    const report = typeof getActiveVargasReport === "function" ? getActiveVargasReport() : null;
    const reportId = report && report.id ? report.id : "";
    return {
      kind: "vargas",
      reportId,
      label: (report && report.label) || reportId,
      markScore: typeof vargasDataMarkScore === "function" ? vargasDataMarkScore(vargasData) : 0,
      createdBy: sessionUser(),
      reason: String(reason || "manual").slice(0, 24),
      payload: {
        reports: JSON.parse(JSON.stringify((vargasData && vargasData.reports) || [])),
        globalRemovedNameKeys: [...((vargasData && vargasData.globalRemovedNameKeys) || [])],
        globalRemovedLabels: [...((vargasData && vargasData.globalRemovedLabels) || [])],
        activeReportId:
          typeof vargasActiveReportId !== "undefined" ? vargasActiveReportId : (report && report.id) || "",
      },
    };
  }

  function buildMonoQSnapshotEntry(reason) {
    if (typeof ensureMonorrielQuincenasLoaded === "function") ensureMonorrielQuincenasLoaded();
    const report = typeof monoQActive === "function" ? monoQActive() : null;
    const reportId = report && report.id ? report.id : "";
    return {
      kind: "monoq",
      reportId,
      label: typeof monoQTitle === "function" ? monoQTitle(report) : reportId,
      markScore: typeof monoQDataMarkScore === "function" ? monoQDataMarkScore(monoQData) : 0,
      createdBy: sessionUser(),
      reason: String(reason || "manual").slice(0, 24),
      payload: {
        reports: JSON.parse(JSON.stringify((monoQData && monoQData.reports) || [])),
        activeReportId: typeof monoQActiveId !== "undefined" ? monoQActiveId : (report && report.id) || "",
        activeSheet: typeof monoQSheet !== "undefined" ? monoQSheet : "dia",
      },
    };
  }

  async function pushVargasCloudSnapshot(reason) {
    if (typeof canSyncVargasReportData === "function" && !canSyncVargasReportData()) return null;
    if (!window.RFSCloudApi || typeof window.RFSCloudApi.saveReportSnapshot !== "function") return null;
    const entry = buildVargasSnapshotEntry(reason);
    if (!entry.reportId) return null;
    try {
      return await window.RFSCloudApi.saveReportSnapshot(entry);
    } catch (err) {
      console.warn("RFS: snapshot Vargas", err);
      return { ok: false, error: err };
    }
  }

  async function pushMonoQCloudSnapshot(reason) {
    if (typeof canSyncMonorrielQuincenaData === "function" && !canSyncMonorrielQuincenaData()) return null;
    if (!window.RFSCloudApi || typeof window.RFSCloudApi.saveReportSnapshot !== "function") return null;
    const entry = buildMonoQSnapshotEntry(reason);
    if (!entry.reportId) return null;
    try {
      return await window.RFSCloudApi.saveReportSnapshot(entry);
    } catch (err) {
      console.warn("RFS: snapshot Monorriel", err);
      return { ok: false, error: err };
    }
  }

  function scheduleVargasAutoSnapshot() {
    if (typeof canSyncVargasReportData === "function" && !canSyncVargasReportData()) return;
    clearTimeout(vargasAutoTimer);
    vargasAutoTimer = setTimeout(async () => {
      vargasAutoTimer = null;
      if (typeof ensureVargasSeedLoaded === "function") ensureVargasSeedLoaded();
      const marks = typeof vargasDataMarkScore === "function" ? vargasDataMarkScore(vargasData) : 0;
      if (marks < 1) return;
      if (marks === lastVargasAutoMarks) return;
      lastVargasAutoMarks = marks;
      if (typeof pushVargasManualBackup === "function") pushVargasManualBackup("auto");
      await pushVargasCloudSnapshot("auto");
    }, AUTO_SNAPSHOT_MS);
  }

  function scheduleMonoQAutoSnapshot() {
    if (typeof canSyncMonorrielQuincenaData === "function" && !canSyncMonorrielQuincenaData()) return;
    clearTimeout(monoQAutoTimer);
    monoQAutoTimer = setTimeout(async () => {
      monoQAutoTimer = null;
      if (typeof ensureMonorrielQuincenasLoaded === "function") ensureMonorrielQuincenasLoaded();
      const marks = typeof monoQDataMarkScore === "function" ? monoQDataMarkScore(monoQData) : 0;
      if (marks < 1) return;
      if (marks === lastMonoQAutoMarks) return;
      lastMonoQAutoMarks = marks;
      if (typeof pushMonoQManualBackup === "function") pushMonoQManualBackup("auto");
      await pushMonoQCloudSnapshot("auto");
    }, AUTO_SNAPSHOT_MS);
  }

  function scheduleReportAutoSnapshots() {
    const view = document.querySelector(".view.active");
    const id = view && view.id;
    if (id === "vargasView") scheduleVargasAutoSnapshot();
    else if (id === "monorrielView") scheduleMonoQAutoSnapshot();
  }

  function listLocalVargasSnapshots(reportId) {
    try {
      const raw = JSON.parse(localStorage.getItem("rfs-ops-vargas-manual-backups") || "[]");
      const list = Array.isArray(raw) ? raw : [];
      return list
        .map((row) => ({
          source: "local",
          id: `local-${row.at}`,
          createdAt: row.at,
          createdBy: sessionUser(),
          markScore: typeof vargasDataMarkScore === "function" ? vargasDataMarkScore({ reports: row.reports }) : 0,
          reason: row.reason || "local",
          payload: {
            reports: row.reports,
            activeReportId: row.activeReportId,
          },
          reportId: reportId || (row.reports && row.reports[0] && row.reports[0].id) || "",
        }))
        .filter((r) => !reportId || r.reportId === reportId || !r.reportId)
        .slice(0, 12);
    } catch (_) {
      return [];
    }
  }

  function listLocalMonoQSnapshots(reportId) {
    try {
      const raw = JSON.parse(localStorage.getItem("rfs-ops-monoq-manual-backups") || "[]");
      const list = Array.isArray(raw) ? raw : [];
      return list
        .map((row) => ({
          source: "local",
          id: `local-${row.at}`,
          createdAt: row.at,
          createdBy: sessionUser(),
          markScore: typeof monoQDataMarkScore === "function" ? monoQDataMarkScore({ reports: row.reports }) : 0,
          reason: row.reason || "local",
          payload: {
            reports: row.reports,
            activeReportId: row.activeReportId,
            activeSheet: row.activeSheet,
          },
          reportId: reportId || (row.reports && row.reports[0] && row.reports[0].id) || "",
        }))
        .filter((r) => !reportId || r.reportId === reportId || !r.reportId)
        .slice(0, 12);
    } catch (_) {
      return [];
    }
  }

  function closeSnapshotModal() {
    const el = document.getElementById("rfsSnapshotModal");
    if (el) el.remove();
  }

  async function openSnapshotHistoryModal(opts) {
    const kind = opts && opts.kind === "monoq" ? "monoq" : "vargas";
    const reportId = String((opts && opts.reportId) || "").trim();
    const title = (opts && opts.title) || "Historial de respaldos";
    closeSnapshotModal();
    if (typeof toast === "function") toast("Cargando historial…");
    let cloud = [];
    try {
      if (window.RFSCloudApi && typeof window.RFSCloudApi.listReportSnapshots === "function") {
        cloud = await window.RFSCloudApi.listReportSnapshots(kind, reportId, 10);
      }
    } catch (_) {}
    const local = kind === "monoq" ? listLocalMonoQSnapshots(reportId) : listLocalVargasSnapshots(reportId);
    const rows = [];
    cloud.forEach((c) => rows.push({ ...c, source: "nube" }));
    local.forEach((c) => rows.push(c));
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const host = document.createElement("div");
    host.id = "rfsSnapshotModal";
    host.className = "rfs-snapshot-modal";
    host.innerHTML = `
      <div class="rfs-snapshot-backdrop" data-close="1"></div>
      <div class="rfs-snapshot-panel form-card" role="dialog" aria-label="${title}">
        <h2 style="margin:0 0 8px;font-size:17px">${title}</h2>
        <p class="muted tight">Últimas copias (nube + esta PC). Restaurar <strong>reemplaza</strong> la planilla actual con la elegida.</p>
        <ul class="rfs-snapshot-list" style="list-style:none;padding:0;margin:12px 0;max-height:50vh;overflow:auto">
          ${
            rows.length
              ? rows
                  .map((r, i) => {
                    const when = formatSnapshotWhen(r.createdAt);
                    const who = r.createdBy ? ` · ${r.createdBy}` : "";
                    const marks = Number(r.markScore) > 0 ? ` · ${r.markScore} marcas` : "";
                    const src = r.source === "nube" ? "☁" : "PC";
                    const reason = r.reason && r.reason !== "manual" ? ` (${r.reason})` : "";
                    return `<li style="margin-bottom:8px">
                      <button type="button" class="btn secondary rfs-snapshot-pick" data-i="${i}" style="width:100%;text-align:left">
                        ${src} ${when}${who}${marks}${reason}
                      </button>
                    </li>`;
                  })
                  .join("")
              : `<li class="muted">Aún no hay respaldos. Pulsa «Guardar respaldo».</li>`
          }
        </ul>
        <button type="button" class="btn secondary" data-close="1">Cerrar</button>
      </div>`;
    document.body.appendChild(host);
    host.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", closeSnapshotModal);
    });
    host.querySelectorAll(".rfs-snapshot-pick").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-i"));
        const row = rows[idx];
        if (!row) return;
        if (
          !confirm(
            "¿Restaurar esta copia?\n\nREEMPLAZA la planilla actual con la del respaldo (nube o PC).\nLuego guarda si quieres subirla de nuevo."
          )
        ) {
          return;
        }
        closeSnapshotModal();
        if (row.source === "nube" && row.id && !String(row.id).startsWith("local-")) {
          try {
            const full = await window.RFSCloudApi.fetchReportSnapshot(row.id);
            if (full && full.payload && typeof opts.onRestore === "function") {
              opts.onRestore(full.payload);
            } else if (typeof toast === "function") toast("No se pudo cargar el respaldo de la nube.");
          } catch (_) {
            if (typeof toast === "function") toast("Error al leer respaldo de la nube.");
          }
        } else if (row.payload && typeof opts.onRestore === "function") {
          opts.onRestore(row.payload);
        }
      });
    });
  }

  function startTabWarning(kind) {
    const channelName = kind === "monoq" ? TAB_CHANNEL_MONOQ : TAB_CHANNEL_VARGAS;
    const user = sessionUser();
    if (!user || typeof BroadcastChannel === "undefined") return () => {};
    const ch = new BroadcastChannel(channelName);
    const tabId = `${user}-${Math.random().toString(36).slice(2, 9)}`;
    function ping() {
      try {
        ch.postMessage({ type: "ping", user, tabId, at: Date.now() });
      } catch (_) {}
    }
    ch.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type !== "ping" || d.user !== user || d.tabId === tabId) return;
      const msg = "Otra pestaña está abierta con tu usuario — ciérrala para no pisar datos.";
      if (kind === "monoq") tabWarnMonoQ = msg;
      else tabWarnVargas = msg;
    };
    ping();
    const iv = setInterval(ping, 25000);
    return () => {
      clearInterval(iv);
      try {
        ch.close();
      } catch (_) {}
    };
  }

  let stopVargasTab = null;
  let stopMonoQTab = null;

  function vargasTabWarningHtml() {
    return tabWarnVargas
      ? `<p class="tight" style="color:#fbbf24;margin:8px 0 0">⚠ ${tabWarnVargas}</p>`
      : "";
  }

  function monoQTabWarningHtml() {
    return tabWarnMonoQ
      ? `<p class="tight" style="color:#fbbf24;margin:8px 0 0">⚠ ${tabWarnMonoQ}</p>`
      : "";
  }

  function ensureVargasTabWatch() {
    if (stopVargasTab || typeof canSyncVargasReportData !== "function" || !canSyncVargasReportData()) return;
    stopVargasTab = startTabWarning("vargas");
  }

  function ensureMonoQTabWatch() {
    if (stopMonoQTab || typeof canSyncMonorrielQuincenaData !== "function" || !canSyncMonorrielQuincenaData()) {
      return;
    }
    stopMonoQTab = startTabWarning("monoq");
  }

  window.RFSReportSnapshots = {
    pushVargasCloudSnapshot,
    pushMonoQCloudSnapshot,
    scheduleReportAutoSnapshots,
    openSnapshotHistoryModal,
    vargasTabWarningHtml,
    monoQTabWarningHtml,
    ensureVargasTabWatch,
    ensureMonoQTabWatch,
  };
  window.scheduleReportAutoSnapshots = scheduleReportAutoSnapshots;
})();