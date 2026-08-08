const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const context = { console, globalThis: null };
context.globalThis = context;
vm.createContext(context);

for (const file of ['js/boq-engine.js', 'js/boq-a103-recovery.js', 'js/boq-hardening.js', 'js/boq-state-integrity.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const engine = context.DeterministicBOQEngine;
assert(engine, 'DeterministicBOQEngine must load');

const text = `
QuantisAI — BOQ ENGINE TEST DRAWING
Drawing: A-103
Revision: P01
10.00m OVERALL
5.00m OVERALL
WALL HEIGHT: 2.40m
LIVING / DINING
6.00m × 3.00m
KITCHEN
4.00m × 3.00m
BEDROOM 1
6.00m × 2.00m
BEDROOM 2
4.00m × 2.00m
D01 External door 0.90 × 2.10 1.89 m²
W01 Window 1.20 × 1.20 1.44 m²
W02 Window 1.20 × 1.20 1.44 m²
W03 Window 1.20 × 1.20 1.44 m²
W04 Window 1.20 × 1.20 1.44 m²
W05 Window 1.20 × 1.20 1.44 m²
`;

const drawing = engine.fromExtractedText(text, { page: 1 });
assert(drawing, 'A103 drawing should be recovered from explicit text');
assert.strictEqual(drawing.source.drawing, 'A-103');
assert.strictEqual(drawing.source.revision, 'P01');
assert.strictEqual(drawing.rooms.length, 4);
assert.strictEqual(drawing.openings.filter(o => o.type === 'door').length, 1);
assert.strictEqual(drawing.openings.filter(o => o.type === 'window').length, 5);

const takeoff = engine.fromDrawingInterpretation(drawing);
const floor = takeoff.measurements.find(m => m.description === 'Overall floor area');
const wall = takeoff.measurements.find(m => m.description === 'External wall area');
assert.strictEqual(floor.quantity, 50);
assert.strictEqual(wall.quantity, 62.91);
assert.strictEqual(wall.source.drawing, 'A-103');
assert.strictEqual(wall.source.revision, 'P01');
assert.strictEqual(takeoff.overallConfidence, 1);

const boq = engine.buildBoQ(takeoff);
assert(boq.items.length >= 2);
assert(boq.items.every(item => item.quantity >= 0));
assert.strictEqual(boq.pricingStatus, 'RATE_DATA_REQUIRED');

const insufficient = engine.insufficient('drawing-interpreter', 'test failure');
assert.strictEqual(insufficient.status, 'failed');
assert.strictEqual(insufficient.confidence, null);
assert.strictEqual(insufficient.gia, null);

console.log('PASS: A103 deterministic recovery, take-off, traceability and failure-state controls');
