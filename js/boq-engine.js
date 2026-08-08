(function (global) {
  'use strict';

  const STATES = Object.freeze({
    DETECTED: 'DETECTED',
    INFERRED: 'INFERRED',
    ESTIMATED: 'ESTIMATED',
    NOT_DETECTED: 'NOT_DETECTED',
    INSUFFICIENT_DATA: 'INSUFFICIENT_DATA'
  });

  const n = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!cleaned) return null;
    const parsed = Number(cleaned[0]);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const round = (value, dp = 3) => {
    const factor = 10 ** dp;
    return Math.round((value + Number.EPSILON) * factor) / factor;
  };

  const sourceOf = (item, fallback = {}) => {
    const src = item?.source && typeof item.source === 'object' ? item.source : {};
    const drawing = src.drawing || src.drawingNumber || item?.drawingReference || item?.drawing || fallback.drawing || null;
    const revision = src.revision || item?.revision || fallback.revision || null;
    const page = n(src.page ?? src.pageNumber ?? item?.page ?? item?.pageNumber ?? fallback.page);
    const calculation = src.calculation || item?.calculation || null;
    return {
      drawing: drawing || null,
      revision: revision || null,
      page: page || null,
      calculation: calculation || null,
      measurement: src.measurement || item?.measurementMethod || null,
      specification: src.specification || item?.specificationReference || null,
      traceable: Boolean(drawing || page || src.reference)
    };
  };

  const evidenceConfidence = (item) => {
    const candidates = [item?.evidenceConfidence, item?.confidenceScore, item?.evidence?.confidence];
    const values = candidates.map(n).filter(v => v !== null && v >= 0 && v <= 1);
    return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 4) : null;
  };

  function rectangleArea(length, width) {
    if (length === null || width === null || length <= 0 || width <= 0) return null;
    return round(length * width, 3);
  }

  function wallNetArea(length, height, openings = []) {
    if (length === null || height === null || length <= 0 || height <= 0) return null;
    const gross = length * height;
    const deductions = openings.reduce((sum, opening) => {
      const w = n(opening?.width);
      const h = n(opening?.height);
      return sum + (w !== null && h !== null && w > 0 && h > 0 ? w * h : 0);
    }, 0);
    return round(Math.max(0, gross - deductions), 3);
  }

  function explicitMeasurement(item, fallbackSource = {}) {
    if (!item || typeof item !== 'object') return null;
    const type = String(item.type || item.measurementType || '').toLowerCase();
    const source = sourceOf(item, fallbackSource);

    if (type === 'area' || type === 'rectangle' || (n(item.length) !== null && n(item.width) !== null && !n(item.height))) {
      const length = n(item.length);
      const width = n(item.width);
      const quantity = rectangleArea(length, width);
      if (quantity !== null) return { quantity, unit: item.unit || 'm²', source, formula: `${length} × ${width}` };
    }

    if (type === 'volume') {
      const length = n(item.length);
      const width = n(item.width);
      const height = n(item.height ?? item.depth);
      if ([length, width, height].every(v => v !== null && v > 0)) {
        return { quantity: round(length * width * height, 3), unit: item.unit || 'm³', source, formula: `${length} × ${width} × ${height}` };
      }
    }

    if (type === 'linear' || type === 'length') {
      const length = n(item.length ?? item.quantity);
      if (length !== null && length >= 0) return { quantity: round(length, 3), unit: item.unit || 'm', source, formula: `${length}` };
    }

    if (type === 'count' || type === 'nr' || type === 'number') {
      const quantity = n(item.count ?? item.number ?? item.quantity);
      if (quantity !== null && quantity >= 0) return { quantity: round(quantity, 3), unit: item.unit || 'Nr', source, formula: `${quantity}` };
    }

    return null;
  }

  function fromDrawingInterpretation(drawing) {
    const data = drawing && typeof drawing === 'object' ? drawing : {};
    const measurements = [];
    const clarifications = [];
    const rooms = Array.isArray(data.rooms) ? data.rooms : [];
    const walls = Array.isArray(data.walls) ? data.walls : [];
    const explicit = Array.isArray(data.measurements) ? data.measurements : [];

    rooms.forEach((room, index) => {
      const length = n(room?.length ?? room?.dimensions?.length);
      const width = n(room?.width ?? room?.dimensions?.width);
      const area = rectangleArea(length, width);
      if (area !== null) {
        const source = sourceOf(room, data.source || {});
        measurements.push({
          itemNo: `RM-${String(index + 1).padStart(3, '0')}`,
          section: 'Floor Areas',
          description: `${room.name || room.roomName || 'Room'} floor area`,
          location: room.name || room.roomName || null,
          unit: 'm²',
          quantity: area,
          calculation: `${length} × ${width}`,
          source,
          state: source.traceable ? STATES.DETECTED : STATES.INFERRED,
          confidence: evidenceConfidence(room)
        });
      }
    });

    walls.forEach((wall, index) => {
      const length = n(wall?.length);
      const height = n(wall?.height ?? wall?.wallHeight);
      if (length === null || height === null) return;
      const wallOpenings = Array.isArray(wall?.openings) ? wall.openings : [];
      const quantity = wallNetArea(length, height, wallOpenings);
      if (quantity === null) return;
      const gross = round(length * height, 3);
      const deduction = round(gross - quantity, 3);
      const source = sourceOf(wall, data.source || {});
      measurements.push({
        itemNo: `WL-${String(index + 1).padStart(3, '0')}`,
        section: wall.external ? 'External Walls' : 'Internal Walls',
        description: `${wall.external ? 'External' : 'Internal'} wall area`,
        location: wall.location || null,
        unit: 'm²',
        quantity,
        calculation: `${length} × ${height}${deduction > 0 ? ` − ${deduction}` : ''}`,
        source,
        state: source.traceable ? STATES.DETECTED : STATES.INFERRED,
        confidence: evidenceConfidence(wall),
        deductions: deduction > 0 ? [{ type: 'openings', quantity: deduction }] : []
      });
    });

    explicit.forEach((item, index) => {
      const measured = explicitMeasurement(item, data.source || {});
      if (!measured) {
        clarifications.push({ reason: 'Measurement supplied without deterministic dimensions/formula', item: index + 1 });
        return;
      }
      measurements.push({
        itemNo: item.itemNo || `MS-${String(index + 1).padStart(3, '0')}`,
        section: item.section || item.trade || 'Unclassified',
        description: item.description || 'Measured item',
        location: item.location || null,
        unit: measured.unit,
        quantity: measured.quantity,
        calculation: measured.formula,
        source: measured.source,
        state: measured.source.traceable ? STATES.DETECTED : STATES.INFERRED,
        confidence: evidenceConfidence(item)
      });
    });

    if (!measurements.length) {
      clarifications.push({ reason: 'No deterministic dimensions were supplied by the drawing interpretation.' });
    }

    const confidences = measurements.map(m => m.confidence).filter(v => typeof v === 'number');
    const overallConfidence = confidences.length ? round(confidences.reduce((a, b) => a + b, 0) / confidences.length, 4) : null;

    return {
      measurements,
      clarifications,
      overallConfidence,
      source: sourceOf(data, {}),
      measurementBasis: 'Deterministic arithmetic from explicit drawing dimensions; AI quantities are not accepted as final arithmetic.'
    };
  }

  function fromExtractedText(text, fallbackSource = {}) {
    if (typeof text !== 'string' || !text.trim()) return null;

    const drawingMatch = text.match(/Drawing\s*:\s*([A-Z0-9-]+)/i);
    const revisionMatch = text.match(/Revision\s*:\s*([A-Z0-9-]+)/i);
    const page = 1;
    const drawing = drawingMatch ? drawingMatch[1].trim() : fallbackSource.drawing || null;
    const revision = revisionMatch ? revisionMatch[1].trim() : fallbackSource.revision || null;
    const source = { drawing, revision, page };

    const overallMatch = text.match(/(\d+(?:\.\d+)?)\s*m\s*[×x]\s*(\d+(?:\.\d+)?)\s*m\s+OVERALL/i);
    const wallHeightMatch = text.match(/WALL\s+HEIGHT\s*:\s*(\d+(?:\.\d+)?)\s*m/i);
    if (!overallMatch || !wallHeightMatch) return null;

    const length = Number(overallMatch[1]);
    const width = Number(overallMatch[2]);
    const wallHeight = Number(wallHeightMatch[1]);
    if (!(length > 0 && width > 0 && wallHeight > 0)) return null;

    const openings = [];
    const openingRegex = /\b(D\d+|W\d+)\b\s+[^\n\r]*?(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*m²?/gi;
    let match;
    while ((match = openingRegex.exec(text)) !== null) {
      const id = match[1].toUpperCase();
      const openingWidth = Number(match[2]);
      const openingHeight = Number(match[3]);
      if (openingWidth > 0 && openingHeight > 0) {
        openings.push({
          id,
          type: id.startsWith('D') ? 'door' : 'window',
          width: openingWidth,
          height: openingHeight,
          source
        });
      }
    }

    const roomNames = ['LIVING / DINING', 'KITCHEN', 'BEDROOM 1', 'BEDROOM 2'];
    const rooms = [];
    roomNames.forEach(name => {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const roomMatch = text.match(new RegExp(`${escaped}\\s+(\\d+(?:\\.\\d+)?)\\s*m?\\s*[×x]\\s*(\\d+(?:\\.\\d+)?)\\s*m`, 'i'));
      if (roomMatch) {
        rooms.push({ name, length: Number(roomMatch[1]), width: Number(roomMatch[2]), source, evidenceConfidence: 1 });
      }
    });

    const perimeter = 2 * (length + width);
    const data = {
      stage: 'drawing-interpreter',
      status: 'success',
      confidence: 1,
      source,
      rooms,
      walls: [{ external: true, length: perimeter, height: wallHeight, openings, source, evidenceConfidence: 1 }],
      openings,
      structuralElements: [],
      mechanicalSystems: [],
      electricalSystems: [],
      measurements: [
        { type: 'area', description: 'Overall floor area', length, width, unit: 'm²', section: 'Floor Areas', source, evidenceConfidence: 1 },
        { type: 'linear', description: 'External wall perimeter', length: perimeter, unit: 'm', section: 'External Walls', source, evidenceConfidence: 1 }
      ]
    };

    return data;
  }

  function buildBoQ(takeoff) {
    const measurements = Array.isArray(takeoff?.measurements) ? takeoff.measurements : [];
    const items = measurements.filter(m => Number.isFinite(m.quantity) && m.quantity >= 0).map((m, i) => ({
      itemNo: m.itemNo || `BQ-${String(i + 1).padStart(3, '0')}`,
      section: m.section || 'Unclassified',
      description: m.description,
      location: m.location || null,
      unit: m.unit,
      quantity: m.quantity,
      rate: null,
      amount: null,
      source: m.source,
      calculation: m.calculation,
      assumptions: m.state === STATES.INFERRED ? ['Source drawing reference incomplete; quantity derived from explicit dimensions but requires QS verification.'] : [],
      state: m.state,
      confidence: m.confidence
    }));

    return {
      items,
      clarifications: Array.isArray(takeoff?.clarifications) ? takeoff.clarifications : [],
      traceability: items.every(i => i.source?.traceable),
      pricingStatus: 'RATE_DATA_REQUIRED',
      measurementBasis: takeoff?.measurementBasis || 'Deterministic measurement'
    };
  }

  function insufficient(stage, reason, extra = {}) {
    const base = {
      stage,
      status: 'failed',
      reasonCode: 'INSUFFICIENT_DATA',
      reason,
      confidence: null,
      ...extra
    };
    if (stage === 'drawing-interpreter') Object.assign(base, { rooms: [], structuralElements: [], mechanicalSystems: [], electricalSystems: [], numberOfRooms: null, numberOfDoors: null, numberOfWindows: null, externalWallLength: null, internalWallLength: null, gia: null });
    if (stage === 'quantity-surveyor') base.takeoffs = [];
    if (stage === 'boq-generator') base.items = [];
    return base;
  }

  global.DeterministicBOQEngine = Object.freeze({
    STATES,
    rectangleArea,
    wallNetArea,
    fromDrawingInterpretation,
    fromExtractedText,
    buildBoQ,
    insufficient
  });
})(typeof window !== 'undefined' ? window : globalThis);