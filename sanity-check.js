// Sanity check for the new bitset-based algorithm.
// Stubs DOM, evals script.js, runs a placement simulation, compares to the
// reference (slow but obviously-correct) naive algorithm.

const fs = require('fs');
const path = require('path');

const stubElement = (val) => {
  const el = {
    appendChild: () => el, addEventListener: () => {}, removeChild: () => {},
    insertBefore: () => el, cloneNode: () => stubElement(val),
    firstChild: null, innerHTML: '', textContent: '', value: val !== undefined ? val : '30',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    setAttribute: () => {}, getAttribute: () => '0 0 100 100',
    removeAttribute: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {},
    style: {}, children: [], hidden: false,
  };
  el.querySelector = () => stubElement();
  el.closest = () => stubElement();
  el.getContext = () => ({
    setTransform: () => {}, clearRect: () => {}, fillRect: () => {},
    strokeRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
    stroke: () => {}, fillText: () => {}, save: () => {}, restore: () => {},
    scale: () => {}, translate: () => {}, drawImage: () => {},
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
  });
  el.clientWidth = 280;
  el.clientHeight = 120;
  return el;
};

// Return a stub that gives the dropdown selects valid default values, so the
// script's init() doesn't fall into the "unknown spiral type" path.
const SELECT_DEFAULTS = {
  'rate-type': 'linear',
  'display-mode': 'pieces',
  'spiral-type': 'ulam',
  'prerender-format': 'image',
};
global.document = {
  getElementById: (id) => stubElement(SELECT_DEFAULTS[id]),
  createElement: () => stubElement(),
  createElementNS: () => stubElement(),
};
global.window = { addEventListener: () => {}, innerWidth: 1000, innerHeight: 800 };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

const src = fs.readFileSync(path.join(__dirname, 'script.js'), 'utf8');
const exportBlock = `
Object.assign(globalThis, { Board, PIECES, PRESET_COLORS, spiralIndexAt, spiralX, spiralY, MAX_SPIRAL, onRay });
`;
try { (0, eval)(src + exportBlock); } catch (e) { console.error('Eval threw:', e.message); }

// --- Reference (naive) attack predicates for cross-checking ----------------
function refAttacks(piece, tx, ty, occupiedSet) {
  const def = PIECES[piece.type];
  for (const [ox, oy] of def.leapers) {
    if (piece.x + ox === tx && piece.y + oy === ty) return true;
  }
  for (const [dx, dy] of def.rays) {
    const k = onRay(piece.x, piece.y, dx, dy, tx, ty);
    if (k === null) continue;
    // Check no blockers between (excluding endpoints)
    let blocked = false;
    for (let step = 1; step < k; step++) {
      const sx = piece.x + step * dx, sy = piece.y + step * dy;
      if (occupiedSet.has(sx + ',' + sy)) { blocked = true; break; }
    }
    if (!blocked) return true;
  }
  return false;
}

function refIsAttackedByEnemies(pieces, x, y, colorId) {
  const occ = new Set();
  for (const p of pieces) occ.add(p.x + ',' + p.y);
  for (const p of pieces) {
    if (p.colorId === colorId) continue;
    if (refAttacks(p, x, y, occ)) return true;
  }
  return false;
}

function refFindNextSquare(pieces, colorId) {
  const occ = new Set(pieces.map(p => p.x + ',' + p.y));
  for (let i = 1; i <= MAX_SPIRAL; i++) {
    const x = spiralX[i-1], y = spiralY[i-1];
    if (occ.has(x + ',' + y)) continue;
    if (!refIsAttackedByEnemies(pieces, x, y, colorId)) return { x, y, squareNum: i };
  }
  return null;
}

// --- Run side-by-side ------------------------------------------------------
const sequence = [
  ['queen','white'], ['knight','red'], ['bishop','blue'], ['rook','green'],
  ['pawn','white'], ['nightrider','red'], ['amazon','blue'], ['archbishop','green'],
  ['chancellor','white'], ['king','red'], ['camel','blue'], ['zebra','green'],
];

