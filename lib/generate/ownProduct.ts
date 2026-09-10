// Is the creator talking about THEIR OWN product, brand or drop? Shared by the
// lean copy path (server: refuse to fabricate product facts) and the composer
// (client: nudge to attach photos or a product link). Kept in its own tiny
// module because leanCopy.ts pulls the 470KB exemplar index, which must never
// reach the client bundle.
export function isOwnProductTopic(topic: string): boolean {
  const t = topic.toLowerCase();
  return (
    /\b(my|our)\b[^.]{0,40}\b(brand|drop|collection|product|products|line|store|shop|merch|launch|release|machine|menu|item|items|design|piece|album|app|game|course|book|flavou?r)\b/.test(
      t,
    ) || /\bjust dropped\b|\bnew drop\b|\brestock/.test(t)
  );
}
