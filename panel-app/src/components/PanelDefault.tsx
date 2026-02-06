import type { StatusPayload } from '../shared/types'

type Props = {
  status: StatusPayload | 'INIT'
}

export function PanelDefault({ status }: Props) {
  const text =
    status === 'NO_HOOK'
      ? 'React DevTools hook was not found on this page.'
      : status === 'NO_REACT'
        ? 'No React application detected on this page.'
        : 'Waiting for data...'

  return (
    <div className='panel-default'>
      <h1>ReactDetective</h1>
      <p>{text}</p>
      <p>Open a React application and reload the page, or reopen DevTools.</p>
    </div>
  )
}
