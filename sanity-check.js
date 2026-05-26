// Sanity check for the new bitset-based algorithm.
// Stubs DOM, evals script.js, runs a placement simulation, compares to the
// reference (slow but obviously-correct) naive algorithm.

const fs = require('fs');
const path = require('path');

const stubElement = () => {
  const el = {
    appendChild: () => el, addEventListener: () => {}, removeChild: () => {},
    insertBefore: () => el, cloneNode: () => stubElement(),
    firstChild: null, innerHTML: '', textContent: '', value: '30',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    getBoundingClientRect: () => ({ width: 800, height: 600, left: 0, top: 0 }),
    setAttribute: () => {}, getAttribute: () => '0 0 100 100',
    removeAttribute: () => {}, setPointerCapture: () => {}, releasePointerCapture: () => {},
    style: {}, children: [], hidden: false,
  };
  el.querySelector = () => stubElement();
  el.closest = () => stubElement();
  return el;
};

global.document = {
  getElementById: () => stubElement(),
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
