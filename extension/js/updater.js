// Auto-update and model-registry online sync.
// Fetches plugin/update.json from the repo, compares versions, and (when a
// newer build exists) downloads the .zxp to the user's Downloads folder.
window.AIMEVA = window.AIMEVA || {};

(function () {
  var cfg = window.AIMEVA.config;

  function semverOf(v) {
    var m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  }

  function isNewer(local, remote) {
    var a = semverOf(local), b = semverOf(remote);
    if (!a || !b) return false;
    for (var i = 0; i < 3; i++) {
      if (b[i] > a[i]) return true;
      if (b[i] < a[i]) return false;
    }
    return false;
  }

  function fetchJson(url) {
    return fetch(url, { method: "GET" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function checkUpdate() {
    return fetchJson(cfg.updateUrl).then(function (meta) {
      var remote = meta.version;
      var newer = isNewer(cfg.version, remote);
      return {
        available: newer,
        version: remote,
        current: cfg.version,
        notes: meta.notes,
        zxpUrl: meta.zxp_url,
        manualUrl: meta.manual_download || cfg.repoUrl + "/releases"
      };
    }).catch(function (e) {
      return { available: false, error: String(e.message), current: cfg.version };
    });
  }

  function download(url, filename) {
    return fetch(url, { method: "GET" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement("a");
      var objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename || "aimeva.zxp";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      }, 2000);
      return "downloaded";
    });
  }

  window.AIMEVA.updater = {
    checkUpdate: checkUpdate,
    download: download,
    isNewer: isNewer
  };
})();