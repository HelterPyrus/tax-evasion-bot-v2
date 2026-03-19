const { ROLES } = require("../config/constants");

/**
 * Checks if a member can manage loot council operations
 * Allowed:
 * - Guild Master
 * - Officer
 */
function canManageCouncil(member, guild) {

  const guildMasterRole = guild.roles.cache.find(
    r => r.name === ROLES.GUILD_MASTER
  );

  const officerRole = guild.roles.cache.find(
    r => r.name === ROLES.OFFICER
  );

  return (
    (guildMasterRole && member.roles.cache.has(guildMasterRole.id)) ||
    (officerRole && member.roles.cache.has(officerRole.id))
  );
}

module.exports = { canManageCouncil };