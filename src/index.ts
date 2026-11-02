import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { handleMcp } from './server.ts';

const origin = process.env.BOOSTLOOP_ORIGIN;
if (!origin) throw new Error('Set BOOSTLOOP_ORIGIN, e.g. https://boostloop.club');
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/mcp') { res.writeHead(404).end(); return; }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(url, { method: req.method, headers: req.headers as HeadersInit, body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined, duplex: 'half' } as RequestInit);
  const response = await handleMcp(request, { origin, allowedOrigins }).catch(() => new Response('{"error":"Server error"}', { status: 500 }));
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(process.env.PORT ?? 3001), () => console.log('boostloop-mcp listening on /mcp'));
