"use client";

import { createContext, useCallback, useContext, useState } from "react";
import {
  MOCK_COLLECTIONS,
  createCollection as createCollectionStub,
  deleteCollectionImages as deleteImagesStub,
  type CollectionImage,
  type ImageCollection,
} from "@/lib/mock-data";

// Client-side session state for /collections — the grid and the [id] detail
// page mutate the same list. All writes go through the typed mock stubs so
// real persistence can slot in without touching the UI.

interface CollectionsApi {
  collections: ImageCollection[];
  addCollection: (name: string) => Promise<ImageCollection>;
  addImages: (collectionId: string, files: File[]) => void;
  deleteImages: (collectionId: string, imageIds: string[]) => Promise<void>;
  toggleProductImages: (collectionId: string) => void;
}

const Ctx = createContext<CollectionsApi | null>(null);

let localId = 0;

export function CollectionsProvider({ children }: { children: React.ReactNode }) {
  const [collections, setCollections] = useState<ImageCollection[]>(MOCK_COLLECTIONS);

  const addCollection = useCallback(async (name: string) => {
    const created = await createCollectionStub(name);
    setCollections((cur) => [created, ...cur]);
    return created;
  }, []);

  const addImages = useCallback((collectionId: string, files: File[]) => {
    // Local previews only — no upload. Object URLs are fine for a session.
    const images: CollectionImage[] = files
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({
        id: `local-${++localId}`,
        url: URL.createObjectURL(f),
        name: f.name,
      }));
    if (images.length === 0) return;
    setCollections((cur) =>
      cur.map((c) =>
        c.id === collectionId ? { ...c, images: [...images, ...c.images] } : c,
      ),
    );
  }, []);

  const deleteImages = useCallback(
    async (collectionId: string, imageIds: string[]) => {
      await deleteImagesStub(collectionId, imageIds);
      setCollections((cur) =>
        cur.map((c) =>
          c.id === collectionId
            ? { ...c, images: c.images.filter((img) => !imageIds.includes(img.id)) }
            : c,
        ),
      );
    },
    [],
  );

  const toggleProductImages = useCallback((collectionId: string) => {
    setCollections((cur) =>
      cur.map((c) =>
        c.id === collectionId ? { ...c, isProductImages: !c.isProductImages } : c,
      ),
    );
  }, []);

  return (
    <Ctx.Provider
      value={{ collections, addCollection, addImages, deleteImages, toggleProductImages }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCollections(): CollectionsApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("useCollections must be used inside <CollectionsProvider>");
  return api;
}
