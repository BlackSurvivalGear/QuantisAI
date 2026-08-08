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
    return { success: false, stage, data: engine.insufficient(stage, reason, extra), tokens: 0, model: provider?.defaultModel || '' };
  }

  function deterministicDrawingRecovery(inputData) {
    const files = Array.isArray(inputData?.uploadedFiles) ? inputData.uploadedFiles : [];
    for (const file of files) {
      if (!file?.extractedText) continue;
      const fallbackSource = {
        drawing: file.drawingNumber || file.drawingReference || null,
        revision: file.revision || null,
        page: 1
      };
      const parsed = engine.fromExtractedText(file.extractedText, fallbackSource);
      if (parsed?.rooms?.length || parsed?.walls?.length || parsed?.measurements?.length) {
        parsed.source = parsed.source || fallbackSource;
        parsed.recovery = {
          method: 'OCR_TEXT_DETERMINISTIC_PARSE',
          note: 'Drawing dimensions were explicitly present in extracted source text. Arithmetic was performed by DeterministicBOQEngine; no AI quantity was accepted as final arithmetic.'
        };
        return parsed;
      }
    }
    return null;
  }

  const originalExecute = pipeline.AIRunner.execute.bind(pipeline.AIRunner);

  pipeline.AIRunner.execute = async function (stageId, promptFile, inputData, providerSetting) {
    const provider = currentProvider(providerSetting);

    if (EVIDENCE_STAGES.has(stageId) && !liveProvider(provider)) {
      if (stageId === 'drawing-interpreter') {
        const recovered = deterministicDrawingRecovery(inputData);
        if (recovered) {
          const takeoff = engine.fromDrawingInterpretation(recovered);
          recovered.numberOfRooms = recovered.rooms.length || null;
          recovered.numberOfDoors = recovered.openings?.filter(o => o.type === 'door').length || null;
          recovered.numberOfWindows = recovered.openings?.filter(o => o.type === 'window').length || null;
          recovered.externalWallLength = recovered.walls.filter(w => w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.internalWallLength = recovered.walls.filter(w => !w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.gia = takeoff.measurements.filter(m => m.section === 'Floor Areas').reduce((sum, m) => sum + m.quantity, 0) || null;
          recovered.confidence = takeoff.overallConfidence;
          recovered.deterministicTakeoff = takeoff;
          recovered.measurementState = 'DETECTED';
          return { success: true, stage: stageId, data: recovered, tokens: 0, model: 'Deterministic OCR Parser' };
        }
      }
      return fail(stageId, 'A live AI provider is required for drawing interpretation when explicit deterministic source measurements are unavailable; quantities may not be fabricated.', {}, provider);
    }

    let result;
    try {
      result = await originalExecute(stageId, promptFile, inputData, providerSetting);
    } catch (err) {
      if (stageId === 'drawing-interpreter') {
        const recovered = deterministicDrawingRecovery(inputData);
        if (recovered) {
          const takeoff = engine.fromDrawingInterpretation(recovered);
          recovered.numberOfRooms = recovered.rooms.length || null;
          recovered.numberOfDoors = recovered.openings?.filter(o => o.type === 'door').length || null;
          recovered.numberOfWindows = recovered.openings?.filter(o => o.type === 'window').length || null;
          recovered.externalWallLength = recovered.walls.filter(w => w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.internalWallLength = recovered.walls.filter(w => !w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.gia = takeoff.measurements.filter(m => m.section === 'Floor Areas').reduce((sum, m) => sum + m.quantity, 0) || null;
          recovered.confidence = takeoff.overallConfidence;
          recovered.deterministicTakeoff = takeoff;
          recovered.measurementState = 'DETECTED';
          return { success: true, stage: stageId, data: recovered, tokens: 0, model: 'Deterministic OCR Parser' };
        }
      }
      throw err;
    }

    if (!result || !result.success || !result.data) return result;

    if (stageId === 'drawing-interpreter') {
      const takeoff = engine.fromDrawingInterpretation(result.data);
      if (!takeoff.measurements.length) {
        const recovered = deterministicDrawingRecovery(inputData);
        if (recovered) {
          const recoveredTakeoff = engine.fromDrawingInterpretation(recovered);
          recovered.numberOfRooms = recovered.rooms.length || null;
          recovered.numberOfDoors = recovered.openings?.filter(o => o.type === 'door').length || null;
          recovered.numberOfWindows = recovered.openings?.filter(o => o.type === 'window').length || null;
          recovered.externalWallLength = recovered.walls.filter(w => w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.internalWallLength = recovered.walls.filter(w => !w.external).reduce((sum, w) => sum + (Number(w.length) || 0), 0) || null;
          recovered.gia = recoveredTakeoff.measurements.filter(m => m.section === 'Floor Areas').reduce((sum, m) => sum + m.quantity, 0) || null;
          recovered.confidence = recoveredTakeoff.overallConfidence;
          recovered.deterministicTakeoff = recoveredTakeoff;
          recovered.measurementState = 'DETECTED';
          return { ...result, data: recovered, model: 'Deterministic OCR Parser' };
        }
        return fail(stageId, 'Drawing interpretation did not return explicit measurable dimensions and no deterministic dimensions could be recovered from the source text. No quantities may be fabricated.', {
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

  global.QuantisAIBOQHardening = Object.freeze({ version: '1.1.0', evidenceStages: Array.from(EVIDENCE_STAGES) });
})(typeof window !== 'undefined' ? window : globalThis);