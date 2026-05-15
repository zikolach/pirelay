import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type MessageCreateOptions,
} from "discord.js";
import type {
  DiscordApiOperations,
  DiscordButtonComponent,
  DiscordGatewayEvent,
  DiscordInteractionPayload,
  DiscordMessagePayload,
  DiscordSendFilePayload,
  DiscordSendMessagePayload,
} from "./adapter.js";
import { redactSecrets } from "../../config/setup.js";
import type { DiscordRelayConfig } from "../../core/types.js";
import { discordRelayCommandSurface } from "../../commands/surfaces.js";

export interface DiscordLiveOperationsOptions {
  token: string;
  client?: Client;
}

interface DiscordAttachmentLike {
  id: string;
  name: string | null;
  contentType: string | null;
  size: number;
  url: string;
  width: number | null;
  height: number | null;
}

interface DiscordUserLike {
  id: string;
  username: string;
  globalName: string | null;
  discriminator: string;
  bot: boolean;
}

interface DiscordMessageLike {
  id: string;
  channelId: string;
  guildId: string | null;
  author: DiscordUserLike;
  webhookId: string | null;
  content: string;
  mentions?: { users?: Iterable<DiscordUserLike> | { values(): Iterable<DiscordUserLike> } };
  attachments: Iterable<DiscordAttachmentLike> | { values(): Iterable<DiscordAttachmentLike> };
}

type DiscordMentionUsersLike = NonNullable<DiscordMessageLike["mentions"]>["users"];

interface DiscordInteractionLike {
  id: string;
  token: string;
  channelId: string | null;
  guildId: string | null;
  user: DiscordUserLike;
  customId?: string;
  message?: { id: string } | null;
}

interface DiscordChatInputInteractionLike {
  id: string;
  channelId: string | null;
  guildId: string | null;
  user: DiscordUserLike;
  commandName: string;
  options?: { data?: ReadonlyArray<DiscordChatInputOptionLike> };
}

interface DiscordChatInputOptionLike {
  name: string;
  value?: unknown;
  options?: ReadonlyArray<DiscordChatInputOptionLike>;
}

export class DiscordLiveOperations implements DiscordApiOperations {
  private readonly client: Client;
  private readonly token: string;
  private readonly recentInteractions = new Map<string, ButtonInteraction>();

  constructor(options: DiscordLiveOperationsOptions) {
    this.token = options.token;
    this.client = options.client ?? createDiscordClient();
  }

  async connect(handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void> {
    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessageCreate(message, handler);
    });
    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.handleInteractionCreate(interaction, handler);
    });
    try {
      await this.client.login(this.token);
      await this.syncNativeCommandsBestEffort();
    } catch (error) {
      throw new Error(`Discord login failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`);
    }
  }

  async disconnect(): Promise<void> {
    this.recentInteractions.clear();
    this.client.destroy();
  }

  async sendMessage(payload: DiscordSendMessagePayload): Promise<void> {
    const channel = await this.fetchTextChannel(payload.channelId);
    const options: MessageCreateOptions = { content: payload.content || " ", allowedMentions: { parse: [] } };
    const components = discordActionRows(payload.components ?? []);
    if (components.length > 0) options.components = components;
    await channel.send(options);
  }

  async sendFile(payload: DiscordSendFilePayload): Promise<void> {
    const channel = await this.fetchTextChannel(payload.channelId);
    const attachment = new AttachmentBuilder(Buffer.from(payload.data), { name: payload.fileName });
    await channel.send({ content: payload.caption, files: [attachment], allowedMentions: { parse: [] } });
  }

  async sendTyping(channelId: string): Promise<void> {
    const channel = await this.fetchTextChannel(channelId);
    await channel.sendTyping();
  }

  async answerInteraction(interactionId: string, _interactionToken: string | undefined, options?: { text?: string; alert?: boolean }): Promise<void> {
    const interaction = this.recentInteractions.get(interactionId);
    if (!interaction) return;
    const content = options?.text ?? "Done.";
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, ephemeral: Boolean(options?.alert), allowedMentions: { parse: [] } });
      return;
    }
    await interaction.reply({ content, ephemeral: Boolean(options?.alert), allowedMentions: { parse: [] } });
  }

  async downloadFile(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Discord attachment download failed: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  private async handleMessageCreate(message: Message, handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void> {
    const fullMessage = message.partial ? await message.fetch() : message;
    await handler({ type: "message", payload: discordJsMessageToPayload(fullMessage) });
  }

  private async handleInteractionCreate(interaction: Interaction, handler: (event: DiscordGatewayEvent) => Promise<void>): Promise<void> {
    if (interaction.isButton()) {
      this.recentInteractions.set(interaction.id, interaction);
      pruneRecentInteractions(this.recentInteractions);
      await handler({ type: "interaction", payload: discordJsInteractionToPayload(interaction) });
      return;
    }
    if (interaction.isChatInputCommand()) {
      await acknowledgeChatInputBestEffort(interaction);
      await handler({ type: "message", payload: discordJsChatInputInteractionToMessagePayload(interaction) });
    }
  }

  private async syncNativeCommandsBestEffort(): Promise<void> {
    try {
      await withTimeout(waitForDiscordApplication(this.client), 3_000);
      const manager = this.client.application?.commands as DiscordApplicationCommandManagerLike | undefined;
      if (!manager || typeof manager.create !== "function") return;
      await withTimeout(upsertDiscordRelayCommand(manager), 3_000);
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
      console.warn(`Discord native /relay command sync skipped: ${message}`);
    }
  }

  private async fetchTextChannel(channelId: string): Promise<SendableDiscordTextChannel> {
    const channel = await this.client.channels.fetch(channelId);
    if (!isSendableTextChannel(channel)) throw new Error(`Discord channel ${channelId} is not a text channel.`);
    return channel;
  }
}

export const DISCORD_NATIVE_COMMAND_NAME = "relay";
export const DISCORD_NATIVE_SUBCOMMAND_NAMES = discordRelayCommandSurface().subcommands.map((definition) => definition.surfaceName);

// Backwards-compatible name for tests/imports that need the implemented
// subcommand set without implying top-level Discord slash registrations.
export const DISCORD_SLASH_COMMAND_NAMES = DISCORD_NATIVE_SUBCOMMAND_NAMES;

export function createDiscordLiveOperations(config: Pick<DiscordRelayConfig, "botToken">): DiscordApiOperations | undefined {
  if (!config.botToken) return undefined;
  return new DiscordLiveOperations({ token: config.botToken });
}

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
}

