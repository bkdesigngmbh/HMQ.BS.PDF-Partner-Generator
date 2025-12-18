import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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
 * Creates a white PNG image of the specified dimensions.
 * This image can be embedded in the PDF to permanently cover areas.
 */
async function createWhiteImage(width: number, height: number, scale: number = 3): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const context = canvas.getContext('2d')!;

  // Fill with white
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // Convert to PNG
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png', 1.0);
  });

  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
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
 * 1. Page 1: Cover the right banner with white image (flattened)
 * 2. Page 1: Add partner logo (if provided)
 * 3. Page 2+: Cover HMQ logo in header with white image (flattened)
 * 4. Page 2+: Cover footer area with white image (flattened) and add new text on top
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

  // Create white images for covering areas (these are embedded as images, not deletable rectangles)
  console.log('Creating white cover images...');

  // Banner area (Page 1)
  const bannerArea = { x: 496, y: 0, width: 99, height: 842 };
  const bannerImageBytes = await createWhiteImage(bannerArea.width, bannerArea.height);
  const bannerImage = await pdfDoc.embedPng(bannerImageBytes);

  // Header logo area (Page 2+)
  const headerLogoArea = { x: 527, y: 782, width: 68, height: 60 };
  const headerImageBytes = await createWhiteImage(headerLogoArea.width, headerLogoArea.height);
  const headerImage = await pdfDoc.embedPng(headerImageBytes);

  // Footer area (Page 2+) - enlarged by 1pt on all sides
  const footerArea = { x: 41, y: 45.25, width: 132, height: 12 };
  const footerImageBytes = await createWhiteImage(footerArea.width, footerArea.height);
  const footerImage = await pdfDoc.embedPng(footerImageBytes);

  // Process page 1
  const page1 = pages[0];

  // Cover the right banner on page 1 with white image
  page1.drawImage(bannerImage, {
    x: bannerArea.x,
    y: bannerArea.y,
    width: bannerArea.width,
    height: bannerArea.height,
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

  // Process pages 2 onwards
  for (let i = 1; i < pages.length; i++) {
    const page = pages[i];

    // Cover header logo with white image (flattened, not deletable)
    page.drawImage(headerImage, {
      x: headerLogoArea.x,
      y: headerLogoArea.y,
      width: headerLogoArea.width,
      height: headerLogoArea.height,
    });

    // Cover footer area with white image (flattened, not deletable)
    page.drawImage(footerImage, {
      x: footerArea.x,
      y: footerArea.y,
      width: footerArea.width,
      height: footerArea.height,
    });

    // Write new footer text on top (searchable and editable)
    const fontSize = 8;
    const partnerNameWidth = helveticaBold.widthOfTextAtSize(partnerName, fontSize);

    // Text position: 2pt higher than before (was 44.25, now 46.25)
    page.drawText(partnerName, {
      x: 42,
      y: 46.25,
      size: fontSize,
      font: helveticaBold,
      color: rgb(0, 0, 0),
    });

    // Draw comma and date in regular font
    if (extractedDate) {
      page.drawText(`, ${extractedDate}`, {
        x: 42 + partnerNameWidth,
        y: 46.25,
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

  console.log('PDF processing complete');

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
