import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLlmFromEnv } from '../src/ai.ts';

interface Seen {
  path: string;
  headers: IncomingMessage['headers'];
  body: any;
}

let server: Server;
let baseUrl = '';
const seen: Seen[] = [];

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw);
      seen.push({ path: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (body.model === 'fail') {
        res.statusCode = 429;
        res.end('{"error":"rate limited"}');
      } else if (req.url === '/v1/chat/completions') {
        res.end(JSON.stringify({ choices: [{ message: { content: 'openai says hi' } }] }));
      } else if (req.url === '/v1/messages') {
        res.end(JSON.stringify({ content: [{ type: 'text', text: 'anthropic ' }, { type: 'text', text: 'says hi' }] }));
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

test('AI stays off unless AI_PROVIDER is set, even when keys exist', () => {
  assert.equal(createLlmFromEnv({ OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }), null);
  assert.equal(createLlmFromEnv({ AI_PROVIDER: 'none', OPENAI_API_KEY: 'k' }), null);
});

test('misconfiguration fails loudly', () => {
  assert.throws(() => createLlmFromEnv({ AI_PROVIDER: 'openai', AI_MODEL: 'm' }), /OPENAI_API_KEY/);
  assert.throws(() => createLlmFromEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k' }), /AI_MODEL/);
  assert.throws(() => createLlmFromEnv({ AI_PROVIDER: 'gemini' }), /không hỗ trợ/);
});

test('openai client sends a chat completion request and reads the reply', async () => {
  const llm = createLlmFromEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test', AI_MODEL: 'm1', OPENAI_BASE_URL: `${baseUrl}/v1` });
  assert.ok(llm);
  assert.equal(await llm.complete({ system: 'sys', user: 'hello' }), 'openai says hi');
  const req = seen.at(-1)!;
  assert.equal(req.path, '/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(req.body, {
    model: 'm1',
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ],
  });
});

test('anthropic client sends a Messages API request and joins text blocks', async () => {
  const llm = createLlmFromEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'ak-test', ANTHROPIC_BASE_URL: baseUrl });
  assert.ok(llm);
  assert.equal(llm.model, 'claude-sonnet-5-5');
  assert.equal(await llm.complete({ system: 'sys', user: 'hello', maxTokens: 123 }), 'anthropic says hi');
  const req = seen.at(-1)!;
  assert.equal(req.path, '/v1/messages');
  assert.equal(req.headers['x-api-key'], 'ak-test');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(req.body, { model: 'claude-sonnet-5-5', max_tokens: 123, system: 'sys', messages: [{ role: 'user', content: 'hello' }] });
});

test('API errors surface status without leaking the key', async () => {
  const llm = createLlmFromEnv({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-secret', AI_MODEL: 'fail', OPENAI_BASE_URL: `${baseUrl}/v1` });
  await assert.rejects(llm!.complete({ system: 's', user: 'u' }), (error: Error) => {
    assert.match(error.message, /AI API 429/);
    assert.ok(!error.message.includes('sk-secret'));
    return true;
  });
});
