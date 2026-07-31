const STRATEGIES = ["casual", "careful", "patient", "drainer"];
const SKILLED = ["careful", "patient", "drainer"];

export function analyseDifficulty(level, options = {}) {
  const staticAnalysis = analyseLevelStructure(level);
  if (staticAnalysis.critical.length) {
    return makeReport("Broken", false, staticAnalysis, {}, [], 0, [
      ...staticAnalysis.critical
    ]);
  }

  const repeats = Math.max(3, options.repeats || 5);
  const randomRuns = Math.max(12, options.randomRuns || 32);
  const baseSeed = positiveInteger(level.seed, 19001);
  const strategies = {};

  for (const strategy of STRATEGIES) {
    const runs = Array.from({ length: repeats }, (_, index) =>
      simulateLevel(level, strategy, baseSeed + index * 7919)
    );
    strategies[strategy] = summariseRuns(runs);
  }

  const randomFleet = Array.from({ length: randomRuns }, (_, index) =>
    simulateLevel(level, "random", baseSeed + 100003 + index * 104729)
  );
  const randomSummary = summariseRuns(randomFleet);
  strategies.random = randomSummary;

  const skilledWins = SKILLED.filter(name => strategies[name].won);
  const unstable = STRATEGIES.some(name => {
    const rate = strategies[name].winRate;
    return rate > 0 && rate < 1;
  });
  const anyWin = Object.values(strategies).some(result => result.wins > 0);
  let tier;
  if (!anyWin) tier = "Unwinnable";
  else if (unstable) tier = "Fragile";
  else if (strategies.casual.won && randomSummary.winRate >= 0.30 && !staticAnalysis.publishBlockers.length) tier = "Easy";
  else if (strategies.casual.won) tier = "Medium";
  else if (skilledWins.length >= 2) tier = "Hard";
  else if (skilledWins.length === 1) tier = "Brutal";
  else tier = "Fragile";

  const blockers = [...staticAnalysis.publishBlockers];
  if (!skilledWins.length) blockers.push("Neviena no careful, patient vai drainer stratēģijām neuzvar.");
  if (unstable) blockers.push("Simulatora rezultāts atkārtojumos nav stabils.");
  if (tier === "Unwinnable") blockers.push("Simulatorā netika atrasts derīgs uzvaras ceļš.");
  if (tier === "Fragile") blockers.push("Līmenis ir pārāk nestabils publicēšanai.");

  return makeReport(
    tier,
    blockers.length === 0,
    staticAnalysis,
    strategies,
    skilledWins,
    randomSummary.winRate,
    [...new Set(blockers)]
  );
}