const fastBoard = new Board();
const refPieces = [];

let mismatches = 0;
const N = 300;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const [type, colorId] = sequence[i % sequence.length];
  const fastResult = fastBoard.placeNext(type, colorId);
  const refResult = refFindNextSquare(refPieces, colorId);

  if (!fastResult || !refResult) {
    if (!!fastResult !== !!refResult) {
      console.log(`Step ${i+1}: mismatch in null vs piece (fast=${!!fastResult}, ref=${!!refResult})`);
      mismatches++;
    }
    if (!fastResult) break;
  } else if (fastResult.squareNum !== refResult.squareNum) {
    console.log(`Step ${i+1}: ${colorId} ${type} → fast sq ${fastResult.squareNum} at (${fastResult.x},${fastResult.y}), ref sq ${refResult.squareNum} at (${refResult.x},${refResult.y})`);
    mismatches++;
    if (mismatches >= 5) break;
  } else {
    refPieces.push({ type, colorId, x: refResult.x, y: refResult.y });
  }
}
const dt = Date.now() - t0;
console.log(`\nFast placed ${fastBoard.pieces.length} pieces in ${dt}ms (~${(dt/Math.max(1,fastBoard.pieces.length)).toFixed(2)}ms/piece)`);
console.log(`Bbox: x in [${fastBoard.minX}, ${fastBoard.maxX}], y in [${fastBoard.minY}, ${fastBoard.maxY}]`);
console.log(`Mismatches vs reference: ${mismatches}`);

// --- Self-consistency: at high N, verify every placed piece sits on a
//     square that is NOT attacked by any enemy piece. Catches algo bugs even
//     when the reference is too slow to run.
function verifyConsistency(board) {
  const pieces = board.pieces;
  const occ = new Set(pieces.map(p => p.x + ',' + p.y));
  let violations = 0;
  for (const target of pieces) {
    for (const attacker of pieces) {
      if (attacker.colorId === target.colorId) continue;
      if (refAttacks(attacker, target.x, target.y, occ)) {
        // Piece at (target.x, target.y) is attacked by an enemy. That's a violation:
        // when target was placed, no enemy should have attacked that square.
        // (Newer enemies arriving later don't matter — they wouldn't be placed
        // there if target's square was occupied, but they CAN attack it from elsewhere.)
        // For the algorithm to be correct, NO target should be attacked by any
        // currently-existing enemy whose placement was BEFORE target.
        // We need to check insertion order: was attacker placed before target?
        // pieces[] is in placement order, so we can compare indices.
        const ti = pieces.indexOf(target);
        const ai = pieces.indexOf(attacker);
        if (ai < ti) {
          violations++;
          if (violations <= 5) {
            console.log(`VIOLATION: piece #${ti+1} ${target.colorId} ${target.type} at (${target.x},${target.y}) is attacked by earlier piece #${ai+1} ${attacker.colorId} ${attacker.type} at (${attacker.x},${attacker.y})`);
          }
        }
      }
    }
  }
  return violations;
}

// Run sequences that include sliders heavily, see if any violation emerges.
const sliderSequences = [
  { name: 'two rooks',    seq: [['rook','red'], ['rook','blue']] },
  { name: 'two queens',   seq: [['queen','red'], ['queen','blue']] },
  { name: 'rook+bishop',  seq: [['rook','red'], ['bishop','blue']] },
  { name: 'two knights',  seq: [['knight','red'], ['knight','white']] },
  { name: 'all standard', seq: [['pawn','red'],['knight','red'],['bishop','red'],['rook','red'],['queen','red'],['king','red'],['pawn','blue'],['knight','blue'],['bishop','blue'],['rook','blue'],['queen','blue'],['king','blue']] },
];
for (const { name, seq } of sliderSequences) {
  const b = new Board();
  for (let i = 0; i < 1500; i++) {
    const [t, c] = seq[i % seq.length];
    if (!b.placeNext(t, c)) break;
  }
  const v = verifyConsistency(b);
  console.log(`Self-check "${name}": ${b.pieces.length} pieces, ${v} violations`);
}

