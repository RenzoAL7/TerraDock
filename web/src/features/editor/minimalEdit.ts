/** The smallest single replacement that turns `current` into `next`. */
export function minimalEdit(current: string, next: string) {
  let start = 0;
  const max = Math.min(current.length, next.length);
  while (start < max && current[start] === next[start]) start++;
  let tail = 0;
  while (
    tail < max - start &&
    current[current.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail++;
  return {
    start,
    end: current.length - tail,
    text: next.slice(start, next.length - tail),
  };
}
