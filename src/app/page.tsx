'use client';

import { useState, useCallback, useRef, DragEvent, ChangeEvent } from 'react';
import { PARTNERS } from '@/config/partners';
import { processPDF, validatePDF, downloadPDF } from '@/lib/pdf-processor';

type Status = 'idle' | 'processing' | 'success' | 'error';

export default function Home() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [partnerId, setPartnerId] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [changes, setChanges] = useState<string[]>([]);
  const [isDraggingPdf, setIsDraggingPdf] = useState(false);

  const pdfInputRef = useRef<HTMLInputElement>(null);

  const partner = PARTNERS.find((p) => p.id === partnerId);
  const isFormValid = pdfFile !== null && partner !== undefined;

  // Handle PDF file selection
  const handlePdfFile = useCallback((file: File) => {
    if (validatePDF(file)) {
      setPdfFile(file);
      setStatus('idle');
      setErrorMessage('');
      setChanges([]);
    } else {
      setErrorMessage('Bitte laden Sie eine gültige PDF-Datei hoch.');
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
    if (file) {
      handlePdfFile(file);
    }
  }, [handlePdfFile]);

  const handlePdfChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handlePdfFile(file);
    }
  }, [handlePdfFile]);

  // Process PDF via Modal API
  const handleProcess = useCallback(async () => {
    if (!pdfFile || !partner) return;

    setStatus('processing');
    setErrorMessage('');
    setChanges([]);

    try {
      const result = await processPDF({ pdfFile, partner });

      downloadPDF(result.pdfBlob, result.filename);
      setChanges(result.changes);
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Ein unerwarteter Fehler ist aufgetreten.'
      );
    }
  }, [pdfFile, partner]);

  // Reset form
  const handleReset = useCallback(() => {
    setPdfFile(null);
    setPartnerId('');
    setStatus('idle');
    setErrorMessage('');
    setChanges([]);

    if (pdfInputRef.current) pdfInputRef.current.value = '';
  }, []);

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

          {/* Partner */}
          <div className="mb-8">
            <label
              htmlFor="partner"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Partner <span className="text-red-500">*</span>
            </label>
            <select
              id="partner"
              value={partnerId}
              onChange={(e) => {
                setPartnerId(e.target.value);
                setStatus('idle');
                setChanges([]);
              }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            >
              <option value="">Partner wählen</option>
              {PARTNERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-sm text-gray-500 mt-1">
              Partnerdaten und Logo sind fest hinterlegt und werden zentral gepflegt.
            </p>

            {partner && (
              <div className="mt-4 border border-gray-200 rounded-lg p-4 bg-gray-50 flex items-start gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={partner.logo}
                  alt={`Logo ${partner.name}`}
                  className="h-12 w-auto object-contain flex-shrink-0"
                />
                <div className="text-sm text-gray-700 leading-relaxed">
                  <p className="font-medium">{partner.name}</p>
                  {partner.address.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                  <p>{partner.phone}</p>
                  {partner.web && <p>{partner.web}</p>}
                  {partner.email && <p>{partner.email}</p>}
                </div>
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
              <div className="text-green-700 text-sm">
                <p className="font-medium">
                  PDF erfolgreich erstellt und heruntergeladen.
                </p>
                <ul className="mt-2 list-disc list-inside space-y-0.5">
                  {changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
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
                  PDF wird verarbeitet...
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
            Die PDF-Verarbeitung erfolgt über einen sicheren Server.
            <br />
            Die Dateien werden nach der Verarbeitung automatisch gelöscht.
          </p>
        </div>
      </div>
    </main>
  );
}