export function discordJsMessageToPayload(message: DiscordMessageLike): DiscordMessagePayload {
  return {
    id: message.id,
    channel_id: message.channelId,
    guild_id: message.guildId ?? undefined,
    author: {
      id: message.author.id,
      username: message.author.username,
      global_name: message.author.globalName ?? undefined,
      discriminator: message.author.discriminator,
      bot: message.author.bot,
    },
    webhook_id: message.webhookId ?? undefined,
    content: message.content,
    mentions: discordMentionValues(message.mentions?.users).map((user) => ({ id: user.id, bot: user.bot })),
    attachments: [...discordAttachmentValues(message.attachments)].map((attachment) => ({
      id: attachment.id,
      filename: attachment.name ?? undefined,
      content_type: attachment.contentType ?? undefined,
      size: attachment.size,
      url: attachment.url,
      width: attachment.width ?? undefined,
      height: attachment.height ?? undefined,
    })),
  };
}

function discordAttachmentValues(attachments: DiscordMessageLike["attachments"]): Iterable<DiscordAttachmentLike> {
  if (Symbol.iterator in Object(attachments)) return attachments as Iterable<DiscordAttachmentLike>;
  return (attachments as { values(): Iterable<DiscordAttachmentLike> }).values();
}

function discordMentionValues(users: DiscordMentionUsersLike): DiscordUserLike[] {
  if (!users) return [];
  if ("values" in Object(users)) return [...(users as { values(): Iterable<DiscordUserLike> }).values()];
  return [...users as Iterable<DiscordUserLike>];
}

export function discordJsChatInputInteractionToMessagePayload(interaction: DiscordChatInputInteractionLike): DiscordMessagePayload {
  const args = interaction.options?.data
    ?.flatMap(discordOptionTokens)
    .filter(Boolean)
    .join(" ");
  return {
    id: interaction.id,
    channel_id: interaction.channelId ?? "unknown",
    guild_id: interaction.guildId ?? undefined,
    author: {
      id: interaction.user.id,
      username: interaction.user.username,
      global_name: interaction.user.globalName ?? undefined,
      discriminator: interaction.user.discriminator,
      bot: interaction.user.bot,
    },
    content: `/${interaction.commandName}${args ? ` ${args}` : ""}`,
    attachments: [],
  };
}

export function discordJsInteractionToPayload(interaction: DiscordInteractionLike): DiscordInteractionPayload {
  return {
    id: interaction.id,
    token: interaction.token,
    channel_id: interaction.channelId ?? "unknown",
    guild_id: interaction.guildId ?? undefined,
    user: {
      id: interaction.user.id,
      username: interaction.user.username,
      global_name: interaction.user.globalName ?? undefined,
      discriminator: interaction.user.discriminator,
      bot: interaction.user.bot,
    },
    data: { custom_id: interaction.customId },
    message: interaction.message ? { id: interaction.message.id } : undefined,
  };
}

