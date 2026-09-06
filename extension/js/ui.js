// AIMeva panel controller. Wires tabs, host, worker, models, updater.
window.AIMEVA = window.AIMEVA || {};
window.AIMEVA.ui = (function () {
  var host = window.AIMEVA.host;
  var worker = window.AIMEVA.worker;
  var models = window.AIMEVA.models;
  var updater = window.AIMEVA.updater;

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    env: null,
    clip: null,
    beats: null,
    silence: null,
    highlights: null,
    lastSound: null,
    reframePreview: null,
    aiResult: null,
    agents: [],
    mcp: {}
  };

  function log(msg) { $("footerLog").textContent = msg; }

  function outBox(id, html) {
    var el = $(id);
    el.className = "out";
    el.innerHTML = html;
  }
  function outErr(id, msg) {
    var el = $(id);
    el.className = "out err";
    el.innerHTML = "Error: " + String(msg);
  }
  function esc(s) { return models.escapeHtml(s); }

  function busied(btn, busy, label) {
    if (busy) {
      btn._label = btn.textContent;
      btn.textContent = "working...";
      btn.disabled = true;
    } else {
      btn.textContent = btn._label || label || btn.textContent;
      btn.disabled = false;
    }
  }

  // ---------------- shared helpers ----------------
  function requireClip() {
    return host.dispatch("selectedClip").then(function (c) {
      if (!c || !c.selected) {
        var why = (c && c.error) ? " [host: " + c.error + "]" : "";
        throw new Error("Select a clip in the timeline first, then try again" + why);
      }
      state.clip = c;
      return c;
    });
  }

  function refreshEnv() {
    return host.dispatch("env").then(function (env) {
      state.env = env;
      var t = [];
      if (env.error) t.push("?" + env.error);
      if (env.project) t.push(env.project);
      if (env.sequence) t.push(env.sequence + " (" + (env.fps || "?") + " fps)");
      if (env.playheadSec !== undefined) t.push("@" + env.playheadSec.toFixed(2) + "s");
      $("envSummary").value = t.join(" | ") || "no seq";
      return env;
    });
  }

  // ---------------- beat / silence / highlights ----------------
  function selectedMedia() {
    return requireClip().then(function (c) {
      if (!c.mediaPath) throw new Error("Clip has no media path (offline or sequence-only?)");
      return c.mediaPath;
    });
  }

  function runBeats() {
    var btn = $("btnAnalyzeBeats");
    busied(btn, true);
    selectedMedia().then(function (path) {
      var intensity = Number($("beatIntensity").value) || 3;
      return worker.beats(path, { mode: "beats", intensity: intensity });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.beats = res;
      var times = (res.beat_times || []).map(function (t) { return Number(t); });
      outBox("beatOut",
        "BPM " + (res.bpm || "?") + " | beats: " + times.length +
        " | audio: " + esc(res.audio || ""));
      $("beatPills").innerHTML = times.slice(0, 20)
        .map(function (t) { return '<span class="pill">' + t.toFixed(2) + "s</span>"; })
        .join("") + (times.length > 20 ? '<span class="pill">+' + (times.length - 20) + " more</span>" : "");
      return times;
    }).then(function (times) {
      state.beatTimes = times;
    }).catch(function (e) { outErr("beatOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function markBeats() {
    if (!state.beatTimes || !state.beatTimes.length) { log("analyze beats first"); return; }
    host.dispatch("addMarkers", { times: state.beatTimes, labels: [] }).then(function (r) {
      log("added " + r.count + " beat markers");
    }).catch(function (e) { log(e.message); });
  }

  function autoCut() {
    if (!state.beatTimes || !state.beatTimes.length) { log("analyze beats first"); return; }
    host.dispatch("autoCut", { times: state.beatTimes, labels: [] }).then(function (r) {
      log("auto-cut: " + r.count + " markers" + (r.inserted ? " + 1 insert" : ""));
    }).catch(function (e) { log(e.message); });
  }

  function runSilence() {
    var btn = $("btnFindSilence");
    busied(btn, true);
    selectedMedia().then(function (path) {
      return worker.silence(path, {
        mode: "silence",
        min_gap: Number($("silenceMin").value),
        threshold_db: Number($("silenceThresh").value)
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.silence = res;
      state.silenceRegions = res.regions || [];
      outBox("silenceOut",
        "gaps: " + state.silenceRegions.length +
        " | total silence: " + (res.total_silence_sec != null ? res.total_silence_sec.toFixed(2) + "s" : "?"));
    }).catch(function (e) { outErr("silenceOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function markSilence() {
    if (!state.silenceRegions || !state.silenceRegions.length) { log("find silence first"); return; }
    host.dispatch("applySilencePlan", { regions: state.silenceRegions }).then(function (r) {
      log("marked " + r.regionsFound + " silence gaps");
    }).catch(function (e) { log(e.message); });
  }

  function runHighlights() {
    var btn = $("btnFindHighlights");
    busied(btn, true);
    // Self-heal: worker may have come online after panel load with an empty dropdown.
    var ready = ($("sceneModel").options.length && $("sceneModel").value)
      ? Promise.resolve()
      : models.load().then(function () { populateSceneModels(); });
    ready.then(function () {
      var model = $("sceneModel").value || "";
      return selectedMedia().then(function (path) {
        return worker.scene(path, { model: model || undefined });
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.highlights = res;
      state.highlightTimes = (res.highlights || []).map(function (h) {
        return typeof h === "object" ? Number(h.start_sec) : Number(h);
      }).filter(function (t) { return !isNaN(t); });
      outBox("hlOut",
        "highlights: " + state.highlightTimes.length + " | model: " + esc(res.model || model || "?") +
        (res.summary ? " | " + esc(res.summary) : ""));
    }).catch(function (e) { outErr("hlOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function markHighlights() {
    if (!state.highlightTimes || !state.highlightTimes.length) { log("find highlights first"); return; }
    host.dispatch("addMarkers", { times: state.highlightTimes, labels: ["highlight"] }).then(function (r) {
      log("marked " + r.count + " highlights");
    }).catch(function (e) { log(e.message); });
  }

  // ---------------- sound ----------------
  function generateSound() {
    var btn = $("btnGenSound");
    busied(btn, true);
    worker.sound({
      prompt: $("soundPrompt").value,
      duration: Number($("soundDur").value) || 5,
      bpm: Number($("soundBpm").value) || 0,
      engine: $("soundEngine").value
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.lastSound = res;
      outBox("soundOut",
        "wav: " + esc(res.path || "") + " | duration: " + (res.duration != null ? res.duration.toFixed(2) + "s" : "?") +
        (res.bpm ? " | bpm: " + res.bpm : "") + (res.engine ? " | engine: " + esc(res.engine) : ""));
    }).catch(function (e) { outErr("soundOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function insertSound() {
    if (!state.lastSound || !state.lastSound.path) { log("generate a sound first"); return; }
    host.dispatch("env").then(function (env) {
      return host.dispatch("insertSound", {
        path: state.lastSound.path,
        second: (env && env.playheadSec) || 0
      });
    }).then(function (r) {
      log("inserted sound at " + r.atSec.toFixed(2) + "s (" + r.method + ")");
    }).catch(function (e) { log(e.message); });
  }

  // ---------------- reframe ----------------
  function previewReframe() {
    var btn = $("btnPreviewReframe");
    busied(btn, true);
    selectedMedia().then(function (path) {
      return worker.reframe(path, {
        ratio: $("reframeRatio").value,
        mode: $("reframeMode").value,
        include_transform: true
      });
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.reframePreview = res;
      var tf = res.transform;
      outBox("reframeOut",
        "preview: " + esc(res.preview_path || (res.path || "")) +
        (tf ? " | recommended scale " + (tf.scale != null ? tf.scale.toFixed(1) + "%" : "?") +
          (tf.positionX != null ? " | pos " + tf.positionX.toFixed(0) + "," + tf.positionY.toFixed(0) : "") : ""));
    }).catch(function (e) { outErr("reframeOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function applyReframe() {
    host.dispatch("selectedClip").then(function (c) {
      if (!c || !c.selected) throw new Error("Select the clip to reframe");
      if (c.hasVideo === false) throw new Error("Reframe needs a video clip - '" + (c.name || "") + "' has no video");
      var tf = state.reframePreview && state.reframePreview.transform;
      var args = { nodeId: c.nodeId };
      if (tf && tf.scale) args.scale = tf.scale;
      if (tf && typeof tf.positionX === "number" && typeof tf.positionY === "number" && !tf.keep_center) {
        args.positionX = tf.positionX;
        args.positionY = tf.positionY;
      }
      return host.dispatch("applyReframe", args);
    }).then(function (r) {
      log("reframe applied to " + r.clip + " [" + (r.applied || []).join(", ") + "]");
    }).catch(function (e) { log(e.message); });
  }

  // ---------------- AI Lab ----------------
  function refreshModels() {
    models.load().then(function (res) {
      var grid = $("modelGrid");
      models.renderInto(grid);
      $("modelCount").textContent = "( " + models.flatten().length + " models )";
      var sel = models.selected();
      populateSceneModels();
      if (sel) log("models loaded, active: " + sel.id + (res.opencode && res.opencode.length ? " (+opencode)" : ""));
      else log(res && res.error ? "worker offline - showing default scene model" : "models loaded");
    }).catch(function (e) {
      populateSceneModels(); // worker unreachable: still offer the default scene model
      log("models: " + e.message + " (worker offline?)");
    });
  }

  function populateSceneModels() {
    var sel = $("sceneModel");
    var prev = sel.value;
    sel.innerHTML = "";
    var all = models.flatten().filter(function (m) {
      return (m.capabilities || []).indexOf("vision") >= 0;
    });
    if (!all.length) {
      all = [{ id: "ollama:qwen3-vl:2b", name: "qwen3-vl:2b (default)" }];
    }
    all.forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name || m.id;
      sel.appendChild(opt);
    });
    sel.value = prev && document.querySelector('#sceneModel option[value="' + prev + '"]') ? prev : all[0].id;
  }

  function runAiTask() {
    var btn = $("btnRunTask");
    busied(btn, true);
    var task = $("aiTask").value;
    var model = models.selected();
    var prompt = $("aiPrompt").value;
    var media = null;
    var p = Promise.resolve(model);
    if (task === "describe") {
      p = requireClip().then(function (c) { return Promise.all([model, c.mediaPath]); })
        .then(function (pair) { media = pair[1]; return pair[0]; });
    }
    p.then(function (m) {
      var body = { task: task, prompt: prompt, model: m ? m.id : undefined, media_path: media };
      return worker.chat(body);
    }).then(function (res) {
      if (res.error) throw new Error(res.error);
      state.aiResult = res.text || res.result || "";
      outBox("aiOut", esc(state.aiResult) +
        (res.model ? "\n\n[model: " + esc(res.model) + "]" : ""));
    }).catch(function (e) { outErr("aiOut", e.message || e); })
      .then(function () { busied(btn, false); });
  }

  function refreshAgents() {
    worker.agents().then(function (res) {
      state.agents = res && res.agents ? res.agents : [];
      var grid = $("agentGrid");
      grid.innerHTML = "";
      if (!state.agents.length) {
        grid.innerHTML = '<div class="meta" style="font-size:11px;color:var(--muted)">no agents (worker offline?)</div>';
        return;
      }
      state.agents.forEach(function (a) {
        var b = document.createElement("button");
        b.className = "btn small ghost";
        b.style.margin = "2px";
        b.textContent = a.name + " (" + a.id + ")";
        b.title = a.description || "";
        b.addEventListener("click", function () {
          busied(b, true, a.name);
          worker.agentsRun({ agent: a.id, media_path: state.clip ? state.clip.mediaPath : undefined })
            .then(function (r) {
              if (r.error) throw new Error(r.error);
              outBox("aiOut", esc(r.output || r.text || JSON.stringify(r)));
            }).catch(function (e) { outErr("aiOut", e.message || e); })
            .then(function () { busied(b, false, a.name); });
        });
        grid.appendChild(b);
      });
    }).catch(function () { $("agentGrid").innerHTML = "no agents"; });
  }

  function refreshMcp() {
    worker.mcpList().then(function (res) {
      state.mcp = res && res.servers ? res.servers : {};
      var grid = $("mcpGrid");
      grid.innerHTML = "";
      var items = [];
      Object.keys(state.mcp).forEach(function (server) {
        (state.mcp[server].tools || []).forEach(function (tool) {
          items.push({ server: server, tool: tool.name, desc: (tool.description || "").slice(0, 60) });
        });
      });
      if (!items.length) {
        grid.innerHTML = '<div class="meta" style="font-size:11px;color:var(--muted)">no MCP tools (worker offline or none configured)</div>';
        return;
      }
      items.forEach(function (it) {
        var b = document.createElement("button");
        b.className = "btn small ghost";
        b.style.margin = "2px";
        b.textContent = it.server + " / " + it.tool;
        b.title = it.desc;
        b.addEventListener("click", function () {
          var argsRaw = prompt("Arguments JSON for " + it.tool + " (optional):", "{}");
          if (argsRaw === null) return;
          var args = {};
          try { args = JSON.parse(argsRaw || "{}"); } catch (e) { log("bad JSON args"); return; }
          busied(b, true, it.tool);
          worker.mcpCall({ server: it.server, tool: it.tool, arguments: args })
            .then(function (r) {
              if (r.error) throw new Error(r.error);
              outBox("aiOut", typeof r.result === "string" ? esc(r.result) : esc(JSON.stringify(r.result)));
            }).catch(function (e) { outErr("aiOut", e.message || e); })
            .then(function () { busied(b, false, it.tool); });
        });
        grid.appendChild(b);
      });
    }).catch(function () { $("mcpGrid").innerHTML = "no MCP servers"; });
  }

  // ---------------- self test / update ----------------
  function selfTest() {
    busied($("btnSelfTest"), true);
    host.dispatch("selfTest", { dryRun: true }).then(function (r) {
      var lines = (r.steps || []).map(function (s) {
        var status = s.ok ? "OK " : "FAIL";
        var msg = s.op + " " + status + (s.error ? " -> " + s.error + " (line " + s.line + ")" : "");
        if (s.detail) msg += " | " + esc(JSON.stringify(s.detail)).slice(0, 140);
        return msg;
      });
      outBox("aiOut", lines.join("\n"));
      log("self-test logged to %TEMP%\\aimeva-host.log");
    }).catch(function (e) { log("self-test failed: " + e.message); })
      .then(function () { busied($("btnSelfTest"), false); });
  }

  function checkUpdate() {
    busied($("btnCheckUpdate"), true);
    updater.checkUpdate().then(function (info) {
      var banner = $("updateBanner");
      if (info.available) {
        banner.style.display = "block";
        banner.innerHTML = "Update " + esc(info.version) + " is available (you have " + esc(info.current) + "). " +
          (info.notes ? esc(info.notes) + " " : "") +
          '<a href="#" id="updDl">Download .zxp</a> &middot; <a href="' + esc(info.manualUrl) + '" target="_blank">Releases</a>';
        $("updDl").addEventListener("click", function (e) {
          e.preventDefault();
          updater.download(info.zxpUrl, "aimeva-" + info.version + ".zxp").then(function () {
            log("saved to Downloads - run installer/install-zxp.bat");
          }).catch(function (er) { log("download failed: " + er.message); });
        });
      } else if (info.error) {
        banner.style.display = "block";
        banner.innerHTML = "Update check failed: " + esc(info.error);
      } else {
        banner.style.display = "none";
        log("you have the latest version (" + esc(info.version) + ")");
      }
    }).catch(function (e) { log("update check: " + e.message); })
      .then(function () { busied($("btnCheckUpdate"), false); });
  }

  // ---------------- boot ----------------
  function init() {
    $("versionTag").textContent = "v" + window.AIMEVA.config.version;

    // tabs
    var tabs = document.querySelectorAll("#tabs button");
    Array.prototype.forEach.call(tabs, function (tabBtn) {
      tabBtn.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs, function (b) { b.classList.remove("active"); });
        document.querySelectorAll(".tab").forEach(function (s) { s.classList.remove("active"); });
        tabBtn.classList.add("active");
        $("tab-" + tabBtn.dataset.tab).classList.add("active");
        // Keep sequence/clip state fresh as the user moves around.
        refreshEnv().catch(function () {});
      });
    });

    // host status
    host.dispatch("ping").then(function (p) {
      $("hostDot").className = "statusdot on";
      if (p.ppver) $("versionTag").textContent = "v" + window.AIMEVA.config.version + " / Pr " + p.ppver;
    }).catch(function () {
      $("hostDot").className = "statusdot off";
      log("Premiere host not reachable");
    });

    // worker status
    worker.health().then(function (h) {
      if (h.ok) {
        $("workerDot").className = "statusdot on";
        log("worker online");
      } else {
        $("workerDot").className = "statusdot off";
        log(h.error || "worker offline");
      }
    });

    refreshEnv().catch(function (e) { $("envSummary").value = "env: " + e.message; });
    refreshModels();
    refreshAgents();
    refreshMcp();
    checkUpdate();

    $("btnRefreshEnv").addEventListener("click", refreshEnv);
    $("btnAnalyzeBeats").addEventListener("click", runBeats);
    $("btnAddBeatMarkers").addEventListener("click", markBeats);
    $("btnAutoCut").addEventListener("click", autoCut);
    $("btnFindSilence").addEventListener("click", runSilence);
    $("btnMarkSilence").addEventListener("click", markSilence);
    $("btnFindHighlights").addEventListener("click", runHighlights);
    $("btnMarkHighlights").addEventListener("click", markHighlights);
    $("btnGenSound").addEventListener("click", generateSound);
    $("btnInsertSound").addEventListener("click", insertSound);
    $("btnPreviewReframe").addEventListener("click", previewReframe);
    $("btnApplyReframe").addEventListener("click", applyReframe);
    $("btnRefreshModels").addEventListener("click", refreshModels);
    $("btnRunTask").addEventListener("click", runAiTask);
    $("btnRefreshMcp").addEventListener("click", refreshMcp);
    $("btnSelfTest").addEventListener("click", selfTest);
    $("btnCheckUpdate").addEventListener("click", checkUpdate);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init: init };
})();