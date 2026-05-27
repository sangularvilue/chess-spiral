// ============================================================
// Chess Spiral — Ulam-style iterative piece placement
// Incremental attack-count map + per-color free-bitset search.
// ============================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 30;

// --- Spiral capacity (grows on demand) --------------------------------------
// The spiral starts at this size and doubles whenever placement runs out of
// free squares. Only the host's memory bounds growth.
let MAX_SPIRAL = 65536;
let MAX_X = Math.ceil(Math.sqrt(MAX_SPIRAL) / 2) + 2;
let LUT_SIDE = 2 * MAX_X + 1;
let WORD_COUNT = MAX_SPIRAL >>> 5;

let spiralX = new Int16Array(MAX_SPIRAL);
let spiralY = new Int16Array(MAX_SPIRAL);
let spiralIndexLUT = new Int32Array(LUT_SIDE * LUT_SIDE); // 0 = not in spiral

// Resumable spiral walker — state persists across grows.
const SPIRAL_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const spiralWalker = { x: 0, y: 0, count: 1, dirIdx: 0, p: 0, i: 0, stepSize: 1 };
spiralX[0] = 0; spiralY[0] = 0;
spiralIndexLUT[MAX_X * LUT_SIDE + MAX_X] = 1;

function advanceSpiralTo(target) {
  const sw = spiralWalker;
  while (sw.count < target) {
    const dx = SPIRAL_DIRS[sw.dirIdx][0];
    const dy = SPIRAL_DIRS[sw.dirIdx][1];
    sw.x += dx; sw.y += dy;
    const idx = sw.count;
    spiralX[idx] = sw.x;
    spiralY[idx] = sw.y;
    spiralIndexLUT[(sw.x + MAX_X) * LUT_SIDE + (sw.y + MAX_X)] = idx + 1;
    sw.count++;
    sw.i++;
    if (sw.i >= sw.stepSize) {
      sw.i = 0;
      sw.dirIdx = (sw.dirIdx + 1) % 4;
      sw.p++;
      if (sw.p >= 2) {
        sw.p = 0;
        sw.stepSize++;
      }
    }
  }
}
advanceSpiralTo(MAX_SPIRAL);

// Doubles the spiral and rebuilds the (x,y) LUT under a new MAX_X.
// Boards lazy-sync their per-square buffers via _syncIfNeeded on next op.
// Returns false if the host can't allocate the new buffers.
function growSpiral() {
  const newMaxSpiral = MAX_SPIRAL * 2;
  const newMaxX = Math.ceil(Math.sqrt(newMaxSpiral) / 2) + 2;
  const newLutSide = 2 * newMaxX + 1;
  let newSpiralX, newSpiralY, newLUT;
  try {
    newSpiralX = new Int16Array(newMaxSpiral);
    newSpiralY = new Int16Array(newMaxSpiral);
    newLUT = new Int32Array(newLutSide * newLutSide);
  } catch (e) {
    return false;
  }
  newSpiralX.set(spiralX);
  newSpiralY.set(spiralY);
  for (let i = 0; i < spiralWalker.count; i++) {
    newLUT[(newSpiralX[i] + newMaxX) * newLutSide + (newSpiralY[i] + newMaxX)] = i + 1;
  }
  spiralX = newSpiralX;
  spiralY = newSpiralY;
  spiralIndexLUT = newLUT;
  MAX_X = newMaxX;
  LUT_SIDE = newLutSide;
  MAX_SPIRAL = newMaxSpiral;
  WORD_COUNT = MAX_SPIRAL >>> 5;
  advanceSpiralTo(MAX_SPIRAL);
  return true;
}

function spiralIndexAt(x, y) {
  if (x < -MAX_X || x > MAX_X || y < -MAX_X || y > MAX_X) return 0;
  return spiralIndexLUT[(x + MAX_X) * LUT_SIDE + (y + MAX_X)];
}

// Is (px,py) on the ray from (sx,sy) in direction (dx,dy)? Returns positive
// step count k such that (px,py) = (sx + k*dx, sy + k*dy), or null.
function onRay(sx, sy, dx, dy, px, py) {
  const rdx = px - sx, rdy = py - sy;
  if (dx === 0) {
    if (rdx !== 0 || dy === 0) return null;
    if (rdy % dy !== 0) return null;
    const k = rdy / dy;
    return k > 0 ? k : null;
  }
  if (rdx % dx !== 0) return null;
  const k = rdx / dx;
  if (k <= 0) return null;
  if (rdy !== k * dy) return null;
  return k;
}

// ---------------- Piece catalog -----------------------------
// leapers: one-shot attack offsets (knight, king, pawn, etc.)
// rays:    direction vectors for sliders. Each ray walks (sx+k*dx, sy+k*dy)
//          for k=1,2,... until a blocker or until off-spiral.
const KNIGHT_LEAPERS = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
const KING_LEAPERS   = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
const BISHOP_RAYS    = [[1,1],[1,-1],[-1,-1],[-1,1]];
const ROOK_RAYS      = [[1,0],[0,1],[-1,0],[0,-1]];
const QUEEN_RAYS     = BISHOP_RAYS.concat(ROOK_RAYS);
const NIGHTRIDER_RAYS = KNIGHT_LEAPERS.slice();

const PIECES = {
  pawn:       { name:'Pawn',       symbol:'♟', glyphKind:'standard', category:'standard', leapers:[[-1,1],[1,1]],          rays:[] },
  knight:     { name:'Knight',     symbol:'♞', glyphKind:'standard', category:'standard', leapers:KNIGHT_LEAPERS,           rays:[] },
  bishop:     { name:'Bishop',     symbol:'♝', glyphKind:'standard', category:'standard', leapers:[],                       rays:BISHOP_RAYS },
  rook:       { name:'Rook',       symbol:'♜', glyphKind:'standard', category:'standard', leapers:[],                       rays:ROOK_RAYS },
  queen:      { name:'Queen',      symbol:'♛', glyphKind:'standard', category:'standard', leapers:[],                       rays:QUEEN_RAYS },
  king:       { name:'King',       symbol:'♚', glyphKind:'standard', category:'standard', leapers:KING_LEAPERS,             rays:[] },

  archbishop: { name:'Archbishop', symbol:'AB',glyphKind:'code',     category:'compound', leapers:KNIGHT_LEAPERS,           rays:BISHOP_RAYS },
  chancellor: { name:'Chancellor', symbol:'CH',glyphKind:'code',     category:'compound', leapers:KNIGHT_LEAPERS,           rays:ROOK_RAYS },
  amazon:     { name:'Amazon',     symbol:'AM',glyphKind:'code',     category:'compound', leapers:KNIGHT_LEAPERS,           rays:QUEEN_RAYS },

  wazir:      { name:'Wazir',      symbol:'W', glyphKind:'code',     category:'leaper',   leapers:[[1,0],[-1,0],[0,1],[0,-1]], rays:[] },
  ferz:       { name:'Ferz',       symbol:'F', glyphKind:'code',     category:'leaper',   leapers:[[1,1],[1,-1],[-1,-1],[-1,1]], rays:[] },
  dabbabah:   { name:'Dabbabah',   symbol:'D', glyphKind:'code',     category:'leaper',   leapers:[[2,0],[-2,0],[0,2],[0,-2]], rays:[] },
  alfil:      { name:'Alfil',      symbol:'AL',glyphKind:'code',     category:'leaper',   leapers:[[2,2],[2,-2],[-2,-2],[-2,2]], rays:[] },
  camel:      { name:'Camel',      symbol:'CM',glyphKind:'code',     category:'leaper',   leapers:[[1,3],[3,1],[3,-1],[1,-3],[-1,-3],[-3,-1],[-3,1],[-1,3]], rays:[] },
  zebra:      { name:'Zebra',      symbol:'ZB',glyphKind:'code',     category:'leaper',   leapers:[[2,3],[3,2],[3,-2],[2,-3],[-2,-3],[-3,-2],[-3,2],[-2,3]], rays:[] },
  giraffe:    { name:'Giraffe',    symbol:'GR',glyphKind:'code',     category:'leaper',   leapers:[[1,4],[4,1],[4,-1],[1,-4],[-1,-4],[-4,-1],[-4,1],[-1,4]], rays:[] },

  nightrider: { name:'Nightrider', symbol:'NR',glyphKind:'code',     category:'rider',    leapers:[],                       rays:NIGHTRIDER_RAYS },
};

function pieceAttacksSquareLazy(def, dx, dy) {
  // Used by the tooltip preview only (no board state, no blocking).
  for (let i = 0; i < def.leapers.length; i++) {
    if (def.leapers[i][0] === dx && def.leapers[i][1] === dy) return true;
  }
  for (let i = 0; i < def.rays.length; i++) {
    const k = onRay(0, 0, def.rays[i][0], def.rays[i][1], dx, dy);
    if (k !== null && k > 0) return true;
  }
  return false;
}

