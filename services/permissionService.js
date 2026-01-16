const { ROLES } = require("../config/constants");

function isOfficerOrModerator(member, guild) {
  const officerRole = guild.roles.cache.find(r => r.name === ROLES.OFFICER);
  const moderatorRole = guild.roles.cache.find(r => r.name === ROLES.MODERATOR);

  return (
    (officerRole && member.roles.cache.has(officerRole.id)) ||
    (moderatorRole && member.roles.cache.has(moderatorRole.id))
  );
}

module.exports = { isOfficerOrModerator };
