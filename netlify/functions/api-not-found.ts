export default async function handler(): Promise<Response> {
  return Response.json(
    { error: { code: 'NOT_FOUND', message: 'API-маршрут не найден.' } },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}