// ---------------- Colors ------------------------------------
const PRESET_COLORS = [
  { id:'white',  name:'White',  value:'#f5f5f7' },
  { id:'red',    name:'Red',    value:'#ef4444' },
  { id:'blue',   name:'Blue',   value:'#3b82f6' },
  { id:'green',  name:'Green',  value:'#22c55e' },
  { id:'purple', name:'Purple', value:'#a855f7' },
  { id:'yellow', name:'Yellow', value:'#facc15' },
  { id:'cyan',   name:'Cyan',   value:'#06b6d4' },
  { id:'orange', name:'Orange', value:'#f97316' },
  { id:'pink',   name:'Pink',   value:'#ec4899' },
  { id:'black',  name:'Black',  value:'#374151' },
];
const COLOR_BY_ID = Object.fromEntries(PRESET_COLORS.map(c => [c.id, c]));
const COLOR_IDS = PRESET_COLORS.map(c => c.id);

// ---------------- Board (bitset / incremental) --------------
class Board {
  constructor() {
    this.pieces = [];
    this.sliders = [];
    this.occupied = new Uint32Array(WORD_COUNT);
    this.attackCount = {}; // colorId -> Uint16Array(MAX_SPIRAL)
    this.free = {};        // colorId -> Uint32Array(WORD_COUNT)
    for (const id of COLOR_IDS) {
      this.attackCount[id] = new Uint16Array(MAX_SPIRAL);
      this.free[id] = new Uint32Array(WORD_COUNT);
      this.free[id].fill(0xFFFFFFFF);
    }
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0;
    this.countByColor = {}; // colorId -> int
    for (const id of COLOR_IDS) this.countByColor[id] = 0;
  }

  reset() {
    this.pieces.length = 0;
    this.sliders.length = 0;
    this.occupied = new Uint32Array(WORD_COUNT);
    for (const id of COLOR_IDS) {
      this.attackCount[id] = new Uint16Array(MAX_SPIRAL);
      this.free[id] = new Uint32Array(WORD_COUNT);
      this.free[id].fill(0xFFFFFFFF);
      this.countByColor[id] = 0;
    }
    this.minX = 0; this.maxX = 0; this.minY = 0; this.maxY = 0;
  }

  // Grow per-square buffers to match the current MAX_SPIRAL/WORD_COUNT, and
  // extend any slider rays that previously ran off the (smaller) spiral edge.
  _syncIfNeeded() {
    if (this.occupied.length === WORD_COUNT) return;
    const oldWordCount = this.occupied.length;
    const newOccupied = new Uint32Array(WORD_COUNT);
    newOccupied.set(this.occupied);
    this.occupied = newOccupied;
    for (const id of COLOR_IDS) {
      const newAttack = new Uint16Array(MAX_SPIRAL);
      newAttack.set(this.attackCount[id]);
      this.attackCount[id] = newAttack;
      const newFree = new Uint32Array(WORD_COUNT);
      newFree.set(this.free[id]);
      for (let w = oldWordCount; w < WORD_COUNT; w++) newFree[w] = 0xFFFFFFFF;
      this.free[id] = newFree;
    }
    const sliders = this.sliders;
    for (let si = 0; si < sliders.length; si++) {
      const S = sliders[si];
      const Srays = S._rays;
      for (let r = 0; r < Srays.length; r++) {
        const ray = Srays[r];
        if (ray.blockerDist !== Infinity) continue;
        let step = ray.lastDist + 1;
        while (true) {
          const tx = S.x + step * ray.dx, ty = S.y + step * ray.dy;
          const tIdx = spiralIndexAt(tx, ty);
          if (tIdx === 0) break;
          this._incrementAttack(tIdx, S.colorId);
          ray.lastDist = step;
          const tPos = tIdx - 1;
          if ((this.occupied[tPos >>> 5] & (1 << (tPos & 31))) !== 0) {
            ray.blockerDist = step;
            break;
          }
          step++;
        }
      }
    }

    // Retry leaper attacks that previously fell off-spiral. Now that the spiral
    // has grown, some of those target squares are reachable and must be marked
    // — otherwise an enemy can land in a square the piece truly attacks.
    const all = this.pieces;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (!p._pendingLeapers || p._pendingLeapers.length === 0) continue;
      const leapers = PIECES[p.type].leapers;
      const still = [];
      for (let j = 0; j < p._pendingLeapers.length; j++) {
        const li = p._pendingLeapers[j];
        const tIdx = spiralIndexAt(p.x + leapers[li][0], p.y + leapers[li][1]);
        if (tIdx !== 0) this._incrementAttack(tIdx, p.colorId);
        else still.push(li);
      }
      p._pendingLeapers = still.length > 0 ? still : null;
    }
  }

  hasPieceAt(x, y) {
    const idx = spiralIndexAt(x, y);
    if (idx === 0) return false;
    const pos = idx - 1;
    return (this.occupied[pos >>> 5] & (1 << (pos & 31))) !== 0;
  }

  findFirstFree(colorId) {
    const bs = this.free[colorId];
    for (let w = 0; w < WORD_COUNT; w++) {
      const word = bs[w];
      if (word !== 0) {
        const lowBit = word & -word;
        const bitPos = 31 - Math.clz32(lowBit);
        return w * 32 + bitPos + 1; // 1-indexed
      }
    }
    return 0;
  }

  _incrementAttack(targetIdx, attackerColorId) {
    const pos = targetIdx - 1;
    const word = pos >>> 5;
    const bit = 1 << (pos & 31);
    for (let ci = 0; ci < COLOR_IDS.length; ci++) {
      const id = COLOR_IDS[ci];
      if (id === attackerColorId) continue;
      const arr = this.attackCount[id];
      if (arr[pos] === 0) this.free[id][word] &= ~bit;
      arr[pos]++;
    }
  }

  _decrementAttack(targetIdx, attackerColorId) {
    const pos = targetIdx - 1;
    const word = pos >>> 5;
    const bit = 1 << (pos & 31);
    const isOccupied = (this.occupied[word] & bit) !== 0;
    for (let ci = 0; ci < COLOR_IDS.length; ci++) {
      const id = COLOR_IDS[ci];
      if (id === attackerColorId) continue;
      const arr = this.attackCount[id];
      arr[pos]--;
      if (arr[pos] === 0 && !isOccupied) this.free[id][word] |= bit;
    }
  }

  placeNext(type, colorId) {
    this._syncIfNeeded();
    let targetIdx = this.findFirstFree(colorId);
    while (targetIdx === 0) {
      if (!growSpiral()) return null;
      this._syncIfNeeded();
      targetIdx = this.findFirstFree(colorId);
    }
    const pos = targetIdx - 1;
    const x = spiralX[pos], y = spiralY[pos];
    const word = pos >>> 5;
    const bit = 1 << (pos & 31);

    const piece = { type, colorId, x, y, squareNum: targetIdx, _rays: null };

    // Occupy.
    this.occupied[word] |= bit;
    for (let ci = 0; ci < COLOR_IDS.length; ci++) {
      this.free[COLOR_IDS[ci]][word] &= ~bit;
    }

    // bbox.
    if (this.pieces.length === 0) {
      this.minX = x; this.maxX = x; this.minY = y; this.maxY = y;
    } else {
      if (x < this.minX) this.minX = x; else if (x > this.maxX) this.maxX = x;
      if (y < this.minY) this.minY = y; else if (y > this.maxY) this.maxY = y;
    }

    // Re-block existing sliders that pass through (x,y).
    const sliders = this.sliders;
    for (let si = 0; si < sliders.length; si++) {
      const S = sliders[si];
      const Srays = S._rays;
      for (let r = 0; r < Srays.length; r++) {
        const ray = Srays[r];
        if (ray.blockerDist === 0) continue;
        const k = onRay(S.x, S.y, ray.dx, ray.dy, x, y);
        if (k === null || k >= ray.blockerDist) continue;
        // New closer blocker — decrement attacks for k+1 .. lastDist.
        for (let step = k + 1; step <= ray.lastDist; step++) {
          const sIdx = spiralIndexAt(S.x + step * ray.dx, S.y + step * ray.dy);
          if (sIdx !== 0) this._decrementAttack(sIdx, S.colorId);
        }
        ray.blockerDist = k;
        ray.lastDist = k;
      }
    }

    // Mark new attacks from this piece.
    const def = PIECES[type];
    const leapers = def.leapers;
    for (let i = 0; i < leapers.length; i++) {
      const tIdx = spiralIndexAt(x + leapers[i][0], y + leapers[i][1]);
      if (tIdx !== 0) {
        this._incrementAttack(tIdx, colorId);
      } else {
        // Off-spiral right now; remember so we can mark it after a growSpiral().
        if (!piece._pendingLeapers) piece._pendingLeapers = [];
        piece._pendingLeapers.push(i);
      }
    }

    const rays = def.rays;
    if (rays.length > 0) {
      const pieceRays = new Array(rays.length);
      for (let i = 0; i < rays.length; i++) {
        const dx = rays[i][0], dy = rays[i][1];
        let blockerDist = Infinity, lastDist = 0, step = 1;
        while (true) {
          const tx = x + step * dx, ty = y + step * dy;
          const tIdx = spiralIndexAt(tx, ty);
          if (tIdx === 0) break; // off-spiral
          this._incrementAttack(tIdx, colorId);
          lastDist = step;
          const tPos = tIdx - 1;
          if ((this.occupied[tPos >>> 5] & (1 << (tPos & 31))) !== 0) {
            blockerDist = step;
            break;
          }
          step++;
        }
        pieceRays[i] = { dx, dy, blockerDist, lastDist };
      }
      piece._rays = pieceRays;
      this.sliders.push(piece);
    }

    this.pieces.push(piece);
    this.countByColor[colorId]++;
    return piece;
  }
}

