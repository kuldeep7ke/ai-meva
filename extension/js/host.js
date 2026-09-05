// Thin relay to the CEP ExtendScript host.
// host.dispatch(op, params) -> Promise<data>. Errors carry host {error,line}.
window.AIMEVA = window.AIMEVA || {};

(function () {
  var cs = null;

  function getCs() {
    if (!cs) cs = new CSInterface();
    return cs;
  }

  // Make sure the host is loaded inside the ExtendScript engine.
  function ensureHost() {
    return new Promise(function (resolve) {
      getCs().evalScript('typeof __host !== "undefined" ? "yes" : "no"', function (res) {
        if (res === "yes") { resolve(); return; }
        // Fallback: load jsx/hostscript.jsx by path derived from the panel URL.
        var href = window.location.href;
        var base = href.substring(0, href.lastIndexOf("/"));
        var jsxPath = base + "/jsx/hostscript.jsx";
        getCs().evalScript('$.evalFile("' + jsxPath + '")', function () {
          resolve();
        });
      });
    });
  }

  // Build the evalScript payload. JSON.stringify of the raw text produces a
  // perfectly escaped JS string literal, so quotes/newlines never break the call.
  function buildScript(op, params) {
    var payload = { op: op, params: params || {} };
    var raw = JSON.stringify(payload);
    return "__host.dispatch(" + JSON.stringify(raw) + ")";
  }

  function dispatch(op, params) {
    return ensureHost().then(function () {
      return new Promise(function (resolve, reject) {
        getCs().evalScript(buildScript(op, params), function (res) {
          var envelope = null;
          if (res && res !== "EvalScript error.") {
            try { envelope = JSON.parse(res); } catch (e) { envelope = null; }
          }
          if (!envelope) {
            reject({ op: op, error: "Malformed host response: " + String(res), line: -1 });
            return;
          }
          if (envelope.ok) {
            resolve(envelope.data);
          } else {
            var err = new Error(envelope.error || "host error");
            err.location = "line " + envelope.line;
            err.op = op;
            reject(err);
          }
        });
      });
    });
  }

  window.AIMEVA.host = {
    dispatch: dispatch,
    ensureHost: ensureHost
  };
})();