const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clone = (value) => structuredClone(value);

const defaultTiles = [
  { id: "ground", code: "R", name: "Zeme", type: "solid", color: "#a96b3e", symbol: "·" },
  { id: "grass", code: "G", name: "Zāle", type: "solid", color: "#3fc155", symbol: "♣" },
  { id: "stone", code: "K", name: "Tumšā", type: "solid", color: "#262b44", symbol: "◆" },
  { id: "water", code: "A", name: "Ūdens", type: "hazard", color: "#2d9ce8", symbol: "≈" },
  { id: "lava", code: "F", name: "Lava", type: "hazard", color: "#f0572b", symbol: "≈" },
  { id: "spawn", code: "V", name: "Violeta", type: "spawn", color: "#8a5cf5", symbol: "●" },
  { id: "goal", code: "I", name: "Gaišā", type: "goal", color: "#f3f0e6", symbol: "★" },
  { id: "spikes", code: "M", name: "Dzintara", type: "hazard", color: "#f5a623", symbol: "▲" }
];
const prismCodes = "KIRGAVMFLBCDEHJNOPQSTUWXYZ0123456789";

function blankCells(width, height) {
  return Array.from({ length: height }, () => Array(width).fill(null));
}

function makeInitialState() {
  // all-levels.json pirmais līmenis (First Bloom) ir 12 × 12, tādēļ tas ir
  // jaunā līmeņa sākuma formāts. Katram līmenim to var mainīt iestatījumos.
  const width = 12, height = 12;
  return {
    format: "pixel-level-tool",
    version: 1,
    name: "Mans pirmais līmenis",
    author: "",
    description: "",
    difficulty: "Auto",
    slot: 1,
    source: "tool",
    beltCap: 24,
    seed: 19001,
    containers: [],
    links: [],
    mystery: null,
    thick: null,
    regions: null,
    shutters: null,
    width,
    height,
    tileSize: 32,
    backgroundColor: "#17151f",
    tiles: clone(defaultTiles),
    layers: [
      { id: crypto.randomUUID(), name: "Pamata slānis", visible: true, cells: blankCells(width, height) }
    ]
  };
}

const workspace = loadWorkspace();
let levelCollection = workspace.levels;
let activeLevelIndex = workspace.activeLevelIndex;
let importedCollection = workspace.importedCollection;
let state = clone(levelCollection[activeLevelIndex]);
let selectedTile = state.tiles[0]?.id;
let activeLayer = 0;
let activeTool = "brush";
let showGrid = true;
let zoom = 1;
let drawing = false;
let strokeSnapshot = null;
let history = [];
let future = [];
let editingTileId = null;
let imageColorCount = 8;
let pendingImageFile = null;
let pendingImage = null;
let pendingImageResult = null;
let previewTimer = null;
let promptImageGenerating = false;
const difficultyCache = new Map();
const difficultyRequests = new Map();
let difficultyTimer = null;

const canvas = $("#levelCanvas");
const ctx = canvas.getContext("2d");
const viewport = $("#canvasViewport");

function loadWorkspace() {
  try {
    const draft = localStorage.getItem("pixel-level-tool-draft");
    if (!draft) return { levels: [makeInitialState()], activeLevelIndex: 0, importedCollection: false };
    const parsed = JSON.parse(draft);
    if (parsed?.format === "pixel-level-tool-workspace" && Array.isArray(parsed.levels) && parsed.levels.length) {
      const levels = parsed.levels.map(normaliseLevel);
      return {
        levels,
        activeLevelIndex: Math.max(0, Math.min(levels.length - 1, Math.trunc(+parsed.activeLevelIndex || 0))),
        importedCollection: !!parsed.importedCollection
      };
    }
    // Pirms 12 × 12 noklusējuma ieviešanas lietotne automātiski saglabāja
    // 24 × 16 demonstrācijas līmeni. To atpazīstam pēc precīzās sākuma formas
    // un migrējam, lai vecais paraugs vairs neizskatītos kā jaunais noklusējums.
    if (isLegacyStarterDraft(parsed)) {
      const migrated = makeInitialState();
      localStorage.setItem("pixel-level-tool-draft", JSON.stringify(migrated));
      return { levels: [migrated], activeLevelIndex: 0, importedCollection: false };
    }
    return { levels: [normaliseLevel(parsed)], activeLevelIndex: 0, importedCollection: false };
  } catch { return { levels: [makeInitialState()], activeLevelIndex: 0, importedCollection: false }; }
}

function isLegacyStarterDraft(level) {
  const defaultIds = defaultTiles.map(tile => tile.id).join(",");
  return level?.name === "Mans pirmais līmenis" && level.width === 24 && level.height === 16 &&
    level.layers?.length === 2 && level.layers[0]?.name === "Pamata slānis" &&
    level.layers[1]?.name === "Dekorācijas" &&
    level.tiles?.map(tile => tile.id).join(",") === defaultIds;
}

function normaliseLevel(data) {
  if (data?.game === "Prism Pop!" && Array.isArray(data.levels)) {
    return prismLevelToState(data.levels[0]);
  }
  if (Array.isArray(data?.grid) && data?.palette) return prismLevelToState(data);
  if (!data || !Number.isInteger(+data.width) || !Number.isInteger(+data.height)) throw new Error("Nederīgs līmeņa formāts.");
  const width = Math.max(4, Math.min(100, +data.width));
  const height = Math.max(4, Math.min(100, +data.height));
  const sourceTiles = Array.isArray(data.tiles) ? data.tiles : clone(defaultTiles);
  const usedCodes = new Set();
  const tiles = sourceTiles.map((tile, index) => {
    let code = String(tile.code || "").toUpperCase().slice(0, 1);
    if (!code || !prismCodes.includes(code) || usedCodes.has(code)) {
      code = [...prismCodes].find(candidate => !usedCodes.has(candidate)) || String(index % 10);
    }
    usedCodes.add(code);
    return { ...tile, code };
  });
  const ids = new Set(tiles.map((tile) => tile.id));
  const layers = (Array.isArray(data.layers) && data.layers.length ? data.layers : [{ name: "Pamata slānis", cells: [] }]).map((layer, index) => ({
    id: layer.id || crypto.randomUUID(),
    name: layer.name || `Slānis ${index + 1}`,
    visible: layer.visible !== false,
    cells: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => ids.has(layer.cells?.[y]?.[x]) ? layer.cells[y][x] : null)
    )
  }));
  return {
    format: "pixel-level-tool", version: 1,
    name: String(data.name || "Līmenis"), author: String(data.author || ""),
    description: String(data.description || ""), difficulty: normaliseTier(data.difficulty),
    slot: Math.max(1, Math.trunc(+data.slot || 1)),
    source: ["tool", "pushed", "builtin"].includes(data.source) ? data.source : "tool",
    beltCap: Math.max(1, Math.trunc(+data.beltCap || 24)),
    seed: Math.max(1, Math.trunc(+data.seed || 19001)),
    containers: normaliseContainers(data.containers),
    links: normaliseLinks(data.links),
    mystery: normaliseMystery(data.mystery),
    thick: normaliseThick(data.thick),
    regions: normaliseRegions(data.regions),
    shutters: normaliseShutters(data.shutters),
    width, height, tileSize: Math.max(8, Math.min(256, +data.tileSize || 32)),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(data.backgroundColor) ? data.backgroundColor : "#17151f",
    tiles, layers
  };
}

function normaliseContainers(containers) {
  if (!Array.isArray(containers)) return [];
  return containers.map((container) => ({
    c: String(container?.c || "K").toUpperCase().slice(0, 1),
    cap: Math.max(1, Math.min(99, Math.trunc(+container?.cap || 1))),
    r: Math.max(0, Math.trunc(+container?.r || 0)),
    col: Math.max(0, Math.min(3, Math.trunc(+container?.col || 0)))
  }));
}

function normaliseLinks(links) {
  if (!Array.isArray(links)) return [];
  return links.map((link, index) => ({
    id: String(link?.id || `L${index + 1}`).slice(0, 48),
    members: Array.isArray(link?.members)
      ? [...new Set(link.members.map(Number).filter(Number.isInteger))]
      : []
  }));
}

function normaliseMystery(mystery) {
  if (!mystery || typeof mystery !== "object" || Array.isArray(mystery)) return null;
  const exclude = Array.isArray(mystery.exclude)
    ? [...new Set(mystery.exclude.map(code => String(code).toUpperCase().slice(0, 1)).filter(Boolean))]
    : [];
  return {
    proportion: Math.max(0.05, Math.min(1, Number.isFinite(+mystery.proportion) ? +mystery.proportion : 0.25)),
    revealAt: mystery.revealAt === "bottom" ? "bottom" : "top",
    exclude
  };
}

function normaliseThick(thick) {
  if (!thick || typeof thick !== "object" || Array.isArray(thick)) return null;
  const result = {};
  Object.entries(thick).forEach(([key, hp]) => {
    if (!/^\d+,\d+$/.test(key) || !Number.isFinite(+hp) || +hp < 1) return;
    result[key] = Math.trunc(+hp);
  });
  return Object.keys(result).length ? result : null;
}

function normaliseRegions(regions) {
  if (!regions || typeof regions !== "object" || Array.isArray(regions)) return null;
  const result = {};
  Object.entries(regions).forEach(([name, coordinates]) => {
    const safeName = String(name).trim().slice(0, 48);
    if (!safeName || !Array.isArray(coordinates)) return;
    const cells = coordinates
      .filter(cell => Array.isArray(cell) && cell.length >= 2 && Number.isFinite(+cell[0]) && Number.isFinite(+cell[1]))
      .map(cell => [Math.max(0, Math.trunc(+cell[0])), Math.max(0, Math.trunc(+cell[1]))]);
    if (cells.length) result[safeName] = cells;
  });
  return Object.keys(result).length ? result : null;
}

function normaliseShutters(shutters) {
  if (!shutters || typeof shutters !== "object") return null;
  const list = Array.isArray(shutters) ? shutters : [shutters];
  const result = list.map(shutter => ({
    covers: String(shutter?.covers || "").trim(),
    key: String(shutter?.key || "").trim()
  })).filter(shutter => shutter.covers && shutter.key);
  return result.length ? result : null;
}

