/* RFS Cotizaciones — App independiente para vendedores (build 231) */
const APP_BUILD = 232;
const APP_VERSION_LABEL = "v232-cotizaciones";
const VENDOR_KEY = "rfs-quote-vendor-name";

let currentUser = null;
let quotesModuleWired = false;

function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function logActivity() {}

function loadVendorSession() {
  try {
    const name = String(localStorage.getItem(VENDOR_KEY) || "").trim();
    if (!name) {
      currentUser = null;
      return;
    }
    const username = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "")
      .toLowerCase()
      .slice(0, 48);
    currentUser = { displayName: name, username: username || "vendedor" };
  } catch (_) {
    currentUser = null;
  }
}

function saveVendorSession(name) {
  const clean = String(name || "").trim().slice(0, 80);
  if (!clean) {
    toast("Escribe tu nombre para el historial.");
    return false;
  }
  localStorage.setItem(VENDOR_KEY, clean);
  loadVendorSession();
  return true;
}

function clearVendorSession() {
  localStorage.removeItem(VENDOR_KEY);
  currentUser = null;
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-rfs-lib="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.rfsLib = src;
    s.onload = () => {
      s.dataset.loaded = "1";
      resolve();
    };
    s.onerror = () => reject(new Error("No se pudo cargar la librería PDF (revisa la conexión)."));
    document.head.appendChild(s);
  });
}

async function ensureHtml2Pdf() {
  if (typeof window.html2pdf === "function") return window.html2pdf;
  await loadExternalScript("https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js");
  if (typeof window.html2pdf !== "function") {
    throw new Error("html2pdf no disponible");
  }
  return window.html2pdf;
}

function waitForImages(root) {
  const imgs = [...(root.querySelectorAll("img") || [])];
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );
}

function downloadBlobFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function trySharePdfFile(file, title, text) {
  if (!navigator.share) return false;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, text, files: [file] });
      return true;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return true;
  }
  return false;
}

