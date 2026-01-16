const pickraidmulti = require("./pickraidmulti");

module.exports = async function finishMulti(message) {
  try {
    await pickraidmulti.finish(message);
  } catch (err) {
    console.error(err);
    message.reply("❌ Failed to finish the multi-raid Loot Council session.");
  }
};
