(() => {
  const g = window.__game, s = window.__state
  const m = (id, sector) => ({ id, name: id, icon: '🤖', title: id, execution: 'subagent', sector })
  const squad = (code, cwd, members) => ({ code, name: code, icon: '🧩', description: '', cwd, members, steps: [] })
  s.settings.projects = [
    { id: 'p3', name: 'Projeto 3 setores', cwd: '/tmp/s4/p3', brandColor: '#d97757' },
    { id: 'p4', name: 'Projeto 4 setores', cwd: '/tmp/s4/p4', brandColor: '#2f8f83' },
  ]
  s.squads = [
    squad('sq3', '/tmp/s4/p3', [m('a', 'Produto'), m('b', 'Produto'), m('c', 'Design'), m('d', 'Design'), m('e', 'Engenharia'), m('f', 'Engenharia'), m('g', 'Engenharia')]),
    squad('sq4', '/tmp/s4/p4', [m('a', 'Produto'), m('b', 'Design'), m('c', 'Engenharia'), m('d', 'Engenharia'), m('e', 'Dados')]),
  ]
  g.setStudios(true)
  g.setProjects(s.settings.projects, s.squads, false)
  document.querySelectorAll('.tour, [class*="tour"], .dialog-backdrop').forEach((e) => e.remove())
  return 'floors: ' + g.floors.join(', ')
})()