function normaliseTier(value) {
  if (value === "Auto") return "Auto";
  return ({ "Viegla": "Easy", "Vidēja": "Medium", "Grūta": "Hard", "Ekstrēma": "Brutal" })[value] ||
    (["Easy", "Medium", "Hard", "Brutal", "Fragile", "Unwinnable", "Broken"].includes(value) ? value : "Auto");
}

function prismLevelToState(level) {
  if (!level || !Array.isArray(level.grid) || !level.grid.length || !level.palette) {
    throw new Error("Prism Pop! failā nav derīga līmeņa.");
  }
  const width = level.grid[0].length;
  const height = level.grid.length;
  if (!width || level.grid.some(row => typeof row !== "string" || row.length !== width)) {
    throw new Error("Visām grid rindām jābūt vienāda garuma.");
  }
  const paletteEntries = Object.entries(level.palette);
  const tiles = paletteEntries.map(([code, color]) => ({
    id: code,
    code,
    name: `Krāsa ${code}`,
    type: "decoration",
    color,
    symbol: ""
  }));
  const validCodes = new Set(paletteEntries.map(([code]) => code));
  return normaliseLevel({
    name: level.name,
    author: "",
    description: "",
    difficulty: level.tier,
    slot: level.slot,
    source: level.source,
    beltCap: level.beltCap,
    seed: level.seed,
    containers: level.containers,
    links: level.links,
    mystery: level.mystery,
    thick: level.thick,
    regions: level.regions,
    shutters: level.shutters,
    width,
    height,
    tileSize: 32,
    backgroundColor: level.palette.K || "#262b44",
    tiles,
    layers: [{
      name: "Prism Pop režģis",
      visible: true,
      cells: level.grid.map(row => [...row].map(code => validCodes.has(code) ? code : null))
    }]
  });
}

function saveDraft() {
  levelCollection[activeLevelIndex] = clone(state);
  localStorage.setItem("pixel-level-tool-draft", JSON.stringify({
    format: "pixel-level-tool-workspace",
    levels: levelCollection,
    activeLevelIndex,
    importedCollection
  }));
  $("#saveState").textContent = "Saglabāts lokāli";
  $("#saveState").style.color = "";
}

let saveTimer;
function changed(render = true) {
  levelCollection[activeLevelIndex] = clone(state);
  $("#saveState").textContent = "Saglabā...";
  $("#saveState").style.color = "#ffbd4a";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 350);
  if (render) renderAll();
}

function snapshot() {
  history.push(clone(state));
  if (history.length > 60) history.shift();
  future = [];
  updateHistoryButtons();
}

function undo() {
  if (!history.length) return;
  future.push(clone(state));
  state = history.pop();
  activeLayer = Math.min(activeLayer, state.layers.length - 1);
  selectedTile = state.tiles.some(t => t.id === selectedTile) ? selectedTile : state.tiles[0]?.id;
  changed();
}

function redo() {
  if (!future.length) return;
  history.push(clone(state));
  state = future.pop();
  activeLayer = Math.min(activeLayer, state.layers.length - 1);
  changed();
}

function updateHistoryButtons() {
  $("#undoBtn").disabled = !history.length;
  $("#redoBtn").disabled = !future.length;
}

function syncForm() {
  $("#levelName").value = state.name;
  $("#gridWidth").value = state.width;
  $("#gridHeight").value = state.height;
  $("#tileSize").value = state.tileSize;
  $("#backgroundColor").value = state.backgroundColor;
  $("#backgroundHex").textContent = state.backgroundColor.toUpperCase();
  $("#author").value = state.author;
  $("#description").value = state.description;
  $("#difficulty").value = state.difficulty;
  updateDifficultyHint();
  $("#slot").value = state.slot;
  $("#source").value = state.source;
  $("#beltCap").value = state.beltCap;
  $("#seed").value = state.seed;
}

function renderPalette() {
  const palette = $("#palette");
  const unusedCount = getUnusedTiles().length;
  const cleanupButton = $("#removeUnusedTilesBtn");
  cleanupButton.disabled = unusedCount === 0;
  cleanupButton.title = unusedCount
    ? `Dzēst ${unusedCount} paletē neizmantotās krāsas`
    : "Visas paletes krāsas tiek izmantotas";
  palette.replaceChildren();
  if (!state.tiles.length) {
    palette.innerHTML = '<p class="palette-empty">Palete ir tukša. Pievieno flīzi ar +</p>';
    return;
  }
  state.tiles.forEach((tile) => {
    const button = document.createElement("button");
    button.className = `tile-swatch${tile.id === selectedTile ? " active" : ""}`;
    button.title = `${tile.code} · ${tile.name} (${tile.type})`;
    button.dataset.tile = tile.id;
    button.innerHTML = `<span style="background:${escapeAttr(tile.color)}">${escapeHtml(tile.symbol || "")}</span>`;
    button.addEventListener("click", () => { selectedTile = tile.id; setTool("brush"); renderPalette(); });
    button.addEventListener("dblclick", () => openTileDialog(tile));
    palette.append(button);
  });
}

function getUnusedTiles() {
  const usedTileIds = new Set();
  state.layers.forEach(layer => layer.cells.forEach(row => row.forEach(tileId => {
    if (tileId) usedTileIds.add(tileId);
  })));
  return state.tiles.filter(tile => !usedTileIds.has(tile.id));
}

function renderLayers() {
  const root = $("#layers");
  root.replaceChildren();
  [...state.layers].reverse().forEach((layer, reverseIndex) => {
    const index = state.layers.length - 1 - reverseIndex;
    const item = document.createElement("div");
    item.className = `layer${index === activeLayer ? " active" : ""}`;
    item.innerHTML = `<button class="visibility" title="Redzamība">${layer.visible ? "◉" : "○"}</button>
      <span class="layer-name">${escapeHtml(layer.name)}<small>${countUsed(layer.cells)} aizpildītas flīzes</small></span>
      <button class="layer-menu" title="Slāņa darbības">⋮</button>`;
    item.addEventListener("click", () => { activeLayer = index; renderLayers(); });
    item.querySelector(".visibility").addEventListener("click", (event) => {
      event.stopPropagation(); snapshot(); layer.visible = !layer.visible; changed();
    });
    item.querySelector(".layer-menu").addEventListener("click", (event) => {
      event.stopPropagation();
      const action = prompt("Ieraksti: pārsaukt, notīrīt vai dzēst", "pārsaukt")?.toLowerCase();
      if (action === "pārsaukt") {
        const name = prompt("Jaunais slāņa nosaukums:", layer.name)?.trim();
        if (name) { snapshot(); layer.name = name; changed(); }
      } else if (action === "notīrīt") {
        if (confirm(`Notīrīt slāni “${layer.name}”?`)) { snapshot(); layer.cells = blankCells(state.width, state.height); changed(); }
      } else if (action === "dzēst" && state.layers.length > 1) {
        if (confirm(`Dzēst slāni “${layer.name}”?`)) {
          snapshot(); state.layers.splice(index, 1); activeLayer = Math.max(0, Math.min(activeLayer, state.layers.length - 1)); changed();
        }
      }
    });
    root.append(item);
  });
}

function countUsed(cells) {
  return cells.reduce((total, row) => total + row.filter(Boolean).length, 0);
}

function renderCanvas(target = canvas, preview = false) {
  const context = target.getContext("2d");
  const size = preview ? Math.min(32, state.tileSize) : state.tileSize;
  target.width = state.width * size;
  target.height = state.height * size;
  context.fillStyle = state.backgroundColor;
  context.fillRect(0, 0, target.width, target.height);

  state.layers.forEach((layer) => {
    if (!layer.visible) return;
    layer.cells.forEach((row, y) => row.forEach((tileId, x) => {
      if (!tileId) return;
      const tile = state.tiles.find(t => t.id === tileId);
      if (!tile) return;
      const px = x * size, py = y * size;
      context.fillStyle = tile.color;
      context.fillRect(px, py, size, size);
      if (!tile.flat) {
        context.fillStyle = shade(tile.color, -20);
        context.fillRect(px, py + size - Math.max(2, size * .11), size, Math.max(2, size * .11));
        context.fillStyle = shade(tile.color, 18);
        context.fillRect(px, py, size, Math.max(1, size * .07));
      }
      if (tile.symbol && size >= 16) {
        context.fillStyle = "#fff";
        context.font = `600 ${Math.round(size * .46)}px Manrope`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.shadowColor = "#0008";
        context.shadowBlur = 2;
        context.fillText(tile.symbol, px + size / 2, py + size / 2);
        context.shadowBlur = 0;
      }
    }));
  });

  if (!preview && showGrid) {
    context.strokeStyle = "#ffffff1e";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= state.width; x++) { context.moveTo(x * size + .5, 0); context.lineTo(x * size + .5, target.height); }
    for (let y = 0; y <= state.height; y++) { context.moveTo(0, y * size + .5); context.lineTo(target.width, y * size + .5); }
    context.stroke();
  }
}

