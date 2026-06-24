import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import type { LLMDistillerConfig, LLMDistillerOutput } from "../../types/inference";
import type { InferenceSignalPayload } from "../../types/signal";
import { isLLMDistillerConfig } from "../../types/guards";
import { Events } from "../../types";

const DEFAULT_PROMPT = `You are a prediction-market analyst. Given the following market snapshot, output a JSON object assessing the most actionable opportunity.

Market snapshot:
{{marketSummary}}

Order book top-of-book:
{{orderBookSlice}}

Timestamp: {{timestamp}}

Respond ONLY with a JSON object matching this schema:
{
  "tokenId": "<the token ID you are analyzing>",
  "confidence": <0.0 to 1.0>,
  "rationale": "<one sentence>",
  "suggestedSide": "BUY" | "SELL" | "HOLD",
  "suggestedSize": <integer>
}`;

const DEFAULT_OUTPUT_SCHEMA = JSON.stringify({
  type: "object",
  required: ["tokenId", "confidence", "rationale"],
  properties: {
    tokenId: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" },
    suggestedSide: { enum: ["BUY", "SELL", "HOLD"] },
    suggestedSize: { type: "number" },
  },
});

const DEFAULT_CONFIG: LLMDistillerConfig = {
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  promptTemplate: DEFAULT_PROMPT,
  outputSchema: DEFAULT_OUTPUT_SCHEMA,
  maxTokens: 256,
  temperature: 0,
  refreshIntervalMs: 120_000,
  minConfidence: 0.5,
};

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

export class LLMDistillerAdapter implements SignalAdapter {
  readonly name = "llm-distiller";
  readonly version = "1.0.0";

  private config: LLMDistillerConfig = { ...DEFAULT_CONFIG };
  private ctx?: AdapterContext;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private apiKey?: string;
  private healthy = true;
  private lastRequestAt = 0;
  private requestCount = 0;

  async initialize(ctx: AdapterContext): Promise<void> {
    const raw = { ...DEFAULT_CONFIG, ...(ctx.config as Partial<LLMDistillerConfig>) };
    if (!isLLMDistillerConfig(raw)) {
      // Allow partial configs by merging with defaults — only throw if truly invalid
      ctx.logger.warn("LLMDistillerAdapter config has invalid fields; using defaults where needed");
    }
    this.config = raw as LLMDistillerConfig;

    this.apiKey = this.resolveApiKey();
    if (!this.apiKey) {
      ctx.logger.warn(
        `LLMDistillerAdapter: no API key for provider "${this.config.provider}" — will not emit signals`
      );
    }
    this.stopped = false;
    ctx.logger.info("LLMDistillerAdapter initialized", {
      provider: this.config.provider,
      model: this.config.model,
    });
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    if (!this.apiKey) return; // Guard: no key = silent no-op

    await this.query();
    this.timer = setInterval(() => {
      this.query().catch((err) => {
        ctx.logger.error("LLM distiller query error", { error: String(err) });
        this.healthy = false;
      });
    }, this.config.refreshIntervalMs);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  diagnostics(): Record<string, unknown> {
    return {
      provider: this.config.provider,
      model: this.config.model,
      requestCount: this.requestCount,
      lastRequestAt: this.lastRequestAt,
    };
  }

  private resolveApiKey(): string | undefined {
    if (this.config.apiKey) return this.config.apiKey;
    switch (this.config.provider) {
      case "anthropic":
        return Bun.env.POLYMARKET_ANTHROPIC_API_KEY;
      case "openai":
        return Bun.env.POLYMARKET_OPENAI_API_KEY;
      case "google":
        return Bun.env.POLYMARKET_GOOGLE_API_KEY;
      case "local":
        return "local"; // Ollama doesn't need a real key
      default:
        return undefined;
    }
  }

  private buildPrompt(): string {
    if (!this.ctx) return "";

    const marketSummary = "No markets tracked yet";
    const orderBookSlice = "No order books available";
    const timestamp = new Date().toISOString();

    return this.config.promptTemplate
      .replace("{{marketSummary}}", marketSummary)
      .replace("{{orderBookSlice}}", orderBookSlice)
      .replace("{{timestamp}}", timestamp);
  }

  private async query(): Promise<void> {
    if (this.stopped || !this.ctx || !this.apiKey) return;

    // Rate limiting
    if (this.config.rateLimitRpm) {
      const minGap = (60_000 / this.config.rateLimitRpm);
      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < minGap) return;
    }

    const prompt = this.buildPrompt();
    let rawText: string;

    try {
      rawText = await this.callProvider(prompt);
      this.lastRequestAt = Date.now();
      this.requestCount++;
      this.healthy = true;
    } catch (err) {
      this.ctx.logger.error("LLM provider call failed", { error: String(err) });
      this.healthy = false;
      return;
    }

    let parsed: LLMDistillerOutput;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object in response");
      parsed = JSON.parse(jsonMatch[0]) as LLMDistillerOutput;
    } catch (err) {
      this.ctx.logger.warn("Failed to parse LLM response", { error: String(err), rawText: rawText.slice(0, 200) });
      return;
    }