export function simulateLevel(level, strategy = "careful", seed = 19001) {
  const rng = mulberry32(positiveInteger(seed, 19001));
  const grid = level.grid.map(row => [...row]);
  const height = grid.length;
  const width = grid[0].length;
  const cells = new Map();
  const remainingByColour = {};
  const regionLookup = makeRegionLookup(level.regions);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colour = grid[y][x];
      // Prism Pop! native schema stores thick coordinates as row,column (r,c).
      const hp = Math.max(1, positiveInteger(level.thick?.[`${y},${x}`], 1));
      const cell = { x, y, colour, hp, alive: true, regions: regionLookup.get(`${x},${y}`) || [] };
      cells.set(`${x},${y}`, cell);
      remainingByColour[colour] = (remainingByColour[colour] || 0) + hp;
    }
  }

  const shutters = normaliseShutterList(level.shutters);
  const openedShutters = new Set();
  const queues = groupContainerQueues(level.containers);
  const pending = [];
  const picked = new Set();
  const linkLookup = makeLinkLookup(level.links, level.containers.length);
  let moves = 0;
  let mistakes = 0;
  let blockedSituations = 0;
  let peakBelt = 0;
  let lastProgressMove = 0;
  const maxMoves = Math.max(20, level.containers.length * 3);

  const isLocked = cell => shutters.some((shutter, index) =>
    !openedShutters.has(index) && cell.regions.includes(shutter.covers)
  );
  const exposed = () => {
    const result = [];
    for (let x = 0; x < width; x++) {
      for (let y = height - 1; y >= 0; y--) {
        const cell = cells.get(`${x},${y}`);
        if (!cell?.alive) continue;
        if (!isLocked(cell)) result.push(cell);
        break;
      }
    }
    return result;
  };
  const updateShutters = () => {
    shutters.forEach((shutter, index) => {
      if (openedShutters.has(index)) return;
      const keyAlive = [...cells.values()].some(cell => cell.alive && cell.regions.includes(shutter.key));
      if (!keyAlive) openedShutters.add(index);
    });
  };
  const drainBelt = () => {
    let hits = 0;
    let changed = true;
    while (changed) {
      changed = false;
      updateShutters();
      const targets = exposed();
      for (let index = 0; index < pending.length; index++) {
        const shot = pending[index];
        const target = targets.find(cell => cell.colour === shot.c);
        if (!target) continue;
        target.hp--;
        shot.remaining--;
        hits++;
        remainingByColour[target.colour]--;
        if (target.hp <= 0) target.alive = false;
        if (shot.remaining <= 0) pending.splice(index, 1);
        changed = true;
        break;
      }
    }
    return hits;
  };

  drainBelt();
  while (moves < maxMoves) {
    if (![...cells.values()].some(cell => cell.alive)) {
      return result(true, moves, mistakes, blockedSituations, peakBelt, "cleared");
    }
    const choices = frontChoices(queues, picked);
    if (!choices.length) break;
    const targetColours = new Set(exposed().map(cell => cell.colour));
    const scored = choices.map(choice => scoreChoice(
      choice, strategy, targetColours, remainingByColour, pending, level, rng
    ));
    scored.sort((a, b) => b.score - a.score || a.choice.col - b.choice.col);
    const selected = strategy === "random"
      ? scored[Math.floor(rng() * scored.length)].choice
      : scored[0].choice;

    const bundle = linkedBundle(selected.index, linkLookup, level.containers, queues, picked);
    if (!bundle.valid) {
      mistakes++;
      blockedSituations++;
      picked.add(selected.index);
      moves++;
      continue;
    }
    const before = [...cells.values()].reduce((sum, cell) => sum + (cell.alive ? cell.hp : 0), 0);
    bundle.items.forEach(item => {
      picked.add(item.index);
      pending.push({ c: item.container.c, remaining: item.container.cap });
    });
    moves++;
    const hits = drainBelt();
    const beltLoad = pending.reduce((sum, shot) => sum + shot.remaining, 0);
    peakBelt = Math.max(peakBelt, beltLoad);
    if (!hits) mistakes++;
    if (beltLoad > positiveInteger(level.beltCap, 24)) {
      return result(false, moves, mistakes + 1, blockedSituations + 1, peakBelt, "belt-overflow");
    }
    const after = [...cells.values()].reduce((sum, cell) => sum + (cell.alive ? cell.hp : 0), 0);
    if (after < before) lastProgressMove = moves;
    else blockedSituations++;
    if (moves - lastProgressMove > Math.max(8, queues.length * 2)) break;
  }

  drainBelt();
  const won = ![...cells.values()].some(cell => cell.alive) && !pending.length;
  return result(won, moves, mistakes, blockedSituations, peakBelt, won ? "cleared" : "deadlock");
}