function renderAll() {
  syncForm();
  renderPalette();
  renderLayers();
  renderContainers();
  renderMystery();
  renderThick();
  renderRegions();
  renderShutters();
  renderLevelBrowser();
  renderCanvas();
  $("#canvasWrap").style.transform = `scale(${zoom})`;
  $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`;
  $("#mapStats").textContent = `${state.width} × ${state.height} · ${state.width * state.height} flīzes`;
  updateHistoryButtons();
}

function updateDifficultyHint() {
  const hint = $("#difficultyHint");
  if (!hint) return;
  if (state.difficulty !== "Auto") {
    hint.textContent = `Manuāli izvēlēta: ${state.difficulty}.`;
    return;
  }
  const report = difficultyReport(state);
  if (!report) {
    hint.textContent = "Spēles simulatora pārbaude tiek gatavota…";
    scheduleDifficultyTest();
    return;
  }
  const randomRate = Math.round(report.randomWinRate * 100);
  const skilled = report.skilledWins.length ? report.skilledWins.join(", ") : "neviena";
  hint.textContent = `Spēles createSim: ${report.tier} · random ${randomRate}% · prasmīgās: ${skilled} · ${report.publishable ? "publicējams" : "nav publicējams"}.`;
}

function estimateDifficulty(levelState) {
  return difficultyReport(levelState)?.tier || "Auto";
}

function difficultyReport(levelState) {
  const { signature } = simulationPayload(levelState);
  return difficultyCache.get(signature) || null;
}

function simulationPayload(levelState) {
  const grid = exportedGrid(levelState);
  const counts = {};
  grid.forEach(row => [...row].forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
  const palette = {};
  levelState.tiles.forEach(tile => { palette[tile.code] = tile.color.toUpperCase(); });
  if (!palette.K) palette.K = levelState.backgroundColor.toUpperCase();
  const simulationLevel = {
    grid,
    palette,
    containers: levelState.containers.length ? sortContainers(levelState.containers) : buildContainers(counts),
    links: levelState.links || [],
    mystery: exportMystery(levelState),
    thick: levelState.thick,
    regions: levelState.regions,
    shutters: levelState.shutters,
    beltCap: levelState.beltCap,
    seed: levelState.seed,
    name: levelState.name
  };
  const signature = JSON.stringify(simulationLevel);
  return { signature, level: simulationLevel };
}

async function requestDifficultyReport(levelState, { fresh = false } = {}) {
  const { signature, level } = simulationPayload(levelState);
  if (!fresh && difficultyCache.has(signature)) return difficultyCache.get(signature);
  if (!fresh && difficultyRequests.has(signature)) return difficultyRequests.get(signature);
  const request = fetch("/api/difficulty", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level })
  }).then(async response => {
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error || `Simulatora kļūda (${response.status})`);
    difficultyCache.set(signature, payload);
    return payload;
  }).finally(() => difficultyRequests.delete(signature));
  difficultyRequests.set(signature, request);
  return request;
}

function scheduleDifficultyTest() {
  clearTimeout(difficultyTimer);
  difficultyTimer = setTimeout(async () => {
    try {
      await requestDifficultyReport(state);
      updateDifficultyHint();
    } catch (error) {
      const hint = $("#difficultyHint");
      if (hint) hint.textContent = `Simulatoru nevar palaist: ${error.message}`;
    }
  }, 250);
}

function resolvedTier(levelState) {
  if (levelState.difficulty !== "Auto") return levelState.difficulty;
  return difficultyReport(levelState)?.tier || "Unwinnable";
}

function renderLevelBrowser() {
  const root = $("#levelBrowser");
  root.replaceChildren();
  $("#levelCount").textContent = levelCollection.length;
  levelCollection.forEach((level, index) => {
    const button = document.createElement("button");
    button.className = `level-browser-item${index === activeLevelIndex ? " active" : ""}`;
    button.innerHTML = `<b>Slots ${level.slot}</b><span>${escapeHtml(level.name?.trim() || "Untitled")}</span>`;
    button.title = `Atvērt: ${level.name?.trim() || "Untitled"}`;
    button.addEventListener("click", () => switchLevel(index));
    root.append(button);
  });
}

function switchLevel(index) {
  if (index === activeLevelIndex || !levelCollection[index]) return;
  levelCollection[activeLevelIndex] = clone(state);
  activeLevelIndex = index;
  state = clone(levelCollection[index]);
  activeLayer = 0;
  selectedTile = state.tiles[0]?.id;
  history = [];
  future = [];
  saveDraft();
  renderAll();
  fitCanvas();
  toast(`Atvērts ${state.name || `slots ${state.slot}`}`);
}

function renderContainers() {
  const root = $("#containers");
  root.replaceChildren();
  if (!state.containers.length) {
    root.innerHTML = '<p class="containers-empty">Nav manuālu containers — eksports tos izveidos automātiski.</p>';
    return;
  }
  // Simulatora kļūdas atsaucas uz eksportēto (col/r) secību. Rādām to pašu
  // numuru GUI, bet pašu manuālo sarakstu vai JSON nemainām.
  const simulatorNumbers = new Map(
    state.containers
      .map((container, index) => ({ container, index }))
      .sort((a, b) => a.container.col - b.container.col || a.container.r - b.container.r || a.index - b.index)
      .map((item, index) => [item.index, index + 1])
  );
  state.containers.forEach((container, index) => {
    const row = document.createElement("div");
    row.className = "container-row";
    const options = state.tiles.map(tile => `<option value="${tile.code}"${tile.code === container.c ? " selected" : ""}>${tile.code}</option>`).join("");
    row.innerHTML = `<span class="container-number" title="Container #${simulatorNumbers.get(index)}">#${simulatorNumbers.get(index)}</span>
      <label>Krāsa<select data-field="c">${options}</select></label>
      <label>Cap<input data-field="cap" type="number" min="1" max="99" value="${container.cap}"></label>
      <label>Col / r<input data-field="position" value="${container.col} / ${container.r}" aria-label="Kolonna un rinda"></label>
      <button class="container-delete" title="Dzēst container" aria-label="Dzēst container">×</button>`;
    row.querySelector('[data-field="c"]').addEventListener("change", (event) => updateContainer(index, { c: event.target.value }));
    row.querySelector('[data-field="cap"]').addEventListener("change", (event) => updateContainer(index, { cap: Math.max(1, Math.trunc(+event.target.value || 1)) }));
    row.querySelector('[data-field="position"]').addEventListener("change", (event) => {
      const parts = event.target.value.match(/^\s*(\d+)\s*[/,: ]\s*(\d+)\s*$/);
      if (!parts) { event.target.value = `${container.col} / ${container.r}`; toast("Pozīciju ievadi formātā: kolonna / rinda", true); return; }
      updateContainer(index, { col: Math.max(0, Math.min(3, +parts[1])), r: Math.max(0, +parts[2]) });
    });
    row.querySelector(".container-delete").addEventListener("click", () => {
      snapshot(); state.containers.splice(index, 1); changed();
    });
    root.append(row);
  });
}

function updateContainer(index, values) {
  snapshot();
  Object.assign(state.containers[index], values);
  changed();
}

function renderMystery() {
  const enabled = !!state.mystery;
  $("#mysteryEnabled").checked = enabled;
  $("#mysterySettings").classList.toggle("is-disabled", !enabled);
  const mystery = state.mystery || { proportion: 0.25, revealAt: "top", exclude: [] };
  $("#mysteryProportion").value = mystery.proportion;
  $("#mysteryProportionOutput").textContent = `${Math.round(mystery.proportion * 100)}%`;
  $("#mysteryRevealAt").value = mystery.revealAt;
  const root = $("#mysteryExclude");
  root.replaceChildren();
  if (!state.tiles.length) {
    root.innerHTML = '<span class="mystery-exclude-empty">Nav paletes krāsu</span>';
    return;
  }
  state.tiles.forEach(tile => {
    const label = document.createElement("label");
    const checked = mystery.exclude.includes(tile.code) ? " checked" : "";
    label.innerHTML = `<input type="checkbox" value="${tile.code}"${checked}><span>${tile.code}</span>`;
    label.querySelector("input").addEventListener("change", event => {
      if (!state.mystery) return;
      snapshot();
      state.mystery.exclude = state.mystery.exclude.filter(code => code !== tile.code);
      if (event.target.checked) state.mystery.exclude.push(tile.code);
      changed();
    });
    root.append(label);
  });
}

function renderThick() {
  const root = $("#thickCells");
  root.replaceChildren();
  const entries = Object.entries(state.thick || {});
  if (!entries.length) {
    root.innerHTML = '<p class="mechanic-empty">Nav thick šūnu</p>';
    return;
  }
  entries.forEach(([position, hp]) => {
    const [row, col] = position.split(",").map(Number);
    const rowElement = document.createElement("div");
    rowElement.className = "mechanic-row";
    rowElement.innerHTML = `<label>Rinda,kolonna<input data-position value="${row},${col}" aria-label="Thick koordināte"></label>
      <label>HP<input data-hp type="number" min="1" max="99" value="${hp}"></label>
      <button class="mechanic-delete" aria-label="Dzēst thick šūnu">×</button>`;
    rowElement.querySelector("[data-position]").addEventListener("change", event => updateThick(position, event.target.value, hp));
    rowElement.querySelector("[data-hp]").addEventListener("change", event => updateThick(position, position, Math.max(1, Math.trunc(+event.target.value || 1))));
    rowElement.querySelector(".mechanic-delete").addEventListener("click", () => {
      snapshot();
      delete state.thick[position];
      if (!Object.keys(state.thick).length) state.thick = null;
      changed();
    });
    root.append(rowElement);
  });
}

function updateThick(oldPosition, proposedPosition, hp) {
  const match = String(proposedPosition).match(/^\s*(\d+)\s*[, ]\s*(\d+)\s*$/);
  if (!match) { toast("Thick koordināti ievadi formātā rinda,kolonna", true); renderThick(); return; }
  const position = `${+match[1]},${+match[2]}`;
  snapshot();
  delete state.thick[oldPosition];
  state.thick[position] = hp;
  changed();
}

function renderRegions() {
  const root = $("#regions");
  root.replaceChildren();
  const entries = Object.entries(state.regions || {});
  if (!entries.length) {
    root.innerHTML = '<p class="mechanic-empty">Nav izveidotu regions</p>';
    return;
  }
  entries.forEach(([name, cells]) => {
    const card = document.createElement("div");
    card.className = "region-card";
    const coordinateText = cells.map(([x, y]) => `${x},${y}`).join("\n");
    card.innerHTML = `<div class="region-title"><label>Nosaukums<input data-name value="${escapeAttr(name)}"></label><button class="region-delete" aria-label="Dzēst region">×</button></div>
      <label>Šūnas<textarea data-cells placeholder="0,0&#10;1,0">${coordinateText}</textarea></label>`;
    card.querySelector("[data-name]").addEventListener("change", event => renameRegion(name, event.target.value));
    card.querySelector("[data-cells]").addEventListener("change", event => updateRegionCells(name, event.target.value));
    card.querySelector(".region-delete").addEventListener("click", () => {
      snapshot();
      delete state.regions[name];
      if ((state.shutters || []).some(shutter => shutter.covers === name || shutter.key === name)) state.shutters = null;
      if (!Object.keys(state.regions).length) state.regions = null;
      changed();
    });
    root.append(card);
  });
}

function renameRegion(oldName, newName) {
  const name = String(newName).trim().slice(0, 48);
  if (!name || name === oldName) { renderRegions(); return; }
  if (state.regions[name]) { toast("Šāds region nosaukums jau eksistē", true); renderRegions(); return; }
  snapshot();
  state.regions[name] = state.regions[oldName];
  delete state.regions[oldName];
  (state.shutters || []).forEach(shutter => {
    if (shutter.covers === oldName) shutter.covers = name;
    if (shutter.key === oldName) shutter.key = name;
  });
  changed();
}

function updateRegionCells(name, text) {
  const cells = [];
  const seen = new Set();
  for (const line of text.split(/[\n;]/)) {
    const match = line.trim().match(/^(\d+)\s*,\s*(\d+)$/);
    if (!match) continue;
    const cell = [+match[1], +match[2]];
    const key = cell.join(",");
    if (!seen.has(key)) { seen.add(key); cells.push(cell); }
  }
  if (!cells.length) { toast("Region jābūt vismaz vienai koordinātei x,y", true); renderRegions(); return; }
  snapshot();
  state.regions[name] = cells;
  changed();
}

function renderShutters() {
  const names = Object.keys(state.regions || {});
  const enabled = !!state.shutters;
  $("#shuttersEnabled").checked = enabled;
  $("#shuttersSettings").classList.toggle("is-disabled", !enabled || !names.length);
  const current = state.shutters?.[0] || { covers: names[0] || "", key: names[1] || names[0] || "" };
  ["#shuttersCovers", "#shuttersKey"].forEach((selector, index) => {
    const select = $(selector);
    select.replaceChildren();
    names.forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      option.selected = name === (index ? current.key : current.covers);
      select.append(option);
    });
  });
}

function shade(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (value >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((value >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (value & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

function cellFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor((event.clientX - rect.left) / rect.width * state.width),
    y: Math.floor((event.clientY - rect.top) / rect.height * state.height)
  };
}

function applyTool(x, y) {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
  const layer = state.layers[activeLayer];
  if (activeTool === "brush" && !selectedTile) {
    toast("Vispirms pievieno vai izvēlies flīzi", true);
    return;
  }
  if (activeTool === "picker") {
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const id = state.layers[i].visible && state.layers[i].cells[y][x];
      if (id) { selectedTile = id; setTool("brush"); renderPalette(); return; }
    }
  } else if (activeTool === "fill") {
    floodFill(layer.cells, x, y, selectedTile);
  } else {
    layer.cells[y][x] = activeTool === "eraser" ? null : selectedTile;
  }
  renderCanvas();
}

function floodFill(cells, startX, startY, replacement) {
  const target = cells[startY][startX];
  if (target === replacement) return;
  const queue = [[startX, startY]];
  while (queue.length) {
    const [x, y] = queue.pop();
    if (x < 0 || y < 0 || x >= state.width || y >= state.height || cells[y][x] !== target) continue;
    cells[y][x] = replacement;
    queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

canvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  drawing = true;
  strokeSnapshot = clone(state);
  canvas.setPointerCapture(event.pointerId);
  const { x, y } = cellFromEvent(event);
  applyTool(x, y);
  if (activeTool === "fill" || activeTool === "picker") drawing = false;
});
canvas.addEventListener("pointermove", (event) => {
  const { x, y } = cellFromEvent(event);
  $("#coordinates").innerHTML = `X: ${x >= 0 && x < state.width ? x : "—"} &nbsp; Y: ${y >= 0 && y < state.height ? y : "—"}`;
  if (drawing && (activeTool === "brush" || activeTool === "eraser")) applyTool(x, y);
});
canvas.addEventListener("pointerup", () => {
  if (!strokeSnapshot) return;
  history.push(strokeSnapshot);
  if (history.length > 60) history.shift();
  future = [];
  strokeSnapshot = null;
  drawing = false;
  changed();
});
canvas.addEventListener("pointerleave", () => { $("#coordinates").innerHTML = "X: — &nbsp; Y: —"; });

function setTool(tool) {
  activeTool = tool;
  $$(".tool").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
  const labels = { brush: ["OTA", "Velc, lai zīmētu"], eraser: ["DZĒST", "Velc, lai dzēstu"], fill: ["AIZPILDĪT", "Klikšķini uz laukuma"], picker: ["PAŅEMT", "Klikšķini uz flīzes"] };
  $("#statusTool").textContent = labels[tool][0];
  $("#statusTool").nextSibling.textContent = ` · ${labels[tool][1]}`;
}

$$(".tool").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
$("#undoBtn").addEventListener("click", undo);
$("#redoBtn").addEventListener("click", redo);

$("#resizeBtn").addEventListener("click", () => {
  const width = Math.max(4, Math.min(100, +$("#gridWidth").value || state.width));
  const height = Math.max(4, Math.min(100, +$("#gridHeight").value || state.height));
  if (width === state.width && height === state.height) return;
  snapshot();
  state.layers.forEach((layer) => {
    layer.cells = Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => layer.cells[y]?.[x] ?? null)
    );
  });
  state.width = width; state.height = height;
  changed(); fitCanvas(); toast(`Režģis mainīts uz ${width} × ${height}`);
});

$("#tileSize").addEventListener("change", (event) => {
  snapshot(); state.tileSize = Math.max(8, Math.min(256, +event.target.value || 32)); changed();
});
$("#backgroundColor").addEventListener("input", (event) => {
  state.backgroundColor = event.target.value; $("#backgroundHex").textContent = event.target.value.toUpperCase(); changed();
});
$("#levelName").addEventListener("input", event => { state.name = event.target.value; changed(false); });
$("#author").addEventListener("input", event => { state.author = event.target.value; changed(false); });
$("#description").addEventListener("input", event => { state.description = event.target.value; changed(false); });
$("#difficulty").addEventListener("change", event => { state.difficulty = event.target.value; changed(false); });
$("#slot").addEventListener("change", event => { state.slot = Math.max(1, Math.trunc(+event.target.value || 1)); changed(false); });
$("#source").addEventListener("change", event => { state.source = event.target.value; changed(false); });
$("#beltCap").addEventListener("change", event => { state.beltCap = Math.max(1, Math.trunc(+event.target.value || 24)); changed(false); });
$("#seed").addEventListener("change", event => { state.seed = Math.max(1, Math.trunc(+event.target.value || Date.now())); changed(false); });
$("#showGrid").addEventListener("change", event => { showGrid = event.target.checked; renderCanvas(); });

$("#zoomIn").addEventListener("click", () => setZoom(zoom + .25));
$("#zoomOut").addEventListener("click", () => setZoom(zoom - .25));
$("#fitBtn").addEventListener("click", fitCanvas);
function setZoom(value) {
  zoom = Math.max(.25, Math.min(3, value));
  $("#canvasWrap").style.transform = `scale(${zoom})`;
  $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`;
}
function fitCanvas() {
  const usableW = viewport.clientWidth - 100, usableH = viewport.clientHeight - 100;
  setZoom(Math.min(1.5, usableW / (state.width * state.tileSize), usableH / (state.height * state.tileSize)));
}

