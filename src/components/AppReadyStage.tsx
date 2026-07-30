import type { ReactElement } from 'react'

import {
  AppMainView,
  type AppMainViewProps,
} from './AppMainView'
import {
  AppOverlaysView,
  type AppOverlaysViewProps,
} from './AppOverlaysView'

export type AppReadyStageProps = AppMainViewProps & AppOverlaysViewProps

export function AppReadyStage(props: AppReadyStageProps): ReactElement {
  return (
    <div className="app-shell">
      <AppMainView {...props} />
      <AppOverlaysView {...props} />
    </div>
  )
}