function openPrintWindow(title, bodyHtml, options = {}) {
  const share = (options && options.share) || {};
  const win = window.open("", "_blank");
  if (!win) {
    toast("Permite ventanas emergentes para imprimir.");
    return null;
  }
  const shareText = String(share.text || title || "");
  const shareSubject = String(share.subject || title || "");
  const fileName = String(share.fileName || "propuesta-rfs.pdf");
  const extraCss = options && options.extraCss ? String(options.extraCss) : "";
  const bodyClass = options && options.bodyClass ? String(options.bodyClass) : "";
  const maxW = Number(options && options.contentMaxWidth) || 900;
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:22px;max-width:${maxW}px;margin:0 auto;font-size:12px;line-height:1.35}
  .print-bar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#111;color:#fff;padding:12px;margin:-22px -22px 18px}
  .print-bar button{padding:11px 14px;font-weight:800;border:0;border-radius:10px;cursor:pointer}
  .btn-back{background:#fff;color:#111}.btn-print{background:#d41414;color:#fff}.btn-wa{background:#25d366;color:#053b1a}.btn-mail{background:#3b82f6;color:#fff}.btn-pdf{background:#f5f5f5;color:#111}
  .status{font-size:12px;color:#fde68a;width:100%}
  #rfsPrintRoot{background:#fff;color:#111}
  @media print{.no-print{display:none!important}}
  ${extraCss}</style></head><body class="${escapeHtml(bodyClass)}">
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
            margin: [10, 10, 10, 10],
            filename: shareCfg.fileName || "propuesta.pdf",
            image: { type: "jpeg", quality: 0.95 },
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
        a.download = name || "propuesta.pdf";
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
          var file = new File([blob], shareCfg.fileName || "propuesta.pdf", { type: "application/pdf" });
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
        }).catch(function (err) {
          console.error(err);
          setStatus("No se pudo crear el PDF. Revisa conexión e inténtalo de nuevo.");
        });
      }
      document.getElementById("btnPrintBack").onclick = function () {
        try { window.close(); } catch (e) {}
      };
      document.getElementById("btnPrintNow").onclick = function () { window.print(); };
      document.getElementById("btnPrintWhatsApp").onclick = function () { sharePdf("wa"); };
      document.getElementById("btnPrintEmail").onclick = function () { sharePdf("mail"); };
      document.getElementById("btnPrintPdf").onclick = function () { sharePdf("pdf"); };
    })();
  <\/script></body></html>`);
  win.document.close();
  return win;
}

function setQuotesShellLoggedIn(on) {
  const app = document.getElementById("app");
  const login = document.getElementById("loginView");
  const quotes = document.getElementById("quotesView");
  const label = document.getElementById("sessionUserLabel");
  const btnOut = document.getElementById("btnLogoutUser");
  if (!app || !login || !quotes) return;
  if (on && currentUser) {
    app.classList.remove("logged-out");
    app.classList.add("logged-in");
    login.classList.remove("active");
    quotes.classList.add("active");
    if (label) {
      label.textContent = currentUser.displayName;
      label.hidden = false;
    }
    if (btnOut) btnOut.hidden = false;
    if (!quotesModuleWired && typeof wireQuotesModule === "function") {
      wireQuotesModule();
      quotesModuleWired = true;
    }
    if (typeof renderQuotesModule === "function") renderQuotesModule();
  } else {
    app.classList.add("logged-out");
    app.classList.remove("logged-in");
    login.classList.add("active");
    quotes.classList.remove("active");
    if (label) label.hidden = true;
    if (btnOut) btnOut.hidden = true;
  }
}

function wireVendorUi() {
  document.getElementById("btnVendorEnter")?.addEventListener("click", () => {
    const name = document.getElementById("vendorDisplayName")?.value || "";
    if (!saveVendorSession(name)) return;
    setQuotesShellLoggedIn(true);
    toast(`Hola, ${currentUser.displayName}. Listo para cotizar.`);
  });
  document.getElementById("btnLogoutUser")?.addEventListener("click", () => {
    clearVendorSession();
    setQuotesShellLoggedIn(false);
    toast("Sesión cerrada en este equipo.");
  });
  document.getElementById("btnRefreshApp")?.addEventListener("click", () => {
    window.location.reload();
  });
}

async function checkVersionGate() {
  try {
    const res = await fetch(`version.json?bust=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const min = Number(data.minBuild) || Number(data.build) || APP_BUILD;
    if (min <= APP_BUILD) return;
    const gate = document.getElementById("cotizVersionGate");
    const msg = document.getElementById("cotizVersionGateMsg");
    if (gate) gate.hidden = false;
    if (msg) msg.textContent = `Hay una versión nueva (${data.label || min}). Actualiza antes de continuar.`;
    document.getElementById("btnForceAppUpdate")?.addEventListener("click", () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
      }
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).finally(() => {
        window.location.href = `${window.location.pathname}?v=${Date.now()}`;
      });
    });
  } catch (_) {}
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("sw.js", { scope: "./" })
    .then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            toast("Hay actualización. Pulsa ⟳ o cierra y abre la app.");
          }
        });
      });
    })
    .catch(() => {});
}

function cotizacionesBoot() {
  const badge = document.getElementById("appVersionBadge");
  if (badge) badge.textContent = APP_VERSION_LABEL;
  window.RFS_QUOTE_MEDIA_BASE = "../";
  loadVendorSession();
  wireVendorUi();
  registerServiceWorker();
  checkVersionGate();
  const saved = localStorage.getItem(VENDOR_KEY);
  if (saved && currentUser) {
    const input = document.getElementById("vendorDisplayName");
    if (input) input.value = currentUser.displayName;
    setQuotesShellLoggedIn(true);
  } else {
    setQuotesShellLoggedIn(false);
  }
}

window.cotizacionesBoot = cotizacionesBoot;