// --- Grow-the-spiral test: place enough knights to force at least one
//     growSpiral() and verify no violations across the boundary.
{
  const b = new Board();
  const seq = [['knight','red'], ['knight','blue']];
  const TARGET = 70000;
  const t = Date.now();
  let lastRing = 0;
  for (let i = 0; i < TARGET; i++) {
    const [type, colorId] = seq[i % seq.length];
    const p = b.placeNext(type, colorId);
    if (!p) break;
    const r = Math.max(Math.abs(p.x), Math.abs(p.y));
    if (r > lastRing) lastRing = r;
  }
  const dt = Date.now() - t;
  const violations = verifyConsistency(b);
  console.log(`Grow test: ${b.pieces.length} knights in ${dt}ms, reached ring ${lastRing}, ${violations} violations`);
}

// --- Slider speed test: nightriders at scale ------------------------------
{
  const b = new Board();
  b.setActiveColors(['red', 'white']);
  const seq = [['nightrider','red'], ['nightrider','white']];
  const tStart = Date.now();
  const checkpoints = [50000, 200000, 500000, 1000000];
  const N = checkpoints[checkpoints.length - 1];
  let nextCp = 0;
  for (let i = 0; i < N; i++) {
    const [type, colorId] = seq[i % seq.length];
    const p = b.placeNext(type, colorId);
    if (!p) break;
    if (b.pieces.length === checkpoints[nextCp]) {
      const dt = (Date.now() - tStart) / 1000;
      console.log(`Nightrider test: ${b.pieces.length.toLocaleString()} pieces at ${dt.toFixed(1)}s (avg ${(dt*1e6 / b.pieces.length).toFixed(2)} µs/piece)`);
      nextCp++;
      if (nextCp >= checkpoints.length) break;
    }
  }
}

// --- Big speed test: knights at scale, to check linear time growth ---------
{
  const b = new Board();
  const seq = [['knight','red'], ['knight','white']];
  // Same optimization the live code applies: only iterate over the colors
  // actually in play (2) instead of all 10 preset colors.
  b.setActiveColors(['red', 'white']);
  const tStart = Date.now();
  const checkpoints = [500000, 1000000, 2000000, 3000000, 4000000];
  const N = checkpoints[checkpoints.length - 1];
  let nextCp = 0;
  for (let i = 0; i < N; i++) {
    const [type, colorId] = seq[i % seq.length];
    const p = b.placeNext(type, colorId);
    if (!p) break;
    if (b.pieces.length === checkpoints[nextCp]) {
      const dt = (Date.now() - tStart) / 1000;
      console.log(`Big test: ${b.pieces.length.toLocaleString()} knights at ${dt.toFixed(1)}s (avg ${(dt*1e6 / b.pieces.length).toFixed(2)} µs/piece)`);
      nextCp++;
      if (nextCp >= checkpoints.length) break;
    }
  }
}

// --- Speed test: 2000 pieces -----------------------------------------------
const speedBoard = new Board();
const t1 = Date.now();
const TARGET = 2000;
for (let i = 0; i < TARGET; i++) {
  const [type, colorId] = sequence[i % sequence.length];
  const p = speedBoard.placeNext(type, colorId);
  if (!p) { console.log(`Speed test: stopped at piece ${i+1}`); break; }
}
const dt2 = Date.now() - t1;
console.log(`Speed test: ${speedBoard.pieces.length} pieces in ${dt2}ms (~${(dt2/Math.max(1,speedBoard.pieces.length)).toFixed(2)}ms/piece)`);
