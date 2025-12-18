import { PDFDocument, rgb, PDFPage, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { PDF_POSITIONS } from '@/config/pdf-positions';

// Set worker source to local file in public folder
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
}

export interface ProcessingOptions {
  pdfBuffer: ArrayBuffer;
  partnerName: string;
  logoBuffer?: ArrayBuffer;
  logoMimeType?: string;
  extractedDate?: string;
}

export interface ProcessingResult {
  pdfBuffer: Uint8Array;
  filename: string;
}

/**
 * Extracts the date from the PDF footer on page 2 using pdf.js.
 * Looks for pattern DD.MM.YYYY in the text content.
 */
export async function extractDateFromPdf(pdfBytes: ArrayBuffer): Promise<string> {
  try {
    console.log('Starting date extraction with pdf.js...');

    // Load PDF with pdf.js
    const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    console.log('PDF loaded, pages:', pdf.numPages);

    // We need at least 2 pages (footer is on page 2)
    if (pdf.numPages < 2) {
      console.error('PDF has less than 2 pages');
      return '';
    }

    // Get page 2 (1-indexed in pdf.js)
    const page = await pdf.getPage(2);
    const textContent = await page.getTextContent();

    console.log('Page 2 text items:', textContent.items.length);

    // Search through all text items for date pattern
    for (const item of textContent.items) {
      const text = (item as { str: string }).str;
      const match = text.match(/(\d{2}\.\d{2}\.\d{4})/);
      if (match) {
        console.log('Date found:', match[1]);
        return match[1];
      }
    }

    console.error('No date found in PDF');
    return '';
  } catch (error) {
    console.error('Error extracting date from PDF:', error);
    return '';
  }
}

/**
 * Region definition for flattening
 */
interface FlattenRegion {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Renders a specific region of a PDF page to a PNG image using pdf.js
 */
async function renderRegionToImage(
  pdfBytes: Uint8Array,
  pageIndex: number,
  region: { x: number; y: number; width: number; height: number },
  scale: number = 3
): Promise<ArrayBuffer> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
  const page = await pdf.getPage(pageIndex + 1);

  const viewport = page.getViewport({ scale });
  const pageHeight = page.getViewport({ scale: 1 }).height;

  // Create canvas for the specific region
  const canvas = document.createElement('canvas');
  canvas.width = region.width * scale;
  canvas.height = region.height * scale;
  const context = canvas.getContext('2d')!;

  // Fill with white background first
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Transform to render only the specific region
  // PDF coordinates are from bottom-left, canvas from top-left
  const yFromTop = pageHeight - region.y - region.height;
  context.translate(-region.x * scale, -yFromTop * scale);

  await page.render({
    canvasContext: context,
    viewport: viewport,
  }).promise;

  // Convert canvas to PNG
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });

  return await blob.arrayBuffer();
}

/**
 * Flattens specific regions of a PDF by rendering them as images.
 * This makes the white rectangles permanent and non-removable.
 */
async function flattenRegions(
  pdfBytes: Uint8Array,
  regions: FlattenRegion[]
): Promise<Uint8Array> {
  console.log('Flattening', regions.length, 'regions...');

  // Group regions by page for efficiency
  const regionsByPage = new Map<number, FlattenRegion[]>();
  for (const region of regions) {
    const pageRegions = regionsByPage.get(region.pageIndex) || [];
    pageRegions.push(region);
    regionsByPage.set(region.pageIndex, pageRegions);
  }

  // Render all regions to images
  const renderedRegions: { region: FlattenRegion; imageBytes: ArrayBuffer }[] = [];

  const pageIndices = Array.from(regionsByPage.keys());
  for (const pageIndex of pageIndices) {
    const pageRegions = regionsByPage.get(pageIndex) || [];
    for (const region of pageRegions) {
      try {
        const imageBytes = await renderRegionToImage(pdfBytes, pageIndex, region);
        renderedRegions.push({ region, imageBytes });
      } catch (error) {
        console.error('Error rendering region:', error);
      }
    }
  }

  // Load PDF with pdf-lib and draw images over regions
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pages = pdfDoc.getPages();

  for (const { region, imageBytes } of renderedRegions) {
    const page = pages[region.pageIndex];
    const image = await pdfDoc.embedPng(imageBytes);

    page.drawImage(image, {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    });
  }

  return await pdfDoc.save();
}

/**
 * Draws a white rectangle on the page.
 */
function drawWhiteRectangle(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(1, 1, 1),
    opacity: 1,
  });
}

/**
 * Scales dimensions while maintaining aspect ratio
 */
function scaleToFit(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const widthRatio = maxWidth / originalWidth;
  const heightRatio = maxHeight / originalHeight;
  const scale = Math.min(widthRatio, heightRatio);

  return {
    width: originalWidth * scale,
    height: originalHeight * scale,
  };
}

/**
 * Processes a PDF by removing HMQ branding and adding partner branding.
 *
 * Operations performed:
 * 1. Page 1: Cover the right banner (entire height) with white
 * 2. Page 1: Add partner logo (if provided)
 * 3. Page 2+: Cover HMQ logo in header
 * 4. Page 2+: Cover and rewrite footer with partner name and date
 */
