import { handle, type AppEnv } from './app';

type Env = AppEnv & {
  ASSETS?: Fetcher;
};

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

async function tryServeAsset(req: Request, env: Env): Promise<Response | null> {
  if (!env.ASSETS) return null;
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return null;

  const url = new URL(req.url);
  if (isApiPath(url.pathname)) return null;

  const resp = await env.ASSETS.fetch(req);
  if (resp.status === 404) return null;

  // Clone and add CORS headers
  const newResp = new Response(resp.body, resp);
  newResp.headers.set('Access-Control-Allow-Origin', '*');
  return newResp;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const asset = await tryServeAsset(req, env);
    if (asset) return asset;
    return handle(req, env);
  }
} satisfies ExportedHandler<Env>;