export function analyseLevelStructure(level) {
  const critical = [];
  const publishBlockers = [];
  const warnings = [];
  if (!level || !Array.isArray(level.grid) || !level.grid.length || typeof level.grid[0] !== "string") {
    critical.push("Līmeņa režģis nav korekts vai ir tukšs.");
    return { critical, publishBlockers, warnings, colours: {}, groups: {}, maxContainerRun: 0 };
  }
  const width = level.grid[0].length;
  if (!width || level.grid.some(row => typeof row !== "string" || row.length !== width)) {
    critical.push("Režģa rindām nav vienāds garums.");
  }
  if (!level.palette || typeof level.palette !== "object") critical.push("Līmenim trūkst paletes.");

  const colours = {};
  const hpByColour = {};
  level.grid.forEach((row, y) => [...row].forEach((colour, x) => {
    colours[colour] = (colours[colour] || 0) + 1;
    const hp = level.thick?.[`${y},${x}`] ?? 1;
    if (!Number.isInteger(+hp) || +hp < 1) critical.push(`Nederīgs thick HP pozīcijā ${y},${x}.`);
    hpByColour[colour] = (hpByColour[colour] || 0) + Math.max(1, positiveInteger(hp, 1));
    if (level.palette && !level.palette[colour]) critical.push(`Režģa krāsai ${colour} nav paletes ieraksta.`);
  }));
  Object.entries(level.thick || {}).forEach(([position]) => {
    const match = /^(\d+),(\d+)$/.exec(position);
    if (!match || +match[1] >= level.grid.length || +match[2] >= width) {
      critical.push(`Thick koordināte ${position} ir ārpus režģa.`);
    }
  });
  if (level.mystery && (!Number.isFinite(+level.mystery.proportion) ||
      +level.mystery.proportion <= 0 || +level.mystery.proportion > 1)) {
    critical.push("Mystery proportion jābūt intervālā no 0 līdz 1.");
  }

  const containers = Array.isArray(level.containers) ? level.containers : [];
  if (!containers.length) critical.push("Līmenim nav trauku.");
  const capacityByColour = {};
  const positions = new Set();
  containers.forEach((container, index) => {
    if (!container || !Number.isInteger(+container.cap) || +container.cap < 1) {
      critical.push(`Traukam #${index + 1} ir nederīga ietilpība.`);
      return;
    }
    if (!Object.hasOwn(colours, container.c)) critical.push(`Trauks #${index + 1} izmanto trūkstošu krāsu ${container.c}.`);
    if (!Number.isInteger(+container.col) || +container.col < 0 || +container.col > 3 ||
        !Number.isInteger(+container.r) || +container.r < 0) {
      critical.push(`Traukam #${index + 1} ir neatļauta kolonna vai rindas pozīcija.`);
    }
    capacityByColour[container.c] = (capacityByColour[container.c] || 0) + +container.cap;
    const position = `${container.col}/${container.r}`;
    if (positions.has(position)) critical.push(`Vairāki trauki atrodas pozīcijā ${position}.`);
    positions.add(position);
  });
  [...new Set([...Object.keys(hpByColour), ...Object.keys(capacityByColour)])].forEach(colour => {
    if ((hpByColour[colour] || 0) !== (capacityByColour[colour] || 0)) {
      critical.push(`HP paritāte krāsai ${colour} nesakrīt: bumbiņām ${hpByColour[colour] || 0}, traukiem ${capacityByColour[colour] || 0}.`);
    }
  });

  const maxContainerRun = longestContainerRun(containers);
  const containerStructure = {
    total: containers.length,
    small: containers.filter(container => +container.cap <= 3).length,
    large: containers.filter(container => +container.cap >= 8).length,
    columns: groupContainerQueues(containers).map(queue => ({
      col: queue.col,
      depth: queue.items.length,
      colours: queue.items.map(item => item.container.c)
    }))
  };

  const regions = level.regions && typeof level.regions === "object" ? level.regions : {};
  Object.entries(regions).forEach(([name, coordinates]) => {
    if (!Array.isArray(coordinates) || !coordinates.length) {
      critical.push(`Reģions ${name} ir tukšs vai nekorekts.`);
      return;
    }
    coordinates.forEach(cell => {
      if (!Array.isArray(cell) || cell.length < 2 || !Number.isInteger(+cell[0]) || !Number.isInteger(+cell[1]) ||
          +cell[0] < 0 || +cell[1] < 0 || +cell[0] >= width || +cell[1] >= level.grid.length) {
        critical.push(`Reģionā ${name} ir koordināte ārpus režģa.`);
      }
    });
  });
  normaliseShutterList(level.shutters).forEach((shutter, index) => {
    if (!Array.isArray(regions[shutter.covers]) || !Array.isArray(regions[shutter.key])) {
      critical.push(`Shutter #${index + 1} atsaucas uz neesošu covers vai key reģionu.`);
      return;
    }
    const cover = new Set(regions[shutter.covers].map(cell => cell.join(",")));
    if (regions[shutter.key].some(cell => cover.has(cell.join(",")))) {
      publishBlockers.push(`Shutter #${index + 1} atslēga pārklājas ar aizsegto reģionu.`);
    }
    const keyColours = new Set(regions[shutter.key].map(([x, y]) => level.grid[y]?.[x]).filter(Boolean));
    const mysteryExclude = new Set(level.mystery?.exclude || []);
    if (level.mystery && [...keyColours].some(colour => !mysteryExclude.has(colour))) {
      warnings.push(`Shutter #${index + 1} atslēgas krāsu slēpj mystery, radot iespējami negodīgu slazdu.`);
    }
  });

  const links = Array.isArray(level.links) ? level.links : [];
  links.forEach((link, index) => {
    if (!Array.isArray(link?.members) || link.members.length < 2 ||
        link.members.some(member => !Number.isInteger(+member) || +member < 0 || +member >= containers.length)) {
      critical.push(`Links #${index + 1} satur nederīgus trauku indeksus.`);
    }
  });

  const groups = colourGroupAnalysis(level.grid);
  const paletteDistance = minimumPaletteDistance(level.palette || {}, Object.keys(colours));
  if (paletteDistance < 900) warnings.push("Dažas paletes krāsas ir grūti vizuāli atšķiramas.");
  const mechanics = {
    links: {
      count: links.length,
      impact: links.length ? "Samazina brīvi izvēlamo trauku skaitu un prasa saskaņotu kolonnu secību." : "Nav."
    },
    thick: {
      count: Object.keys(level.thick || {}).length,
      extraHp: Object.values(level.thick || {}).reduce((sum, hp) => sum + Math.max(0, +hp - 1), 0),
      impact: level.thick ? "Palielina nepieciešamo trāpījumu skaitu un HP paritātes risku." : "Nav."
    },
    gold: {
      count: countGoldCells(level),
      impact: countGoldCells(level) ? "Īpašie gold lauki tiek uzskaitīti atsevišķi; to palīdzība nav automātisks grūtības pieaugums." : "Nav."
    },
    shutter: {
      count: normaliseShutterList(level.shutters).length,
      impact: level.shutters ? "Aizsedz mērķus līdz atslēgas reģiona iztukšošanai." : "Nav."
    },
    mystery: {
      proportion: level.mystery?.proportion || 0,
      impact: level.mystery ? "Samazina uztveres un izvēļu paredzamību; atkārtojumi nosaka, vai rezultāts kļūst nestabils." : "Nav."
    }
  };
  return {
    critical: [...new Set(critical)],
    publishBlockers: [...new Set(publishBlockers)],
    warnings: [...new Set(warnings)],
    colours,
    hpByColour,
    capacityByColour,
    groups,
    containerStructure,
    mechanics,
    paletteDistance,
    maxContainerRun
  };
}

