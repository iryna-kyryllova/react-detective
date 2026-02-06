/**
 * graph-utils.ts
 *
 * Utility helpers used for:
 * - normalizing component ids
 * - grouping multiple component instances
 * - detecting structural changes in the React tree
 */

/**
 * Replaces instance indexes with a wildcard.
 *
 * Example:
 *   Navbar/NavLink[0]
 *   Navbar/NavLink[1]
 *
 * becomes:
 *   Navbar/NavLink[*]
 *
 * Used when comparing structure instead of concrete instances.
 *
 * @param id - full component id with instance index
 * @returns normalized id without specific instance number
 */
export function stripInstanceIndex(id: string) {
  return id.replace(/\[\d+]/g, '[*]')
}

/**
 * Builds a readable component signature used in analytics.
 *
 * Example:
 *   ROOT/App[0]/Navbar[0]/NavLink[2]
 *
 * becomes:
 *   Navbar > NavLink
 *
 * This allows grouping multiple instances of the same component
 * under one analytics entry.
 *
 * @param id - full hierarchical component id
 * @returns short parent > child signature
 */
export function getSignature(id: string) {
  // remove instance indexes completely
  const clean = id.replace(/\[\d+]/g, '')

  const parts = clean.split('/')

  // if structure is too shallow, return original
  if (parts.length < 2) return clean

  // return last two levels for readability
  return `${parts[parts.length - 2]} > ${parts[parts.length - 1]}`
}

/**
 * Builds a structure signature for the entire graph.
 *
 * Purpose:
 * Detect whether the component tree structure actually changed.
 *
 * Example use cases:
 * - navigating to another page
 * - conditional rendering adding/removing components
 *
 * If the signature is the same, we skip rebuilding layout
 * to avoid unnecessary UI recalculations.
 *
 * Steps:
 * 1. Normalize node ids (ignore instance indexes)
 * 2. Normalize edges
 * 3. Sort everything for stable comparison
 * 4. Combine into a single string
 *
 * @param graph - graph received from page-hook
 * @returns string representing tree structure
 */
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
