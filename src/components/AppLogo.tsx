import type { ReactElement } from 'react'

const APP_ICON_SRC = `${import.meta.env.BASE_URL}favicon.svg`

interface AppLogoProps {
  size: 'brand' | 'welcome' | 'empty'
}

export function AppLogo({ size }: AppLogoProps): ReactElement {
  return (
    <img
      className={`app-logo app-logo-${size}`}
      src={APP_ICON_SRC}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  )
}
