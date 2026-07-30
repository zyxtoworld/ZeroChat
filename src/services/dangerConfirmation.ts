import type { Translator } from '../i18n'
import type { DangerWarningId } from '../types'

export interface DangerPrompt {
  id: DangerWarningId
  title: string
  body: string
  details: string[]
  confirmLabel: string
  allowSkip?: boolean
  confirmIcon?: 'trash' | 'key'
}

export function shouldBypassDangerConfirmation(
  prompt: DangerPrompt,
  dismissed: boolean,
): boolean {
  return prompt.allowSkip !== false && dismissed
}

export function shouldRememberDangerConfirmationSkip(
  prompt: DangerPrompt,
  confirmed: boolean,
  skipChecked: boolean,
): boolean {
  return confirmed && skipChecked && prompt.allowSkip !== false
}

export function importBackupDangerPrompt(t: Translator): DangerPrompt {
  return {
    id: 'import-backup-overwrite',
    title: t('danger.import.title'),
    body: t('danger.import.body'),
    details: [
      t('danger.import.detail1'),
      t('danger.import.detail2'),
      t('danger.import.detail3'),
    ],
    confirmLabel: t('danger.confirmImport'),
  }
}

export function deleteConversationDangerPrompt(
  t: Translator,
  title: string,
): DangerPrompt {
  return {
    id: 'delete-conversation',
    title: t('danger.deleteConversation.title'),
    body: t('danger.deleteConversation.body', { title }),
    details: [
      t('danger.deleteConversation.detail1'),
      t('danger.deleteConversation.detail2'),
      t('danger.deleteConversation.detail3'),
    ],
    confirmLabel: t('danger.confirmDeleteConversation'),
  }
}

export function deleteProviderDangerPrompt(
  t: Translator,
  name: string,
  fallbackName: string,
): DangerPrompt {
  return {
    id: 'delete-provider',
    title: t('danger.deleteProvider.title'),
    body: t('danger.deleteProvider.body', { name }),
    details: [
      t('danger.deleteProvider.detail1'),
      t('danger.deleteProvider.detail2', { name: fallbackName }),
      t('danger.deleteProvider.detail3'),
    ],
    confirmLabel: t('danger.confirmDeleteProvider'),
  }
}

export function deleteModelDangerPrompt(
  t: Translator,
  model: string,
  providerName: string,
): DangerPrompt {
  return {
    id: 'delete-model',
    title: t('danger.deleteModel.title'),
    body: t('danger.deleteModel.body', { model, provider: providerName }),
    details: [
      t('danger.deleteModel.detail1'),
      t('danger.deleteModel.detail2'),
      t('danger.deleteModel.detail3'),
    ],
    confirmLabel: t('danger.confirmDeleteModel'),
  }
}

export function deleteSkillDangerPrompt(
  t: Translator,
  name: string,
): DangerPrompt {
  return {
    id: 'delete-skill',
    title: t('danger.deleteSkill.title'),
    body: t('danger.deleteSkill.body', { name }),
    details: [
      t('danger.deleteSkill.detail1'),
      t('danger.deleteSkill.detail2'),
      t('danger.deleteSkill.detail3'),
    ],
    confirmLabel: t('danger.confirmDeleteSkill'),
  }
}

export function clearCloudDataDangerPrompt(
  t: Translator,
  modeLabel: string,
): DangerPrompt {
  return {
    id: 'clear-cloud-data',
    title: t('danger.clearCloud.title'),
    body: t('danger.clearCloud.body', { mode: modeLabel }),
    details: [
      t('danger.clearCloud.detail1'),
      t('danger.clearCloud.detail2'),
      t('danger.clearCloud.detail3'),
    ],
    confirmLabel: t('danger.confirmClearCloud'),
  }
}

export function deleteMessageDangerPrompt(
  t: Translator,
  kind: string,
): DangerPrompt {
  return {
    id: 'delete-message',
    title: t('danger.deleteMessage.title'),
    body: t('danger.deleteMessage.body', { kind }),
    details: [
      t('danger.deleteMessage.detail1'),
      t('danger.deleteMessage.detail2'),
      t('danger.deleteMessage.detail3'),
    ],
    confirmLabel: t('danger.confirmDeleteMessage'),
  }
}

export function rotateSyncPassphraseDangerPrompt(t: Translator): DangerPrompt {
  return {
    id: 'rotate-sync-passphrase',
    title: t('danger.rotateSyncPassword.title'),
    body: t('danger.rotateSyncPassword.body'),
    details: [
      t('danger.rotateSyncPassword.detail1'),
      t('danger.rotateSyncPassword.detail2'),
      t('danger.rotateSyncPassword.detail3'),
    ],
    confirmLabel: t('danger.confirmRotateSyncPassword'),
    allowSkip: false,
    confirmIcon: 'key',
  }
}

export function resetSyncPassphraseDangerPrompt(t: Translator): DangerPrompt {
  return {
    id: 'reset-sync-passphrase',
    title: t('danger.resetSyncPassword.title'),
    body: t('danger.resetSyncPassword.body'),
    details: [
      t('danger.resetSyncPassword.detail1'),
      t('danger.resetSyncPassword.detail2'),
      t('danger.resetSyncPassword.detail3'),
    ],
    confirmLabel: t('danger.confirmResetSyncPassword'),
    allowSkip: false,
    confirmIcon: 'key',
  }
}

export function resetLocalDataDangerPrompt(t: Translator): DangerPrompt {
  return {
    id: 'reset-local-data',
    title: t('danger.reset.title'),
    body: t('danger.reset.body'),
    details: [
      t('danger.reset.detail1'),
      t('danger.reset.detail2'),
      t('danger.reset.detail3'),
    ],
    confirmLabel: t('danger.confirmReset'),
  }
}
