/**
 * The little bit of shared client state: who is signed in, the collection
 * tree, and whether the last read came from the network or the offline
 * mirror.
 *
 * Views fetch their own data — there is no global cache of everything,
 * because a reference list that silently disagrees with the server is the
 * failure mode this app most needs to avoid. Collections are the exception:
 * every save sheet needs them, so they are held and refreshed on write.
 */

import { get } from "./api";
import type { Collection, User } from "./api";

type Store = {
  user: User | null;
  collections: Collection[];
  stale: boolean;
};

export const store: Store = { user: null, collections: [], stale: false };

export async function loadCollections(): Promise<Collection[]> {
  const { data, stale } = await get<{ collections: Collection[] }>("/api/collections");
  store.collections = data.collections;
  store.stale = stale;
  return store.collections;
}

/** Depth-first order with a depth number, which is how every list renders the tree. */
export function collectionTree(collections: Collection[] = store.collections): { collection: Collection; depth: number }[] {
  const byParent = new Map<string | null, Collection[]>();
  for (const collection of collections) {
    const bucket = byParent.get(collection.parentId) ?? [];
    bucket.push(collection);
    byParent.set(collection.parentId, bucket);
  }
  const out: { collection: Collection; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => {
      if (a.kind === "inbox" && b.kind !== "inbox") return -1;
      if (b.kind === "inbox" && a.kind !== "inbox") return 1;
      return a.position - b.position || a.createdAt.localeCompare(b.createdAt);
    });
    for (const child of children) {
      out.push({ collection: child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function inbox(): Collection | null {
  return store.collections.find((collection) => collection.kind === "inbox") ?? store.collections[0] ?? null;
}

export function collectionPath(id: string | null): string {
  if (!id) return "—";
  const names: string[] = [];
  let current = store.collections.find((collection) => collection.id === id) ?? null;
  let guard = 0;
  while (current && guard < 10) {
    names.unshift(current.name);
    current = store.collections.find((collection) => collection.id === current?.parentId) ?? null;
    guard += 1;
  }
  return names.join(" / ");
}
