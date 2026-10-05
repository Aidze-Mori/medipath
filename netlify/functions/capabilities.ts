import { handleCapabilitiesRequest } from '../../server/capabilities';
export default async (request: Request): Promise<Response> => handleCapabilitiesRequest(request, { env: process.env });