function countGoldCells(level) {
  if (Array.isArray(level.gold)) return level.gold.length;
  const goldCodes = new Set(Object.entries(level.palette || {}).filter(([, colour]) => {
    const rgb = parseHex(colour);
    return rgb && rgb[0] > 180 && rgb[1] > 120 && rgb[2] < 100;
  }).map(([code]) => code));
  return level.grid.reduce((sum, row) => sum + [...row].filter(code => goldCodes.has(code)).length, 0);
}

function scoreChoice(choice, strategy, targetColours, remaining, pending, level, rng) {
  const container = choice.container;
  const immediate = targetColours.has(container.c) ? Math.min(container.cap, remaining[container.c] || 0) : 0;
  const pendingSame = pending.filter(item => item.c === container.c).reduce((sum, item) => sum + item.remaining, 0);
  const colourLeft = remaining[container.c] || 0;
  const mysteryNoise = level.mystery && !level.mystery.exclude?.includes(container.c)
    ? (rng() - 0.5) * 12 * level.mystery.proportion
    : 0;
  let score;
  if (strategy === "careful") score = immediate * 5 - Math.max(0, container.cap - immediate) * 6 - pendingSame * 2 - choice.depth * 0.1;
  else if (strategy === "patient") score = immediate * 4 + (immediate >= container.cap ? 18 : 0) - Math.max(0, container.cap - immediate) * 8 - choice.depth * 0.05;
  else if (strategy === "drainer") score = immediate * 4 + (colourLeft ? 30 / colourLeft : 0) + pendingSame * 0.4 - choice.depth * 0.1;
  else score = immediate * 2 - Math.max(0, container.cap - immediate) * 1.5 - choice.depth * 0.05 + rng() * 5;
  return { choice, score: score + mysteryNoise };
}

function frontChoices(queues, picked) {
  const choices = [];
  queues.forEach(queue => {
    const item = queue.items.find(candidate => !picked.has(candidate.index));
    if (item) choices.push({ ...item, depth: queue.items.indexOf(item) });
  });
  return choices;
}

