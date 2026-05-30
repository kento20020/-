/**
 * 統計取得用ヒューリスティックAI（roguelike/bot.py の TS 版・忠実移植）。
 * BFS の探索順・タイブレーク、危険推定、報酬選択を Python と厳密一致させる。
 */
import { Game, type Enemy } from "./engine.ts";
import { RELICS } from "./data.ts";
import { sig } from "./trace.ts";

type Coord = [number, number];
type Action = ["move", number, number] | ["wait"];
const DIRS: ReadonlyArray<Coord> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const kc = (x: number, y: number) => `${x},${y}`;

export class Bot {
  private g: Game;
  private pref: string | null;
  private policy: string;
  private floor = 0;
  private floorSteps = 0;
  private rush = false;

  constructor(game: Game, preferredArchetype: string | null = null, policy: string = "balanced") {
    this.g = game;
    this.pref = preferredArchetype;
    this.policy = policy;
  }

  /** 方策別の rush 切替閾値（balanced=120 で既定挙動を1bitも変えない＝ゴールデン維持）。 */
  private get rushAt(): number {
    return this.policy === "cautious" ? 90 : this.policy === "aggressive" ? 160 : 120;
  }

  // --- 危険タイル（予兆）推定 ---
  private danger(): Set<string> {
    const g = this.g;
    const danger = new Set<string>();
    for (const e of g.enemies) {
      if (!e.alive) continue;
      if (e.behavior === "ranged" && e.telegraph) {
        for (const [dx, dy] of DIRS) {
          let x = e.x, y = e.y;
          for (let i = 0; i < e.etype.sight; i++) {
            x += dx;
            y += dy;
            if (!g.level.isFloor(x, y)) break;
            danger.add(kc(x, y));
          }
        }
      }
      if (e.behavior === "boss" && e.telegraph) {
        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) danger.add(kc(e.x + dx, e.y + dy));
        }
      }
    }
    return danger;
  }

  private bfsStep(start: Coord, goal: Coord, blocked: Set<string>): Coord | null {
    const g = this.g;
    const prev = new Map<string, Coord | null>();
    prev.set(kc(start[0], start[1]), null);
    const q: Coord[] = [[start[0], start[1]]];
    let head = 0;
    const startKey = kc(start[0], start[1]);
    const goalKey = kc(goal[0], goal[1]);
    while (head < q.length) {
      const cur = q[head++];
      if (cur[0] === goal[0] && cur[1] === goal[1]) {
        let node = cur;
        let pn = prev.get(kc(node[0], node[1]))!;
        while (pn !== null && kc(pn[0], pn[1]) !== startKey) {
          node = pn;
          pn = prev.get(kc(node[0], node[1]))!;
        }
        if (pn === null) return [0, 0];
        return [node[0] - start[0], node[1] - start[1]];
      }
      for (const [dx, dy] of DIRS) {
        const nx = cur[0] + dx, ny = cur[1] + dy;
        const nk = kc(nx, ny);
        if (prev.has(nk) || !g.level.isFloor(nx, ny)) continue;
        if (blocked.has(nk) && nk !== goalKey) continue;
        prev.set(nk, cur);
        q.push([nx, ny]);
      }
    }
    return null;
  }

  private chooseTarget(): Enemy | null {
    const g = this.g;
    const alive = g.enemies.filter((e) => e.alive);
    if (alive.length === 0) return null;
    const px = g.player.x, py = g.player.y;
    const prioOf = (b: string) => (b === "support" ? -6 : b === "ranged" ? -4 : 0);
    const score = (e: Enemy) => Math.abs(e.x - px) + Math.abs(e.y - py) + prioOf(e.behavior);
    let best = alive[0];
    let bestScore = score(best);
    for (const e of alive) {
      const s = score(e);
      if (s < bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  // --- 報酬選択 ---
  chooseReward(): number {
    const g = this.g;
    const offered = g.offered;
    if (offered.length === 0) return 0;
    const relics = offered.map((o) => RELICS.get(o)!);
    const ownedArch = g.player.relics.map((x) => x.archetype);
    const value = (r: { archetype: string }) => {
      let v = 1.0;
      if (this.pref && r.archetype === this.pref) v += 3.0;
      v += ownedArch.filter((a) => a === r.archetype).length * 0.8;
      if (g.player.hp < g.player.maxHp * 0.5 && (r.archetype === "sustain" || r.archetype === "thorns")) {
        v += 1.0;
      }
      // 方策別ドラフト傾向（balanced は加点なしで既定不変）。
      if (this.policy === "aggressive" && (r.archetype === "power" || r.archetype === "poison")) v += 1.0;
      if (this.policy === "cautious" && (r.archetype === "sustain" || r.archetype === "thorns")) v += 1.0;
      return v;
    };
    let best = 0;
    let bestVal = value(relics[0]);
    for (let i = 0; i < relics.length; i++) {
      const v = value(relics[i]);
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    return best;
  }

  private adjacentEnemies(): Enemy[] {
    const g = this.g;
    const px = g.player.x, py = g.player.y;
    return g.enemies.filter((e) => e.alive && Math.abs(e.x - px) + Math.abs(e.y - py) === 1);
  }

  // --- 1手を決める ---
  decide(): Action {
    const g = this.g;
    const p = g.player;
    // 方策で危険回避の積極性を変える（balanced=0.4 で既定不変）。
    const lowHp =
      p.hp < p.maxHp * (this.policy === "cautious" ? 0.7 : this.policy === "aggressive" ? 0.0 : 0.4);

    const adj = this.adjacentEnemies();
    if (adj.length > 0) {
      const rank = (b: string) => (b === "support" ? 0 : b === "ranged" ? 1 : 2);
      adj.sort((a, b) => rank(a.behavior) - rank(b.behavior)); // 安定ソート（Node V8）
      const t = adj[0];
      return ["move", t.x - p.x, t.y - p.y];
    }

    const alive = new Set<string>();
    for (const e of g.enemies) if (e.alive) alive.add(kc(e.x, e.y));
    const target = this.chooseTarget();
    const exit: Coord = [g.level.exit[0], g.level.exit[1]];

    if (this.rush) {
      const step = this.bfsStep([p.x, p.y], exit, new Set());
      if (step && !(step[0] === 0 && step[1] === 0)) return ["move", step[0], step[1]];
      return ["wait"];
    }

    // 方策で「敵を小目標にする射程」を変える（balanced=7 で既定不変）。
    const chaseRange = this.policy === "aggressive" ? 10 : this.policy === "cautious" ? 4 : 7;
    let subgoal: Coord = exit;
    if (!this.rush && target !== null && Math.abs(target.x - p.x) + Math.abs(target.y - p.y) <= chaseRange) {
      subgoal = [target.x, target.y];
    }

    const aliveMinusSubgoal = new Set(alive);
    aliveMinusSubgoal.delete(kc(subgoal[0], subgoal[1]));
    let step = this.bfsStep([p.x, p.y], subgoal, aliveMinusSubgoal);
    if (step === null && !(subgoal[0] === exit[0] && subgoal[1] === exit[1])) {
      step = this.bfsStep([p.x, p.y], exit, alive);
    }
    if (step === null && target !== null) {
      const am = new Set(alive);
      am.delete(kc(target.x, target.y));
      step = this.bfsStep([p.x, p.y], [target.x, target.y], am);
    }

    if (lowHp && !this.rush && step && !(step[0] === 0 && step[1] === 0)) {
      const danger = this.danger();
      const nx = p.x + step[0], ny = p.y + step[1];
      if (danger.has(kc(nx, ny))) {
        let best: Coord | null = null;
        let bestd = Math.abs(p.x - subgoal[0]) + Math.abs(p.y - subgoal[1]);
        for (const [dx, dy] of DIRS) {
          const tx = p.x + dx, ty = p.y + dy;
          if (g.level.isFloor(tx, ty) && !g.occupied(tx, ty) && !danger.has(kc(tx, ty))) {
            const d = Math.abs(tx - subgoal[0]) + Math.abs(ty - subgoal[1]);
            if (d <= bestd) {
              bestd = d;
              best = [dx, dy];
            }
          }
        }
        if (best) return ["move", best[0], best[1]];
      }
    }

    if (step && !(step[0] === 0 && step[1] === 0)) return ["move", step[0], step[1]];
    return ["wait"];
  }

  // --- 1ラン完走 ---
  run(maxTurns = 1500): Record<string, unknown> {
    const g = this.g;
    while ((g.state === "playing" || g.state === "reward") && g.turn < maxTurns) {
      if (g.state === "reward") {
        g.takeReward(this.chooseReward());
        this.floor = g.floorNum;
        this.floorSteps = 0;
        this.rush = false;
        continue;
      }
      if (g.floorNum !== this.floor) {
        this.floor = g.floorNum;
        this.floorSteps = 0;
        this.rush = false;
      }
      this.floorSteps += 1;
      if (this.floorSteps > this.rushAt && !g.isBossFloor()) this.rush = true;
      g.playerAct(this.decide());
    }
    return g.result();
  }

  /** equivalence.py の traced_run と同一制御フロー。各手番のシグネチャを記録。 */
  runTraced(maxTurns = 1500): { result: Record<string, unknown>; trace: string[] } {
    const g = this.g;
    const trace = [sig(g)];
    while ((g.state === "playing" || g.state === "reward") && g.turn < maxTurns) {
      if (g.state === "reward") {
        g.takeReward(this.chooseReward());
        this.floor = g.floorNum;
        this.floorSteps = 0;
        this.rush = false;
        trace.push(sig(g));
        continue;
      }
      if (g.floorNum !== this.floor) {
        this.floor = g.floorNum;
        this.floorSteps = 0;
        this.rush = false;
      }
      this.floorSteps += 1;
      if (this.floorSteps > this.rushAt && !g.isBossFloor()) this.rush = true;
      g.playerAct(this.decide());
      trace.push(sig(g));
    }
    return { result: g.result(), trace };
  }
}
