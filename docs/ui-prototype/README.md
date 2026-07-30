# UI Prototype

This directory contains static HTML/CSS prototypes that define the target visual
design for ZeroChat. Open these files in a browser to see the exact look and feel
that the React implementation should match.

## Files

| File | Description |
|------|-------------|
| `index.html` | Main chat interface — sidebar, message list, composer |
| `settings.html` | Settings page — left tab nav, provider cards, form fields |
| `prototype.css` | Shared design tokens and chat page styles |
| `settings.css` | Settings page specific styles |

## How to Use

1. Open `index.html` in Chrome/Edge to see the chat interface
2. Open `settings.html` to see the settings page
3. Click the moon icon (bottom-right) to toggle dark mode
4. Resize the browser window to see responsive behavior

## Design Decisions Visible Here

- **Color**: Indigo brand color instead of the current green
- **Layout**: Clean sidebar with active indicator bar, centered message area
- **Messages**: User messages right-aligned with brand color, AI left-aligned with subtle border
- **Code blocks**: Separate header with copy button, monospace font
- **Typing indicator**: Three bouncing dots
- **Composer**: Rounded container with mode tabs, auto-grow textarea, circular send button
- **Settings**: Full-page layout with left tab navigation (not a modal)
- **Provider cards**: Status indicators, icon badges, click to expand
- **Forms**: Consistent input height (44px), focus glow, hint text below
- **Switch**: iOS-style toggle with spring animation
- **Spacing**: Generous whitespace, nothing feels cramped
- **Dark mode**: True dark (not just inverted), elevated surfaces slightly lighter

## For Codex

When implementing the React version:

1. Extract all CSS variables from `prototype.css :root` into `src/design-system/tokens.css`
2. Each visual section here becomes a React component
3. Match pixel-level spacing, colors, and border-radius
4. Add the animations described in `REQUIREMENTS.md` section 2.7
5. The prototype is static — add real interactivity (hover states work, but dropdowns/modals need JS)
6. Test both light and dark mode for every component