// ---------------- State -------------------------------------
const state = {
  activeColorId: 'white',
  sequence: [],
  board: new Board(),
  sequenceIndex: 0,
  running: false,
  totalPieces: 200,
  totalDuration: 30,
  doublingTime: 10,
  rateType: 'linear',
  displayMode: 'pieces',
  showNumbers: true,
  startTime: 0,
  pausedAt: 0,
  pausedAccum: 0,
  raf: null,
  lastBboxKey: '',
  lastUIUpdate: 0,
};

// ---------------- SVG / view --------------------------------
let svgEl, cellsLayer, piecesLayer;
let renderedBounds = null;
const cellRectByKey = new Map();
const claimedByKey = new Map();
const pieceElByKey = new Map();

const view = {
  cur: { x: 0, y: 0, w: 0, h: 0 },
  tgt: { x: 0, y: 0, w: 0, h: 0 },
  raf: null,
  interactive: false,
  pan: null,
};

function applyViewBox() {
  svgEl.setAttribute('viewBox', `${view.cur.x} ${view.cur.y} ${view.cur.w} ${view.cur.h}`);
}

function setupSvg() {
  svgEl = document.getElementById('board');
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);
  cellsLayer = document.createElementNS(SVG_NS, 'g');
  cellsLayer.setAttribute('class', 'cells');
  piecesLayer = document.createElementNS(SVG_NS, 'g');
  piecesLayer.setAttribute('class', 'pieces');
  svgEl.appendChild(cellsLayer);
  svgEl.appendChild(piecesLayer);
  svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svgEl.classList.toggle('hide-numbers', !state.showNumbers);
  svgEl.classList.toggle('mode-fill', state.displayMode === 'fill');

  renderedBounds = null;
  cellRectByKey.clear();
  claimedByKey.clear();
  pieceElByKey.clear();

  const start = fitWorldBoxToAspect(-1, 1, -1, 1);
  view.cur = { ...start };
  view.tgt = { ...start };
  applyViewBox();

  ensureCellsForView(view.cur);
}

function fitWorldBoxToAspect(minX, maxX, minY, maxY) {
  let vbX = minX * CELL;
  let vbY = -maxY * CELL - CELL;
  let vbW = (maxX - minX + 1) * CELL;
  let vbH = (maxY - minY + 1) * CELL;
  const rect = svgEl.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    const svgAspect = rect.width / rect.height;
    const vbAspect = vbW / vbH;
    if (vbAspect > svgAspect) {
      const newH = vbW / svgAspect;
      vbY -= (newH - vbH) / 2;
      vbH = newH;
    } else {
      const newW = vbH * svgAspect;
      vbX -= (newW - vbW) / 2;
      vbW = newW;
    }
  }
  return { x: vbX, y: vbY, w: vbW, h: vbH };
}

function computeFitTarget() {
  let minX = -1, maxX = 1, minY = -1, maxY = 1;
  if (state.board.pieces.length > 0) {
    if (state.board.minX < minX) minX = state.board.minX;
    if (state.board.maxX > maxX) maxX = state.board.maxX;
    if (state.board.minY < minY) minY = state.board.minY;
    if (state.board.maxY > maxY) maxY = state.board.maxY;
  }
  return fitWorldBoxToAspect(minX - 1, maxX + 1, minY - 1, maxY + 1);
}

function setTargetFit() {
  view.tgt = computeFitTarget();
  startViewAnim();
}
function startViewAnim() {
  if (view.raf) return;
  view.raf = requestAnimationFrame(tickView);
}
function tickView() {
  view.raf = null;
  const t = 0.1;
  let totalDelta = 0;
  for (const k of ['x','y','w','h']) {
    const d = view.tgt[k] - view.cur[k];
    view.cur[k] += d * t;
    totalDelta += Math.abs(d);
  }
  applyViewBox();
  if (totalDelta > 0.4) view.raf = requestAnimationFrame(tickView);
  else { view.cur = { ...view.tgt }; applyViewBox(); }
}

function ensureCellsForView(vb) {
  const minWorldX = Math.floor(vb.x / CELL) - 1;
  const maxWorldX = Math.ceil((vb.x + vb.w) / CELL) + 1;
  const minWorldY = Math.floor(-(vb.y + vb.h) / CELL) - 1;
  const maxWorldY = Math.ceil(-vb.y / CELL) + 1;
  ensureCellCoverage(minWorldX, maxWorldX, minWorldY, maxWorldY);
}

function ensureCellCoverage(minX, maxX, minY, maxY) {
  if (!renderedBounds) {
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++) drawCell(x, y);
    renderedBounds = { minX, maxX, minY, maxY };
    return;
  }
  const rb = renderedBounds;
  const nMinX = Math.min(rb.minX, minX);
  const nMaxX = Math.max(rb.maxX, maxX);
  const nMinY = Math.min(rb.minY, minY);
  const nMaxY = Math.max(rb.maxY, maxY);
  if (nMinX === rb.minX && nMaxX === rb.maxX && nMinY === rb.minY && nMaxY === rb.maxY) return;
  for (let x = nMinX; x <= nMaxX; x++) {
    for (let y = nMinY; y <= nMaxY; y++) {
      if (x >= rb.minX && x <= rb.maxX && y >= rb.minY && y <= rb.maxY) continue;
      drawCell(x, y);
    }
  }
  renderedBounds = { minX: nMinX, maxX: nMaxX, minY: nMinY, maxY: nMaxY };
}

function drawCell(x, y) {
  const num = spiralIndexAt(x, y);
  const key = x + ',' + y;
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', x * CELL);
  rect.setAttribute('y', -y * CELL - CELL);
  rect.setAttribute('width', CELL);
  rect.setAttribute('height', CELL);
  rect.setAttribute('class', 'cell' + (num === 1 ? ' center' : ''));
  cellsLayer.appendChild(rect);
  cellRectByKey.set(key, rect);
  const claimColor = claimedByKey.get(key);
  if (claimColor && state.displayMode === 'fill') {
    // Inline style overrides the .cell CSS rule (presentation attribute does not).
    rect.style.fill = COLOR_BY_ID[claimColor].value;
  }
  if (num !== 0) {
    const t = document.createElementNS(SVG_NS, 'text');
    t.setAttribute('x', x * CELL + CELL - 2);
    t.setAttribute('y', -y * CELL - CELL + 1.5);
    t.setAttribute('class', 'cell-num');
    t.textContent = num;
    cellsLayer.appendChild(t);
  }
}

function drawPieceElement(p, animate) {
  const def = PIECES[p.type];
  const color = COLOR_BY_ID[p.colorId] || PRESET_COLORS[0];
  const t = document.createElementNS(SVG_NS, 'text');
  t.setAttribute('x', p.x * CELL + CELL / 2);
  t.setAttribute('y', -p.y * CELL - CELL / 2);
  t.setAttribute('fill', color.value);
  let cls = 'piece-glyph ' + def.glyphKind;
  if (animate) cls += ' piece-just-placed';
  t.setAttribute('class', cls);
  t.textContent = def.symbol;
  if (isDarkColor(color.value)) {
    t.setAttribute('stroke', 'rgba(255,255,255,0.25)');
    t.setAttribute('stroke-width', '0.4');
    t.setAttribute('paint-order', 'stroke');
  }
  piecesLayer.appendChild(t);
  pieceElByKey.set(p.x + ',' + p.y, t);
}

function claimCell(piece) {
  const key = piece.x + ',' + piece.y;
  claimedByKey.set(key, piece.colorId);
  if (state.displayMode === 'fill') {
    const rect = cellRectByKey.get(key);
    if (rect) rect.style.fill = COLOR_BY_ID[piece.colorId].value;
  }
}

