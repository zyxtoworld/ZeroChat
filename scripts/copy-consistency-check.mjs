import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const checks = [
  {
    path: 'src/locales/zh-CN.ts',
    mustInclude: [
      '你的 Worker 地址，不是服务商 Base URL。',
      '开启后直连服务商，不走 Worker。',
      '标准候选模型',
    ],
  },
  {
    path: 'src/locales/en-US.ts',
    mustInclude: [
      'The protocol sets the request path:',
      'standard fallback model IDs',
      'Audio transcription is not available offline.',
      'Image requests need a connection.',
    ],
    mustNotInclude: [
      'Audio transcription needs a connection. You are offline right now.',
      'Image requests need a connection. You are offline right now.',
    ],
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    mustInclude: [
      'standard fallback model IDs',
      '标准候选模型',
    ],
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    mustInclude: [
      'standard fallback model IDs',
      '标准候选模型',
    ],
  },
  {
    path: 'apps/linux/src/i18n.rs',
    mustInclude: [
      'standard fallback model IDs',
      '标准候选模型',
    ],
  },
  {
    path: 'apps/windows provider capability note surfaces',
    paths: [
      'apps/windows/ZeroChat/MainWindow.xaml',
      'apps/windows/ZeroChat/MainWindow.xaml.cpp',
      'apps/windows/ZeroChat/MainWindowText.cpp',
      'apps/windows/ZeroChat/MainWindowFallback.cpp',
    ],
    mustInclude: [
      'standard fallback model IDs',
      '标准候选模型',
    ],
  },
  {
    path: 'apps/windows/ZeroChat/MainWindowText.cpp',
    mustInclude: [
      'L"Paste rules, prompts, or notes"',
      'L"粘贴规则、提示词或项目说明"',
      'L"Pega reglas, instrucciones o notas"',
    ],
    mustNotInclude: [
      'Paste a workflow, rules, prompts, or project notes',
      '粘贴工作流、规则、提示词或项目说明',
      'Pega flujos de trabajo, reglas, indicaciones o notas del proyecto',
    ],
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/settings',
    paths: [
      'apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderSettingsEditor.kt',
      'apps/android/app/src/main/java/app/zerochat/ui/settings/SyncSettings.kt',
      'apps/android/app/src/main/java/app/zerochat/ui/settings/SyncModeSection.kt',
    ],
    mustInclude: [
      'settings.directRequestNote',
      'settings.providerConnectivityPrivacy',
      'sync.compare.cloudflare.fit',
    ],
  },
  {
    path: 'apps/apple/App settings modules',
    paths: [
      'apps/apple/App/ProviderEditor.swift',
      'apps/apple/App/SyncSettingsView.swift',
    ],
    mustInclude: [
      'settings.interfaceTypeNoteCustom',
      'settings.directRequestNote',
      'settings.providerConnectivityPrivacy',
      'sync.compare.cloudflare.fit',
    ],
  },
  {
    path: 'apps/linux/src/main.rs',
    paths: [
      'apps/linux/src/main.rs',
      'apps/linux/src/app_state.rs',
      'apps/linux/src/app_state/conversation_state.rs',
      'apps/linux/src/app_state/preference_state.rs',
      'apps/linux/src/app_state/provider_state.rs',
      'apps/linux/src/app_state/reset_state.rs',
      'apps/linux/src/app_state/skill_state.rs',
      'apps/linux/src/app_state/sync_state.rs',
      'apps/linux/src/provider_settings.rs',
      'apps/linux/src/sync_settings.rs',
    ],
    mustInclude: [
      'settings.interfaceTypeNoteCustom',
      'settings.directRequestNote',
      'sync.compare.cloudflare.fit',
    ],
  },
  {
    path: 'apps/windows/ZeroChat/MainWindow.xaml',
    mustInclude: [
      'Protocol is fixed when added.',
      'Reads the model list only.',
      'Cloudflare Worker fits long history, images, and AI proxying.',
    ],
  },
]

const oldLongCopy = [
  'Direct mode asks the provider from this app and ignores the Worker proxy.',
  'Checks Base URL, API key, CORS/Worker proxy',
  'Local is fastest and has no CORS issues.',
  'Worker access key is derived from the data encryption password.',
  'Derived automatically from the data encryption password',
  '开启后，ZeroChat 会直接请求服务商，不走 Worker。',
  'API de bate-papo',
  'واجهة برمجة تطبيقات الدردشة',
  'image and audio use their own endpoints',
  'Image and audio use their own endpoints',
  'media use their own endpoints',
  'Media use their own endpoints',
  '图片和音频使用各自的接口',
  '图片、音频使用各自的接口',
]

const nativeOverclaimCopy = [
  'Cloud sync updates when enabled',
  '云同步后自动同步',
  'will be deleted in cloud sync',
  'Cloud sync will remove it too',
  'Skill data stays synced here',
  '技能数据会在这里同步',
  '已保存到本机，会按当前同步方式同步',
  'Saved locally. Sync will use the selected mode.',
  'Guardado localmente. La sincronización usará el modo elegido.',
  'स्थानीय रूप से सहेजा गया। सिंक चुने गए मोड से चलेगा।',
  'تم الحفظ محليا. ستستخدم المزامنة الوضع المحدد.',
  'Salvo localmente. A sincronização usará o modo escolhido.',
  'Сохранено локально. Синхронизация использует выбранный режим.',
  'ローカルに保存しました。同期は選択中のモードで実行されます。',
  '로컬에 저장되었습니다. 선택한 동기화 모드를 사용합니다.',
  'Enregistré localement. La synchronisation utilisera le mode choisi.',
  'Los datos de habilidades se sincronizan aquí',
  'Os dados de habilidades continuam sincronizados aqui',
  'Данные навыков здесь синхронизируются',
  'Les données de compétences restent synchronisées ici',
  'スキルデータはここでも同期されます',
  '스킬 데이터는 여기에서도 동기화됩니다',
  'Gist and Cloudflare then upload encrypted data to the cloud',
  'Gist 和 Cloudflare 只上传加密后的副本',
  'Local first. Encrypted sync when enabled.',
  'Local first. Cloud sync runs with the selected mode.',
  '本地优先。开启后使用加密同步。',
  '本地优先。云同步按所选模式执行。',
  'Primero local. Sincronización cifrada',
  'Primero local. La sincronización sigue el modo elegido.',
  'पहले स्थानीय। सक्षम होने पर एन्क्रिप्टेड सिंक।',
  'पहले स्थानीय। सिंक चुने गए मोड के अनुसार चलता है।',
  'محلي أولا. مزامنة مشفرة عند التفعيل.',
  'محلي أولا. تعمل المزامنة حسب الوضع المحدد.',
  'Local primeiro. Sincronização criptografada quando ativada.',
  'Local primeiro. A sincronização segue o modo escolhido.',
  'Сначала локально. Шифрованная синхронизация при включении.',
  'Сначала локально. Синхронизация следует выбранному режиму.',
  'ローカル優先。有効化すると暗号化同期します。',
  'ローカル優先。同期は選択したモードに従います。',
  '로컬 우선. 활성화하면 암호화 동기화.',
  '로컬 우선. 동기화는 선택한 모드를 따릅니다.',
  "Local d'abord. Synchronisation chiffrée si activée.",
  "Local d'abord. La synchronisation suit le mode choisi.",
  'Future cloud sync will be encrypted with the new password.',
  'Encrypted backup import/export is available in Web/PWA until native file pickers are ready.',
  'Encrypted backup import/export is available in the Web/PWA build until native file pickers are ready.',
  'Encrypted backup import/export is available in Web/PWA until native file pickers and restore confirmation are ready.',
  'Encrypted backup import/export is available in the Web/PWA build until native file pickers and restore confirmation are ready.',
  '这会把之后的云端同步改用新密码加密。',
  'Las próximas sincronizaciones en la nube se cifrarán con la nueva contraseña.',
  'आगे की क्लाउड सिंक नई पासवर्ड से एन्क्रिप्ट होगी।',
  'ستُشفّر مزامنة السحابة اللاحقة بكلمة المرور الجديدة.',
  'As próximas sincronizações na nuvem serão criptografadas com a nova senha.',
  'Следующие облачные синхронизации будут шифроваться новым паролем.',
  '今後のクラウド同期は新しいパスワードで暗号化されます。',
  '앞으로의 클라우드 동기화는 새 비밀번호로 암호화됩니다.',
  'Les prochaines synchronisations cloud seront chiffrées avec le nouveau mot de passe.',
  'Gist y Cloudflare suben los datos cifrados',
  'Gist e Cloudflare carregam dados criptografados',
  'Gist и Cloudflare загружают зашифрованные данные',
  'Gist et Cloudflare envoient les données chiffrées',
  'Gist と Cloudflare は暗号化されたデータをクラウドにアップロード',
  'Gist와 Cloudflare는 암호화된 데이터를 클라우드에 업로드',
  'Saved on this device. Sync keeps changes end-to-end encrypted.',
  '已保存到本机。同步会端到端加密你的更改。',
  'Guardado en este dispositivo. La sincronización mantiene los cambios cifrados de extremo a extremo.',
  'इस डिवाइस पर सहेजा गया। सिंक बदलावों को एंड-टू-एंड एन्क्रिप्ट रखता है।',
  'تم الحفظ على هذا الجهاز. تحافظ المزامنة على التغييرات مشفرة طرفيا.',
  'Salvo neste dispositivo. A sincronização mantém as alterações com criptografia de ponta a ponta.',
  'Сохранено на этом устройстве. Синхронизация хранит изменения со сквозным шифрованием.',
  'この端末に保存しました。同期では変更がエンドツーエンドで暗号化されます。',
  '이 기기에 저장되었습니다. 동기화는 변경 사항을 종단 간 암호화로 보호합니다.',
  'Enregistré sur cet appareil. La synchronisation garde les changements chiffrés de bout en bout.',
]

