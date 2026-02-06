export function stripInstanceIndex(id: string) {
  return id.replace(/\[\d+]/g, '[*]')
}

export function getSignature(id: string) {
  const clean = id.replace(/\[\d+]/g, '')
  const parts = clean.split('/')
  if (parts.length < 2) return clean
  return `${parts[parts.length - 2]} > ${parts[parts.length - 1]}`
}

export function buildStructureSignature(graph: any) {
  const nodeSig = (graph.nodes || [])
    .map((n: any) => stripInstanceIndex(String(n.id)))
    .sort()
    .join('|')

  const edgeSig = (graph.edges || [])
    .map((e: any) => `${stripInstanceIndex(String(e.from))}->${stripInstanceIndex(String(e.to))}`)
    .sort()
    .join('|')

  return `${nodeSig}::${edgeSig}`
}
