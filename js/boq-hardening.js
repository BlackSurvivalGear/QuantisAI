(function (global) {
  'use strict';

  const engine = global.DeterministicBOQEngine;
  const pipeline = global.BQAIPipeline;
  if (!engine || !pipeline || !pipeline.AIRunner) {
    console.error('[BOQ HARDENING] Required pipeline objects were not loaded.');
    return;
  }

  const EVIDENCE_STAGES = new Set(['drawing-interpreter', 'quantity-surveyor', 'boq-generator', 'cost-estimator', 'quotation-generator']);
  const liveProvider = (provider) => Boolean(provider?.enabled && provider?.apiKey && String(provider.apiKey).trim().length >= 5);
  const currentProvider = (provider) => provider || (typeof global.getBQAIEngineProvider === 'function' ? global.getBQAIEngineProvider() : null);

  function fail(stage, reason, extra = {}, provider = null) {
    return { success: true, stage, data: engine.insufficient(stage, reason, extra), tokens: 0, model: provider?.defaultModel || '' };
  }

  const originalExecute = pipeline.AIRunner.execute.bind(pipeline.AIRunner);

  pipeline.AIRunner.execute = async function (stageId, promptFile, inputData, providerSetting) {
    const provider = currentProvider(providerSetting);

    if (EVIDENCE_STAGES.has(stageId) && !liveProvider(provider)) {
      return fail(stageId, 'A live AI provider is required for drawing interpretation; deterministic arithmetic cannot create geometry absent from the source data.', {}, provider);
    }

    const result = await originalExecute(stageId, promptFile, inputData, providerSetting);
    if (!result || !result.success || !result.data) return result;

    if (stageId === 'drawing-interpreter') {
      const takeoff = engine.fromDrawingInterpretation(result.data);
      if (!takeoff.measurements.length) {
        return fail(stageId, 'Drawing interpretation did not return explicit measurable dimensions. No quantities may be fabricated.', {
          rooms: Array.isArray(result.data.rooms) ? result.data.rooms : [],
          structuralElements: Array.isArray(result.data.structuralElements) ? result.data.structuralElements : [],
          mechanicalSystems: Array.isArray(result.data.mechanicalSystems) ? result.data.mechanicalSystems : [],
          electricalSystems: Array.isArray(result.data.electricalSystems) ? result.data.electricalSystems : []
        }, provider);
      }

      const data = { ...result.data };
      const rooms = Array.isArray(data.rooms) ? data.rooms : [];
      const walls = Array.isArray(data.walls) ? data.walls : [];
      const openings = Array.isArray(data.openings) ? data.openings : [];
      data.numberOfRooms = rooms.length || null;
      data.numberOfDoors = openings.filter(o => String(o?.type || '').toLowerCase().includes('door')).length || null;
      data.numberOfWindows = openings.filter(o => String(o?.type || '').toLowerCase().includes('window')).length || null;
      data.externalWallLength = walls.filter(w => w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
      data.internalWallLength = walls.filter(w => !w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
      data.gia = takeoff.measurements.filter(m => m.section === 'Floor Areas').reduce((sum, m) => sum + m.quantity, 0) || null;
      data.confidence = takeoff.overallConfidence;
      data.deterministicTakeoff = takeoff;
      data.measurementState = 'DETECTED';
      result.data = data;
      return result;
    }

    if (stageId === 'quantity-surveyor') {
      const drawingData = inputData?.['drawing-interpreter'];
      const takeoff = drawingData?.deterministicTakeoff;
      if (!takeoff?.measurements?.length) {
        return fail(stageId, 'No deterministic drawing measurements are available. AI-supplied quantities are not accepted as final take-off arithmetic.', {}, provider);
      }
      result.data = {
        stage: stageId,
        status: 'success',
        confidence: takeoff.overallConfidence,
        takeoffs: takeoff.measurements.map(m => ({ ...m })),
        clarifications: takeoff.clarifications || [],
        measurementBasis: takeoff.measurementBasis,
        source: 'DeterministicBOQEngine'
      };
      return result;
    }

    if (stageId === 'boq-generator') {
      const quantityData = inputData?.['quantity-surveyor'];
      const takeoff = quantityData ? { measurements: quantityData.takeoffs || [], clarifications: quantityData.clarifications || [], measurementBasis: quantityData.measurementBasis } : null;
      if (!takeoff?.measurements?.length) {
        return fail(stageId, 'No deterministic quantity take-off is available. BOQ generation is blocked.', {}, provider);
      }
      const boq = engine.buildBoQ(takeoff);
      if (!boq.items.length) {
        return fail(stageId, 'No valid measured BOQ items could be generated.', { items: [], clarifications: boq.clarifications }, provider);
      }
      result.data = {
        stage: stageId,
        status: 'success',
        confidence: quantityData.confidence ?? null,
        items: boq.items,
        clarifications: boq.clarifications,
        traceability: boq.traceability,
        pricingStatus: boq.pricingStatus,
        measurementBasis: boq.measurementBasis,
        source: 'DeterministicBOQEngine'
      };
      return result;
    }

    if (stageId === 'cost-estimator') {
      const boq = inputData?.['boq-generator'];
      const items = Array.isArray(boq?.items) ? boq.items : [];
      if (!items.length || items.some(i => i.rate === null || i.rate === undefined)) {
        return fail(stageId, 'BOQ quantities are present but no authoritative rate data is attached. Pricing is blocked rather than invented.', { pricingStatus: 'RATE_DATA_REQUIRED' }, provider);
      }
    }

    return result;
  };

  const originalSimulated = pipeline.AIRunner.generateSimulatedOutput?.bind(pipeline.AIRunner);
  if (originalSimulated) {
    pipeline.AIRunner.generateSimulatedOutput = function (stageId, inputData) {
      if (EVIDENCE_STAGES.has(stageId)) return engine.insufficient(stageId, 'Simulation is disabled for measurement, BOQ and pricing stages.');
      return originalSimulated(stageId, inputData);
    };
  }

  global.QuantisAIBOQHardening = Object.freeze({ version: '1.0.0', evidenceStages: Array.from(EVIDENCE_STAGES) });
})(typeof window !== 'undefined' ? window : globalThis);