function applyDisplayMode() {
  if (!svgEl) return;
  svgEl.classList.toggle('mode-fill', state.displayMode === 'fill');
  for (const [key, colorId] of claimedByKey) {
    const rect = cellRectByKey.get(key);
    if (!rect) continue;
    if (state.displayMode === 'fill') {
      rect.style.fill = COLOR_BY_ID[colorId].value;
    } else {
      rect.style.fill = '';
    }
  }
}

function isDarkColor(hex) {
  const m = hex.replace('#','');
  if (m.length !== 6) return false;
  const r = parseInt(m.slice(0,2),16), g = parseInt(m.slice(2,4),16), b = parseInt(m.slice(4,6),16);
  return (0.299*r + 0.587*g + 0.114*b) < 90;
}

// ---------------- Placement (rAF, throttled UI) -------------
// Each rate type uses exactly one timing parameter:
//   linear / quadratic  → totalDuration (totalPieces placed by t = totalDuration)
//   exponential         → doublingTime  (totalPieces placed by t = d·log2(N+1))
// The unused parameter has no effect on this rate type.
function targetCountAt(elapsedMs) {
  const N = state.totalPieces;
  if (elapsedMs <= 0) return 0;
  if (state.rateType === 'exponential') {
    const d = state.doublingTime * 1000;
    const v = Math.pow(2, elapsedMs / d) - 1;
    return Math.min(N, Math.max(0, Math.floor(v)));
  }
  const T = state.totalDuration * 1000;
  if (elapsedMs >= T) return N;
  if (state.rateType === 'quadratic') {
    const r = elapsedMs / T;
    return Math.floor(N * r * r);
  }
  return Math.floor(N * elapsedMs / T);
}

// Inverse of targetCountAt: time at which piece n (1-indexed) should appear.
function timeForPiece(n) {
  const T = state.totalDuration * 1000;
  const N = state.totalPieces;
  if (state.rateType === 'exponential') {
    const d = state.doublingTime * 1000;
    return d * Math.log2(n + 1);
  }
  if (state.rateType === 'quadratic') {
    return T * Math.sqrt(n / N);
  }
  return T * n / N;
}

function placeOnePiece() {
  if (state.sequence.length === 0) { setStatus('Sequence is empty.'); return null; }
  const entry = state.sequence[state.sequenceIndex];
  state.sequenceIndex = (state.sequenceIndex + 1) % state.sequence.length;
  const def = PIECES[entry.pieceType];
  const color = COLOR_BY_ID[entry.colorId];
  if (!color) return true;
  const piece = state.board.placeNext(entry.pieceType, entry.colorId);
  if (!piece) {
    setStatus(`No valid square for ${def.name} (${color.name}). Stopping.`);
    return null;
  }
  ensureCellCoverage(piece.x - 1, piece.x + 1, piece.y - 1, piece.y + 1);
  drawPieceElement(piece, true);
  claimCell(piece);
  return true;
}

function placementTick() {
  if (!state.running) return;
  state.raf = null;

  const elapsed = performance.now() - state.startTime - state.pausedAccum;
  const target = Math.min(state.totalPieces, targetCountAt(elapsed));
  const MAX_PER_FRAME = 256;
  let count = 0;
  while (state.board.pieces.length < target && count < MAX_PER_FRAME) {
    const ok = placeOnePiece();
    if (ok === null) { onPlacementComplete(true); return; }
    if (ok === false) break;
    count++;
  }

  if (count > 0) {
    const b = state.board;
    const bboxKey = b.minX + ',' + b.maxX + ',' + b.minY + ',' + b.maxY;
    if (bboxKey !== state.lastBboxKey) {
      state.lastBboxKey = bboxKey;
      setTargetFit();
      ensureCellsForView(view.tgt);
    }
    const now = performance.now();
    if (now - state.lastUIUpdate > 100) {
      state.lastUIUpdate = now;
      renderSequence();
      renderLegend();
      renderStatsPanel();
      setStatus(`#${state.board.pieces.length}/${state.totalPieces} · ${(elapsed/1000).toFixed(1)}s`);
    }
  }

  if (state.board.pieces.length >= state.totalPieces) {
    onPlacementComplete(false);
    return;
  }
  state.raf = requestAnimationFrame(placementTick);
}

function startPlacement() {
  if (state.running) return;
  if (state.sequence.length === 0) { setStatus('Add at least one piece to the sequence.'); return; }
  if (state.board.pieces.length >= state.totalPieces) {
    setStatus('Total already reached. Reset or raise the total.'); return;
  }
  setInteractive(false);
  state.running = true;
  if (state.pausedAt > 0) {
    state.pausedAccum += performance.now() - state.pausedAt;
    state.pausedAt = 0;
  } else if (state.startTime === 0) {
    state.startTime = performance.now();
    state.pausedAccum = 0;
  }
  state.lastUIUpdate = 0;
  state.raf = requestAnimationFrame(placementTick);
  renderSequence();
}

function stopPlacement() {
  if (!state.running) return;
  state.running = false;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  state.pausedAt = performance.now();
  renderSequence();
  renderLegend();
  renderStatsPanel();
}

function onPlacementComplete(aborted) {
  state.running = false;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  state.pausedAt = 0;
  if (!aborted) setStatus(`Done. Placed ${state.board.pieces.length} pieces. Drag to pan, scroll to zoom.`);
  if (state.board.pieces.length > 0) {
    const b = state.board;
    const padW = Math.max(4, Math.ceil((b.maxX - b.minX) * 0.5));
    const padH = Math.max(4, Math.ceil((b.maxY - b.minY) * 0.5));
    ensureCellCoverage(b.minX - padW, b.maxX + padW, b.minY - padH, b.maxY + padH);
  }
  setInteractive(true);
  renderSequence();
  renderLegend();
  renderStatsPanel();
}

function resetAll() {
  state.running = false;
  if (state.raf) { cancelAnimationFrame(state.raf); state.raf = null; }
  state.board.reset();
  state.sequenceIndex = 0;
  state.startTime = 0;
  state.pausedAt = 0;
  state.pausedAccum = 0;
  state.lastBboxKey = '';
  setStatus('');
  setupSvg();
  setInteractive(false);
  renderSequence();
  renderLegend();
  renderStatsPanel();
}

// ---------------- Pan / zoom --------------------------------
function setInteractive(on) {
  view.interactive = on;
  if (svgEl) svgEl.style.cursor = on ? 'grab' : 'default';
}
function onPointerDown(e) {
  if (!view.interactive) return;
  if (e.button !== undefined && e.button !== 0) return;
  view.pan = { cx: e.clientX, cy: e.clientY, vx: view.cur.x, vy: view.cur.y };
  svgEl.style.cursor = 'grabbing';
  if (view.raf) { cancelAnimationFrame(view.raf); view.raf = null; }
  try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
}
function onPointerMove(e) {
  if (!view.pan) return;
  const rect = svgEl.getBoundingClientRect();
  if (rect.width === 0) return;
  const dx = (e.clientX - view.pan.cx) / rect.width * view.cur.w;
  const dy = (e.clientY - view.pan.cy) / rect.height * view.cur.h;
  view.cur.x = view.pan.vx - dx;
  view.cur.y = view.pan.vy - dy;
  view.tgt = { ...view.cur };
  applyViewBox();
}
function onPointerUp(e) {
  if (!view.pan) return;
  view.pan = null;
  svgEl.style.cursor = view.interactive ? 'grab' : 'default';
  try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}
  ensureCellsForView(view.cur);
}
function onWheel(e) {
  if (!view.interactive) return;
  e.preventDefault();
  const rect = svgEl.getBoundingClientRect();
  if (rect.width === 0) return;
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const fx = mx / rect.width, fy = my / rect.height;
  const wx = view.cur.x + fx * view.cur.w;
  const wy = view.cur.y + fy * view.cur.h;
  const scale = e.deltaY < 0 ? 0.85 : 1.18;
  view.cur.w *= scale; view.cur.h *= scale;
  view.cur.x = wx - fx * view.cur.w;
  view.cur.y = wy - fy * view.cur.h;
  view.tgt = { ...view.cur };
  applyViewBox();
  ensureCellsForView(view.cur);
}
function attachViewListeners() {
  svgEl.addEventListener('pointerdown', onPointerDown);
  svgEl.addEventListener('pointermove', onPointerMove);
  svgEl.addEventListener('pointerup', onPointerUp);
  svgEl.addEventListener('pointercancel', onPointerUp);
  svgEl.addEventListener('wheel', onWheel, { passive: false });
}
window.addEventListener('resize', () => {
  if (view.pan || !svgEl) return;
  if (!view.interactive) setTargetFit();
});

