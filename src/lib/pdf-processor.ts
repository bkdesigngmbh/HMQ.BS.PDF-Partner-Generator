import { PDFDocument, rgb, PDFPage } from 'pdf-lib';
import { PDF_POSITIONS, TEXT_REPLACEMENT } from '@/config/pdf-positions';

// Original text to replace
const ORIGINAL_TEXT = TEXT_REPLACEMENT.original; // "HMQ AG" = 6 characters

export interface ProcessingOptions {
  pdfBuffer: ArrayBuffer;
  partnerName: string;
  logoBuffer?: ArrayBuffer;
  logoMimeType?: string;
}

export interface ProcessingResult {
  pdfBuffer: Uint8Array;
  filename: string;
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
  // This makes it harder to remove in PDF editors
  for (let i = 0; i < 3; i++) {
    page.drawRectangle({
      x: x - i * 0.5,
      y: y - i * 0.5,
      width: width + i,
      height: height + i,
      color: rgb(1, 1, 1), // Pure white
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
 * Performs same-length text replacement in PDF bytes.
 * Pads or truncates the replacement text to match the original length,
 * preserving PDF byte offsets and structure.
 */
function replaceTextSameLength(
  pdfBytes: Uint8Array,
  searchText: string,
  replaceText: string
): Uint8Array {
  const targetLength = searchText.length;

  // Pad or truncate replacement to exact same length
  let paddedReplace: string;
  if (replaceText.length < targetLength) {
    // Pad with spaces on the right
    paddedReplace = replaceText.padEnd(targetLength, ' ');
  } else if (replaceText.length > targetLength) {
    // Truncate to fit
    paddedReplace = replaceText.substring(0, targetLength);
  } else {
    paddedReplace = replaceText;
  }

  // Convert bytes to latin1 string
  const decoder = new TextDecoder('latin1');
  const pdfString = decoder.decode(pdfBytes);

  // Replace all occurrences
  const replacedString = pdfString.split(searchText).join(paddedReplace);

  // Convert back to bytes
  const result = new Uint8Array(replacedString.length);
  for (let i = 0; i < replacedString.length; i++) {
    result[i] = replacedString.charCodeAt(i) & 0xff;
  }

  return result;
}

/**
 * Processes a PDF by removing HMQ branding and adding partner branding.
 *
 * Operations performed:
 * 1. Page 1: Cover the right banner (entire height) with white
 * 2. Page 1: Add partner logo (if provided)
 * 3. Page 2+: Cover HMQ logo in header
 * 4. Replace "HMQ AG" text with partner name (same-length replacement)
 */
export async function processPDF(
  options: ProcessingOptions
): Promise<ProcessingResult> {
  const { pdfBuffer, partnerName, logoBuffer, logoMimeType } = options;

  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer, {
    ignoreEncryption: true,
  });

  const pages = pdfDoc.getPages();

  if (pages.length === 0) {
    throw new Error('Das PDF enthält keine Seiten.');
  }

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

  // Process pages 2 onwards - cover header logo
  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];

    drawSecureWhiteRectangle(
      page,
      PDF_POSITIONS.headerLogo.x,
      PDF_POSITIONS.headerLogo.y,
      PDF_POSITIONS.headerLogo.width,
      PDF_POSITIONS.headerLogo.height
    );
  }

  // Update PDF metadata
  pdfDoc.setTitle(`Beweissicherungsbericht - ${partnerName}`);
  pdfDoc.setProducer(`${partnerName} PDF Generator`);
  pdfDoc.setCreator(`${partnerName}`);

  // Save the modified PDF
  const pdfBytes = await pdfDoc.save();

  // Perform same-length text replacement for "HMQ AG" -> partner name
  // This preserves PDF structure by keeping byte offsets intact
  const finalBytes = replaceTextSameLength(pdfBytes, ORIGINAL_TEXT, partnerName);

  // Generate filename
  const sanitizedName = partnerName
    .replace(/[^a-zA-Z0-9äöüÄÖÜß\s-]/g, '')
    .replace(/\s+/g, '_');
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `Beweissicherungsbericht_${sanitizedName}_${timestamp}.pdf`;

  return {
    pdfBuffer: finalBytes,
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
  // Create a new Uint8Array copy to ensure compatibility with Blob
  const bufferCopy = new Uint8Array(buffer);
  const blob = new Blob([bufferCopy.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
