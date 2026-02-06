import { stripInstanceIndex, getSignature, buildStructureSignature } from '../utils/graph-utils'

describe('graph utils', () => {
  test('stripInstanceIndex removes numeric indexes', () => {
    expect(stripInstanceIndex('Navbar/NavLink[2]')).toBe('Navbar/NavLink[*]')
  })

  test('getSignature groups instances correctly', () => {
    expect(getSignature('ROOT/Home[0]/Link[3]')).toBe('Home > Link')
  })

  test('buildStructureSignature ignores instance indexes', () => {
    const graphA = {
      nodes: [{ id: 'A[0]' }, { id: 'B[0]' }],
      edges: [{ from: 'A[0]', to: 'B[0]' }]
    }

    const graphB = {
      nodes: [{ id: 'A[3]' }, { id: 'B[7]' }],
      edges: [{ from: 'A[3]', to: 'B[7]' }]
    }

    expect(buildStructureSignature(graphA)).toBe(buildStructureSignature(graphB))
  })
})