const nativeUiFiles = [
  'apps/android/app/src/main/java/app/zerochat/ui/ChatScreen.kt',
  'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
  'apps/apple/App/ChatView.swift',
  'apps/apple/App/SettingsView.swift',
  'apps/apple/App/NativeI18n.swift',
  'apps/linux/src/app_state.rs',
  'apps/linux/src/app_state/chat_state.rs',
  'apps/linux/src/app_state/conversation_state.rs',
  'apps/linux/src/app_state/preference_state.rs',
  'apps/linux/src/app_state/provider_state.rs',
  'apps/linux/src/app_state/reset_state.rs',
  'apps/linux/src/app_state/skill_state.rs',
  'apps/linux/src/app_state/sync_state.rs',
  'apps/linux/src/appearance_settings.rs',
  'apps/linux/src/chat_composer.rs',
  'apps/linux/src/chat_image_controls.rs',
  'apps/linux/src/chat_mode_controls.rs',
  'apps/linux/src/chat_send_actions.rs',
  'apps/linux/src/chat_view.rs',
  'apps/linux/src/data_settings.rs',
  'apps/linux/src/main.rs',
  'apps/linux/src/message_actions.rs',
  'apps/linux/src/message_attachments.rs',
  'apps/linux/src/messages.rs',
  'apps/linux/src/model_settings.rs',
  'apps/linux/src/provider_settings.rs',
  'apps/linux/src/settings_window.rs',
  'apps/linux/src/sidebar.rs',
  'apps/linux/src/skill_list.rs',
  'apps/linux/src/skill_settings.rs',
  'apps/linux/src/sync_settings.rs',
  'apps/linux/src/sync_settings/sync_actions.rs',
  'apps/windows/ZeroChat/MainWindow.xaml',
  'apps/windows/ZeroChat/MainWindow.xaml.cpp',
  'apps/windows/ZeroChat/MainWindowText.cpp',
]

const nonEnglishLocaleFiles = [
  'src/locales/ar-SA.ts',
  'src/locales/es-ES.ts',
  'src/locales/fr-FR.ts',
  'src/locales/hi-IN.ts',
  'src/locales/ja-JP.ts',
  'src/locales/ko-KR.ts',
  'src/locales/pt-BR.ts',
  'src/locales/ru-RU.ts',
]

const localizedUserDocs = [
  'docs/DEPLOY_WEB.ar-SA.md',
  'docs/DEPLOY_WEB.es-ES.md',
  'docs/DEPLOY_WEB.fr-FR.md',
  'docs/DEPLOY_WEB.hi-IN.md',
  'docs/DEPLOY_WEB.ja-JP.md',
  'docs/DEPLOY_WEB.ko-KR.md',
  'docs/DEPLOY_WEB.pt-BR.md',
  'docs/DEPLOY_WEB.ru-RU.md',
  'docs/SYNC_SETUP.ar-SA.md',
  'docs/SYNC_SETUP.es-ES.md',
  'docs/SYNC_SETUP.fr-FR.md',
  'docs/SYNC_SETUP.hi-IN.md',
  'docs/SYNC_SETUP.ja-JP.md',
  'docs/SYNC_SETUP.ko-KR.md',
  'docs/SYNC_SETUP.pt-BR.md',
  'docs/SYNC_SETUP.ru-RU.md',
]

const staleLocalizedAppPaths = [
  'ZeroChat Settings >',
  'Settings > Sync',
  'Settings > Data',
  'Settings > AI Providers',
]

const webSyncConfigErrorCopyChecks = [
  {
    path: 'src/locales/zh-CN.ts',
    mustInclude: ['同步配置错误，数据已保存到本机。请修正同步设置后再同步。{message}'],
  },
  {
    path: 'src/locales/en-US.ts',
    mustInclude: [
      'Sync configuration error. Data was saved on this device. Fix sync settings, then sync again. {message}',
    ],
  },
  {
    path: 'src/locales/es-ES.ts',
    mustInclude: [
      'Error de configuración de sincronización. Los datos se guardaron en este dispositivo. Corrige los ajustes de sincronización y sincroniza de nuevo. {message}',
    ],
  },
  {
    path: 'src/locales/hi-IN.ts',
    mustInclude: [
      'सिंक कॉन्फ़िगरेशन त्रुटि। डेटा इस डिवाइस पर सहेजा गया। सिंक सेटिंग ठीक करें, फिर दोबारा सिंक करें। {message}',
    ],
  },
  {
    path: 'src/locales/ar-SA.ts',
    mustInclude: [
      'خطأ في إعدادات المزامنة؛ تم حفظ البيانات على هذا الجهاز. أصلح إعدادات المزامنة ثم زامن مرة أخرى. {message}',
    ],
  },
  {
    path: 'src/locales/pt-BR.ts',
    mustInclude: [
      'Mudanças locais ocorreram durante a sincronização. Os dados locais foram mantidos. Sincronize novamente.',
      'Erro de configuração de sincronização: os dados foram salvos neste dispositivo. Corrija as configurações de sincronização e sincronize novamente. {message}',
    ],
  },
  {
    path: 'src/locales/ru-RU.ts',
    mustInclude: [
      'Ошибка конфигурации синхронизации. Данные сохранены на этом устройстве. Исправьте настройки синхронизации и запустите ее снова. {message}',
    ],
  },
  {
    path: 'src/locales/ja-JP.ts',
    mustInclude: [
      '同期設定エラー。データはこの端末に保存しました。同期設定を修正してから再度同期してください。{message}',
    ],
  },
  {
    path: 'src/locales/ko-KR.ts',
    mustInclude: [
      '동기화 설정 오류입니다. 데이터는 이 기기에 저장되었습니다. 동기화 설정을 고친 뒤 다시 동기화하세요. {message}',
    ],
  },
  {
    path: 'src/locales/fr-FR.ts',
    mustInclude: [
      'Erreur de configuration de synchronisation. Les données ont été enregistrées sur cet appareil. Corrigez les réglages de synchronisation, puis synchronisez à nouveau. {message}',
    ],
  },
]

const staleWebSyncConfigErrorFragments = [
  'Data was saved locally for now',
  'por ahora',
  'por enquanto',
  'डेटा अभी स्थानीय',
  'في الوقت الحالي',
  'Данные пока сохранены локально',
  'とりあえずデータ',
  '현재 데이터는 로컬에 저장',
  'pour le moment',
  'Sincronize novamente. Erro de configuração de sincronização',
]

const firstRunCloudflareCopyChecks = [
  {
    path: 'src/locales/zh-CN.ts',
    mustInclude: ['GitHub Gist 或 Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist 或 Worker'],
  },
  {
    path: 'src/locales/en-US.ts',
    mustInclude: ['GitHub Gist or Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist or Worker'],
  },
  {
    path: 'src/locales/es-ES.ts',
    mustInclude: ['GitHub Gist o Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist o Worker'],
  },
  {
    path: 'src/locales/hi-IN.ts',
    mustInclude: ['GitHub Gist या Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist या Worker'],
  },
  {
    path: 'src/locales/ar-SA.ts',
    mustInclude: ['GitHub Gist أو Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist أو Worker'],
  },
  {
    path: 'src/locales/pt-BR.ts',
    mustInclude: ['GitHub Gist ou Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist ou Worker'],
  },
  {
    path: 'src/locales/ru-RU.ts',
    mustInclude: ['GitHub Gist или Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist или Worker'],
  },
  {
    path: 'src/locales/ja-JP.ts',
    mustInclude: ['GitHub Gist または Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist または Worker'],
  },
  {
    path: 'src/locales/ko-KR.ts',
    mustInclude: ['GitHub Gist 또는 Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist 또는 Worker'],
  },
  {
    path: 'src/locales/fr-FR.ts',
    mustInclude: ['GitHub Gist ou Cloudflare'],
    localeValues: [{ key: 'mode.workerShort', value: 'Cloudflare' }],
    localeValueBlocklist: [{ key: 'mode.workerShort', value: 'Worker' }],
    mustNotInclude: ['Gist ou Worker'],
  },
]

