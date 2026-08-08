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

const boq = engine.buildBoQ(measured);
assert.strictEqual(boq.items.length, 2);
assert.strictEqual(boq.items[1].quantity, 23.11);
assert.strictEqual(boq.items[1].source.drawing, 'A-101');
assert.strictEqual(boq.items[1].calculation, '10 × 2.5 − 1.89');
assert.strictEqual(boq.pricingStatus, 'RATE_DATA_REQUIRED');

console.log('BoQ engine tests: PASS');
