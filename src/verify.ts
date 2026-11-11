import { botApi } from "./discord/rest";
import type { Env } from "./env";
import type { Interaction } from "./discord/types";
import { jsonResponse } from "./discord/api";

const VERIFIED_ROLE_NAME = "Verified";

export async function handleVerificationInteraction(
  env: Env,
  interaction: Interaction,
): Promise<Response> {
  const ephemeral = (content: string, status = 200) =>
    jsonResponse(
      {
        type: 4,
        data: { content, flags: 64 },
      },
      status,
    );

  if (!interaction.guild_id || !interaction.member?.user?.id) {
    return ephemeral("This button can only be used in a server.", 400);
  }
  if (interaction.member.user.bot) {
    return ephemeral("Bots cannot verify.", 400);
  }

  const guildId = interaction.guild_id;
  const userId = interaction.member.user.id;

  try {
    const rolesResponse = await botApi(env, `/guilds/${guildId}/roles`);
    if (!rolesResponse.ok) {
      return ephemeral("Could not load server roles.", 500);
    }
    const roles = (await rolesResponse.json()) as Array<{
      id: string;
      name: string;
    }>;
    const verifiedRole = roles.find((role) => role.name === VERIFIED_ROLE_NAME);
    if (!verifiedRole) {
      return ephemeral("The Verified role has not been configured yet.", 500);
    }

    if (interaction.member.roles?.includes(verifiedRole.id)) {
      return ephemeral("You are already verified.");
    }

    const response = await botApi(
      env,
      `/guilds/${guildId}/members/${userId}/roles/${verifiedRole.id}`,
      { method: "PUT" },
    );
    if (!response.ok) {
      return ephemeral(
        `Verification failed: ${(await response.text()).slice(0, 200)}`,
        500,
      );
    }

    return ephemeral("You are now verified and can access the server.");
  } catch (error) {
    return ephemeral(
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}
