import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcp } from '../src/server.ts';

const token = 'bl_mcp_' + 'a'.repeat(64);
const calls: string[] = [];
const fakeFetch = (async (url: string, init?: RequestInit) => {
  calls.push(`${init?.method ?? 'GET'} ${url} ${new Headers(init?.headers).get('authorization')}`);
  return Response.json({ id: 'u1', karma: 7 });
}) as unknown as typeof fetch;
const config = { origin: 'https://example.test/', fetch: fakeFetch };
const rpc = (body: unknown, headers: Record<string, string> = {}) => new Request('http://x/mcp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers },
  body: JSON.stringify(body),
});

test('rejects missing token and foreign origin', async () => {
  assert.equal((await handleMcp(rpc({}, { authorization: '' }), config)).status, 401);
  assert.equal((await handleMcp(rpc({}, { origin: 'https://evil.test' }), config)).status, 403);
});

test('lists tools and forwards tool calls with the member token', async () => {
  const list = await handleMcp(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), config);
  const names = (await list.json() as any).result.tools.map((t: any) => t.name);
  assert(names.includes('open_campaign') && names.includes('get_screenshot'));
  calls.length = 0;
  const call = await handleMcp(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_account', arguments: {} } }), config);
  assert.equal((await call.json() as any).result.structuredContent.karma, 7);
  assert.equal(calls.at(-1), `GET https://example.test/api/me Bearer ${token}`);
});

test('non-POST is 405', async () => {
  assert.equal((await handleMcp(new Request('http://x/mcp', { headers: { authorization: `Bearer ${token}` } }), config)).status, 405);
});
