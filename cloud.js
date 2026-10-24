(function () {
  const cfg = window.RFS_CLOUD || {};
  const projectId = cfg.projectId;
  const apiKey = cfg.apiKey;
  const rootDoc = cfg.docPath || "rfs/main";
  const rootCollection = rootDoc.split("/")[0] || "rfs";
  const MEDIA_COLLECTION = cfg.mediaCollection || "rfs_media";
  const PAYROLLS_COLLECTION = cfg.payrollsCollection || "rfs_payrolls";
  const PAYROLL_BACKUPS_COLLECTION = cfg.payrollBackupsCollection || "rfs_payroll_backups";
  const storageBucket =
    cfg.storageBucket || (projectId ? `${projectId}.firebasestorage.app` : "");
  const SCHEMA_VERSION = "2";
  /** Base64 / data-URL más largos que esto salen a Storage (o rfs_media de respaldo) */
  const MEDIA_MIN_CHARS = 800;

  let firebaseStorage = null;
  let storageInitTried = false;
  let storageAvailable = null; // null=unknown, true/false after probe

  function isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
  }

  function isHttpUrl(value) {
    return typeof value === "string" && /^https?:\/\//i.test(value);
  }

  function mimeFromDataUrl(dataUrl) {
    const m = String(dataUrl || "").match(/^data:([^;,]+)/i);
    return (m && m[1]) || "application/octet-stream";
  }

  function initFirebaseStorage() {
    if (firebaseStorage) return firebaseStorage;
    if (storageInitTried) return null;
    storageInitTried = true;
    if (!projectId || !apiKey || !storageBucket) return null;
    if (!window.firebase || !window.firebase.storage) {
      console.warn("RFS Storage: falta Firebase SDK (app + storage).");
      return null;
    }
    try {
      if (!window.firebase.apps || !window.firebase.apps.length) {
        window.firebase.initializeApp({
          apiKey,
          projectId,
          storageBucket,
          authDomain: `${projectId}.firebaseapp.com`,
        });
      }
      firebaseStorage = window.firebase.storage();
      return firebaseStorage;
    } catch (err) {
      console.warn("RFS Storage: no se pudo inicializar", err);
      return null;
    }
  }

  async function uploadDataUrlToStorage(path, dataUrl, contentType) {
    const storage = initFirebaseStorage();
    if (!storage) throw new Error("storage not ready");
    const ref = storage.ref(path);
    const mime = contentType || mimeFromDataUrl(dataUrl) || "image/jpeg";
    await ref.putString(dataUrl, "data_url", { contentType: mime });
    const url = await ref.getDownloadURL();
    storageAvailable = true;
    return url;
  }

  async function deleteStoragePath(path) {
    if (!path) return false;
    const storage = initFirebaseStorage();
    if (!storage) return false;
    try {
      await storage.ref(path).delete();
      return true;
    } catch (err) {
      const code = err && (err.code || err.message || "");
      if (String(code).includes("object-not-found") || String(code).includes("404")) return false;
      throw err;
    }
  }

  function storageEnabled() {
    return !!initFirebaseStorage();
  }

  const PART_DOCS = {
    main: true,
    posts: true,
    employees: true,
    loans: true,
    activity: true,
    pettyCash: true,
    hr: true,
    depuracion: true,
    contabilidad: true,
    suplidores: true,
    vargas: true,
  };

  function baseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  }

  function docUrl(path) {
    return `${baseUrl()}/${path}?key=${encodeURIComponent(apiKey)}`;
  }

  function partPath(name) {
    return name === "main" ? `${rootCollection}/main` : `${rootCollection}/${name}`;
  }

  function mediaPath(id) {
    return `${MEDIA_COLLECTION}/${id}`;
  }

  function safeId(value) {
    return String(value || "x")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 96);
  }

  function mediaDocId(kind, ownerId, field) {
    return `${kind}_${safeId(ownerId)}_${field}`;
  }

  function isHeavyMedia(value) {
    return typeof value === "string" && value.length >= MEDIA_MIN_CHARS;
  }

  function parseJsonField(fields, key, fallback) {
    const raw = fields[key] && fields[key].stringValue;
    if (raw == null || raw === "") return fallback;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function parseArrayField(fields, key) {
    const parsed = parseJsonField(fields, key, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function parseObjectField(fields, key) {
    const parsed = parseJsonField(fields, key, {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function getDoc(path, retries = 1) {
    let lastErr = null;
    for (let i = 0; i <= retries; i += 1) {
      try {
        const res = await fetch(docUrl(path), { method: "GET" });
        if (res.status === 404) return null;
        if (res.status === 429) {
          lastErr = new Error(`cloud load ${path} 429`);
          // Fallar rápido: no congelar el login con esperas largas
          if (i < retries) await sleep(1500);
          continue;
        }
        if (!res.ok) throw new Error(`cloud load ${path} ${res.status}`);
        return res.json();
      } catch (err) {
        lastErr = err;
        if (i < retries) await sleep(400);
      }
    }
    throw lastErr || new Error(`cloud load ${path} failed`);
  }

  async function patchDoc(path, fields, fieldPaths, retries = 2) {
    let lastErr = null;
    for (let i = 0; i <= retries; i += 1) {
      try {
        let url = docUrl(path);
        if (fieldPaths && fieldPaths.length) {
          url += fieldPaths.map((p) => `&updateMask.fieldPaths=${encodeURIComponent(p)}`).join("");
        }
        const res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        });
        if (res.status === 429) {
          lastErr = new Error(`cloud save ${path} 429`);
          if (i < retries) await sleep(2000 * (i + 1));
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`cloud save ${path} ${res.status}: ${text.slice(0, 220)}`);
        }
        return res.json();
      } catch (err) {
        lastErr = err;
        if (String(err && err.message).includes("429")) {
          if (i < retries) await sleep(2000 * (i + 1));
          continue;
        }
        if (i < retries) await sleep(400);
        else break;
      }
    }
    throw lastErr || new Error(`cloud save ${path} failed`);
  }

  async function putMedia(id, payload) {
    const fields = {
      kind: { stringValue: String(payload.kind || "") },
      ownerId: { stringValue: String(payload.ownerId || "") },
      field: { stringValue: String(payload.field || "") },
      data: { stringValue: String(payload.data || "") },
      name: { stringValue: String(payload.name || "") },
      mime: { stringValue: String(payload.mime || "") },
      updatedAt: { stringValue: new Date().toISOString() },
    };
    return patchDoc(mediaPath(id), fields);
  }

  async function deleteMedia(id) {
    if (!id) return false;
    return deleteDocByPath(mediaPath(id));
  }

  async function deleteDocByPath(path) {
    if (!path) return false;
    const res = await fetch(docUrl(path), { method: "DELETE" });
    if (res.status === 404) return false;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`cloud delete ${path} ${res.status}: ${text.slice(0, 180)}`);
    }
    return true;
  }

  function payrollPath(id) {
    return `${PAYROLLS_COLLECTION}/${safeId(id)}`;
  }

  function payrollBackupPath(id) {
    return `${PAYROLL_BACKUPS_COLLECTION}/${safeId(id)}`;
  }

  function payrollIndexPath() {
    return `${rootCollection}/payroll_index`;
  }

  async function listCollectionDocs(collectionId, pageSize = 100) {
    const out = [];
    let pageToken = "";
    for (let guard = 0; guard < 40; guard += 1) {
      let url = `${baseUrl()}/${collectionId}?key=${encodeURIComponent(apiKey)}&pageSize=${pageSize}`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetch(url, { method: "GET" });
      if (res.status === 404) return out;
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`cloud list ${collectionId} ${res.status}: ${text.slice(0, 180)}`);
      }
      const data = await res.json();
      (data.documents || []).forEach((doc) => out.push(doc));
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
    return out;
  }

  function docIdFromName(name) {
    const parts = String(name || "").split("/");
    return parts[parts.length - 1] || "";
  }

  async function loadMediaMap(ids) {
    const unique = [...new Set((ids || []).filter(Boolean))];
    const out = {};
    await Promise.all(
      unique.map(async (id) => {
        try {
          const doc = await getDoc(mediaPath(id));
          if (!doc) return;
          const data = doc.fields && doc.fields.data && doc.fields.data.stringValue;
          if (data) out[id] = data;
        } catch (_) {}
      })
    );
    return out;
  }

  function emptyPetty() {
    return { expenses: [], closings: [], people: [], deletedExpenses: [], epoch: 2 };
  }

  function emptyHr() {
    return { applications: [], deletedIds: [] };
  }

  function emptyDepuracion() {
    return { candidates: [], settings: {} };
  }

  function emptyContabilidad() {
    return {
      expenses: [],
      itbisCollected: [],
      officeEmployees: [],
      lotedomEmployees: [],
      payrolls: [],
      payrollBackups: [],
      payrollBackupDeletedIds: [],
      settings: { defaultBook: "EDWARD" },
    };
  }

  function emptySuplidores() {
    return { suppliers: [], payments: [], nextCodeSeq: 1 };
  }

  function emptyVargas() {
    return { reports: [] };
  }

  function employeeIdentityKey(name) {
    const base = String(name || "")
      .replace(/\s*\(monorriel\)\s*$/i, "")
      .replace(/\s*\(la vega(?: autopista)?\)\s*$/i, "")
      .trim();
    return String(base)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  /** Una ficha por persona (nombre base); une sitios/roles/datos. */
  function dedupeEmployeesByIdentity(list) {
    const map = new Map();
    const uglyId = (id) => /\(MONORRIEL\)|\(LA-VEGA|\(LA VEGA/i.test(String(id || ""));
    (list || []).forEach((raw) => {
      if (!raw || typeof raw !== "object") return;
      const name = String(raw.name || "").trim();
      if (!name || name.toLowerCase() === "por asignar") return;
      const key = employeeIdentityKey(name);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, { ...raw });
        return;
      }
      const prev = map.get(key);
      const merged = { ...prev };
      Object.keys(raw).forEach((k) => {
        const v = raw[k];
        if (v == null || v === "") return;
        if (Array.isArray(v)) {
          merged[k] = [...new Set([...(Array.isArray(merged[k]) ? merged[k] : []), ...v].filter(Boolean))];
        } else if (!merged[k]) {
          merged[k] = v;
        } else if (k === "updatedAt" && String(v) > String(merged[k] || "")) {
          merged[k] = v;
        }
      });
      if (uglyId(merged.id) && raw.id && !uglyId(raw.id)) merged.id = raw.id;
      map.set(key, merged);
    });
    return [...map.values()].sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), "es")
    );
  }

  /** Une empleados locales + remotos por id y luego por identidad (nombre). */
  function mergeEmployeesPreferUnion(localList, remoteList) {
    const byId = new Map();
    const put = (raw, preferIfTie) => {
      if (!raw || typeof raw !== "object") return;
      const name = String(raw.name || "").trim();
      if (!name || name.toLowerCase() === "por asignar") return;
      const id = String(raw.id || "").trim() || `tmp-${employeeIdentityKey(name)}`;
      const row = { ...raw, id, name };
      if (!byId.has(id)) {
        byId.set(id, row);
        return;
      }
      const prev = byId.get(id);
      const ta = Date.parse(prev.updatedAt || "") || 0;
      const tb = Date.parse(row.updatedAt || "") || 0;
      const winner = tb > ta || (tb === ta && preferIfTie) ? row : prev;
      const other = winner === row ? prev : row;
      const merged = { ...other, ...winner };
      Object.keys(other).forEach((k) => {
        const v = other[k];
        if (v == null || v === "") return;
        if (Array.isArray(v)) {
          merged[k] = [...new Set([...(Array.isArray(merged[k]) ? merged[k] : []), ...v].filter(Boolean))];
        } else if (!merged[k]) {
          merged[k] = v;
        }
      });
      byId.set(id, merged);
    };
    (remoteList || []).forEach((e) => put(e, false));
    (localList || []).forEach((e) => put(e, true));
    return dedupeEmployeesByIdentity([...byId.values()]);
  }

  /** Une reportes de incidente por id (no reemplazar ciego). */
  function mergeReportsPreferUnion(localList, remoteList) {
    const map = new Map();
    const put = (raw, preferIfTie) => {
      if (!raw || typeof raw !== "object") return;
      const id = String(raw.id || "").trim();
      if (!id) return;
      if (!map.has(id)) {
        map.set(id, raw);
        return;
      }
      const prev = map.get(id);
      const ta = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
      const tb = Date.parse(raw.updatedAt || raw.createdAt || "") || 0;
      if (tb > ta || (tb === ta && preferIfTie)) map.set(id, raw);
    };
    (remoteList || []).forEach((r) => put(r, false));
    (localList || []).forEach((r) => put(r, true));
    return [...map.values()];
  }

  /** Une reportes Monorriel por id (y fecha+turno como respaldo). */
  function mergeMonorrielPreferUnion(localList, remoteList) {
    const map = new Map();
    const keyOf = (r) => {
      if (!r) return "";
      if (r.id) return `id:${r.id}`;
      return `dt:${String(r.date || "").slice(0, 10)}:${r.shift === "pm" ? "pm" : "am"}`;
    };
    const put = (raw, preferIfTie) => {
      if (!raw || typeof raw !== "object") return;
      const k = keyOf(raw);
      if (!k) return;
      if (!map.has(k)) {
        map.set(k, raw);
        return;
      }
      const prev = map.get(k);
      const ta = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
      const tb = Date.parse(raw.updatedAt || raw.createdAt || "") || 0;
      if (tb > ta || (tb === ta && preferIfTie)) map.set(k, raw);
    };
    (remoteList || []).forEach((r) => put(r, false));
    (localList || []).forEach((r) => put(r, true));
    return [...map.values()];
  }

  /** Une clientes locales + remotos por id para no perder altas al guardar. */
  function mergePostsPreferUnion(localPosts, remotePosts) {
    const map = new Map();
    const put = (raw, preferIfTie) => {
      if (!raw || typeof raw !== "object") return;
      const id = String(raw.id || "").trim();
      if (!id) return;
      if (!map.has(id)) {
        map.set(id, raw);
        return;
      }
      const prev = map.get(id);
      const ta = Date.parse(prev.updatedAt || prev.createdAt || "") || 0;
      const tb = Date.parse(raw.updatedAt || raw.createdAt || "") || 0;
      if (tb > ta || (tb === ta && preferIfTie)) {
        const winner = { ...raw };
        if (!winner.clientNumber && prev.clientNumber) winner.clientNumber = prev.clientNumber;
        if ((prev.history || []).length > (winner.history || []).length) winner.history = prev.history;
        map.set(id, winner);
      } else if (!prev.clientNumber && raw.clientNumber) {
        map.set(id, { ...prev, clientNumber: raw.clientNumber });
      }
    };
    (remotePosts || []).forEach((p) => put(p, false));
    (localPosts || []).forEach((p) => put(p, true));
    return [...map.values()];
  }

  function decodeLegacyMain(doc) {
    const fields = (doc && doc.fields) || {};
    return {
      posts: parseArrayField(fields, "postsJson"),
      reports: parseArrayField(fields, "reportsJson"),
      employees: parseArrayField(fields, "employeesJson"),
      loans: parseArrayField(fields, "loansJson"),
      loanTrash: parseArrayField(fields, "loanTrashJson"),
      monorrielReports: parseArrayField(fields, "monorrielReportsJson"),
      users: parseArrayField(fields, "usersJson"),
      messages: parseArrayField(fields, "messagesJson"),
      radio: parseObjectField(fields, "radioJson"),
      activity: parseArrayField(fields, "activityJson"),
      lva: parseObjectField(fields, "lvaJson"),
      pettyCash: Object.keys(parseObjectField(fields, "pettyCashJson")).length
        ? parseObjectField(fields, "pettyCashJson")
        : emptyPetty(),
      hr: Object.keys(parseObjectField(fields, "hrJson")).length
        ? parseObjectField(fields, "hrJson")
        : emptyHr(),
      depuracion: emptyDepuracion(),
      contabilidad: emptyContabilidad(),
      suplidores: emptySuplidores(),
      vargas: emptyVargas(),
      updatedAt: (fields.updatedAt && fields.updatedAt.stringValue) || null,
      schemaVersion: (fields.schemaVersion && fields.schemaVersion.stringValue) || "1",
    };
  }

  async function putHeavyToStorageOrMedia(opts) {
    const {
      dataUrl,
      storagePath,
      mediaId,
      kind,
      ownerId,
      field,
      name,
      mime,
      mediaJobs,
    } = opts;
    if (!isHeavyMedia(dataUrl) && !isDataUrl(dataUrl)) {
      return { url: "", usedStorage: false };
    }
    if (storageEnabled()) {
      try {
        const url = await uploadDataUrlToStorage(
          storagePath,
          dataUrl,
          mime || mimeFromDataUrl(dataUrl)
        );
        if (mediaId) {
          try {
            await deleteMedia(mediaId);
          } catch (_) {}
        }
        return { url, usedStorage: true };
      } catch (err) {
        console.warn("RFS Storage upload falló, usando rfs_media:", storagePath, err);
        storageAvailable = false;
      }
    }
    mediaJobs.push({
      id: mediaId,
      kind,
      ownerId: ownerId || "",
      field,
      data: dataUrl,
      name: name || "",
      mime: mime || mimeFromDataUrl(dataUrl) || "",
    });
    return { url: "", usedStorage: false, mediaId };
  }

  async function stripEmployees(employees) {
    const mediaJobs = [];
    const light = [];
    for (const emp of employees || []) {
      const copy = { ...(emp || {}) };
      const owner = copy.id || copy.key || copy.name || "x";

      // Foto → Firebase Storage (photoUrl); respaldo rfs_media
      if (isHeavyMedia(copy.photo) || isDataUrl(copy.photo)) {
        const mediaId = mediaDocId("emp", owner, "photo");
        const path = `employees/${safeId(owner)}/photo.jpg`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.photo,
          storagePath: path,
          mediaId: copy.photoMediaId || mediaId,
          kind: "employee",
          ownerId: copy.id || "",
          field: "photo",
          mime: "image/jpeg",
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.photoUrl = put.url;
          copy.photoStoragePath = path;
          copy.photo = "";
          copy.photoMediaId = "";
        } else {
          copy.photo = "";
          copy.photoMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.photo)) {
        copy.photoUrl = copy.photo;
        copy.photo = "";
      }
      // Si no hay foto en memoria pero sí URL/path/media, conservar (no borrar Storage en sync)

      // Documento → Storage o rfs_media
      if (isHeavyMedia(copy.documentData) || isDataUrl(copy.documentData)) {
        const mediaId = mediaDocId("emp", owner, "document");
        const path = `employees/${safeId(owner)}/document`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.documentData,
          storagePath: path,
          mediaId: copy.documentMediaId || mediaId,
          kind: "employee",
          ownerId: copy.id || "",
          field: "documentData",
          name: copy.documentName || "",
          mime: copy.documentMime || mimeFromDataUrl(copy.documentData),
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.documentUrl = put.url;
          copy.documentStoragePath = path;
          copy.documentData = "";
          copy.documentMediaId = "";
        } else {
          copy.documentData = "";
          copy.documentMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.documentData)) {
        copy.documentUrl = copy.documentData;
        copy.documentData = "";
      }
      // Conservar documentUrl/path/media si el doc no vino en este guardado

      light.push(copy);
    }
    return { light, mediaJobs };
  }

  async function stripPettyCash(pettyCash) {
    const src = pettyCash && typeof pettyCash === "object" ? pettyCash : emptyPetty();
    const mediaJobs = [];
    const mapList = async (list, prefix) => {
      const out = [];
      for (const row of Array.isArray(list) ? list : []) {
        const copy = { ...(row || {}) };
        if (isHeavyMedia(copy.checkPhoto) || isDataUrl(copy.checkPhoto)) {
          const mediaId = mediaDocId(prefix, copy.id || "x", "check");
          const path = `caja/${safeId(copy.id || "x")}/check.jpg`;
          const put = await putHeavyToStorageOrMedia({
            dataUrl: copy.checkPhoto,
            storagePath: path,
            mediaId: copy.checkPhotoMediaId || mediaId,
            kind: "pettyCash",
            ownerId: copy.id || "",
            field: "checkPhoto",
            mime: "image/jpeg",
            mediaJobs,
          });
          if (put.usedStorage) {
            copy.checkPhotoUrl = put.url;
            copy.checkPhotoStoragePath = path;
            copy.checkPhoto = "";
            copy.checkPhotoMediaId = "";
          } else {
            copy.checkPhoto = "";
            copy.checkPhotoMediaId = put.mediaId || mediaId;
          }
        } else if (isHttpUrl(copy.checkPhoto)) {
          copy.checkPhotoUrl = copy.checkPhoto;
          copy.checkPhoto = "";
        }
        out.push(copy);
      }
      return out;
    };
    const light = {
      ...src,
      expenses: await mapList(src.expenses, "caja"),
      deletedExpenses: await mapList(src.deletedExpenses, "cajaDel"),
    };
    return { light, mediaJobs };
  }

  async function stripHr(hr) {
    const src = hr && typeof hr === "object" ? hr : emptyHr();
    const mediaJobs = [];
    const applications = [];
    for (const app of Array.isArray(src.applications) ? src.applications : []) {
      const copy = { ...(app || {}) };
      if (isHeavyMedia(copy.photo) || isDataUrl(copy.photo)) {
        const mediaId = mediaDocId("hr", copy.id || "x", "photo");
        const path = `hr/${safeId(copy.id || "x")}/photo.jpg`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.photo,
          storagePath: path,
          mediaId: copy.photoMediaId || mediaId,
          kind: "hr",
          ownerId: copy.id || "",
          field: "photo",
          mime: "image/jpeg",
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.photoUrl = put.url;
          copy.photoStoragePath = path;
          copy.photo = "";
          copy.photoMediaId = "";
        } else {
          copy.photo = "";
          copy.photoMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.photo)) {
        copy.photoUrl = copy.photo;
        copy.photo = "";
      }
      // Cédula (desde Depuración) también a Storage
      if (isHeavyMedia(copy.cedulaPhoto) || isDataUrl(copy.cedulaPhoto)) {
        const mediaId = mediaDocId("hr", copy.id || "x", "cedula");
        const path = `hr/${safeId(copy.id || "x")}/cedula.jpg`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.cedulaPhoto,
          storagePath: path,
          mediaId: copy.cedulaPhotoMediaId || mediaId,
          kind: "hr",
          ownerId: copy.id || "",
          field: "cedulaPhoto",
          mime: "image/jpeg",
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.cedulaPhotoUrl = put.url;
          copy.cedulaPhotoStoragePath = path;
          copy.cedulaPhoto = "";
          copy.cedulaPhotoMediaId = "";
        } else {
          copy.cedulaPhoto = "";
          copy.cedulaPhotoMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.cedulaPhoto)) {
        copy.cedulaPhotoUrl = copy.cedulaPhoto;
        copy.cedulaPhoto = "";
      }
      applications.push(copy);
    }
    return { light: { ...src, applications }, mediaJobs };
  }

  function stripContabilidad(data) {
    const src = data && typeof data === "object" ? data : emptyContabilidad();
    // Nóminas y respaldos viven en rfs_payrolls / rfs_payroll_backups (1 MB c/u)
    const light = {
      expenses: Array.isArray(src.expenses) ? src.expenses : [],
      itbisCollected: Array.isArray(src.itbisCollected) ? src.itbisCollected : [],
      officeEmployees: Array.isArray(src.officeEmployees) ? src.officeEmployees : [],
      lotedomEmployees: Array.isArray(src.lotedomEmployees) ? src.lotedomEmployees : [],
      payrolls: [],
      payrollBackups: [],
      payrollBackupDeletedIds: [],
      settings: src.settings && typeof src.settings === "object" ? src.settings : { defaultBook: "EDWARD" },
      payrollsSplit: true,
    };
    return { light, mediaJobs: [] };
  }

  async function loadPayrollIndex() {
    try {
      const doc = await getDoc(payrollIndexPath());
      if (!doc || !doc.fields) return { payrollIds: [], deletedBackupIds: [], updatedAt: null };
      const fields = doc.fields;
      return {
        payrollIds: parseArrayField(fields, "payrollIdsJson").map(String).filter(Boolean),
        deletedBackupIds: parseArrayField(fields, "deletedBackupIdsJson").map(String).filter(Boolean),
        updatedAt: (fields.updatedAt && fields.updatedAt.stringValue) || null,
      };
    } catch (_) {
      return { payrollIds: [], deletedBackupIds: [], updatedAt: null };
    }
  }

  async function loadPayrollDocsByIds(ids) {
    const unique = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    const payrolls = [];
    await Promise.all(
      unique.map(async (id) => {
        try {
          const doc = await getDoc(payrollPath(id));
          if (!doc || !doc.fields) return;
          const row = parseObjectField(doc.fields, "payrollJson");
          if (row && row.id) payrolls.push(row);
        } catch (_) {}
      })
    );
    return payrolls;
  }

  async function loadPayrollBackupDocsByIds(ids) {
    const unique = [...new Set((ids || []).map((id) => String(id || "").trim()).filter(Boolean))];
    const backups = [];
    await Promise.all(
      unique.map(async (id) => {
        try {
          const doc = await getDoc(payrollBackupPath(id));
          if (!doc || !doc.fields) return;
          const row = parseObjectField(doc.fields, "backupJson");
          if (row && row.id) backups.push(row);
        } catch (_) {}
      })
    );
    return backups;
  }

  async function discoverPayrollIds() {
    const index = await loadPayrollIndex();
    const ids = new Set(index.payrollIds || []);
    try {
      const docs = await listCollectionDocs(PAYROLLS_COLLECTION, 100);
      docs.forEach((doc) => {
        const id = docIdFromName(doc.name);
        if (id) ids.add(id);
        const row = doc.fields ? parseObjectField(doc.fields, "payrollJson") : null;
        if (row && row.id) ids.add(String(row.id));
      });
    } catch (_) {}
    return { ids: [...ids], deletedBackupIds: index.deletedBackupIds || [] };
  }

  async function loadSeparatedPayrollBundle() {
    const discovered = await discoverPayrollIds();
    const [payrolls, backups] = await Promise.all([
      loadPayrollDocsByIds(discovered.ids),
      loadPayrollBackupDocsByIds(discovered.ids),
    ]);
    return {
      payrolls,
      payrollBackups: prunePayrollBackupsOnePerPayroll(backups, discovered.deletedBackupIds),
      payrollBackupDeletedIds: discovered.deletedBackupIds,
    };
  }

  function mergeContabilidadWithSeparatedPayrolls(contab, separated) {
    const base = contab && typeof contab === "object" ? contab : emptyContabilidad();
    const sep = separated || { payrolls: [], payrollBackups: [], payrollBackupDeletedIds: [] };
    // Si aún hay nóminas embebidas (clientes viejos), fusionarlas una vez
    const merged = mergeContabilidadPreferFilledPayrolls(
      {
        ...base,
        payrolls: Array.isArray(base.payrolls) ? base.payrolls : [],
        payrollBackups: Array.isArray(base.payrollBackups) ? base.payrollBackups : [],
        payrollBackupDeletedIds: Array.isArray(base.payrollBackupDeletedIds)
          ? base.payrollBackupDeletedIds
          : [],
      },
      {
        payrolls: sep.payrolls || [],
        payrollBackups: sep.payrollBackups || [],
        payrollBackupDeletedIds: sep.payrollBackupDeletedIds || [],
      }
    );
    return merged;
  }

  async function persistSeparatedPayrolls(contab) {
    const src = contab && typeof contab === "object" ? contab : emptyContabilidad();
    const deletedIds = (src.payrollBackupDeletedIds || []).map(String).filter(Boolean).slice(0, 400);
    const payrolls = Array.isArray(src.payrolls) ? src.payrolls.filter((p) => p && p.id) : [];
    const backups = prunePayrollBackupsOnePerPayroll(src.payrollBackups || [], deletedIds);
    const localIds = payrolls.map((p) => String(p.id));
    const localIdSet = new Set(localIds);
    const updatedAt = new Date().toISOString();

    // Fusionar cada nómina con su doc remoto (no perder montos de otra PC)
    await Promise.all(
      payrolls.map(async (p) => {
        let toSave = p;
        try {
          const remoteDoc = await getDoc(payrollPath(p.id));
          if (remoteDoc && remoteDoc.fields) {
            const remote = parseObjectField(remoteDoc.fields, "payrollJson");
            if (remote && remote.id) toSave = mergePayrollRowsPreserveAmounts(p, remote);
          }
        } catch (_) {}
        await patchDoc(
          payrollPath(p.id),
          {
            payrollJson: { stringValue: JSON.stringify(toSave) },
            group: { stringValue: String(toSave.group || "") },
            period: { stringValue: String(toSave.period || "") },
            updatedAt: { stringValue: String(toSave.updatedAt || updatedAt) },
          },
          ["payrollJson", "group", "period", "updatedAt"]
        );
      })
    );

    await Promise.all(
      backups.map(async (b) => {
        const pid = String(b.payrollId || (b.snapshot && b.snapshot.id) || "").trim();
        if (!pid) return;
        await patchDoc(
          payrollBackupPath(pid),
          {
            backupJson: { stringValue: JSON.stringify(b) },
            payrollId: { stringValue: pid },
            updatedAt: { stringValue: String(b.updatedAt || b.createdAt || updatedAt) },
          },
          ["backupJson", "payrollId", "updatedAt"]
        );
      })
    );

    // Borrar docs huérfanos (nómina eliminada en la app)
    let previousIds = [];
    try {
      const idx = await loadPayrollIndex();
      previousIds = idx.payrollIds || [];
    } catch (_) {}
    const toDelete = previousIds.filter((id) => id && !localIdSet.has(String(id)));
    await Promise.all(
      toDelete.map(async (id) => {
        try {
          await deleteDocByPath(payrollPath(id));
        } catch (_) {}
        try {
          await deleteDocByPath(payrollBackupPath(id));
        } catch (_) {}
      })
    );

    await patchDoc(
      payrollIndexPath(),
      {
        payrollIdsJson: { stringValue: JSON.stringify(localIds) },
        deletedBackupIdsJson: { stringValue: JSON.stringify(deletedIds) },
        updatedAt: { stringValue: updatedAt },
        schema: { stringValue: "payrolls-v1" },
      },
      ["payrollIdsJson", "deletedBackupIdsJson", "updatedAt", "schema"]
    );

    return { payrollIds: localIds, backups: backups.length, deletedOrphans: toDelete.length };
  }

  function payrollNamedCount(p) {
    if (!p || !Array.isArray(p.lines)) return 0;
    return p.lines.filter((l) => String((l && l.fullName) || "").trim()).length;
  }

  function payrollLineMoneyScore(p) {
    if (!p || !Array.isArray(p.lines)) return 0;
    let score = 0;
    p.lines.forEach((l) => {
      if (!l || !String(l.fullName || "").trim()) return;
      score += Number(l.adelantos) > 0 ? 1 : 0;
      score += Number(l.prestamos) > 0 ? 1 : 0;
      score += Number(l.horasExtras) > 0 ? 1 : 0;
      score += Number(l.sfs) > 0 ? 1 : 0;
    });
    return score;
  }

  /** Une dos versiones de la misma nómina sin perder adelantos / extras / préstamos tecleados. */
  function mergePayrollRowsPreserveAmounts(a, b) {
    if (!a) return b;
    if (!b) return a;
    const aN = payrollNamedCount(a);
    const bN = payrollNamedCount(b);
    if (aN > 0 && bN === 0) return a;
    if (bN > 0 && aN === 0) return b;
    let winner = String(b.updatedAt || "") > String(a.updatedAt || "") ? b : a;
    let other = winner === a ? b : a;
    // Si el "más nuevo" tiene claramente menos montos tecleados, preferir el más completo
    const scoreW = payrollLineMoneyScore(winner);
    const scoreO = payrollLineMoneyScore(other);
    if (scoreO > scoreW + 2 && payrollNamedCount(other) >= payrollNamedCount(winner)) {
      const tmp = winner;
      winner = other;
      other = tmp;
    }
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
      // No pisar con 0 un monto que la otra copia sí tenía
      ["adelantos", "prestamos", "incentivos", "almuerzo"].forEach((f) => {
        const wv = Number(next[f]) || 0;
        const ov = Number(o[f]) || 0;
        if (wv === 0 && ov > 0) next[f] = o[f];
      });
      if (!(Number(next.horasExtras) > 0) && Number(o.horasExtras) > 0 && !next.horasExtrasManual) {
        next.horasExtras = o.horasExtras;
        if (o.horasExtrasManual) next.horasExtrasManual = true;
      }
      if (next.horasExtrasManual && !(Number(next.horasExtras) >= 0) && o.horasExtrasManual) {
        next.horasExtras = o.horasExtras;
      }
      if (next.sfsManual && !(Number(next.sfs) > 0) && Number(o.sfs) > 0) {
        // sfs manual en 0 es válido; no recuperar
      } else if (!next.sfsManual && !(Number(next.sfs) > 0) && Number(o.sfs) > 0) {
        next.sfs = o.sfs;
      }
      return next;
    });
    return { ...winner, lines };
  }

  /** Un solo respaldo por nómina (el más reciente con empleados). */
  function prunePayrollBackupsOnePerPayroll(list, deletedIds) {
    const banned = new Set(
      (Array.isArray(deletedIds) ? deletedIds : []).map((id) => String(id || "").trim()).filter(Boolean)
    );
    const byPay = new Map();
    (Array.isArray(list) ? list : []).forEach((b) => {
      if (!b || !b.id || banned.has(b.id)) return;
      const pid = String(b.payrollId || (b.snapshot && b.snapshot.id) || "").trim();
      if (!pid) return;
      if (!payrollNamedCount(b.snapshot) && banned.has(`pay:${pid}`)) return;
      const prev = byPay.get(pid);
      if (!prev) {
        byPay.set(pid, b);
        return;
      }
      const prevN = payrollNamedCount(prev.snapshot);
      const rowN = payrollNamedCount(b.snapshot);
      if (prevN > 0 && rowN === 0) return;
      if (rowN > 0 && prevN === 0) {
        byPay.set(pid, b);
        return;
      }
      if (String(b.updatedAt || b.createdAt || "") > String(prev.updatedAt || prev.createdAt || "")) {
        byPay.set(pid, b);
      }
    });
    return [...byPay.values()].sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );
  }

  /** Evita que un cliente con nómina vacía borre la versión con empleados en la nube. */
  function mergeContabilidadPreferFilledPayrolls(localContab, remoteContab) {
    const local = localContab && typeof localContab === "object" ? localContab : emptyContabilidad();
    const remote = remoteContab && typeof remoteContab === "object" ? remoteContab : emptyContabilidad();
    const map = new Map();
    function consider(row) {
      if (!row || !row.id) return;
      const prev = map.get(row.id);
      if (!prev) {
        map.set(row.id, row);
        return;
      }
      map.set(row.id, mergePayrollRowsPreserveAmounts(prev, row));
    }
    [...(remote.payrolls || []), ...(local.payrolls || [])].forEach(consider);
    const payrolls = [...map.values()].sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
    const deletedIds = [];
    const deletedSeen = new Set();
    [...(local.payrollBackupDeletedIds || []), ...(remote.payrollBackupDeletedIds || [])].forEach((id) => {
      const s = String(id || "").trim();
      if (!s || deletedSeen.has(s)) return;
      deletedSeen.add(s);
      deletedIds.push(s);
    });
    const backupMap = new Map();
    function considerBackup(row) {
      if (!row || !row.id || deletedSeen.has(row.id)) return;
      const suppress = `pay:${String(row.payrollId || (row.snapshot && row.snapshot.id) || "").trim()}`;
      if (deletedSeen.has(suppress)) return;
      const prev = backupMap.get(row.id);
      if (!prev) {
        backupMap.set(row.id, row);
        return;
      }
      const prevN = payrollNamedCount(prev.snapshot);
      const rowN = payrollNamedCount(row.snapshot);
      if (prevN > 0 && rowN === 0) return;
      if (rowN > 0 && prevN === 0) {
        backupMap.set(row.id, row);
        return;
      }
      if (String(row.updatedAt || row.createdAt || "") > String(prev.updatedAt || prev.createdAt || "")) {
        backupMap.set(row.id, row);
      }
    }
    [...(remote.payrollBackups || []), ...(local.payrollBackups || [])].forEach(considerBackup);
    // Crítico: no reacumular 30 respaldos en el doc de 1 MB — 1 por nómina
    const pruned = prunePayrollBackupsOnePerPayroll([...backupMap.values()], deletedIds);
    const keptIds = new Set(pruned.map((b) => b.id));
    [...backupMap.keys()].forEach((id) => {
      if (!keptIds.has(id) && !deletedSeen.has(id)) {
        deletedSeen.add(id);
        deletedIds.push(id);
      }
    });
    return {
      ...local,
      payrolls,
      payrollBackups: pruned,
      payrollBackupDeletedIds: deletedIds.slice(0, 400),
    };
  }

  async function stripSuplidores(data) {
    const src = data && typeof data === "object" ? data : emptySuplidores();
    const mediaJobs = [];
    const payments = [];
    for (const row of Array.isArray(src.payments) ? src.payments : []) {
      const copy = { ...(row || {}) };
      if (isHeavyMedia(copy.evidencePhoto) || isDataUrl(copy.evidencePhoto)) {
        const mediaId = mediaDocId("sup", copy.id || "x", "evidence");
        const path = `suplidores/${safeId(copy.id || "x")}/evidence.jpg`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.evidencePhoto,
          storagePath: path,
          mediaId: copy.evidencePhotoMediaId || mediaId,
          kind: "suplidores",
          ownerId: copy.id || "",
          field: "evidencePhoto",
          mime: "image/jpeg",
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.evidencePhotoUrl = put.url;
          copy.evidencePhotoStoragePath = path;
          copy.evidencePhoto = "";
          copy.evidencePhotoMediaId = "";
        } else {
          copy.evidencePhoto = "";
          copy.evidencePhotoMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.evidencePhoto)) {
        copy.evidencePhotoUrl = copy.evidencePhoto;
        copy.evidencePhoto = "";
      }
      payments.push(copy);
    }
    return {
      light: {
        suppliers: Array.isArray(src.suppliers) ? src.suppliers : [],
        payments,
        nextCodeSeq: Math.max(1, Number(src.nextCodeSeq) || 1),
      },
      mediaJobs,
    };
  }

  async function stripDepuracion(dep) {
    const src = dep && typeof dep === "object" ? dep : emptyDepuracion();
    const mediaJobs = [];
    const candidates = [];
    for (const row of Array.isArray(src.candidates) ? src.candidates : []) {
      const copy = { ...(row || {}) };
      if (isHeavyMedia(copy.cedulaPhoto) || isDataUrl(copy.cedulaPhoto)) {
        const mediaId = mediaDocId("dep", copy.id || "x", "cedula");
        const path = `dep/${safeId(copy.id || "x")}/cedula.jpg`;
        const put = await putHeavyToStorageOrMedia({
          dataUrl: copy.cedulaPhoto,
          storagePath: path,
          mediaId: copy.cedulaPhotoMediaId || mediaId,
          kind: "depuracion",
          ownerId: copy.id || "",
          field: "cedulaPhoto",
          mime: "image/jpeg",
          mediaJobs,
        });
        if (put.usedStorage) {
          copy.cedulaPhotoUrl = put.url;
          copy.cedulaPhotoStoragePath = path;
          copy.cedulaPhoto = "";
          copy.cedulaPhotoMediaId = "";
        } else {
          copy.cedulaPhoto = "";
          copy.cedulaPhotoMediaId = put.mediaId || mediaId;
        }
      } else if (isHttpUrl(copy.cedulaPhoto)) {
        copy.cedulaPhotoUrl = copy.cedulaPhoto;
        copy.cedulaPhoto = "";
      }
      candidates.push(copy);
    }
    return {
      light: {
        ...src,
        settings: src.settings && typeof src.settings === "object" ? src.settings : {},
        candidates,
      },
      mediaJobs,
    };
  }

  function collectMediaIds(employees, pettyCash, hr, depuracion, suplidores) {
    const ids = [];
    (employees || []).forEach((e) => {
      if (e && e.photoMediaId) ids.push(e.photoMediaId);
      if (e && e.documentMediaId) ids.push(e.documentMediaId);
    });
    const pc = pettyCash || {};
    [...(pc.expenses || []), ...(pc.deletedExpenses || [])].forEach((e) => {
      if (e && e.checkPhotoMediaId) ids.push(e.checkPhotoMediaId);
    });
    ((hr && hr.applications) || []).forEach((a) => {
      if (a && a.photoMediaId) ids.push(a.photoMediaId);
      if (a && a.cedulaPhotoMediaId) ids.push(a.cedulaPhotoMediaId);
    });
    ((depuracion && depuracion.candidates) || []).forEach((c) => {
      if (c && c.cedulaPhotoMediaId) ids.push(c.cedulaPhotoMediaId);
    });
    const sup = suplidores || {};
    (Array.isArray(sup.payments) ? sup.payments : []).forEach((p) => {
      if (p && p.evidencePhotoMediaId) ids.push(p.evidencePhotoMediaId);
    });
    return ids;
  }

  function storagePublicUrl(path) {
    if (!path || !storageBucket) return "";
    return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(
      path
    )}?alt=media`;
  }

  function hydrateEmployees(employees, mediaMap) {
    return (employees || []).map((emp) => {
      const copy = { ...(emp || {}) };
      // Preferir URL de Storage; legacy rfs_media → data URL en photo
      if (copy.photoUrl && isHttpUrl(copy.photoUrl)) {
        copy.photo = copy.photoUrl;
      } else if (copy.photoMediaId && mediaMap[copy.photoMediaId]) {
        copy.photo = mediaMap[copy.photoMediaId];
      } else if (!copy.photo && copy.photoStoragePath) {
        // Recuperar URL si se perdió photoUrl pero quedó la ruta
        copy.photoUrl = storagePublicUrl(copy.photoStoragePath);
        copy.photo = copy.photoUrl;
      }
      if (copy.documentUrl && isHttpUrl(copy.documentUrl)) {
        copy.documentData = copy.documentUrl;
      } else if (copy.documentMediaId && mediaMap[copy.documentMediaId]) {
        copy.documentData = mediaMap[copy.documentMediaId];
      } else if (!copy.documentData && copy.documentStoragePath) {
        copy.documentUrl = storagePublicUrl(copy.documentStoragePath);
        copy.documentData = copy.documentUrl;
      }
      return copy;
    });
  }

  function hydratePettyCash(pettyCash, mediaMap) {
    const src = pettyCash && typeof pettyCash === "object" ? { ...pettyCash } : emptyPetty();
    const hydrateList = (list) =>
      (Array.isArray(list) ? list : []).map((row) => {
        const copy = { ...(row || {}) };
        if (copy.checkPhotoUrl && isHttpUrl(copy.checkPhotoUrl)) {
          copy.checkPhoto = copy.checkPhotoUrl;
        } else if (copy.checkPhotoMediaId && mediaMap[copy.checkPhotoMediaId]) {
          copy.checkPhoto = mediaMap[copy.checkPhotoMediaId];
        }
        return copy;
      });
    src.expenses = hydrateList(src.expenses);
    src.deletedExpenses = hydrateList(src.deletedExpenses);
    return src;
  }

  function hydrateHr(hr, mediaMap) {
    const src = hr && typeof hr === "object" ? { ...hr } : emptyHr();
    src.applications = (Array.isArray(src.applications) ? src.applications : []).map((app) => {
      const copy = { ...(app || {}) };
      if (copy.photoUrl && isHttpUrl(copy.photoUrl)) {
        copy.photo = copy.photoUrl;
      } else if (copy.photoMediaId && mediaMap[copy.photoMediaId]) {
        copy.photo = mediaMap[copy.photoMediaId];
      }
      if (copy.cedulaPhotoUrl && isHttpUrl(copy.cedulaPhotoUrl)) {
        copy.cedulaPhoto = copy.cedulaPhotoUrl;
      } else if (copy.cedulaPhotoMediaId && mediaMap[copy.cedulaPhotoMediaId]) {
        copy.cedulaPhoto = mediaMap[copy.cedulaPhotoMediaId];
      }
      return copy;
    });
    return src;
  }

  function hydrateDepuracion(dep, mediaMap) {
    const src = dep && typeof dep === "object" ? { ...dep } : emptyDepuracion();
    src.candidates = (Array.isArray(src.candidates) ? src.candidates : []).map((row) => {
      const copy = { ...(row || {}) };
      if (copy.cedulaPhotoUrl && isHttpUrl(copy.cedulaPhotoUrl)) {
        copy.cedulaPhoto = copy.cedulaPhotoUrl;
      } else if (copy.cedulaPhotoMediaId && mediaMap[copy.cedulaPhotoMediaId]) {
        copy.cedulaPhoto = mediaMap[copy.cedulaPhotoMediaId];
      }
      return copy;
    });
    return src;
  }

  function hydrateSuplidores(data, mediaMap) {
    const src = data && typeof data === "object" ? { ...data } : emptySuplidores();
    src.payments = (Array.isArray(src.payments) ? src.payments : []).map((row) => {
      const copy = { ...(row || {}) };
      if (copy.evidencePhotoUrl && isHttpUrl(copy.evidencePhotoUrl)) {
        copy.evidencePhoto = copy.evidencePhotoUrl;
      } else if (copy.evidencePhotoMediaId && mediaMap[copy.evidencePhotoMediaId]) {
        copy.evidencePhoto = mediaMap[copy.evidencePhotoMediaId];
      }
      return copy;
    });
    if (!Array.isArray(src.suppliers)) src.suppliers = [];
    src.nextCodeSeq = Math.max(1, Number(src.nextCodeSeq) || 1);
    return src;
  }


  async function loadSplitParts() {
    const names = Object.keys(PART_DOCS);
    const docs = await Promise.all(
      names.map(async (n) => {
        try {
          return await getDoc(partPath(n));
        } catch (_) {
          return null;
        }
      })
    );
    const byName = {};
    names.forEach((n, i) => {
      byName[n] = docs[i];
    });
    return byName;
  }

  /** Solo lee updatedAt / versión App del documento main (barato, para sync en vivo). */
  async function peekCloudUpdatedAt() {
    if (!projectId || !apiKey) return null;
    try {
      const main = await getDoc(partPath("main"));
      if (!main) return { empty: true, updatedAt: null, appBuild: 0, minAppBuild: 0 };
      const fields = main.fields || {};
      const num = (f) => {
        if (!f) return 0;
        if (f.integerValue != null) return Number(f.integerValue) || 0;
        if (f.stringValue != null) return Number(f.stringValue) || 0;
        return 0;
      };
      return {
        empty: false,
        updatedAt: (fields.updatedAt && fields.updatedAt.stringValue) || null,
        appBuild: num(fields.appBuild),
        minAppBuild: num(fields.minAppBuild),
      };
    } catch (_) {
      return null;
    }
  }

  /** Lectura ligera para fusionar antes de guardar (main + loans + empleados/hr/contab, sin fotos). */
  async function loadCloudForMerge() {
    if (!projectId || !apiKey) return null;
    let main = null;
    try {
      main = await getDoc(partPath("main"));
    } catch (_) {
      return null;
    }
    if (!main) {
      return {
        empty: true,
        messages: [],
        lva: {},
        loans: [],
        loanTrash: [],
        employees: [],
        hr: emptyHr(),
        contabilidad: emptyContabilidad(),
        suplidores: emptySuplidores(),
        vargas: emptyVargas(),
      };
    }
    const [loans, employees, hr, contab, supl, varg, postsDoc] = await Promise.all([
      getDoc(partPath("loans")).catch(() => null),
      getDoc(partPath("employees")).catch(() => null),
      getDoc(partPath("hr")).catch(() => null),
      getDoc(partPath("contabilidad")).catch(() => null),
      getDoc(partPath("suplidores")).catch(() => null),
      getDoc(partPath("vargas")).catch(() => null),
      getDoc(partPath("posts")).catch(() => null),
    ]);
    const mainFields = main.fields || {};
    const loanFields = (loans && loans.fields) || {};
    const empFields = (employees && employees.fields) || {};
    const hrFields = (hr && hr.fields) || {};
    const contabFields = (contab && contab.fields) || {};
    const postsFields = (postsDoc && postsDoc.fields) || {};
    let contabilidad = contabFields.contabilidadJson
      ? parseObjectField(contabFields, "contabilidadJson")
      : emptyContabilidad();
    try {
      const separated = await loadSeparatedPayrollBundle();
      contabilidad = mergeContabilidadWithSeparatedPayrolls(contabilidad, separated);
    } catch (err) {
      console.warn("RFS: no se pudieron cargar nóminas separadas (merge)", err);
    }
    return {
      empty: false,
      messages: parseArrayField(mainFields, "messagesJson"),
      lva: parseObjectField(mainFields, "lvaJson"),
      posts: postsFields.postsJson
        ? parseArrayField(postsFields, "postsJson")
        : parseArrayField(mainFields, "postsJson"),
      loans: loanFields.loansJson
        ? parseArrayField(loanFields, "loansJson")
        : parseArrayField(mainFields, "loansJson"),
      loanTrash: loanFields.loanTrashJson
        ? parseArrayField(loanFields, "loanTrashJson")
        : parseArrayField(mainFields, "loanTrashJson"),
      employees: empFields.employeesJson
        ? parseArrayField(empFields, "employeesJson")
        : parseArrayField(mainFields, "employeesJson"),
      hr: hrFields.hrJson ? parseObjectField(hrFields, "hrJson") : emptyHr(),
      contabilidad,
      suplidores: supl && supl.fields && supl.fields.suplidoresJson
        ? parseObjectField(supl.fields, "suplidoresJson")
        : emptySuplidores(),
      vargas: varg && varg.fields && varg.fields.vargasJson
        ? parseObjectField(varg.fields, "vargasJson")
        : emptyVargas(),
      partial: !loans || !employees,
    };
  }

  function fieldLen(doc, key) {
    const raw = doc && doc.fields && doc.fields[key] && doc.fields[key].stringValue;
    return raw ? raw.length : 0;
  }

  function hasSplitData(parts) {
    if (!parts || !parts.main) return false;
    const ver =
      (parts.main.fields &&
        parts.main.fields.schemaVersion &&
        parts.main.fields.schemaVersion.stringValue) ||
      "";
    if (Number(ver) >= 2) return true;
    // Si ya existen partes con contenido, son la fuente de verdad
    // (aunque un cliente viejo haya vuelto a hinchar rfs/main).
    if (fieldLen(parts.employees, "employeesJson") > 10) return true;
    if (fieldLen(parts.posts, "postsJson") > 10) return true;
    if (fieldLen(parts.pettyCash, "pettyCashJson") > 10) return true;
    if (fieldLen(parts.hr, "hrJson") > 10) return true;
    if (fieldLen(parts.depuracion, "depuracionJson") > 10) return true;
    if (fieldLen(parts.contabilidad, "contabilidadJson") > 10) return true;
    if (fieldLen(parts.suplidores, "suplidoresJson") > 10) return true;
    if (fieldLen(parts.vargas, "vargasJson") > 10) return true;
    return false;
  }

  function decodeSplit(parts) {
    const main = (parts.main && parts.main.fields) || {};
    const posts = (parts.posts && parts.posts.fields) || {};
    const employees = (parts.employees && parts.employees.fields) || {};
    const loans = (parts.loans && parts.loans.fields) || {};
    const activity = (parts.activity && parts.activity.fields) || {};
    const petty = (parts.pettyCash && parts.pettyCash.fields) || {};
    const hr = (parts.hr && parts.hr.fields) || {};
    const dep = (parts.depuracion && parts.depuracion.fields) || {};
    const contab = (parts.contabilidad && parts.contabilidad.fields) || {};

    // Compat: si un part falta, intentar campo legacy en main
    const legacy = parts.main ? decodeLegacyMain(parts.main) : null;

    return {
      posts: posts.postsJson ? parseArrayField(posts, "postsJson") : (legacy && legacy.posts) || [],
      reports: parseArrayField(main, "reportsJson"),
      employees: employees.employeesJson
        ? parseArrayField(employees, "employeesJson")
        : (legacy && legacy.employees) || [],
      loans: loans.loansJson ? parseArrayField(loans, "loansJson") : (legacy && legacy.loans) || [],
      loanTrash: loans.loanTrashJson
        ? parseArrayField(loans, "loanTrashJson")
        : (legacy && legacy.loanTrash) || [],
      monorrielReports: parseArrayField(main, "monorrielReportsJson"),
      users: parseArrayField(main, "usersJson"),
      messages: parseArrayField(main, "messagesJson"),
      radio: parseObjectField(main, "radioJson"),
      activity: activity.activityJson
        ? parseArrayField(activity, "activityJson")
        : (legacy && legacy.activity) || [],
      lva: parseObjectField(main, "lvaJson"),
      pettyCash: petty.pettyCashJson
        ? parseObjectField(petty, "pettyCashJson")
        : (legacy && legacy.pettyCash) || emptyPetty(),
      hr: hr.hrJson ? parseObjectField(hr, "hrJson") : (legacy && legacy.hr) || emptyHr(),
      depuracion: dep.depuracionJson
        ? parseObjectField(dep, "depuracionJson")
        : (legacy && legacy.depuracion) || emptyDepuracion(),
      contabilidad: contab.contabilidadJson
        ? parseObjectField(contab, "contabilidadJson")
        : (legacy && legacy.contabilidad) || emptyContabilidad(),
      suplidores: ((parts.suplidores && parts.suplidores.fields) || {}).suplidoresJson
        ? parseObjectField((parts.suplidores && parts.suplidores.fields) || {}, "suplidoresJson")
        : emptySuplidores(),
      vargas: ((parts.vargas && parts.vargas.fields) || {}).vargasJson
        ? parseObjectField((parts.vargas && parts.vargas.fields) || {}, "vargasJson")
        : emptyVargas(),
      updatedAt: (main.updatedAt && main.updatedAt.stringValue) || null,
      schemaVersion: (main.schemaVersion && main.schemaVersion.stringValue) || SCHEMA_VERSION,
    };
  }

  async function hydrateBundle(bundle) {
    const mediaIds = collectMediaIds(
      bundle.employees,
      bundle.pettyCash,
      bundle.hr,
      bundle.depuracion,
      bundle.suplidores
    );
    // Siempre hidratar: photoUrl de Storage → photo; legacy rfs_media si hay ids
    const mediaMap = mediaIds.length ? await loadMediaMap(mediaIds) : {};
    return {
      ...bundle,
      employees: hydrateEmployees(bundle.employees, mediaMap),
      pettyCash: hydratePettyCash(bundle.pettyCash, mediaMap),
      hr: hydrateHr(bundle.hr, mediaMap),
      depuracion: hydrateDepuracion(bundle.depuracion, mediaMap),
      suplidores: hydrateSuplidores(bundle.suplidores, mediaMap),
    };
  }

  async function healFatMainIfNeeded(parts) {
    try {
      if (!hasSplitData(parts) || !parts.main) return;
      const mainSize = JSON.stringify(parts.main).length;
      if (mainSize < 200000) return; // main sano
      const fields = parts.main.fields || {};
      await patchDoc(
        partPath("main"),
        {
          usersJson: fields.usersJson || { stringValue: "[]" },
          messagesJson: fields.messagesJson || { stringValue: "[]" },
          radioJson: fields.radioJson || { stringValue: "{}" },
          lvaJson: fields.lvaJson || { stringValue: "{}" },
          reportsJson: fields.reportsJson || { stringValue: "[]" },
          monorrielReportsJson: fields.monorrielReportsJson || { stringValue: "[]" },
          schemaVersion: { stringValue: SCHEMA_VERSION },
          updatedAt: fields.updatedAt || { stringValue: new Date().toISOString() },
          app: fields.app || { stringValue: "Reaction Force Security Ops" },
          postsJson: { stringValue: "[]" },
          employeesJson: { stringValue: "[]" },
          loansJson: { stringValue: "[]" },
          activityJson: { stringValue: "[]" },
          pettyCashJson: { stringValue: "{}" },
          hrJson: { stringValue: "{}" },
        }
      );
    } catch (_) {}
  }

  async function loadCloud() {
    if (!projectId || !apiKey) return null;

    const parts = await loadSplitParts();
    if (!parts.main) {
      return {
        posts: [],
        reports: [],
        employees: [],
        loans: [],
        loanTrash: [],
        monorrielReports: [],
        users: [],
        messages: [],
        radio: {},
        activity: [],
        lva: {},
        pettyCash: emptyPetty(),
        hr: emptyHr(),
        depuracion: emptyDepuracion(),
        contabilidad: emptyContabilidad(),
        suplidores: emptySuplidores(),
        vargas: emptyVargas(),
        updatedAt: null,
        empty: true,
        schemaVersion: SCHEMA_VERSION,
      };
    }

    let bundle;
    if (hasSplitData(parts)) {
      bundle = decodeSplit(parts);
      // Si un cliente viejo rehinchó main, liberarlo en segundo plano
      healFatMainIfNeeded(parts);
    } else {
      bundle = decodeLegacyMain(parts.main);
    }

    const hydrated = await hydrateBundle(bundle);
    try {
      const separated = await loadSeparatedPayrollBundle();
      hydrated.contabilidad = mergeContabilidadWithSeparatedPayrolls(
        hydrated.contabilidad,
        separated
      );
    } catch (err) {
      console.warn("RFS: no se pudieron cargar nóminas separadas", err);
    }
    const empty =
      !hydrated.posts.length &&
      !hydrated.employees.length &&
      !hydrated.users.length &&
      !(hydrated.pettyCash.expenses || []).length;
    return { ...hydrated, empty };
  }

  async function persistMediaJobs(jobs) {
    const list = jobs || [];
    // Evitar escribir vacíos; sí escribir cuando hay data
    await Promise.all(
      list
        .filter((j) => j && j.id && isHeavyMedia(j.data))
        .map((j) => putMedia(j.id, j))
    );
  }

  async function saveCloud(
    posts,
    reports,
    employees,
    loans,
    monorrielReports,
    users,
    messages,
    radio,
    activity,
    lva,
    pettyCash,
    hr,
    depuracion,
    contabilidad,
    suplidores,
    loanTrash,
    vargas,
    options
  ) {
    if (!projectId || !apiKey) throw new Error("cloud not configured");
    const opts = options && typeof options === "object" ? options : {};
    const clientBuild = Math.max(0, Number(opts.clientBuild) || 0);

    // Candado: clientes viejos no pueden pisar la nube
    try {
      const peek = await peekCloudUpdatedAt();
      const required = peek && peek.minAppBuild ? Number(peek.minAppBuild) : 0;
      if (required > 0 && clientBuild > 0 && clientBuild < required) {
        const err = new Error("APP_OUTDATED");
        err.code = "APP_OUTDATED";
        err.requiredBuild = required;
        err.clientBuild = clientBuild;
        throw err;
      }
    } catch (err) {
      if (err && (err.code === "APP_OUTDATED" || String(err.message) === "APP_OUTDATED")) throw err;
    }

    // Empleados: fusionar con remoto antes de escribir (anti-pisotón)
    let employeesToSave = Array.isArray(employees) ? employees : [];
    try {
      const remoteEmpDoc = await getDoc(partPath("employees")).catch(() => null);
      const remoteEmployees =
        remoteEmpDoc && remoteEmpDoc.fields && remoteEmpDoc.fields.employeesJson
          ? parseArrayField(remoteEmpDoc.fields, "employeesJson")
          : [];
      if (remoteEmployees.length) {
        employeesToSave = mergeEmployeesPreferUnion(employeesToSave, remoteEmployees);
      }
    } catch (err) {
      console.warn("RFS: no se pudieron fusionar empleados remotos al guardar", err);
    }

    // Reportes incidente: fusionar
    let reportsToSave = Array.isArray(reports) ? reports : [];
    try {
      const remoteMain = await getDoc(partPath("main")).catch(() => null);
      const remoteReports =
        remoteMain && remoteMain.fields && remoteMain.fields.reportsJson
          ? parseArrayField(remoteMain.fields, "reportsJson")
          : [];
      if (remoteReports.length) {
        reportsToSave = mergeReportsPreferUnion(reportsToSave, remoteReports);
      }
    } catch (err) {
      console.warn("RFS: no se pudieron fusionar reportes remotos al guardar", err);
    }

    // Monorriel: fusionar
    let monoToSave = Array.isArray(monorrielReports) ? monorrielReports : [];
    try {
      const remoteMain = await getDoc(partPath("main")).catch(() => null);
      const remoteMono =
        remoteMain && remoteMain.fields && remoteMain.fields.monorrielReportsJson
          ? parseArrayField(remoteMain.fields, "monorrielReportsJson")
          : [];
      if (remoteMono.length) {
        monoToSave = mergeMonorrielPreferUnion(monoToSave, remoteMono);
      }
    } catch (err) {
      console.warn("RFS: no se pudieron fusionar Monorriel remotos al guardar", err);
    }

    const empPack = await stripEmployees(employeesToSave);
    const pettyPack = await stripPettyCash(pettyCash);
    const hrPack = await stripHr(hr);
    const depPack = await stripDepuracion(depuracion);
    const supPack = await stripSuplidores(suplidores);
    const vargasToSave = vargas && typeof vargas === "object" ? vargas : emptyVargas();
    let contabToSave = contabilidad;
    try {
      const remoteContabDoc = await getDoc(partPath("contabilidad")).catch(() => null);
      const remoteContab = remoteContabDoc && remoteContabDoc.fields && remoteContabDoc.fields.contabilidadJson
        ? parseObjectField(remoteContabDoc.fields, "contabilidadJson")
        : null;
      if (remoteContab) {
        contabToSave = mergeContabilidadPreferFilledPayrolls(contabilidad, remoteContab);
      }
    } catch (_) {}
    // Fusionar también con nóminas ya separadas en la nube
    try {
      const separated = await loadSeparatedPayrollBundle();
      contabToSave = mergeContabilidadWithSeparatedPayrolls(contabToSave, separated);
    } catch (_) {}
    // Persistir cada nómina/respaldo en su propio doc (1 MB cada uno)
    try {
      await persistSeparatedPayrolls(contabToSave);
    } catch (err) {
      console.warn("RFS: fallo al guardar nóminas separadas", err);
      throw err;
    }
    const contabPack = stripContabilidad(contabToSave);
    await persistMediaJobs([
      ...empPack.mediaJobs,
      ...pettyPack.mediaJobs,
      ...hrPack.mediaJobs,
      ...depPack.mediaJobs,
      ...contabPack.mediaJobs,
      ...supPack.mediaJobs,
    ]);

    const updatedAt = new Date().toISOString();
    const trashIds = [...new Set((loanTrash || []).map(String).filter(Boolean))].slice(0, 500);
    // Publicar build mínima = esta App (solo la versión actual puede seguir escribiendo)
    const publishBuild = clientBuild > 0 ? clientBuild : 0;
    const mainFields = {
      usersJson: { stringValue: JSON.stringify(users || []) },
      messagesJson: { stringValue: JSON.stringify(messages || []) },
      radioJson: { stringValue: JSON.stringify(radio || {}) },
      reportsJson: { stringValue: JSON.stringify(reportsToSave || []) },
      monorrielReportsJson: { stringValue: JSON.stringify(monoToSave || []) },
      schemaVersion: { stringValue: SCHEMA_VERSION },
      updatedAt: { stringValue: updatedAt },
      app: { stringValue: "Reaction Force Security Ops" },
      appBuild: { integerValue: String(publishBuild || 0) },
      minAppBuild: { integerValue: String(publishBuild || 0) },
      // Liberar campos legacy pesados del documento main
      postsJson: { stringValue: "[]" },
      employeesJson: { stringValue: "[]" },
      loansJson: { stringValue: "[]" },
      activityJson: { stringValue: "[]" },
      pettyCashJson: { stringValue: "{}" },
      hrJson: { stringValue: "{}" },
    };
    // Si skipLva: no tocar lvaJson remoto (evita borrar La Vega cuando no hubo fusión)
    if (!opts.skipLva) {
      mainFields.lvaJson = { stringValue: JSON.stringify(lva || {}) };
    }
    // Antes de escribir clientes: fusionar con la nube (no perder altas como Universidad Isa)
    let postsToSave = Array.isArray(posts) ? posts : [];
    try {
      const remotePostsDoc = await getDoc(partPath("posts")).catch(() => null);
      const remotePosts =
        remotePostsDoc && remotePostsDoc.fields && remotePostsDoc.fields.postsJson
          ? parseArrayField(remotePostsDoc.fields, "postsJson")
          : [];
      if (remotePosts.length) {
        postsToSave = mergePostsPreferUnion(postsToSave, remotePosts);
      }
    } catch (err) {
      console.warn("RFS: no se pudieron fusionar posts remotos al guardar", err);
    }
    const mainMask = Object.keys(mainFields);
    const writes = [
      patchDoc(partPath("main"), mainFields, mainMask),
      patchDoc(partPath("posts"), {
        postsJson: { stringValue: JSON.stringify(postsToSave || []) },
        updatedAt: { stringValue: updatedAt },
      }, ["postsJson", "updatedAt"]),
      patchDoc(partPath("employees"), {
        employeesJson: { stringValue: JSON.stringify(empPack.light || []) },
        updatedAt: { stringValue: updatedAt },
      }, ["employeesJson", "updatedAt"]),
      patchDoc(partPath("loans"), {
        loansJson: { stringValue: JSON.stringify(loans || []) },
        loanTrashJson: { stringValue: JSON.stringify(trashIds) },
        updatedAt: { stringValue: updatedAt },
      }, ["loansJson", "loanTrashJson", "updatedAt"]),
      patchDoc(partPath("activity"), {
        activityJson: { stringValue: JSON.stringify(activity || []) },
        updatedAt: { stringValue: updatedAt },
      }, ["activityJson", "updatedAt"]),
      patchDoc(partPath("pettyCash"), {
        pettyCashJson: { stringValue: JSON.stringify(pettyPack.light || emptyPetty()) },
        updatedAt: { stringValue: updatedAt },
      }, ["pettyCashJson", "updatedAt"]),
      patchDoc(partPath("hr"), {
        hrJson: { stringValue: JSON.stringify(hrPack.light || emptyHr()) },
        updatedAt: { stringValue: updatedAt },
      }, ["hrJson", "updatedAt"]),
      patchDoc(partPath("depuracion"), {
        depuracionJson: { stringValue: JSON.stringify(depPack.light || emptyDepuracion()) },
        updatedAt: { stringValue: updatedAt },
      }, ["depuracionJson", "updatedAt"]),
      patchDoc(partPath("contabilidad"), {
        contabilidadJson: { stringValue: JSON.stringify(contabPack.light || emptyContabilidad()) },
        updatedAt: { stringValue: updatedAt },
      }, ["contabilidadJson", "updatedAt"]),
      patchDoc(partPath("suplidores"), {
        suplidoresJson: { stringValue: JSON.stringify(supPack.light || emptySuplidores()) },
        updatedAt: { stringValue: updatedAt },
      }, ["suplidoresJson", "updatedAt"]),
      patchDoc(partPath("vargas"), {
        vargasJson: { stringValue: JSON.stringify(vargasToSave || emptyVargas()) },
        updatedAt: { stringValue: updatedAt },
      }, ["vargasJson", "updatedAt"]),
    ];

    await Promise.all(writes);
    return { ok: true, schemaVersion: SCHEMA_VERSION, updatedAt, skippedLva: !!opts.skipLva };
  }

  /** Parche ligero solo de mensajes (documento main) */
  async function saveMessages(messages) {
    if (!projectId || !apiKey) throw new Error("cloud not configured");
    const body = {
      messagesJson: { stringValue: JSON.stringify(messages || []) },
      updatedAt: { stringValue: new Date().toISOString() },
    };
    return patchDoc(partPath("main"), body, ["messagesJson", "updatedAt"]);
  }

  window.RFSCloudApi = {
    loadCloud,
    loadCloudForMerge,
    peekCloudUpdatedAt,
    saveCloud,
    saveMessages,
    deleteMedia,
    deleteStoragePath,
    storageEnabled,
    storageBucket: () => storageBucket,
    decodeDoc: decodeLegacyMain,
    mergeEmployeesPreferUnion,
    mergePostsPreferUnion,
    mergeReportsPreferUnion,
    mergeMonorrielPreferUnion,
    loadSeparatedPayrollBundle,
    persistSeparatedPayrolls,
    SCHEMA_VERSION,
  };
})();
