const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'boq-engine.js'), 'utf8');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const engine = sandbox.DeterministicBOQEngine;

assert.strictEqual(engine.rectangleArea(10, 5), 50);
assert.strictEqual(engine.wallNetArea(10, 2.5, [{ width: 0.9, height: 2.1 }]), 23.11);

const missing = engine.fromDrawingInterpretation({ rooms: [{ name: 'Kitchen' }] });
assert.strictEqual(missing.measurements.length, 0);
assert.ok(missing.clarifications.length > 0);

const measured = engine.fromDrawingInterpretation({
  rooms: [{
    name: 'Kitchen',
    length: 4.2,
    width: 3.5,
    source: { drawing: 'A-101', page: 2, revision: 'P03' },
    evidenceConfidence: 0.97
  }],
  walls: [{
    external: true,
    length: 10,
    height: 2.5,
    openings: [{ width: 0.9, height: 2.1 }],
    source: { drawing: 'A-101', page: 2, revision: 'P03' },
    evidenceConfidence: 0.96
  }]
});

assert.strictEqual(measured.measurements[0].quantity, 14.7);
assert.strictEqual(measured.measurements[1].quantity, 23.11);
assert.strictEqual(measured.measurements[1].state, engine.STATES.DETECTED);
assert.strictEqual(measured.overallConfidence, 0.965);

const testDrawingText = `
  QuantisAI — BOQ ENGINE TEST DRAWING
  Drawing: A-103   |   Title: Ground Floor Plan
  Revision: P01
  10.00m OVERALL
  5.00m OVERALL
  WALL HEIGHT: 2.40m
  LIVING / DINING 6.00m × 3.00m
  KITCHEN 4.00m × 3.00m
  BEDROOM 1 6.00m × 2.00m
  BEDROOM 2 4.00m × 2.00m
  D01 External door 0.90 × 2.10 = 1.89 m²
  W01 Window 1.20 × 1.20 = 1.44 m²
  W02 Window 1.20 × 1.20 = 1.44 m²
  W03 Window 1.20 × 1.20 = 1.44 m²
  W04 Window 1.20 × 1.20 = 1.44 m²
  W05 Window 1.20 × 1.20 = 1.44 m²
`;

const parsed = engine.fromExtractedText(testDrawingText);
assert.ok(parsed, 'explicit drawing text should be deterministically parseable');
assert.strictEqual(parsed.source.drawing, 'A-103');
assert.strictEqual(parsed.source.revision, 'P01');
assert.strictEqual(parsed.rooms.length, 4);
assert.strictEqual(parsed.openings.length, 6);
assert.strictEqual(parsed.walls[0].length, 30);
assert.strictEqual(parsed.walls[0].height, 2.4);

const parsedTakeoff = engine.fromDrawingInterpretation(parsed);
const floorArea = parsedTakeoff.measurements
  .filter(m => m.section === 'Floor Areas')
  .reduce((sum, m) => sum + m.quantity, 0);
const externalWall = parsedTakeoff.measurements.find(m => m.section === 'External Walls' && m.unit === 'm²');

assert.strictEqual(floorArea, 50);
assert.ok(externalWall, 'external wall area must be generated');
assert.strictEqual(externalWall.quantity, 62.91);
assert.strictEqual(externalWall.calculation, '30 × 2.4 − 9.09');
assert.strictEqual(externalWall.source.drawing, 'A-103');
assert.strictEqual(externalWall.source.revision, 'P01');
assert.strictEqual(externalWall.source.page, 1);
assert.strictEqual(externalWall.state, engine.STATES.DETECTED);

const boq = engine.buildBoQ(measured);
assert.strictEqual(boq.items.length, 2);
assert.strictEqual(boq.items[1].quantity, 23.11);
assert.strictEqual(boq.items[1].source.drawing, 'A-101');
assert.strictEqual(boq.items[1].calculation, '10 × 2.5 − 1.89');
assert.strictEqual(boq.pricingStatus, 'RATE_DATA_REQUIRED');

console.log('BoQ engine tests: PASS');
