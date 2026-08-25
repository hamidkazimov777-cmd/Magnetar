/** Shimmer placeholders for the gap between "opened" and "data arrived" — so a
 *  panel that is still loading never flashes its empty state as if truly empty.
 *  Widths are varied deterministically to read as list rows, not a solid block. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-2 py-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="skel h-4"
          style={{ width: `${45 + ((i * 23) % 50)}%` }}
        />
      ))}
    </div>
  );
}
