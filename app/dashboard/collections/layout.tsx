import { CollectionsProvider } from "@/components/dashboard/grow/CollectionsProvider";

// Session-scoped mock state shared between the grid and detail pages.
export default function CollectionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CollectionsProvider>{children}</CollectionsProvider>;
}