// ---------------- UI: colors --------------------------------
const colorListEl = document.getElementById('color-palette');
function renderColors() {
  colorListEl.innerHTML = '';
  for (const c of PRESET_COLORS) {
    const sw = document.createElement('button');
    sw.className = 'color-swatch' + (c.id === state.activeColorId ? ' active' : '');
    sw.style.background = c.value;
    sw.title = c.name;
    sw.setAttribute('aria-label', c.name);
    sw.addEventListener('click', () => { state.activeColorId = c.id; renderColors(); });
    colorListEl.appendChild(sw);
  }
}

// ---------------- UI: piece library + tooltip ---------------
const tooltipEl = document.getElementById('piece-tooltip');
const tooltipSvg = tooltipEl.querySelector('.tooltip-board');
const tooltipName = tooltipEl.querySelector('.tooltip-name');

function renderTooltipFor(pieceType) {
  const def = PIECES[pieceType];
  const range = 4;
  const size = 14;
  const total = (2 * range + 1) * size;
  while (tooltipSvg.firstChild) tooltipSvg.removeChild(tooltipSvg.firstChild);
  tooltipSvg.setAttribute('viewBox', `0 0 ${total} ${total}`);

  for (let x = -range; x <= range; x++) {
    for (let y = -range; y <= range; y++) {
      const sx = (x + range) * size;
      const sy = (range - y) * size;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', sx);
      rect.setAttribute('y', sy);
      rect.setAttribute('width', size);
      rect.setAttribute('height', size);
      let cls = 'tooltip-cell';
      if (x === 0 && y === 0) cls += ' center';
      else if (pieceAttacksSquareLazy(def, x, y)) cls += ' attacked';
      rect.setAttribute('class', cls);
      tooltipSvg.appendChild(rect);
    }
  }
  const piece = document.createElementNS(SVG_NS, 'text');
  piece.setAttribute('x', range * size + size / 2);
  piece.setAttribute('y', range * size + size / 2);
  piece.setAttribute('class', 'tooltip-piece');
  piece.setAttribute('font-size', def.glyphKind === 'standard' ? '11' : '7');
  if (def.glyphKind === 'code') piece.setAttribute('font-family', "'JetBrains Mono', monospace");
  piece.textContent = def.symbol;
  tooltipSvg.appendChild(piece);
  tooltipName.textContent = def.name;
}

function positionTooltip(anchor) {
  tooltipEl.hidden = false;
  const ar = anchor.getBoundingClientRect();
  const tr = tooltipEl.getBoundingClientRect();
  let left = ar.right + 10;
  let top = ar.top + ar.height / 2 - tr.height / 2;
  if (left + tr.width > window.innerWidth - 8) left = ar.left - tr.width - 10;
  if (top < 8) top = 8;
  if (top + tr.height > window.innerHeight - 8) top = window.innerHeight - tr.height - 8;
  tooltipEl.style.left = left + 'px';
  tooltipEl.style.top = top + 'px';
}

function buildPieceButtons() {
  const groups = {
    standard: 'piece-buttons-standard',
    compound: 'piece-buttons-compound',
    leaper:   'piece-buttons-leaper',
    rider:    'piece-buttons-rider',
  };
  for (const cat in groups) {
    const container = document.getElementById(groups[cat]);
    container.innerHTML = '';
    for (const [type, def] of Object.entries(PIECES)) {
      if (def.category !== cat) continue;
      const btn = document.createElement('button');
      btn.className = 'piece-btn';
      btn.title = def.name;
      const g = document.createElement('span');
      g.className = 'glyph ' + def.glyphKind;
      g.textContent = def.symbol;
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = def.name;
      btn.appendChild(g); btn.appendChild(lbl);
      btn.addEventListener('click', () => {
        state.sequence.push({ pieceType: type, colorId: state.activeColorId });
        renderSequence();
      });
      btn.addEventListener('mouseenter', () => { renderTooltipFor(type); positionTooltip(btn); });
      btn.addEventListener('mouseleave', () => { tooltipEl.hidden = true; });
      btn.addEventListener('focus', () => { renderTooltipFor(type); positionTooltip(btn); });
      btn.addEventListener('blur', () => { tooltipEl.hidden = true; });
      container.appendChild(btn);
    }
  }
}

// ---------------- UI: sequence ------------------------------
const sequenceListEl = document.getElementById('sequence-list');
const sequenceCountEl = document.getElementById('sequence-count');
function renderSequence() {
  sequenceListEl.innerHTML = '';
  sequenceCountEl.textContent = state.sequence.length ? `(${state.sequence.length})` : '';
  state.sequence.forEach((entry, i) => {
    const li = document.createElement('li');
    if (state.running && i === state.sequenceIndex) li.classList.add('current');
    const def = PIECES[entry.pieceType];
    const color = COLOR_BY_ID[entry.colorId];
    const idx = document.createElement('span'); idx.className = 'idx'; idx.textContent = (i + 1);
    const glyph = document.createElement('span'); glyph.className = 'glyph ' + def.glyphKind;
    glyph.style.color = color ? color.value : '#fff'; glyph.textContent = def.symbol;
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = def.name + (color ? ` · ${color.name}` : '');
    const actions = document.createElement('span'); actions.className = 'actions';
    const up = document.createElement('button'); up.textContent = '↑'; up.title = 'Move up';
    up.addEventListener('click', () => { if (i === 0) return; [state.sequence[i-1], state.sequence[i]] = [state.sequence[i], state.sequence[i-1]]; renderSequence(); });
    const down = document.createElement('button'); down.textContent = '↓'; down.title = 'Move down';
    down.addEventListener('click', () => { if (i === state.sequence.length - 1) return; [state.sequence[i+1], state.sequence[i]] = [state.sequence[i], state.sequence[i+1]]; renderSequence(); });
    const rm = document.createElement('button'); rm.textContent = '×'; rm.title = 'Remove';
    rm.addEventListener('click', () => { state.sequence.splice(i, 1); if (state.sequenceIndex >= state.sequence.length) state.sequenceIndex = 0; renderSequence(); });
    actions.appendChild(up); actions.appendChild(down); actions.appendChild(rm);
    li.appendChild(idx); li.appendChild(glyph); li.appendChild(name); li.appendChild(actions);
    sequenceListEl.appendChild(li);
  });
}
document.getElementById('clear-sequence').addEventListener('click', () => {
  state.sequence = []; state.sequenceIndex = 0; renderSequence();
});
document.getElementById('shuffle-sequence').addEventListener('click', () => {
  for (let i = state.sequence.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.sequence[i], state.sequence[j]] = [state.sequence[j], state.sequence[i]];
  }
  renderSequence();
});

// ---------------- UI: run controls --------------------------
const statusEl = document.getElementById('status');
const durationSlider = document.getElementById('duration');
const durationVal = document.getElementById('duration-val');
const doublingSlider = document.getElementById('doubling-time');
const doublingVal = document.getElementById('doubling-val');
const totalPiecesInput = document.getElementById('total-pieces');
const rateSelect = document.getElementById('rate-type');
const displayModeSelect = document.getElementById('display-mode');
const showNumbersCB = document.getElementById('show-numbers');

durationSlider.addEventListener('input', () => {
  state.totalDuration = +durationSlider.value;
  durationVal.textContent = state.totalDuration;
});
durationVal.textContent = state.totalDuration;
doublingSlider.addEventListener('input', () => {
  state.doublingTime = +doublingSlider.value;
  doublingVal.textContent = state.doublingTime;
});
doublingVal.textContent = state.doublingTime;
totalPiecesInput.addEventListener('change', () => {
  state.totalPieces = Math.max(1, +totalPiecesInput.value | 0);
});
function applyRateVisibility() {
  // Hide the timing parameter that the current rate doesn't use.
  const isExp = state.rateType === 'exponential';
  const durLabel = durationSlider.closest('label');
  const dblLabel = doublingSlider.closest('label');
  if (durLabel) durLabel.style.display = isExp ? 'none' : '';
  if (dblLabel) dblLabel.style.display = isExp ? '' : 'none';
}
rateSelect.addEventListener('change', () => {
  state.rateType = rateSelect.value;
  applyRateVisibility();
});
displayModeSelect.addEventListener('change', () => { state.displayMode = displayModeSelect.value; applyDisplayMode(); });
showNumbersCB.addEventListener('change', () => {
  state.showNumbers = showNumbersCB.checked;
  svgEl.classList.toggle('hide-numbers', !state.showNumbers);
});
function setStatus(text) { statusEl.textContent = text; }

document.getElementById('go-btn').addEventListener('click', () => {
  if (state.running) return;
  if (state.board.pieces.length === 0 || state.board.pieces.length >= state.totalPieces) resetAll();
  startPlacement();
});
document.getElementById('pause-btn').addEventListener('click', stopPlacement);
document.getElementById('reset-btn').addEventListener('click', resetAll);
document.getElementById('fit-btn').addEventListener('click', () => setTargetFit());
document.getElementById('export-btn').addEventListener('click', exportPNG);
document.getElementById('export-video-btn').addEventListener('click', () => { exportVideo().catch(e => setStatus('Video export failed: ' + e.message)); });

