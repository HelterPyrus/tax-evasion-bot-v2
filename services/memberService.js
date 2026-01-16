let membersFetched = false;

async function ensureMembersFetched(guild) {
  if (!membersFetched) {
    console.log("Fetching all guild members...");
    await guild.members.fetch({ withPresences: true });
    membersFetched = true;
    console.log("All members fetched.");
  }
}

module.exports = { ensureMembersFetched };