const nativeBackupImplementationChecks = [
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/settings Data settings modules',
    paths: [
      'apps/android/app/src/main/java/app/zerochat/ui/settings/DataSettings.kt',
      'apps/android/app/src/main/java/app/zerochat/ui/settings/DataSettingsBackup.kt',
      'apps/android/app/src/main/java/app/zerochat/ui/settings/ProviderKeyImportTransaction.kt',
      'apps/android/app/src/main/java/app/zerochat/ui/ZeroChatApp.kt',
      'apps/android/app/src/main/java/app/zerochat/security/SecretStore.kt',
    ],
    mustInclude: [
      'ActivityResultContracts.CreateDocument("application/json")',
      'ActivityResultContracts.OpenDocument()',
      'backupCrypto.encryptVault',
      'backupCrypto.decryptVault',
      'onSnapshotImport(vault.data, vault.secrets.providerKeys).getOrThrow()',
      'SnapshotPersistence.launch {',
      'commitProviderKeyImportTransaction(',
      'PENDING_PROVIDER_KEY_IMPORT_KEY',
      'secretStore.stageProviderKeyImport(intent, replacements)',
      'secretStore.finishProviderKeyImport(intent)',
      'secretStore.restoreProviderKeyImport(intent)',
    ],
  },
  {
    path: 'apps/apple/App/DataSettingsView.swift',
    mustInclude: [
      '.fileExporter(',
      '.fileImporter(',
      'prepareEncryptedBackupExport()',
      'requestEncryptedBackupImport()',
    ],
  },
  {
    path: 'apps/linux/src/main.rs',
    paths: [
      'apps/linux/src/main.rs',
      'apps/linux/src/app_state.rs',
      'apps/linux/src/app_state/conversation_state.rs',
      'apps/linux/src/app_state/preference_state.rs',
      'apps/linux/src/app_state/provider_state.rs',
      'apps/linux/src/app_state/reset_state.rs',
      'apps/linux/src/app_state/skill_state.rs',
      'apps/linux/src/app_state/sync_state.rs',
      'apps/linux/src/backup.rs',
    ],
    mustInclude: [
      'gtk::FileChooserAction::Save',
      'export_encrypted_backup',
      'import_encrypted_backup',
      'SnapshotCrypto::new().encrypt_vault',
      'SnapshotCrypto::new().decrypt_vault',
    ],
  },
]

const windowsFallbackBackupSafetyChecks = [
  {
    path: 'apps/windows/ZeroChat/MainWindow.xaml',
    mustInclude: [
      'Encrypted backup import/export is available after the full Windows app loads. This read-only recovery screen keeps restore disabled so a partial UI cannot replace local data.',
      'Content="Export encrypted backup" HorizontalAlignment="Stretch" IsEnabled="False"',
      'Content="Import encrypted backup" HorizontalAlignment="Stretch" IsEnabled="False"',
    ],
    mustNotInclude: [
      'Encrypted backup import/export is in the normal Windows WebView app. This emergency fallback keeps restore disabled',
      'without the full UI',
    ],
  },
]

const nativeBackupCopyChecks = [
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    mustInclude: [
      'Encrypted backups use this data password. Import replaces local data after confirmation.',
    ],
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    mustInclude: [
      'Encrypted backups use this data password. Import replaces local data after confirmation.',
    ],
  },
  {
    path: 'apps/linux/src/i18n.rs',
    mustInclude: [
      'Encrypted backups use this data password. Import replaces local data after confirmation.',
    ],
  },
  {
    path: 'apps/windows backup fallback surfaces',
    paths: [
      'apps/windows/ZeroChat/MainWindow.xaml.cpp',
      'apps/windows/ZeroChat/MainWindowText.cpp',
      'apps/windows/ZeroChat/MainWindowFallback.cpp',
    ],
    mustInclude: [
      'Encrypted backup import/export is available after the full Windows app loads. This read-only recovery screen keeps restore disabled so a partial UI cannot replace local data.',
      'message.backupWebViewFallback',
    ],
    mustNotInclude: [
      'Encrypted backup import/export is in the normal Windows WebView app. This emergency fallback keeps restore disabled',
      'without the full UI',
    ],
  },
]

const nativeSyncProductCopyChecks = [
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    mustInclude: [
      'Local first. Turn on encrypted sync when you need more devices.',
      'Saved on this device. Cloud sync is end-to-end encrypted when enabled.',
      '已保存到本机。开启云同步后会端到端加密同步。',
      'Gist and Cloudflare data is encrypted before upload; sync settings stay on this device.',
      'Future cloud sync uses the new password.',
      'After clearing cloud data, this sync target starts fresh on the next sync.',
    ],
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    mustInclude: [
      'Local first. Turn on encrypted sync when you need more devices.',
      'Saved on this device. Cloud sync is end-to-end encrypted when enabled.',
      '已保存到本机。开启云同步后会端到端加密同步。',
      'Gist and Cloudflare data is encrypted before upload; sync settings stay on this device.',
      'Future cloud sync uses the new password.',
    ],
  },
  {
    path: 'apps/linux/src/i18n.rs',
    mustInclude: [
      'Local first. Turn on encrypted sync when you need more devices.',
      'Saved on this device. Cloud sync is end-to-end encrypted when enabled.',
      '已保存到本机。开启云同步后会端到端加密同步。',
      'Gist and Cloudflare data is encrypted before upload; sync settings stay on this device.',
      'Future cloud sync uses the new password.',
    ],
  },
  {
    path: 'apps/windows/ZeroChat/MainWindow.xaml',
    mustInclude: [
      'Local first. Turn on encrypted sync when you need more devices.',
      'ZeroChat opened a read-only recovery screen because the full Windows app did not load.',
    ],
    mustNotInclude: [
      'Windows WebView2 could not load the full app. This emergency fallback is read-only',
      'rebuild or repair the bundled Web/PWA',
    ],
  },
  {
    path: 'apps/windows sync product fallback surfaces',
    paths: [
      'apps/windows/ZeroChat/MainWindow.xaml.cpp',
      'apps/windows/ZeroChat/MainWindowText.cpp',
    ],
    mustInclude: [
      'Local first. Turn on encrypted sync when you need more devices.',
      'message.windowsFallbackReadOnly',
      'ZeroChat opened a read-only recovery screen because the full Windows app did not load.',
      'Saved on this device. Cloud sync is end-to-end encrypted when enabled.',
      '已保存到本机。开启云同步后会端到端加密同步。',
      'Gist and Cloudflare data is encrypted before upload; sync settings stay on this device.',
      'Future cloud sync uses the new password.',
    ],
    mustNotInclude: [
      'Windows WebView2 could not load the full app. This emergency fallback is read-only',
      'rebuild or repair the bundled Web/PWA',
    ],
  },
]

const nativeCloudSyncLabelChecks = [
  {
    path: 'apps/apple/App/NativeI18n.swift',
    mustInclude: [
      '"setting.sync": "Cloud sync"',
      '"setting.sync": "云同步"',
      '"setting.sync": "Sincronización en la nube"',
      '"setting.sync": "Synchronisation cloud"',
    ],
    mustNotInclude: ['"setting.sync": "Sync"', '"setting.sync": "同步"'],
  },
  {
    path: 'apps/linux/src/i18n.rs',
    mustInclude: [
      '"setting.sync" => "Cloud sync"',
      '"setting.sync" if zh => "云同步"',
      '"setting.sync" if es => "Sincronización en la nube"',
      '"setting.sync" if fr => "Synchronisation cloud"',
    ],
    mustNotInclude: ['"setting.sync" => "Sync"', '"setting.sync" if zh => "同步"'],
  },
  {
    path: 'apps/windows/ZeroChat/MainWindowText.cpp',
    mustInclude: [
      'L"Cloud sync"',
      'L"云同步"',
      'L"Sincronización en la nube"',
      'L"Synchronisation cloud"',
    ],
    mustNotInclude: ['L"Sync";', 'L"同步" :'],
  },
]

