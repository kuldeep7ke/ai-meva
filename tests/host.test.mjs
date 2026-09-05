// VM harness for extension/jsx/hostscript.jsx.
// Builds a mock Premiere graph, loads the real host script, and drives
// __host.dispatch() the same way the panel does. No external dependencies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostScript = readFileSync(path.join(__dirname, "..", "extension", "jsx", "hostscript.jsx"), "utf8");

// ---------------------------------------------------------------- mock ---- 
function StaticValue() { this.type = 0; this.value = undefined; }

// Real Premiere timebase: Sequence.timebase is a STRING of ticks-per-frame,
// ticks run at 254016000000/sec. The mock mirrors that exactly.
const TICKS = 254016000000;

function buildPremiere(opt) {
  const log = [];

  function Time(t) { this._t = t; }

  function projectItem(name, id, mediaPath, opts) {
    return {
      name,
      nodeId: id,
      mediaPath,
      getMediaPath() { return mediaPath; },
      hasVideo: !!(opts && opts.video),
      hasAudio: !!(opts && opts.audio)
    };
  }

  function trackItem(item, startSec, durSec) {
    const motionProps = { "Motion": { Scale: [], Position: [] } };
    return {
      projectItem: item,
      start: Math.round(startSec * TICKS),
      duration: Math.round(durSec * TICKS),
      components: {
        numComponents: 1,
        0: {
          displayName: "Motion",
          properties: {
            numProperties: 2,
            0: {
              displayName: "Scale",
              setValue(v) { motionProps.Motion.Scale.push(v); }
            },
            1: {
              displayName: "Position",
              setValue(v) { motionProps.Motion.Position.push(v); }
            }
          }
        }
      },
      __motionProps: motionProps
    };
  }

  function track(name) {
    const clips = [];
    clips.numItems = 0;
    const t = {
      name,
      clips,
      addClip(startSec, durSec, item) {
        const ti = trackItem(item, startSec, durSec);
        clips[clips.numItems] = ti;
        clips.numItems++;
        return ti;
      }
    };
    return t;
  }

  function makeSeq(name, fps) {
    const videoTracks = [track("V1"), track("V2")];
    videoTracks.numTracks = 2;
    const audioTracks = [track("A1")];
    audioTracks.numTracks = 1;
    const markers = {
      _m: [],
      numMarkers: 0,
      getMarker(i) { return markers._m[i]; },
      createMarker(tick) {
        const mv = { _tick: tick, name: "", setName(n) { mv.name = n; }, getTime() { return { seconds: tick / TICKS }; } };
        markers._m[markers.numMarkers] = mv;
        markers.numMarkers++;
        return mv;
      }
    };
    const seq = {
      name,
      timebase: String(Math.round(TICKS / fps)),
      duration: TICKS * 120,
      markers,
      videoTracks,
      audioTracks,
      _playerSeconds: 10,
      _selectionItem: null,
      getPlayerPosition() { return { seconds: seq._playerSeconds }; },
      setPlayerPosition(t) { seq._playerSeconds = (t && t._t !== undefined) ? t._t / TICKS : (typeof t === "number" ? t / TICKS : 0); log.push(["setPlayerPosition", seq._playerSeconds]); },
      secondsToTicks(sec) { return Math.round(sec * TICKS); },
      getSelection() {
        // Real Premiere returns a plain Array of TrackItems; the legacy
        // object shape is kept for the old-path test below.
        if (opt && opt.arraySelection) {
          return seq._selectionItem ? [seq._selectionItem] : [];
        }
        return {
          numItems: seq._selectionItem ? 1 : 0,
          getTrackItem() { return seq._selectionItem; }
        };
      },
      insertClip(item, tick, a, b) { log.push(["insertClip", item.name, tick]); }
    };
    return seq;
  }

  const clipA = projectItem("shoe.mp4", "NODE-AAA", "C:/media/shoe.mp4", { video: true, audio: true });
  const clipB = projectItem("talk.mov", "NODE-BBB", "C:/media/talk.mov", { video: true, audio: true });

  const seq1 = makeSeq("Timeline 1", 30);
  const seq2 = makeSeq("Timeline 2", 30);
  seq1.videoTracks[0].addClip(0, 40, clipA);
  seq1.videoTracks[1].addClip(10, 30, clipB);
  seq1.audioTracks[0].addClip(5, 60, clipB);
  seq1._selectionItem = seq1.videoTracks[0].clips[0];
  seq2.videoTracks[0].addClip(0, 40, clipB);

  // NOTE: real Premiere ProjectItemCollection exposes numItems (NOT numChildren).
  // The mock mirrors that exactly - a numChildren mock would hide find bugs.
  const clipC = projectItem("nested.mp4", "NODE-CCC", "C:/media/bin/nested.mp4", { video: true });
  const binX = { name: "bin", children: { numItems: 1, 0: clipC } };
  const rootItem = { name: "root", children: { numItems: 3, 0: clipA, 1: binX, 2: clipB }, addItem(item) { const n = rootItem.children.numItems; rootItem.children[n] = item; rootItem.children.numItems++; } };

  const project = {
    name: "Test Project",
    activeSequence: seq1,
    rootItem,
    imported: [],
    importFiles(paths, suppressUI, dropFolder, replace) {
      paths.forEach((p) => {
        const base = p.split("/").pop().split("\\").pop();
        const item = projectItem(base, "NODE-IMP-" + log.length, p, { video: true, audio: true });
        rootItem.addItem(item);
        project.imported.push(base);
      });
      log.push(["importFiles", ...paths]);
    },
    createInsertionAtPlayheadForProjectItem(item, explicitTrack) { log.push(["createInsertion", item.nodeId, !!explicitTrack]); }
  };

  return {
    app: { project, name: "Premiere Pro" },
    seq1, seq2, clipA, clipB, log
  };
}

