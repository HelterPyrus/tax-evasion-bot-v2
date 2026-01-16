const pickraid = require("./pickraid");

module.exports = async function finish(message) {
  try {
    await pickraid.finish(message);
  } catch (err) {
    console.error(err);
    message.reply("Failed to finish the Loot Council session.");
  }
};