const highRiskSyncPasswordLocaleChecks = [
  {
    path: 'src/locales/en-US.ts',
    label: 'Web en-US sync-password rotation detail',
    localeValue: {
      key: 'danger.rotateSyncPassword.detail2',
      value:
        'Other devices must use the new password; Cloudflare also needs the Worker ZEROCHAT_ACCESS_KEY updated.',
    },
  },
  {
    path: 'src/locales/zh-CN.ts',
    label: 'Web zh-CN sync-password rotation detail',
    localeValue: {
      key: 'danger.rotateSyncPassword.detail2',
      value: '其他设备需要输入新密码；Cloudflare 还需要同步更新 Worker 的 ZEROCHAT_ACCESS_KEY。',
    },
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    label: 'Android en-US sync-password change detail',
    pattern:
      /private val translations = mapOf\([\s\S]*"en-US" to mapOf\([\s\S]*"danger\.changeSyncPassword\.detail2" to "Other devices must use the new password; Cloudflare also needs the Worker ZEROCHAT_ACCESS_KEY updated\."/,
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    label: 'Android zh-CN sync-password change detail',
    pattern:
      /private val translations = mapOf\([\s\S]*"zh-CN" to mapOf\([\s\S]*"danger\.changeSyncPassword\.detail2" to "其他设备需要输入新密码；Cloudflare 还需要同步更新 Worker 的 ZEROCHAT_ACCESS_KEY。"/,
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    label: 'Apple en-US sync-password change detail',
    pattern:
      /private static let translations: \[String: \[String: String\]\] = \[[\s\S]*"en-US": \[[\s\S]*"danger\.changeSyncPassword\.detail2": "Other devices must use the new password; Cloudflare also needs the Worker ZEROCHAT_ACCESS_KEY updated\."/,
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    label: 'Apple zh-CN sync-password change detail',
    pattern:
      /private static let translations: \[String: \[String: String\]\] = \[[\s\S]*"zh-CN": \[[\s\S]*"danger\.changeSyncPassword\.detail2": "其他设备需要输入新密码；Cloudflare 还需要同步更新 Worker 的 ZEROCHAT_ACCESS_KEY。"/,
  },
  {
    path: 'apps/linux/src/i18n.rs',
    label: 'Linux en-US sync-password change detail',
    pattern:
      /"danger\.changeSyncPassword\.detail2" => \{\s*"Other devices must use the new password; Cloudflare also needs the Worker ZEROCHAT_ACCESS_KEY updated\."/,
  },
  {
    path: 'apps/linux/src/i18n.rs',
    label: 'Linux zh-CN sync-password change detail',
    pattern:
      /"danger\.changeSyncPassword\.detail2" if zh => \{\s*"其他设备需要输入新密码；Cloudflare 还需要同步更新 Worker 的 ZEROCHAT_ACCESS_KEY。"/,
  },
]

const nativeCloudClearScopeChecks = [
  {
    path: 'apps/README.md',
    mustInclude: [
      'Cloudflare clear-remote-data support is a shared protocol/core requirement',
      'post-clear readback on the target OS',
    ],
  },
  {
    path: 'README.md',
    mustInclude: [
      'clear-cloud entry points that stay scoped by platform runtime QA',
      'Android, Apple, and Linux source now read and write encrypted GitHub Gist vaults',
      'source-level encrypted Gist parity pending their platform runtime sync passes',
      'Apple includes a checked-in Xcode app target and shared scheme',
    ],
    mustNotInclude: [
      'Cloudflare remote clear where the native sync client is wired',
      'Web remains the reference for Gist sync',
    ],
  },
  {
    path: 'apps/android/README.md',
    mustInclude: [
      'pull-to-refresh manual Gist/Cloudflare sync',
      'Gist/Cloudflare clear-remote-data source paths',
      'device-level release QA',
    ],
    mustNotInclude: ['and Cloudflare remote clear.', 'pull-to-refresh manual Cloudflare sync'],
  },
  {
    path: 'apps/apple/README.md',
    mustInclude: [
      'pull-to-refresh Gist/Cloudflare sync',
      'Gist/Cloudflare clear-remote-data source paths',
      'simulator/device release QA',
    ],
    mustNotInclude: [
      'and Cloudflare remote clear.',
      'pull-to-refresh Cloudflare sync',
      'a Cloudflare clear-remote-data source path',
    ],
  },
  {
    path: 'apps/linux/README.md',
    mustInclude: [
      'Gist/Cloudflare sync mode explanations and manual sync actions',
      'Gist and',
      'Cloudflare clear-cloud are source-wired',
      'Linux runtime release QA',
    ],
    mustNotInclude: [
      'and clear cloud data entry points.',
      'clear-cloud entry points that still need',
      'and a Cloudflare clear-cloud action',
      'Cloudflare clear-cloud is source-wired behind mode',
    ],
  },
  {
    path: 'docs/PLATFORMS.md',
    mustInclude: [
      'core `DELETE /sync/clear` support',
      'post-clear readback with disposable data',
    ],
  },
  {
    path: 'docs/RELEASE_CHECKLIST.md',
    mustInclude: [
      'Do not market native clear-cloud-data as complete',
      'post-clear readback on that OS',
    ],
  },
  {
    path: 'docs/QA_AUDIT.md',
    mustInclude: [
      'Native README and platform docs now scope clear-cloud-data',
      'copy guard rejects the old unqualified native',
      'Cloudflare remote-clear wording',
    ],
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
    mustInclude: [
      'After clearing cloud data, this sync target starts fresh on the next sync.',
    ],
  },
  {
    path: 'apps/android/app/src/main/java/app/zerochat/ui/settings/SettingsComponents.kt',
    mustInclude: ['listOf("body", "detail1", "detail2", "detail3", "detail4")'],
  },
  {
    path: 'apps/apple/App/NativeI18n.swift',
    mustInclude: [
      'After clearing cloud data, this sync target starts fresh on the next sync.',
    ],
  },
  {
    path: 'apps/apple/App/SettingsSupport.swift',
    mustInclude: ['["body", "detail1", "detail2", "detail3", "detail4"]'],
  },
  {
    path: 'docs/NATIVE_QA_CHECKLIST.md',
    mustInclude: [
      'confirmation body must name the remote ciphertext that is deleted',
      'Skill editing disabled in a read-only recovery screen',
      'verify the fallback',
      'read-only recovery screen, it must keep backup actions disabled and explain',
    ],
    mustNotInclude: [
      'Skill editing disabled in an emergency fallback',
      'intentionally exposes only an\n  emergency fallback',
    ],
  },
]

const nativeSkillScopeChecks = [
  {
    path: 'apps/README.md',
    mustInclude: [
      'Native clients now expose Skill management surfaces in source',
      'runtime QA',
    ],
  },
  {
    path: 'apps/android/README.md',
    mustInclude: [
      'Android now has a Compose Skill editor/import surface in source',
      'Physical-device runtime QA',
    ],
  },
  {
    path: 'apps/apple/README.md',
    mustInclude: [
      'Apple now has a SwiftUI Skill editor/import surface in source',
      'simulator/device runtime QA',
    ],
  },
  {
    path: 'apps/windows/README.md',
    mustInclude: [
      'shell uses the shared PWA UI',
      'Skill add/edit/delete, lazy chunk storage, automatic',
      'MSIX signing and install/update/uninstall QA',
    ],
  },
  {
    path: 'apps/linux/README.md',
    mustInclude: [
      'Linux now wires GTK Skill settings',
      'source-level evidence on this Windows machine',
      'target GTK runtime and visual QA',
    ],
  },
  {
    path: 'docs/QA_AUDIT.md',
    mustInclude: [
      'Windows now uses the shared PWA Skill UI through WebView2',
      'Linux now wires',
      'shared snapshot store in source',
    ],
  },
  {
    path: 'docs/PLATFORMS.md',
    mustInclude: [
      'Windows uses the shared PWA Skill UI through WebView2',
      'Linux now has source-wired GTK Skill settings',
      'Linux still needs target GTK runtime and visual QA',
    ],
  },
  {
    path: 'docs/RELEASE_CHECKLIST.md',
    mustInclude: [
      'Do not market a native build as full feature parity until native Skill',
      'runtime QA is still required per platform',
    ],
  },
  {
    path: 'README.md',
    mustInclude: [
      'six settings categories including Skills',
      'Native runtime builds and visual QA are still required',
    ],
  },
]

const nativeSkillDisabledChecks = [
  {
    path: 'apps/windows/ZeroChat/MainWindow.xaml',
    mustInclude: [
      'SkillWebViewFallbackText',
      'Full Skill editing is available after the full Windows app loads. This read-only recovery screen keeps Skill edits disabled until the bundled app files are repaired.',
      'ImportSkillButton" Content="Import skill" HorizontalAlignment="Stretch" IsEnabled="False"',
      'AddSkillButton" Content="Add skill" HorizontalAlignment="Stretch" IsEnabled="False"',
      'DeleteSkillButton" Content="Delete skill" HorizontalAlignment="Stretch" IsEnabled="False"',
    ],
    mustNotInclude: [
      'Skill data is preserved here. Edit Skills in Web/PWA until this native screen is verified.',
      'Full Skill editing is in the bundled Windows WebView app',
      'Windows cannot load the web bundle',
    ],
  },
  {
    path: 'apps/windows skill fallback surfaces',
    paths: [
      'apps/windows/ZeroChat/MainWindow.xaml.cpp',
      'apps/windows/ZeroChat/MainWindowText.cpp',
    ],
    mustInclude: [
      'message.skillsWebViewFallback',
      'SkillWebViewFallbackText().Text(Text(L"message.skillsWebViewFallback"))',
    ],
    mustNotInclude: [
      'message.skillsNativePending',
      'Edit Skills in Web/PWA until this native screen is verified',
    ],
  },
]

const linuxPreviewDisabledChecks = [
  {
    path: 'apps/linux/src/main.rs',
    paths: [
      'apps/linux/src/main.rs',
      'apps/linux/src/app_state.rs',
      'apps/linux/src/app_state/chat_state.rs',
      'apps/linux/src/app_state/conversation_state.rs',
      'apps/linux/src/app_state/preference_state.rs',
      'apps/linux/src/app_state/provider_state.rs',
      'apps/linux/src/app_state/reset_state.rs',
      'apps/linux/src/app_state/skill_state.rs',
      'apps/linux/src/app_state/sync_state.rs',
      'apps/linux/src/appearance_settings.rs',
      'apps/linux/src/background.rs',
      'apps/linux/src/chat_composer.rs',
      'apps/linux/src/chat_image_controls.rs',
      'apps/linux/src/chat_mode_controls.rs',
      'apps/linux/src/chat_send_actions.rs',
      'apps/linux/src/chat_view.rs',
      'apps/linux/src/data_settings.rs',
      'apps/linux/src/dialogs.rs',
      'apps/linux/src/media.rs',
      'apps/linux/src/message_actions.rs',
      'apps/linux/src/message_attachments.rs',
      'apps/linux/src/model_settings.rs',
      'apps/linux/src/provider_settings.rs',
      'apps/linux/src/settings_window.rs',
      'apps/linux/src/sidebar.rs',
      'apps/linux/src/skill_list.rs',
      'apps/linux/src/sync_settings.rs',
      'apps/linux/src/sync_settings/sync_actions.rs',
    ],
    mustInclude: [
      'provider_menu.connect_selected_notify',
      'update_active_conversation_provider',
      '.add_custom_provider(tr(&locale_for_add, "provider.preset.custom-openai-relay"))',
      'button.deleteProvider',
      'state_for_delete.delete_provider',
      'notice.providerDeleted',
      'notice.providerMinimum',
      'state.update_provider_config',
      'provider.base_url = value',
      'provider.proxy_url = optional_text(value)',
      'set_provider_enabled(&provider_id_for_enabled, button.is_active())',
      'state_for_key.save_provider_key(&provider_id_for_key, &value)',
      'state_for_clear_key.save_provider_key(&provider_id_for_clear_key, "")',
      'settings.linuxProviderKeySessionNote',
      'let models = parse_model_list(&value)',
      'apply_configured_provider_models(provider, models);',
      'provider.model = value.trim().to_owned()',
      'provider.image_model = optional_text(value)',
      'run_model_fetch',
      'spawn_model_list_request',
      'notice.modelsFetched',
      'append_pending_image_turn',
      'choose_image_file',
      'spawn_ai_image_request',
      'generated_image_attachment',
      'complete_assistant_image_message',
      'state_for_gist_id.update_sync_config',
      'state_for_gist_file.update_sync_config',
      'state_for_token.save_github_token(&value)',
      'state_for_clear_token.save_github_token("")',
      'settings.linuxGithubTokenSessionNote',
      'state_for_worker.update_sync_config',
      'state_for_save.save_sync_passphrase(&value)',
      'confirm_reset_sync_passphrase',
      'confirm_clear_cloud_data',
      'spawn_cloudflare_clear_request',
      'message.cloudSyncCleared',
    ],
  },
]

const webI18nBindingChecks = [
  {
    paths: [
      'src/components/FirstRunGuide.tsx',
      'src/components/FirstRunGuideProviderPicker.tsx',
      'src/components/FirstRunGuideProviderFields.tsx',
      'src/components/FirstRunGuideSyncPanel.tsx',
    ],
    mustInclude: [
      "t('field.provider')",
      "t('field.baseUrl')",
      "t('field.providerKey')",
      "t('placeholder.providerKey')",
      "t('placeholder.manualOrFetchModel')",
      "t('guide.providerKeyHelpLink')",
      "t('guide.providerKeyLocalOnly')",
      "t('settings.providerGroupOfficial')",
      "t('settings.providerGroupCustom')",
      "t('settings.providerNameHint')",
      "t('settings.interfaceTypeNoteCustom')",
      "t('settings.providerBaseUrlHint')",
      "'field.proxyUrl'",
      "'placeholder.optionalProxy'",
      "t('settings.proxyUrlNote')",
      "t('label.clientRequestMode')",
      "t('settings.clientRequestModeNote')",
      "t('label.workerHostsProviderKey')",
      "t('settings.workerHostedKeyNote')",
      "t('setting.sync')",
      "t('mode.local')",
      "t('mode.gistShort')",
      "t('mode.workerShort')",
      "t('placeholder.baseUrl')",
    ],
    mustNotInclude: [
      'Gist ID',
      'GitHub Token',
      'Fine-grained token',
      'placeholder="https://api.example.com/v1"',
    ],
  },
  {
    path: 'src/components/ProviderSettingsPanel.tsx + src/components/ProviderSettingsEditor.tsx',
    paths: [
      'src/components/ProviderSettingsPanel.tsx',
      'src/components/ProviderSettingsEditor.tsx',
    ],
    mustInclude: [
      "t('field.baseUrl')",
      "t('placeholder.baseUrl')",
      "t('settings.providerNameHint')",
      "t('settings.providerKeyHint')",
      "t('settings.providerBaseUrlHint')",
      "t('settings.proxyUrlNote')",
    ],
    mustNotInclude: [
      'Gist ID',
      'GitHub Token',
      'Fine-grained token',
      'placeholder="https://api.example.com/v1"',
    ],
  },
  {
    path: 'src/components/ModelDefaultsPanel.tsx',
    mustInclude: [
      "fieldKey: 'field.defaultModel'",
      "fieldKey: 'field.imageModel'",
      "fieldKey: 'field.audioSpeechModel'",
      "fieldKey: 'field.audioTranscriptionModel'",
      "fieldKey: 'field.embeddingModel'",
      "fieldKey: 'field.moderationModel'",
      "fieldKey: 'field.realtimeModel'",
      "hintKey: 'settings.defaultModelHint'",
      "hintKey: 'settings.imageModelHint'",
      "hintKey: 'settings.audioSpeechModelHint'",
      "hintKey: 'settings.audioTranscriptionModelHint'",
      "hintKey: 'settings.embeddingModelHint'",
      "hintKey: 'settings.moderationModelHint'",
      "hintKey: 'settings.realtimeModelHint'",
      "t('settings.chatContextWindowNote'",
    ],
    mustNotInclude: [
      'Default model',
      'Image model',
      'Chat context messages',
      'placeholder="gpt-4"',
    ],
  },
  {
    path: 'src/components/ModelCatalogEditor.tsx',
    mustInclude: [
      "t('field.models')",
      "t('field.modelName')",
      "t('placeholder.modelList')",
      "t('settings.modelListNote')",
    ],
    mustNotInclude: [
      'Model list',
      'Model name',
      'Type a model name',
      'Fetch models from the provider first',
    ],
  },
  {
    path: 'src/components/DataSettingsPanel.tsx',
    mustInclude: [
      "t('field.syncPassphrase')",
      "t('placeholder.syncPassphrase')",
      "t('settings.syncEncryptedNote')",
    ],
    mustNotInclude: [
      'Data encryption password',
      'Sync password',
      'placeholder="sync password"',
    ],
  },
  {
    path: 'src/components/SkillComposerPanel.tsx',
    mustInclude: [
      "t('label.skillGlobalAutoMatch')",
      "t('field.skillContextBudget')",
      "t('field.skillAutoCount')",
      "t('settings.skillBudgetNote')",
      "t('settings.skillsHelp')",
      "t('notice.skillContentRequired')",
      "t('field.skillName')",
      "t('field.skillContent')",
    ],
    mustNotInclude: [
      'Context budget',
      'Auto-match count',
      'Skill name',
      'Skill content',
    ],
  },
  {
    path: 'src/components/SkillRow.tsx',
    mustInclude: [
      "t('field.skillName')",
      "t('field.skillContent')",
      "t('settings.skillsHelp')",
      "t('notice.skillContentRequired')",
      "t('button.save')",
      "t('button.cancel')",
    ],
    mustNotInclude: ['Skill name', 'Skill content'],
  },
  {
    path: 'src/components/SyncSettingsPanel.tsx',
    mustInclude: [
      "t('field.gistId')",
      "t('field.githubToken')",
      "t('placeholder.githubToken')",
      "t('settings.gistIdHint')",
      "t('settings.gistFileHint')",
      "t('settings.githubTokenHint')",
      "t('settings.cloudflareWorkerUrlHint')",
      "t('settings.cloudflareAccessKeyFieldHint')",
    ],
    mustNotInclude: [
      'Gist ID',
      'GitHub Token',
      'Fine-grained token',
      'placeholder="https://api.example.com/v1"',
    ],
  },
  {
    path: 'src/services/provider config/custom name services',
    paths: [
      'src/services/providerConfig.ts',
      'src/services/providerCustomNames.ts',
    ],
    mustInclude: [
      'export function displayProviderName(',
      'defaultCustomProviderNameIndex',
    ],
    mustNotInclude: [
      'Gist ID',
      'GitHub Token',
      'Fine-grained token',
      'placeholder="https://api.example.com/v1"',
    ],
  },
  {
    path: 'src/services/skills.ts',
    mustInclude: ["rt('notice.skillContentRequired')"],
    mustNotInclude: ['Skill content is empty.', "|| 'Skill'"],
  },
]

const unresolvedUiCopy = [
  'right now',
  'not wired',
  'not implemented',
  'coming soon',
  'Use Web until',
  'Use Web/PWA for verified cloud sync',
  'Use Web/PWA for the fully verified',
  'show a Web/PWA handoff',
  'final sync checks',
  'native sync passes final checks',
  'intentionally blocked',
  'while native file pickers are finished',
  'native file picker पूरे',
  'пока завершаются native file pickers',
]

const dirtyCopyFragments = [
  {
    label: 'Arabic fit copy contains the Pros heading',
    pattern: /sync\.compare\.(?:local|gist|cloudflare)\.fit['":\s\w().]*[^\n]*?\. إيجابيات/,
  },
  {
    label: 'Portuguese fit copy contains the Pros heading',
    pattern: /sync\.compare\.(?:local|gist|cloudflare)\.fit['":\s\w().]*[^\n]*?\. Prós/,
  },
  {
    label: 'Russian fit copy contains the Pros heading',
    pattern: /sync\.compare\.(?:local|gist|cloudflare)\.fit['":\s\w().]*[^\n]*?\. Плюсы/,
  },
  {
    label: 'Portuguese pro copy contains the Limits heading',
    pattern: /sync\.compare\.(?:local|gist|cloudflare)\.pro['":\s\w().]*[^\n]*?\. Limites\b/,
  },
  {
    label: 'Spanish pro copy contains an unfinished Limits heading',
    pattern: /sync\.compare\.(?:local|gist|cloudflare)\.pro['":\s\w().]*[^\n]*?\. Límites de\b/,
  },
]

const polishedI18nBlocklist = [
  'AI Proveedores',
  'Derived automatically from the data encryption password',
  'Fournisseurs AI',
  'AI Provedores',
  'AI Поставщики',
  'موفري AI قدرات',
  'Modelos {count} buscados',
  'AI الرد',
  'AI responder',
  'AI ответить',
  'AI réponse',
  'فشل التحقق من طراز',
  'فشل التحقق من اتصال',
  'توقف إنشاء',
  'خطأ في تكوين مزامنة',
  'تستخدم مزامنة',
  '. تم حفظ البيانات',
  '. Os dados foram',
  'Lo mejor para uso a largo plazo',
  'chamadas AI',
  'appels AI',
  'вызовов AI',
  'الثابت AI',
  '모델 이름을 입력하고 Space를 누릅니다(예: gpt-5.2',
  'reglas, prompts',
  'قواعد أو prompts',
  'regras, prompts',
  'правила, prompts',
  'règles, prompts',
  'La sync cloud',
  'A sync cloud',
  'cloud cleanup Web/PWA',
  'native build',
  'Você está offline agora',
  'أنت غير متصل الآن',
  'sync verification',
  'verificação final de sync',
  'vérification finale de sync',
  'финальная проверка sync',
  'Cloudflare والوصول إلى الوكيل AI',
  'عنوان URL الخاص بـ Worker، وليس الموفر Base URL',
  'مزودو AI',
  'AI CORS は',
  'Worker URL。 Cloudflare',
  'プロバイダー Base URL ではなく、Worker URL',
  'Base URL와',
  'OpenAI compatible는',
  'Anthropic는',
  'ZeroChat는',
  'Worker Secret를',
  'Gist 및 Cloudflare',
  '공급자 Base URL가 아닌 Worker URL입니다',
  '키는 내 Worker 또는 릴레이',
  '최신 Worker를 재배포합니다',
  '현재 세대',
  '세대가 중지',
  '설정 > 모델 먼저',
  'proxy AI',
  'acceso proxy AI',
  'acesso proxy AI',
  "l'accès proxy AI",
  'прокси-серверу AI',
  'puede presionar CORS',
  'pode clicar em CORS',
  'peut appuyer sur CORS',
  'может нажать CORS',
  'Su URL de Worker',
  'Seu URL Worker',
  'Votre URL Worker',
  'Ваш URL-адрес Worker',
  'no el proveedor Base URL',
  'não o provedor Base URL',
  'pas celle du fournisseur Base URL',
  'а не поставщика Base URL',
  'Luego, Gist',
  'Затем Gist',
  'téléchargent ensuite',
  'liga diretamente',
]

const providerBrowserCorsRecoveryCopyChecks = [
  {
    path: 'src/locales/zh-CN.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          '无法连接：{target}。若终端或原生 App 可用而浏览器不可用，就是浏览器路径被 CORS/preflight 拦住；请在 AI 代理地址填写 Cloudflare Worker URL 后重跑检查。',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          '启用 AI 代理地址前，Web 会直连服务商。若原生 App 或终端可用但这里失败，请在 AI 代理地址填写 Cloudflare Worker URL 后重跑检查。',
      },
    ],
  },
  {
    path: 'src/locales/en-US.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'Cannot connect to {target}. If native or terminal tools work but the browser does not, the browser path is blocked by CORS/preflight; enter a Cloudflare Worker URL in AI proxy URL and rerun the check.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'Browser path is direct until an AI proxy URL is active. If native or terminal tools work but this check fails, enter a Cloudflare Worker URL in AI proxy URL and rerun the check.',
      },
    ],
  },
  {
    path: 'src/locales/es-ES.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'No se puede conectar a {target}. Si apps nativas o terminal funcionan pero el navegador no, el navegador está bloqueado por CORS/preflight; escriba la URL de Cloudflare Worker en URL del proxy de IA y vuelva a ejecutar la comprobación.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'La ruta del navegador es directa hasta activar una URL de proxy de IA. Si apps nativas o terminal funcionan pero esta comprobación falla, escriba una URL de Cloudflare Worker en URL del proxy de IA y vuelva a ejecutar la comprobación.',
      },
    ],
  },
  {
    path: 'src/locales/hi-IN.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          '{target} से कनेक्ट नहीं हो सकता. Native apps या terminal चलें लेकिन browser न चले तो browser path CORS/preflight से blocked है; AI proxy URL में Cloudflare Worker URL भरें और check फिर चलाएं।',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'AI proxy URL सक्रिय होने तक ब्राउज़र रास्ता सीधे प्रदाता को कॉल करता है। अगर native apps या terminal tools चलते हैं लेकिन यह check fail होता है, तो AI proxy URL में Cloudflare Worker URL भरें और check फिर चलाएं।',
      },
    ],
  },
  {
    path: 'src/locales/ar-SA.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'لا يمكن الاتصال بـ {target}. إذا عملت التطبيقات الأصلية أو الطرفية وفشل المتصفح، فمسار المتصفح محجوب بسبب CORS/preflight؛ أدخل رابط Cloudflare Worker في حقل رابط وكيل الذكاء الاصطناعي ثم أعد تشغيل الفحص.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'يبقى مسار المتصفح مباشراً حتى يتم تفعيل رابط وكيل الذكاء الاصطناعي. إذا عملت التطبيقات الأصلية أو الطرفية وفشل هذا الفحص، فأدخل رابط Cloudflare Worker في حقل رابط وكيل الذكاء الاصطناعي ثم أعد تشغيل الفحص.',
      },
    ],
  },
  {
    path: 'src/locales/pt-BR.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'Não é possível conectar-se a {target}. Se apps nativos ou terminal funcionam mas o navegador não, o caminho do navegador está bloqueado por CORS/preflight; informe uma URL do Cloudflare Worker em URL do proxy de IA e execute a verificação novamente.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'O caminho do navegador é direto até uma URL do proxy de IA estar ativa. Se apps nativos ou terminal funcionam mas esta verificação falha, informe uma URL do Cloudflare Worker em URL do proxy de IA e execute a verificação novamente.',
      },
    ],
  },
  {
    path: 'src/locales/ru-RU.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'Невозможно подключиться к {target}. Если native apps или терминал работают, а браузер нет, путь браузера заблокирован CORS/preflight; введите URL Cloudflare Worker в поле URL AI-прокси и запустите проверку заново.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'Путь браузера остается прямым, пока не включен URL AI-прокси. Если native apps или терминал работают, а эта проверка падает, введите URL Cloudflare Worker в поле URL AI-прокси и запустите проверку заново.',
      },
    ],
  },
  {
    path: 'src/locales/ja-JP.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          '{target} に接続できません。ネイティブアプリやターミナルで動きブラウザーだけ失敗する場合、ブラウザー経路が CORS/preflight でブロックされています。AI プロキシ URL に Cloudflare Worker URL を入力し、チェックを再実行してください。',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'AI プロキシ URL が有効になるまではブラウザー経路は直通です。ネイティブアプリやターミナルで動くのにこのチェックが失敗する場合は、AI プロキシ URL に Cloudflare Worker URL を入力し、チェックを再実行してください。',
      },
    ],
  },
  {
    path: 'src/locales/ko-KR.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          '{target}에 연결할 수 없습니다. 네이티브 앱이나 터미널은 되지만 브라우저만 실패하면 브라우저 경로가 CORS/preflight로 차단된 것입니다. AI 프록시 URL에 Cloudflare Worker URL을 입력하고 확인을 다시 실행하세요.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          'AI 프록시 URL이 활성화되기 전까지 브라우저 경로는 직접 호출입니다. 네이티브 앱이나 터미널에서는 되지만 이 확인이 실패하면 AI 프록시 URL에 Cloudflare Worker URL을 입력하고 확인을 다시 실행하세요.',
      },
    ],
  },
  {
    path: 'src/locales/fr-FR.ts',
    localeValues: [
      {
        key: 'error.providerConnectDirect',
        value:
          'Impossible de se connecter à {target}. Si les apps natives ou le terminal fonctionnent mais pas le navigateur, le trajet navigateur est bloqué par CORS/preflight; saisissez une URL Cloudflare Worker dans URL du proxy IA puis relancez la vérification.',
      },
      {
        key: 'settings.browserOriginDirectNote',
        value:
          "Le trajet navigateur reste direct tant qu'aucune URL du proxy IA n'est active. Si les apps natives ou le terminal fonctionnent mais que cette vérification échoue, saisissez une URL Cloudflare Worker dans URL du proxy IA puis relancez la vérification.",
      },
    ],
  },
]

