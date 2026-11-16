/** Shorten `text` to at most `max` characters by replacing the middle with an
 * ellipsis, keeping the start (drive) and the end (folder name) visible. */
export function middleTruncate(text: string, max: number): string {
  if (text.length <= max || max < 5) return text;
  const keep = max - 1;
  const tail = Math.ceil(keep * 0.6);
  const head = keep - tail;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}
