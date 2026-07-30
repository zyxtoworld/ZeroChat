import type { ReactElement, ReactNode } from 'react'
import {
  supportedLanguageModes,
  type TranslationKey,
  type Translator,
} from '../i18n'
import type { LanguageMode, ThemeMode } from '../types'

interface AppearanceSettingsPanelProps {
  t: Translator
  theme: ThemeMode
  language: LanguageMode
  compactMode: boolean
  notice: ReactNode
  onThemeChange: (theme: ThemeMode) => void
  onLanguageChange: (language: LanguageMode) => void
  onCompactModeChange: (compactMode: boolean) => void
  onCommitEditsOnBlur: () => void
}

export function AppearanceSettingsPanel({
  t,
  theme,
  language,
  compactMode,
  notice,
  onThemeChange,
  onLanguageChange,
  onCompactModeChange,
  onCommitEditsOnBlur,
}: AppearanceSettingsPanelProps): ReactElement {
  const themeHintId = 'appearance-theme-hint'
  const languageHintId = 'appearance-language-hint'
  const compactDisplayHintId = 'appearance-compact-display-hint'

  return (
    <div
      id="settings-panel-appearance"
      className="form-stack"
      role="tabpanel"
      aria-labelledby="settings-tab-appearance"
    >
      <label>
        {t('field.theme')}
        <select
          aria-describedby={themeHintId}
          value={theme}
          onChange={(event) => onThemeChange(event.target.value as ThemeMode)}
          onBlur={onCommitEditsOnBlur}
        >
          <option value="system">{t('theme.system')}</option>
          <option value="light">{t('theme.light')}</option>
          <option value="dark">{t('theme.dark')}</option>
        </select>
      </label>
      <p id={themeHintId} className="settings-note">
        {t('settings.themeHint')}
      </p>
      <label>
        {t('field.language')}
        <select
          aria-describedby={languageHintId}
          value={language}
          onChange={(event) =>
            onLanguageChange(event.target.value as LanguageMode)
          }
          onBlur={onCommitEditsOnBlur}
        >
          {supportedLanguageModes().map((languageMode) => (
            <option key={languageMode} value={languageMode}>
              {t(`language.${languageMode}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <p id={languageHintId} className="settings-note">
        {t('settings.languageHint')}
      </p>
      <label className="switch-row">
        <input
          type="checkbox"
          checked={compactMode}
          aria-describedby={compactDisplayHintId}
          onChange={(event) => onCompactModeChange(event.target.checked)}
          onBlur={onCommitEditsOnBlur}
        />
        {t('field.compactDisplay')}
      </label>
      <p id={compactDisplayHintId} className="settings-note">
        {t('settings.compactDisplayHint')}
      </p>
      {notice}
    </div>
  )
}