const untranslatedSkillValue = /:\s*['"][^'"\n]*\b[Ss]kills?\b/
const untranslatedImageInpaintValue = /['"]mode\.imageInpaint['"]:\s*['"]Inpaint['"]/
const untranslatedSkillMetaTokenFragments = [
  '{chunks} 段，约 {tokens} tokens',
  '{chunks} fragmentos, unos {tokens} tokens',
  '{chunks} अंश, लगभग {tokens} tokens',
  '{chunks} مقاطع، حوالي {tokens} tokens',
  '{chunks} trechos, cerca de {tokens} tokens',
  '{chunks} фрагментов, около {tokens} tokens',
  '{chunks} extraits, environ {tokens} tokens',
  '{chunks} 個の断片、約 {tokens} tokens',
  '{chunks}개 조각, 약 {tokens} tokens',
]
const untranslatedGithubTokenFragments = [
  '请先填写 GitHub Token',
  'GitHub Token、Worker 配置',
  '细粒度 Token',
  'solo necesita un GitHub Token',
  'el GitHub Token',
  'GitHub Token दर्ज',
  'GitHub Token चाहिए',
  'GitHub Token أولا',
  'GitHub Token؛',
  'GitHub Token を',
  'GitHub Token のみ',
  'GitHub Token을',
  'GitHub Token만',
  'GitHub Token, la clave',
  'GitHub Token, Worker y',
  'GitHub Token, Worker e',
  'GitHub Token, Worker 同期',
  'GitHub Token, Worker 동기화',
  'GitHub Token, la clé',
  'GitHub Token; la',
]

const failures = []
const sourceCache = new Map()
const localeDictionaryCache = new Map()
let translationKeysCache = null

async function readSource(sourcePath) {
  const cached = sourceCache.get(sourcePath)

  if (cached) {
    return cached
  }

  const source = await readFile(sourcePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const parsed = { source, sourceFile }

  sourceCache.set(sourcePath, parsed)
  return parsed
}

function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression?.(node) ||
      ts.isParenthesizedExpression(node))
  ) {
    node = node.expression
  }

  return node
}

