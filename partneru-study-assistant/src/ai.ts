// Minimal LLM client over fetch (no SDK dependency). Disabled unless the
// learner opts in with AI_PROVIDER — an API key that merely exists in the
// environment does not switch it on.

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface LlmClient {
  provider: string;
  model: string;
  complete(request: CompletionRequest): Promise<string>;
}

const TIMEOUT_MS = 120_000;

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AI API ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function openAiClient(apiKey: string, model: string, baseUrl: string): LlmClient {
  return {
    provider: 'openai',
    model,
    async complete({ system, user }) {
      const data = await postJson(
        `${baseUrl.replace(/\/$/, '')}/chat/completions`,
        { authorization: `Bearer ${apiKey}` },
        {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        },
      );
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('AI API trả về không có nội dung.');
      return content;
    },
  };
}

function anthropicClient(apiKey: string, model: string, baseUrl: string): LlmClient {
  return {
    provider: 'anthropic',
    model,
    async complete({ system, user, maxTokens = 4000 }) {
      const data = await postJson(
        `${baseUrl.replace(/\/$/, '')}/v1/messages`,
        { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
      );
      const blocks: Array<{ type: string; text?: string }> = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (!text) throw new Error('AI API trả về không có nội dung.');
      return text;
    },
  };
}

export function createLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient | null {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  if (!provider || provider === 'none' || provider === 'off') return null;

  if (provider === 'openai') {
    const key = env.OPENAI_API_KEY;
    const model = env.AI_MODEL || env.OPENAI_MODEL;
    if (!key) throw new Error('AI_PROVIDER=openai nhưng thiếu OPENAI_API_KEY.');
    if (!model) throw new Error('AI_PROVIDER=openai cần AI_MODEL (model được phép dùng).');
    return openAiClient(key, model, env.OPENAI_BASE_URL || 'https://api.openai.com/v1');
  }
  if (provider === 'anthropic') {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('AI_PROVIDER=anthropic nhưng thiếu ANTHROPIC_API_KEY.');
    const model = env.AI_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
    return anthropicClient(key, model, env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  }
  throw new Error(`AI_PROVIDER không hỗ trợ: ${provider} (dùng openai | anthropic).`);
}
