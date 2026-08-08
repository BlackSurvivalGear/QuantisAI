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
  const round = (value, dp = 3) => { const factor = 10 ** dp; return Math.round((value + Number.EPSILON) * factor) / factor; };

  const sourceOf = (item, fallback = {}) => {
    const src = item?.source && typeof item.source === 'object' ? item.source : {};
    const drawing = src.drawing || src.drawingNumber || item?.drawingReference || item?.drawing || fallback.drawing || null;
    const revision = src.revision || item?.revision || fallback.revision || null;
    const page = n(src.page ?? src.pageNumber ?? item?.page ?? item?.pageNumber ?? fallback.page);
    return { drawing: drawing || null, revision: revision || null, page: page || null, calculation: src.calculation || item?.calculation || null, measurement: src.measurement || item?.measurementMethod || null, specification: src.specification || item?.specificationReference || null, traceable: Boolean(drawing || page || src.reference) };
  };
  const evidenceConfidence = (item) => {
    const candidates = [item?.evidenceConfidence, item?.confidenceScore, item?.evidence?.confidence];
    const values = candidates.map(n).filter(v => v !== null && v >= 0 && v <= 1);
    return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 4) : null;
  };
  function rectangleArea(length, width) { if (length === null || width === null || length <= 0 || width <= 0) return null; return round(length * width, 3); }
  function wallNetArea(length, height, openings = []) {
    if (length === null || height === null || length <= 0 || height <= 0) return null;
    const gross = length * height;
    const deductions = openings.reduce((sum, opening) => { const w = n(opening?.width), h = n(opening?.height); return sum + (w !== null && h !== null && w > 0 && h > 0 ? w * h : 0); }, 0);
    return round(Math.max(0, gross - deductions), 3);
  }
  function explicitMeasurement(item, fallbackSource = {}) {
    if (!item || typeof item !== 'object') return null;
    const type = String(item.type || item.measurementType || '').toLowerCase(), source = sourceOf(item, fallbackSource);
    if (type === 'area' || type === 'rectangle' || (n(item.length) !== null && n(item.width) !== null && !n(item.height))) { const length = n(item.length), width = n(item.width), quantity = rectangleArea(length, width); if (quantity !== null) return { quantity, unit: item.unit || 'm²', source, formula: `${length} × ${width}` }; }
    if (type === 'volume') { const length = n(item.length), width = n(item.width), height = n(item.height ?? item.depth); if ([length, width, height].every(v => v !== null && v > 0)) return { quantity: round(length * width * height, 3), unit: item.unit || 'm³', source, formula: `${length} × ${width} × ${height}` }; }
    if (type === 'linear' || type === 'length') { const length = n(item.length ?? item.quantity); if (length !== null && length >= 0) return { quantity: round(length, 3), unit: item.unit || 'm', source, formula: `${length}` }; }
    if (type === 'count' || type === 'nr' || type === 'number') { const quantity = n(item.count ?? item.number ?? item.quantity); if (quantity !== null && quantity >= 0) return { quantity: round(quantity, 3), unit: item.unit || 'Nr', source, formula: `${quantity}` }; }
    return null;
  }
  function fromDrawingInterpretation(drawing) {
    const data = drawing && typeof drawing === 'object' ? drawing : {}, measurements = [], clarifications = [];
    const rooms = Array.isArray(data.rooms) ? data.rooms : [], walls = Array.isArray(data.walls) ? data.walls : [], explicit = Array.isArray(data.measurements) ? data.measurements : [];
    rooms.forEach((room, index) => { const length = n(room?.length ?? room?.dimensions?.length), width = n(room?.width ?? room?.dimensions?.width), area = rectangleArea(length, width); if (area !== null) { const source = sourceOf(room, data.source || {}); measurements.push({ itemNo: `RM-${String(index + 1).padStart(3, '0')}`, section: 'Floor Areas', description: `${room.name || room.roomName || 'Room'} floor area`, location: room.name || room.roomName || null, unit: 'm²', quantity: area, calculation: `${length} × ${width}`, source, state: source.traceable ? STATES.DETECTED : STATES.INFERRED, confidence: evidenceConfidence(room) }); } });
    walls.forEach((wall, index) => { const length = n(wall?.length), height = n(wall?.height ?? wall?.wallHeight); if (length === null || height === null) return; const quantity = wallNetArea(length, height, Array.isArray(wall?.openings) ? wall.openings : []); if (quantity === null) return; const gross = round(length * height, 3), deduction = round(gross - quantity, 3), source = sourceOf(wall, data.source || {}); measurements.push({ itemNo: `WL-${String(index + 1).padStart(3, '0')}`, section: wall.external ? 'External Walls' : 'Internal Walls', description: `${wall.external ? 'External' : 'Internal'} wall area`, location: wall.location || null, unit: 'm²', quantity, calculation: `${length} × ${height}${deduction > 0 ? ` − ${deduction}` : ''}`, source, state: source.traceable ? STATES.DETECTED : STATES.INFERRED, confidence: evidenceConfidence(wall), deductions: deduction > 0 ? [{ type: 'openings', quantity: deduction }] : [] }); });
    explicit.forEach((item, index) => { const measured = explicitMeasurement(item, data.source || {}); if (!measured) { clarifications.push({ reason: 'Measurement supplied without deterministic dimensions/formula', item: index + 1 }); return; } measurements.push({ itemNo: item.itemNo || `MS-${String(index + 1).padStart(3, '0')}`, section: item.section || item.trade || 'Unclassified', description: item.description || 'Measured item', location: item.location || null, unit: measured.unit, quantity: measured.quantity, calculation: measured.formula, source: measured.source, state: measured.source.traceable ? STATES.DETECTED : STATES.INFERRED, confidence: evidenceConfidence(item) }); });
    if (!measurements.length) clarifications.push({ reason: 'No deterministic dimensions were supplied by the drawing interpretation.' });
    const confidences = measurements.map(m => m.confidence).filter(v => typeof v === 'number');
    return { measurements, clarifications, overallConfidence: confidences.length ? round(confidences.reduce((a, b) => a + b, 0) / confidences.length, 4) : null, source: sourceOf(data, {}), measurementBasis: 'Deterministic arithmetic from explicit drawing dimensions; AI quantities are not accepted as final arithmetic.' };
  }
  function parseRevision(text, fallback) { const match = text.match(/(?:drawing\s+)?revision\s*[:\-]?\s*([A-Z0-9-]+)/i) || text.match(/\brev\.?\s*[:\-]?\s*([A-Z0-9-]+)/i); return match ? match[1].trim() : fallback || null; }
  function parseDrawingNumber(text, fallback) { const match = text.match(/(?:drawing\s*(?:number|no\.?|reference)?|sheet)\s*[:\-]?\s*([A-Z]{1,3}-?\d{2,4})/i) || text.match(/\b(A-?\d{3})\b/i); return match ? match[1].trim().replace(/^A(?=\d)/i, 'A-') : fallback || null; }
  function parseControlData(text) {
    const controls = {}, patterns = {
      overallFootprint: /overall\s+footprint\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*m/i,
      externalWallLength: /external\s+wall\s+length\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i,
      grossExternalWallArea: /gross\s+external\s+wall\s+area\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i,
      openingDeduction: /(?:total\s+)?opening\s+deduction\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i,
      netExternalWallArea: /net\s+external\s+wall\s+area\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i,
      floorArea: /floor\s+area\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i,
      rooms: /\brooms\s*[:\-]?\s*(\d+)/i, doors: /\bdoors\s*[:\-]?\s*(\d+)/i, windows: /\bwindows\s*[:\-]?\s*(\d+)/i
    };
    Object.entries(patterns).forEach(([key, pattern]) => { const match = text.match(pattern); if (!match) return; controls[key] = key === 'overallFootprint' ? { length: Number(match[1]), width: Number(match[2]) } : Number(match[1]); });
    return controls;
  }
  function compareControl(label, actual, expected, tolerance = 0.01) { if (expected === undefined || expected === null || actual === null || actual === undefined) return null; const difference = round(Number(actual) - Number(expected), 3); return { label, actual: Number(actual), expected: Number(expected), pass: Math.abs(difference) <= tolerance, difference }; }

  function fromExtractedText(text, fallbackSource = {}) {
    if (typeof text !== 'string' || !text.trim()) return null;
    const drawing = parseDrawingNumber(text, fallbackSource.drawing || null), revision = parseRevision(text, fallbackSource.revision || null), source = { drawing, revision, page: 1 }, controls = parseControlData(text);
    const overallMatch = text.match(/(\d+(?:\.\d+)?)\s*m?\s*[×x]\s*(\d+(?:\.\d+)?)\s*m?\s+OVERALL/i) || text.match(/(\d+(?:\.\d+)?)\s*m\s+OVERALL\s+(\d+(?:\.\d+)?)\s*m\s+OVERALL/i);
    const wallHeightMatch = text.match(/WALL\s+HEIGHT\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*m/i);
    if (!overallMatch || !wallHeightMatch) return null;
    const length = Number(overallMatch[1]), width = Number(overallMatch[2]), wallHeight = Number(wallHeightMatch[1]); if (!(length > 0 && width > 0 && wallHeight > 0)) return null;
    const page2Index = text.search(/(?:^|\n)\s*(?:Page\s*2\b|A-?201\s+ROOF\s*\/\s*SECTION|ROOF\s*\/\s*SECTION\s*\/\s*CONSTRUCTION)/i), page1Text = page2Index >= 0 ? text.slice(0, page2Index) : text, page2Text = page2Index >= 0 ? text.slice(page2Index) : '';

    const openings = [], openingRegex = /\b(D\d+|W\d+)\b[^\n\r]*?(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/gi; let openingMatch;
    while ((openingMatch = openingRegex.exec(page1Text)) !== null) { const id = openingMatch[1].toUpperCase(), openingWidth = Number(openingMatch[2]), openingHeight = Number(openingMatch[3]); if (openingWidth > 0 && openingHeight > 0) openings.push({ id, type: id.startsWith('D') ? 'door' : 'window', width: openingWidth, height: openingHeight, source: { ...source, page: 1 } }); }

    const roomDefinitions = [['LIVING / DINING', /LIVING\s*\/\s*DINING/], ['KITCHEN', /KITCHEN/], ['MASTER BED', /MASTER\s+BED(?:ROOM)?/], ['ENSUITE', /ENSUITE/], ['BEDROOM 2', /BEDROOM\s*2/], ['BEDROOM 3', /BEDROOM\s*3/], ['STUDY', /STUDY/], ['UTILITY', /UTILITY/]], rooms = [];
    roomDefinitions.forEach(([name, labelPattern]) => { const match = page1Text.match(new RegExp(labelPattern.source + '\\s+(\\d+(?:\\.\\d+)?)\\s*m?\\s*[×x]\\s*(\\d+(?:\\.\\d+)?)\\s*m?', 'i')); if (match) rooms.push({ name, length: Number(match[1]), width: Number(match[2]), source: { ...source, page: 1 }, evidenceConfidence: 1 }); });

    const structuralElements = [], structuralRegex = /^\s*(S\d+)\b([^\n\r]*?)(\d+(?:\.\d+)?)\s*m\b/i;
    page2Text.split(/\r?\n/).forEach(line => { const match = line.match(structuralRegex); if (match) structuralElements.push({ id: match[1].toUpperCase(), description: match[2].trim(), length: Number(match[3]), unit: 'm', source: { ...source, page: 2 }, evidenceConfidence: 1 }); });

    const constructionInfo = {}, knownConstructionKeys = new Set(['External wall', 'Floor', 'Roof', 'Insulation', 'Ceiling', 'Internal partitions', 'Finishes']);
    page2Text.split(/\r?\n/).forEach(line => { const match = line.match(/^\s*([^:]{2,35}):\s*(.+)$/); if (!match) return; const key = match[1].trim(); if (knownConstructionKeys.has(key)) constructionInfo[key] = match[2].trim(); });

    const perimeter = 2 * (length + width), data = {
      stage: 'drawing-interpreter', status: 'success', confidence: 1, source, pagesProcessed: page2Index >= 0 ? 2 : 1, rooms, openings,
      walls: [{ external: true, length: perimeter, height: wallHeight, openings, source: { ...source, page: 1 }, evidenceConfidence: 1 }], structuralElements, constructionInfo,
      mechanicalSystems: [], electricalSystems: [], measurements: [
        { type: 'area', description: 'Overall floor area', length, width, unit: 'm²', section: 'Floor Areas', source: { ...source, page: 1 }, evidenceConfidence: 1 },
        { type: 'linear', description: 'External wall perimeter', length: perimeter, unit: 'm', section: 'External Walls', source: { ...source, page: 1 }, evidenceConfidence: 1 }
      ], controlData: controls
    };
    const roomArea = rooms.reduce((sum, room) => sum + rectangleArea(room.length, room.width), 0), wallGross = rectangleArea(perimeter, wallHeight), wallNet = wallNetArea(perimeter, wallHeight, openings), openingDeduction = wallGross === null || wallNet === null ? null : round(wallGross - wallNet, 3);
    data.controlValidation = {
      footprint: controls.overallFootprint ? { length: compareControl('Overall length', length, controls.overallFootprint.length), width: compareControl('Overall width', width, controls.overallFootprint.width) } : null,
      roomCount: compareControl('Rooms', rooms.length, controls.rooms, 0), doorCount: compareControl('Doors', openings.filter(o => o.type === 'door').length, controls.doors, 0), windowCount: compareControl('Windows', openings.filter(o => o.type === 'window').length, controls.windows, 0),
      floorArea: compareControl('Floor area', roomArea, controls.floorArea), externalWallLength: compareControl('External wall length', perimeter, controls.externalWallLength), grossExternalWallArea: compareControl('Gross external wall area', wallGross, controls.grossExternalWallArea), openingDeduction: compareControl('Opening deduction', openingDeduction, controls.openingDeduction), netExternalWallArea: compareControl('Net external wall area', wallNet, controls.netExternalWallArea)
    };
    data.recovery = { method: 'OCR_TEXT_DETERMINISTIC_PARSE', note: 'All recovered quantities are calculated from explicit source dimensions. QS control values are used only for validation, never as replacement quantities.' };
    return data;
  }

  function buildBoQ(takeoff) {
    const measurements = Array.isArray(takeoff?.measurements) ? takeoff.measurements : [];
    const items = measurements.filter(m => Number.isFinite(m.quantity) && m.quantity >= 0).map((m, i) => ({ itemNo: m.itemNo || `BQ-${String(i + 1).padStart(3, '0')}`, section: m.section || 'Unclassified', description: m.description, location: m.location || null, unit: m.unit, quantity: m.quantity, rate: null, amount: null, source: m.source, calculation: m.calculation, assumptions: m.state === STATES.INFERRED ? ['Source drawing reference incomplete; quantity derived from explicit dimensions but requires QS verification.'] : [], state: m.state, confidence: m.confidence }));
    return { items, clarifications: Array.isArray(takeoff?.clarifications) ? takeoff.clarifications : [], traceability: items.every(i => i.source?.traceable), pricingStatus: 'RATE_DATA_REQUIRED', measurementBasis: takeoff?.measurementBasis || 'Deterministic measurement' };
  }
  function insufficient(stage, reason, extra = {}) { const base = { stage, status: 'failed', reasonCode: 'INSUFFICIENT_DATA', reason, confidence: null, ...extra }; if (stage === 'drawing-interpreter') Object.assign(base, { rooms: [], structuralElements: [], mechanicalSystems: [], electricalSystems: [], numberOfRooms: null, numberOfDoors: null, numberOfWindows: null, externalWallLength: null, internalWallLength: null, gia: null }); if (stage === 'quantity-surveyor') base.takeoffs = []; if (stage === 'boq-generator') base.items = []; return base; }
  global.DeterministicBOQEngine = Object.freeze({ STATES, rectangleArea, wallNetArea, fromDrawingInterpretation, fromExtractedText, buildBoQ, insufficient });
})(typeof window !== 'undefined' ? window : globalThis);
