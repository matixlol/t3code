import type { DiffGuide, DiffGuideSection } from "@t3tools/contracts";

/**
 * Orders a diff view's files the way its guide reads them. Files the guide does not name (a slice
 * that arrived after it was written) keep their place after the guided ones.
 */
export function orderByDiffGuide<T>(
  items: ReadonlyArray<T>,
  guide: DiffGuide | null,
  pathOf: (item: T) => string,
): ReadonlyArray<T> {
  if (guide === null) return items;
  const rank = diffGuideFileRanks(guide);
  return items
    .map((item, index) => ({
      item,
      index,
      rank: rank.get(pathOf(item)) ?? Number.MAX_SAFE_INTEGER,
    }))
    .toSorted((left, right) => left.rank - right.rank || left.index - right.index)
    .map(({ item }) => item);
}

/** Each guided file's position in reading order. */
export function diffGuideFileRanks(guide: DiffGuide): ReadonlyMap<string, number> {
  const rank = new Map<string, number>();
  for (const section of guide.sections) {
    for (const path of section.files) {
      if (!rank.has(path)) rank.set(path, rank.size);
    }
  }
  return rank;
}

/** One section of a guided diff with the files of it that have loaded, or the files it skips. */
export interface DiffGuideGroup<T> {
  readonly key: string;
  /** The section's number in the guide, or null for the files no section names. */
  readonly number: number | null;
  readonly section: DiffGuideSection | null;
  readonly items: ReadonlyArray<T>;
}

/**
 * A guided diff's files by section, in reading order. A section none of whose files has loaded
 * yet is left out until one does; files the guide does not name come last, in their own group.
 */
export function groupByDiffGuide<T>(
  items: ReadonlyArray<T>,
  guide: DiffGuide | null,
  pathOf: (item: T) => string,
): ReadonlyArray<DiffGuideGroup<T>> {
  const sectionOf = new Map<string, number>();
  guide?.sections.forEach((section, index) => {
    for (const path of section.files) if (!sectionOf.has(path)) sectionOf.set(path, index);
  });
  const buckets = (guide?.sections ?? []).map((): T[] => []);
  const others: T[] = [];
  for (const item of orderByDiffGuide(items, guide, pathOf)) {
    const index = sectionOf.get(pathOf(item));
    (index === undefined ? others : buckets[index]!).push(item);
  }
  const groups: DiffGuideGroup<T>[] = buckets.flatMap((bucket, index) =>
    bucket.length === 0
      ? []
      : [
          {
            key: `section:${index + 1}`,
            number: index + 1,
            section: guide!.sections[index]!,
            items: bucket,
          },
        ],
  );
  if (others.length > 0) groups.push({ key: "others", number: null, section: null, items: others });
  return groups;
}
