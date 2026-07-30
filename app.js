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
  const width = 24, height = 16;
  const ground = blankCells(width, height);
  for (let y = 11; y < height; y++) {
    for (let x = 0; x < width; x++) ground[y][x] = y === 11 ? "grass" : "ground";
  }
  for (let x = 6; x < 11; x++) ground[8][x] = "stone";
  for (let x = 15; x < 20; x++) ground[6][x] = "stone";
  ground[10][2] = "spawn";
  ground[5][18] = "goal";
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
    width,
    height,
    tileSize: 32,
    backgroundColor: "#17151f",
    tiles: clone(defaultTiles),
    layers: [
      { id: crypto.randomUUID(), name: "Pamata slānis", visible: true, cells: ground },
      { id: crypto.randomUUID(), name: "Dekorācijas", visible: true, cells: blankCells(width, height) }
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
    return draft ? normaliseLevel(JSON.parse(draft)) : null;
  } catch { return null; }
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
    width, height, tileSize: Math.max(8, Math.min(256, +data.tileSize || 32)),
    backgroundColor: /^#[0-9a-f]{6}$/i.test(data.backgroundColor) ? data.backgroundColor : "#17151f",
    tiles, layers
  };
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
      context.fillStyle = shade(tile.color, -20);
      context.fillRect(px, py + size - Math.max(2, size * .11), size, Math.max(2, size * .11));
      context.fillStyle = shade(tile.color, 18);
      context.fillRect(px, py, size, Math.max(1, size * .07));
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
  renderCanvas();
  $("#canvasWrap").style.transform = `scale(${zoom})`;
  $("#zoomValue").textContent = `${Math.round(zoom * 100)}%`;
  $("#mapStats").textContent = `${state.width} × ${state.height} · ${state.width * state.height} flīzes`;
  updateHistoryButtons();
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
    const result = imageToLevel(image, state.width, state.height, imageColorCount);
    snapshot();
    state.tiles = result.tiles;
    state.layers = [{
      id: crypto.randomUUID(),
      name: `Attēls: ${file.name.replace(/\.[^.]+$/, "")}`,
      visible: true,
      cells: result.cells
    }];
    state.backgroundColor = result.tiles[0].color;
    activeLayer = 0;
    selectedTile = result.tiles[0].id;
    changed();
    fitCanvas();
    toast(`Attēls pārvērsts ${state.width} × ${state.height} režģī ar ${result.tiles.length} krāsām`);
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
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  sourceContext.fillStyle = "#262b44";
  sourceContext.fillRect(0, 0, width, height);
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.drawImage(image, 0, 0, width, height);
  const pixels = sourceContext.getImageData(0, 0, width, height).data;
  const palette = quantizePixels(pixels, maxColours);
  const tiles = palette.map((colour, index) => ({
    id: prismCodes[index],
    code: prismCodes[index],
    name: `Attēla krāsa ${prismCodes[index]}`,
    type: "decoration",
    color: rgbToHex(colour),
    symbol: ""
  }));
  const cells = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const offset = (y * width + x) * 4;
      return tiles[nearestColour(pixels[offset], pixels[offset + 1], pixels[offset + 2], palette)].id;
    })
  );
  return { tiles, cells };
}

function quantizePixels(pixels, maxColours) {
  const bins = new Map();
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] / 255;
    const r = Math.round((pixels[index] * alpha + 38 * (1 - alpha)) / 8) * 8;
    const g = Math.round((pixels[index + 1] * alpha + 43 * (1 - alpha)) / 8) * 8;
    const b = Math.round((pixels[index + 2] * alpha + 68 * (1 - alpha)) / 8) * 8;
    const key = `${Math.min(255, r)},${Math.min(255, g)},${Math.min(255, b)}`;
    const entry = bins.get(key) || { r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b), count: 0 };
    entry.count++;
    bins.set(key, entry);
  }
  let boxes = [[...bins.values()]];
  while (boxes.length < maxColours) {
    let target = -1;
    let bestScore = -1;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const score = colourBoxScore(box);
      if (score > bestScore) { bestScore = score; target = index; }
    });
    if (target < 0) break;
    const box = boxes[target];
    const channel = widestChannel(box);
    box.sort((a, b) => a[channel] - b[channel]);
    const half = box.reduce((total, colour) => total + colour.count, 0) / 2;
    let total = 0, split = 1;
    for (; split < box.length; split++) {
      total += box[split - 1].count;
      if (total >= half) break;
    }
    boxes.splice(target, 1, box.slice(0, split), box.slice(split));
  }
  return boxes.map(averageColour).sort((a, b) => b.count - a.count);
}

function colourBoxScore(box) {
  const ranges = ["r", "g", "b"].map(channel => Math.max(...box.map(c => c[channel])) - Math.min(...box.map(c => c[channel])));
  return Math.max(...ranges) * box.reduce((total, colour) => total + colour.count, 0);
}

function widestChannel(box) {
  return ["r", "g", "b"].reduce((best, channel) =>
    Math.max(...box.map(c => c[channel])) - Math.min(...box.map(c => c[channel])) >
    Math.max(...box.map(c => c[best])) - Math.min(...box.map(c => c[best])) ? channel : best, "r");
}

function averageColour(box) {
  const total = box.reduce((sum, colour) => sum + colour.count, 0);
  return ["r", "g", "b"].reduce((average, channel) => {
    average[channel] = Math.round(box.reduce((sum, colour) => sum + colour[channel] * colour.count, 0) / total);
    return average;
  }, { count: total });
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

  const grid = Array.from({ length: state.height }, (_, y) =>
    Array.from({ length: state.width }, (_, x) => {
      let tileId = null;
      state.layers.forEach(layer => {
        if (layer.visible && layer.cells[y][x]) tileId = layer.cells[y][x];
      });
      return state.tiles.find(tile => tile.id === tileId)?.code || "K";
    }).join("")
  );
  const counts = {};
  grid.forEach(row => [...row].forEach(code => { counts[code] = (counts[code] || 0) + 1; }));
  const containers = buildContainers(counts);
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
  const spawnCount = state.layers.reduce((n, layer) => n + layer.cells.flat().filter(id => state.tiles.find(t => t.id === id)?.type === "spawn").length, 0);
  const goalCount = state.layers.reduce((n, layer) => n + layer.cells.flat().filter(id => state.tiles.find(t => t.id === id)?.type === "goal").length, 0);
  if (!spawnCount) warnings.push("Nav ievietota spēlētāja starta flīze.");
  if (!goalCount) warnings.push("Nav ievietota mērķa flīze.");
  if (spawnCount > 1) warnings.push(`Atrastas ${spawnCount} starta flīzes.`);
  const codes = state.tiles.map(tile => tile.code);
  if (new Set(codes).size !== codes.length) errors.push("Flīžu JSON kodi nav unikāli.");
  if (codes.some(code => !/^[A-Z0-9]$/.test(code))) errors.push("Flīžu kodiem jābūt vienam lielajam burtam vai ciparam.");
  if (state.tiles.length < 4 || state.tiles.length > 10) warnings.push("Prism Pop! paletē ieteicamas 4–10 krāsas.");
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