// --- Pre-render & Download ----------------------------------
// Canvas width/height limit varies (Chrome ~16384, Firefox ~32767). Above
// SINGLE_CANVAS_LIMIT we fall back to tiled rendering + a custom streaming
// PNG encoder.
const SINGLE_CANVAS_LIMIT = 16384;
const IMAGE_SIZES = [1024, 2048, 4096, 8192, 16384, 32768, 65536];
const VIDEO_SIZES = [1024, 2048, 4096];
const prerenderFormatSel = document.getElementById('prerender-format');
const prerenderSizeSel   = document.getElementById('prerender-size');
const prerenderWarn      = document.getElementById('prerender-warn');

function populatePrerenderSizes() {
  const fmt = prerenderFormatSel.value;
  const sizes = (fmt === 'video') ? VIDEO_SIZES : IMAGE_SIZES;
  prerenderSizeSel.innerHTML = '';
  for (const s of sizes) {
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = `${s} × ${s}`;
    prerenderSizeSel.appendChild(opt);
  }
  // Default to a sensible middle option (4096 for image, 2048 for video).
  prerenderSizeSel.value = (fmt === 'video') ? '2048' : '4096';
  prerenderWarn.textContent = (fmt === 'video')
    ? '4096² videos can take a minute or more to encode.'
    : 'Sizes above 16384² use a tiled PNG encoder and may take a while; 65536² can exceed available RAM.';
}
prerenderFormatSel.addEventListener('change', populatePrerenderSizes);
populatePrerenderSizes();

document.getElementById('prerender-btn').addEventListener('click', async () => {
  const fmt = prerenderFormatSel.value;
  const size = +prerenderSizeSel.value;
  try {
    if (fmt === 'video') {
      await exportVideo(size);
    } else {
      await prerenderImage(size);
    }
  } catch (e) {
    setStatus('Render failed: ' + (e && e.message ? e.message : e));
  }
});

async function prerenderImage(size) {
  if (state.sequence.length === 0) { setStatus('Add at least one piece to the sequence.'); return; }

  setStatus('Pre-computing placements…');
  await new Promise(r => setTimeout(r, 0));
  const placements = precomputeAllPlacements();
  if (placements.length === 0) { setStatus('No pieces could be placed.'); return; }

  // Final view fits all pieces.
  const finalBox = bboxAtCount(placements, placements.length);
  const view = fitBoxToCanvas(finalBox, size, size);

  let blob;
  if (size <= SINGLE_CANVAS_LIMIT) {
    blob = await renderSingleCanvasPng(size, view, placements);
  } else {
    blob = await renderTiledPng(size, view, placements);
  }
  if (!blob) return;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `chess-spiral-${size}x${size}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  const mb = (blob.size / (1024 * 1024)).toFixed(1);
  setStatus(`PNG exported (${size}×${size}, ${mb} MB).`);
}

async function renderSingleCanvasPng(size, view, placements) {
  setStatus(`Allocating ${size}×${size} canvas…`);
  await new Promise(r => setTimeout(r, 0));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  if (canvas.width !== size || canvas.height !== size) {
    setStatus(`Browser couldn't allocate ${size}×${size}; got ${canvas.width}×${canvas.height}.`);
    return null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) { setStatus('Could not get 2D context.'); return null; }

  setStatus(`Rendering ${size}×${size}…`);
  await new Promise(r => setTimeout(r, 0));
  renderFrameToCanvas(ctx, size, size, view, placements, placements.length);

  setStatus('Encoding PNG…');
  await new Promise(r => setTimeout(r, 0));
  return await new Promise(resolve => {
    canvas.toBlob(b => {
      if (!b) setStatus('Could not encode PNG (image too large for browser).');
      resolve(b);
    }, 'image/png');
  });
}

// ---- Tiled PNG encoder (for sizes > SINGLE_CANVAS_LIMIT) ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(...bufs) {
  let crc = 0xFFFFFFFF;
  for (const buf of bufs) {
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function u32be(n) {
  return new Uint8Array([(n>>>24)&0xFF, (n>>>16)&0xFF, (n>>>8)&0xFF, n&0xFF]);
}
function pngChunk(type, data) {
  const typeBytes = new Uint8Array([type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]);
  const len = u32be(data.length);
  const crc = u32be(crc32(typeBytes, data));
  const out = new Uint8Array(8 + data.length + 4);
  out.set(len, 0); out.set(typeBytes, 4); out.set(data, 8); out.set(crc, 8 + data.length);
  return out;
}
function pngIHDR(width, height) {
  const buf = new Uint8Array(13);
  buf.set(u32be(width), 0);
  buf.set(u32be(height), 4);
  buf[8] = 8;  // bit depth
  buf[9] = 2;  // color type RGB
  buf[10] = 0; buf[11] = 0; buf[12] = 0;
  return buf;
}

async function renderTiledPng(size, view, placements) {
  if (typeof CompressionStream === 'undefined') {
    setStatus('Browser lacks CompressionStream; cannot do tiled PNG.');
    return null;
  }
  const SIG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const STRIP_H = 256;            // scanlines processed per pass
  const SECTION_W = SINGLE_CANVAS_LIMIT; // horizontal section width
  const sx = size / view.w;       // global world->pixel scale

  // One reusable canvas per horizontal section.
  const sectionCanvases = [];
  let xCursor = 0;
  while (xCursor < size) {
    const w = Math.min(SECTION_W, size - xCursor);
    const c = document.createElement('canvas');
    c.width = w; c.height = STRIP_H;
    if (c.width !== w || c.height !== STRIP_H) {
      setStatus(`Browser couldn't allocate ${w}×${STRIP_H} tile canvas.`);
      return null;
    }
    sectionCanvases.push({ canvas: c, ctx: c.getContext('2d'), xStart: xCursor, w });
    xCursor += w;
  }

  // Streaming deflate.
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  const compressedChunks = [];
  const readDone = (async () => {
    const reader = cs.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      compressedChunks.push(value);
    }
  })();

  const scanlineBytes = size * 3;
  // Output scanline buffer (filter byte + RGB bytes).
  const outLine = new Uint8Array(1 + scanlineBytes);

  const totalStrips = Math.ceil(size / STRIP_H);
  for (let stripIdx = 0; stripIdx < totalStrips; stripIdx++) {
    const yStart = stripIdx * STRIP_H;
    const stripH = Math.min(STRIP_H, size - yStart);

    // Render each section for this strip and pull pixels.
    const sectionPixels = [];
    for (const sec of sectionCanvases) {
      // Resize if last strip is short
      if (sec.canvas.height !== stripH) {
        sec.canvas.height = stripH;
      }
      // Tile view = sub-rectangle of the global viewBox that this section/strip covers.
      const tileView = {
        x: view.x + sec.xStart / sx,
        y: view.y + yStart / sx,
        w: sec.w / sx,
        h: stripH / sx,
      };
      renderFrameToCanvas(sec.ctx, sec.w, stripH, tileView, placements, placements.length);
      sectionPixels.push(sec.ctx.getImageData(0, 0, sec.w, stripH).data);
    }

    // Filter + write scanlines for this strip.
    for (let yLocal = 0; yLocal < stripH; yLocal++) {
      outLine[0] = 0; // filter None
      let dst = 1;
      for (let s = 0; s < sectionCanvases.length; s++) {
        const sec = sectionCanvases[s];
        const data = sectionPixels[s];
        const srcStart = yLocal * sec.w * 4;
        for (let x = 0; x < sec.w; x++) {
          const i = srcStart + x * 4;
          outLine[dst++] = data[i];
          outLine[dst++] = data[i + 1];
          outLine[dst++] = data[i + 2];
        }
      }
      // .slice() so the stream owns its own copy and we can mutate outLine.
      await writer.write(outLine.slice());
    }

    const pct = Math.round(((stripIdx + 1) / totalStrips) * 100);
    setStatus(`Rendering ${size}×${size}… ${pct}% (strip ${stripIdx + 1}/${totalStrips})`);
    await new Promise(r => setTimeout(r, 0));
  }

  await writer.close();
  await readDone;

  // Concatenate compressed bytes for one IDAT chunk.
  let totalLen = 0;
  for (const c of compressedChunks) totalLen += c.length;
  const idatData = new Uint8Array(totalLen);
  {
    let off = 0;
    for (const c of compressedChunks) { idatData.set(c, off); off += c.length; }
  }

  setStatus('Assembling PNG…');
  await new Promise(r => setTimeout(r, 0));
  const ihdr = pngChunk('IHDR', pngIHDR(size, size));
  const idat = pngChunk('IDAT', idatData);
  const iend = pngChunk('IEND', new Uint8Array(0));
  return new Blob([SIG, ihdr, idat, iend], { type: 'image/png' });
}

