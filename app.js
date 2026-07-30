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
const imageGridSize = 12;

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
    difficulty: "Medium",
    slot: 19,
    source: "tool",
    beltCap: 24,
    seed: 19001,
    containers: [],
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

let state = loadDraft() || makeInitialState();
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

const canvas = $("#levelCanvas");
const ctx = canvas.getContext("2d");
const viewport = $("#canvasViewport");

function loadDraft() {
  try {
    const draft = localStorage.getItem("pixel-level-tool-draft");
    if (!draft) return null;
    const parsed = JSON.parse(draft);
    // Pirms 12 × 12 noklusējuma ieviešanas lietotne automātiski saglabāja
    // 24 × 16 demonstrācijas līmeni. To atpazīstam pēc precīzās sākuma formas
    // un migrējam, lai vecais paraugs vairs neizskatītos kā jaunais noklusējums.
    if (isLegacyStarterDraft(parsed)) {
      const migrated = makeInitialState();
      localStorage.setItem("pixel-level-tool-draft", JSON.stringify(migrated));
      return migrated;
    }
    return normaliseLevel(parsed);
  } catch { return null; }
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
  const sourceTiles = Array.isArray(data.tiles) && data.tiles.length ? data.tiles : clone(defaultTiles);
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
    slot: Math.max(1, Math.trunc(+data.slot || 19)),
    source: ["tool", "pushed", "builtin"].includes(data.source) ? data.source : "tool",
    beltCap: Math.max(1, Math.trunc(+data.beltCap || 24)),
    seed: Math.max(1, Math.trunc(+data.seed || 19001)),
    containers: normaliseContainers(data.containers),
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

function normaliseTier(value) {
  return ({ "Viegla": "Easy", "Vidēja": "Medium", "Grūta": "Hard", "Ekstrēma": "Brutal" })[value] ||
    (["Easy", "Medium", "Hard", "Brutal"].includes(value) ? value : "Medium");
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
  localStorage.setItem("pixel-level-tool-draft", JSON.stringify(state));
  $("#saveState").textContent = "Saglabāts lokāli";
  $("#saveState").style.color = "";
}

let saveTimer;
function changed(render = true) {
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
  $("#imageColorCount").value = imageColorCount;
  $("#author").value = state.author;
  $("#description").value = state.description;
  $("#difficulty").value = state.difficulty;
  $("#slot").value = state.slot;
  $("#source").value = state.source;
  $("#beltCap").value = state.beltCap;
  $("#seed").value = state.seed;
}

function renderPalette() {
  const palette = $("#palette");
  palette.replaceChildren();
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
  renderCanvas();
  $("#canvasWrap").style.transform = `scale(${zoom})`;
  $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`;
  $("#mapStats").textContent = `${state.width} × ${state.height} · ${state.width * state.height} flīzes`;
  updateHistoryButtons();
}

function renderContainers() {
  const root = $("#containers");
  root.replaceChildren();
  if (!state.containers.length) {
    root.innerHTML = '<p class="containers-empty">Nav manuālu containers — eksports tos izveidos automātiski.</p>';
    return;
  }
  state.containers.forEach((container, index) => {
    const row = document.createElement("div");
    row.className = "container-row";
    const options = state.tiles.map(tile => `<option value="${tile.code}"${tile.code === container.c ? " selected" : ""}>${tile.code}</option>`).join("");
    row.innerHTML = `<label>Krāsa<select data-field="c">${options}</select></label>
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
$("#imageColorCount").addEventListener("change", (event) => {
  imageColorCount = Math.max(4, Math.min(10, Math.trunc(+event.target.value || 8)));
  event.target.value = imageColorCount;
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
  grid.forEach(row => [...row].forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
  snapshot();
  state.containers = buildContainers(counts);
  changed();
  toast("Containers izveidoti no režģa krāsu skaita");
});

$("#clearContainersBtn").addEventListener("click", () => {
  if (!state.containers.length) return;
  snapshot();
  state.containers = [];
  changed();
  toast("Manuālie containers notīrīti — eksportā atkal izmantos automātisko sadali");
});

function openTileDialog(tile = null) {
  editingTileId = tile?.id || null;
  $("#tileDialogTitle").textContent = tile ? "Rediģēt flīzi" : "Pievienot flīzi";
  $("#tileName").value = tile?.name || "";
  $("#tileType").value = tile?.type || "solid";
  $("#tileColor").value = tile?.color || "#8b5cf6";
  $("#tileCode").value = tile?.code || nextAvailableCode();
  $("#tileSymbol").value = tile?.symbol || "";
  $("#tileDialog").showModal();
}
$("#addTileBtn").addEventListener("click", () => openTileDialog());
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

function nextAvailableCode() {
  const used = new Set(state.tiles.map(tile => tile.code));
  return [...prismCodes].find(code => !used.has(code)) || "X";
}

$("#newBtn").addEventListener("click", () => {
  if (!confirm("Izveidot jaunu līmeni? Pašreizējais melnraksts tiks aizvietots.")) return;
  snapshot(); state = makeInitialState(); activeLayer = 0; selectedTile = state.tiles[0].id; changed(); fitCanvas();
});
$("#importBtn").addEventListener("click", () => $("#fileInput").click());
$("#fileInput").addEventListener("change", async (event) => {
  try {
    const text = await event.target.files[0].text();
    const parsed = JSON.parse(text);
    let source = parsed;
    if (Array.isArray(parsed?.levels) && parsed.levels.length > 1) {
      const requested = prompt(`Failā ir ${parsed.levels.length} līmeņi. Ievadi importējamā līmeņa slotu:`, parsed.levels[0].slot);
      if (requested === null) return;
      source = parsed.levels.find(level => String(level.slot) === requested.trim()) || parsed.levels[0];
    }
    const imported = normaliseLevel(source);
    snapshot(); state = imported; activeLayer = 0; selectedTile = state.tiles[0]?.id; changed(); fitCanvas();
    toast("Līmenis veiksmīgi importēts");
  } catch (error) { toast(`Neizdevās importēt: ${error.message}`, true); }
  event.target.value = "";
});

$("#importImageBtn").addEventListener("click", () => $("#imageInput").click());
$("#imageInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Izvēlies PNG, JPG, WebP vai GIF attēlu", true);
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    toast("Attēls ir pārāk liels — maksimālais izmērs ir 20 MB", true);
    return;
  }
  try {
    const image = await readImage(file);
    const result = imageToLevel(image, imageGridSize, imageGridSize, imageColorCount);
    snapshot();
    state.width = imageGridSize;
    state.height = imageGridSize;
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
    toast(`Attēls pārvērsts 12 × 12 režģī ar ${result.tiles.length} krāsām`);
  } catch (error) {
    toast(`Neizdevās apstrādāt attēlu: ${error.message}`, true);
  }
});

function readImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("fails nav derīgs attēls")); };
    image.src = url;
  });
}

function imageToLevel(image, width, height, maxColours) {
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
  const isolatedSubject = foreground.width * foreground.height < analysisWidth * analysisHeight * 0.82;
  const analysisCrop = isolatedSubject
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
  const cells = rasterToGrid(pixels, rasterWidth, rasterHeight, width, height, palette, tiles);
  return { tiles, cells, background: rgbToHex(background) };
}

function drawImageCropContain(context, image, crop, width, height, background) {
  context.fillStyle = rgbToHex(background);
  context.fillRect(0, 0, width, height);
  const padding = Math.max(0, Math.round(Math.min(width, height) / 12));
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

function rasterToGrid(pixels, rasterWidth, rasterHeight, gridWidth, gridHeight, palette, tiles) {
  const blockWidth = rasterWidth / gridWidth;
  const blockHeight = rasterHeight / gridHeight;
  return Array.from({ length: gridHeight }, (_, gridY) =>
    Array.from({ length: gridWidth }, (_, gridX) => {
      const counts = Array(palette.length).fill(0);
      const average = { r: 0, g: 0, b: 0, count: 0 };
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
        }
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
  const mergeDistance = 58 ** 2;
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
  const totalPixels = pixels.length / 4;
  const twoColourCoverage = ((clusters[0]?.count || 0) + (clusters[1]?.count || 0)) / totalPixels;
  const paletteSize = twoColourCoverage >= 0.92 ? Math.min(2, clusters.length) : Math.min(maxColours, clusters.length);
  return clusters.slice(0, Math.max(1, paletteSize)).map(cluster => nearestSourceColour(cluster, pixels));
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

$("#exportBtn").addEventListener("click", () => {
  const report = validate();
  if (report.errors.length && !confirm(`${report.errors.join("\n")}\n\nVai tomēr eksportēt?`)) return;
  const exportData = buildPrismCollection();
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "all-levels.json";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("JSON fails eksportēts");
});

function buildPrismCollection() {
  const palette = {};
  state.tiles.forEach(tile => { palette[tile.code] = tile.color.toUpperCase(); });
  if (!palette.K) palette.K = state.backgroundColor.toUpperCase();

  const grid = exportedGrid();
  const counts = {};
  grid.forEach(row => [...row].forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
  const containers = state.containers.length ? sortContainers(state.containers) : buildContainers(counts);
  const level = {
    slot: state.slot,
    name: state.name.trim() || "Untitled",
    tier: state.difficulty,
    source: state.source,
    grid,
    palette,
    containers,
    links: [],
    mystery: null,
    thick: null,
    regions: null,
    shutters: null,
    beltCap: state.beltCap,
    seed: state.seed,
    fillRule: "gravity"
  };
  return {
    game: "Prism Pop!",
    exported: new Date().toISOString().slice(0, 10),
    count: 1,
    levels: [level]
  };
}

function exportedGrid() {
  return Array.from({ length: state.height }, (_, y) =>
    Array.from({ length: state.width }, (_, x) => {
      let tileId = null;
      state.layers.forEach(layer => {
        if (layer.visible && layer.cells[y][x]) tileId = layer.cells[y][x];
      });
      return state.tiles.find(tile => tile.id === tileId)?.code || "K";
    }).join("")
  );
}

function sortContainers(containers) {
  return containers.map(container => ({ ...container })).sort((a, b) => a.col - b.col || a.r - b.r);
}

function buildContainers(counts) {
  const queues = Object.entries(counts).map(([code, total]) => ({
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

function validate() {
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
    exportedGrid().forEach(row => [...row].forEach(code => { gridCounts[code] = (gridCounts[code] || 0) + 1; }));
    state.containers.forEach(container => { containerCounts[container.c] = (containerCounts[container.c] || 0) + container.cap; });
    const mismatches = new Set([...Object.keys(gridCounts), ...Object.keys(containerCounts)]).filter(code => (gridCounts[code] || 0) !== (containerCounts[code] || 0));
    if (mismatches.length) warnings.push(`Container ietilpība nesakrīt ar režģi krāsām: ${mismatches.join(", ")}.`);
  }
  renderValidation(errors, warnings);
  return { errors, warnings };
}

function renderValidation(errors, warnings) {
  const root = $("#validation");
  const messages = errors.length ? errors : warnings;
  root.classList.toggle("warning", !!messages.length);
  root.innerHTML = `<div><span class="check">${messages.length ? "!" : "✓"}</span><p><b>${errors.length ? "Jāizlabo kļūdas" : warnings.length ? "Ir brīdinājumi" : "Līmenis gatavs"}</b>
    <small>${messages.length ? escapeHtml(messages.join(" ")) : "JSON var eksportēt"}</small></p></div>`;
}
$("#validateBtn").addEventListener("click", () => {
  const { errors, warnings } = validate();
  toast(errors.length ? `${errors.length} kļūda(s)` : warnings.length ? `${warnings.length} brīdinājums(i)` : "Pārbaude pabeigta — viss kārtībā", !!errors.length);
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
  loadLevel: data => { state = normaliseLevel(data); renderAll(); }
};