export async function processPDF(
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const { pdfBuffer, partnerName, logoBuffer, logoMimeType, extractedDate } = options;

  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer, {
    ignoreEncryption: true,
  });

  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    throw new Error('Das PDF enthält keine Seiten.');
  }

  // Embed fonts for footer text
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Collect regions for flattening
  const flattenRegionsList: FlattenRegion[] = [];

  // Process page 1
  const page1 = pages[0];

  // Cover the right banner on page 1
  drawWhiteRectangle(
    page1,
    PDF_POSITIONS.page1Banner.x,
    PDF_POSITIONS.page1Banner.y,
    PDF_POSITIONS.page1Banner.width,
    PDF_POSITIONS.page1Banner.height
  );

  // Add banner region for flattening
  flattenRegionsList.push({
    pageIndex: 0,
    x: PDF_POSITIONS.page1Banner.x,
    y: PDF_POSITIONS.page1Banner.y,
    width: PDF_POSITIONS.page1Banner.width,
    height: PDF_POSITIONS.page1Banner.height,
  });

  // Add partner logo if provided
  if (logoBuffer && logoMimeType) {
    try {
      let image;

      if (logoMimeType === 'image/png') {
        image = await pdfDoc.embedPng(logoBuffer);
      } else if (logoMimeType === 'image/jpeg' || logoMimeType === 'image/jpg') {
        image = await pdfDoc.embedJpg(logoBuffer);
      } else {
        throw new Error(`Nicht unterstütztes Bildformat: ${logoMimeType}`);
      }

      // Scale logo to fit within max dimensions while maintaining aspect ratio
      const scaledDimensions = scaleToFit(
        image.width,
        image.height,
        PDF_POSITIONS.partnerLogo.maxWidth,
        PDF_POSITIONS.partnerLogo.maxHeight
      );

      // Draw the logo on page 1
      page1.drawImage(image, {
        x: PDF_POSITIONS.partnerLogo.x,
        y: PDF_POSITIONS.partnerLogo.y,
        width: scaledDimensions.width,
        height: scaledDimensions.height,
      });
    } catch (error) {
      console.error('Fehler beim Einbetten des Logos:', error);
      throw new Error(
        'Das Logo konnte nicht verarbeitet werden. Bitte verwenden Sie ein gültiges PNG- oder JPG-Bild.'
      );
    }
  }

  // Footer dimensions
  const footerRegion = { x: 42, y: 42.25, width: 130, height: 10 };

  // Process pages 2 onwards
  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];

    // Cover header logo
    drawWhiteRectangle(
      page,
      PDF_POSITIONS.headerLogo.x,
      PDF_POSITIONS.headerLogo.y,
      PDF_POSITIONS.headerLogo.width,
      PDF_POSITIONS.headerLogo.height
    );

    // Add header logo region for flattening
    flattenRegionsList.push({
      pageIndex: i,
      x: PDF_POSITIONS.headerLogo.x,
      y: PDF_POSITIONS.headerLogo.y,
      width: PDF_POSITIONS.headerLogo.width,
      height: PDF_POSITIONS.headerLogo.height,
    });

    // Cover footer with white rectangle
    drawWhiteRectangle(page, footerRegion.x, footerRegion.y, footerRegion.width, footerRegion.height);

    // Write new footer text
    // Font size 8pt (closest to original 8.14pt Arial)
    const fontSize = 8;

    // Draw partner name in bold
    const partnerNameWidth = helveticaBold.widthOfTextAtSize(partnerName, fontSize);
    page.drawText(partnerName, {
      x: 42,
      y: 44.25,
      size: fontSize,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Draw comma and date in regular font
    if (extractedDate) {
      page.drawText(`, ${extractedDate}`, {
        x: 42 + partnerNameWidth,
        y: 44.25,
        size: fontSize,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    }

    // Add footer region for flattening
    flattenRegionsList.push({
      pageIndex: i,
      x: footerRegion.x,
      y: footerRegion.y,
      width: footerRegion.width,
      height: footerRegion.height,
    });
  }

  // Update PDF metadata
  pdfDoc.setTitle(`Beweissicherungsbericht - ${partnerName}`);
  pdfDoc.setProducer(`${partnerName} PDF Generator`);
  pdfDoc.setCreator(`${partnerName}`);

  // Save the modified PDF (before flattening)
  const modifiedPdfBytes = await pdfDoc.save();

  // Flatten the modified regions to make them permanent
  console.log('Starting flattening of', flattenRegionsList.length, 'regions...');
  const flattenedPdfBytes = await flattenRegions(modifiedPdfBytes, flattenRegionsList);
  console.log('Flattening complete');

  // Generate filename
  const sanitizedName = partnerName
    .replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '')
    .replace(/\s+/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `Beweissicherungsbericht_${sanitizedName}_${timestamp}.pdf`;

  return {
    pdfBuffer: flattenedPdfBytes,
    filename,
  };
}

/**
 * Validates that a file is a PDF
 */
export function validatePDF(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/**
 * Validates that a file is a supported image format
 */
export function validateImage(file: File): boolean {
  const supportedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
  return supportedTypes.includes(file.type);
}

/**
 * Converts a File to ArrayBuffer
 */
export function fileToArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Triggers a download of the processed PDF
 */
export function downloadPDF(buffer: Uint8Array, filename: string): void {
  const bufferCopy = new Uint8Array(buffer);
  const blob = new Blob([bufferCopy.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 100);
}
