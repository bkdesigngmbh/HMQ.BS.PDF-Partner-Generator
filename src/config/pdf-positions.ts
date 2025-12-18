/**
 * PDF Position Configuration
 *
 * All coordinates are in PDF points (1 point = 1/72 inch)
 * A4 format: 595 x 842 points
 *
 * Origin (0,0) is at the bottom-left corner of the page
 *
 * Adjust these values if the PDF layout changes.
 */

export const PDF_POSITIONS = {
  // Seite 1: Rechter Banner (komplette Höhe)
  // Überdeckt HMQ-Logo, Geschäftsbereiche, Adressen und SGS-Qualitätslogo
  page1Banner: {
    x: 496,
    y: 0,
    width: 99,
    height: 842
  },

  // Seite 2+: HMQ-Logo oben rechts
  headerLogo: {
    x: 527,
    y: 782,
    width: 68,
    height: 60
  },

  // Seite 1: Position für Partner-Logo
  // Positionierung von oberer linker Ecke aus
  partnerLogo: {
    x: 65.5,        // war 57, jetzt +8.5pt (3mm rechts)
    y: 693,         // war 750, jetzt -57pt (20mm runter)
    maxWidth: 187.5,  // war 150, jetzt ×1.25
    maxHeight: 75     // war 60, jetzt ×1.25
  }
} as const;

// A4 page dimensions in points
export const PAGE_DIMENSIONS = {
  width: 595,
  height: 842
} as const;

// Text to search and replace
export const TEXT_REPLACEMENT = {
  original: 'HMQ AG',
} as const;
