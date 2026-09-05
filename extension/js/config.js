// Aimeva panel configuration - single place for URLs & endpoints.
window.AIMEVA = window.AIMEVA || {};

window.AIMEVA.config = {
  version: "0.1.0",
  workerBase: "http://127.0.0.1:8000",
  updateUrl: "https://raw.githubusercontent.com/kuldeep7ke/aimeva/master/plugin/update.json",
  modelsUrl: "https://raw.githubusercontent.com/kuldeep7ke/aimeva/master/plugin/models.json",
  repoUrl: "https://github.com/kuldeep7ke/aimeva",
  downloadsDir: "Downloads",

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
};