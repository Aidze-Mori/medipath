import { handleClinicRequest } from '../../server/clinic';

export default async (request: Request): Promise<Response> => handleClinicRequest(request);
