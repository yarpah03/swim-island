const SwimChatExercises = (() => {
  const words = /https?:\/\/[^\s<>"«»]+|[\p{L}\p{M}\p{N}]+/giu;
  const separator = /[.!?;\r\n]/;
  const tokenKey = word => /^https?:\/\//i.test(word) ? '' : word.normalize('NFC').toLowerCase().replace(/ё/g, 'е');

  function index(entries, aliases) {
    const phrases = new Map();
    const byId = new Map();
    function add(label, entry) {
      const parts = Array.from(label.matchAll(words), ([word]) => tokenKey(word));
      if (!parts.length || parts.includes('')) return;
      const key = parts.join(' ');
      if (!phrases.has(key)) phrases.set(key, { parts, entries: [] });
      const cards = phrases.get(key).entries;
      const duplicate = cards.findIndex(card =>
        (entry.video && entry.video === card.video) ||
        (entry.technique && entry.technique === card.technique) ||
        (entry.title === card.title && entry.category === card.category));
      if (duplicate === -1) cards.push(entry);
      else if (entry.video && !cards[duplicate].video) cards[duplicate] = entry;
    }

    for (const entry of entries) {
      if (entry.key) byId.set(entry.key, entry);
      add(entry.title, entry);
    }
    for (const [label, id] of aliases) {
      const entry = byId.get(id);
      if (entry) add(label, entry);
    }

    const firstWord = new Map();
    for (const phrase of phrases.values()) {
      const first = phrase.parts[0];
      if (!firstWord.has(first)) firstWord.set(first, []);
      firstWord.get(first).push(phrase);
    }
    for (const list of firstWord.values()) list.sort((a, b) => b.parts.length - a.parts.length);

    return text => {
      const matches = [];
      const message = Array.from(text.matchAll(words), match => ({
        key: tokenKey(match[0]),
        start: match.index,
        end: match.index + match[0].length,
      }));
      for (let start = 0; start < message.length; start++) {
        const candidates = firstWord.get(message[start].key);
        const phrase = candidates?.find(({ parts }) =>
          parts.every((part, offset) => {
            const word = message[start + offset];
            return word?.key === part && (!offset || !separator.test(text.slice(message[start + offset - 1].end, word.start)));
          })
        );
        if (!phrase) continue;
        const end = start + phrase.parts.length - 1;
        matches.push({ start: message[start].start, end: message[end].end, entries: phrase.entries });
        start = end;
      }
      return matches;
    };
  }

  return { index };
})();
