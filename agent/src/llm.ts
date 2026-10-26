/** Minimal client for a local Ollama server (https://ollama.com). */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface Llm {
  readonly model: string;
  chat(messages: ChatMessage[], opts?: { json?: boolean }): Promise<string>;
  /** Frees the model's memory. Safe to call when nothing is loaded. */
  unload(): Promise<void>;
}

export class Ollama implements Llm {
  constructor(
    readonly model = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
    private url = process.env.OLLAMA_URL ?? "http://localhost:11434",
    private timeoutMs = 300_000,
  ) {}

  async chat(messages: ChatMessage[], opts: { json?: boolean } = {}): Promise<string> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          format: opts.json ? "json" : undefined,
          // A short keep-alive and a 4k context keep memory use low on modest machines.
          keep_alive: "2m",
          options: { temperature: 0.1, num_ctx: 4096 },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new Error(`Can't reach Ollama at ${this.url}. Is it running? (${(err as Error).message})`);
    }
    if (!res.ok) throw new Error(`Ollama answered ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { message?: { content?: string } };
    return body.message?.content ?? "";
  }

  async unload(): Promise<void> {
    await fetch(`${this.url}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: this.model, keep_alive: 0 }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {});
  }
}

/** Parses a JSON reply, tolerating code fences or text around the object. */
export function parseJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`No JSON object in reply: ${text.slice(0, 200)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}
