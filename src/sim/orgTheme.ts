/** Deterministic look for an org's factory: same name -> same colours and silhouette. Mantequilla-Soft keeps the classic Butter look. */
export type OrgTheme = {
  label: string; // painted on the tower (A-Z, 0-9, max 6)
  main: string; light: string; dark: string; sign: string;
  height: number; // tower height in world units
  roof: "flat" | "saw" | "dome" | "spire";
  chimneys: number; // 1-3
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function hsl(h: number, s: number, l: number) {
  s /= 100; l /= 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const BUTTER_THEME: OrgTheme = { label: "BUTTER", main: "#ef7d57", light: "#ffa27a", dark: "#b8603f", sign: "#ffcd75", height: 46, roof: "flat", chimneys: 1 };

const cache = new Map<string, OrgTheme>();
export function orgTheme(org: string): OrgTheme {
  if (org.toLowerCase() === "mantequilla-soft") return BUTTER_THEME;
  const hit = cache.get(org);
  if (hit) return hit;
  const h = hash(org.toLowerCase());
  const hue = h % 360, sat = 50 + ((h >>> 9) % 25);
  const t: OrgTheme = {
    label: org.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "FORGE",
    main: hsl(hue, sat, 56), light: hsl(hue, sat, 72), dark: hsl(hue, sat, 34), sign: hsl((hue + 180) % 360, 85, 82),
    height: 38 + ((h >>> 3) % 20),
    roof: (["flat", "saw", "dome", "spire"] as const)[(h >>> 13) % 4]!,
    chimneys: 1 + ((h >>> 17) % 3),
  };
  cache.set(org, t);
  return t;
}
