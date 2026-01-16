const axios = require("axios");
const {
  ROLES,
  PICKS,
  AUDIT_CHANNEL_ID,
  LOOT_COUNCIL_ROLE_ID
} = require("../config/constants");

const { isOfficerOrModerator } = require("../services/permissionService");
const { ensureMembersFetched } = require("../services/memberService");
const { pick } = require("../services/pickerService");

// Active sessions per channel
const activePickraidSessions = new Map();

// Raid-Helper signup groups to exclude
const EXCLUDED_CLASSES = new Set([
  "Absence",
  "Bench",
  "Tentative",
  "Late"
]);

/* ----------------------------- Helpers ----------------------------- */

// ephemeral-style temporary reply (auto-deletes after 20s)
const sendTempReply = (message, content, timeout = 20000) => {
  message.reply(content)
    .then(msg => setTimeout(() => msg.delete().catch(() => {}), timeout));
};

async function fetchRaidMembers(raidId, guild) {
  const url = `https://raid-helper.dev/api/v2/events/${raidId}`;
  const { data } = await axios.get(url);

  if (!data || !Array.isArray(data.signUps)) {
    throw new Error("Invalid Raid-Helper response");
  }

  const members = [];
  const notFound = [];

  for (const signup of data.signUps) {
    if (EXCLUDED_CLASSES.has(signup.className)) continue;

    if (!signup.userId) {
      notFound.push(`${signup.name} (no Discord linked)`);
      continue;
    }

    const member = guild.members.cache.get(signup.userId);
    member
      ? members.push(member)
      : notFound.push(`${signup.name} (not in guild)`);
  }

  return { members, notFound };
}

/* ---------------------------- MAIN COMMAND --------------------------- */

module.exports = async function pickraid(message, args) {
  if (!isOfficerOrModerator(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Officers and Moderators.");
  }

  if (!args.length) {
    return sendTempReply(message, "You must provide a Raid-Helper Event ID.");
  }

  await ensureMembersFetched(message.guild);

  const coreRole = message.guild.roles.cache.find(r => r.name === ROLES.CORE);
  const officerRole = message.guild.roles.cache.find(r => r.name === ROLES.OFFICER);
  const moderatorRole = message.guild.roles.cache.find(r => r.name === ROLES.MODERATOR);

  /* -------- Parse optional raid name ---------- */
  let raidName = null;
  let raidId = args[0];

  if (args[0].startsWith('"')) {
    const combined = args.join(" ");
    const match = combined.match(/^"([^"]+)"\s+(.+)$/);
    if (match) {
      raidName = match[1].trim();
      raidId = match[2].trim().split(/\s+/)[0];
    }
  }

  let eligible = [];
  let ineligible = [];

  try {
    const { members: raidMembers, notFound } =
      await fetchRaidMembers(raidId, message.guild);

    ineligible.push(...notFound);

    for (const m of raidMembers) {
      if (!m.roles.cache.has(coreRole.id))
        ineligible.push(`<@${m.id}> (not Core Raider)`);
      else if (officerRole && m.roles.cache.has(officerRole.id))
        ineligible.push(`<@${m.id}> (Officer)`);
      else if (moderatorRole && m.roles.cache.has(moderatorRole.id))
        ineligible.push(`<@${m.id}> (Moderator)`);
      else
        eligible.push(m);
    }
  } catch (err) {
    return sendTempReply(message, `Failed to fetch Raid-Helper event. ${err.message}`);
  }

  if (!eligible.length) {
    return sendTempReply(message, "No eligible Core Raiders found.");
  }

  /* ----------------------------- STATE ------------------------------ */

  const maxCount = Math.min(PICKS, eligible.length);

  let provisional = pick(eligible, maxCount);
  let pool = eligible.filter(m => !provisional.includes(m));

  const confirmed = new Set();
  const declined = new Set();
  const replacements = new Map(); // newId -> oldId
  const lastReaction = new Map();
  const replacementMessages = [];

  const renderEmbed = () => {
    const isReady = confirmed.size === maxCount;
    const provisionalList = provisional.filter(
      m => !confirmed.has(m.id) && !declined.has(m.id)
    );

    const description = [
      isReady
        ? "**STATUS:** 🟢 READY TO FINISH — Officer may use `!finish`"
        : "**STATUS:** 🟡 Awaiting confirmations",
      "",
      `🕒 **Provisional (${provisionalList.length})**`,
      ...provisionalList.map(m => `- <@${m.id}>`),
      "",
      `✅ **Confirmed (${confirmed.size}/${maxCount})**`,
      ...[...confirmed].map(id => `- <@${id}>`),
      "",
      `❌ **Declined**`,
      ...[...declined].map(id => `- <@${id}>`)
    ];

    if (replacements.size > 0) {
      description.push("", "🔄 **Replacements**");
      description.push(
        ...[...replacements.entries()].map(
          ([newId, oldId]) => `- <@${oldId}> ➜ <@${newId}>`
        )
      );
    }

    return {
      title: raidName || "🎲 Loot Council – Raid #1",
      color: isReady ? 0x2ecc71 : 0xf1c40f,
      description: description.join("\n")
    };
  };

  /* -------------------------- SESSION INIT --------------------------- */

  if (activePickraidSessions.has(message.channel.id)) {
    activePickraidSessions.get(message.channel.id).collector.stop();
  }

  const embedMessage = await message.channel.send({
    embeds: [renderEmbed()]
  });

  await embedMessage.react("✅");
  await embedMessage.react("❌");

  const collector = embedMessage.createReactionCollector({});

  const getAllowedIds = () =>
    provisional.map(m => m.id).concat([...confirmed]);

  collector.on("collect", async (reaction, user) => {
    const member = message.guild.members.cache.get(user.id);
    if (!member) return;

    const allowedIds = getAllowedIds();

    if (!["✅", "❌"].includes(reaction.emoji.name) ||
      !allowedIds.includes(user.id)) {
      try { await reaction.users.remove(user.id); } catch { }
      return;
    }

    if (declined.has(member.id)) {
      try { await reaction.users.remove(user.id); } catch { }
      return;
    }

    const prev = lastReaction.get(user.id);
    if (prev && prev !== reaction.emoji.name) {
      try {
        await embedMessage.reactions.cache
          .get(prev)?.users.remove(user.id);
      } catch { }
    }

    lastReaction.set(user.id, reaction.emoji.name);

    if (reaction.emoji.name === "✅") {
      confirmed.add(member.id);
    }

    if (reaction.emoji.name === "❌") {
      confirmed.delete(member.id);
      declined.add(member.id);

      const replacement = pool.shift();
      if (replacement) {
        replacements.set(replacement.id, member.id);
        provisional = provisional.map(m =>
          m.id === member.id ? replacement : m
        );

        try {
          const msg = await message.channel.send(
            `❌ <@${member.id}> declined — summoning <@${replacement.id}> as **Provisional**.`
          );
          replacementMessages.push(msg);
        } catch { }
      }
    }

    embedMessage.edit({ embeds: [renderEmbed()] });
  });

  activePickraidSessions.set(message.channel.id, {
    collector,
    message: embedMessage,
    replacementMessages,
    state: {
      provisional,
      confirmed,
      declined,
      replacements,
      raidName,
      maxCount
    }
  });
};

