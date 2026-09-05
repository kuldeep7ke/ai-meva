// Tiny HTTP client for the local Aimeva worker (FastAPI on 127.0.0.1:8000).
// Every POST takes a JSON body; workers accept local media paths directly.
window.AIMEVA = window.AIMEVA || {};

(function () {
  var base = window.AIMEVA.config.workerBase;

  function getUrl(path) { return base + path; }

  function call(path, body, method) {
    var headers = { "Content-Type": "application/json" };
    return fetch(getUrl(path), {
      method: method || "POST",
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return { error: "non-JSON response: " + r.status }; });
    });
  }

  function health() {
    return fetch(getUrl(window.AIMEVA.config.endpoints.health), { method: "GET" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: "worker offline" }; });
  }

  window.AIMEVA.worker = {
    health: health,
    beats: function (audio, opts) { return call(window.AIMEVA.config.endpoints.beats, Object.assign({ audio: audio }, opts)); },
    silence: function (audio, opts) { return call(window.AIMEVA.config.endpoints.beats, Object.assign({ audio: audio, mode: "silence" }, opts)); },
    scene: function (footage, opts) { return call(window.AIMEVA.config.endpoints.scene, Object.assign({ footage: footage }, opts)); },
    sound: function (opts) { return call(window.AIMEVA.config.endpoints.sound, opts); },
    reframe: function (footage, opts) { return call(window.AIMEVA.config.endpoints.reframe, Object.assign({ footage: footage }, opts)); },
    models: function () { return call(window.AIMEVA.config.endpoints.models, {}, "GET"); },
    chat: function (opts) { return call(window.AIMEVA.config.endpoints.chat, opts); },
    agents: function () { return call(window.AIMEVA.config.endpoints.agents, {}, "GET"); },
    agentsRun: function (opts) { return call(window.AIMEVA.config.endpoints.agentsRun, opts); },
    mcpList: function () { return call(window.AIMEVA.config.endpoints.mcpList, {}, "GET"); },
    mcpCall: function (opts) { return call(window.AIMEVA.config.endpoints.mcpCall, opts); }
  };
})();