import { handleAnalyzeRequest } from '../../server/analyze';

export default async (request: Request): Promise<Response> => handleAnalyzeRequest(request, { env: process.env });
