import { handleDocumentAnalyzeRequest } from '../../server/analyzeDocument';

// Cloud uploads remain disabled unless both document flags are set server-side.
export default async (request: Request): Promise<Response> => handleDocumentAnalyzeRequest(request, { env: process.env });