function makeContext(opt) {
  const step = buildPremiere(opt);
  const base = {
    app: step.app,
    $: { engineName: "ExtendScript", fileName: "hostscript.jsx", line: 1 },
    File: function (p) {
      this.fullName = p;
      this._lines = [];
      this.open = function () { return true; };
      this.writeln = function (l) { this._lines.push(String(l)); };
      this.close = function () {};
    },
    Folder: { temp: { fsName: "C:\\Temp" } },
    Time: function (t) { this._t = t; },
    StaticValue,
    StaticValueType: { PROPERTYVALUE_TYPE_DOUBLE: 1, PROPERTYVALUE_TYPE_TWOD: 2 },
    console
  };
  if (opt && opt.noJson) { base.JSON = undefined; }
  base.__step = step;
  const context = vm.createContext(base);
  vm.runInContext(hostScript, context, { filename: "hostscript.jsx" });
  base.call = (op, params) => {
    const raw = JSON.stringify({ op, params: params || {} });
    const result = vm.runInContext("__host.dispatch(" + JSON.stringify(raw) + ")", context);
    return JSON.parse(result);
  };
  return base;
}

function expectOk(res, data) {
  assert.equal(res.ok, true, "expected ok, got error: " + res.error);
  if (data) Object.assign(data, res.data);
  return res.data;
}

// ---------------------------------------------------------------- tests ----
test("ping returns host info", () => {
  const c = makeContext();
  const d = expectOk(c.call("ping"));
  assert.equal(d.pong, true);
});

test("env reads fresh sequence values", () => {
  const c = makeContext();
  const d = expectOk(c.call("env"));
  assert.ok(d.sequence, "Timeline 1");
  assert.equal(d.project, "Test Project");
  assert.equal(d.playheadSec, 10);
  assert.equal(d.videoTracks, 2);
  assert.equal(d.fps, 30);
  assert.equal(d.ticksPerFrame, 8467200000);
  assert.equal(d.durationSec, 120);
});

test("selectedClip returns the selected clip + mediaPath", () => {
  const c = makeContext();
  const d = expectOk(c.call("selectedClip"));
  assert.equal(d.selected, true);
  assert.equal(d.nodeId, "NODE-AAA");
  assert.equal(d.mediaPath, "C:/media/shoe.mp4");
});