$("#settingsToggle").addEventListener("click", () => {
  $("#settingsBody").hidden = !$("#settingsBody").hidden;
  $("#settingsToggle").textContent = $("#settingsBody").hidden ? "⌄" : "⌃";
});

$("#addLayerBtn").addEventListener("click", () => {
  const name = prompt("Jaunā slāņa nosaukums:", `Slānis ${state.layers.length + 1}`)?.trim();
  if (!name) return;
  snapshot();
  state.layers.push({ id: crypto.randomUUID(), name, visible: true, cells: blankCells(state.width, state.height) });
  activeLayer = state.layers.length - 1; changed();
});

$("#addContainerBtn").addEventListener("click", () => {
  const colour = state.tiles.find(tile => tile.id === selectedTile)?.code || state.tiles[0]?.code || "K";
  const col = state.containers.length % 4;
  const row = state.containers.filter(container => container.col === col).length;
  snapshot();
  state.containers.push({ c: colour, cap: 2, r: row, col });
  changed();
});

$("#autoContainersBtn").addEventListener("click", () => {
  const grid = exportedGrid();
  const counts = {};
  grid.forEach((row, y) => [...row].forEach((code, x) => {
    const hp = Math.max(1, Number(state.thick?.[`${y},${x}`] || 1));
    counts[code] = (counts[code] || 0) + hp;
  }));
  snapshot();
  state.containers = buildContainers(counts);
  changed();
  toast("Containers izveidoti no režģa krāsu un thick HP skaita");
});

$("#clearContainersBtn").addEventListener("click", () => {
  if (!state.containers.length) return;
  snapshot();
  state.containers = [];
  changed();
  toast("Manuālie containers notīrīti — eksportā atkal izmantos automātisko sadali");
});

$("#mysteryEnabled").addEventListener("change", (event) => {
  snapshot();
  state.mystery = event.target.checked ? { proportion: 0.25, revealAt: "top", exclude: [] } : null;
  changed();
});
$("#mysteryProportion").addEventListener("input", (event) => {
  if (!state.mystery) return;
  $("#mysteryProportionOutput").textContent = `${Math.round(+event.target.value * 100)}%`;
});
$("#mysteryProportion").addEventListener("change", (event) => {
  if (!state.mystery) return;
  snapshot();
  state.mystery.proportion = +event.target.value;
  changed();
});
$("#mysteryRevealAt").addEventListener("change", (event) => {
  if (!state.mystery) return;
  snapshot();
  state.mystery.revealAt = event.target.value;
  changed();
});

$("#addThickBtn").addEventListener("click", () => {
  const used = new Set(Object.keys(state.thick || {}));
  let row = 0, col = 0;
  while (used.has(`${row},${col}`) && row < state.height) {
    col = (col + 1) % state.width;
    if (!col) row++;
  }
  if (row >= state.height) { toast("Visas režģa koordinātes jau izmantotas", true); return; }
  snapshot();
  state.thick ||= {};
  state.thick[`${row},${col}`] = 2;
  changed();
});

$("#addRegionBtn").addEventListener("click", () => {
  snapshot();
  state.regions ||= {};
  let number = Object.keys(state.regions).length + 1;
  let name = `region-${number}`;
  while (state.regions[name]) name = `region-${++number}`;
  state.regions[name] = [[0, 0]];
  changed();
});