function propertyName(node) {
  const name = node.name

  if (
    name &&
    (ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isIdentifier(name))
  ) {
    return name.text
  }

  return null
}

function stringValue(node) {
  const value = unwrap(node)

  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : null
}

function stringArrayValues(arrayLiteral) {
  const values = []

  for (const element of arrayLiteral.elements) {
    const value = stringValue(element)

    if (value == null) {
      return null
    }

    values.push(value)
  }

  return values
}

function findExportedStringArray(sourceFile, name) {
  let values = null

  function visit(node) {
    if (values) {
      return
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
          continue
        }

        const initializer = declaration.initializer && unwrap(declaration.initializer)

        if (initializer && ts.isArrayLiteralExpression(initializer)) {
          values = stringArrayValues(initializer)
          return
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return values
}

async function translationKeys() {
  if (translationKeysCache) {
    return translationKeysCache
  }

  try {
    const { sourceFile } = await readSource('src/locales/keys.ts')
    const keys = findExportedStringArray(sourceFile, 'translationKeys')

    if (!keys) {
      failures.push('src/locales/keys.ts is missing an exported translationKeys string array.')
      translationKeysCache = []
      return translationKeysCache
    }

    translationKeysCache = keys
    return translationKeysCache
  } catch (error) {
    failures.push(`Missing src/locales/keys.ts: ${error.message}`)
    translationKeysCache = []
    return translationKeysCache
  }
}

function dictionaryEntries(objectLiteral) {
  const entries = new Map()

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const key = propertyName(property)

    if (key) {
      entries.set(key, stringValue(property.initializer))
    }
  }

  return entries
}

function dictionaryEntriesFromValues(values, keys, sourcePath) {
  const entries = new Map()

  if (values.length !== keys.length) {
    failures.push(`${sourcePath} has ${values.length} locale values for ${keys.length} translation keys.`)
  }

  for (let index = 0; index < Math.min(values.length, keys.length); index += 1) {
    entries.set(keys[index], values[index])
  }

  return entries
}

async function localeDictionaryForPath(sourcePath) {
  const cached = localeDictionaryCache.get(sourcePath)

  if (cached) {
    return cached
  }

  let parsed = null

  try {
    parsed = await readSource(sourcePath)
  } catch (error) {
    failures.push(`Missing ${sourcePath}: ${error.message}`)
    const empty = new Map()
    localeDictionaryCache.set(sourcePath, empty)
    return empty
  }

  const keys = await translationKeys()
  let entries = null

  function entriesFromInitializer(initializer) {
    const unwrapped = unwrap(initializer)
    let objectLiteral = null
    let values = null

    if (ts.isObjectLiteralExpression(unwrapped)) {
      objectLiteral = unwrapped
    }

    if (ts.isCallExpression(unwrapped)) {
      const argument = unwrapped.arguments[0] && unwrap(unwrapped.arguments[0])

      if (argument && ts.isObjectLiteralExpression(argument)) {
        objectLiteral = argument
      }

      if (argument && ts.isArrayLiteralExpression(argument)) {
        values = stringArrayValues(argument)
      }
    }

    if (objectLiteral) {
      return dictionaryEntries(objectLiteral)
    }

    if (values) {
      return dictionaryEntriesFromValues(values, keys, sourcePath)
    }

    return null
  }

  function visit(node) {
    if (entries) {
      return
    }

    if (ts.isExportAssignment(node)) {
      entries = entriesFromInitializer(node.expression)
      return
    }

    ts.forEachChild(node, visit)
  }

  visit(parsed.sourceFile)

  if (!entries) {
    failures.push(`${sourcePath} does not expose a parseable locale dictionary.`)
    entries = new Map()
  }

  localeDictionaryCache.set(sourcePath, entries)
  return entries
}

function localeValueLabel(check, expectation) {
  return `${check.path} ${expectation.key}`
}

for (const check of checks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing: ${expected}`)
    }
  }

  for (const oldText of oldLongCopy) {
    if (text.includes(oldText)) {
      failures.push(`${label} still contains old long copy: ${oldText}`)
    }
  }
}

for (const check of firstRunCloudflareCopyChecks) {
  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${check.path} is missing first-run Cloudflare copy: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude) {
    if (text.includes(blocked)) {
      failures.push(`${check.path} still uses first-run Worker copy: ${blocked}`)
    }
  }

  const localeDictionary =
    check.localeValues || check.localeValueBlocklist
      ? await localeDictionaryForPath(check.path)
      : null

  for (const expected of check.localeValues ?? []) {
    const actual = localeDictionary.get(expected.key)

    if (actual !== expected.value) {
      failures.push(
        `${localeValueLabel(check, expected)} should be ${JSON.stringify(expected.value)} but found ${JSON.stringify(actual)}`,
      )
    }
  }

  for (const blocked of check.localeValueBlocklist ?? []) {
    const actual = localeDictionary.get(blocked.key)

    if (actual === blocked.value) {
      failures.push(
        `${localeValueLabel(check, blocked)} still uses first-run Worker copy: ${JSON.stringify(blocked.value)}`,
      )
    }
  }
}

for (const check of providerBrowserCorsRecoveryCopyChecks) {
  const localeDictionary = await localeDictionaryForPath(check.path)

  for (const expected of check.localeValues) {
    const actual = localeDictionary.get(expected.key)

    if (actual !== expected.value) {
      failures.push(
        `${localeValueLabel(check, expected)} should point browser CORS recovery at the AI proxy URL field and rerun action; expected ${JSON.stringify(expected.value)} but found ${JSON.stringify(actual)}`,
      )
    }
  }
}

for (const check of webSyncConfigErrorCopyChecks) {
  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${check.path} is missing polished sync configuration error copy: ${expected}`)
    }
  }

  for (const stale of staleWebSyncConfigErrorFragments) {
    if (text.includes(stale)) {
      failures.push(`${check.path} still contains stale sync configuration error copy: ${stale}`)
    }
  }
}

