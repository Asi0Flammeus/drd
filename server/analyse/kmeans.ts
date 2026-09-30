/**
 * Deterministic k-means in OKLab (§4.2): k-means++ seeding from a fixed-seed
 * generator, a fixed number of Lloyd iterations, then clusters closer than a
 * ΔE_OK threshold merged. Same pixels in, same palette out, every time: an
 * analysis that changes on re-run cannot be tested or trusted.
 */

import type { Lab } from "./color.ts";

export type Cluster = { lab: Lab; count: number; share: number };

/** mulberry32: small, fast, and good enough to spread k-means++ seeds. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `points` holds L, a, b triples. Returns clusters sorted by share, and for
 * each point the index of its cluster in that sorted list.
 */
export function kmeans(
  points: Float32Array,
  options: { k: number; seed?: number; iterations?: number; merge?: number },
): { clusters: Cluster[]; assignment: Int16Array } {
  const n = points.length / 3;
  const k = Math.min(options.k, n);
  const assignment = new Int16Array(n);
  if (n === 0) return { clusters: [], assignment };
  const rand = random(options.seed ?? 0x44524432);
  const centers = new Float64Array(k * 3);

  // k-means++: each next seed drawn with probability proportional to its
  // squared distance from the nearest seed so far.
  const nearest = new Float64Array(n).fill(Infinity);
  let pick = Math.floor(rand() * n);
  for (let c = 0; c < k; c += 1) {
    centers[c * 3] = points[pick * 3];
    centers[c * 3 + 1] = points[pick * 3 + 1];
    centers[c * 3 + 2] = points[pick * 3 + 2];
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      const dl = points[i * 3] - centers[c * 3];
      const da = points[i * 3 + 1] - centers[c * 3 + 1];
      const db = points[i * 3 + 2] - centers[c * 3 + 2];
      const d = dl * dl + da * da + db * db;
      if (d < nearest[i]) nearest[i] = d;
      total += nearest[i];
    }
    if (total === 0) break;
    let target = rand() * total;
    pick = n - 1;
    for (let i = 0; i < n; i += 1) {
      target -= nearest[i];
      if (target <= 0) {
        pick = i;
        break;
      }
    }
  }

  const sums = new Float64Array(k * 3);
  const counts = new Float64Array(k);
  for (let iteration = 0; iteration < (options.iterations ?? 25); iteration += 1) {
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c += 1) {
        const dl = points[i * 3] - centers[c * 3];
        const da = points[i * 3 + 1] - centers[c * 3 + 1];
        const db = points[i * 3 + 2] - centers[c * 3 + 2];
        const d = dl * dl + da * da + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      assignment[i] = best;
      counts[best] += 1;
      sums[best * 3] += points[i * 3];
      sums[best * 3 + 1] += points[i * 3 + 1];
      sums[best * 3 + 2] += points[i * 3 + 2];
    }
    for (let c = 0; c < k; c += 1) {
      if (counts[c] === 0) continue;
      centers[c * 3] = sums[c * 3] / counts[c];
      centers[c * 3 + 1] = sums[c * 3 + 1] / counts[c];
      centers[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
  }

  // Merge near-identical clusters, closest pair first, weighted by size.
  type Live = { lab: Lab; count: number; members: number[] };
  let live: Live[] = [];
  for (let c = 0; c < k; c += 1) {
    if (counts[c] > 0) live.push({ lab: { l: centers[c * 3], a: centers[c * 3 + 1], b: centers[c * 3 + 2] }, count: counts[c], members: [c] });
  }
  const threshold = options.merge ?? 0.02;
  for (;;) {
    let bestPair: [number, number] | null = null;
    let bestD = threshold;
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const d = Math.hypot(live[i].lab.l - live[j].lab.l, live[i].lab.a - live[j].lab.a, live[i].lab.b - live[j].lab.b);
        if (d < bestD) {
          bestD = d;
          bestPair = [i, j];
        }
      }
    }
    if (!bestPair) break;
    const [i, j] = bestPair;
    const a = live[i];
    const b = live[j];
    const count = a.count + b.count;
    live[i] = {
      lab: { l: (a.lab.l * a.count + b.lab.l * b.count) / count, a: (a.lab.a * a.count + b.lab.a * b.count) / count, b: (a.lab.b * a.count + b.lab.b * b.count) / count },
      count,
      members: [...a.members, ...b.members],
    };
    live = live.filter((_, index) => index !== j);
  }

  live.sort((x, y) => y.count - x.count);
  const remap = new Int16Array(k);
  live.forEach((cluster, index) => {
    for (const member of cluster.members) remap[member] = index;
  });
  for (let i = 0; i < n; i += 1) assignment[i] = remap[assignment[i]];
  return { clusters: live.map((cluster) => ({ lab: cluster.lab, count: cluster.count, share: cluster.count / n })), assignment };
}