$("#shuttersEnabled").addEventListener("change", (event) => {
  if (event.target.checked && !Object.keys(state.regions || {}).length) {
    event.target.checked = false;
    toast("Vispirms izveido vismaz vienu region", true);
    return;
  }
  snapshot();
  const names = Object.keys(state.regions || {});
  state.shutters = event.target.checked ? [{ covers: names[0], key: names[1] || names[0] }] : null;
  changed();
});
$("#shuttersCovers").addEventListener("change", event => {
  if (!state.shutters) return;
  snapshot(); state.shutters[0].covers = event.target.value; changed();
});
$("#shuttersKey").addEventListener("change", event => {
  if (!state.shutters) return;
  snapshot(); state.shutters[0].key = event.target.value; changed();
});

function openTileDialog(tile = null) {
  editingTileId = tile?.id || null;
  $("#tileDialogTitle").textContent = tile ? "Rediģēt flīzi" : "Pievienot flīzi";
  $("#deleteTileBtn").hidden = !tile;
  $("#tileName").value = tile?.name || "";
  $("#tileType").value = tile?.type || "solid";
  $("#tileColor").value = tile?.color || "#8b5cf6";
  $("#tileCode").value = tile?.code || nextAvailableCode();
  $("#tileSymbol").value = tile?.symbol || "";
  $("#tileDialog").showModal();
}
$("#addTileBtn").addEventListener("click", () => openTileDialog());
$("#removeUnusedTilesBtn").addEventListener("click", () => {
  const unusedTiles = getUnusedTiles();
  if (!unusedTiles.length) return;
  const message = unusedTiles.length === 1
    ? `Dzēst neizmantoto krāsu “${unusedTiles[0].name}”?`
    : `Dzēst ${unusedTiles.length} neizmantotās krāsas no flīžu paletes?`;
  if (!confirm(message)) return;

  snapshot();
  const unusedIds = new Set(unusedTiles.map(tile => tile.id));
  const unusedCodes = new Set(unusedTiles.map(tile => tile.code));
  state.tiles = state.tiles.filter(tile => !unusedIds.has(tile.id));
  state.containers = state.containers.filter(container => !unusedCodes.has(container.c));
  if (state.mystery) {
    state.mystery.exclude = state.mystery.exclude.filter(code => !unusedCodes.has(code));
  }
  if (unusedIds.has(selectedTile)) selectedTile = state.tiles[0]?.id;
  changed();
  toast(`Izdzēstas neizmantotās krāsas: ${unusedTiles.length}`);
});
$("#tileForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const name = $("#tileName").value.trim();
  if (!name) return;
  snapshot();
  const values = {
    name, type: $("#tileType").value, color: $("#tileColor").value,
    code: $("#tileCode").value.toUpperCase(),
    symbol: $("#tileSymbol").value.trim().slice(0, 2)
  };
  const duplicate = state.tiles.find(tile => tile.code === values.code && tile.id !== editingTileId);
  if (duplicate) {
    toast(`Kodu ${values.code} jau izmanto flīze “${duplicate.name}”`, true);
    return;
  }
  if (editingTileId) Object.assign(state.tiles.find(t => t.id === editingTileId), values);
  else {
    const id = `${name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "tile"}-${Date.now().toString(36)}`;
    state.tiles.push({ id, ...values }); selectedTile = id;
  }
  $("#tileDialog").close(); changed();
});

$("#deleteTileBtn").addEventListener("click", () => {
  const tile = state.tiles.find(item => item.id === editingTileId);
  if (!tile) return;
  const cellCount = state.layers.reduce((total, layer) => total + layer.cells.flat().filter(id => id === tile.id).length, 0);
  const message = cellCount
    ? `Dzēst flīzi “${tile.name}”? Tiks notīrītas arī ${cellCount} tās šūnas režģī.`
    : `Dzēst flīzi “${tile.name}”?`;
  if (!confirm(message)) return;
  snapshot();
  state.layers.forEach(layer => layer.cells.forEach(row => row.forEach((id, index) => {
    if (id === tile.id) row[index] = null;
  })));
  state.containers = state.containers.filter(container => container.c !== tile.code);
  if (state.mystery) state.mystery.exclude = state.mystery.exclude.filter(code => code !== tile.code);
  state.tiles = state.tiles.filter(item => item.id !== tile.id);
  selectedTile = state.tiles[0]?.id;
  editingTileId = null;
  $("#tileDialog").close();
  changed();
  toast(`Flīze “${tile.name}” dzēsta`);
});

function nextAvailableCode() {
  const used = new Set(state.tiles.map(tile => tile.code));
  return [...prismCodes].find(code => !used.has(code)) || "X";
}

$("#newBtn").addEventListener("click", () => {
  if (!confirm("Sākt jaunu JSON projektu? Tiks izdzēsti visi pašreizējā saraksta līmeņi.")) return;
  levelCollection = [makeInitialState()];
  activeLevelIndex = 0;
  importedCollection = false;
  state = clone(levelCollection[activeLevelIndex]);
  activeLayer = 0; selectedTile = state.tiles[0].id; history = []; future = [];
  changed(); fitCanvas();
});

$("#addLevelBtn").addEventListener("click", () => {
  levelCollection[activeLevelIndex] = clone(state);
  const next = makeInitialState();
  next.slot = Math.max(0, ...levelCollection.map(level => +level.slot || 0)) + 1;
  next.name = `Līmenis ${next.slot}`;
  levelCollection.push(next);
  activeLevelIndex = levelCollection.length - 1;
  state = clone(next);
  activeLayer = 0;
  selectedTile = state.tiles[0]?.id;
  history = [];
  future = [];
  changed();
  fitCanvas();
  toast(`Pievienots līmenis slotā ${next.slot}`);
});
$("#importBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", async (event) => {
  try {
    const text = await event.target.files[0].text();
    const parsed = JSON.parse(text);
    let source = parsed;
    if (Array.isArray(parsed?.levels) && parsed.levels.length) {
      const importedLevels = parsed.levels.map(normaliseLevel);
      let index = 0;
      if (importedLevels.length > 1) {
      const requested = prompt(`Failā ir ${parsed.levels.length} līmeņi. Ievadi importējamā līmeņa slotu:`, parsed.levels[0].slot);
      if (requested === null) return;
        index = Math.max(0, importedLevels.findIndex(level => String(level.slot) === requested.trim()));
      }
      levelCollection = importedLevels;
      activeLevelIndex = index;
      importedCollection = true;
      source = levelCollection[activeLevelIndex];
    }
    const imported = normaliseLevel(source);
    if (!Array.isArray(parsed?.levels)) {
      levelCollection = [imported];
      activeLevelIndex = 0;
      importedCollection = false;
    }
    state = clone(imported); activeLayer = 0; selectedTile = state.tiles[0]?.id; history = []; future = []; changed(); fitCanvas();
    toast("Līmenis veiksmīgi importēts");
  } catch (error) { toast(`Neizdevās importēt: ${error.message}`, true); }
  event.target.value = "";
});

$("#importImageBtn").addEventListener("click", () => $("#imageInput").click());
$("#imageInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  await openImageImport(file);
});

$("#generateImageBtn").addEventListener("click", () => {
  updateImageImportGridLabels();
  setPromptImageStatus("Ievadi Cloudflare Account ID un Workers AI API tokenu iestatījumos.");
  $("#promptImageDialog").showModal();
  $("#imagePrompt").focus();
});
$("#closePromptImage").addEventListener("click", closePromptImageDialog);
$("#cancelPromptImage").addEventListener("click", closePromptImageDialog);
$("#promptImageDialog").addEventListener("cancel", (event) => {
  if (promptImageGenerating) event.preventDefault();
});
$("#promptImageDialog").addEventListener("close", () => {
  $("#cloudflareApiToken").value = "";
});
$("#confirmPromptImage").addEventListener("click", generatePromptImage);
$("#imagePrompt").addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") generatePromptImage();
});

async function openImageImport(file) {
  if (!file.type.startsWith("image/")) {
    toast("Izvēlies PNG, JPG, WebP vai GIF attēlu", true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast("Attēls ir pārāk liels — maksimālais izmērs ir 20 MB", true);
    return;
  }
  try {
    updateImageImportGridLabels();
    pendingImageFile = file;
    pendingImage = await readImage(file);
    $("#imageFileName").textContent = file.name;
    $("#imageColorRange").value = imageColorCount;
    $("#imageColorOutput").textContent = imageColorCount;
    $("#imageConversionMode").value = "auto";
    $("#imageOptionsDialog").showModal();
    updateImageImportPreview();
  } catch (error) {
    pendingImageFile = null;
    pendingImage = null;
    toast(`Neizdevās nolasīt attēlu: ${error.message}`, true);
  }
}

async function generatePromptImage() {
  if (promptImageGenerating) return;
  const prompt = $("#imagePrompt").value.trim();
  const accountId = $("#cloudflareAccountId").value.trim();
  const apiToken = $("#cloudflareApiToken").value.trim();
  if (!prompt) {
    setPromptImageStatus("Ievadi attēla aprakstu.", "error");
    $("#imagePrompt").focus();
    return;
  }
  if (!accountId || !apiToken) {
    setPromptImageStatus("Ievadi gan Cloudflare Account ID, gan Workers AI API tokenu.", "error");
    (!accountId ? $("#cloudflareAccountId") : $("#cloudflareApiToken")).focus();
    return;
  }

  setPromptImageBusy(true);
  setPromptImageStatus("Attēls tiek ģenerēts… Tas var aizņemt aptuveni minūti.", "loading");
  try {
    const response = await fetch("/api/generate-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, accountId, apiToken })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Attēla ģenerēšana neizdevās (${response.status}).`);
    if (!payload.dataBase64) throw new Error("Servera atbildē nav attēla datu.");

    const file = base64ImageFile(
      payload.dataBase64,
      payload.mimeType || "image/png",
      `promta-limenis-${Date.now()}.jpg`
    );
    $("#promptImageDialog").close();
    await openImageImport(file);
  } catch (error) {
    setPromptImageStatus(error.message, "error");
    toast(`Neizdevās ģenerēt attēlu: ${error.message}`, true);
  } finally {
    setPromptImageBusy(false);
  }
}

function closePromptImageDialog() {
  if (!promptImageGenerating) $("#promptImageDialog").close();
}

function setPromptImageBusy(busy) {
  promptImageGenerating = busy;
  $("#confirmPromptImage").disabled = busy;
  $("#cancelPromptImage").disabled = busy;
  $("#closePromptImage").disabled = busy;
  $("#imagePrompt").disabled = busy;
  $("#cloudflareAccountId").disabled = busy;
  $("#cloudflareApiToken").disabled = busy;
}

function setPromptImageStatus(message, type = "") {
  const status = $("#promptImageStatus");
  status.textContent = message;
  status.className = `prompt-image-status${type ? ` is-${type}` : ""}`;
}

function base64ImageFile(dataBase64, mimeType, fileName) {
  const binary = atob(dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], fileName, { type: mimeType });
}

$("#imageColorRange").addEventListener("input", (event) => {
  imageColorCount = Math.max(2, Math.min(10, Math.trunc(+event.target.value || 8)));
  $("#imageColorOutput").textContent = imageColorCount;
  scheduleImagePreview();
});
$("#imageConversionMode").addEventListener("change", updateImageImportPreview);

$("#cancelImageImport").addEventListener("click", cancelImageImport);
$("#cancelImageImportSecondary").addEventListener("click", cancelImageImport);
$("#imageOptionsDialog").addEventListener("close", () => {
  pendingImageFile = null;
  pendingImage = null;
  pendingImageResult = null;
  clearTimeout(previewTimer);
});
$("#confirmImageImport").addEventListener("click", async () => {
  if (!pendingImageFile || !pendingImage) return;
  const file = pendingImageFile;
  const image = pendingImage;
  const mode = $("#imageConversionMode").value;
  const { width, height } = currentImageGridSize();
  const result = pendingImageResult || imageToLevel(image, width, height, imageColorCount, mode);
  pendingImageFile = null;
  pendingImage = null;
  pendingImageResult = null;
  $("#imageOptionsDialog").close();
  importImageResult(file, result);
});

function cancelImageImport() {
  pendingImageFile = null;
  pendingImage = null;
  pendingImageResult = null;
  $("#imageOptionsDialog").close();
}

function scheduleImagePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateImageImportPreview, 70);
}