function linkedBundle(index, lookup, containers, queues, picked) {
  const members = lookup.get(index) || [index];
  const fronts = new Set(frontChoices(queues, picked).map(choice => choice.index));
  if (members.some(member => picked.has(member) || !fronts.has(member))) return { valid: false, items: [] };
  return {
    valid: true,
    items: members.map(member => ({ index: member, container: containers[member] }))
  };
}

function makeLinkLookup(links, count) {
  const lookup = new Map();
  (Array.isArray(links) ? links : []).forEach(link => {
    const members = [...new Set((link.members || []).map(Number).filter(value => value >= 0 && value < count))];
    members.forEach(member => lookup.set(member, members));
  });
  return lookup;
}

function groupContainerQueues(containers) {
  const columns = new Map();
  containers.forEach((container, index) => {
    if (!columns.has(container.col)) columns.set(container.col, []);
    columns.get(container.col).push({ container, index });
  });
  return [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([col, items]) => ({
    col,
    items: items.sort((a, b) => a.container.r - b.container.r)
  }));
}

function summariseRuns(runs) {
  const wins = runs.filter(run => run.won).length;
  const wonRuns = runs.filter(run => run.won);
  return {
    won: wins === runs.length,
    anyWin: wins > 0,
    wins,
    runs: runs.length,
    winRate: wins / runs.length,
    stable: wins === 0 || wins === runs.length,
    moves: wonRuns.length ? Math.round(wonRuns.reduce((sum, run) => sum + run.moves, 0) / wonRuns.length) : null,
    mistakes: average(runs.map(run => run.mistakes)),
    blockedSituations: average(runs.map(run => run.blockedSituations)),
    peakBelt: Math.max(...runs.map(run => run.peakBelt), 0),
    outcomes: runs
  };
}

function makeReport(tier, publishable, structure, strategies, skilledWins, randomWinRate, blockers) {
  return { tier, publishable, strategies, skilledWins, randomWinRate, blockers, structure };
}

function result(won, moves, mistakes, blockedSituations, peakBelt, reason) {
  return { won, moves, mistakes, blockedSituations, peakBelt, reason };
}

function normaliseShutterList(shutters) {
  if (!shutters) return [];
  return (Array.isArray(shutters) ? shutters : [shutters]).filter(item => item?.covers && item?.key);
}

function makeRegionLookup(regions) {
  const lookup = new Map();
  Object.entries(regions || {}).forEach(([name, coordinates]) => {
    (coordinates || []).forEach(([x, y]) => {
      const key = `${x},${y}`;
      lookup.set(key, [...(lookup.get(key) || []), name]);
    });
  });
  return lookup;
}

function longestContainerRun(containers) {
  let longest = 0;
  groupContainerQueues(containers).forEach(queue => {
    let previous = null;
    let run = 0;
    queue.items.forEach(({ container }) => {
      run = container.c === previous ? run + 1 : 1;
      previous = container.c;
      longest = Math.max(longest, run);
    });
  });
  return longest;
}

function colourGroupAnalysis(grid) {
  const height = grid.length;
  const width = grid[0]?.length || 0;
  const seen = new Set();
  const result = {};
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    const colour = grid[y][x];
    const queue = [[x, y]];
    seen.add(key);
    let size = 0;
    while (queue.length) {
      const [cx, cy] = queue.pop();
      size++;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const nx = cx + dx, ny = cy + dy, next = `${nx},${ny}`;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen.has(next) || grid[ny][nx] !== colour) return;
        seen.add(next);
        queue.push([nx, ny]);
      });
    }
    const data = result[colour] || { count: 0, largest: 0, sizes: [] };
    data.count++;
    data.largest = Math.max(data.largest, size);
    data.sizes.push(size);
    result[colour] = data;
  }
  return result;
}

function minimumPaletteDistance(palette, colours) {
  let minimum = Infinity;
  const rgb = colours.map(colour => parseHex(palette[colour])).filter(Boolean);
  for (let a = 0; a < rgb.length; a++) for (let b = a + 1; b < rgb.length; b++) {
    minimum = Math.min(minimum,
      (rgb[a][0] - rgb[b][0]) ** 2 + (rgb[a][1] - rgb[b][1]) ** 2 + (rgb[a][2] - rgb[b][2]) ** 2
    );
  }
  return minimum;
}

function parseHex(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(value || "");
  return match ? [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16)) : null;
}

function average(values) {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length) * 10) / 10;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(+value) && +value > 0 ? +value : fallback;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = seed + 0x6D2B79F5 | 0;
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
