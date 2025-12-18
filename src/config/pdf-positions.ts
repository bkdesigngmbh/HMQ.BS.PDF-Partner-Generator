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
    x: 533,
    y: 782,
    width: 62,
    height: 60
  },

  // Seite 1: Position für Partner-Logo
  partnerLogo: {
    x: 57,
    y: 750,
    maxWidth: 150,
    maxHeight: 60
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
