type Props = {
  counts: Record<string, number>
  reasons: Record<string, string>
}

export function Sidebar({ counts, reasons }: Props) {
  const reasonList = Object.values(reasons)

  const hasPropsChanged = reasonList.some((r) => r.startsWith('Props changed'))
  const hasStateChanged = reasonList.some((r) => r.startsWith('State changed'))
  const hasPotentialWasted = reasonList.some((r) => r.toLowerCase().includes('potential wasted'))

  const hasAnyData = Object.keys(counts).length > 0

  return (
    <>
      <div className='sidebar-block'>
        <h2>Page analytics</h2>

        {Object.entries(counts).map(([key, count]) => (
          <div key={key} className='component'>
            <strong className='component-title'>{key}</strong>
            {count > 1 && <div className='component-count'>Instances updated: {count}</div>}
            {reasons[key] && <div className='component-reason'>Reason: {reasons[key]}</div>}
          </div>
        ))}

        {!hasAnyData && <div className='text-muted'>No interactions on this page yet</div>}
      </div>

      <div className='sidebar-block'>
        <h2>Recommendations</h2>

        {!hasAnyData ? (
          <div className='text-muted'>
            No suggestions yet. Interact with the page to collect data.
          </div>
        ) : (
          <div>
            {hasPropsChanged && (
              <div className='sidebar__block'>
                <strong className='component-title'>Props changed:</strong>
                <ul className='component-list'>
                  <li>
                    Try <code>React.memo</code> for heavy child components.
                  </li>
                  <li>
                    Keep props stable: memoize handlers with <code>useCallback</code> and
                    objects/arrays with <code>useMemo</code>.
                  </li>
                </ul>
              </div>
            )}

            {hasStateChanged && (
              <div className='sidebar__block'>
                <strong className='component-title'>State changed:</strong>
                <ul className='component-list'>
                  <li>
                    Check if state can be more local (inside the component that really needs it).
                  </li>
                  <li>
                    If many children rerender because of one state, try splitting the component or
                    moving state lower/higher depending on who uses it.
                  </li>
                </ul>
              </div>
            )}

            {hasPotentialWasted && (
              <div className='sidebar__block'>
                <strong className='component-title'>Potential wasted render:</strong>
                <ul className='component-list'>
                  <li>Components updated without props/state changes.</li>
                  <li>
                    Consider memoizing children (<code>React.memo</code>), splitting large
                    components, and avoiding passing new references each render.
                  </li>
                </ul>
              </div>
            )}

            {!hasPropsChanged && !hasStateChanged && !hasPotentialWasted && (
              <p className='text-muted'>No clear patterns yet.</p>
            )}
          </div>
        )}
      </div>
    </>
  )
}