// ---------------- Legend ------------------------------------
const legendEl = document.getElementById('legend');
function renderLegend() {
  legendEl.innerHTML = '';
  const total = state.board.pieces.length;
  const tot = document.createElement('span');
  tot.className = 'stat';
  tot.innerHTML = `<strong style="color:var(--text)">${total}</strong>&nbsp;placed of ${state.totalPieces}`;
  legendEl.appendChild(tot);
  for (const c of PRESET_COLORS) {
    const n = state.board.countByColor[c.id] || 0;
    if (n === 0) continue;
    const stat = document.createElement('span'); stat.className = 'stat';
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = c.value;
    const lbl = document.createElement('span'); lbl.textContent = `${c.name}: ${n}`;
    stat.appendChild(d); stat.appendChild(lbl);
    legendEl.appendChild(stat);
  }
}

// ---------------- Stats panel (live) ------------------------
const statsPanelEl   = document.getElementById('stats-panel');
const unfilledPctEl  = document.getElementById('unfilled-pct');
const unfilledSubEl  = document.getElementById('unfilled-sub');
const ringMaxEl      = document.getElementById('ring-max');
const ringChartCanvas = document.getElementById('ring-chart');
let ringChartCtx = null;
let ringChartCssW = 0, ringChartCssH = 0;

function ensureRingChartSize() {
  const cssW = ringChartCanvas.clientWidth;
  const cssH = ringChartCanvas.clientHeight;
  if (cssW === ringChartCssW && cssH === ringChartCssH && ringChartCtx) return;
  const dpr = window.devicePixelRatio || 1;
  ringChartCanvas.width = Math.max(1, Math.round(cssW * dpr));
  ringChartCanvas.height = Math.max(1, Math.round(cssH * dpr));
  ringChartCtx = ringChartCanvas.getContext('2d');
  ringChartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ringChartCssW = cssW;
  ringChartCssH = cssH;
}

// Per-piece ring is max(|x|,|y|). Recomputed from board.pieces on render
// (cheap: O(N), called at most ~10 Hz).
function ringSize(r) { return r === 0 ? 1 : 8 * r; }

function computeRingCounts() {
  const counts = [];
  let maxRing = 0;
  const pieces = state.board.pieces;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const r = Math.max(Math.abs(p.x), Math.abs(p.y));
    counts[r] = (counts[r] || 0) + 1;
    if (r > maxRing) maxRing = r;
  }
  // fill 0s
  for (let r = 0; r <= maxRing; r++) if (!counts[r]) counts[r] = 0;
  return { counts, maxRing };
}

function drawRingChart(counts, maxRing) {
  ensureRingChartSize();
  const ctx = ringChartCtx;
  const W = ringChartCssW;
  const H = ringChartCssH;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f1117';
  ctx.fillRect(0, 0, W, H);

  const padL = 22, padR = 6, padT = 6, padB = 14;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  // axes
  ctx.strokeStyle = '#262a33';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL + 0.5, padT);
  ctx.lineTo(padL + 0.5, padT + chartH);
  ctx.lineTo(padL + chartW, padT + chartH + 0.5);
  ctx.stroke();

  // 50% guide line
  ctx.strokeStyle = '#1b1e26';
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH / 2 + 0.5);
  ctx.lineTo(padL + chartW, padT + chartH / 2 + 0.5);
  ctx.stroke();

  // bars
  const numRings = maxRing + 1;
  const barSlot = chartW / numRings;
  const barW = Math.max(1, barSlot - 1);
  ctx.fillStyle = '#6b8eff';
  for (let r = 0; r <= maxRing; r++) {
    const occ = counts[r] || 0;
    const total = ringSize(r);
    const pctUnfilled = 1 - (occ / total);
    const barH = pctUnfilled * chartH;
    const x = padL + r * barSlot;
    const y = padT + chartH - barH;
    ctx.fillRect(x, y, barW, barH);
  }

  // y-axis labels
  ctx.fillStyle = '#5e6371';
  ctx.font = '9px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('100%', padL - 3, padT - 2);
  ctx.textBaseline = 'bottom';
  ctx.fillText('0%', padL - 3, padT + chartH + 1);
}

function renderStatsPanel() {
  const { counts, maxRing } = computeRingCounts();
  const totalSquares = (2 * maxRing + 1) * (2 * maxRing + 1);
  const occupied = state.board.pieces.length;
  const pct = totalSquares > 0 ? (1 - occupied / totalSquares) * 100 : 100;
  unfilledPctEl.textContent = pct.toFixed(1) + '%';
  unfilledSubEl.textContent = `${occupied}/${totalSquares}`;
  ringMaxEl.textContent = 'ring ' + maxRing;
  if (!statsPanelEl.classList.contains('collapsed')) {
    drawRingChart(counts, maxRing);
  }
}

document.getElementById('stats-toggle').addEventListener('click', () => {
  const collapsed = statsPanelEl.classList.toggle('collapsed');
  document.getElementById('stats-toggle').textContent = collapsed ? '+' : '−';
  document.getElementById('stats-toggle').title = collapsed ? 'Expand' : 'Minimize';
  if (!collapsed) renderStatsPanel();
});

// ---------------- PNG export --------------------------------
const EXPORT_STYLE = `
.cell { fill: #181b22; stroke: #20232b; stroke-width: 0.4; }
.cell.center { fill: #232732; }
.cell-num { font-family: 'JetBrains Mono','Courier New',monospace; font-size: 5px; fill: #4a4f5c; text-anchor: end; dominant-baseline: hanging; }
.piece-glyph { text-anchor: middle; dominant-baseline: central; font-weight: 600; }
.piece-glyph.standard { font-size: 18px; }
.piece-glyph.code { font-family: 'JetBrains Mono','Courier New',monospace; font-size: 11px; font-weight: 700; }
`;
function exportPNG() {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  let css = EXPORT_STYLE;
  if (svgEl.classList.contains('hide-numbers')) css += '\n.cell-num { display: none; }';
  if (svgEl.classList.contains('mode-fill')) css += '\n.piece-glyph { display: none; }\n.cell { stroke: none; }';
  const styleNode = document.createElementNS(SVG_NS, 'style');
  styleNode.textContent = css;
  clone.insertBefore(styleNode, clone.firstChild);
  const rect = svgEl.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const svgStr = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2, cw = w * scale, ch = h * scale;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b0c10'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => {
      if (!b) { setStatus('Export failed.'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'chess-spiral.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus('PNG exported.');
    }, 'image/png');
  };
  img.onerror = () => { setStatus('Export failed (image load).'); URL.revokeObjectURL(url); };
  img.src = url;
}

// ---------------- Video export ------------------------------
// Pre-compute all placements (fast with bitset algo), then render frames to
// an offscreen canvas at the configured rate. MediaRecorder captures the
// stream in manual mode (requestFrame per frame), so output timing always
// matches configs regardless of how slow rendering is in real-time.

function precomputeAllPlacements() {
  const board = new Board();
  const placements = [];
  let seqIdx = 0;
  const N = state.totalPieces;
  while (placements.length < N) {
    if (state.sequence.length === 0) break;
    const entry = state.sequence[seqIdx];
    seqIdx = (seqIdx + 1) % state.sequence.length;
    const def = PIECES[entry.pieceType];
    const color = COLOR_BY_ID[entry.colorId];
    if (!def || !color) continue;
    const p = board.placeNext(entry.pieceType, entry.colorId);
    if (!p) break;
    placements.push(p);
  }
  return placements;
}

