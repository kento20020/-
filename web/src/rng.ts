/**
 * CPython の `random.Random`（MT19937）完全互換の擬似乱数生成器。
 *
 * Python 版（roguelike/rng.py）と 1bit たがわず同じ系列を出すことが、
 * 等価性検証（設計仕様書_Web版 §24：ゴールデンテスト）の前提。
 * 実装は CPython `_randommodule.c` / `random.py` に準拠する：
 *   - init_genrand / init_by_array（整数シードのシード化）
 *   - genrand_uint32（テンパリング）
 *   - random()  … 53bit 浮動小数（a>>5, b>>6）
 *   - getrandbits(k<=32) = genrand_uint32() >> (32-k)
 *   - _randbelow / choice / choices(weights) / shuffle
 */

const N = 624;
const M = 397;
const MATRIX_A = 0x9908b0df;
const UPPER_MASK = 0x80000000;
const LOWER_MASK = 0x7fffffff;

export class PyRandom {
  private mt = new Uint32Array(N);
  private mti = N + 1;

  constructor(seed: number) {
    this.seedInt(seed);
  }

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = this.mt[i - 1];
      this.mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.mti = N;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k > 0; k--) {
      const prev = this.mt[i - 1];
      this.mt[i] =
        ((this.mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k > 0; k--) {
      const prev = this.mt[i - 1];
      this.mt[i] =
        ((this.mt[i] ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        this.mt[0] = this.mt[N - 1];
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }

  /** CPython の int シード（random.seed(int)）に相当。非負整数を 32bit ワード列へ。 */
  private seedInt(seed: number): void {
    let n = Math.abs(Math.trunc(seed));
    const key: number[] = [];
    if (n === 0) {
      key.push(0);
    } else {
      while (n > 0) {
        key.push(n >>> 0);
        n = Math.floor(n / 4294967296);
      }
    }
    this.initByArray(key);
  }

  private genrandUint32(): number {
    let y: number;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0;
        this.mt[kk] = (this.mt[kk + M] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        y = ((this.mt[kk] & UPPER_MASK) | (this.mt[kk + 1] & LOWER_MASK)) >>> 0;
        this.mt[kk] = (this.mt[kk + (M - N)] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      }
      y = ((this.mt[N - 1] & UPPER_MASK) | (this.mt[0] & LOWER_MASK)) >>> 0;
      this.mt[N - 1] = (this.mt[M - 1] ^ (y >>> 1) ^ (y & 1 ? MATRIX_A : 0)) >>> 0;
      this.mti = 0;
    }
    y = this.mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Python random.random() と同一の 53bit 浮動小数 [0,1)。 */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  /** getrandbits(k)（k<=32）。 */
  private getrandbits(k: number): number {
    return this.genrandUint32() >>> (32 - k);
  }

  private static bitLength(n: number): number {
    let k = 0;
    let t = n;
    while (t > 0) {
      t = Math.floor(t / 2);
      k++;
    }
    return k;
  }

  /** Python Random._randbelow（getrandbits 方式）。 */
  randbelow(n: number): number {
    if (n <= 0) return 0;
    const k = PyRandom.bitLength(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** Python random.randint(a, b)（両端含む）= a + _randbelow(b-a+1)。 */
  randint(a: number, b: number): number {
    return a + this.randbelow(b - a + 1);
  }

  /** Python random.choice(seq)。 */
  choice<T>(seq: readonly T[]): T {
    return seq[this.randbelow(seq.length)];
  }

  /** Python random.choices(population, weights=...)（k=1 既定）。 */
  choices<T>(population: readonly T[], weights: readonly number[], k = 1): T[] {
    const cum: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += w;
      cum.push(acc);
    }
    const total = cum[cum.length - 1];
    const hi = cum.length - 1;
    const out: T[] = [];
    for (let i = 0; i < k; i++) {
      out.push(population[bisectRight(cum, this.random() * total, 0, hi)]);
    }
    return out;
  }

  /** Python random.shuffle(x)（in-place, _randbelow 方式）。 */
  shuffle<T>(x: T[]): void {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const tmp = x[i];
      x[i] = x[j];
      x[j] = tmp;
    }
  }

  /** 内部状態を other からコピー（探索エージェントの分岐用・既存系列に無影響）。 */
  copyFrom(other: PyRandom): void {
    this.mt.set(other.mt);
    this.mti = other.mti;
  }
}

/** Python bisect.bisect_right(a, x, lo, hi)。 */
function bisectRight(a: readonly number[], x: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * 1ラン分の乱数源（roguelike/rng.py の GameRNG と同一の派生シード）。
 * 用途別ストリームに分離し、再現性・デバッグ性を担保する（§11）。
 */
export class GameRNG {
  readonly seed: number;
  readonly map: PyRandom;
  readonly spawn: PyRandom;
  readonly loot: PyRandom;
  readonly combat: PyRandom;
  readonly ai: PyRandom;

  constructor(seed: number) {
    this.seed = seed;
    this.map = new PyRandom(seed * 2 + 1);
    this.spawn = new PyRandom(seed * 3 + 7);
    this.loot = new PyRandom(seed * 5 + 13);
    this.combat = new PyRandom(seed * 7 + 17);
    this.ai = new PyRandom(seed * 11 + 23);
  }

  /** 現在状態の複製（探索エージェントのロールアウト分岐用。既存挙動に無影響）。 */
  clone(): GameRNG {
    const c = new GameRNG(this.seed);
    c.map.copyFrom(this.map);
    c.spawn.copyFrom(this.spawn);
    c.loot.copyFrom(this.loot);
    c.combat.copyFrom(this.combat);
    c.ai.copyFrom(this.ai);
    return c;
  }
}
