// AI model registry in the panel.
// The worker merges: curated plugin/models.json + live Ollama tags + opencode
// discovered models. This module renders them and tracks the selection.
window.AIMEVA = window.AIMEVA || {};

(function () {
  var registry = { ollama: [], opencode: [], curated: [] };
  var selectedId = null;

  function flatten() {
    var out = [];
    function push(list, source) {
      (list || []).forEach(function (m) {
        m.source = m.source || source;
        out.push(m);
      });
    }
    push(registry.curated, "curated");
    push(registry.ollama, "ollama");
    push(registry.opencode, "opencode");
    return out;
  }

  function load() {
    return window.AIMEVA.worker.models().then(function (res) {
      if (!res || res.error) {
        registry = { ollama: [], opencode: [], curated: [] };
        return { error: res && res.error };
      }
      registry = {
        ollama: res.ollama || [],
        opencode: res.opencode || [],
        curated: res.curated || []
      };
      if (!selectedId && registry.curated.length) {
        selectedId = registry.curated[0].id;
      }
      return registry;
    });
  }

  function selected() {
    var all = flatten();
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === selectedId) return all[i];
    }
    return all[0] || null;
  }

  function setSelected(id) { selectedId = id; }

  function renderInto(el, onClick) {
    var all = flatten();
    el.innerHTML = "";
    if (!all.length) {
      el.innerHTML = '<div class="meta" style="font-size:11px;color:var(--muted)">no models yet - start the worker</div>';
      return;
    }
    all.forEach(function (m) {
      var div = document.createElement("div");
      div.className = "model-card" + (m.id === selectedId ? " selected" : "");
      var badge = m.source === "opencode"
        ? '<span class="tag" style="color:#e0a13a">opencode</span>'
        : m.source === "ollama"
          ? '<span class="tag" style="color:#4f8cff">local</span>'
          : '<span class="tag" style="color:#17b864">free</span>';
      div.innerHTML = "<strong>" + escapeHtml(m.name || m.id) + "</strong>" + badge;
      div.title = (m.note || m.id);
      div.addEventListener("click", function () {
        selectedId = m.id;
        if (onClick) onClick(m);
        forceReselect(el, m.id);
      });
      el.appendChild(div);
    });
  }

  function forceReselect(grid, activeId) {
    Array.prototype.forEach.call(grid.children, function (c) {
      var ok = c.__modelId === activeId;
      c.classList.toggle("selected", ok);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  window.AIMEVA.models = {
    load: load,
    flatten: flatten,
    selected: selected,
    setSelected: setSelected,
    renderInto: renderInto,
    escapeHtml: escapeHtml
  };
})();