function updateImageImportPreview() {
  if (!pendingImage) return;
  const mode = $("#imageConversionMode").value;
  const { width, height } = currentImageGridSize();
  pendingImageResult = imageToLevel(pendingImage, width, height, imageColorCount, mode);
  const preview = $("#imageImportPreview");
  const previewScale = 240 / Math.max(width, height);
  preview.width = Math.max(1, Math.round(width * previewScale));
  preview.height = Math.max(1, Math.round(height * previewScale));
  const context = preview.getContext("2d");
  const cellWidth = preview.width / width;
  const cellHeight = preview.height / height;
  context.fillStyle = pendingImageResult.background;
  context.fillRect(0, 0, preview.width, preview.height);
  pendingImageResult.cells.forEach((row, y) => row.forEach((tileId, x) => {
    const tile = pendingImageResult.tiles.find(item => item.id === tileId);
    context.fillStyle = tile?.color || pendingImageResult.background;
    context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
  }));
  context.strokeStyle = "#ffffff24";
  context.lineWidth = 1;
  for (let index = 0; index <= width; index++) {
    context.beginPath();
    context.moveTo(index * cellWidth, 0);
    context.lineTo(index * cellWidth, preview.height);
    context.stroke();
  }
  for (let index = 0; index <= height; index++) {
    context.beginPath();
    context.moveTo(0, index * cellHeight);
    context.lineTo(preview.width, index * cellHeight);
    context.stroke();
  }
}

function currentImageGridSize() {
  return { width: state.width, height: state.height, label: `${state.width} × ${state.height}` };
}

function updateImageImportGridLabels() {
  const { label } = currentImageGridSize();
  $("#promptImageGridSize").textContent = label;
  $("#imageGridPreviewLabel").textContent = `${label} priekšskatījums`;
  $("#confirmImageImport").textContent = `Izveidot ${label} režģi`;
}

function importImageResult(file, result) {
  try {
    snapshot();
    state.width = result.cells[0]?.length || state.width;
    state.height = result.cells.length || state.height;
    state.tiles = result.tiles;
    state.containers = [];
    state.layers = [{
      id: crypto.randomUUID(),
      name: `Attēls: ${file.name.replace(/\.[^.]+$/, "")}`,
      visible: true,
      cells: result.cells
    }];
    state.backgroundColor = result.background;
    activeLayer = 0;
    selectedTile = result.tiles[0].id;
    changed();
    fitCanvas();
    toast(`Attēls pārvērsts ${state.width} × ${state.height} režģī ar ${result.tiles.length} krāsām`);
  } catch (error) {
    toast(`Neizdevās apstrādāt attēlu: ${error.message}`, true);
  }
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("fails nav derīgs attēls")); };
    image.src = url;
  });
}

function imageToLevel(image, width, height, maxColours, mode = "auto") {
  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  const analysisScale = Math.min(1, 640 / Math.max(naturalWidth, naturalHeight));
  const analysisWidth = Math.max(1, Math.round(naturalWidth * analysisScale));
  const analysisHeight = Math.max(1, Math.round(naturalHeight * analysisScale));
  const analysis = document.createElement("canvas");
  analysis.width = analysisWidth;
  analysis.height = analysisHeight;
  const analysisContext = analysis.getContext("2d", { willReadFrequently: true });
  analysisContext.drawImage(image, 0, 0, analysisWidth, analysisHeight);
  const analysisPixels = analysisContext.getImageData(0, 0, analysisWidth, analysisHeight).data;
  const background = imageCornerColour(analysisPixels, analysisWidth, analysisHeight);
  const foreground = imageForegroundBounds(analysisPixels, analysisWidth, analysisHeight, background);
  const autoIsolated = foreground.width * foreground.height < analysisWidth * analysisHeight * 0.82;
  const isolatedSubject = mode === "object" || (mode === "auto" && autoIsolated);
  const preserveFullImage = mode === "full";
  const analysisCrop = preserveFullImage
    ? { x: 0, y: 0, width: analysisWidth, height: analysisHeight }
    : isolatedSubject
      ? foreground
      : imageSaliencyCrop(analysisPixels, analysisWidth, analysisHeight);
  const cropPixels = analysisContext.getImageData(
    Math.floor(analysisCrop.x),
    Math.floor(analysisCrop.y),
    Math.max(1, Math.floor(analysisCrop.width)),
    Math.max(1, Math.floor(analysisCrop.height))
  ).data;
  const palette = adaptiveImagePalette(cropPixels, maxColours);

  const sampleScale = 8;
  const rasterWidth = width * sampleScale;
  const rasterHeight = height * sampleScale;
  const source = document.createElement("canvas");
  source.width = rasterWidth;
  source.height = rasterHeight;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const crop = {
    x: analysisCrop.x * naturalWidth / analysisWidth,
    y: analysisCrop.y * naturalHeight / analysisHeight,
    width: analysisCrop.width * naturalWidth / analysisWidth,
    height: analysisCrop.height * naturalHeight / analysisHeight
  };
  if (isolatedSubject) {
    drawImageCropContain(sourceContext, image, crop, rasterWidth, rasterHeight, background);
  } else if (preserveFullImage) {
    drawImageCropContain(sourceContext, image, crop, rasterWidth, rasterHeight, background, false);
  } else {
    drawImageCropFill(sourceContext, image, crop, rasterWidth, rasterHeight);
  }
  const pixels = sourceContext.getImageData(0, 0, rasterWidth, rasterHeight).data;
  const tiles = palette.map((colour, index) => ({
    id: prismCodes[index],
    code: prismCodes[index],
    name: `Attēla krāsa ${prismCodes[index]}`,
    type: "decoration",
    color: rgbToHex(colour),
    symbol: "",
    flat: true
  }));
  const cells = rasterToGrid(
    pixels,
    rasterWidth,
    rasterHeight,
    width,
    height,
    palette,
    tiles,
    { isolatedSubject, background }
  );
  return { tiles, cells, background: rgbToHex(background) };
}

function drawImageCropContain(context, image, crop, width, height, background, withPadding = true) {
  context.fillStyle = rgbToHex(background);
  context.fillRect(0, 0, width, height);
  const padding = withPadding ? Math.max(0, Math.round(Math.min(width, height) / 24)) : 0;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  const scale = Math.min(availableWidth / crop.width, availableHeight / crop.height);
  const drawWidth = crop.width * scale;
  const drawHeight = crop.height * scale;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.x, crop.y, crop.width, crop.height,
    (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight
  );
}

function drawImageCropFill(context, image, crop, width, height) {
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
}

function rasterToGrid(pixels, rasterWidth, rasterHeight, gridWidth, gridHeight, palette, tiles, options) {
  const blockWidth = rasterWidth / gridWidth;
  const blockHeight = rasterHeight / gridHeight;
  const backgroundIndex = nearestColour(options.background.r, options.background.g, options.background.b, palette);
  const backgroundThreshold = 38 ** 2;
  return Array.from({ length: gridHeight }, (_, gridY) =>
    Array.from({ length: gridWidth }, (_, gridX) => {
      const counts = Array(palette.length).fill(0);
      const average = { r: 0, g: 0, b: 0, count: 0 };
      const foreground = { r: 0, g: 0, b: 0, count: 0 };
      const startX = Math.floor(gridX * blockWidth);
      const endX = Math.ceil((gridX + 1) * blockWidth);
      const startY = Math.floor(gridY * blockHeight);
      const endY = Math.ceil((gridY + 1) * blockHeight);
      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const offset = (y * rasterWidth + x) * 4;
          const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
          counts[nearestColour(r, g, b, palette)]++;
          average.r += r;
          average.g += g;
          average.b += b;
          average.count++;
          if (colourDistance({ r, g, b }, options.background) > backgroundThreshold) {
            foreground.r += r;
            foreground.g += g;
            foreground.b += b;
            foreground.count++;
          }
        }
      }
      if (options.isolatedSubject) {
        const coverage = foreground.count / average.count;
        if (coverage < 0.28) return tiles[backgroundIndex].id;
        const foregroundColour = {
          r: foreground.r / foreground.count,
          g: foreground.g / foreground.count,
          b: foreground.b / foreground.count
        };
        return tiles[nearestForegroundColour(foregroundColour, palette, backgroundIndex)].id;
      }
      const dominant = counts.indexOf(Math.max(...counts));
      const dominantShare = counts[dominant] / average.count;
      const selected = dominantShare >= 0.52
        ? dominant
        : nearestColour(average.r / average.count, average.g / average.count, average.b / average.count, palette);
      return tiles[selected].id;
    })
  );
}

