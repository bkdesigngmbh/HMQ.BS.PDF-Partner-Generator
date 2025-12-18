'use client';

import { useState, useCallback, useRef, DragEvent, ChangeEvent } from 'react';
import {
  processPDF,
  validatePDF,
  validateImage,
  fileToArrayBuffer,
  downloadPDF,
  extractDateFromPdf,
} from '@/lib/pdf-processor';

type Status = 'idle' | 'processing' | 'success' | 'error';

export default function Home() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfBuffer, setPdfBuffer] = useState<ArrayBuffer | null>(null);
  const [extractedDate, setExtractedDate] = useState<string>('');
  const [partnerName, setPartnerName] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);
  const [isDraggingLogo, setIsDraggingLogo] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const isFormValid = pdfFile && partnerName.trim().length > 0;

  // Process uploaded PDF file and extract date
  const processPdfFile = useCallback(async (file: File) => {
    try {
      const buffer = await fileToArrayBuffer(file);
      setPdfBuffer(buffer);
      // Create a copy for date extraction since pdf.js will detach the buffer
      const bufferCopyForDateExtraction = buffer.slice(0);
      const date = await extractDateFromPdf(bufferCopyForDateExtraction);
      setExtractedDate(date);
      setPdfFile(file);
      setStatus('idle');
      setErrorMessage('');
    } catch (error) {
      console.error('Error processing PDF:', error);
      setErrorMessage('Fehler beim Lesen der PDF-Datei.');
    }
  }, []);

  // PDF Drop Zone Handlers
  const handlePdfDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPdf(true);
  }, []);

  const handlePdfDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPdf(false);
  }, []);

  const handlePdfDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingPdf(false);

    const file = e.dataTransfer.files[0];
    if (file && validatePDF(file)) {
      processPdfFile(file);
    } else {
      setErrorMessage('Bitte laden Sie eine gültige PDF-Datei hoch.');
    }
  }, [processPdfFile]);

  const handlePdfChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validatePDF(file)) {
      processPdfFile(file);
    } else if (file) {
      setErrorMessage('Bitte laden Sie eine gültige PDF-Datei hoch.');
    }
  }, [processPdfFile]);

  // Logo Drop Zone Handlers
  const handleLogoDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingLogo(true);
  }, []);

  const handleLogoDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingLogo(false);
  }, []);

  const handleLogoDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingLogo(false);

    const file = e.dataTransfer.files[0];
    if (file && validateImage(file)) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    } else {
      setErrorMessage('Bitte laden Sie ein gültiges PNG- oder JPG-Bild hoch.');
    }
  }, []);

  const handleLogoChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateImage(file)) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    } else if (file) {
      setErrorMessage('Bitte laden Sie ein gültiges PNG- oder JPG-Bild hoch.');
    }
  }, []);

  const removeLogo = useCallback(() => {
    setLogoFile(null);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }
    if (logoInputRef.current) {
      logoInputRef.current.value = '';
    }
  }, [logoPreview]);

  // Process PDF
  const handleProcess = useCallback(async () => {
    if (!pdfBuffer || !partnerName.trim()) return;

    setStatus('processing');
    setErrorMessage('');

    try {
      let logoBuffer: ArrayBuffer | undefined;
      let logoMimeType: string | undefined;

      if (logoFile) {
        logoBuffer = await fileToArrayBuffer(logoFile);
        logoMimeType = logoFile.type;
      }

      const result = await processPDF({
        pdfBuffer,
        partnerName: partnerName.trim(),
        logoBuffer,
        logoMimeType,
        extractedDate,
      });

      downloadPDF(result.pdfBuffer, result.filename);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Ein unerwarteter Fehler ist aufgetreten.'
      );
    }
  }, [pdfBuffer, partnerName, logoFile, extractedDate]);

  // Reset form
  const handleReset = useCallback(() => {
    setPdfFile(null);
    setPdfBuffer(null);
    setExtractedDate('');
    setPartnerName('');
    setLogoFile(null);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }
    setStatus('idle');
    setErrorMessage('');

    if (pdfInputRef.current) pdfInputRef.current.value = '';
    if (logoInputRef.current) logoInputRef.current.value = '';
  }, [logoPreview]);

  return (
    <main className="min-h-screen py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            PDF Partner Generator
          </h1>
          <p className="text-gray-600">
            Erstellen Sie White-Label Beweissicherungsberichte für Partner
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          {/* PDF Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              PDF-Datei <span className="text-red-500">*</span>
            </label>
            <div
              onClick={() => pdfInputRef.current?.click()}
              onDragOver={handlePdfDragOver}
              onDragLeave={handlePdfDragLeave}
              onDrop={handlePdfDrop}
              className={`drop-zone ${isDraggingPdf ? 'drag-over' : ''} ${
                pdfFile ? 'has-file' : ''
              }`}
            >
              <input
                ref={pdfInputRef}
                type="file"
                accept=".pdf,application/pdf"
                onChange={handlePdfChange}
                className="hidden"
              />
              {pdfFile ? (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2">
                    <svg
                      className="w-6 h-6 text-green-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span className="text-green-700 font-medium">
                      {pdfFile.name}
                    </span>
                  </div>
                  {extractedDate && (
                    <p className="text-sm text-gray-500 mt-2">
                      Erkanntes Datum: <span className="font-medium">{extractedDate}</span>
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <svg
                    className="w-10 h-10 mx-auto text-gray-400 mb-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                    />
                  </svg>
                  <p className="text-gray-600">
                    Datei hierher ziehen oder{' '}
                    <span className="text-blue-600 underline">durchsuchen</span>
                  </p>
                  <p className="text-sm text-gray-400 mt-1">
                    HMQ Beweissicherungsbericht (PDF)
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Partner Name */}
          <div className="mb-6">
            <label
              htmlFor="partnerName"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Partner-Firmenname <span className="text-red-500">*</span>
            </label>
            <input
              id="partnerName"
              type="text"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              placeholder="z.B. Müller Bau AG"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            />
            <p className="text-sm text-gray-500 mt-1">
              Ersetzt &quot;HMQ AG&quot; in der Fusszeile auf allen Seiten
            </p>
          </div>

          {/* Logo Upload */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Partner-Logo <span className="text-gray-400">(optional)</span>
            </label>
            {logoFile && logoPreview ? (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoPreview}
                      alt="Logo Vorschau"
                      className="h-12 w-auto object-contain"
                    />
                    <span className="text-sm text-gray-600">{logoFile.name}</span>
                  </div>
                  <button
                    onClick={removeLogo}
                    className="text-red-500 hover:text-red-700 p-1"
                    title="Logo entfernen"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => logoInputRef.current?.click()}
                onDragOver={handleLogoDragOver}
                onDragLeave={handleLogoDragLeave}
                onDrop={handleLogoDrop}
                className={`drop-zone ${isDraggingLogo ? 'drag-over' : ''}`}
              >
                <input
                  ref={logoInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                  onChange={handleLogoChange}
                  className="hidden"
                />
                <svg
                  className="w-8 h-8 mx-auto text-gray-400 mb-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <p className="text-gray-600 text-sm">
                  Logo hochladen (PNG oder JPG)
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  Max. 150 x 60 Pixel, wird proportional skaliert
                </p>
              </div>
            )}
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <svg
                className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-red-700 text-sm">{errorMessage}</p>
            </div>
          )}

          {/* Success Message */}
          {status === 'success' && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
              <svg
                className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-green-700 text-sm">
                PDF erfolgreich erstellt und heruntergeladen!
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={handleProcess}
              disabled={!isFormValid || status === 'processing'}
              className={`flex-1 py-3 px-6 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                isFormValid && status !== 'processing'
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {status === 'processing' ? (
                <>
                  <svg
                    className="animate-spin w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Wird verarbeitet...
                </>
              ) : (
                <>
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  PDF verarbeiten & herunterladen
                </>
              )}
            </button>

            <button
              onClick={handleReset}
              className="py-3 px-6 rounded-lg font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-all"
            >
              Zurücksetzen
            </button>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-center text-sm text-gray-500">
          <p>
            Alle Daten werden lokal in Ihrem Browser verarbeitet.
            <br />
            Es werden keine Dateien auf Server übertragen.
          </p>
        </div>
      </div>
    </main>
  );
}
