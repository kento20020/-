/**
 * 人間プレイのテレメトリ（localStorage）。サーバ無しの静的サイトで完結。
 * 各ラン終了時に result() を配列へ追記し、書き出し（ダウンロード/コピー）で共有する。
 * 壊れたデータは fail-closed（無視）。プライバシー：ローカルのみ・自動送信なし。
 */
const KEY = "roguelike_runs_v1";
const SCHEMA = 1;
const CAP = 1000;

export interface RunRecord {
  schema: number;
  ts: string;
  [k: string]: unknown;
}

export function recordRun(result: Record<string, unknown>): void {
  try {
    const runs = loadRuns();
    runs.push({ schema: SCHEMA, ts: new Date().toISOString(), ...result });
    while (runs.length > CAP) runs.shift();
    localStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    /* プライベートモード等は黙って無視 */
  }
}

export function loadRuns(): RunRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r === "object") : [];
  } catch {
    return [];
  }
}

export function summary(): {
  n: number;
  wins: number;
  clearRate: number;
  builds: Record<string, number>;
} {
  const runs = loadRuns();
  const n = runs.length;
  const wins = runs.filter((r) => r.result === "win").length;
  const builds: Record<string, number> = {};
  for (const r of runs) {
    const b = String(r.build ?? "none");
    builds[b] = (builds[b] ?? 0) + 1;
  }
  return { n, wins, clearRate: n ? wins / n : 0, builds };
}

export function exportDownload(): void {
  const blob = new Blob([JSON.stringify(loadRuns(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `roguelike-runs-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyClipboard(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(loadRuns()));
    return true;
  } catch {
    return false;
  }
}

export function clearRuns(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
