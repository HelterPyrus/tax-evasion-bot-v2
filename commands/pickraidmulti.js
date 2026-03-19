const {
  LOOT_COUNCIL_ROLE_ID,
  AUDIT_CHANNEL_ID,
  PICKS,
  ROLES
} = require("../config/constants");

const { canManageCouncil } = require("../services/permissionService");
const { pick } = require("../services/pickerService");

// Active multi-raid sessions per channel
const activePickraidMultiSessions = new Map();

// Helper to send ephemeral-style temporary replies
const sendTempReply = (message, content, timeout = 20000) => {
  message.reply(content)
    .then(msg => setTimeout(() => msg.delete().catch(() => {}), timeout));
};

/* ---------------------------- MAIN COMMAND ---------------------------- */

module.exports = async function pickraidmulti(message, args, pickCount = PICKS) {

  if (!canManageCouncil(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Guild Masters and Officers.");
  }

  if (!args.length) {
    return sendTempReply(message, "You must provide mentions for at least one raid group.");
  }

  let raidName = null;
  let restArgs = args;

  // Optional quoted raid name
  if (args[0].startsWith('"')) {
    const match = args.join(" ").match(/^"([^"]+)"\s*(.*)$/);
    if (match) {
      raidName = match[1].trim();
      restArgs = match[2].split(/\s+/).filter(Boolean);
    }
  }

  const groups = restArgs
    .join(" ")
    .split("|")
    .map(g => g.trim())
    .filter(Boolean);

  if (!groups.length) {
    return sendTempReply(message, "No valid raid groups detected.");
  }

  const coreRole = message.guild.roles.cache.find(r => r.name === ROLES.CORE);
  const officerRole = message.guild.roles.cache.find(r => r.name === ROLES.OFFICER);
  const guildMasterRole = message.guild.roles.cache.find(r => r.name === ROLES.GUILD_MASTER);

  const raidSessions = [];

  for (let i = 0; i < groups.length; i++) {
    const mentions = groups[i].match(/<@!?(\d+)>/g) || [];
    const members = mentions
      .map(m => message.guild.members.cache.get(m.replace(/\D/g, "")))
      .filter(Boolean);

    // ---------------- Guild Master + Core detection ----------------
    let guildMasters = [];
    const eligibleCore = [];
    const ineligible = [];

    for (const m of members) {
      if (guildMasterRole && m.roles.cache.has(guildMasterRole.id)) {
        guildMasters.push(m);
        continue;
      }
      if ((coreRole && m.roles.cache.has(coreRole.id)) ||
          (officerRole && m.roles.cache.has(officerRole.id))) {
        eligibleCore.push(m);
        continue;
      }
      ineligible.push(`<@${m.id}> (not Core)`);
    }

    const name = raidName || `Raid #${i + 1}`;

    // Pick 1 provisional GM if available
    let guildMaster = null;
    if (guildMasters.length) {
      guildMaster = pick(guildMasters, 1)[0];
      guildMasters = guildMasters.filter(m => m.id !== guildMaster.id); // remaining GMs for fallback
    }

    if (!guildMaster) {
      await sendTempReply(message, `⚠️ ${name} has no Guild Master available.`);
      continue;
    }

    if (!eligibleCore.length) {
      await sendTempReply(message, `⚠️ ${name} has no eligible Core members.`);
      continue;
    }

    // ----------------------------- STATE ------------------------------
    const coreSlots = Math.min(pickCount - 1, eligibleCore.length);
    const corePicks = pick(eligibleCore, coreSlots);

    let provisional = [guildMaster, ...corePicks];
    let pool = eligibleCore.filter(m => !corePicks.includes(m));

    const maxCount = provisional.length;

    const confirmed = new Set();
    const declined = new Set();
    const replacements = new Map();
    const lastReaction = new Map();
    const replacementMessages = [];

    const slotType = new Map();
    slotType.set(guildMaster.id, "gm");
    corePicks.forEach(m => slotType.set(m.id, "core"));

    const renderEmbed = () => {
      const isReady = confirmed.size === maxCount;
      const provisionalList = provisional.filter(
        m => !confirmed.has(m.id) && !declined.has(m.id)
      );

      const description = [
        isReady
          ? "**STATUS:** 🟢 READY TO FINISH — Officer may use `!finishmulti`"
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
        title: `🎲 Loot Council (Guild Master + ${coreSlots} Core) – ${name}`,
        color: isReady ? 0x2ecc71 : 0xf1c40f,
        description: description.join("\n")
      };
    };

    // --------------------------- EMBED ---------------------------
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
      if (!["✅", "❌"].includes(reaction.emoji.name) || !allowedIds.includes(user.id)) {
        try { await reaction.users.remove(user.id); } catch {}
        return;
      }

      if (declined.has(member.id)) {
        try { await reaction.users.remove(user.id); } catch {}
        return;
      }

      const prev = lastReaction.get(user.id);
      if (prev && prev !== reaction.emoji.name) {
        try {
          await embedMessage.reactions.cache.get(prev)?.users.remove(user.id);
        } catch {}
      }

      lastReaction.set(user.id, reaction.emoji.name);

      if (reaction.emoji.name === "✅") {
        confirmed.add(member.id);
      }

      if (reaction.emoji.name === "❌") {
        confirmed.delete(member.id);
        declined.add(member.id);

        const type = slotType.get(member.id);
        let replacement = null;

        if (type === "gm") {
          // fallback to next GM in line
          replacement = guildMasters.shift();
          if (replacement) {
            replacements.set(replacement.id, member.id);
            provisional = provisional.map(m =>
              m.id === member.id ? replacement : m
            );
            slotType.set(replacement.id, "gm");
            guildMaster = replacement;

            try {
              const msg = await message.channel.send(
                `❌ <@${member.id}> declined — fallback Guild Master is <@${replacement.id}>.`
              );
              replacementMessages.push(msg);
            } catch {}
          }
        }

        if (!replacement && type === "core") {
          replacement = pool.shift();
          if (replacement) {
            replacements.set(replacement.id, member.id);
            provisional = provisional.map(m =>
              m.id === member.id ? replacement : m
            );
            slotType.set(replacement.id, "core");

            try {
              const msg = await message.channel.send(
                `❌ <@${member.id}> declined — summoning <@${replacement.id}> as **Provisional**.`
              );
              replacementMessages.push(msg);
            } catch {}
          }
        }
      }

      embedMessage.edit({ embeds: [renderEmbed()] });
    });

    raidSessions.push({
      collector,
      embedMessage,
      replacementMessages,
      name,
      state: {
        confirmed,
        declined,
        replacements,
        maxCount
      }
    });
  }

  if (raidSessions.length) {
    activePickraidMultiSessions.set(message.channel.id, raidSessions);
  }
};