for (const file of nativeUiFiles) {
  let text = ''

  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    failures.push(`Missing ${file}: ${error.message}`)
    continue
  }

  for (const phrase of unresolvedUiCopy) {
    if (text.includes(phrase)) {
      failures.push(`${file} contains unresolved UI copy: ${phrase}`)
    }
  }

  for (const phrase of nativeOverclaimCopy) {
    if (text.includes(phrase)) {
      failures.push(`${file} contains overclaiming native UI copy: ${phrase}`)
    }
  }
}

for (const file of [
  'src/i18n.ts',
  ...nativeUiFiles,
  'apps/android/app/src/main/java/app/zerochat/ui/NativeI18n.kt',
  'apps/apple/App/NativeI18n.swift',
  'apps/windows/ZeroChat/MainWindow.xaml.cpp',
  ...nonEnglishLocaleFiles,
]) {
  let text = ''

  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    failures.push(`Missing ${file}: ${error.message}`)
    continue
  }

  for (const dirtyCopy of dirtyCopyFragments) {
    if (dirtyCopy.pattern.test(text)) {
      failures.push(`${file}: ${dirtyCopy.label}`)
    }
  }

  for (const blockedText of polishedI18nBlocklist) {
    if (text.includes(blockedText)) {
      failures.push(`${file}: contains unpolished i18n copy: ${blockedText}`)
    }
  }

  for (const untranslatedSkillMeta of untranslatedSkillMetaTokenFragments) {
    if (text.includes(untranslatedSkillMeta)) {
      failures.push(`${file}: contains untranslated Skill token unit copy: ${untranslatedSkillMeta}`)
    }
  }

  for (const untranslatedGithubToken of untranslatedGithubTokenFragments) {
    if (text.includes(untranslatedGithubToken)) {
      failures.push(`${file}: contains untranslated GitHub token copy: ${untranslatedGithubToken}`)
    }
  }

  if (nonEnglishLocaleFiles.includes(file) && untranslatedSkillValue.test(text)) {
    failures.push(`${file}: contains untranslated Skill/Skills UI copy`)
  }

  if (nonEnglishLocaleFiles.includes(file) && untranslatedImageInpaintValue.test(text)) {
    failures.push(`${file}: contains untranslated image inpaint mode copy`)
  }
}

