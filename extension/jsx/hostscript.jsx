// ===========================================================================
// AIMeva CEP host (ExtendScript) - Premiere Pro 2023+.
// Stateless JSON dispatch: the panel sends {op, params}, the host resolves
// live Premiere objects for EVERY call and returns {ok, data} | {ok, error}.
// Never keeps object references between calls (no more "does not have a value").
//
// Entry point: __host.dispatch(<json string>) -> json string.
// ===========================================================================

var __host = (function hostModule() {
  "use strict";

  // -------------------------------------------------------------------------
  // JSON (native when present, safe manual fallback otherwise)
  // -------------------------------------------------------------------------
  var HAS_NATIVE_JSON = (typeof JSON !== "undefined" && JSON.stringify && JSON.parse);

  function enc(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") { return isFinite(v) ? String(v) : "null"; }
    if (t === "boolean") { return v ? "true" : "false"; }
    if (t === "string") { return qstr(v); }
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(enc(v[i]));
      return "[" + a.join(",") + "]";
    }
    if (t === "object") {
      var k = [];
      for (var key in v) {
        if (v[key] !== undefined) k.push(qstr(key) + ":" + enc(v[key]));
      }
      return "{" + k.join(",") + "}";
    }
    return "null";
  }

  function qstr(s) {
    var o = '"';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') o += '\\"';
      else if (c === "\\") o += "\\\\";
      else if (c === "\n") o += "\\n";
      else if (c === "\r") o += "\\r";
      else if (c === "\t") o += "\\t";
      else if (c < " ") {
        var n = s.charCodeAt(i).toString(16);
        while (n.length < 4) n = "0" + n;
        o += "\\u" + n;
      }
      else o += c;
    }
    return o + '"';
  }

  function dec(s) {
    var i = 0, len = s.length;

    function ws() {
      while (i < len && (s.charAt(i) === " " || s.charAt(i) === "\t" ||
                         s.charAt(i) === "\n" || s.charAt(i) === "\r")) i++;
    }
    function parseValue() {
      ws();
      if (i >= len) return undefined;
      var c = s.charAt(i);
      if (c === "{") return parseObject();
      if (c === "[") return parseArray();
      if (c === '"') return parseString();
      if (c === "t") { i += 4; return true; }
      if (c === "f") { i += 5; return false; }
      if (c === "n") { i += 4; return null; }
      return parseNumber();
    }
    function parseObject() {
      var o = {}; i++;
      ws();
      if (s.charAt(i) === "}") { i++; return o; }
      while (i < len) {
        ws();
        var key = parseString();
        ws();
        if (s.charAt(i) === ":") i++;
        o[key] = parseValue();
        ws();
        if (s.charAt(i) === ",") { i++; continue; }
        if (s.charAt(i) === "}") { i++; break; }
      }
      return o;
    }
    function parseArray() {
      var a = []; i++;
      ws();
      if (s.charAt(i) === "]") { i++; return a; }
      while (i < len) {
        a.push(parseValue());
        ws();
        if (s.charAt(i) === ",") { i++; continue; }
        if (s.charAt(i) === "]") { i++; break; }
      }
      return a;
    }
    function parseString() {
      var o = ""; i++;
      while (i < len) {
        var c = s.charAt(i);
        if (c === '"') { i++; break; }
        if (c === "\\") {
          i++;
          var e = s.charAt(i);
          if (e === "n") o += "\n";
          else if (e === "r") o += "\r";
          else if (e === "t") o += "\t";
          else if (e === "u") {
            var hex = s.substr(i + 1, 4);
            o += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          }
          else o += e;
        }
        else o += c;
        i++;
      }
      return o;
    }
    function parseNumber() {
      var m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.substr(i));
      if (!m) return 0;
      i += m[0].length;
      return parseFloat(m[0]);
    }

    return parseValue();
  }

  function stringify(v) { return HAS_NATIVE_JSON ? JSON.stringify(v) : enc(v); }
  function parse(v)     { return HAS_NATIVE_JSON ? JSON.parse(v) : dec(v); }

  // -------------------------------------------------------------------------
  // Proof trail - every dispatch lands in %TEMP%\aimeva-host.log
  // -------------------------------------------------------------------------
  function logLine(line) {
    try {
      var logPath = Folder.temp.fsName + "/aimeva-host.log";
      var f = new File(logPath);
      if (f.open("a")) {
        var now = (new Date()) ? String(new Date()) : "";
        f.writeln(now + " " + line);
        f.close();
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------------------
  // Fresh environment resolution (called on EVERY command)
  // -------------------------------------------------------------------------
  function project() {
    return app.project || null;
  }
  function activeSeq() {
    var p = project();
    return (p && p.activeSequence) ? p.activeSequence : null;
  }

  function fresh() {
    var prj = project();
    var seq = activeSeq();
    return { prj: prj, seq: seq };
  }

  var TICKS_PER_SECOND = 254016000000; // Premiere tick rate (ticks per second)

  function seqTimebase(seq) {
    // Sequence.timebase = ticks per FRAME, as a string (e.g. "10594584000" at 23.976fps).
    try { var tb = Number(seq.timebase); return (tb > 0) ? tb : 0; } catch (e) { return 0; }
  }
  function seqFps(seq) {
    var tb = seqTimebase(seq);
    return (tb > 0) ? (TICKS_PER_SECOND / tb) : 0;
  }
  function ticksToSec(seq, ticks) {
    return Number(ticks) / TICKS_PER_SECOND;
  }
  function secToTicks(seq, sec) {
    return seq.secondsToTicks(sec);
  }
  function playheadSec(seq) {
    try { return seq.getPlayerPosition().seconds; } catch (e) { return 0; }
  }

  // -------------------------------------------------------------------------
  // Identity: ProjectItem.nodeId (stable GUID), hashed fallback
  // -------------------------------------------------------------------------
  function idOf(item) {
    if (!item) return null;
    try {
      var n = item.nodeId;
      if (n && String(n).length > 0) return String(n);
    } catch (e) {}
    return "h:" + String(item.name).length + ":" + hashStr(String(item.name));
  }
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
    return h.toString(36);
  }

  // child walk: matches the first project item whose nodeId equals the asked id
  function findById(rootItem, targetId) {
    if (!rootItem) return null;
    if (idOf(rootItem) === targetId) return rootItem;
    try {
      var kids = rootItem.children;
      if (!kids) return null;
      for (var i = 0; i < kids.numItems; i++) {
        var child = kids[i];
        if (!child) continue;
        var hit = findById(child, targetId);
        if (hit) return hit;
      }
    } catch (e) {}
    return null;
  }

  // -------------------------------------------------------------------------
  // Ops
  // -------------------------------------------------------------------------
  function opPing() {
    return {
      pong: true,
      engine: $.engineName,
      host: app.name,
      ppver: String(app.version),
      hostScript: (typeof $ !== "undefined") ? ($.fileName || "hostscript.jsx") : "hostscript.jsx"
    };
  }

  function opEnv() {
    var env = { project: null, sequence: null };
    var prj = project();
    if (!prj) { env.error = "no project open"; return env; }
    env.project = String(prj.name);
    var seq = activeSeq();
    if (!seq) { env.error = "no active sequence"; return env; }
    env.sequence = String(seq.name);
    env.ticksPerFrame = seqTimebase(seq);
    env.fps = Math.round(seqFps(seq) * 100) / 100;
    env.playheadSec = playheadSec(seq);
    try { env.durationSec = ticksToSec(seq, seq.duration); } catch (e) {}
    var markers = [];
    try {
      for (var j = 0; j < seq.markers.numMarkers; j++) {
        var mv = seq.markers.getMarker(j);
        var mt = 0;
        try { mt = mv.getTime().seconds; } catch (e) { mt = 0; }
        var mn = "";
        try { mn = String(mv.name || ""); } catch (e) {}
        markers.push({ seconds: mt, name: mn });
      }
    } catch (e) {}
    env.markers = markers;
    try {
      env.videoTracks = seq.videoTracks.numTracks;
      env.audioTracks = seq.audioTracks.numTracks;
    } catch (e) {}
    return env;
  }

  function selectedClipInfo(seq) {
    if (!seq) return { selected: false };
    try {
      var sel = seq.getSelection();
      // Premiere returns an Array of TrackItems; accept the legacy
      // { numItems, getTrackItem(i) } shape too. Anything else = no selection.
      var items = [];
      if (sel) {
        if (typeof sel.numItems === "number" && typeof sel.getTrackItem === "function") {
          for (var i = 0; i < sel.numItems; i++) items.push(sel.getTrackItem(i));
        } else if (typeof sel.length === "number") {
          for (var j = 0; j < sel.length; j++) items.push(sel[j]);
        }
      }
      if (items.length === 0) return { selected: false };
      var out = null;
      for (var k = 0; k < items.length; k++) {
        var ti = items[k];
        if (!ti) continue;
        var pi = ti.projectItem;
        if (!pi) continue;
        var info = {
          nodeId: idOf(pi),
          name: String(pi.name || ""),
          mediaPath: "",
          hasVideo: false,
          hasAudio: false,
          startSec: ticksToSec(seq, ti.start),
          durationSec: ticksToSec(seq, ti.duration)
        };
        try { info.mediaPath = String(pi.getMediaPath() || ""); } catch (e) {}
        try { info.hasVideo = !!pi.hasVideo; } catch (e) {}
        try { info.hasAudio = !!pi.hasAudio; } catch (e) {}
        out = info;
        break;
      }
      if (!out) return { selected: false };
      out.selected = true;
      out.playheadSec = playheadSec(seq);
      return out;
    } catch (e) {
      return { selected: false, error: String(e), line: e.line };
    }
  }

  function opSelectedClip() {
    return selectedClipInfo(activeSeq());
  }

  function opListClips() {
    var seq = activeSeq();
    if (!seq) return { clips: [] };
    var clips = [];
    var MAX = 300;
    function scan(name, tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var track = tracks[t];
        var cs = track.clips;
        var n = cs.numItems;
        for (var c = 0; c < n; c++) {
          if (clips.length >= MAX) return;
          var ti = cs[c];
          var pi = ti.projectItem;
          if (!pi) continue;
          var info = {
            nodeId: idOf(pi),
            name: String(pi.name || ""),
            mediaPath: "",
            hasVideo: false,
            hasAudio: false,
            track: name + String(t + 1),
            startSec: ticksToSec(seq, ti.start),
            durationSec: ticksToSec(seq, ti.duration)
          };
          try { info.mediaPath = String(pi.getMediaPath() || ""); } catch (e) {}
          try { info.hasVideo = !!pi.hasVideo; } catch (e) {}
          try { info.hasAudio = !!pi.hasAudio; } catch (e) {}
          clips.push(info);
        }
      }
    }
    try { scan("V", seq.videoTracks); } catch (e) {}
    try { scan("A", seq.audioTracks); } catch (e) {}
    return { clips: clips };
  }

  function opMediaPath(params) {
    var prj = project();
    if (!prj) throw mkErr("no project open", $.line);
    var item = findById(prj.rootItem, String(params.nodeId));
    if (!item) throw mkErr("nodeId not found: " + params.nodeId, $.line);
    return { nodeId: params.nodeId, name: String(item.name), mediaPath: String(item.getMediaPath() || "") };
  }

  function opImportFile(params) {
    var prj = project();
    if (!prj) throw mkErr("no project open", $.line);
    var path = String(params.path || "");
    if (path.length === 0) throw mkErr("path required", $.line);
    prj.importFiles([path], true, prj.rootItem, false);
    var base = path.replace(/\\/g, "/").split("/").pop();
    var found = null;
    function findBin(rootItem) {
      if (found) return;
      try {
        var kids = rootItem.children;
        if (!kids) return;
        for (var i = 0; i < kids.numItems; i++) {
          var child = kids[i];
          if (!child) continue;
          if (String(child.name) === base) { found = child; return; }
          findBin(child);
          if (found) return;
        }
      } catch (e) {}
    }
    findBin(prj.rootItem);
    if (!found) throw mkErr("imported but could not locate '" + base + "'", $.line);
    return { nodeId: idOf(found), name: String(found.name), mediaPath: String(found.getMediaPath() || ""), importedFrom: path };
  }

  function opAddMarkers(params) {
    var seq = activeSeq();
    if (!seq) throw mkErr("no active sequence", $.line);
    var times = params.times || [];
    var labels = params.labels || [];
    var added = [];
    for (var i = 0; i < times.length; i++) {
      var t = Number(times[i]);
      if (isNaN(t) || t < 0) continue;
      var tick = secToTicks(seq, t);
      var mv = seq.markers.createMarker(tick);
      var label = labels[i] ? String(labels[i]) : "";
      if (label.length > 0) { try { mv.setName(label); } catch (e) {} }
      added.push({ atSec: t, atTick: tick, label: label });
    }
    return { count: added.length, added: added };
  }

  function toTime(sec) {
    var seq = activeSeq();
    if (!seq) return sec;
    try { return new Time(secToTicks(seq, sec)); } catch (e) { return sec; }
  }

  function opInsertClip(params) {
    var prj = project(), seq = activeSeq();
    if (!prj) throw mkErr("no project open", $.line);
    if (!seq) throw mkErr("no active sequence", $.line);
    var item = findById(prj.rootItem, String(params.nodeId));
    if (!item) throw mkErr("nodeId not found: " + params.nodeId, $.line);
    var sec = Number(params.second);
    if (isNaN(sec) || sec < 0) sec = playheadSec(seq);
    var audioOnly = !!params.audioOnly;
    seq.setPlayerPosition(toTime(sec));
    var method = "";
    try {
      prj.createInsertionAtPlayheadForProjectItem(item, audioOnly);
      method = "createInsertionAtPlayheadForProjectItem";
    } catch (e1) {
      try {
        seq.insertClip(item, secToTicks(seq, sec), -1, 0);
        method = "insertClip(frames)";
      } catch (e2) {
        throw mkErr("insertClip failed: " + String(e1.message || e1) + " / " + String(e2.message || e2), $.line);
      }
    }
    return { nodeId: params.nodeId, atSec: sec, audioOnly: audioOnly, method: method, playheadSec: playheadSec(seq) };
  }

  function opAutoCut(params) {
    // v1 = markers at the plan times; optionally insert one clip at the first time
    var seq = activeSeq();
    if (!seq) throw mkErr("no active sequence", $.line);
    var res = opAddMarkers({ times: params.times || [], labels: params.labels || [] });
    // find a clip to lay down at cut points (project item id, imported already)
    if (params.insertNodeId) {
      var firstCut = (params.times && params.times.length) ? Number(params.times[0]) : 0;
      var inset = opInsertClip({ nodeId: params.insertNodeId, second: firstCut, audioOnly: !!params.audioOnly });
      res.inserted = inset;
    }
    if (!!params.addSegmentMarkers) {
      var seg = [];
      var times = params.times || [];
      for (var i = 0; i + 1 < times.length; i++) {
        var start = Number(times[i]), end = Number(times[i + 1]);
        if (end > start + 0.5) seg.push({ startSec: start, endSec: end, atSec: (start + end) / 2 });
      }
      res.segments = seg;
    }
    return res;
  }

  function opApplySilencePlan(params) {
    var seq = activeSeq();
    if (!seq) throw mkErr("no active sequence", $.line);
    var regions = params.regions || [];
    var starts = [];
    for (var i = 0; i < regions.length; i++) {
      var s = Number(regions[i].startSec);
      if (!isNaN(s) && s >= 0) starts.push(s);
    }
    var res = opAddMarkers({ times: starts, labels: regions.map ? null : null });
    // rename markers to "silence"
    res.regionsFound = starts.length;
    return res;
  }

  function opInsertSound(params) {
    var imp = opImportFile({ path: params.path });
    return opInsertClip({ nodeId: imp.nodeId, second: params.second, audioOnly: true });
  }

  function findTrackItemByNodeId(seq, nodeId) {
    if (!seq) return null;
    function scan(tracks) {
      for (var t = 0; t < tracks.numTracks; t++) {
        var cs = tracks[t].clips;
        for (var c = 0; c < cs.numItems; c++) {
          var ti = cs[c];
          var pi = ti.projectItem;
          if (pi && idOf(pi) === nodeId) return ti;
        }
      }
      return null;
    }
    try { var v = scan(seq.videoTracks); if (v) return v; } catch (e) {}
    try { var a = scan(seq.audioTracks); if (a) return a; } catch (e) {}
    return null;
  }

  function opApplyReframe(params) {
    var seq = activeSeq();
    if (!seq) throw mkErr("no active sequence", $.line);
    var nodeId = params.nodeId;
    var ti;
    if (nodeId) {
      ti = findTrackItemByNodeId(seq, String(nodeId));
    } else {
      var sel = selectedClipInfo(seq);
      if (sel.selected) ti = findTrackItemByNodeId(seq, sel.nodeId);
    }
    if (!ti) throw mkErr("no target clip (pass nodeId or select a clip)", $.line);

    var applied = [];
    var comps = ti.components;
    var motion = null;
    for (var c = 0; c < comps.numComponents; c++) {
      var comp = comps[c];
      var dn = "";
      try { dn = String(comp.displayName || comp.name || ""); } catch (e) {}
      if (dn === "Motion" || dn === "motion") { motion = comp; break; }
    }
    if (!motion) throw mkErr("Motion component not found on clip", $.line);

    function setProp(comp, propName, valueArray, typeName) {
      var props = comp.properties;
      for (var p = 0; p < props.numProperties; p++) {
        var prop = props[p];
        var pd = "";
        try { pd = String(prop.displayName || ""); } catch (e) {}
        if (pd !== propName) continue;
        var v = new StaticValue();
        try {
          v.type = StaticValueType && StaticValueType["PROPERTYVALUE_TYPE_" + typeName]
                 ? StaticValueType["PROPERTYVALUE_TYPE_" + typeName] : 5;
        } catch (e) { v.type = 5; }
        v.value = valueArray.length === 1 ? valueArray[0] : valueArray;
        prop.setValue(v);
        return true;
      }
      return false;
    }

    if (params.scale) {
      applied.push("scale=" + params.scale);
      setProp(motion, "Scale", [Number(params.scale)], "DOUBLE");
    }
    if (params.positionX !== undefined && params.positionY !== undefined) {
      applied.push("position=" + params.positionX + "," + params.positionY);
      setProp(motion, "Position", [Number(params.positionX), Number(params.positionY)], "TWOD");
    }
    var name = String(ti.projectItem && ti.projectItem.name || "clip");
    return { nodeId: nodeId, clip: name, applied: applied };
  }

  function opSelfTest(params) {
    var dryRun = params.dryRun !== false;
    var steps = [];
    function run(label, fn) {
      try {
        var d = fn();
        steps.push({ op: label, ok: true, detail: d });
      } catch (e) {
        steps.push({ op: label, ok: false, error: String(e.message || e), line: e.line });
      }
      return fn;
    }
    run("ping", function(){ return opPing(); });
    run("env", function(){ return opEnv(); });
    run("selectedClip", function(){ return opSelectedClip(); });
    if (!dryRun) {
      run("addMarkers@playhead", function(){
        var seq = activeSeq();
        if (!seq) throw mkErr("no active sequence", $.line);
        return opAddMarkers({ times: [playheadSec(seq)], labels: ["aimeva-selftest"] });
      });
      if (params.importPath) {
        run("importFile", function(){ return opImportFile({ path: params.importPath }); });
      }
    } else {
      steps.push({ op: "edit-ops (addMarkers/import/insert)", ok: true, detail: "dry-run skipped (set dryRun=false to actually edit)" });
    }
    return { steps: steps, dryRun: dryRun };
  }

  function opSelectBehavior() {
    var seq = activeSeq();
    if (!seq) return { selected: false };
    return selectedClipInfo(seq);
  }

  // -------------------------------------------------------------------------
  // Dispatch
  // -------------------------------------------------------------------------
  function mkErr(msg, line) {
    var e = new Error(String(msg));
    if (line !== undefined) e.line = line; // sloppy mode: silently ignored if read-only
    return e;
  }

  function dispatch(jsonText) {
    var started = new Date();
    var req = null;
    try { req = parse(jsonText); } catch (e) { req = null; }
    var opName = (req && req.op) ? String(req.op) : "?";
    var params = (req && req.params) ? req.params : {};
    logLine(">> dispatch op=" + opName);

    var out = { ok: true, data: null, error: null, line: null, op: opName };
    try {
      var result = null;
      var prj = project();
      if (opName !== "ping" && !prj) throw new Error("no project open");
      switch (opName) {
        case "ping": result = opPing(); break;
        case "env": result = opEnv(); break;
        case "selectedClip": result = opSelectedClip(); break;
        case "selectBehavior": result = opSelectBehavior(); break;
        case "listClips": result = opListClips(); break;
        case "mediaPath": result = opMediaPath(params); break;
        case "importFile": result = opImportFile(params); break;
        case "addMarkers": result = opAddMarkers(params); break;
        case "insertClip": result = opInsertClip(params); break;
        case "insertSound": result = opInsertSound(params); break;
        case "autoCut": result = opAutoCut(params); break;
        case "applySilencePlan": result = opApplySilencePlan(params); break;
        case "applyReframe": result = opApplyReframe(params); break;
        case "selfTest": result = opSelfTest(params); break;
        default: throw new Error("unknown op: " + opName);
      }
      out.data = result;
      logLine("<< ok " + opName);
    } catch (e) {
      out.ok = false;
      out.error = String(e.message || e);
      out.line = e.line || -1;
      logLine("!! error " + opName + " -> " + out.error + " (line " + out.line + ")");
    }
    if (req && req.id !== undefined) {
      if (out.data && typeof out.data === "object") out.data.reqId = req.id;
      else if (typeof out.data === "string") out.data = { reqId: req.id, value: out.data };
      else out.data = { reqId: req.id };
    }
    var envelope = stringify(out);
    if (!HAS_NATIVE_JSON) envelope = envelope; // manual enc is already final
    return envelope;
  }

  return { dispatch: dispatch, version: "0.1.0" };
})();