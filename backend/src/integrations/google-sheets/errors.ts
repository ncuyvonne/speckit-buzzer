export type GoogleSheetsErrorCode =
  | 'SHEETS_NOT_CONFIGURED'
  | 'SHEET_ACCESS_DENIED'
  | 'SHEET_NOT_FOUND'
  | 'SHEET_READ_FAILED'
  | 'SHEET_WRITE_FAILED'
  | 'SHEET_WRITE_UNCONFIRMED';

export type WriteOutcome = 'DEFINITELY_NOT_APPLIED' | 'AMBIGUOUS';

export class GoogleSheetsIntegrationError extends Error {
  readonly httpStatus: number | undefined;
  readonly writeOutcome: WriteOutcome | undefined;

  constructor(
    readonly code: GoogleSheetsErrorCode,
    options: { readonly httpStatus?: number; readonly writeOutcome?: WriteOutcome } = {},
  ) {
    super(code);
    this.name = 'GoogleSheetsIntegrationError';
    this.httpStatus = options.httpStatus;
    this.writeOutcome = options.writeOutcome;
  }
}

export function googleHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = (error as { response?: { status?: unknown }; code?: unknown }).response?.status;
  return typeof candidate === 'number' && Number.isInteger(candidate) ? candidate : undefined;
}

export function normalizeGoogleSheetsError(
  error: unknown,
  operation: 'READ' | 'WRITE',
): GoogleSheetsIntegrationError {
  if (error instanceof GoogleSheetsIntegrationError) return error;
  const status = googleHttpStatus(error);
  const writeOutcome = operation === 'WRITE'
    ? status !== undefined && status < 500 ? 'DEFINITELY_NOT_APPLIED' as const : 'AMBIGUOUS' as const
    : undefined;
  const options = {
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(writeOutcome === undefined ? {} : { writeOutcome }),
  };
  if (status === 403) return new GoogleSheetsIntegrationError('SHEET_ACCESS_DENIED', options);
  if (status === 404) return new GoogleSheetsIntegrationError('SHEET_NOT_FOUND', options);
  return new GoogleSheetsIntegrationError(
    operation === 'READ' ? 'SHEET_READ_FAILED' : 'SHEET_WRITE_FAILED',
    options,
  );
}
