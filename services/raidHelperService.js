const fetch = require("node-fetch");

const RAID_HELPER_API_BASE = "https://raid-helper.dev/api/v2";
const RAID_HELPER_TOKEN = process.env.RAID_HELPER_TOKEN;

async function fetchRaidParticipants(raidId) {
  if (!RAID_HELPER_TOKEN) {
    throw new Error("RAID_HELPER_TOKEN not set");
  }

  const response = await fetch(`${RAID_HELPER_API_BASE}/events/${raidId}`, {
    headers: {
      Authorization: `Bearer ${RAID_HELPER_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Raid-Helper API error (${response.status})`);
  }

  const data = await response.json();

  // Collect Discord IDs (signed + bench, ignore absent)
  const users = [];

  data.signups?.forEach(s => {
    if (s.userId) users.push(s.userId);
  });

  data.bench?.forEach(b => {
    if (b.userId) users.push(b.userId);
  });

  return [...new Set(users)];
}

module.exports = { fetchRaidParticipants };