export function discordActionRows(rows: DiscordButtonComponent[][]): ActionRowBuilder<ButtonBuilder>[] {
  return rows.map((row) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    row.slice(0, 5).map((button) => new ButtonBuilder()
      .setCustomId(button.customId)
      .setLabel(button.label)
      .setStyle(discordButtonStyle(button.style))),
  )).slice(0, 5);
}

function discordButtonStyle(style: DiscordButtonComponent["style"]): ButtonStyle {
  switch (style) {
    case "primary":
      return ButtonStyle.Primary;
    case "danger":
      return ButtonStyle.Danger;
    case "secondary":
      return ButtonStyle.Secondary;
  }
}

interface SendableDiscordTextChannel {
  send(options: MessageCreateOptions): Promise<unknown>;
  sendTyping(): Promise<unknown>;
}

interface DiscordApplicationCommandManagerLike {
  fetch?(): Promise<Iterable<DiscordApplicationCommandLike> | { values(): Iterable<DiscordApplicationCommandLike> }>;
  create(command: Record<string, unknown>): Promise<unknown>;
  edit?(command: string | DiscordApplicationCommandLike, data: Record<string, unknown>): Promise<unknown>;
}

interface DiscordApplicationCommandLike {
  id: string;
  name: string;
}

interface DiscordCommandsCollection {
  values(): Iterable<DiscordApplicationCommandLike>;
}

export function discordRelayApplicationCommandData(): Record<string, unknown> {
  const surface = discordRelayCommandSurface();
  return {
    name: surface.name,
    description: surface.description,
    options: surface.subcommands.map((subcommand) => ({
      type: ApplicationCommandOptionType.Subcommand,
      name: subcommand.surfaceName,
      description: subcommand.description,
      options: discordSubcommandTakesArgs(subcommand.usage) ? [{
        type: ApplicationCommandOptionType.String,
        name: "args",
        description: "Arguments for this PiRelay command.",
        required: false,
      }] : [],
    })),
  };
}

async function waitForDiscordApplication(client: Client): Promise<void> {
  if (client.application) return;
  if (typeof client.isReady === "function" && client.isReady()) return;
  await new Promise<void>((resolve) => {
    client.once(Events.ClientReady, () => resolve());
  });
}

async function upsertDiscordRelayCommand(manager: DiscordApplicationCommandManagerLike): Promise<void> {
  const data = discordRelayApplicationCommandData();
  const existing = await fetchDiscordApplicationCommands(manager);
  const relay = existing.find((command) => command.name === DISCORD_NATIVE_COMMAND_NAME);
  if (relay && manager.edit) {
    await manager.edit(relay.id, data);
    return;
  }
  await manager.create(data);
}

async function fetchDiscordApplicationCommands(manager: DiscordApplicationCommandManagerLike): Promise<DiscordApplicationCommandLike[]> {
  if (!manager.fetch) return [];
  const commands = await manager.fetch();
  if (typeof (commands as DiscordCommandsCollection).values === "function") {
    return [...(commands as DiscordCommandsCollection).values()];
  }
  if (Symbol.iterator in Object(commands)) return [...commands as Iterable<DiscordApplicationCommandLike>];
  return [];
}

export function discordSubcommandTakesArgs(usage: string): boolean {
  return /<[^>]+>|\[[^\]]+\]/.test(usage);
}

function discordOptionTokens(option: DiscordChatInputOptionLike): string[] {
  const nested = option.options?.flatMap(discordOptionTokens) ?? [];
  if (nested.length > 0) return [option.name, ...nested];
  if (option.value === undefined) return [option.name];
  return [String(option.value)];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("native command sync timed out")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function acknowledgeChatInputBestEffort(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true });
      await interaction.deleteReply().catch(() => undefined);
    }
  } catch {
    // The relay sends the actual response as a normal channel message so text
    // and slash-command flows share the same routing behavior.
  }
}

function isSendableTextChannel(channel: unknown): channel is SendableDiscordTextChannel {
  if (!channel || typeof channel !== "object") return false;
  const candidate = channel as { send?: unknown; sendTyping?: unknown; type?: unknown };
  if (typeof candidate.send !== "function" || typeof candidate.sendTyping !== "function") return false;
  return candidate.type !== ChannelType.GuildCategory;
}

function pruneRecentInteractions(interactions: Map<string, ButtonInteraction>): void {
  if (interactions.size <= 100) return;
  const [firstKey] = interactions.keys();
  if (firstKey) interactions.delete(firstKey);
}
