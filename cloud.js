(function () {
  const cfg = window.RFS_CLOUD || {};
  const projectId = cfg.projectId;
  const apiKey = cfg.apiKey;
  const docPath = cfg.docPath || "rfs/main";

  function docUrl() {
    return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${docPath}?key=${encodeURIComponent(apiKey)}`;
  }

  function encodeFields(posts, reports) {
    return {
      fields: {
        postsJson: { stringValue: JSON.stringify(posts || []) },
        reportsJson: { stringValue: JSON.stringify(reports || []) },
        updatedAt: { stringValue: new Date().toISOString() },
        app: { stringValue: "Reaction Force Security Ops" },
      },
    };
  }

  function decodeDoc(doc) {
    const fields = (doc && doc.fields) || {};
    const postsJson = fields.postsJson && fields.postsJson.stringValue;
    const reportsJson = fields.reportsJson && fields.reportsJson.stringValue;
    let posts = [];
    let reports = [];
    try {
      posts = postsJson ? JSON.parse(postsJson) : [];
    } catch (_) {
      posts = [];
    }
    try {
      reports = reportsJson ? JSON.parse(reportsJson) : [];
    } catch (_) {
      reports = [];
    }
    return {
      posts: Array.isArray(posts) ? posts : [],
      reports: Array.isArray(reports) ? reports : [],
      updatedAt: (fields.updatedAt && fields.updatedAt.stringValue) || null,
    };
  }

  async function loadCloud() {
    if (!projectId || !apiKey) return null;
    const res = await fetch(docUrl(), { method: "GET" });
    if (res.status === 404) return { posts: [], reports: [], updatedAt: null, empty: true };
    if (!res.ok) throw new Error(`cloud load ${res.status}`);
    const doc = await res.json();
    return { ...decodeDoc(doc), empty: false };
  }

  async function saveCloud(posts, reports) {
    if (!projectId || !apiKey) throw new Error("cloud not configured");
    const body = encodeFields(posts, reports);
    // PATCH creates or updates
    const res = await fetch(docUrl(), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`cloud save ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  window.RFSCloudApi = { loadCloud, saveCloud, decodeDoc };
})();
