export type IntakeFormat = 'txt' | 'pdf' | 'docx' | 'jpg' | 'png';
export type ExtractionMethod = 'native' | 'ocr' | 'pasted';
export type SectionKind = 'description' | 'conclusion' | 'recommendations' | 'history' | 'other';

export interface ExtractedBlock {
  id: string;
  anchor: string;
  pageNumber?: number;
  method: ExtractionMethod;
  originalText: string;
  warnings: string[];
  confidence?: number;
  previewUrl?: string;
  words?: Array<{ text: string; confidence: number; x: number; y: number; width: number; height: number }>;
}

export interface ExtractedSection {
  kind: SectionKind;
  heading: string;
  text: string;
  anchors: string[];
}

export interface ExtractedDocument {
  format: IntakeFormat;
  name: string;
  blocks: ExtractedBlock[];
  sections: ExtractedSection[];
  unclassifiedText: string;
  unclassifiedAnchors?: string[];
  text: string;
  warnings: string[];
  unreadPages: number[];
  unreadAnchors: string[];
  missingSections: Array<'description' | 'conclusion'>;
  needsCorrection: boolean;
}

export interface ExtractionProgress {
  stage: 'validating' | 'reading' | 'ocr';
  current: number;
  total: number;
  percent: number;
  label: string;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ExtractionProgress) => void;
  /** Clockwise rotation for photo retry; browser applies EXIF orientation first. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface PhotoPageInput {
  file: File;
  rotation: 0 | 90 | 180 | 270;
}

export type IntakeErrorCode =
  | 'empty'
  | 'unsupported'
  | 'mismatch'
  | 'too_large'
  | 'too_many_pages'
  | 'corrupt'
  | 'password'
  | 'encoding'
  | 'unreadable'
  | 'timeout'
  | 'busy'
  | 'cancelled';

export class IntakeError extends Error {
  readonly code: IntakeErrorCode;

  constructor(code: IntakeErrorCode, message: string) {
    super(message);
    this.name = 'IntakeError';
    this.code = code;
  }
}

export const INTAKE_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  pages: 5,
  textChars: 20_000,
  zipEntries: 256,
  unpackedBytes: 25 * 1024 * 1024,
  xmlBytes: 3 * 1024 * 1024,
  imagePixels: 24_000_000,
  renderPixels: 6_000_000,
  timeoutMs: 120_000,
} as const;

export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new IntakeError('cancelled', 'Чтение отменено.');
}

export function releaseBlocks(blocks: ExtractedBlock[]): void {
  for (const block of blocks) if (block.previewUrl) URL.revokeObjectURL(block.previewUrl);
}
