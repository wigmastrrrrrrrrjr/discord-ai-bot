import { runAgent } from "./agent";
import { getGuildCommand, renderCommandPrompt } from "./custom-commands";
import { InteractionStream } from "./discord/stream";
import { intVar } from "./env";
import { applyGuildApiKeys } from "./guild-secrets";
import { loadHistory, saveHistory } from "./memory";
import type { Env } from "./env";
import type { Interaction } from "./discord/types";

export async function runCustomCommand(
  env: Env,
  interaction: Interaction,
): Promise<void> {
  if (!interaction.guild_id) return;

  const name = interaction.data?.name;
  if (!name) return;

  const command = await getGuildCommand(env, interaction.guild_id, name);
  if (!command || !command.enabled) return;

  const userId =
    interaction.member?.user?.id ?? interaction.user?.id ?? "unknown";
  const username =
    interaction.member?.user?.username ?? interaction.user?.username ?? "user";
  const channelId = interaction.channel_id ?? "";
  const inputOption = interaction.data?.options?.find(
    (option) => option.name === "input",
  );
  const input =
    inputOption?.value == null ? "" : String(inputOption.value);

  const prompt = renderCommandPrompt(command.prompt, {
    input,
    user: userId,
    username,
    channel: channelId,
    command: name,
  });

  const scope = `guilds/${interaction.guild_id}`;
  const historyKey = `conv:guild:${interaction.guild_id}:${channelId || "commands"}:command:${name}`;
  const maxHistory = intVar(env.MAX_HISTORY_MESSAGES, 20);
  const history = await loadHistory(env, historyKey, maxHistory);
  const requestEnv = await applyGuildApiKeys(env, interaction.guild_id);

  const stream = new InteractionStream(interaction, false);
  await stream.start();

  try {
    const result = await runAgent(requestEnv, {
      scope,
      guildId: interaction.guild_id,
      history,
      prompt,
      systemPrompt: command.description
        ? `You are handling the /${name} command. ${command.description}`
        : undefined,
      stream: {
        onDelta: (text) => stream.delta(text),
        onReasoning: (text) => stream.reasoning(text),
        onStatus: (status) => stream.setStatus(status),
      },
    });

    const footer = `\n\n-# via ${result.provider} · ${result.model}`;
    await saveHistory(
      env,
      historyKey,
      [
        ...history,
        { role: "user", content: input || `/${name}` },
        { role: "assistant", content: result.text },
      ],
      maxHistory,
    );
    await stream.finish(result.text + footer);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    await stream.fail(`⚠️ Command failed: ${text.slice(0, 500)}`);
  }
}
