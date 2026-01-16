function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function pick(array, count) {
  shuffle(array);
  return array.slice(0, count);
}

module.exports = { pick };