/* ------------------------------ FINISH ------------------------------ */

module.exports.finish = async function finishPickraid(message) {
  if (!isOfficerOrModerator(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Officers and Moderators.");
  }

  const session = activePickraidSessions.get(message.channel.id);
  if (!session) {
    return sendTempReply(message, "No active loot council session in this channel.");
  }

  const {
    confirmed,
    declined,
    replacements,
    raidName,
    maxCount
  } = session.state;

  if (confirmed.size !== maxCount) {
    return sendTempReply(
      message,
      `❌ Cannot finish yet.\nConfirmed: **${confirmed.size}/${maxCount}**`
    );
  }

  session.collector.stop();

  try { await session.message.delete(); } catch { }
  for (const msg of session.replacementMessages) {
    try { await msg.delete(); } catch { }
  }

  const finalRoster = [...confirmed]
    .map(id => `- <@${id}>`)
    .join("\n");

  await message.channel.send(
    `🎲 **Final Loot Council${raidName ? ` – ${raidName}` : ""} (Confirmed):**\n${finalRoster}`
  );

  try {
    const role = message.guild.roles.cache.get(LOOT_COUNCIL_ROLE_ID);
    if (role) {
      for (const id of confirmed) {
        const member = message.guild.members.cache.get(id);
        if (member) await member.roles.add(role);
      }
    }

    const auditChannel = message.guild.channels.cache.get(AUDIT_CHANNEL_ID);
    if (auditChannel) {
      await auditChannel.send({
        embeds: [{
          title: `📋 Loot Council Audit Log${raidName ? ` – ${raidName}` : ""}`,
          color: 0x3498db,
          fields: [
            { name: "Final Council", value: finalRoster || "None" },
            {
              name: "Declined Members",
              value: declined.size
                ? [...declined].map(id => `- <@${id}>`).join("\n")
                : "None"
            },
            {
              name: "Replacements",
              value: replacements.size
                ? [...replacements.entries()]
                  .map(([n, o]) => `- <@${o}> ➜ <@${n}>`)
                  .join("\n")
                : "None"
            },
            { name: "Finished By", value: `<@${message.author.id}>`, inline: true },
            { name: "Channel", value: `<#${message.channel.id}>`, inline: true }
          ],
          footer: { text: "Loot Council finalized" },
          timestamp: new Date()
        }]
      });
    }
  } catch (err) {
    console.error(err);
  }

  activePickraidSessions.delete(message.channel.id);
};

/* ---------------------------- CLEAN RAID ---------------------------- */

module.exports.cleanraid = async function cleanRaid(message) {
  if (!isOfficerOrModerator(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Officers and Moderators.");
  }

  try {
    const role = message.guild.roles.cache.get(LOOT_COUNCIL_ROLE_ID);
    if (!role) return sendTempReply(message, "Loot Council role not found.");

    if (!role.members.size) {
      return sendTempReply(message, "No members currently have the Loot Council role.");
    }

    for (const [, member] of role.members) {
      await member.roles.remove(role);
    }

    await message.channel.send("✅ Removed Loot Council role from all members.");
  } catch (err) {
    console.error(err);
    sendTempReply(message, `❌ Failed to clean Loot Council role: ${err.message}`);
  }
};