    if (!parsed.tokenId || typeof parsed.confidence !== "number") {
      this.ctx.logger.warn("LLM response missing required fields");
      return;
    }

    if (parsed.confidence < this.config.minConfidence) return;

    const payload: InferenceSignalPayload = {
      model: this.config.model,
      prompt: prompt.slice(0, 500),
      output: rawText.slice(0, 1000),
      parsedConfidence: parsed.confidence,
      rawTokens: this.config.maxTokens,
    };

    const signal: Signal<InferenceSignalPayload> = {
      id: crypto.randomUUID(),
      kind: "inference",
      source: this.name,
      tokenId: parsed.tokenId,
      confidence: parsed.confidence,
      payload,
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + this.config.refreshIntervalMs * 2),
      metadata: {
        suggestedSide: parsed.suggestedSide,
        suggestedSize: parsed.suggestedSize,
        rationale: parsed.rationale,
      },
    };

    this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    this.ctx.logger.info("LLM inference signal emitted", {
      tokenId: parsed.tokenId,
      confidence: parsed.confidence,
      side: parsed.suggestedSide,
    });
  }

  private async callProvider(prompt: string): Promise<string> {
    const timeoutMs = this.config.timeoutMs ?? 30_000;

    switch (this.config.provider) {
      case "anthropic":
        return this.callAnthropic(prompt, timeoutMs);
      case "openai":
        return this.callOpenAI(prompt, timeoutMs);
      case "local":
        return this.callOllama(prompt, timeoutMs);
      default:
        throw new Error(`Unsupported LLM provider: ${this.config.provider}`);
    }
  }

  private async callAnthropic(prompt: string, timeoutMs: number): Promise<string> {
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [{ role: "user", content: prompt }] satisfies AnthropicMessage[],
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { content: Array<{ type: string; text: string }> };
    const textBlock = data.content.find((c) => c.type === "text");
    return textBlock?.text ?? "";
  }

  private async callOpenAI(prompt: string, timeoutMs: number): Promise<string> {
    const baseUrl = this.config.baseUrl ?? "https://api.openai.com";
    const body = {
      model: this.config.model,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    };

    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message.content ?? "";
  }

  private async callOllama(prompt: string, timeoutMs: number): Promise<string> {
    const baseUrl = this.config.baseUrl ?? "http://localhost:11434";
    const body = {
      model: this.config.model,
      prompt,
      stream: false,
      format: "json",
    };

    const resp = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ollama API ${resp.status}: ${text.slice(0, 200)}`);
    }

    const data = (await resp.json()) as { response?: string };
    return data.response ?? "";
  }
}

export const llmDistillerDescriptor: AdapterDescriptor = {
  name: "llm-distiller",
  version: "1.0.0",
  description: "Queries an LLM on a schedule and emits inference signals. Supports Anthropic, OpenAI, and Ollama via BYOK env vars.",
  factory: (_config) => new LLMDistillerAdapter(),
};