function nearestForegroundColour(colour, palette, backgroundIndex) {
  if (palette.length === 1) return 0;
  let winner = backgroundIndex === 0 ? 1 : 0;
  let distance = Infinity;
  palette.forEach((candidate, index) => {
    if (index === backgroundIndex) return;
    const candidateDistance = colourDistance(colour, candidate);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      winner = index;
    }
  });
  return winner;
}

function imageCornerColour(pixels, width, height) {
  const points = [
    [0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]
  ];
  const sum = { r: 0, g: 0, b: 0 };
  points.forEach(([x, y]) => {
    const offset = (y * width + x) * 4;
    sum.r += pixels[offset];
    sum.g += pixels[offset + 1];
    sum.b += pixels[offset + 2];
  });
  return { r: Math.round(sum.r / points.length), g: Math.round(sum.g / points.length), b: Math.round(sum.b / points.length) };
}

function imageForegroundBounds(pixels, width, height, background) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  const threshold = 42 ** 2;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const colour = { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] };
      if (colourDistance(colour, background) <= threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return { x: 0, y: 0, width, height };

  const subjectWidth = maxX - minX + 1;
  const subjectHeight = maxY - minY + 1;
  const margin = Math.max(1, Math.round(Math.max(subjectWidth, subjectHeight) * 0.025));
  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  const right = Math.min(width, maxX + margin + 1);
  const bottom = Math.min(height, maxY + margin + 1);
  return { x, y, width: right - x, height: bottom - y };
}

function imageSaliencyCrop(pixels, width, height) {
  const size = Math.min(width, height);
  if (width === height) return { x: 0, y: 0, width, height };

  const vertical = width > height;
  const positions = vertical ? width : height;
  const saliency = Array(positions).fill(0);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 180));
  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const offset = (y * width + x) * 4;
      const right = (y * width + x + step) * 4;
      const below = ((y + step) * width + x) * 4;
      const colour = { r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] };
      const edge = Math.sqrt(colourDistance(colour, {
        r: pixels[right], g: pixels[right + 1], b: pixels[right + 2]
      })) + Math.sqrt(colourDistance(colour, {
        r: pixels[below], g: pixels[below + 1], b: pixels[below + 2]
      }));
      const maximum = Math.max(colour.r, colour.g, colour.b);
      const minimum = Math.min(colour.r, colour.g, colour.b);
      const saturation = maximum ? (maximum - minimum) / maximum : 0;
      saliency[vertical ? x : y] += edge + saturation * 30;
    }
  }

  const limit = positions - size;
  let bestStart = 0;
  let bestScore = -Infinity;
  for (let start = 0; start <= limit; start++) {
    let score = 0;
    for (let index = start; index < start + size; index++) score += saliency[index];
    const centreDistance = Math.abs(start + size / 2 - positions / 2) / Math.max(1, limit / 2);
    score *= 1.12 - Math.min(1, centreDistance) * 0.12;
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  return vertical
    ? { x: bestStart, y: 0, width: size, height: size }
    : { x: 0, y: bestStart, width: size, height: size };
}

function adaptiveImagePalette(pixels, maxColours) {
  const bins = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const entry = bins.get(key) || { r: 0, g: 0, b: 0, count: 0 };
    entry.r += r;
    entry.g += g;
    entry.b += b;
    entry.count++;
    bins.set(key, entry);
  }

  const colours = [...bins.values()].map(entry => ({
    r: entry.r / entry.count,
    g: entry.g / entry.count,
    b: entry.b / entry.count,
    count: entry.count
  })).sort((a, b) => b.count - a.count);
  const clusters = [];
  // Apvienojam tikai gandrīz identiskus JPEG trokšņa toņus. Lietotāja
  // izvēlētos starptoņus vairs nesaspiežam līdz divām pamatkrāsām.
  const mergeDistance = 22 ** 2;
  colours.forEach(colour => {
    let target = -1;
    let distance = Infinity;
    clusters.forEach((cluster, index) => {
      const candidate = colourDistance(colour, cluster);
      if (candidate < distance) { distance = candidate; target = index; }
    });
    if (target >= 0 && distance <= mergeDistance) {
      const cluster = clusters[target];
      const total = cluster.count + colour.count;
      cluster.r = (cluster.r * cluster.count + colour.r * colour.count) / total;
      cluster.g = (cluster.g * cluster.count + colour.g * colour.count) / total;
      cluster.b = (cluster.b * cluster.count + colour.b * colour.count) / total;
      cluster.count = total;
    } else {
      clusters.push({ ...colour });
    }
  });
  clusters.sort((a, b) => b.count - a.count);
  if (!clusters.length) return [{ r: 0, g: 0, b: 0 }];

  // Farthest-point atlase saglabā gan biežākās krāsas, gan vizuāli atšķirīgus
  // akcentus. Rezultātā izvēle "8" tiešām cenšas dot astoņu krāsu paleti.
  const selected = [clusters[0]];
  const candidates = clusters.slice(1);
  while (selected.length < maxColours && candidates.length) {
    let winner = 0;
    let winnerScore = -1;
    candidates.forEach((candidate, index) => {
      const separation = Math.min(...selected.map(colour => colourDistance(candidate, colour)));
      const frequencyWeight = 1 + Math.log2(candidate.count + 1) * 0.18;
      const score = separation * frequencyWeight;
      if (score > winnerScore) { winnerScore = score; winner = index; }
    });
    selected.push(candidates.splice(winner, 1)[0]);
  }
  return selected.map(cluster => nearestSourceColour(cluster, pixels));
}

