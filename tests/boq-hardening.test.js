const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'boq-hardening.js'), 'utf8');

const sandbox = {
  console,
  DeterministicBOQEngine: {
    insufficient(stage, reason, extra = {}) {
      return { stage, status: 'failed', reason, ...extra };
    }
  },
  BQAIPipeline: {
    AIRunner: {
      async execute() {
        throw new Error('original execute must not run when an evidence-stage provider is unavailable');
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
    {}
  );

  assert.strictEqual(result.success, false, 'blocked evidence stages must report success=false');
  assert.strictEqual(result.data.status, 'failed', 'blocked evidence stages must carry a failed status');
  assert.match(result.data.reason, /live AI provider/i);

  console.log('BoQ hardening integration tests: PASS');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
