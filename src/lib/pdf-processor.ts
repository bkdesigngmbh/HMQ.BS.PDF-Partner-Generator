/**
 * PDF Processing via Modal.com API
 *
 * All PDF manipulation is now handled by an external Python service.
 */

export interface ProcessingOptions {
  pdfFile: File;
  partnerName: string;
  logoFile?: File;
}

export interface ProcessingResult {
  pdfBlob: Blob;
  filename: string;
}

/**
 * Converts an ArrayBuffer to Base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts a Base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Processes a PDF by sending it to the Modal.com API.
 * The API handles all PDF manipulation (covering logos, replacing footer text, etc.)
 */
export async function processPDF(options: ProcessingOptions): Promise<ProcessingResult> {
  const { pdfFile, partnerName, logoFile } = options;

  // Convert PDF to Base64
  const pdfBuffer = await pdfFile.arrayBuffer();
  const pdfBase64 = arrayBufferToBase64(pdfBuffer);

  // Convert logo to Base64 if provided
  let logoBase64: string | undefined;
  let logoType: string | undefined;

  if (logoFile) {
    const logoBuffer = await logoFile.arrayBuffer();
    logoBase64 = arrayBufferToBase64(logoBuffer);
    logoType = logoFile.type === 'image/png' ? 'png' : 'jpg';
  }

  // Get Modal API URL from environment
  const modalUrl = process.env.NEXT_PUBLIC_MODAL_URL;
  if (!modalUrl) {
    throw new Error('NEXT_PUBLIC_MODAL_URL ist nicht konfiguriert');
  }

  // Send request to Modal API
  const response = await fetch(modalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pdf_base64: pdfBase64,
      partner_name: partnerName,
      logo_base64: logoBase64,
      logo_type: logoType,
    }),
  });

  if (!response.ok) {
    throw new Error(`API-Fehler: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'PDF-Verarbeitung fehlgeschlagen');
  }

  // Convert response Base64 back to Blob
  const pdfBlob = base64ToBlob(result.pdf_base64, 'application/pdf');

  return {
    pdfBlob,
    filename: pdfFile.name,
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
 * Triggers a download of the processed PDF
 */
export function downloadPDF(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => URL.revokeObjectURL(url), 100);
}
