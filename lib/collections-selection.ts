/** Hand-off slot: a collection picture selection travelling from
 *  /dashboard/collections/[id] to the composer on /dashboard.
 *
 *  sessionStorage, not a query string — a 30-image pick would blow past URL
 *  length limits, and this is a one-shot hand-off (the composer consumes and
 *  clears it), not state worth putting in the address bar. */
export const GENERATOR_PICK_KEY = "slidelabsai_collectionPick";

export interface CollectionPick {
  collectionId: string;
  collectionName: string;
  imageIds: string[];
  /** Signed thumbnails, so the composer can render the picks right away. */
  thumbs: string[];
}

/** Read and clear the hand-off. Returns null when there's nothing pending. */
export function takeCollectionPick(): CollectionPick | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(GENERATOR_PICK_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(GENERATOR_PICK_KEY);
    const parsed = JSON.parse(raw) as Partial<CollectionPick>;
    if (
      !parsed ||
      typeof parsed.collectionId !== "string" ||
      !Array.isArray(parsed.imageIds) ||
      parsed.imageIds.length === 0
    ) {
      return null;
    }
    return {
      collectionId: parsed.collectionId,
      collectionName: parsed.collectionName ?? "",
      imageIds: parsed.imageIds.filter((i): i is string => typeof i === "string"),
      thumbs: (parsed.thumbs ?? []).filter((t): t is string => typeof t === "string"),
    };
  } catch {
    return null;
  }
}
