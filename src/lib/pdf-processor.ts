import { PDFDocument, rgb, PDFPage, StandardFonts } from 'pdf-lib';
import { PDF_POSITIONS } from '@/config/pdf-positions';

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
 * Extracts the date from the PDF by searching the raw bytes.
 * Looks for pattern DD.MM.YYYY in the PDF content.
 * This approach doesn't require pdf.js worker.
 */
export async function extractDateFromPdf(pdfBytes: ArrayBuffer): Promise<string> {
  try {
    const uint8Array = new Uint8Array(pdfBytes);
    const decoder = new TextDecoder('latin1');
    const text = decoder.decode(uint8Array);

    // Debug: Log that we're extracting
    console.log('Extracting date from PDF bytes, length:', text.length);

    // Look for date pattern DD.MM.YYYY
    const match = text.match(/(\d{2}\.\d{2}\.\d{4})/);
    if (match) {
      console.log('Found date in PDF:', match[1]);
      return match[1];
    }

    console.log('No date found in PDF');
    return '';
  } catch (error) {
    console.error('Error extracting date from PDF:', error);
    return '';
  }
}

/**
 * Draws a white rectangle on the page that is integrated into the content stream.
 * Multiple overlapping layers are drawn to make removal more difficult.
 */
function drawSecureWhiteRectangle(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number
): void {
  // Draw multiple overlapping white rectangles for added security
  for (let i = 0; i < 3; i++) {
    page.drawRectangle({
      x: x - i * 0.5,
      y: y - i * 0.5,
      width: width + i,
      height: height + i,
      color: rgb(1, 1, 1),
      opacity: 1,
    });
  }

  // Draw a final solid rectangle on top
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

  // Process page 1
  const page1 = pages[0];

  // Cover the right banner on page 1
  drawSecureWhiteRectangle(
    page1,
    PDF_POSITIONS.page1Banner.x,
    PDF_POSITIONS.page1Banner.y,
    PDF_POSITIONS.page1Banner.width,
    PDF_POSITIONS.page1Banner.height
  );

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

  // Process pages 2 onwards
  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];

    // Cover header logo
    drawSecureWhiteRectangle(
      page,
      PDF_POSITIONS.headerLogo.x,
      PDF_POSITIONS.headerLogo.y,
      PDF_POSITIONS.headerLogo.width,
      PDF_POSITIONS.headerLogo.height
    );

    // Cover footer with white rectangle
    // Position: 5mm left (14pt), 3mm up (8.5pt) from previous
    // Keep height low (10pt) to not cover the horizontal line above
    page.drawRectangle({
      x: 42,
      y: 38,
      width: 130,
      height: 10,
      color: rgb(1, 1, 1),
    });

    // Write new footer text
    // Font size 8pt (closest to original 8.14pt Arial)
    const fontSize = 8;

    // Draw partner name in bold
    const partnerNameWidth = helveticaBold.widthOfTextAtSize(partnerName, fontSize);
    page.drawText(partnerName, {
      x: 42,
      y: 40,
      size: fontSize,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Draw comma and date in regular font
    if (extractedDate) {
      page.drawText(`, ${extractedDate}`, {
        x: 42 + partnerNameWidth,
        y: 40,
        size: fontSize,
        font: helvetica,
        color: rgb(0, 0, 0),
      });
    }
  }

  // Update PDF metadata
  pdfDoc.setTitle(`Beweissicherungsbericht - ${partnerName}`);
  pdfDoc.setProducer(`${partnerName} PDF Generator`);
  pdfDoc.setCreator(`${partnerName}`);

  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();

  // Generate filename
  const sanitizedName = partnerName
    .replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '')
    .replace(/\s+/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `Beweissicherungsbericht_${sanitizedName}_${timestamp}.pdf`;

  return {
    pdfBuffer: pdfBytes,
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
