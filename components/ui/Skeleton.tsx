// Loading placeholders shared by every Grow list/grid. Pure presentational.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-xl bg-white/[0.05] ${className}`}
    />
  );
}

/** A grid of 9:16 card skeletons (inspiration / collection grids). */
export function CardGridSkeleton({
  count = 10,
  className = "",
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="aspect-9/16 w-full rounded-2xl" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
