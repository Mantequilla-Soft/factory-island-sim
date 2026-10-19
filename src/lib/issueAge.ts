/** "Floating for 14 days" — how long the issue has been open at the replay's current moment */
export function floating(x: { openedAt: string; closedAt?: string }, nowMs: number) {
  const end = x.closedAt && Date.parse(x.closedAt) <= nowMs ? Date.parse(x.closedAt) : nowMs;
  const h = Math.max(0, (end - Date.parse(x.openedAt)) / 3_600_000);
  const v = h < 1 ? "under an hour" : h < 48 ? `${Math.floor(h)} hour${Math.floor(h) === 1 ? "" : "s"}` : `${Math.floor(h / 24)} days`;
  return x.closedAt && Date.parse(x.closedAt) <= nowMs ? `${v} (closed)` : `for ${v}`;
}
