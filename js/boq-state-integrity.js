/* QuantisAI BoQ pipeline state integrity guard.
 * Prevents legacy simulated drawing/QS/BOQ/pricing data from being surfaced as real measurements.
 */
(function (global) {
  'use strict';

  const pipeline = global.BQAIPipeline;
  if (!pipeline || !pipeline.AIRunner || !pipeline.Manager) {
    console.error('[BOQ STATE INTEGRITY] Required pipeline objects were not loaded.');
    return;
  }

  const EVIDENCE_STAGES = new Set([
    'drawing-interpreter',
    'quantity-surveyor',
    'boq-generator',
    'cost-estimator',
    'quotation-generator'
  ]);

  const originalSimulated = pipeline.AIRunner.generateSimulatedOutput?.bind(pipeline.AIRunner);
  if (originalSimulated) {
    pipeline.AIRunner.generateSimulatedOutput = function (stageId, inputData) {
      if (EVIDENCE_STAGES.has(stageId)) {
        const engine = global.DeterministicBOQEngine;
        return engine
          ? engine.insufficient(stageId, 'Simulation is disabled for evidence stages. Use explicit drawing measurements or a live verified result.')
          : { stage: stageId, status: 'failed', reason: 'Simulation disabled for evidence stage.' };
      }
      return originalSimulated(stageId, inputData);
    };
  }

  const originalExecutePipeline = pipeline.Manager.executePipeline.bind(pipeline.Manager);
  pipeline.Manager.executePipeline = async function (onStatusChange, onProgressChange, startStageId = null) {
    const result = await originalExecutePipeline(onStatusChange, onProgressChange, startStageId);
    const outputs = pipeline.state.stageOutputs || {};
    const failedEvidence = Array.from(EVIDENCE_STAGES).find(stageId => {
      const output = outputs[stageId];
      return output && (output.status === 'failed' || output.status === 'skipped');
    });

    const drawing = outputs['drawing-interpreter'];
    const hasMeasuredDrawing = drawing && drawing.status === 'success' && Array.isArray(drawing.deterministicTakeoff?.measurements) && drawing.deterministicTakeoff.measurements.length > 0;
    const boq = outputs['boq-generator'];
    const hasBoq = boq && boq.status === 'success' && Array.isArray(boq.items) && boq.items.length > 0;

    if (failedEvidence || !hasMeasuredDrawing || !hasBoq) {
      const reason = failedEvidence
        ? `Evidence stage '${failedEvidence}' did not complete.`
        : 'No authoritative deterministic drawing take-off and BOQ were produced.';

      pipeline.state.overallStatus = 'failed';
      pipeline.state.overallFailureReason = reason;
      pipeline.state.measurementConfidence = null;
      pipeline.state.estimateConfidence = null;

      // Remove downstream financial state so a previous or simulated estimate cannot survive a failed run.
      if (global.activeProject?.financials) {
        delete global.activeProject.financials;
      }

      for (const stageId of ['quantity-surveyor', 'boq-generator', 'cost-estimator', 'quotation-generator']) {
        const output = outputs[stageId];
        if (!output || output.status !== 'success') {
          outputs[stageId] = {
            stage: stageId,
            status: 'skipped',
            reason: 'Blocked because authoritative deterministic measurement/BOQ data is unavailable.'
          };
        }
      }

      if (typeof pipeline.Persistence?.saveStages === 'function') {
        pipeline.Persistence.saveStages(outputs);
      }
      if (typeof global.saveWorkspaceToLocalStorage === 'function') {
        global.saveWorkspaceToLocalStorage();
      }
      if (onProgressChange) onProgressChange(`BOQ PIPELINE FAILED: ${reason}`);
      return false;
    }

    pipeline.state.overallStatus = 'success';
    pipeline.state.overallFailureReason = null;
    return Boolean(result);
  };

  global.QuantisAIBOQStateIntegrity = Object.freeze({
    version: '1.0.0',
    evidenceStages: Array.from(EVIDENCE_STAGES)
  });
})(typeof window !== 'undefined' ? window : globalThis);
