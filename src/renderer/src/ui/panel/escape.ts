/** What Esc does in the agent panel (AO-55). */
export type EscapeAction = 'ask-interrupt' | 'leave-input' | 'close-menu' | 'close-panel' | 'none'

export interface EscapeContext {
  /** An office agent with a turn in progress: it can be interrupted. */
  busy: boolean
  /** A window, the board or a focused card is over the panel: Esc belongs to it. */
  overlay: boolean
  /** Focus is in the message box. */
  inInput: boolean
  /** The compact/clear menu under the memory ring is open. */
  menuOpen: boolean
}

/** A busy agent asks to be interrupted; an idle one keeps the old Esc: leave the box, close the menu, then the panel. */
export function escapeAction(c: EscapeContext): EscapeAction {
  if (c.busy && !c.overlay) return 'ask-interrupt'
  if (c.inInput) return 'leave-input'
  if (c.overlay) return 'none'
  return c.menuOpen ? 'close-menu' : 'close-panel'
}
