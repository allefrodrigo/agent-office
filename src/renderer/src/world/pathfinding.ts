/** Walkability grid with blocked tiles and blocked tile edges (thin walls). */
export class Grid {
  private blocked: Uint8Array
  private edges = new Set<string>()

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.blocked = new Uint8Array(w * h)
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.w && z < this.h
  }

  block(x: number, z: number): void {
    if (this.inside(x, z)) this.blocked[z * this.w + x] = 1
  }

  blockRect(x: number, z: number, w: number, d: number): void {
    for (let i = x; i < x + w; i++) for (let j = z; j < z + d; j++) this.block(i, j)
  }

  unblock(x: number, z: number): void {
    if (this.inside(x, z)) this.blocked[z * this.w + x] = 0
  }

  /** Wall on the line x = at between tiles (at-1, z) and (at, z). */
  blockEdgeX(at: number, z: number): void {
    this.edges.add(`x${at},${z}`)
  }

  /** Wall on the line z = at between tiles (x, at-1) and (x, at). */
  blockEdgeZ(at: number, x: number): void {
    this.edges.add(`z${at},${x}`)
  }

  walkable(x: number, z: number): boolean {
    return this.inside(x, z) && this.blocked[z * this.w + x] === 0
  }

  /** Can you step between two orthogonally adjacent tiles? */
  private stepOrtho(ax: number, az: number, bx: number, bz: number): boolean {
    if (!this.walkable(bx, bz)) return false
    if (ax !== bx) return !this.edges.has(`x${Math.max(ax, bx)},${az}`)
    return !this.edges.has(`z${Math.max(az, bz)},${ax}`)
  }

  canStep(ax: number, az: number, bx: number, bz: number): boolean {
    const dx = bx - ax
    const dz = bz - az
    if (dx === 0 || dz === 0) return this.stepOrtho(ax, az, bx, bz)
    // Diagonal: both L-shaped routes must be open, so nobody cuts corners through walls.
    return (
      this.walkable(bx, bz) &&
      this.stepOrtho(ax, az, ax + dx, az) &&
      this.stepOrtho(ax + dx, az, bx, bz) &&
      this.stepOrtho(ax, az, ax, az + dz) &&
      this.stepOrtho(ax, az + dz, bx, bz)
    )
  }

  /** A* over 8 directions. Returns tiles from start (exclusive) to goal (inclusive), or null. */
  findPath(sx: number, sz: number, gx: number, gz: number): [number, number][] | null {
    if (!this.inside(gx, gz)) return null
    if (sx === gx && sz === gz) return []
    const n = this.w * this.h
    const g = new Float32Array(n).fill(Infinity)
    const came = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const start = sz * this.w + sx
    const goal = gz * this.w + gx
    g[start] = 0
    const open: { i: number; f: number }[] = [{ i: start, f: 0 }]
    const h = (i: number) => {
      const dx = Math.abs((i % this.w) - gx)
      const dz = Math.abs(Math.floor(i / this.w) - gz)
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz)
    }
    while (open.length) {
      let best = 0
      for (let k = 1; k < open.length; k++) if (open[k].f < open[best].f) best = k
      const { i } = open.splice(best, 1)[0]
      if (i === goal) break
      if (closed[i]) continue
      closed[i] = 1
      const x = i % this.w
      const z = Math.floor(i / this.w)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue
          const nx = x + dx
          const nz = z + dz
          const ni = nz * this.w + nx
          // The start tile may be blocked (agent leaving a chair); the goal must be reachable.
          if (!this.inside(nx, nz) || closed[ni] || !this.canStep(x, z, nx, nz)) continue
          const cost = g[i] + (dx && dz ? 1.414 : 1)
          if (cost < g[ni]) {
            g[ni] = cost
            came[ni] = i
            open.push({ i: ni, f: cost + h(ni) })
          }
        }
      }
    }
    if (came[goal] === -1) return null
    const path: [number, number][] = []
    for (let i = goal; i !== start; i = came[i]) path.push([i % this.w, Math.floor(i / this.w)])
    return path.reverse()
  }

  /** Nearest walkable tile to (x, z), searching outward in rings. */
  nearestWalkable(x: number, z: number, avoid?: (x: number, z: number) => boolean): [number, number] | null {
    for (let r = 0; r < Math.max(this.w, this.h); r++) {
      let best: [number, number] | null = null
      let bestD = Infinity
      for (let i = x - r; i <= x + r; i++) {
        for (let j = z - r; j <= z + r; j++) {
          if (Math.max(Math.abs(i - x), Math.abs(j - z)) !== r) continue
          if (!this.walkable(i, j) || avoid?.(i, j)) continue
          const d = (i - x) ** 2 + (j - z) ** 2
          if (d < bestD) {
            bestD = d
            best = [i, j]
          }
        }
      }
      if (best) return best
    }
    return null
  }
}