for (const file of localizedUserDocs) {
  let text = ''

  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    failures.push(`Missing ${file}: ${error.message}`)
    continue
  }

  for (const stalePath of staleLocalizedAppPaths) {
    if (text.includes(stalePath)) {
      failures.push(`${file} contains untranslated ZeroChat app path: ${stalePath}`)
    }
  }
}

for (const check of nativeBackupImplementationChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing native backup implementation marker: ${expected}`)
    }
  }

  if (text.includes('message.backupNativePending')) {
    failures.push(`${label} still contains the retired native backup pending key.`)
  }
  if (text.includes('export_backup.set_sensitive(false)') || text.includes('import_backup.set_sensitive(false)')) {
    failures.push(`${label} still disables native backup controls.`)
  }
}

for (const check of windowsFallbackBackupSafetyChecks) {
  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${check.path} is missing Windows fallback backup safety marker: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude ?? []) {
    if (text.includes(blocked)) {
      failures.push(`${check.path} still has stale Windows fallback backup copy: ${blocked}`)
    }
  }
}

for (const check of nativeBackupCopyChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing native backup copy marker: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude ?? []) {
    if (text.includes(blocked)) {
      failures.push(`${label} still has stale native backup copy: ${blocked}`)
    }
  }
}

for (const check of nativeSyncProductCopyChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing native sync product copy marker: ${expected}`)
    }
  }
}

for (const check of nativeCloudSyncLabelChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing native cloud-sync label marker: ${expected}`)
    }
  }

  for (const banned of check.mustNotInclude) {
    if (text.includes(banned)) {
      failures.push(`${label} still has generic sync label marker: ${banned}`)
    }
  }
}

for (const check of highRiskSyncPasswordLocaleChecks) {
  if (check.localeValue) {
    const dictionary = await localeDictionaryForPath(check.path)
    const actual = dictionary.get(check.localeValue.key)

    if (actual !== check.localeValue.value) {
      failures.push(
        `${check.path} is missing localized high-risk sync-password copy: ${check.label}`,
      )
    }

    continue
  }

  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  if (!check.pattern.test(text)) {
    failures.push(`${check.path} is missing localized high-risk sync-password copy: ${check.label}`)
  }
}

for (const check of nativeCloudClearScopeChecks) {
  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${check.path} is missing native cloud-clear scope marker: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude ?? []) {
    if (text.includes(blocked)) {
      failures.push(`${check.path} still overclaims native cloud-clear scope: ${blocked}`)
    }
  }
}

for (const check of nativeSkillScopeChecks) {
  let text = ''

  try {
    text = await readFile(check.path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${check.path}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${check.path} is missing native Skill scope marker: ${expected}`)
    }
  }
}

for (const check of nativeSkillDisabledChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing disabled native Skill editing marker: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude ?? []) {
    if (text.includes(blocked)) {
      failures.push(`${label} still has stale Windows Skill fallback copy: ${blocked}`)
    }
  }
}

for (const check of linuxPreviewDisabledChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing Linux preview disabled marker: ${expected}`)
    }
  }
}

for (const check of webI18nBindingChecks) {
  let text = ''
  const paths = check.paths ?? [check.path]
  const label = paths.join(' + ')

  try {
    text = (await Promise.all(paths.map((path) => readFile(path, 'utf8')))).join('\n')
  } catch (error) {
    failures.push(`Missing ${label}: ${error.message}`)
    continue
  }

  for (const expected of check.mustInclude) {
    if (!text.includes(expected)) {
      failures.push(`${label} is missing Web i18n binding: ${expected}`)
    }
  }

  for (const blocked of check.mustNotInclude) {
    if (text.includes(blocked)) {
      failures.push(`${label} contains hardcoded Web UI copy: ${blocked}`)
    }
  }
}

if (failures.length) {
  throw new Error(`Copy consistency checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Copy consistency checks passed')
