const pickraid = require("./pickraid");

module.exports = async function cleanraid(message) {
  try {
    await pickraid.cleanraid(message);
  } catch (err) {
    console.error(err);
    message.reply("❌ Failed to clean the Loot Council roles.");
  }
};