function colourDistance(a, b) {
  return (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
}

function nearestSourceColour(target, pixels) {
  let result = { r: pixels[0], g: pixels[1], b: pixels[2] };
  let bestDistance = Infinity;
  for (let index = 0; index < pixels.length; index += 4) {
    const candidate = { r: pixels[index], g: pixels[index + 1], b: pixels[index + 2] };
    const distance = colourDistance(target, candidate);
    if (distance < bestDistance) {
      result = candidate;
      bestDistance = distance;
      if (!distance) break;
    }
  }
  return result;
}

function nearestColour(r, g, b, palette) {
  let winner = 0;
  let distance = Infinity;
  palette.forEach((colour, index) => {
    const candidate = (r - colour.r) ** 2 + (g - colour.g) ** 2 + (b - colour.b) ** 2;
    if (candidate < distance) { distance = candidate; winner = index; }
  });
  return winner;
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

$("#exportBtn").addEventListener("click", async () => {
  const button = $("#exportBtn");
  button.disabled = true;
  levelCollection[activeLevelIndex] = clone(state);
  toast("Notiek visu līmeņu pārbaude spēles simulatorā…");
  try {
    const simulations = await Promise.all(levelCollection.map(level => requestDifficultyReport(level, { fresh: true })));
    const report = validate(simulations[activeLevelIndex]);
    if (report.errors.length) {
      toast("Eksports bloķēts: līmenis neiztur publicēšanas vārtus", true);
      return;
    }
    const blockedSlots = levelCollection
      .filter((_, index) => index !== activeLevelIndex && !simulations[index].publishable)
      .map(level => level.slot);
    if (blockedSlots.length) {
      toast(`Eksports bloķēts: publicēšanas vārtus neiztur slots ${blockedSlots.join(", ")}`, true);
      return;
    }
    const exportData = buildPrismCollection();
    downloadJson(exportData, "all-levels.json");
    toast(report.warnings.length ? "JSON fails eksportēts ar validācijas brīdinājumiem" : "JSON fails eksportēts");
  } catch (error) {
    console.error("JSON export failed", error);
    toast(`Neizdevās pārbaudīt vai eksportēt: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  if (typeof navigator.msSaveOrOpenBlob === "function") {
    navigator.msSaveOrOpenBlob(blob, filename);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();

  // Pārlūkam jāsaņem iespēja sākt lejupielādi, pirms atbrīvojam Blob URL.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}

function buildPrismCollection() {
  levelCollection[activeLevelIndex] = clone(state);
  const levels = levelCollection.map(buildPrismLevel).sort((a, b) => a.slot - b.slot);
  return {
    game: "Prism Pop!",
    exported: new Date().toISOString().slice(0, 10),
    count: levels.length,
    levels
  };
}

function buildPrismLevel(levelState) {
  const palette = {};
  levelState.tiles.forEach(tile => { palette[tile.code] = tile.color.toUpperCase(); });
  if (!palette.K) palette.K = levelState.backgroundColor.toUpperCase();

  const grid = exportedGrid(levelState);
  const counts = {};
  grid.forEach(row => [...row].forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
  const containers = levelState.containers.length ? sortContainers(levelState.containers) : buildContainers(counts);
  return {
    slot: levelState.slot,
    name: levelState.name.trim() || "Untitled",
    tier: resolvedTier(levelState),
    source: levelState.source,
    grid,
    palette,
    containers,
    links: levelState.links ? clone(levelState.links) : [],
    mystery: exportMystery(levelState),
    thick: levelState.thick ? clone(levelState.thick) : null,
    regions: levelState.regions ? clone(levelState.regions) : null,
    shutters: levelState.shutters ? clone(levelState.shutters) : null,
    beltCap: levelState.beltCap,
    seed: levelState.seed,
    fillRule: "gravity"
  };
}

function exportedGrid(levelState = state) {
  return Array.from({ length: levelState.height }, (_, y) =>
    Array.from({ length: levelState.width }, (_, x) => {
      let tileId = null;
      levelState.layers.forEach(layer => {
        if (layer.visible && layer.cells[y][x]) tileId = layer.cells[y][x];
      });
      return levelState.tiles.find(tile => tile.id === tileId)?.code || "K";
    }).join("")
  );
}

function exportMystery(levelState = state) {
  if (!levelState.mystery) return null;
  const mystery = {
    proportion: levelState.mystery.proportion,
    revealAt: levelState.mystery.revealAt
  };
  const exclude = mysteryExclude(levelState.mystery);
  if (exclude.length) mystery.exclude = [...exclude];
  return mystery;
}

function mysteryExclude(mystery) {
  return Array.isArray(mystery?.exclude) ? mystery.exclude : [];
}

function sortContainers(containers) {
  return containers.map(container => ({ ...container })).sort((a, b) => a.col - b.col || a.r - b.r);
}

function buildContainers(counts) {
  // Vispirms sadala lielākās krāsu grupas. Režģa pirmās šūnas secība var būt
  // vizuāli nejauša un radīt neizspēlējamu container rindu, lai gan HP paritāte
  // ir pareiza.
  const queues = Object.entries(counts)
    .sort(([codeA, totalA], [codeB, totalB]) => totalB - totalA || codeA.localeCompare(codeB))
    .map(([code, total]) => ({
    code,
    chunks: splitCapacity(total)
    }));
  const ordered = [];
  while (queues.some(queue => queue.chunks.length)) {
    queues.forEach(queue => {
      const cap = queue.chunks.shift();
      if (cap) ordered.push({ c: queue.code, cap });
    });
  }
  const rows = [0, 0, 0, 0];
  return ordered.map((container, index) => {
    const col = index % 4;
    return { ...container, r: rows[col]++, col };
  });
}

function splitCapacity(total) {
  if (total <= 0) return [];
  const chunks = [];
  while (total > 8) {
    chunks.push(8);
    total -= 8;
  }
  if (total === 1 && chunks.length) {
    chunks[chunks.length - 1] -= 1;
    chunks.push(2);
  } else {
    chunks.push(total);
  }
  return chunks;
}

function validate(simulation = difficultyReport(state)) {
  const errors = [], warnings = [];
  const used = new Set(state.layers.flatMap(layer => layer.cells.flat()).filter(Boolean));
  if (!state.name.trim()) errors.push("Līmenim nav nosaukuma.");
  if (!used.size) errors.push("Līmenis ir tukšs.");
  // Prism Pop! līmeņa formātā nav atsevišķu spawn/goal lauku — to nevar
  // droši interpretēt no krāsas, tādēļ šeit pārbaudām tikai eksporta prasības.
  const codes = state.tiles.map(tile => tile.code);
  if (new Set(codes).size !== codes.length) errors.push("Flīžu JSON kodi nav unikāli.");
  if (codes.some(code => !/^[A-Z0-9]$/.test(code))) errors.push("Flīžu kodiem jābūt vienam lielajam burtam vai ciparam.");
  if (state.tiles.length > 10 || (state.tiles.length < 4 && !state.tiles.every(tile => tile.flat))) {
    warnings.push("Prism Pop! paletē ieteicamas 4–10 krāsas.");
  }
  if (state.mystery) {
    if (state.mystery.proportion <= 0 || state.mystery.proportion > 1) errors.push("Mystery proportion jābūt intervālā no 0 līdz 1.");
    const invalidMysteryCodes = mysteryExclude(state.mystery).filter(code => !codes.includes(code));
    if (invalidMysteryCodes.length) errors.push(`Mystery exclude izmanto nezināmu krāsu: ${invalidMysteryCodes.join(", ")}.`);
  }
  if (state.thick) {
    Object.entries(state.thick).forEach(([position, hp]) => {
      const [x, y] = position.split(",").map(Number);
      if (x >= state.height || y >= state.width) errors.push(`Thick koordināte ${position} ir ārpus režģa.`);
      if (hp < 1) errors.push(`Thick ${position} HP jābūt vismaz 1.`);
    });
  }
  if (state.regions) {
    Object.entries(state.regions).forEach(([name, cells]) => cells.forEach(([x, y]) => {
      if (x >= state.width || y >= state.height) errors.push(`Region ${name} koordināte ${x},${y} ir ārpus režģa.`);
    }));
  }
  if (state.shutters) {
    const names = new Set(Object.keys(state.regions || {}));
    state.shutters.forEach(shutter => {
      if (!names.has(shutter.covers) || !names.has(shutter.key)) {
        errors.push("Shutters covers un key jāatsaucas uz esošiem regions.");
      }
    });
  }
  if (state.containers.length) {
    const positions = new Set();
    state.containers.forEach(container => {
      if (!codes.includes(container.c)) errors.push(`Container izmanto nezināmu krāsu: ${container.c}.`);
      if (container.cap > state.beltCap) errors.push(`Container ${container.c} ietilpība (${container.cap}) pārsniedz beltCap (${state.beltCap}).`);
      const position = `${container.col}/${container.r}`;
      if (positions.has(position)) errors.push(`Divi containers atrodas pozīcijā ${position}.`);
      positions.add(position);
    });
    const gridCounts = {};
    const containerCounts = {};
    exportedGrid().forEach((row, y) => [...row].forEach((code, x) => {
      gridCounts[code] = (gridCounts[code] || 0) + Math.max(1, state.thick?.[`${y},${x}`] || 1);
    }));
    state.containers.forEach(container => { containerCounts[container.c] = (containerCounts[container.c] || 0) + container.cap; });
    const mismatches = [...new Set([...Object.keys(gridCounts), ...Object.keys(containerCounts)])]
      .filter(code => (gridCounts[code] || 0) !== (containerCounts[code] || 0));
    if (mismatches.length) warnings.push(`Container ietilpība nesakrīt ar režģi krāsām: ${mismatches.join(", ")}.`);
  }
  if (simulation) {
    simulation.structure.critical.forEach(message => {
      if (!errors.includes(message)) errors.push(message);
    });
    simulation.blockers.forEach(message => {
      if (!errors.includes(message)) errors.push(message);
    });
    simulation.structure.warnings.forEach(message => {
      if (!warnings.includes(message)) warnings.push(message);
    });
  } else {
    errors.push("Grūtības pārbaude spēles simulatorā vēl nav izpildīta.");
  }
  renderValidation(errors, warnings, simulation);
  return { errors, warnings, simulation };
}

function renderValidation(errors, warnings, simulation = null) {
  const root = $("#validation");
  const messages = errors.length ? errors : warnings;
  const strategyRows = Object.entries(simulation?.strategies || {}).map(([name, result]) =>
    `<tr><td>${escapeHtml(name === "random" ? "random fleet" : name)}</td><td>${result.wins}/${result.runs}</td><td>${result.moves ?? "—"}</td><td>${result.mistakes ?? "—"}</td><td>${result.blockedSituations ?? "—"}</td><td>${result.stable ? "jā" : "nē"}</td></tr>`
  ).join("");
  const mechanics = simulation?.structure?.mechanics;
  const structureSummary = simulation ? `<p class="simulation-structure">Krāsas: ${Object.keys(simulation.structure.colours || {}).length} · mazi/lieli trauki: ${simulation.structure.containerStructure?.small ?? 0}/${simulation.structure.containerStructure?.large ?? 0} · links: ${mechanics?.links.count ?? 0} · thick: ${mechanics?.thick.count ?? 0} · gold: ${mechanics?.gold.count ?? 0} · shutter: ${mechanics?.shutter.count ?? 0} · mystery: ${Math.round((mechanics?.mystery.proportion || 0) * 100)}%</p>` : "";
  const report = simulation ? `<details class="simulation-report">
    <summary>${escapeHtml(simulation.tier)} · spēles createSim · random ${Math.round(simulation.randomWinRate * 100)}% · ${simulation.publishable ? "publicējams" : "nav publicējams"}</summary>
    ${structureSummary}
    ${strategyRows ? `<table><thead><tr><th>Stratēģija</th><th>Uzvaras</th><th>Tiki</th><th>Kļūdas</th><th>Bloki</th><th>Stabila</th></tr></thead><tbody>${strategyRows}</tbody></table>` : ""}
    ${simulation.blockers.length ? `<p class="simulation-blockers">${escapeHtml(simulation.blockers.join(" "))}</p>` : ""}
  </details>` : "";
  root.classList.toggle("warning", !!messages.length);
  root.innerHTML = `<div><span class="check">${messages.length ? "!" : "✓"}</span><p><b>${errors.length ? "Jāizlabo kļūdas" : warnings.length ? "Ir brīdinājumi" : "Līmenis gatavs"}</b>
    <small>${messages.length ? escapeHtml(messages.join(" ")) : "JSON var eksportēt"}</small></p></div>${report}`;
}
$("#validateBtn").addEventListener("click", async () => {
  const button = $("#validateBtn");
  button.disabled = true;
  toast("Līmenis tiek izspēlēts ar spēles simulatoru…");
  try {
    const simulation = await requestDifficultyReport(state, { fresh: true });
    const previousTier = state.difficulty;
    state.difficulty = simulation.tier;
    changed(false);
    syncForm();
    const { errors, warnings } = validate(simulation);
    const outcome = errors.length ? `${errors.length} kļūda(s)` : warnings.length ? `${warnings.length} brīdinājums(i)` : "Pārbaude pabeigta — viss kārtībā";
    toast(`Spēles simulators piešķīra: ${simulation.tier}${previousTier === simulation.tier ? "" : ` (iepriekš: ${previousTier})`}. ${outcome}`, !!errors.length);
  } catch (error) {
    renderValidation([`Spēles simulatoru nevar palaist: ${error.message}`], []);
    toast(`Simulatora kļūda: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});

$("#previewBtn").addEventListener("click", () => {
  $("#previewTitle").textContent = state.name || "Līmenis";
  renderCanvas($("#previewCanvas"), true);
  $("#previewDialog").showModal();
});
$("#closePreview").addEventListener("click", () => $("#previewDialog").close());

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea, select") || $("dialog[open]")) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
  else if ((event.ctrlKey || event.metaKey) && key === "y") { event.preventDefault(); redo(); }
  else if ({ b: "brush", e: "eraser", f: "fill", i: "picker" }[key]) setTool({ b: "brush", e: "eraser", f: "fill", i: "picker" }[key]);
});

function slugify(text) {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function escapeHtml(text) {
  const div = document.createElement("div"); div.textContent = text; return div.innerHTML;
}
function escapeAttr(text) { return String(text).replace(/["'<>]/g, ""); }
let toastTimer;
function toast(message, danger = false) {
  const element = $("#toast"); element.textContent = message;
  element.style.background = danger ? "#ff6b35" : ""; element.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}

renderAll();
setTimeout(fitCanvas, 50);
window.PIXEL_LEVEL_TOOL = {
  getLevel: () => clone(state),
  getPrismExport: () => buildPrismCollection(),
  getDifficultyReport: () => clone(difficultyReport(state)),
  testDifficulty: () => requestDifficultyReport(state, { fresh: true }).then(clone),
  loadLevel: data => { state = normaliseLevel(data); renderAll(); }
};
