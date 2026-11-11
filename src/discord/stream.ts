import type { Env } from "../env";
import { editOriginal, sendText, splitMessage } from "./api";
import {
  editChannelMessage,
  editWebhookMessage,
  sendChannelAttachment,
  sendChannelMessage,
  sendWebhookAttachment,
  sendWebhookMessage,
  type IdentityWebhook,
  type OutgoingFile,
} from "./rest";
import type { Interaction } from "./types";

const CURSOR = "█";
const LIVE_LIMIT = 1900;
const STATUS_LIMIT = 140;
const SPINNERS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const RATE_LIMIT_BATCH_SIZE = 5;
const RATE_LIMIT_DELAY_MS = 300;
const SPINNER_INTERVAL_MS = 100;

abstract class LiveStream {
  private text = "";
  private reasoningText = "";
  private statusText = "Thinking…";
  private started = false;
  private finished = false;
  private failed = false;
  private lastEditAt = 0;
  private chain: Promise<void> = Promise.resolve();
  private spinnerIndex = 0;
  private editCount = 0;
  private spinnerTimer: number | null = null;

  protected abstract open(content: string): Promise<void>;
  protected abstract editLive(content: string): Promise<void>;
  protected abstract finishWith(
    content: string,
    files?: OutgoingFile[],
  ): Promise<void>;

  async start(): Promise<void> {
    if (this.started || this.finished) return;
    this.started = true;
    await this.open(this.renderLive());
    this.lastEditAt = Date.now();
  }

  delta(text: string): void {
    if (!text || this.finished) return;
    this.text += text;
    this.statusText = "Writing…";
    this.schedule();
  }

  reasoning(text: string): void {
    if (!text || this.finished) return;
    this.reasoningText = (this.reasoningText + text).slice(-2000);
    this.schedule();
  }

  setStatus(status: string): void {
    if (!status || this.finished || status === this.statusText) return;
    this.statusText = status;
    this.schedule();
  }

  async finish(text: string, files?: OutgoingFile[]): Promise<void> {
    if (this.finished || this.failed) return;
    this.finished = true;
    await this.chain;
    await this.finishWith(text.trim() || "Done.", files);
  }

  async fail(text: string): Promise<void> {
    if (this.failed) return;
    this.failed = true;
    this.finished = true;
    await this.chain;
    await this.finishWith(text.trim() || "⚠️ Request failed.");
  }

  private statusLine(): string {
    const reasoning = this.reasoningText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    const label = (reasoning || this.statusText)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, STATUS_LIMIT);
    const spinner = this.statusText === "Thinking…" ? SPINNERS[this.spinnerIndex % SPINNERS.length] : " ";
    return `\n-# ${spinner} ${label || "Thinking…"}`;
  }

  private renderLive(): string {
    const suffix = `${CURSOR}${this.statusLine()}`;
    const budget = LIVE_LIMIT - suffix.length;
    const body =
      this.text.length > budget
        ? `…${this.text.slice(this.text.length - (budget - 1))}`
        : this.text;
    return `${body}${suffix}`;
  }

  private schedule(): void {
    if (!this.started || this.finished) return;
    this.scheduleSpinner();
    void this.flush();
  }

  private scheduleSpinner(): void {
    if (this.spinnerTimer) return; // Already scheduled
    
    this.spinnerTimer = setTimeout(() => {
      if (!this.finished && this.statusText === "Thinking…") {
        this.spinnerIndex++;
        void this.editSpinner();
      }
      this.spinnerTimer = null;
    }, SPINNER_INTERVAL_MS);
  }

  private async editSpinner(): Promise<void> {
    try {
      await this.editLive(this.renderLive());
      this.lastEditAt = Date.now();
    } catch (error) {
      console.error("Spinner edit failed", error);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private flush(): Promise<void> {
    const run = async (): Promise<void> => {
      if (this.finished) return;
      
      // Check if we need to wait for rate limiting
      // Wait 300ms after every 5 edits before allowing the next edit
      if (this.editCount > 0 && this.editCount % RATE_LIMIT_BATCH_SIZE === 0) {
        await this.sleep(RATE_LIMIT_DELAY_MS);
      }
      
      try {
        await this.editLive(this.renderLive());
        this.lastEditAt = Date.now();
        this.editCount++;
      } catch (error) {
        console.error("Streaming edit failed", error);
      }
    };
    this.chain = this.chain.then(run, run);
    return this.chain;
  }
}

export class InteractionStream extends LiveStream {
  constructor(
    private readonly interaction: Interaction,
    private readonly ephemeral: boolean,
  ) {
    super();
  }

  protected open(content: string): Promise<void> {
    return editOriginal(this.interaction, {
      content,
      ephemeral: this.ephemeral,
    });
  }

  protected editLive(content: string): Promise<void> {
    return editOriginal(this.interaction, {
      content,
      ephemeral: this.ephemeral,
    });
  }

  protected finishWith(content: string): Promise<void> {
    // Strip the thinking cursor/status from the final output
    const cleanContent = content.replace(/\s*\n-#\s*[\u2800-\u28ff]\s*[^\n]*$/u, "").trim();
    return sendText(this.interaction, cleanContent, this.ephemeral);
  }
}

export class ChannelStream extends LiveStream {
  private messageId = "";

  constructor(
    private readonly env: Env,
    private readonly channelId: string,
    private readonly identity?: IdentityWebhook,
  ) {
    super();
  }

  private static stripStatus(content: string): string {
    return content
      .replace(/\s*\n-#\s*[\u2800-\u28ff]\s*[^\n]*$/u, "")
      .trim();
  }

  protected async open(content: string): Promise<void> {
    const message = this.identity
      ? await sendWebhookMessage(this.env, this.identity, content)
      : await sendChannelMessage(this.env, this.channelId, content);
    this.messageId = message.id;
  }

  protected async editLive(content: string): Promise<void> {
    if (!this.messageId) {
      await this.open(content);
      return;
    }
    if (this.identity) {
      await editWebhookMessage(this.env, this.identity, this.messageId, content);
      return;
    }
    await editChannelMessage(
      this.env,
      this.channelId,
      this.messageId,
      content,
    );
  }

  protected async finishWith(
    content: string,
    files?: OutgoingFile[],
  ): Promise<void> {
    const chunks = splitMessage(content);
    const first = chunks[0] ?? content;

    if (!this.messageId) {
      const cleaned = ChannelStream.stripStatus(first);
      if (this.identity) {
        const message = await sendWebhookMessage(this.env, this.identity, cleaned);
        // First chunk already sent; send the rest below.
        this.messageId = message.id;
      } else {
        // Strip thinking status from initial message
        const message = await sendChannelMessage(this.env, this.channelId, cleaned);
        this.messageId = message.id;
      }
      if (chunks.length <= 1) return;
    }

    const headEdit = ChannelStream.stripStatus(first);
    if (this.identity) {
      await editWebhookMessage(this.env, this.identity, this.messageId, headEdit);
    } else {
      await editChannelMessage(
        this.env,
        this.channelId,
        this.messageId,
        headEdit,
      );
    }
    for (const chunk of chunks.slice(1)) {
      if (this.identity) {
        await sendWebhookMessage(this.env, this.identity, chunk);
      } else {
        await sendChannelMessage(this.env, this.channelId, chunk);
      }
    }
    if (files?.length) {
      const upload = files.slice(0, 5);
      if (this.identity) {
        await sendWebhookAttachment(
          this.env,
          this.identity,
          "",
          upload,
        );
      } else {
        await sendChannelAttachment(this.env, this.channelId, "", upload);
      }
    }
  }
}
