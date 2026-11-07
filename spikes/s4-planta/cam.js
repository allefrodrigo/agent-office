window.__s4cam = (floor, x, z, zoom) => {
  const g = window.__game
  g.goFloor(floor)
  g.follow = false
  g.engine.zoomStep(-10); g.engine.zoomStep(zoom)
  g.engine.jumpTo(x, z)
  document.querySelectorAll('.tour, [class*="tour"]').forEach((e) => e.remove())
  return 'floor ' + g.currentFloor
}