/* ---------------------------- FINISH ---------------------------- */

module.exports.finish = async function finishPickraidMulti(message) {
  if (!canManageCouncil(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Guild Masters and Officers.");
  }

  const sessions = activePickraidMultiSessions.get(message.channel.id);
  if (!sessions?.length) {
    return sendTempReply(message, "No active multi-raid sessions in this channel.");
  }

  const role = message.guild.roles.cache.get(LOOT_COUNCIL_ROLE_ID);
  const auditChannel = message.guild.channels.cache.get(AUDIT_CHANNEL_ID);

  for (const session of sessions) {
    const { collector, embedMessage, replacementMessages, state, name } = session;
    const { confirmed, declined, replacements, maxCount } = state;

    if (confirmed.size !== maxCount) {
      return sendTempReply(
        message,
        `❌ Cannot finish yet for **${name}**.\nConfirmed: **${confirmed.size}/${maxCount}**`
      );
    }

    collector.stop();

    try { await embedMessage.delete(); } catch {}
    for (const msg of replacementMessages) {
      try { await msg.delete(); } catch {}
    }

    const finalRoster = [...confirmed].map(id => `- <@${id}>`).join("\n");

    await message.channel.send(
      `🎲 **Final Loot Council – ${name} (Confirmed):**\n${finalRoster}`
    );

    if (role) {
      for (const id of confirmed) {
        const member = message.guild.members.cache.get(id);
        if (member) await member.roles.add(role);
      }
    }

    if (auditChannel) {
      await auditChannel.send({
        embeds: [{
          title: `📋 Loot Council Audit Log — ${name}`,
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
                ? [...replacements.entries()].map(([n, o]) => `- <@${o}> ➜ <@${n}>`).join("\n")
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
  }

  activePickraidMultiSessions.delete(message.channel.id);
};

/* -------------------------- CLEAN RAID --------------------------- */

module.exports.cleanraid = async function cleanRaidMulti(message) {
  if (!canManageCouncil(message.member, message.guild)) {
    return sendTempReply(message, "This command is restricted to Guild Masters and Officers.");
  }

  const role = message.guild.roles.cache.get(LOOT_COUNCIL_ROLE_ID);

  if (!role) return sendTempReply(message, "Loot Council role not found.");

  if (!role.members.size) return sendTempReply(message, "No members currently have the Loot Council role.");

  for (const [, member] of role.members) {
    await member.roles.remove(role);
  }

  await message.channel.send("✅ Removed Loot Council role from all members.");
};