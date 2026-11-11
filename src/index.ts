import { handleDashboard } from "./dashboard";
import { runCustomCommand } from "./command-interaction";
import { runDefaultCommand, isDefaultCommand, ensureDefaultCommands } from "./default-commands";
import { handleVerificationInteraction } from "./verify";
import { TERMS_HTML } from "./terms";
import { TERMS_OF_USE_HTML } from "./terms-of-use";
import { VERIFY_PAGE_HTML } from "./verify-page";
import { jsonResponse } from "./discord/api";
import { InteractionType } from "./discord/types";
import type { Interaction } from "./discord/types";
import { verifyDiscordRequest } from "./discord/verify";
import type { Env } from "./env";
import { intVar } from "./env";
import { flushTemp } from "./storage/temp";
import { checkLockedModelChannels } from "./model-channels";

export { DiscordGateway } from "./gateway";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/terms") {
      return new Response(TERMS_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/terms-of-use") {
      return new Response(TERMS_OF_USE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/verify") {
      return new Response(VERIFY_PAGE_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname !== "/interactions") {
      return handleDashboard(request, env, url);
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { ok, body } = await verifyDiscordRequest(
      request,
      env.DISCORD_PUBLIC_KEY,
    );
    if (!ok) {
      return new Response("Invalid request signature", { status: 401 });
    }

    let interaction: Interaction;
    try {
      interaction = JSON.parse(body) as Interaction;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (interaction.type === InteractionType.Ping) {
      return jsonResponse({ type: 1 });
    }

    if (interaction.type === InteractionType.ApplicationCommand) {
      if (isDefaultCommand(interaction.data?.name)) {
        return runDefaultCommand(env, interaction, request);
      }
      return jsonResponse({ type: 4, data: { content: "Custom commands are disabled.", flags: 64 } });
    }

    if (interaction.type === InteractionType.MessageComponent) {
      if (interaction.data?.custom_id === "verify_member") {
        return handleVerificationInteraction(env, interaction);
      }
      return jsonResponse({ type: 6 });
    }

    return jsonResponse({
      type: 4,
      data: {
        content:
          "This bot is an agent. Send me a message, mention me, or reply to me.",
        flags: 64,
      },
    });
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(ensureDefaultCommands(env));
    ctx.waitUntil(
      flushTemp(env, intVar(env.SYNC_BATCH_SIZE, 10))
        .then((result) => console.log("temp blob sync", result))
        .catch((error) => console.error("temp blob sync failed", error)),
    );

    ctx.waitUntil(
      env.GATEWAY.get(env.GATEWAY.idFromName("main"))
        .fetch("https://gateway.internal/ensure")
        .then((response) => response.text())
        .then((result) => console.log("gateway ensure", result))
        .catch((error) => console.error("gateway ensure failed", error)),
    );

    ctx.waitUntil(
      checkLockedModelChannels(env, 10)
        .then((result) => console.log("model channel recovery", result))
        .catch((error) =>
          console.error("model channel recovery failed", error),
        ),
    );
  },
} satisfies ExportedHandler<Env>;
