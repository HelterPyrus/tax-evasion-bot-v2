const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
require("dotenv").config();

const { ALLOWED_GUILD_ID } = require("./config/constants");

const pickraid = require("./commands/pickraid");
const pickraidmulti = require("./commands/pickraidmulti");
const finish = require("./commands/finish");
const addon = require("./commands/addon");
const cleanraid = require("./commands/cleanraid");
const finishmulti = require("./commands/finishmulti");
const group = require("./commands/group");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: ["MESSAGE", "CHANNEL", "REACTION"]
});

client.once("ready", () => {
  console.log(`Bot online as ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      { name: "🤔 Deciding who's getting gkicked!", type: ActivityType.Playing }
    ],
    status: "online"
  });
});

client.on("clientReady", () => {
  console.log(`Bot online as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
  if (message.author.bot) return;

  const [command, ...args] = message.content.trim().split(/\s+/);

  // Ephemeral reply helper — deletes after timeout AND deletes the original command
  const sendTempReply = async (content, timeout = 15000) => {
    try {
      const replyMsg = await message.reply(content);
      setTimeout(() => replyMsg.delete().catch(() => { }), timeout);
      setTimeout(() => message.delete().catch(() => { }), 50); // delete command immediately
    } catch { }
  };

  switch (command) {
    case "!pickraid":
      if (!args.length) {
        return sendTempReply(
          "**Usage:**\n" +
          "`!pickraid [\"Raid Name - DD/MM/YYYY\"] <Raid-Helper Event ID>`\n\n" +
          "**Notes:**\n" +
          "- Raid name/date is optional (wrap in quotes). Defaults to `Raid #1` if omitted.\n" +
          "- Event ID must be valid on Raid-Helper.\n" +
          "- Only Core Raiders who are not Officers/Moderators are eligible.\n" +
          "- When everything is done and ready, run **!finish** to assign roles and log picks."
        );
      }
      return pickraid(message, args);

    case "!pickraidmulti":
      if (!args.length) {
        return sendTempReply(
          "**Usage:**\n" +
          "`!pickraidmulti [\"Raid Name - DD/MM/YYYY\"] @r1user1 @r1user2 ... | @r2user1 @r2user2 ... | @r3user1 @r3user2 ...`\n\n" +
          "**Notes:**\n" +
          "- Raid name/date is optional (wrap in quotes). Defaults to `Raid #1`, `Raid #2`, etc., if omitted.\n" +
          "- Separate multiple raid groups with `|`.\n" +
          "- Mentions must be valid Core Raiders who are not Officers/Moderators.\n" +
          "- When everything is done and ready, run **!finishmulti** to assign roles and log picks."
        );
      }
      return pickraidmulti(message, args, 5);

    case "!pickraidmultismall":
      if (!args.length) {
        return sendTempReply(
          message,
          "**Usage:**\n" +
          "`!pickraidmulti [\"Raid Name - DD/MM/YYYY\"] @r1user1 @r1user2 ... | @r2user1 @r2user2 ... | @r3user1 @r3user2 ...`\n\n" +
          "**Notes:**\n" +
          "- Raid name/date is optional (wrap in quotes). Defaults to `Raid #1`, `Raid #2`, etc., if omitted.\n" +
          "- Separate multiple raid groups with `|`.\n" +
          "- Mentions must be valid Core Raiders who are not Officers/Moderators.\n" +
          "- When everything is done and ready, run **!finishmulti** to assign roles and log picks."
        );
      }
      return pickraidmulti(message, args, 3);

    case "!group":
      if (!args.length) {
        return sendTempReply(
          "**Usage:**\n" +
          "`!group <Dungeon Name> [DD/MM/YYYY HH:mm]`\n\n" +
          "**Examples:**\n" +
          "`!group Ragefire Chasm`\n" +
          "`!group Shadowfang Keep 12/01/2026 20:45`\n\n" +
          "**Notes:**\n" +
          "- Open to all guild members.\n" +
          "- Time must be entered in **Server Time**.\n" +
          "- Embed will show the correct local time for each user.\n" +
          "- Group size is **5 players** (1 Tank, 1 Healer, 3 DPS).\n" +
          "- Make sure you react with your desired role. If you change your mind, click the same emoji again to remove yourself or select another role if available.\n" +
          "- When the group is full, it will be marked as **FULL**."
        );
      }
      return group(message, args);

    case "!addon":
      return addon(message);

    case "!finish":
      return finish(message);

    case "!finishmulti":
      return finishmulti(message);

    case "!cleanraid":
      return cleanraid(message);
  }
});


client.on("error", console.error);

client.login(process.env.TOKEN);
