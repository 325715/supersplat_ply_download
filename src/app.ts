export type AppEnv = Record<string, unknown>;

export async function handle(req: Request, _env: AppEnv): Promise<Response> {
  const url = new URL(req.url);

  // CORS preflight - Global handling
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  // Route: /api/proxy -> Proxy requests to bypass CORS limitations
  if (url.pathname === '/api/proxy') {
    const targetUrlStr = url.searchParams.get('url');
    if (!targetUrlStr) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    try {
      const targetUrl = new URL(targetUrlStr);
      const allowedHostnames = [
        'superspl.at',
        'd28zzqy0iyovbz.cloudfront.net'
      ];

      if (!allowedHostnames.includes(targetUrl.hostname) && !targetUrl.hostname.endsWith('.cloudfront.net')) {
        return new Response(JSON.stringify({ error: 'Forbidden target hostname' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // Perform fetch request
      const method = req.method.toUpperCase() === 'HEAD' ? 'HEAD' : 'GET';
      const response = await fetch(targetUrl.toString(), {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; EdgeOneESAProxy/1.0)'
        }
      });

      // Stream response back with CORS headers
      const responseHeaders = new Headers(response.headers);
      responseHeaders.set('Access-Control-Allow-Origin', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders
      });

    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
  }

  return new Response('Not Found', { status: 404 });
}
