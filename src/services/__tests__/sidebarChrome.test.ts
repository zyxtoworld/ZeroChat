import { describe, expect, it } from 'vitest'

import { deriveSidebarChrome } from '../sidebarChrome'

describe('sidebar chrome rules', () => {
  it('removes a closed mobile sidebar from keyboard and assistive navigation', () => {
    expect(
      deriveSidebarChrome({
        modalOpen: false,
        sidebarDocked: false,
        sidebarOpen: false,
      }),
    ).toEqual({
      chatPaneHiddenFromAssistiveTech: false,
      mobileSidebarOpen: false,
      sidebarHiddenFromAssistiveTech: true,
      sidebarInteractive: false,
      sidebarTabIndex: -1,
    })
  })

  it('isolates the chat pane while the mobile sidebar overlay is open', () => {
    expect(
      deriveSidebarChrome({
        modalOpen: false,
        sidebarDocked: false,
        sidebarOpen: true,
      }),
    ).toMatchObject({
      chatPaneHiddenFromAssistiveTech: true,
      mobileSidebarOpen: true,
      sidebarHiddenFromAssistiveTech: false,
      sidebarInteractive: true,
      sidebarTabIndex: undefined,
    })
  })

  it('keeps the desktop sidebar interactive unless a modal is topmost', () => {
    expect(
      deriveSidebarChrome({
        modalOpen: false,
        sidebarDocked: true,
        sidebarOpen: false,
      }),
    ).toMatchObject({
      chatPaneHiddenFromAssistiveTech: false,
      mobileSidebarOpen: false,
      sidebarHiddenFromAssistiveTech: false,
      sidebarInteractive: true,
    })

    expect(
      deriveSidebarChrome({
        modalOpen: true,
        sidebarDocked: true,
        sidebarOpen: false,
      }),
    ).toMatchObject({
      chatPaneHiddenFromAssistiveTech: true,
      sidebarHiddenFromAssistiveTech: true,
      sidebarInteractive: true,
    })
  })
})
