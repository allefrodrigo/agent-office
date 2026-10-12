/** Local dates and streaks of active days. */

export function localDate(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Current streak (ending today or yesterday) and longest run of consecutive active days. */
export function streaks(dates: string[], today = localDate(Date.now())): { current: number; longest: number } {
  const set = new Set(dates)
  const sorted = [...set].sort()
  const next = (d: string) => {
    const t = new Date(`${d}T12:00:00`)
    t.setDate(t.getDate() + 1)
    return localDate(t.getTime())
  }
  const prev = (d: string) => {
    const t = new Date(`${d}T12:00:00`)
    t.setDate(t.getDate() - 1)
    return localDate(t.getTime())
  }
  let longest = 0
  let run = 0
  let last = ''
  for (const d of sorted) {
    run = last && next(last) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    last = d
  }
  let current = 0
  let d = set.has(today) ? today : prev(today)
  while (set.has(d)) {
    current++
    d = prev(d)
  }
  return { current, longest }
}
