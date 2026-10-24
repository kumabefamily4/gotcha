// Runs the fair item placement off the main thread (it takes a few seconds on a phone).
import { generateCity } from './city.js';
import { assignItems } from './items.js';

self.onmessage = (e) => {
  const { seed, ids, count } = e.data;
  try {
    const city = generateCity(seed);
    const { items } = assignItems(city, ids, count, seed);
    self.postMessage({ items });
  } catch (err) {
    self.postMessage({ error: String(err && err.message ? err.message : err) });
  }
};
