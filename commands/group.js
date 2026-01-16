const { EmbedBuilder } = require("discord.js");
const moment = require("moment-timezone");

const SERVER_TIMEZONE = "Europe/Berlin";

const ROLE_LIMITS = {
    tank: 1,
    healer: 1,
    dps: 3
};

const EMOJIS = {
    tank: { name: "tank", id: "1459635728488333486" },
    healer: { name: "healer", id: "1459635758833995950" },
    dps: { name: "dps", id: "1459635840182517904" }
};

// Helper to send ephemeral-style temporary replies
const sendTempReply = (message, content, timeout = 20000) => {
    message.reply(content)
        .then(msg => setTimeout(() => msg.delete().catch(() => {}), timeout));
};

module.exports = async function group(message, args) {
    if (!message.guild) return;

    /* -------------------- Parse dungeon + optional date -------------------- */

    let dungeonName;
    let datePart = null;
    let timePart = null;

    const dateRegex = /\b\d{2}\/\d{2}\/\d{4}\b/;
    const timeRegex = /\b\d{2}:\d{2}\b/;

    const dateIndex = args.findIndex(a => dateRegex.test(a));
    const timeIndex = args.findIndex(a => timeRegex.test(a));

    if (dateIndex !== -1 && timeIndex !== -1) {
        dungeonName = args.slice(0, dateIndex).join(" ");
        datePart = args[dateIndex];
        timePart = args[timeIndex];
    } else {
        dungeonName = args.join(" ");
    }

    dungeonName = dungeonName.trim();
    if (!dungeonName) return sendTempReply(message, "❌ Please specify a dungeon name.");

    let timestamp = null;
    if (datePart && timePart) {
        const parsed = moment.tz(
            `${datePart} ${timePart}`,
            "DD/MM/YYYY HH:mm",
            SERVER_TIMEZONE
        );

        if (!parsed.isValid()) return sendTempReply(message, "❌ Invalid date or time format.");

        timestamp = Math.floor(parsed.valueOf() / 1000);
    }

    /* -------------------- State -------------------- */
    const groups = { tank: new Set(), healer: new Set(), dps: new Set() };
    const signedOff = new Set();

    /* -------------------- Embed renderer -------------------- */
    const renderEmbed = () => {
        const total = groups.tank.size + groups.healer.size + groups.dps.size;
        const isFull = total === 5;

        const formatRole = (role, set, limit) =>
            [`<:${EMOJIS[role].name}:${EMOJIS[role].id}> **${role.charAt(0).toUpperCase() + role.slice(1)} (${set.size}/${limit})**`]
                .concat(set.size ? [...set].map(id => `- <@${id}>`) : ["- _Empty_"])
                .concat(["\u200B"]); // spacing

        const description = [
            `📍 **Dungeon:** ${dungeonName}`,
            timestamp ? `🕒 **Time:** <t:${timestamp}:F> (<t:${timestamp}:R>)` : null,
            `👤 **Created by:** <@${message.author.id}>`,
            "\u200B",
            ...formatRole("tank", groups.tank, ROLE_LIMITS.tank),
            ...formatRole("healer", groups.healer, ROLE_LIMITS.healer),
            ...formatRole("dps", groups.dps, ROLE_LIMITS.dps)
        ].filter(Boolean);

        if (signedOff.size > 0) {
            description.push(`📝 **Signed-Off (${signedOff.size})**`);
            description.push(...[...signedOff].map(id => `- <@${id}>`));
            description.push("\u200B");
        }

        description.push(isFull ? "🟢 **Group is full!**" : "🟡 **Open for signups**");

        // Instructional message at the bottom
        description.push("\u200B"); // extra spacing
        description.push("_Make sure you react with your desired role. If you change your mind, you can click the same emoji again to remove yourself or select another role if available._");

        return new EmbedBuilder()
            .setTitle("🧭 Dungeon Group")
            .setColor(isFull ? 0x2ecc71 : 0xf1c40f)
            .setDescription(description.join("\n"))
            .setTimestamp();
    };

    /* -------------------- Send embed -------------------- */
    const embedMessage = await message.channel.send({ embeds: [renderEmbed()] });

    try { await message.delete(); } catch (err) { console.error("Failed to delete command message:", err); }

    await embedMessage.react(EMOJIS.tank.id);
    await embedMessage.react(EMOJIS.healer.id);
    await embedMessage.react(EMOJIS.dps.id);

    /* -------------------- Reaction handling -------------------- */
    const filter = (reaction, user) =>
        !user.bot && Object.values(EMOJIS).some(e => e.id === reaction.emoji.id);

    const collector = embedMessage.createReactionCollector({ filter, dispose: true });

    collector.on("collect", async (reaction, user) => {
        const memberId = user.id;
        const emojiId = reaction.emoji.id;

        let roleKey = Object.keys(EMOJIS).find(k => EMOJIS[k].id === emojiId);
        if (!roleKey) return;

        if (groups[roleKey].has(memberId)) {
            // Clicking the same role again → move to Signed-Off
            groups[roleKey].delete(memberId);
            signedOff.add(memberId);

            try { await reaction.users.remove(memberId); } catch {}
        } else {
            // Switching roles or signing up
            if (groups[roleKey].size >= ROLE_LIMITS[roleKey]) return;

            const total = groups.tank.size + groups.healer.size + groups.dps.size;
            if (total >= 5) return;

            // Remove from other roles and Signed-Off
            for (const key of Object.keys(groups)) groups[key].delete(memberId);
            signedOff.delete(memberId);

            groups[roleKey].add(memberId);

            // Remove other reactions
            for (const e of Object.values(EMOJIS)) {
                if (e.id !== emojiId) {
                    try { await embedMessage.reactions.cache.get(e.id)?.users.remove(memberId); } catch {}
                }
            }
        }

        await embedMessage.edit({ embeds: [renderEmbed()] });
    });

    collector.on("remove", async (reaction, user) => {
        const memberId = user.id;
        if (!memberId) return;

        let roleKey = Object.keys(EMOJIS).find(k => EMOJIS[k].id === reaction.emoji.id);
        if (!roleKey) return;

        if (groups[roleKey].has(memberId)) {
            groups[roleKey].delete(memberId);
            signedOff.add(memberId);
            await embedMessage.edit({ embeds: [renderEmbed()] });
        }
    });
};