function bboxAtCount(placements, count) {
  let minX = -1, maxX = 1, minY = -1, maxY = 1;
  if (count > 0) {
    minX = placements[0].x; maxX = placements[0].x;
    minY = placements[0].y; maxY = placements[0].y;
    for (let i = 1; i < count; i++) {
      const p = placements[i];
      if (p.x < minX) minX = p.x; else if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; else if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX: minX - 1, maxX: maxX + 1, minY: minY - 1, maxY: maxY + 1 };
}

function fitBoxToCanvas(box, canvasW, canvasH) {
  let vbW = (box.maxX - box.minX + 1) * CELL;
  let vbH = (box.maxY - box.minY + 1) * CELL;
  let vbX = box.minX * CELL;
  let vbY = -box.maxY * CELL - CELL;
  const aspect = canvasW / canvasH;
  if (vbW / vbH > aspect) {
    const newH = vbW / aspect;
    vbY -= (newH - vbH) / 2;
    vbH = newH;
  } else {
    const newW = vbH * aspect;
    vbX -= (newW - vbW) / 2;
    vbW = newW;
  }
  return { x: vbX, y: vbY, w: vbW, h: vbH };
}

// Smoothed (lerp) viewBox state used during frame rendering so video matches
// the live "slow zoom out" feel.
function makeSmoothedView(initial) {
  return { cur: { ...initial }, tgt: { ...initial } };
}
function advanceSmoothedView(view, target, lerp) {
  view.tgt = target;
  for (const k of ['x','y','w','h']) {
    view.cur[k] += (view.tgt[k] - view.cur[k]) * lerp;
  }
}

function renderFrameToCanvas(ctx, canvasW, canvasH, view, placements, visibleCount) {
  // Background
  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // World->canvas transform from current viewBox
  const sx = canvasW / view.w;
  const sy = canvasH / view.h;
  ctx.save();
  ctx.scale(sx, sy);
  ctx.translate(-view.x, -view.y);

  // Determine visible world-cell range
  const minCellX = Math.floor(view.x / CELL) - 1;
  const maxCellX = Math.ceil((view.x + view.w) / CELL) + 1;
  const minCellY = Math.floor(-(view.y + view.h) / CELL) - 1;
  const maxCellY = Math.ceil(-view.y / CELL) + 1;

  // Build claim map for this frame (only colored cells need recolor in fill mode)
  const claim = (state.displayMode === 'fill') ? new Map() : null;
  if (claim) {
    for (let i = 0; i < visibleCount; i++) {
      const p = placements[i];
      claim.set(p.x + ',' + p.y, p.colorId);
    }
  }

  // Stroke width: aim for ~1 px at output regardless of zoom (avoids both
  // hairlines at low zoom and screen-door at high zoom).
  const strokeWorld = Math.max(0.05, 1 / sx);

  // Cells:
  //   fill mode → NO strokes anywhere. Cells are pure blocks of color so the
  //               image keeps its full vibrancy when downscaled (no screen-door).
  //   pieces mode → all cells get a 1-px grid stroke so the lattice is visible
  //                 around the glyphs.
  if (claim) {
    // Single pass: fill every visible cell with either its claim color or
    // the default dark, no stroke.
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        const key = x + ',' + y;
        const cid = claim.get(key);
        if (cid) {
          ctx.fillStyle = COLOR_BY_ID[cid].value;
        } else {
          const num = spiralIndexAt(x, y);
          ctx.fillStyle = (num === 1) ? '#232732' : '#181b22';
        }
        ctx.fillRect(x * CELL, -y * CELL - CELL, CELL, CELL);
      }
    }
  } else {
    ctx.lineWidth = strokeWorld;
    ctx.strokeStyle = '#20232b';
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        const num = spiralIndexAt(x, y);
        ctx.fillStyle = (num === 1) ? '#232732' : '#181b22';
        ctx.fillRect(x * CELL, -y * CELL - CELL, CELL, CELL);
        ctx.strokeRect(x * CELL, -y * CELL - CELL, CELL, CELL);
      }
    }
  }

  // Numbers
  if (state.showNumbers) {
    ctx.fillStyle = '#4a4f5c';
    ctx.font = '5px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    for (let x = minCellX; x <= maxCellX; x++) {
      for (let y = minCellY; y <= maxCellY; y++) {
        const num = spiralIndexAt(x, y);
        if (num === 0) continue;
        ctx.fillText(num, x * CELL + CELL - 2, -y * CELL - CELL + 1.5);
      }
    }
  }

  // Pieces (only if not fill mode)
  if (state.displayMode !== 'fill') {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < visibleCount; i++) {
      const p = placements[i];
      const def = PIECES[p.type];
      const color = COLOR_BY_ID[p.colorId];
      ctx.fillStyle = color.value;
      ctx.font = def.glyphKind === 'standard'
        ? '600 18px "Inter", system-ui, sans-serif'
        : '700 11px "JetBrains Mono", monospace';
      ctx.fillText(def.symbol, p.x * CELL + CELL / 2, -p.y * CELL - CELL / 2);
    }
  }

  ctx.restore();
}

async function exportVideo(sizeOverride) {
  if (typeof MediaRecorder === 'undefined') { setStatus('Video export not supported in this browser.'); return; }
  if (state.sequence.length === 0) { setStatus('Add at least one piece to the sequence.'); return; }

  setStatus('Pre-computing placements…');
  await new Promise(r => setTimeout(r, 0));
  const placements = precomputeAllPlacements();
  if (placements.length === 0) { setStatus('No pieces could be placed.'); return; }

  // Each rate type owns its timing parameter exclusively.
  //   linear/quadratic → totalDuration
  //   exponential      → doublingTime·log2(N+1)
  let totalSimMs;
  if (state.rateType === 'exponential') {
    totalSimMs = timeForPiece(placements.length);
  } else {
    totalSimMs = state.totalDuration * 1000;
  }
  // Hold final state for 1 second at the end
  const HOLD_MS = 1000;
  const FPS = 30;
  const totalFrames = Math.ceil((totalSimMs + HOLD_MS) / 1000 * FPS);

  // Square at sizeOverride, or default to 1280x720 if not supplied.
  const VIDEO_W = sizeOverride || 1280;
  const VIDEO_H = sizeOverride || 720;
  const canvas = document.createElement('canvas');
  canvas.width = VIDEO_W; canvas.height = VIDEO_H;
  if (canvas.width !== VIDEO_W || canvas.height !== VIDEO_H) {
    setStatus(`Browser couldn't allocate ${VIDEO_W}×${VIDEO_H} canvas.`); return;
  }
  const ctx = canvas.getContext('2d');

  // Initial paint so the stream has a frame
  ctx.fillStyle = '#0b0c10';
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H);

  // Manual capture stream
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  if (!track || !track.requestFrame) {
    setStatus('Browser lacks CanvasCaptureMediaStreamTrack.requestFrame; cannot export video.');
    return;
  }

  // Pick a working mime type
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  let mimeType = '';
  for (const c of candidates) { if (MediaRecorder.isTypeSupported(c)) { mimeType = c; break; } }
  if (!mimeType) { setStatus('No supported video codec.'); return; }

  const chunks = [];
  // Scale bitrate with pixel count so 4K doesn't compress to mush.
  const bitrate = Math.max(6_000_000, Math.round(VIDEO_W * VIDEO_H * 1.5));
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  const stopped = new Promise(res => { recorder.onstop = res; });
  recorder.start();

  // Tight starting view (matches live behavior)
  const initialBox = bboxAtCount(placements, 0);
  const initialView = fitBoxToCanvas(initialBox, VIDEO_W, VIDEO_H);
  const smoothed = makeSmoothedView(initialView);

  let visibleCount = 0;
  // Precompute placement times for monotonic walk
  for (let frame = 0; frame < totalFrames; frame++) {
    const frameMs = (frame / FPS) * 1000;
    const simMs = Math.min(frameMs, totalSimMs);

    // Advance visibleCount
    while (visibleCount < placements.length && timeForPiece(visibleCount + 1) <= simMs) {
      visibleCount++;
    }

    // Smoothly approach the auto-fit target (same lerp factor as live UI)
    const box = bboxAtCount(placements, visibleCount);
    const targetView = fitBoxToCanvas(box, VIDEO_W, VIDEO_H);
    advanceSmoothedView(smoothed, targetView, 0.1);

    renderFrameToCanvas(ctx, VIDEO_W, VIDEO_H, smoothed.cur, placements, visibleCount);
    track.requestFrame();
    // Yield to event loop so MediaRecorder can pick up the frame
    await new Promise(r => setTimeout(r, 0));

    if ((frame & 31) === 0) {
      const pct = Math.round((frame / totalFrames) * 100);
      setStatus(`Encoding video: ${pct}% (frame ${frame}/${totalFrames})`);
    }
  }

  recorder.stop();
  await stopped;
  track.stop();

  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chess-spiral-${VIDEO_W}x${VIDEO_H}.webm`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  const mb = (blob.size / (1024 * 1024)).toFixed(1);
  setStatus(`Video exported (${mb} MB, ${(totalFrames / FPS).toFixed(1)}s).`);
}

// ---------------- Bootstrap ---------------------------------
function init() {
  setupSvg();
  attachViewListeners();
  renderColors();
  buildPieceButtons();
  state.sequence = [
    { pieceType: 'knight', colorId: 'red' },
    { pieceType: 'knight', colorId: 'white' },
  ];
  state.totalPieces = +totalPiecesInput.value;
  state.totalDuration = +durationSlider.value;
  state.doublingTime = +doublingSlider.value;
  state.rateType = rateSelect.value;
  state.displayMode = displayModeSelect.value;
  applyRateVisibility();
  renderSequence();
  renderLegend();
  renderStatsPanel();
  setStatus('Ready. Configure the sequence and press Go.');
}
init();
