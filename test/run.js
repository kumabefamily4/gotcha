import { generateCity } from '../src/city.js';
import { assignItems } from '../src/items.js';
for (const seed of [1, 42, 12345]) {
  let t = Date.now();
  const c = generateCity(seed);
  const tc = Date.now() - t;
  t = Date.now();
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const { items, lengths } = assignItems(c, ids, 5, seed);
  const L = Object.values(lengths);
  const ratio = Math.max(...L) / Math.min(...L);
  console.log(`seed ${seed}: city ${tc}ms, buildings ${c.buildings.length}, trees ${c.trees.length}, items ${Date.now() - t}ms, lengths ${L.map(Math.round).join(',')} ratio ${ratio.toFixed(3)} start ${JSON.stringify(c.start)} goal ${JSON.stringify(c.goal)}`);
  if (ratio > 1.1 || !L.every(isFinite)) {
    console.error('FAIL fairness');
    process.exit(1);
  }
}
console.log('ok');