test("REGRESSION (live panel 2026-09-06): array-shape getSelection resolves the clip", () => {
  const c = makeContext({ arraySelection: true });
  const d = expectOk(c.call("selectedClip"));
  assert.equal(d.selected, true);
  assert.equal(d.nodeId, "NODE-AAA");
  assert.equal(d.mediaPath, "C:/media/shoe.mp4");
  assert.equal(d.startSec, 0);
  assert.equal(d.durationSec, 40);
});

test("empty array selection reports not-selected (not an error)", () => {
  const c = makeContext({ arraySelection: true });
  c.__step.seq1._selectionItem = null;
  const d = expectOk(c.call("selectedClip"));
  assert.equal(d.selected, false);
});

test("listClips walks video + audio tracks", () => {
  const c = makeContext();
  const d = expectOk(c.call("listClips"));
  const ids = d.clips.map((k) => k.nodeId);
  assert.ok(ids.includes("NODE-AAA"));
  assert.ok(ids.includes("NODE-BBB"));
});

test("mediaPath resolves by nodeId", () => {
  const c = makeContext();
  const d = expectOk(c.call("mediaPath", { nodeId: "NODE-BBB" }));
  assert.equal(d.mediaPath, "C:/media/talk.mov");
});

test("REGRESSION (live log 2026-09-06): findById walks numItems incl. nested bins", () => {
  const c = makeContext();
  const d = expectOk(c.call("mediaPath", { nodeId: "NODE-CCC" }));
  assert.equal(d.mediaPath, "C:/media/bin/nested.mp4");
  const ins = expectOk(c.call("insertClip", { nodeId: "NODE-CCC", second: 3 }));
  assert.equal(ins.atSec, 3);
});

test("host errors carry the throw-site line (mkErr passes $.line)", () => {
  const c = makeContext();
  const res = c.call("mediaPath", { nodeId: "NOPE" });
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("nodeId not found"));
  assert.equal(typeof res.line, "number");
});

test("importFile imports + finds the item by name", () => {
  const c = makeContext();
  const d = expectOk(c.call("importFile", { path: "C:/media/probe.wav" }));
  assert.ok(d.nodeId.startsWith("NODE-IMP-"), d.nodeId);
  assert.equal(d.name, "probe.wav");
});

test("addMarkers creates frame-accurate markers", () => {
  const c = makeContext();
  const d = expectOk(c.call("addMarkers", { times: [2, 4.5] }));
  assert.equal(d.count, 2);
  assert.equal(d.added[0].atSec, 2);
  assert.equal(d.added[1].atSec, 4.5);
});

test("insertClip uses createInsertionAtPlayheadForProjectItem", () => {
  const c = makeContext();
  const d = expectOk(c.call("insertClip", { nodeId: "NODE-BBB", second: 3, audioOnly: false }));
  assert.equal(d.atSec, 3);
  assert.ok(d.method.includes("createInsertion"), d.method);
});

test("insertSound imports then inserts audioOnly", () => {
  const c = makeContext();
  const d = expectOk(c.call("insertSound", { path: "C:/media/noise.wav", second: 5 }));
  assert.equal(d.atSec, 5);
  assert.equal(d.audioOnly, true);
});

test("autoCut markers + optional insert", () => {
  const c = makeContext();
  const d = expectOk(c.call("autoCut", { times: [1, 2, 3], insertNodeId: "NODE-AAA" }));
  assert.equal(d.count, 3);
  assert.ok(d.inserted.atSec === 1);
});

test("applySilencePlan marks region starts", () => {
  const c = makeContext();
  const d = expectOk(c.call("applySilencePlan", { regions: [{ startSec: 7, endSec: 9 }, { startSec: 20, endSec: 22 }] }));
  assert.equal(d.regionsFound, 2);
  assert.equal(d.count, 2);
});

