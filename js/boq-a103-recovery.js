/* QuantisAI deterministic drawing recovery adapter. It upgrades the existing engine's
 * extracted-text parser for explicit architectural control drawings where overall
 * dimensions are presented on separate lines. No AI quantity is accepted as arithmetic.
 */
(function (global) {
  'use strict';

  const base = global.DeterministicBOQEngine;
  if (!base) {
    console.error('[BOQ A103 RECOVERY] DeterministicBOQEngine is not loaded.');
    return;
  }

  const number = (value) => {
    const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  };

  const sourceFor = (drawing, revision) => ({ drawing: drawing || null, revision: revision || null, page: 1 });

  function parseExplicitDrawingText(text, fallbackSource = {}) {
    if (typeof text !== 'string' || !text.trim()) return null;

    const drawingMatch = text.match(/Drawing\s*:\s*([A-Z0-9-]+)/i);
    const revisionMatch = text.match(/Revision\s*:\s*([A-Z0-9-]+)/i);
    const source = sourceFor(
      drawingMatch ? drawingMatch[1].trim() : fallbackSource.drawing,
      revisionMatch ? revisionMatch[1].trim() : fallbackSource.revision
    );

    const overallValues = [...text.matchAll(/(\d+(?:\.\d+)?)\s*m\s+OVERALL/gi)].map(m => Number(m[1]));
    if (overallValues.length < 2) return null;

    const length = Math.max(...overallValues.slice(0, 2));
    const width = Math.min(...overallValues.slice(0, 2));
    const wallHeightMatch = text.match(/WALL\s+HEIGHT\s*:\s*(\d+(?:\.\d+)?)\s*m/i);
    const wallHeight = wallHeightMatch ? Number(wallHeightMatch[1]) : null;
    if (!(length > 0 && width > 0 && wallHeight > 0)) return null;

    const openings = [];
    const openingRegex = /\b(D\d+|W\d+)\b\s+[^\n\r]*?(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(?:m|m²)?/gi;
    let match;
    while ((match = openingRegex.exec(text)) !== null) {
      const id = match[1].toUpperCase();
      const openingWidth = number(match[2]);
      const openingHeight = number(match[3]);
      if (openingWidth > 0 && openingHeight > 0) {
        openings.push({ id, type: id.startsWith('D') ? 'door' : 'window', width: openingWidth, height: openingHeight, source });
      }
    }

    const rooms = [];
    const roomNames = ['LIVING / DINING', 'KITCHEN', 'BEDROOM 1', 'BEDROOM 2'];
    for (const name of roomNames) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const roomMatch = text.match(new RegExp(`${escaped}\\s+(\\d+(?:\\.\\d+)?)\\s*m?\\s*[×x]\\s*(\\d+(?:\\.\\d+)?)\\s*m`, 'i'));
      if (roomMatch) {
        rooms.push({
          name,
          length: Number(roomMatch[1]),
          width: Number(roomMatch[2]),
          source,
          evidenceConfidence: 1
        });
      }
    }

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
        {
          type: 'area',
          description: 'Overall floor area',
          length,
          width,
          unit: 'm²',
          section: 'Floor Areas',
          source,
          evidenceConfidence: 1
        },
        {
          type: 'linear',
          description: 'External wall perimeter',
          length: perimeter,
          unit: 'm',
          section: 'External Walls',
          source,
          evidenceConfidence: 1
        }
      ]
    };

    return data;
  }

  const upgraded = Object.assign({}, base, {
    fromExtractedText(text, fallbackSource = {}) {
      return parseExplicitDrawingText(text, fallbackSource) || base.fromExtractedText(text, fallbackSource);
    }
  });

  global.DeterministicBOQEngine = Object.freeze(upgraded);
})(typeof window !== 'undefined' ? window : globalThis);
