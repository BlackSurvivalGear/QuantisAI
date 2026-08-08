const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'boq-hardening.js'), 'utf8');

const drawingText = `
Drawing: A-103
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

const sandbox = {
  console,
  DeterministicBOQEngine: {
    insufficient(stage, reason, extra = {}) {
      return { stage, status: 'failed', reason, ...extra };
    },
    fromExtractedText(text, source) {
      if (!text.includes('10.00m OVERALL') || !text.includes('WALL HEIGHT: 2.40m')) return null;
      return {
        stage: 'drawing-interpreter',
        status: 'success',
        source: { drawing: 'A-103', revision: 'P01', page: 1 },
        rooms: [
          { name: 'LIVING / DINING', length: 6, width: 3, source: { drawing: 'A-103', revision: 'P01', page: 1 } },
          { name: 'KITCHEN', length: 4, width: 3, source: { drawing: 'A-103', revision: 'P01', page: 1 } },
          { name: 'BEDROOM 1', length: 6, width: 2, source: { drawing: 'A-103', revision: 'P01', page: 1 } },
          { name: 'BEDROOM 2', length: 4, width: 2, source: { drawing: 'A-103', revision: 'P01', page: 1 } }
        ],
        openings: [
          { type: 'door', width: 0.9, height: 2.1 },
          { type: 'window', width: 1.2, height: 1.2 },
          { type: 'window', width: 1.2, height: 1.2 },
          { type: 'window', width: 1.2, height: 1.2 },
          { type: 'window', width: 1.2, height: 1.2 },
          { type: 'window', width: 1.2, height: 1.2 }
        ],
        walls: [{ external: true, length: 30, height: 2.4, openings: [] }],
        structuralElements: [],
        mechanicalSystems: [],
        electricalSystems: []
      };
    },
    fromDrawingInterpretation(data) {
      const roomArea = (data.rooms || []).reduce((sum, r) => sum + r.length * r.width, 0);
      return {
        measurements: [
          { section: 'Floor Areas', quantity: roomArea }
        ],
        overallConfidence: 1,
        measurementBasis: 'Deterministic test parser'
      };
    }
  },
  BQAIPipeline: {
    AIRunner: {
      async execute() {
        throw new Error('simulated drawing interpreter timeout');
      }
    }
  }
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

(async () => {
  const result = await sandbox.BQAIPipeline.AIRunner.execute(
    'drawing-interpreter',
    'prompts/drawing-interpreter.md',
    { uploadedFiles: [{ name: 'QuantisAI_BoQ_Test_Drawing_A103.pdf', extractedText: drawingText }] }
  );

  assert.strictEqual(result.success, true, 'explicit OCR dimensions should permit deterministic recovery');
  assert.strictEqual(result.data.source.drawing, 'A-103');
  assert.strictEqual(result.data.source.revision, 'P01');
  assert.strictEqual(result.data.numberOfRooms, 4);
  assert.strictEqual(result.data.numberOfDoors, 1);
  assert.strictEqual(result.data.numberOfWindows, 5);
  assert.strictEqual(result.data.externalWallLength, 30);
  assert.strictEqual(result.data.gia, 50);
  assert.strictEqual(result.model, 'Deterministic OCR Parser');

  console.log('BoQ hardening deterministic recovery tests: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