test("applyReframe sets Motion Scale + Position", () => {
  const c = makeContext();
  const d = expectOk(c.call("applyReframe", { nodeId: "NODE-AAA", scale: 177.8, positionX: 960, positionY: 540 }));
  assert.ok(d.applied.length >= 2, String(d.applied));
  const ti = c.__step.seq1.videoTracks[0].clips[0];
  assert.equal(ti.__motionProps.Motion.Scale.length, 1);
  assert.equal(ti.__motionProps.Motion.Scale[0].value, 177.8);
});

test("STATELESS: ops still work after activeSequence is swapped (no stale handles)", () => {
  const c = makeContext();
  const t = c.__step;
  // swap to a brand-new sequence object mid-session
  t.app.project.activeSequence = t.seq2;
  const env = expectOk(c.call("env"));
  assert.equal(env.sequence, "Timeline 2");
  const sel = expectOk(c.call("selectedClip"));
  assert.equal(sel.selected, false, "seq2 has no selection - must not error");
  const d = expectOk(c.call("addMarkers", { times: [5] }));
  assert.equal(d.count, 1);
});

test("unknown op returns a clean error envelope", () => {
  const c = makeContext();
  const res = c.call("nope");
  assert.equal(res.ok, false);
  assert.ok(res.error.includes("unknown op"));
});

// ---------------------------------------------------------------- manual JSON
test("manual JSON fallback works when native JSON is absent", () => {
  const c = makeContext({ noJson: true });
  const d = expectOk(c.call("env"));
  assert.equal(d.sequence, "Timeline 1");
  const m = expectOk(c.call("addMarkers", { times: [1.5, "2.5"] }));
  assert.equal(m.count, 2);
  // strings with quotes/newlines survive the round-trip
  const imp = expectOk(c.call("importFile", { path: "C:/my \"quoted\"\nclip.wav" }));
  assert.equal(imp.name, "my \"quoted\"\nclip.wav");
});

test("selfTest dry-run reports every op", () => {
  const c = makeContext();
  const d = expectOk(c.call("selfTest", { dryRun: true }));
  const ops = d.steps.map((s) => s.op);
  assert.ok(ops.includes("ping"));
  assert.ok(ops.includes("env"));
  assert.ok(ops.includes("selectedClip"));
  assert.ok(d.steps.every((s) => s.ok));
});

// ---------------------------------------------------------------- worker.js GET regression ----
const workerScript = readFileSync(path.join(__dirname, "..", "extension", "js", "worker.js"), "utf8");

function makeWorkerContext(calls) {
  const fakeWindow = {
    AIMEVA: {
      config: {
        workerBase: "http://127.0.0.1:8000",
        endpoints: {
          health: "/health",
          beats: "/analyze/beats",
          scene: "/analyze/scene",
          sound: "/sound/generate",
          reframe: "/reframe",
          models: "/models",
          chat: "/chat",
          agents: "/agents",
          agentsRun: "/agents/run",
          mcpList: "/mcp/list",
          mcpCall: "/mcp/call",
          opencode: "/opencode/models"
        }
      }
    }
  };
  const context = vm.createContext({
    window: fakeWindow,
    fetch(url, opts) {
      calls.push({ url, opts: opts || {} });
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
  });
  vm.runInContext(workerScript, context, { filename: "worker.js" });
  return fakeWindow.AIMEVA.worker;
}

test("REGRESSION (live panel 2026-09-06): GET calls send no body", async () => {
  const calls = [];
  const worker = makeWorkerContext(calls);
  await worker.models();
  await worker.agents();
  await worker.mcpList();
  assert.equal(calls.length, 3);
  calls.forEach((c) => {
    assert.equal(c.opts.method, "GET");
    assert.ok(!("body" in c.opts), "GET must not carry a body, got: " + c.opts.body);
  });
});

test("POST calls still send a JSON body", async () => {
  const calls = [];
  const worker = makeWorkerContext(calls);
  await worker.chat({ task: "chat", prompt: "hi" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, "POST");
  assert.equal(JSON.parse(calls[0].opts.body).task, "chat");
});