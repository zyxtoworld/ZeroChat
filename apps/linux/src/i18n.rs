// Linux UI translations and error-localization helpers live here so the GTK
// surface in main.rs can stay focused on layout and interaction code.

pub(crate) const LANGUAGE_MODES: [&str; 11] = [
    "system", "zh-CN", "en-US", "es-ES", "hi-IN", "ar-SA", "pt-BR", "ru-RU", "ja-JP", "ko-KR",
    "fr-FR",
];

pub(crate) fn resolve_locale(mode: &str) -> String {
    match mode {
        "zh-CN" | "en-US" | "es-ES" | "hi-IN" | "ar-SA" | "pt-BR" | "ru-RU" | "ja-JP" | "ko-KR"
        | "fr-FR" => mode.to_owned(),
        _ => {
            let mut languages = Vec::new();

            if let Ok(language_priority) = std::env::var("LANGUAGE") {
                languages.extend(
                    language_priority
                        .split(':')
                        .map(str::trim)
                        .filter(|language| !language.is_empty())
                        .map(ToOwned::to_owned),
                );
            }

            for variable in ["LC_ALL", "LC_MESSAGES", "LANG"] {
                if let Ok(language) = std::env::var(variable) {
                    languages.push(language);
                }
            }

            for language in languages {
                if let Some(locale) = locale_from_language(&language) {
                    return locale.to_owned();
                }
            }

            "en-US".to_owned()
        }
    }
}

fn locale_from_language(language: &str) -> Option<&'static str> {
    let value = language.trim().to_lowercase().replace('_', "-");

    if value.starts_with("zh") {
        Some("zh-CN")
    } else if value.starts_with("en") {
        Some("en-US")
    } else if value.starts_with("es") {
        Some("es-ES")
    } else if value.starts_with("hi") {
        Some("hi-IN")
    } else if value.starts_with("ar") {
        Some("ar-SA")
    } else if value.starts_with("pt") {
        Some("pt-BR")
    } else if value.starts_with("ru") {
        Some("ru-RU")
    } else if value.starts_with("ja") {
        Some("ja-JP")
    } else if value.starts_with("ko") {
        Some("ko-KR")
    } else if value.starts_with("fr") {
        Some("fr-FR")
    } else {
        None
    }
}

pub(crate) fn tr(locale: &str, key: &str) -> &'static str {
    let zh = locale == "zh-CN";
    let es = locale == "es-ES";
    let hi = locale == "hi-IN";
    let ar = locale == "ar-SA";
    let pt = locale == "pt-BR";
    let ru = locale == "ru-RU";
    let fr = locale == "fr-FR";
    let ja = locale == "ja-JP";
    let ko = locale == "ko-KR";

    match key {
        "action.send" if zh => "发送",
        "action.send" if es => "Enviar",
        "action.send" if hi => "भेजें",
        "action.send" if ar => "إرسال",
        "action.send" if pt => "Enviar",
        "action.send" if ru => "Отправить",
        "action.send" if fr => "Envoyer",
        "action.send" if ja => "送信",
        "action.send" if ko => "보내기",
        "action.send" => "Send",
        "action.generate" if zh => "生成",
        "action.generate" if es => "Generar",
        "action.generate" if hi => "बनाएं",
        "action.generate" if ar => "إنشاء",
        "action.generate" if pt => "Gerar",
        "action.generate" if ru => "Создать",
        "action.generate" if fr => "Générer",
        "action.generate" if ja => "生成",
        "action.generate" if ko => "생성",
        "action.generate" => "Generate",
        "action.addModel" if zh => "添加模型",
        "action.addModel" if es => "Añadir modelo",
        "action.addModel" if hi => "मॉडल जोड़ें",
        "action.addModel" if ar => "إضافة نموذج",
        "action.addModel" if pt => "Adicionar modelo",
        "action.addModel" if ru => "Добавить модель",
        "action.addModel" if fr => "Ajouter un modèle",
        "action.addModel" if ja => "モデルを追加",
        "action.addModel" if ko => "모델 추가",
        "action.addModel" => "Add model",
        "capability.audio" if zh => "音频",
        "capability.audio" if es => "Audio",
        "capability.audio" if hi => "ऑडियो",
        "capability.audio" if ar => "الصوت",
        "capability.audio" if pt => "Áudio",
        "capability.audio" if ru => "Аудио",
        "capability.audio" if fr => "Audio",
        "capability.audio" if ja => "音声",
        "capability.audio" if ko => "오디오",
        "capability.audio" => "Audio",
        "capability.audio-speech" if zh => "语音合成",
        "capability.audio-speech" if es => "Texto a voz",
        "capability.audio-speech" if hi => "टेक्स्ट से आवाज",
        "capability.audio-speech" if ar => "تحويل النص إلى كلام",
        "capability.audio-speech" if pt => "Texto para fala",
        "capability.audio-speech" if ru => "Синтез речи",
        "capability.audio-speech" if fr => "Synthese vocale",
        "capability.audio-speech" if ja => "テキスト読み上げ",
        "capability.audio-speech" if ko => "텍스트 음성 변환",
        "capability.audio-speech" => "Text to speech",
        "capability.audio-transcription" if zh => "音频转写",
        "capability.audio-transcription" if es => "Transcripcion de audio",
        "capability.audio-transcription" if hi => "ऑडियो ट्रांसक्रिप्शन",
        "capability.audio-transcription" if ar => "تفريغ الصوت",
        "capability.audio-transcription" if pt => "Transcrição de áudio",
        "capability.audio-transcription" if ru => "Расшифровка аудио",
        "capability.audio-transcription" if fr => "Transcription audio",
        "capability.audio-transcription" if ja => "音声文字起こし",
        "capability.audio-transcription" if ko => "오디오 전사",
        "capability.audio-transcription" => "Audio transcription",
        "capability.chat" if zh => "文字对话",
        "capability.chat" if es => "Chat",
        "capability.chat" if hi => "चैट",
        "capability.chat" if ar => "الدردشة",
        "capability.chat" if pt => "Bate-papo",
        "capability.chat" if ru => "Чат",
        "capability.chat" if fr => "Chat",
        "capability.chat" if ja => "チャット",
        "capability.chat" if ko => "채팅",
        "capability.chat" => "Chat",
        "capability.embeddings" if zh => "向量",
        "capability.embeddings" if es => "Incrustaciones",
        "capability.embeddings" if hi => "एंबेडिंग",
        "capability.embeddings" if ar => "التضمينات",
        "capability.embeddings" if pt => "Embeddings",
        "capability.embeddings" if ru => "Вложения",
        "capability.embeddings" if fr => "Incorporations",
        "capability.embeddings" if ja => "埋め込み",
        "capability.embeddings" if ko => "임베딩",
        "capability.embeddings" => "Embeddings",
        "capability.image-editing" if zh => "图片编辑",
        "capability.image-editing" if es => "Edición de imágenes",
        "capability.image-editing" if hi => "छवि संपादन",
        "capability.image-editing" if ar => "تحرير الصور",
        "capability.image-editing" if pt => "Edição de imagem",
        "capability.image-editing" if ru => "Редактирование изображений",
        "capability.image-editing" if fr => "Édition d'images",
        "capability.image-editing" if ja => "画像編集",
        "capability.image-editing" if ko => "이미지 편집",
        "capability.image-editing" => "Image editing",
        "capability.image-generation" if zh => "图片生成",
        "capability.image-generation" if es => "Generación de imágenes",
        "capability.image-generation" if hi => "छवि निर्माण",
        "capability.image-generation" if ar => "إنشاء الصور",
        "capability.image-generation" if pt => "Geração de imagem",
        "capability.image-generation" if ru => "Генерация изображений",
        "capability.image-generation" if fr => "Génération d'images",
        "capability.image-generation" if ja => "画像生成",
        "capability.image-generation" if ko => "이미지 생성",
        "capability.image-generation" => "Image generation",
        "capability.model-list" if zh => "模型列表",
        "capability.model-list" if es => "Lista de modelos",
        "capability.model-list" if hi => "मॉडल सूची",
        "capability.model-list" if ar => "قائمة النماذج",
        "capability.model-list" if pt => "Lista de modelos",
        "capability.model-list" if ru => "Список моделей",
        "capability.model-list" if fr => "Liste de modèles",
        "capability.model-list" if ja => "モデルリスト",
        "capability.model-list" if ko => "모델 목록",
        "capability.model-list" => "Model list",
        "capability.moderation" if zh => "安全审核",
        "capability.moderation" if es => "Moderación",
        "capability.moderation" if hi => "मॉडरेशन",
        "capability.moderation" if ar => "الإشراف",
        "capability.moderation" if pt => "Moderação",
        "capability.moderation" if ru => "Модерация",
        "capability.moderation" if fr => "Modération",
        "capability.moderation" if ja => "モデレーション",
        "capability.moderation" if ko => "조정",
        "capability.moderation" => "Moderation",
        "capability.realtime" if zh => "实时语音",
        "capability.realtime" if es => "Voz en tiempo real",
        "capability.realtime" if hi => "रीयलटाइम वॉयस",
        "capability.realtime" if ar => "الصوت الحقيقي",
        "capability.realtime" if pt => "Voz em tempo real",
        "capability.realtime" if ru => "Голос в реальном времени",
        "capability.realtime" if fr => "Voix en temps réel",
        "capability.realtime" if ja => "リアルタイム音声",
        "capability.realtime" if ko => "실시간 음성",
        "capability.realtime" => "Realtime voice",
        "capability.tools" if zh => "工具调用",
        "capability.tools" if es => "Herramienta de llamadas",
        "capability.tools" if hi => "टूल कॉलिंग",
        "capability.tools" if ar => "أداة الاتصال",
        "capability.tools" if pt => "Chamada de ferramenta",
        "capability.tools" if ru => "Инструмент вызова",
        "capability.tools" if fr => "Outil d'appel",
        "capability.tools" if ja => "ツール呼び出し",
        "capability.tools" if ko => "도구 호출",
        "capability.tools" => "Tool calling",
        "capability.vision" if zh => "图片理解",
        "capability.vision" if es => "Visión",
        "capability.vision" if hi => "विजन",
        "capability.vision" if ar => "الرؤية",
        "capability.vision" if pt => "Visão",
        "capability.vision" if ru => "Vision",
        "capability.vision" if fr => "Vision",
        "capability.vision" if ja => "ビジョン",
        "capability.vision" if ko => "비전",
        "capability.vision" => "Vision",
        "action.addProviderKey" if zh => "填写 API Key",
        "action.addProviderKey" if es => "Añadir clave",
        "action.addProviderKey" if hi => "प्रदाता कुंजी जोड़ें",
        "action.addProviderKey" if ar => "إضافة مفتاح المزود",
        "action.addProviderKey" if pt => "Adicionar chave",
        "action.addProviderKey" if ru => "Добавить ключ",
        "action.addProviderKey" if fr => "Ajouter la clé",
        "action.addProviderKey" if ja => "キーを追加",
        "action.addProviderKey" if ko => "키 추가",
        "action.addProviderKey" => "Add provider key",
        "action.chooseProvider" if zh => "选择服务商",
        "action.chooseProvider" if es => "Elegir proveedor",
        "action.chooseProvider" if hi => "प्रदाता चुनें",
        "action.chooseProvider" if ar => "اختيار مزود",
        "action.chooseProvider" if pt => "Escolher provedor",
        "action.chooseProvider" if ru => "Выбрать провайдера",
        "action.chooseProvider" if fr => "Choisir un fournisseur",
        "action.chooseProvider" if ja => "プロバイダーを選択",
        "action.chooseProvider" if ko => "공급자 선택",
        "action.chooseProvider" => "Choose provider",
        "featureHint.dismiss" if zh => "知道了",
        "featureHint.dismiss" if es => "Entendido",
        "featureHint.dismiss" if hi => "समझ गया",
        "featureHint.dismiss" if ar => "فهمت",
        "featureHint.dismiss" if pt => "Entendi",
        "featureHint.dismiss" if ru => "Понятно",
        "featureHint.dismiss" if fr => "Compris",
        "featureHint.dismiss" if ja => "了解",
        "featureHint.dismiss" if ko => "알겠습니다",
        "featureHint.dismiss" => "Got it",
        "featureHint.provider-model" if zh => {
            "在这里切换当前聊天的服务商和模型。图片模式只显示兼容模型。"
        }
        "featureHint.provider-model" if es => {
            "Cambia aquí el proveedor y el modelo de este chat. Imagen muestra modelos compatibles."
        }
        "featureHint.provider-model" if hi => {
            "इस चैट का प्रदाता और मॉडल यहां बदलें। इमेज मोड संगत मॉडल दिखाता है।"
        }
        "featureHint.provider-model" if ar => {
            "بدّل مزوّد ونموذج هذه المحادثة هنا. يعرض وضع الصور النماذج المتوافقة فقط."
        }
        "featureHint.provider-model" if pt => {
            "Troque aqui o provedor e o modelo deste chat. Imagem mostra modelos compatíveis."
        }
        "featureHint.provider-model" if ru => {
            "Здесь меняются поставщик и модель этого чата. В режиме изображений показаны совместимые модели."
        }
        "featureHint.provider-model" if fr => {
            "Changez ici le fournisseur et le modèle de ce chat. Le mode Image affiche les modèles compatibles."
        }
        "featureHint.provider-model" if ja => {
            "このチャットのプロバイダーとモデルをここで切り替えます。画像モードでは対応モデルだけを表示します。"
        }
        "featureHint.provider-model" if ko => {
            "여기서 이 채팅의 공급자와 모델을 바꿉니다. 이미지 모드에서는 호환 모델만 표시됩니다."
        }
        "featureHint.provider-model" => {
            "Switch the provider and model for this chat here. Image mode shows compatible models."
        }
        "app.localFirst" if zh => "本地优先。需要多设备时再开启加密同步。",
        "app.localFirst" if es => {
            "Primero local. Activa la sincronización cifrada cuando necesites más dispositivos."
        }
        "app.localFirst" if hi => "पहले स्थानीय। अधिक डिवाइस चाहिए हों तो एन्क्रिप्टेड सिंक चालू करें।",
        "app.localFirst" if ar => "محلي أولا. فعّل المزامنة المشفرة عندما تحتاج إلى أجهزة أخرى.",
        "app.localFirst" if pt => {
            "Local primeiro. Ative a sincronização criptografada quando precisar de mais dispositivos."
        }
        "app.localFirst" if ru => {
            "Сначала локально. Включите зашифрованную синхронизацию, когда нужны другие устройства."
        }
        "app.localFirst" if fr => {
            "Local d'abord. Activez la synchronisation chiffrée lorsque vous utilisez plusieurs appareils."
        }
        "app.localFirst" if ja => "ローカル優先。複数端末が必要なときに暗号化同期を有効にします。",
        "app.localFirst" if ko => "로컬 우선. 여러 기기가 필요할 때 암호화 동기화를 켜세요.",
        "app.localFirst" => "Local first. Turn on encrypted sync when you need more devices.",
        "field.compactDisplay" if zh => "紧凑显示",
        "field.compactDisplay" if es => "Vista compacta",
        "field.compactDisplay" if hi => "कॉम्पैक्ट दृश्य",
        "field.compactDisplay" if ar => "عرض مضغوط",
        "field.compactDisplay" if pt => "Exibição compacta",
        "field.compactDisplay" if ru => "Компактный вид",
        "field.compactDisplay" if fr => "Affichage compact",
        "field.compactDisplay" if ja => "コンパクト表示",
        "field.compactDisplay" if ko => "컴팩트 표시",
        "field.compactDisplay" => "Compact display",
        "field.language" if zh => "语言",
        "field.language" if es => "Idioma",
        "field.language" if hi => "भाषा",
        "field.language" if ar => "اللغة",
        "field.language" if pt => "Idioma",
        "field.language" if ru => "Язык",
        "field.language" if fr => "Langue",
        "field.language" if ja => "言語",
        "field.language" if ko => "언어",
        "field.language" => "Language",
        "field.theme" if zh => "主题",
        "field.theme" if es => "Tema",
        "field.theme" if hi => "थीम",
        "field.theme" if ar => "السمة",
        "field.theme" if pt => "Tema",
        "field.theme" if ru => "Тема",
        "field.theme" if fr => "Thème",
        "field.theme" if ja => "テーマ",
        "field.theme" if ko => "테마",
        "field.theme" => "Theme",
        "language.system" if zh => "跟随系统",
        "language.system" if es => "Seguir el sistema",
        "language.system" if hi => "सिस्टम के अनुसार",
        "language.system" if ar => "اتباع النظام",
        "language.system" if pt => "Seguir sistema",
        "language.system" if ru => "Как в системе",
        "language.system" if fr => "Suivre le système",
        "language.system" if ja => "システムに従う",
        "language.system" if ko => "시스템 설정 따르기",
        "language.system" => "Follow system",
        "message.configureModelFirst" if zh => "请先启用服务商并添加模型，然后开始聊天。",
        "message.configureModelFirst" if es => {
            "Activa un proveedor, añade un modelo y empieza a chatear."
        }
        "message.configureModelFirst" if hi => "प्रदाता सक्षम करें, मॉडल जोड़ें, फिर चैट शुरू करें।",
        "message.configureModelFirst" if ar => "فعّل موفرا وأضف نموذجا ثم ابدأ الدردشة.",
        "message.configureModelFirst" if pt => {
            "Ative um provedor, adicione um modelo e comece a conversar."
        }
        "message.configureModelFirst" if ru => {
            "Включите провайдера, добавьте модель и начните чат."
        }
        "message.configureModelFirst" if fr => {
            "Activez un fournisseur, ajoutez un modèle, puis commencez à discuter."
        }
        "message.configureModelFirst" if ja => {
            "プロバイダーを有効化し、モデルを追加してからチャットを開始してください。"
        }
        "message.configureModelFirst" if ko => {
            "공급자를 활성화하고 모델을 추가한 뒤 채팅을 시작하세요."
        }
        "message.configureModelFirst" => {
            "Enable a provider, add a model, then start chatting. User messages stay on the right; AI messages stay on the left."
        }
        "message.editing" if zh => "正在编辑消息，发送后会重新生成回复。",
        "message.editing" if es => "Edita el mensaje. Al enviarlo se regenerará la respuesta.",
        "message.editing" if hi => "संदेश संपादित करें। भेजने पर उत्तर फिर बनेगा।",
        "message.editing" if ar => "عدّل الرسالة. سيؤدي الإرسال إلى إنشاء الرد من جديد.",
        "message.editing" if pt => "Edite a mensagem. O envio vai gerar a resposta novamente.",
        "message.editing" if ru => "Измените сообщение. При отправке ответ будет создан заново.",
        "message.editing" if fr => "Modifiez le message. L'envoi régénérera la réponse.",
        "message.editing" if ja => "メッセージを編集します。送信すると返信が再生成されます。",
        "message.editing" if ko => "메시지를 수정하세요. 보내면 답변이 다시 생성됩니다.",
        "message.editing" => "Edit the message. Sending will regenerate the reply.",
        "message.emptyChat" if zh => "发送消息即可开始聊天。",
        "message.emptyChat" if es => "Empieza un chat enviando un mensaje.",
        "message.emptyChat" if hi => "संदेश भेजकर चैट शुरू करें।",
        "message.emptyChat" if ar => "ابدأ محادثة بإرسال رسالة.",
        "message.emptyChat" if pt => "Comece um chat enviando uma mensagem.",
        "message.emptyChat" if ru => "Начните чат, отправив сообщение.",
        "message.emptyChat" if fr => "Commencez un chat en envoyant un message.",
        "message.emptyChat" if ja => "メッセージを送信してチャットを開始します。",
        "message.emptyChat" if ko => "메시지를 보내 채팅을 시작하세요.",
        "message.emptyChat" => "Start a chat by sending a message.",
        "message.localSnapshotLoadFailed" if zh => {
            "本机数据无法读取。ZeroChat 已用默认数据启动，并会保留原快照不覆盖。请导入加密备份或重置本机数据以恢复保存。"
        }
        "message.localSnapshotLoadFailed" if es => {
            "No se pudieron leer los datos locales. ZeroChat se abrió con los valores predeterminados y no sobrescribirá la instantánea existente. Importa una copia cifrada o restablece los datos locales para volver a guardar."
        }
        "message.localSnapshotLoadFailed" if hi => {
            "स्थानीय डेटा पढ़ा नहीं जा सका। ZeroChat डिफ़ॉल्ट डेटा के साथ खुला है और मौजूदा स्नैपशॉट को नहीं बदलेगा। सेव करना फिर शुरू करने के लिए एन्क्रिप्टेड बैकअप आयात करें या स्थानीय डेटा रीसेट करें।"
        }
        "message.localSnapshotLoadFailed" if ar => {
            "تعذرت قراءة البيانات المحلية. فُتح ZeroChat بالبيانات الافتراضية ولن يستبدل اللقطة الحالية. استورد نسخة احتياطية مشفرة أو أعد تعيين البيانات المحلية لاستئناف الحفظ."
        }
        "message.localSnapshotLoadFailed" if pt => {
            "Não foi possível ler os dados locais. O ZeroChat abriu com os padrões e não substituirá o snapshot existente. Importe um backup criptografado ou redefina os dados locais para voltar a salvar."
        }
        "message.localSnapshotLoadFailed" if ru => {
            "Не удалось прочитать локальные данные. ZeroChat открыт с данными по умолчанию и не перезапишет существующий снимок. Импортируйте зашифрованную копию или сбросьте локальные данные, чтобы возобновить сохранение."
        }
        "message.localSnapshotLoadFailed" if fr => {
            "Les données locales sont illisibles. ZeroChat a démarré avec les valeurs par défaut et ne remplacera pas l’instantané existant. Importez une sauvegarde chiffrée ou réinitialisez les données locales pour reprendre l’enregistrement."
        }
        "message.localSnapshotLoadFailed" if ja => {
            "ローカルデータを読み込めませんでした。ZeroChat は既定データで起動し、既存のスナップショットを上書きしません。保存を再開するには暗号化バックアップを読み込むか、ローカルデータをリセットしてください。"
        }
        "message.localSnapshotLoadFailed" if ko => {
            "로컬 데이터를 읽을 수 없습니다. ZeroChat은 기본 데이터로 열렸으며 기존 스냅샷을 덮어쓰지 않습니다. 저장을 다시 시작하려면 암호화 백업을 가져오거나 로컬 데이터를 초기화하세요."
        }
        "message.localSnapshotLoadFailed" => {
            "Local data could not be read. ZeroChat opened with defaults and will not overwrite the existing snapshot. Import an encrypted backup or reset local data to resume saving."
        }
        "message.localSnapshotSaveFailed" if zh => {
            "本机数据保存失败。ZeroChat 已撤销本次更改，并暂停后续保存和同步。请修复 Linux 数据目录后导入加密备份或重置本机数据。"
        }
        "message.localSnapshotSaveFailed" if es => {
            "No se pudieron guardar los datos locales. ZeroChat deshizo este cambio y pausó el guardado y la sincronización. Corrige el directorio de datos de Linux y luego importa una copia cifrada o restablece los datos locales."
        }
        "message.localSnapshotSaveFailed" if hi => {
            "स्थानीय डेटा सेव नहीं हो सका। ZeroChat ने यह बदलाव वापस कर दिया और आगे सेव व सिंक करना रोक दिया। Linux डेटा डायरेक्टरी ठीक करें, फिर एन्क्रिप्टेड बैकअप आयात करें या स्थानीय डेटा रीसेट करें।"
        }
        "message.localSnapshotSaveFailed" if ar => {
            "تعذر حفظ البيانات المحلية. تراجع ZeroChat عن هذا التغيير وأوقف الحفظ والمزامنة. أصلح دليل بيانات Linux، ثم استورد نسخة احتياطية مشفرة أو أعد تعيين البيانات المحلية."
        }
        "message.localSnapshotSaveFailed" if pt => {
            "Não foi possível salvar os dados locais. O ZeroChat desfez esta alteração e pausou novos salvamentos e sincronizações. Corrija o diretório de dados do Linux e depois importe um backup criptografado ou redefina os dados locais."
        }
        "message.localSnapshotSaveFailed" if ru => {
            "Не удалось сохранить локальные данные. ZeroChat отменил это изменение и приостановил сохранение и синхронизацию. Исправьте каталог данных Linux, затем импортируйте зашифрованную копию или сбросьте локальные данные."
        }
        "message.localSnapshotSaveFailed" if fr => {
            "Impossible d’enregistrer les données locales. ZeroChat a annulé cette modification et suspendu l’enregistrement et la synchronisation. Corrigez le dossier de données Linux, puis importez une sauvegarde chiffrée ou réinitialisez les données locales."
        }
        "message.localSnapshotSaveFailed" if ja => {
            "ローカルデータを保存できませんでした。ZeroChat は今回の変更を取り消し、保存と同期を停止しました。Linux データディレクトリを修復してから、暗号化バックアップを読み込むかローカルデータをリセットしてください。"
        }
        "message.localSnapshotSaveFailed" if ko => {
            "로컬 데이터를 저장할 수 없습니다. ZeroChat이 이번 변경을 되돌리고 저장과 동기화를 중지했습니다. Linux 데이터 디렉터리를 복구한 뒤 암호화 백업을 가져오거나 로컬 데이터를 초기화하세요."
        }
        "message.localSnapshotSaveFailed" => {
            "Local data could not be saved. ZeroChat reverted this change and paused further saves and sync. Repair the Linux data directory, then import an encrypted backup or reset local data."
        }
        "message.localResetFailed" if zh => {
            "本机数据未能重置，现有数据保持不变。请检查 Linux 数据目录和系统密钥环后重试。"
        }
        "message.localResetFailed" if es => {
            "No se pudieron restablecer los datos locales y se conservaron los datos existentes. Revisa el directorio de datos de Linux y el llavero del sistema antes de intentarlo de nuevo."
        }
        "message.localResetFailed" if hi => {
            "स्थानीय डेटा रीसेट नहीं हो सका और मौजूदा डेटा सुरक्षित रखा गया। फिर प्रयास करने से पहले Linux डेटा डायरेक्टरी और सिस्टम कीरिंग जाँचें।"
        }
        "message.localResetFailed" if ar => {
            "تعذرت إعادة تعيين البيانات المحلية وتم الاحتفاظ بالبيانات الحالية. تحقق من دليل بيانات Linux وحلقة مفاتيح النظام قبل المحاولة مجددًا."
        }
        "message.localResetFailed" if pt => {
            "Não foi possível redefinir os dados locais, e os dados atuais foram preservados. Verifique o diretório de dados do Linux e o chaveiro do sistema antes de tentar novamente."
        }
        "message.localResetFailed" if ru => {
            "Не удалось сбросить локальные данные, поэтому существующие данные сохранены. Проверьте каталог данных Linux и системное хранилище ключей перед повторной попыткой."
        }
        "message.localResetFailed" if fr => {
            "La réinitialisation des données locales a échoué et les données existantes ont été conservées. Vérifiez le dossier de données Linux et le trousseau système avant de réessayer."
        }
        "message.localResetFailed" if ja => {
            "ローカルデータをリセットできなかったため、既存のデータを保持しました。Linux のデータディレクトリとシステムキーリングを確認してから再試行してください。"
        }
        "message.localResetFailed" if ko => {
            "로컬 데이터를 초기화하지 못해 기존 데이터를 유지했습니다. Linux 데이터 디렉터리와 시스템 키링을 확인한 뒤 다시 시도하세요."
        }
        "message.localResetFailed" => {
            "Local data could not be reset, so existing data was preserved. Check the Linux data directory and system keyring before trying again."
        }
        "message.secretSaveFailed" if zh => "凭据未能保存。请检查系统密钥环后重试。",
        "message.secretSaveFailed" if es => {
            "No se pudo guardar la credencial. Revisa el llavero del sistema e inténtalo de nuevo."
        }
        "message.secretSaveFailed" if hi => {
            "क्रेडेंशियल सेव नहीं हो सका। सिस्टम कीरिंग जाँचें और फिर प्रयास करें।"
        }
        "message.secretSaveFailed" if ar => {
            "تعذر حفظ بيانات الاعتماد. تحقق من حلقة مفاتيح النظام ثم حاول مجددًا."
        }
        "message.secretSaveFailed" if pt => {
            "Não foi possível salvar a credencial. Verifique o chaveiro do sistema e tente novamente."
        }
        "message.secretSaveFailed" if ru => {
            "Не удалось сохранить учетные данные. Проверьте системное хранилище ключей и повторите попытку."
        }
        "message.secretSaveFailed" if fr => {
            "Impossible d’enregistrer l’identifiant. Vérifiez le trousseau système puis réessayez."
        }
        "message.secretSaveFailed" if ja => {
            "認証情報を保存できませんでした。システムキーリングを確認して再試行してください。"
        }
        "message.secretSaveFailed" if ko => {
            "자격 증명을 저장하지 못했습니다. 시스템 키링을 확인한 뒤 다시 시도하세요."
        }
        "message.secretSaveFailed" => {
            "The credential could not be saved. Check the system keyring and try again."
        }
        "message.localStorageUnavailable" if zh => {
            "本机存储目录不可用。ZeroChat 已用默认数据启动，本次更改不会保存；请修复 Linux 数据目录权限后重启。"
        }
        "message.localStorageUnavailable" if es => {
            "El directorio de almacenamiento local no está disponible. ZeroChat se abrió con los valores predeterminados y los cambios no se guardarán. Corrige los permisos del directorio de datos de Linux y reinicia."
        }
        "message.localStorageUnavailable" if hi => {
            "स्थानीय स्टोरेज डायरेक्टरी उपलब्ध नहीं है। ZeroChat डिफ़ॉल्ट डेटा के साथ खुला है और बदलाव सेव नहीं होंगे। Linux डेटा डायरेक्टरी की अनुमतियाँ ठीक करके फिर शुरू करें।"
        }
        "message.localStorageUnavailable" if ar => {
            "دليل التخزين المحلي غير متاح. فُتح ZeroChat بالبيانات الافتراضية ولن تُحفظ التغييرات. أصلح أذونات دليل بيانات Linux ثم أعد التشغيل."
        }
        "message.localStorageUnavailable" if pt => {
            "O diretório de armazenamento local não está disponível. O ZeroChat abriu com os padrões e as alterações não serão salvas. Corrija as permissões do diretório de dados do Linux e reinicie."
        }
        "message.localStorageUnavailable" if ru => {
            "Каталог локального хранилища недоступен. ZeroChat открыт с данными по умолчанию, изменения не будут сохранены. Исправьте права каталога данных Linux и перезапустите приложение."
        }
        "message.localStorageUnavailable" if fr => {
            "Le dossier de stockage local est indisponible. ZeroChat a démarré avec les valeurs par défaut et les modifications ne seront pas enregistrées. Corrigez les autorisations du dossier de données Linux puis redémarrez."
        }
        "message.localStorageUnavailable" if ja => {
            "ローカル保存先を利用できません。ZeroChat は既定データで起動しており、変更は保存されません。Linux データディレクトリの権限を修正して再起動してください。"
        }
        "message.localStorageUnavailable" if ko => {
            "로컬 저장 디렉터리를 사용할 수 없습니다. ZeroChat은 기본 데이터로 열렸으며 변경 사항이 저장되지 않습니다. Linux 데이터 디렉터리 권한을 수정한 뒤 다시 시작하세요."
        }
        "message.localStorageUnavailable" => {
            "The local storage directory is unavailable. ZeroChat opened with defaults and changes will not be saved. Fix the Linux data-directory permissions and restart."
        }
        "mode.chat" if zh => "聊天",
        "mode.chat" if es => "Chat",
        "mode.chat" if hi => "चैट",
        "mode.chat" if ar => "دردشة",
        "mode.chat" if pt => "Chat",
        "mode.chat" if ru => "Чат",
        "mode.chat" if fr => "Chat",
        "mode.chat" if ja => "チャット",
        "mode.chat" if ko => "채팅",
        "mode.chat" => "Chat",
        "mode.image" if zh => "图片",
        "mode.image" if es => "Imagen",
        "mode.image" if hi => "चित्र",
        "mode.image" if ar => "صورة",
        "mode.image" if pt => "Imagem",
        "mode.image" if ru => "Изображение",
        "mode.image" if fr => "Image",
        "mode.image" if ja => "画像",
        "mode.image" if ko => "이미지",
        "mode.image" => "Image",
        "mode.imageEdit" if zh => "编辑图片",
        "mode.imageEdit" if es => "Editar imagen",
        "mode.imageEdit" if hi => "चित्र संपादित करें",
        "mode.imageEdit" if ar => "تعديل الصورة",
        "mode.imageEdit" if pt => "Editar imagem",
        "mode.imageEdit" if ru => "Изменить изображение",
        "mode.imageEdit" if fr => "Modifier l'image",
        "mode.imageEdit" if ja => "画像を編集",
        "mode.imageEdit" if ko => "이미지 편집",
        "mode.imageEdit" => "Edit image",
        "mode.imageEditShort" if zh => "改图",
        "mode.imageEditShort" if es => "Editar",
        "mode.imageEditShort" if hi => "संपादित",
        "mode.imageEditShort" if ar => "تعديل",
        "mode.imageEditShort" if pt => "Editar",
        "mode.imageEditShort" if ru => "Правка",
        "mode.imageEditShort" if fr => "Modifier",
        "mode.imageEditShort" if ja => "編集",
        "mode.imageEditShort" if ko => "편집",
        "mode.imageEditShort" => "Edit",
        "mode.imageGenerate" if zh => "文生图",
        "mode.imageGenerate" if es => "Texto a imagen",
        "mode.imageGenerate" if hi => "टेक्स्ट से चित्र",
        "mode.imageGenerate" if ar => "نص إلى صورة",
        "mode.imageGenerate" if pt => "Texto para imagem",
        "mode.imageGenerate" if ru => "Текст в изображение",
        "mode.imageGenerate" if fr => "Texte vers image",
        "mode.imageGenerate" if ja => "テキストから画像",
        "mode.imageGenerate" if ko => "텍스트를 이미지로",
        "mode.imageGenerate" => "Text to image",
        "mode.imageGenerateShort" if zh => "生成",
        "mode.imageGenerateShort" if es => "Generar",
        "mode.imageGenerateShort" if hi => "बनाएं",
        "mode.imageGenerateShort" if ar => "إنشاء",
        "mode.imageGenerateShort" if pt => "Gerar",
        "mode.imageGenerateShort" if ru => "Создать",
        "mode.imageGenerateShort" if fr => "Générer",
        "mode.imageGenerateShort" if ja => "生成",
        "mode.imageGenerateShort" if ko => "생성",
        "mode.imageGenerateShort" => "Generate",
        "mode.imageInpaint" if zh => "局部重绘",
        "mode.imageInpaint" if es => "Rellenar imagen",
        "mode.imageInpaint" if hi => "इनपेंट",
        "mode.imageInpaint" if ar => "إعادة رسم",
        "mode.imageInpaint" if pt => "Retoque",
        "mode.imageInpaint" if ru => "Дорисовка",
        "mode.imageInpaint" if fr => "Retouche",
        "mode.imageInpaint" if ja => "部分修正",
        "mode.imageInpaint" if ko => "부분 수정",
        "mode.imageInpaint" => "Inpaint",
        "mode.imageInpaintShort" if zh => "重绘",
        "mode.imageInpaintShort" if es => "Rellenar",
        "mode.imageInpaintShort" if hi => "इनपेंट",
        "mode.imageInpaintShort" if ar => "رسم",
        "mode.imageInpaintShort" if pt => "Retoque",
        "mode.imageInpaintShort" if ru => "Дорисовка",
        "mode.imageInpaintShort" if fr => "Retouche",
        "mode.imageInpaintShort" if ja => "修正",
        "mode.imageInpaintShort" if ko => "수정",
        "mode.imageInpaintShort" => "Inpaint",
        "placeholder.maskImage" if zh => "遮罩图片",
        "placeholder.maskImage" if es => "Imagen de máscara",
        "placeholder.maskImage" if hi => "मास्क चित्र",
        "placeholder.maskImage" if ar => "صورة القناع",
        "placeholder.maskImage" if pt => "Imagem de máscara",
        "placeholder.maskImage" if ru => "Маска",
        "placeholder.maskImage" if fr => "Image de masque",
        "placeholder.maskImage" if ja => "マスク画像",
        "placeholder.maskImage" if ko => "마스크 이미지",
        "placeholder.maskImage" => "Mask image",
        "placeholder.message" if zh => "消息",
        "placeholder.message" if es => "Mensaje",
        "placeholder.message" if hi => "संदेश",
        "placeholder.message" if ar => "رسالة",
        "placeholder.message" if pt => "Mensagem",
        "placeholder.message" if ru => "Сообщение",
        "placeholder.message" if fr => "Message",
        "placeholder.message" if ja => "メッセージ",
        "placeholder.message" if ko => "메시지",
        "placeholder.message" => "Message",
        "placeholder.imagePrompt" if zh => "描述你想生成或修改的图片",
        "placeholder.imagePrompt" if es => "Describe la imagen que quieres generar o editar",
        "placeholder.imagePrompt" if hi => "वह चित्र बताएं जिसे बनाना या संपादित करना है",
        "placeholder.imagePrompt" if ar => "صف الصورة التي تريد إنشاءها أو تعديلها",
        "placeholder.imagePrompt" if pt => "Descreva a imagem que deseja gerar ou editar",
        "placeholder.imagePrompt" if ru => "Опишите изображение для создания или изменения",
        "placeholder.imagePrompt" if fr => "Décrivez l'image à générer ou modifier",
        "placeholder.imagePrompt" if ja => "生成または編集したい画像を説明",
        "placeholder.imagePrompt" if ko => "생성하거나 편집할 이미지를 설명하세요",
        "placeholder.imagePrompt" => "Describe the image to generate or edit",
        "placeholder.sourceImage" if zh => "源图片",
        "placeholder.sourceImage" if es => "Imagen origen",
        "placeholder.sourceImage" if hi => "स्रोत चित्र",
        "placeholder.sourceImage" if ar => "الصورة المصدر",
        "placeholder.sourceImage" if pt => "Imagem de origem",
        "placeholder.sourceImage" if ru => "Исходное изображение",
        "placeholder.sourceImage" if fr => "Image source",
        "placeholder.sourceImage" if ja => "元画像",
        "placeholder.sourceImage" if ko => "원본 이미지",
        "placeholder.sourceImage" => "Source image",
        "setting.appearance" if zh => "外观",
        "setting.appearance" if es => "Apariencia",
        "setting.appearance" if hi => "दिखावट",
        "setting.appearance" if ar => "المظهر",
        "setting.appearance" if pt => "Aparência",
        "setting.appearance" if ru => "Внешний вид",
        "setting.appearance" if fr => "Apparence",
        "setting.appearance" if ja => "外観",
        "setting.appearance" if ko => "모양",
        "setting.appearance" => "Appearance",
        "setting.data" if zh => "数据",
        "setting.data" if es => "Datos",
        "setting.data" if hi => "डेटा",
        "setting.data" if ar => "البيانات",
        "setting.data" if pt => "Dados",
        "setting.data" if ru => "Данные",
        "setting.data" if fr => "Données",
        "setting.data" if ja => "データ",
        "setting.data" if ko => "데이터",
        "setting.data" => "Data",
        "setting.models" if zh => "模型",
        "setting.models" if es => "Modelos",
        "setting.models" if hi => "मॉडल",
        "setting.models" if ar => "النماذج",
        "setting.models" if pt => "Modelos",
        "setting.models" if ru => "Модели",
        "setting.models" if fr => "Modèles",
        "setting.models" if ja => "モデル",
        "setting.models" if ko => "모델",
        "setting.models" => "Models",
        "setting.providers" if zh => "AI 服务",
        "setting.providers" if es => "Proveedores",
        "setting.providers" if hi => "प्रदाता",
        "setting.providers" if ar => "المزودون",
        "setting.providers" if pt => "Provedores",
        "setting.providers" if ru => "Провайдеры",
        "setting.providers" if fr => "Fournisseurs",
        "setting.providers" if ja => "プロバイダー",
        "setting.providers" if ko => "공급자",
        "setting.providers" => "Providers",
        "setting.skills" if zh => "技能",
        "setting.skills" if es => "Habilidades",
        "setting.skills" if hi => "कौशल",
        "setting.skills" if ar => "المهارات",
        "setting.skills" if pt => "Habilidades",
        "setting.skills" if ru => "Навыки",
        "setting.skills" if fr => "Compétences",
        "setting.skills" if ja => "スキル",
        "setting.skills" if ko => "스킬",
        "setting.skills" => "Skills",
        "setting.sync" if zh => "云同步",
        "setting.sync" if es => "Sincronización en la nube",
        "setting.sync" if hi => "क्लाउड सिंक",
        "setting.sync" if ar => "مزامنة السحابة",
        "setting.sync" if pt => "Sincronização na nuvem",
        "setting.sync" if ru => "Облачная синхронизация",
        "setting.sync" if fr => "Synchronisation cloud",
        "setting.sync" if ja => "クラウド同期",
        "setting.sync" if ko => "클라우드 동기화",
        "setting.sync" => "Cloud sync",
        "settings.changesSaved" if zh => "已保存到本机。开启云同步后会端到端加密同步。",
        "settings.changesSaved" if es => {
            "Guardado en este dispositivo. La sincronización en la nube se cifra de extremo a extremo cuando está activada."
        }
        "settings.changesSaved" if hi => {
            "इस डिवाइस पर सहेजा गया। क्लाउड सिंक चालू होने पर एंड-टू-एंड एन्क्रिप्टेड रहता है।"
        }
        "settings.changesSaved" if ar => {
            "تم الحفظ على هذا الجهاز. تكون مزامنة السحابة مشفرة طرفيا عند تفعيلها."
        }
        "settings.changesSaved" if pt => {
            "Salvo neste dispositivo. A sincronização na nuvem usa criptografia de ponta a ponta quando ativada."
        }
        "settings.changesSaved" if ru => {
            "Сохранено на этом устройстве. Облачная синхронизация использует сквозное шифрование, когда включена."
        }
        "settings.changesSaved" if fr => {
            "Enregistré sur cet appareil. La synchronisation cloud est chiffrée de bout en bout lorsqu'elle est activée."
        }
        "settings.changesSaved" if ja => {
            "この端末に保存しました。クラウド同期を有効にするとエンドツーエンドで暗号化されます。"
        }
        "settings.changesSaved" if ko => {
            "이 기기에 저장되었습니다. 클라우드 동기화를 켜면 종단 간 암호화됩니다."
        }
        "settings.changesSaved" => {
            "Saved on this device. Cloud sync is end-to-end encrypted when enabled."
        }
        "theme.dark" if zh => "深色",
        "theme.dark" if es => "Oscuro",
        "theme.dark" if hi => "गहरा",
        "theme.dark" if ar => "داكن",
        "theme.dark" if pt => "Escuro",
        "theme.dark" if ru => "Темная",
        "theme.dark" if fr => "Sombre",
        "theme.dark" if ja => "ダーク",
        "theme.dark" if ko => "어두움",
        "theme.dark" => "Dark",
        "theme.light" if zh => "浅色",
        "theme.light" if es => "Claro",
        "theme.light" if hi => "हल्का",
        "theme.light" if ar => "فاتح",
        "theme.light" if pt => "Claro",
        "theme.light" if ru => "Светлая",
        "theme.light" if fr => "Clair",
        "theme.light" if ja => "ライト",
        "theme.light" if ko => "밝음",
        "theme.light" => "Light",
        "theme.system" if zh => "跟随系统",
        "theme.system" if es => "Sistema",
        "theme.system" if hi => "सिस्टम",
        "theme.system" if ar => "النظام",
        "theme.system" if pt => "Sistema",
        "theme.system" if ru => "Система",
        "theme.system" if fr => "Système",
        "theme.system" if ja => "システム",
        "theme.system" if ko => "시스템",
        "theme.system" => "System",
        "conversation.searchClear" if zh => "清除搜索",
        "conversation.searchClear" if es => "Borrar búsqueda",
        "conversation.searchClear" if hi => "खोज साफ़ करें",
        "conversation.searchClear" if ar => "مسح البحث",
        "conversation.searchClear" if pt => "Limpar busca",
        "conversation.searchClear" if ru => "Очистить поиск",
        "conversation.searchClear" if fr => "Effacer la recherche",
        "conversation.searchClear" if ja => "検索をクリア",
        "conversation.searchClear" if ko => "검색 지우기",
        "conversation.searchClear" => "Clear search",
        "conversation.searchLabel" if zh => "搜索对话",
        "conversation.searchLabel" if es => "Buscar chats",
        "conversation.searchLabel" if hi => "चैट खोजें",
        "conversation.searchLabel" if ar => "البحث في المحادثات",
        "conversation.searchLabel" if pt => "Buscar conversas",
        "conversation.searchLabel" if ru => "Поиск чатов",
        "conversation.searchLabel" if fr => "Rechercher des conversations",
        "conversation.searchLabel" if ja => "チャットを検索",
        "conversation.searchLabel" if ko => "대화 검색",
        "conversation.searchLabel" => "Search chats",
        "conversation.searchNoResultsBody" if zh => "试试更短的关键词，或清除搜索查看所有对话。",
        "conversation.searchNoResultsBody" if es => {
            "Prueba con una palabra clave más corta o borra la búsqueda para ver todos los chats."
        }
        "conversation.searchNoResultsBody" if hi => {
            "छोटा कीवर्ड आज़माएँ या सभी चैट देखने के लिए खोज साफ़ करें।"
        }
        "conversation.searchNoResultsBody" if ar => {
            "جرّب كلمة أقصر أو امسح البحث لعرض كل المحادثات."
        }
        "conversation.searchNoResultsBody" if pt => {
            "Tente uma palavra-chave mais curta ou limpe a busca para ver todas as conversas."
        }
        "conversation.searchNoResultsBody" if ru => {
            "Попробуйте более короткое слово или очистите поиск, чтобы увидеть все чаты."
        }
        "conversation.searchNoResultsBody" if fr => {
            "Essayez un mot-clé plus court ou effacez la recherche pour voir toutes les conversations."
        }
        "conversation.searchNoResultsBody" if ja => {
            "短いキーワードを試すか、検索をクリアしてすべてのチャットを表示してください。"
        }
        "conversation.searchNoResultsBody" if ko => {
            "더 짧은 키워드를 사용하거나 검색을 지워 모든 대화를 확인하세요."
        }
        "conversation.searchNoResultsBody" => {
            "Try a shorter keyword, or clear search to show every chat."
        }
        "conversation.searchNoResultsTitle" if zh => "没有找到相关会话",
        "conversation.searchNoResultsTitle" if es => "No se encontraron chats",
        "conversation.searchNoResultsTitle" if hi => "मिलती-जुलती चैट नहीं मिली",
        "conversation.searchNoResultsTitle" if ar => "لم يتم العثور على محادثات مطابقة",
        "conversation.searchNoResultsTitle" if pt => "Nenhuma conversa encontrada",
        "conversation.searchNoResultsTitle" if ru => "Подходящих чатов не найдено",
        "conversation.searchNoResultsTitle" if fr => "Aucune conversation trouvée",
        "conversation.searchNoResultsTitle" if ja => "一致するチャットが見つかりません",
        "conversation.searchNoResultsTitle" if ko => "일치하는 대화가 없습니다",
        "conversation.searchNoResultsTitle" => "No matching chats",
        "conversation.searchPlaceholder" if zh => "搜索对话",
        "conversation.searchPlaceholder" if es => "Buscar chats",
        "conversation.searchPlaceholder" if hi => "चैट खोजें",
        "conversation.searchPlaceholder" if ar => "البحث في المحادثات",
        "conversation.searchPlaceholder" if pt => "Buscar conversas",
        "conversation.searchPlaceholder" if ru => "Поиск чатов",
        "conversation.searchPlaceholder" if fr => "Rechercher des conversations",
        "conversation.searchPlaceholder" if ja => "チャットを検索",
        "conversation.searchPlaceholder" if ko => "대화 검색",
        "conversation.searchPlaceholder" => "Search chats",
        "title.newChat" if zh => "新建对话",
        "title.newChat" if es => "Nuevo chat",
        "title.newChat" if hi => "नई चैट",
        "title.newChat" if ar => "محادثة جديدة",
        "title.newChat" if pt => "Nova conversa",
        "title.newChat" if ru => "Новый чат",
        "title.newChat" if fr => "Nouveau chat",
        "title.newChat" if ja => "新規チャット",
        "title.newChat" if ko => "새 채팅",
        "title.newChat" => "New chat",
        "title.imageConversationPrefix" if zh => "图片",
        "title.imageConversationPrefix" if es => "Imagen",
        "title.imageConversationPrefix" if hi => "चित्र",
        "title.imageConversationPrefix" if ar => "صورة",
        "title.imageConversationPrefix" if pt => "Imagem",
        "title.imageConversationPrefix" if ru => "Изображение",
        "title.imageConversationPrefix" if fr => "Image",
        "title.imageConversationPrefix" if ja => "画像",
        "title.imageConversationPrefix" if ko => "이미지",
        "title.imageConversationPrefix" => "Image",
        "title.settings" if zh => "设置",
        "title.settings" if es => "Ajustes",
        "title.settings" if hi => "सेटिंग्स",
        "title.settings" if ar => "الإعدادات",
        "title.settings" if pt => "Configurações",
        "title.settings" if ru => "Настройки",
        "title.settings" if fr => "Réglages",
        "title.settings" if ja => "設定",
        "title.settings" if ko => "설정",
        "title.settings" => "Settings",
        "action.cancel" if zh => "取消",
        "action.cancel" if es => "Cancelar",
        "action.cancel" if hi => "रद्द करें",
        "action.cancel" if ar => "إلغاء",
        "action.cancel" if pt => "Cancelar",
        "action.cancel" if ru => "Отмена",
        "action.cancel" if fr => "Annuler",
        "action.cancel" if ja => "キャンセル",
        "action.cancel" if ko => "취소",
        "action.cancel" => "Cancel",
        "action.delete" if zh => "删除",
        "action.delete" if es => "Eliminar",
        "action.delete" if hi => "हटाएं",
        "action.delete" if ar => "حذف",
        "action.delete" if pt => "Excluir",
        "action.delete" if ru => "Удалить",
        "action.delete" if fr => "Supprimer",
        "action.delete" if ja => "削除",
        "action.delete" if ko => "삭제",
        "action.delete" => "Delete",
        "danger.deleteConversation.title" if zh => "删除对话",
        "danger.deleteConversation.title" if es => "Eliminar chat",
        "danger.deleteConversation.title" if hi => "चैट हटाएं",
        "danger.deleteConversation.title" if ar => "حذف المحادثة",
        "danger.deleteConversation.title" if pt => "Excluir conversa",
        "danger.deleteConversation.title" if ru => "Удалить чат",
        "danger.deleteConversation.title" if fr => "Supprimer la conversation",
        "danger.deleteConversation.title" if ja => "チャットを削除",
        "danger.deleteConversation.title" if ko => "채팅 삭제",
        "danger.deleteConversation.title" => "Delete chat",
        "danger.deleteConversation.body" if zh => {
            "这会从本机删除此对话；开启同步后云端副本也会删除。"
        }
        "danger.deleteConversation.body" if es => {
            "Esto elimina el chat de este dispositivo. La sincronización quitará la copia de la nube cuando esté activa."
        }
        "danger.deleteConversation.body" if hi => {
            "यह चैट इस डिवाइस से हटेगी। सिंक चालू होने पर क्लाउड कॉपी भी हटेगी।"
        }
        "danger.deleteConversation.body" if ar => {
            "سيتم حذف هذه المحادثة من هذا الجهاز. عند تفعيل المزامنة ستُزال النسخة السحابية أيضا."
        }
        "danger.deleteConversation.body" if pt => {
            "Isto exclui a conversa deste dispositivo. A sincronização removerá a cópia na nuvem quando estiver ativa."
        }
        "danger.deleteConversation.body" if ru => {
            "Чат будет удален с этого устройства. При включенной синхронизации облачная копия тоже будет удалена."
        }
        "danger.deleteConversation.body" if fr => {
            "Cette action supprime la conversation de cet appareil. La synchronisation supprimera aussi la copie cloud lorsqu'elle est active."
        }
        "danger.deleteConversation.body" if ja => {
            "この端末からチャットを削除します。同期が有効な場合はクラウドのコピーも削除されます。"
        }
        "danger.deleteConversation.body" if ko => {
            "이 기기에서 채팅을 삭제합니다. 동기화가 켜져 있으면 클라우드 사본도 삭제됩니다."
        }
        "danger.deleteConversation.body" => {
            "This deletes the chat from this device. Sync will remove the cloud copy when enabled."
        }
        "action.downloadImage" if zh => "下载图片",
        "action.downloadImage" if es => "Descargar imagen",
        "action.downloadImage" if hi => "चित्र डाउनलोड करें",
        "action.downloadImage" if ar => "تنزيل الصورة",
        "action.downloadImage" if pt => "Baixar imagem",
        "action.downloadImage" if ru => "Скачать изображение",
        "action.downloadImage" if fr => "Télécharger l'image",
        "action.downloadImage" if ja => "画像をダウンロード",
        "action.downloadImage" if ko => "이미지 다운로드",
        "action.downloadImage" => "Download image",
        "action.openGeneratedImage" if zh => "打开生成图片",
        "action.openGeneratedImage" if es => "Abrir imagen generada",
        "action.openGeneratedImage" if hi => "बनी हुई छवि खोलें",
        "action.openGeneratedImage" if ar => "فتح الصورة المنشأة",
        "action.openGeneratedImage" if pt => "Abrir imagem gerada",
        "action.openGeneratedImage" if ru => "Открыть изображение",
        "action.openGeneratedImage" if fr => "Ouvrir l'image générée",
        "action.openGeneratedImage" if ja => "生成画像を開く",
        "action.openGeneratedImage" if ko => "생성된 이미지 열기",
        "action.openGeneratedImage" => "Open generated image",
        "action.clear" if zh => "清除",
        "action.clear" if es => "Borrar",
        "action.clear" if hi => "साफ करें",
        "action.clear" if ar => "مسح",
        "action.clear" if pt => "Limpar",
        "action.clear" if ru => "Очистить",
        "action.clear" if fr => "Effacer",
        "action.clear" if ja => "クリア",
        "action.clear" if ko => "지우기",
        "action.clear" => "Clear",
        "action.done" if zh => "完成",
        "action.done" if es => "Listo",
        "action.done" if hi => "पूरा",
        "action.done" if ar => "تم",
        "action.done" if pt => "Concluído",
        "action.done" if ru => "Готово",
        "action.done" if fr => "Terminé",
        "action.done" if ja => "完了",
        "action.done" if ko => "완료",
        "action.done" => "Done",
        "action.startCloudSync" if zh => "开启云同步",
        "action.startCloudSync" if es => "Activar sync en la nube",
        "action.startCloudSync" if hi => "क्लाउड सिंक शुरू करें",
        "action.startCloudSync" if ar => "بدء مزامنة السحابة",
        "action.startCloudSync" if pt => "Ativar sync na nuvem",
        "action.startCloudSync" if ru => "Включить облачную синхронизацию",
        "action.startCloudSync" if fr => "Activer la sync cloud",
        "action.startCloudSync" if ja => "クラウド同期を開始",
        "action.startCloudSync" if ko => "클라우드 동기화 시작",
        "action.startCloudSync" => "Start cloud sync",
        "button.copy" if zh => "复制",
        "button.copy" if es => "Copiar",
        "button.copy" if hi => "कॉपी करें",
        "button.copy" if ar => "نسخ",
        "button.copy" if pt => "Copiar",
        "button.copy" if ru => "Копировать",
        "button.copy" if fr => "Copier",
        "button.copy" if ja => "コピー",
        "button.copy" if ko => "복사",
        "button.copy" => "Copy",
        "button.speakMessage" if zh => "朗读",
        "button.speakMessage" if es => "Leer en voz alta",
        "button.speakMessage" if hi => "ज़ोर से पढ़ें",
        "button.speakMessage" if ar => "القراءة بصوت عالٍ",
        "button.speakMessage" if pt => "Ler em voz alta",
        "button.speakMessage" if ru => "Прочитать вслух",
        "button.speakMessage" if fr => "Lire à voix haute",
        "button.speakMessage" if ja => "読み上げ",
        "button.speakMessage" if ko => "소리 내어 읽기",
        "button.speakMessage" => "Read aloud",
        "button.stopSpeaking" if zh => "停止朗读",
        "button.stopSpeaking" if es => "Detener audio",
        "button.stopSpeaking" if hi => "ऑडियो रोकें",
        "button.stopSpeaking" if ar => "إيقاف الصوت",
        "button.stopSpeaking" if pt => "Parar áudio",
        "button.stopSpeaking" if ru => "Остановить аудио",
        "button.stopSpeaking" if fr => "Arrêter l'audio",
        "button.stopSpeaking" if ja => "音声を停止",
        "button.stopSpeaking" if ko => "오디오 중지",
        "button.stopSpeaking" => "Stop audio",
        "button.syncNow" if zh => "立即同步",
        "button.syncNow" if es => "Sincronizar ahora",
        "button.syncNow" if hi => "अभी सिंक करें",
        "button.syncNow" if ar => "مزامنة الآن",
        "button.syncNow" if pt => "Sincronizar agora",
        "button.syncNow" if ru => "Синхронизировать",
        "button.syncNow" if fr => "Synchroniser maintenant",
        "button.syncNow" if ja => "今すぐ同期",
        "button.syncNow" if ko => "지금 동기화",
        "button.syncNow" => "Sync now",
        "action.editResend" if zh => "编辑并重发",
        "action.editResend" if es => "Editar y reenviar",
        "action.editResend" if hi => "संपादित कर फिर भेजें",
        "action.editResend" if ar => "تحرير وإعادة إرسال",
        "action.editResend" if pt => "Editar e reenviar",
        "action.editResend" if ru => "Изменить и отправить снова",
        "action.editResend" if fr => "Modifier et renvoyer",
        "action.editResend" if ja => "編集して再送信",
        "action.editResend" if ko => "수정 후 다시 보내기",
        "action.editResend" => "Edit and resend",
        "action.regenerate" if zh => "重新生成",
        "action.regenerate" if es => "Regenerar",
        "action.regenerate" if hi => "फिर से बनाएं",
        "action.regenerate" if ar => "إعادة الإنشاء",
        "action.regenerate" if pt => "Gerar novamente",
        "action.regenerate" if ru => "Создать заново",
        "action.regenerate" if fr => "Régénérer",
        "action.regenerate" if ja => "再生成",
        "action.regenerate" if ko => "다시 생성",
        "action.regenerate" => "Regenerate",
        "button.retry" if zh => "重试",
        "button.retry" if es => "Reintentar",
        "button.retry" if hi => "फिर कोशिश करें",
        "button.retry" if ar => "إعادة المحاولة",
        "button.retry" if pt => "Tentar novamente",
        "button.retry" if ru => "Повторить",
        "button.retry" if fr => "Réessayer",
        "button.retry" if ja => "再試行",
        "button.retry" if ko => "다시 시도",
        "button.retry" => "Retry",
        "action.stopGenerating" if zh => "停止",
        "action.stopGenerating" if es => "Detener",
        "action.stopGenerating" if hi => "रोकें",
        "action.stopGenerating" if ar => "إيقاف",
        "action.stopGenerating" if pt => "Parar",
        "action.stopGenerating" if ru => "Остановить",
        "action.stopGenerating" if fr => "Arrêter",
        "action.stopGenerating" if ja => "停止",
        "action.stopGenerating" if ko => "중지",
        "action.stopGenerating" => "Stop",
        "action.clearCloudData" if zh => "清空云端数据",
        "action.clearCloudData" if es => "Borrar datos de la nube",
        "action.clearCloudData" if hi => "क्लाउड डेटा साफ़ करें",
        "action.clearCloudData" if ar => "مسح بيانات السحابة",
        "action.clearCloudData" if pt => "Limpar dados na nuvem",
        "action.clearCloudData" if ru => "Очистить облачные данные",
        "action.clearCloudData" if fr => "Effacer les données cloud",
        "action.clearCloudData" if ja => "クラウドデータを消去",
        "action.clearCloudData" if ko => "클라우드 데이터 지우기",
        "action.clearCloudData" => "Clear cloud data",
        "action.iUnderstand" if zh => "我已了解",
        "action.iUnderstand" if es => "Lo entiendo",
        "action.iUnderstand" if hi => "मैं समझता हूं",
        "action.iUnderstand" if ar => "أفهم ذلك",
        "action.iUnderstand" if pt => "Eu entendo",
        "action.iUnderstand" if ru => "Понимаю",
        "action.iUnderstand" if fr => "Je comprends",
        "action.iUnderstand" if ja => "理解しました",
        "action.iUnderstand" if ko => "이해했습니다",
        "action.iUnderstand" => "I understand",
        "action.exportEncryptedBackup" if zh => "导出加密备份",
        "action.exportEncryptedBackup" if es => "Exportar copia cifrada",
        "action.exportEncryptedBackup" if hi => "एन्क्रिप्टेड बैकअप निर्यात करें",
        "action.exportEncryptedBackup" if ar => "تصدير نسخة مشفرة",
        "action.exportEncryptedBackup" if pt => "Exportar backup criptografado",
        "action.exportEncryptedBackup" if ru => "Экспорт зашифрованной копии",
        "action.exportEncryptedBackup" if fr => "Exporter une sauvegarde chiffrée",
        "action.exportEncryptedBackup" if ja => "暗号化バックアップを書き出す",
        "action.exportEncryptedBackup" if ko => "암호화 백업 내보내기",
        "action.exportEncryptedBackup" => "Export encrypted backup",
        "action.importEncryptedBackup" if zh => "导入加密备份",
        "action.importEncryptedBackup" if es => "Importar copia cifrada",
        "action.importEncryptedBackup" if hi => "एन्क्रिप्टेड बैकअप आयात करें",
        "action.importEncryptedBackup" if ar => "استيراد نسخة مشفرة",
        "action.importEncryptedBackup" if pt => "Importar backup criptografado",
        "action.importEncryptedBackup" if ru => "Импорт зашифрованной копии",
        "action.importEncryptedBackup" if fr => "Importer une sauvegarde chiffrée",
        "action.importEncryptedBackup" if ja => "暗号化バックアップを読み込む",
        "action.importEncryptedBackup" if ko => "암호화 백업 가져오기",
        "action.importEncryptedBackup" => "Import encrypted backup",
        "action.resetLocalData" if zh => "重置本机数据",
        "action.resetLocalData" if es => "Restablecer datos locales",
        "action.resetLocalData" if hi => "स्थानीय डेटा रीसेट करें",
        "action.resetLocalData" if ar => "إعادة تعيين البيانات المحلية",
        "action.resetLocalData" if pt => "Redefinir dados locais",
        "action.resetLocalData" if ru => "Сбросить локальные данные",
        "action.resetLocalData" if fr => "Réinitialiser les données locales",
        "action.resetLocalData" if ja => "ローカルデータをリセット",
        "action.resetLocalData" if ko => "로컬 데이터 초기화",
        "action.resetLocalData" => "Reset local data",
        "action.resetSyncPassword" if zh => "重置同步密码",
        "action.resetSyncPassword" if es => "Restablecer contraseña de sincronización",
        "action.resetSyncPassword" if hi => "सिंक पासवर्ड रीसेट करें",
        "action.resetSyncPassword" if ar => "إعادة تعيين كلمة مرور المزامنة",
        "action.resetSyncPassword" if pt => "Redefinir senha de sincronização",
        "action.resetSyncPassword" if ru => "Сбросить пароль синхронизации",
        "action.resetSyncPassword" if fr => "Réinitialiser le mot de passe de synchronisation",
        "action.resetSyncPassword" if ja => "同期パスワードをリセット",
        "action.resetSyncPassword" if ko => "동기화 비밀번호 초기화",
        "action.resetSyncPassword" => "Reset sync password",
        "action.changeSyncPassword" if zh => "修改同步密码",
        "action.changeSyncPassword" if es => "Cambiar contraseña de sincronización",
        "action.changeSyncPassword" if hi => "सिंक पासवर्ड बदलें",
        "action.changeSyncPassword" if ar => "تغيير كلمة مرور المزامنة",
        "action.changeSyncPassword" if pt => "Alterar senha de sync",
        "action.changeSyncPassword" if ru => "Изменить пароль синхронизации",
        "action.changeSyncPassword" if fr => "Changer le mot de passe de sync",
        "action.changeSyncPassword" if ja => "同期パスワードを変更",
        "action.changeSyncPassword" if ko => "동기화 비밀번호 변경",
        "action.changeSyncPassword" => "Change sync password",
        "action.saveSyncPassword" if zh => "保存同步密码",
        "action.saveSyncPassword" if es => "Guardar contraseña de sincronización",
        "action.saveSyncPassword" if hi => "सिंक पासवर्ड सहेजें",
        "action.saveSyncPassword" if ar => "حفظ كلمة مرور المزامنة",
        "action.saveSyncPassword" if pt => "Salvar senha de sync",
        "action.saveSyncPassword" if ru => "Сохранить пароль синхронизации",
        "action.saveSyncPassword" if fr => "Enregistrer le mot de passe de sync",
        "action.saveSyncPassword" if ja => "同期パスワードを保存",
        "action.saveSyncPassword" if ko => "동기화 비밀번호 저장",
        "action.saveSyncPassword" => "Save sync password",
        "button.save" if zh => "保存",
        "button.save" if es => "Guardar",
        "button.save" if hi => "सहेजें",
        "button.save" if ar => "حفظ",
        "button.save" if pt => "Salvar",
        "button.save" if ru => "Сохранить",
        "button.save" if fr => "Enregistrer",
        "button.save" if ja => "保存",
        "button.save" if ko => "저장",
        "button.save" => "Save",
        "button.saveProviderKey" if zh => "保存 Key",
        "button.saveProviderKey" if es => "Guardar clave",
        "button.saveProviderKey" if hi => "कुंजी सहेजें",
        "button.saveProviderKey" if ar => "حفظ المفتاح",
        "button.saveProviderKey" if pt => "Salvar chave",
        "button.saveProviderKey" if ru => "Сохранить ключ",
        "button.saveProviderKey" if fr => "Enregistrer la clé",
        "button.saveProviderKey" if ja => "キーを保存",
        "button.saveProviderKey" if ko => "키 저장",
        "button.saveProviderKey" => "Save key",
        "button.clearProviderKey" if zh => "清除 Key",
        "button.clearProviderKey" if es => "Borrar clave",
        "button.clearProviderKey" if hi => "कुंजी हटाएं",
        "button.clearProviderKey" if ar => "مسح المفتاح",
        "button.clearProviderKey" if pt => "Limpar chave",
        "button.clearProviderKey" if ru => "Очистить ключ",
        "button.clearProviderKey" if fr => "Effacer la clé",
        "button.clearProviderKey" if ja => "キーを消去",
        "button.clearProviderKey" if ko => "키 지우기",
        "button.clearProviderKey" => "Clear key",
        "button.mergeData" if zh => "合并数据",
        "button.mergeData" if es => "Fusionar datos",
        "button.mergeData" if hi => "डेटा मिलाएँ",
        "button.mergeData" if ar => "دمج البيانات",
        "button.mergeData" if pt => "Mesclar dados",
        "button.mergeData" if ru => "Объединить данные",
        "button.mergeData" if fr => "Fusionner les données",
        "button.mergeData" if ja => "データを結合",
        "button.mergeData" if ko => "데이터 병합",
        "button.mergeData" => "Merge data",
        "button.useCloudData" if zh => "使用云端数据",
        "button.useCloudData" if es => "Usar datos de la nube",
        "button.useCloudData" if hi => "क्लाउड डेटा उपयोग करें",
        "button.useCloudData" if ar => "استخدام بيانات السحابة",
        "button.useCloudData" if pt => "Usar dados da nuvem",
        "button.useCloudData" if ru => "Использовать облачные данные",
        "button.useCloudData" if fr => "Utiliser les données cloud",
        "button.useCloudData" if ja => "クラウドデータを使用",
        "button.useCloudData" if ko => "클라우드 데이터 사용",
        "button.useCloudData" => "Use cloud data",
        "button.uploadThisDevice" if zh => "上传本机数据",
        "button.uploadThisDevice" if es => "Subir este dispositivo",
        "button.uploadThisDevice" if hi => "इस डिवाइस को अपलोड करें",
        "button.uploadThisDevice" if ar => "رفع هذا الجهاز",
        "button.uploadThisDevice" if pt => "Enviar este dispositivo",
        "button.uploadThisDevice" if ru => "Загрузить это устройство",
        "button.uploadThisDevice" if fr => "Envoyer cet appareil",
        "button.uploadThisDevice" if ja => "このデバイスをアップロード",
        "button.uploadThisDevice" if ko => "이 기기 업로드",
        "button.uploadThisDevice" => "Upload this device",
        "button.addProvider" if zh => "添加服务商",
        "button.addProvider" if es => "Añadir proveedor...",
        "button.addProvider" if hi => "प्रदाता जोड़ें",
        "button.addProvider" if ar => "إضافة مزود...",
        "button.addProvider" if pt => "Adicionar provedor...",
        "button.addProvider" if ru => "Добавить провайдера...",
        "button.addProvider" if fr => "Ajouter un fournisseur...",
        "button.addProvider" if ja => "プロバイダーを追加",
        "button.addProvider" if ko => "공급자 추가",
        "button.addProvider" => "Add AI provider",
        "button.deleteProvider" if zh => "删除服务商",
        "button.deleteProvider" if es => "Eliminar proveedor",
        "button.deleteProvider" if hi => "प्रदाता हटाएं",
        "button.deleteProvider" if ar => "حذف المزود",
        "button.deleteProvider" if pt => "Excluir provedor",
        "button.deleteProvider" if ru => "Удалить провайдера",
        "button.deleteProvider" if fr => "Supprimer le fournisseur",
        "button.deleteProvider" if ja => "プロバイダーを削除",
        "button.deleteProvider" if ko => "공급자 삭제",
        "button.deleteProvider" => "Delete provider",
        "button.checkConnectivity" if zh => "检查连接",
        "button.checkConnectivity" if es => "Comprobar conexión",
        "button.checkConnectivity" if hi => "कनेक्शन की जाँच करें",
        "button.checkConnectivity" if ar => "التحقق من الاتصال",
        "button.checkConnectivity" if pt => "Verifique a conexão",
        "button.checkConnectivity" if ru => "Проверка подключения",
        "button.checkConnectivity" if fr => "Vérifier la connexion",
        "button.checkConnectivity" if ja => "接続を確認します",
        "button.checkConnectivity" if ko => "연결 확인",
        "button.checkConnectivity" => "Check connection",
        "button.checking" if zh => "正在检查",
        "button.checking" if es => "Comprobando",
        "button.checking" if hi => "जाँच हो रही है",
        "button.checking" if ar => "جارٍ التحقق من",
        "button.checking" if pt => "Verificando",
        "button.checking" if ru => "Проверка",
        "button.checking" if fr => "Vérification",
        "button.checking" if ja => "確認中",
        "button.checking" if ko => "확인 중",
        "button.checking" => "Checking",
        "button.fetchModels" if zh => "从服务商获取模型",
        "button.fetchModels" if es => "Obtener modelos del proveedor",
        "button.fetchModels" if hi => "प्रदाता से मॉडल लाएं",
        "button.fetchModels" if ar => "جلب النماذج من المزود",
        "button.fetchModels" if pt => "Buscar modelos do provedor",
        "button.fetchModels" if ru => "Получить модели у провайдера",
        "button.fetchModels" if fr => "Récupérer les modèles du fournisseur",
        "button.fetchModels" if ja => "プロバイダーからモデルを取得",
        "button.fetchModels" if ko => "공급자에서 모델 가져오기",
        "button.fetchModels" => "Fetch models from provider",
        "button.fetching" if zh => "正在获取",
        "button.fetching" if es => "Obteniendo",
        "button.fetching" if hi => "ला रहा है",
        "button.fetching" if ar => "جار الجلب",
        "button.fetching" if pt => "Buscando",
        "button.fetching" if ru => "Загрузка",
        "button.fetching" if fr => "Récupération",
        "button.fetching" if ja => "取得中",
        "button.fetching" if ko => "가져오는 중",
        "button.fetching" => "Fetching",
        "button.addSkill" if zh => "添加技能",
        "button.addSkill" if es => "Añadir habilidad",
        "button.addSkill" if hi => "कौशल जोड़ें",
        "button.addSkill" if ar => "إضافة مهارة",
        "button.addSkill" if pt => "Adicionar habilidade",
        "button.addSkill" if ru => "Добавить навык",
        "button.addSkill" if fr => "Ajouter une compétence",
        "button.addSkill" if ja => "スキルを追加",
        "button.addSkill" if ko => "스킬 추가",
        "button.addSkill" => "Add skill",
        "button.deleteSkill" if zh => "删除技能",
        "button.deleteSkill" if es => "Eliminar habilidad",
        "button.deleteSkill" if hi => "कौशल हटाएं",
        "button.deleteSkill" if ar => "حذف مهارة",
        "button.deleteSkill" if pt => "Excluir habilidade",
        "button.deleteSkill" if ru => "Удалить навык",
        "button.deleteSkill" if fr => "Supprimer la compétence",
        "button.deleteSkill" if ja => "スキルを削除",
        "button.deleteSkill" if ko => "스킬 삭제",
        "button.deleteSkill" => "Delete skill",
        "button.importSkill" if zh => "导入技能",
        "button.importSkill" if es => "Importar habilidad",
        "button.importSkill" if hi => "कौशल आयात करें",
        "button.importSkill" if ar => "استيراد مهارة",
        "button.importSkill" if pt => "Importar habilidade",
        "button.importSkill" if ru => "Импортировать навык",
        "button.importSkill" if fr => "Importer une compétence",
        "button.importSkill" if ja => "スキルをインポート",
        "button.importSkill" if ko => "스킬 가져오기",
        "button.importSkill" => "Import skill",
        "button.showMoreSkills" if zh => "显示更多技能",
        "button.showMoreSkills" if es => "Mostrar más habilidades",
        "button.showMoreSkills" if hi => "और कौशल दिखाएं",
        "button.showMoreSkills" if ar => "إظهار المزيد من المهارات",
        "button.showMoreSkills" if pt => "Mostrar mais habilidades",
        "button.showMoreSkills" if ru => "Показать еще навыки",
        "button.showMoreSkills" if fr => "Afficher plus de compétences",
        "button.showMoreSkills" if ja => "スキルをさらに表示",
        "button.showMoreSkills" if ko => "스킬 더 보기",
        "button.showMoreSkills" => "Show more skills",
        "fallback.skillHeading" if zh => "概览",
        "fallback.skillHeading" if es => "Resumen",
        "fallback.skillHeading" if hi => "सारांश",
        "fallback.skillHeading" if ar => "نظرة عامة",
        "fallback.skillHeading" if pt => "Visão geral",
        "fallback.skillHeading" if ru => "Обзор",
        "fallback.skillHeading" if fr => "Aperçu",
        "fallback.skillHeading" if ja => "概要",
        "fallback.skillHeading" if ko => "개요",
        "fallback.skillHeading" => "Overview",
        "fallback.skillName" if zh => "技能",
        "fallback.skillName" if es => "Habilidad",
        "fallback.skillName" if hi => "कौशल",
        "fallback.skillName" if ar => "مهارة",
        "fallback.skillName" if pt => "Habilidade",
        "fallback.skillName" if ru => "Навык",
        "fallback.skillName" if fr => "Compétence",
        "fallback.skillName" if ja => "スキル",
        "fallback.skillName" if ko => "스킬",
        "fallback.skillName" => "Skill",
        "notice.modelsFetchFailed" if zh => "获取模型失败：{message}",
        "notice.modelsFetchFailed" if es => "No se pudieron recuperar los modelos: {message}",
        "notice.modelsFetchFailed" if hi => "मॉडल नहीं लाये जा सके: {message}",
        "notice.modelsFetchFailed" if ar => "تعذر جلب النماذج: {message}",
        "notice.modelsFetchFailed" if pt => "Não foi possível buscar modelos: {message}",
        "notice.modelsFetchFailed" if ru => "Не удалось получить модели: {message}",
        "notice.modelsFetchFailed" if fr => "Impossible de récupérer les modèles: {message}",
        "notice.modelsFetchFailed" if ja => "モデルをフェッチできませんでした: {message}",
        "notice.modelsFetchFailed" if ko => "모델을 가져올 수 없습니다: {message}",
        "notice.modelsFetchFailed" => "Could not fetch models: {message}",
        "notice.modelsFetched" if zh => "已获取 {count} 个模型",
        "notice.modelsFetched" if es => "Se obtuvieron {count} modelos",
        "notice.modelsFetched" if hi => "{count} मॉडल मिले",
        "notice.modelsFetched" if ar => "تم جلب {count} نموذج",
        "notice.modelsFetched" if pt => "{count} modelos encontrados",
        "notice.modelsFetched" if ru => "Получены модели {count}",
        "notice.modelsFetched" if fr => "Modèles {count} récupérés",
        "notice.modelsFetched" if ja => "{count} モデルをフェッチしました",
        "notice.modelsFetched" if ko => "가져온 {count} 모델",
        "notice.modelsFetched" => "Fetched {count} models",
        "notice.providerConnectivityFailed" if zh => "连接检查失败：{message}",
        "notice.providerConnectivityFailed" if es => {
            "Error en la comprobación de la conexión: {message}"
        }
        "notice.providerConnectivityFailed" if hi => "कनेक्शन जांच विफल: {message}",
        "notice.providerConnectivityFailed" if ar => "فشل فحص الاتصال: {message}",
        "notice.providerConnectivityFailed" if pt => "Falha na verificação de conexão: {message}",
        "notice.providerConnectivityFailed" if ru => "Проверка соединения не удалась: {message}",
        "notice.providerConnectivityFailed" if fr => {
            "Échec de la vérification de la connexion: {message}"
        }
        "notice.providerConnectivityFailed" if ja => "接続チェックに失敗しました: {message}",
        "notice.providerConnectivityFailed" if ko => "연결 확인 실패: {message}",
        "notice.providerConnectivityFailed" => "Connection check failed: {message}",
        "notice.providerConnectivityPassed" if zh => "连接正常，已读取 {count} 个模型",
        "notice.providerConnectivityPassed" if es => {
            "La conexión funciona. Se leyeron {count} modelos."
        }
        "notice.providerConnectivityPassed" if hi => "कनेक्शन ठीक है. {count} मॉडल मिले.",
        "notice.providerConnectivityPassed" if ar => "الاتصال يعمل. تم قراءة {count} نموذج.",
        "notice.providerConnectivityPassed" if pt => {
            "A conexão funciona. {count} modelos foram lidos."
        }
        "notice.providerConnectivityPassed" if ru => {
            "Соединение работает. Получено моделей: {count}."
        }
        "notice.providerConnectivityPassed" if fr => "Connexion validée. {count} modèles lus.",
        "notice.providerConnectivityPassed" if ja => {
            "接続できました。{count} 件のモデルを読み取りました。"
        }
        "notice.providerConnectivityPassed" if ko => "연결되었습니다. 모델 {count}개를 읽었습니다.",
        "notice.providerConnectivityPassed" => "Connection is working. Read {count} models.",
        "notice.providerDeleted" if zh => "服务商已在本机删除。开启同步后也会删除云端副本。",
        "notice.providerDeleted" if es => {
            "Proveedor eliminado en este dispositivo. La sincronización quitará la copia de la nube cuando esté activa."
        }
        "notice.providerDeleted" if hi => {
            "प्रदाता इस डिवाइस से हटाया गया। सिंक चालू होने पर क्लाउड कॉपी भी हटेगी।"
        }
        "notice.providerDeleted" if ar => {
            "تم حذف الموفر من هذا الجهاز. عند تفعيل المزامنة ستُزال النسخة السحابية أيضا."
        }
        "notice.providerDeleted" if pt => {
            "Provedor excluído neste dispositivo. A sincronização removerá a cópia na nuvem quando estiver ativa."
        }
        "notice.providerDeleted" if ru => {
            "Провайдер удален на этом устройстве. При включенной синхронизации облачная копия тоже будет удалена."
        }
        "notice.providerDeleted" if fr => {
            "Fournisseur supprimé sur cet appareil. La synchronisation supprimera aussi la copie cloud lorsqu'elle est active."
        }
        "notice.providerDeleted" if ja => {
            "この端末からプロバイダーを削除しました。同期が有効な場合はクラウドのコピーも削除されます。"
        }
        "notice.providerDeleted" if ko => {
            "이 기기에서 공급자를 삭제했습니다. 동기화가 켜져 있으면 클라우드 사본도 삭제됩니다."
        }
        "notice.providerDeleted" => {
            "Provider deleted on this device. Sync will remove the cloud copy when enabled."
        }
        "notice.providerMinimum" if zh => "至少保留一个服务商",
        "notice.providerMinimum" if es => "Mantén al menos un proveedor",
        "notice.providerMinimum" if hi => "कम से कम एक प्रदाता रखें",
        "notice.providerMinimum" if ar => "احتفظ بموفر واحد على الأقل",
        "notice.providerMinimum" if pt => "Mantenha pelo menos um provedor",
        "notice.providerMinimum" if ru => "Сохраните хотя бы одного поставщика",
        "notice.providerMinimum" if fr => "Conservez au moins un fournisseur",
        "notice.providerMinimum" if ja => "少なくとも 1 つのプロバイダー",
        "notice.providerMinimum" if ko => "하나 이상의 공급자",
        "notice.providerMinimum" => "Keep at least one provider",
        "notice.skillAdded" if zh => "技能已添加",
        "notice.skillAdded" if es => "Habilidad añadida",
        "notice.skillAdded" if hi => "कौशल जोड़ा गया",
        "notice.skillAdded" if ar => "تمت إضافة المهارة",
        "notice.skillAdded" if pt => "Habilidade adicionada",
        "notice.skillAdded" if ru => "Навык добавлен",
        "notice.skillAdded" if fr => "Compétence ajoutée",
        "notice.skillAdded" if ja => "スキルを追加しました",
        "notice.skillAdded" if ko => "스킬이 추가되었습니다",
        "notice.skillAdded" => "Skill added",
        "notice.skillSaved" if zh => "技能已保存",
        "notice.skillSaved" if es => "Habilidad guardada",
        "notice.skillSaved" if hi => "कौशल सहेजा गया",
        "notice.skillSaved" if ar => "تم حفظ المهارة",
        "notice.skillSaved" if pt => "Habilidade salva",
        "notice.skillSaved" if ru => "Навык сохранен",
        "notice.skillSaved" if fr => "Compétence enregistrée",
        "notice.skillSaved" if ja => "スキルを保存しました",
        "notice.skillSaved" if ko => "스킬이 저장되었습니다",
        "notice.skillSaved" => "Skill saved",
        "notice.skillContentRequired" if zh => "请填写技能内容",
        "notice.skillContentRequired" if es => "Introduce el contenido de la habilidad",
        "notice.skillContentRequired" if hi => "कौशल सामग्री दर्ज करें",
        "notice.skillContentRequired" if ar => "أدخل محتوى المهارة",
        "notice.skillContentRequired" if pt => "Informe o conteúdo da habilidade",
        "notice.skillContentRequired" if ru => "Введите содержимое навыка",
        "notice.skillContentRequired" if fr => "Saisissez le contenu de la compétence",
        "notice.skillContentRequired" if ja => "スキル内容を入力してください",
        "notice.skillContentRequired" if ko => "스킬 내용을 입력하세요",
        "notice.skillContentRequired" => "Enter skill content",
        "notice.skillDeleted" if zh => "技能已删除",
        "notice.skillDeleted" if es => "Habilidad eliminada",
        "notice.skillDeleted" if hi => "कौशल हटाया गया",
        "notice.skillDeleted" if ar => "تم حذف المهارة",
        "notice.skillDeleted" if pt => "Habilidade excluída",
        "notice.skillDeleted" if ru => "Навык удален",
        "notice.skillDeleted" if fr => "Compétence supprimée",
        "notice.skillDeleted" if ja => "スキルを削除しました",
        "notice.skillDeleted" if ko => "스킬이 삭제되었습니다",
        "notice.skillDeleted" => "Skill deleted",
        "notice.skillImportFailed" if zh => "技能导入失败：{message}",
        "notice.skillImportFailed" if es => "Error al importar habilidad: {message}",
        "notice.skillImportFailed" if hi => "कौशल आयात विफल: {message}",
        "notice.skillImportFailed" if ar => "فشل استيراد المهارة: {message}",
        "notice.skillImportFailed" if pt => "Falha ao importar habilidade: {message}",
        "notice.skillImportFailed" if ru => "Не удалось импортировать навык: {message}",
        "notice.skillImportFailed" if fr => "Échec de l'import de compétence: {message}",
        "notice.skillImportFailed" if ja => "スキルのインポートに失敗しました: {message}",
        "notice.skillImportFailed" if ko => "스킬 가져오기 실패: {message}",
        "notice.skillImportFailed" => "Skill import failed: {message}",
        "danger.changeSyncPassword.body" if zh => "之后的云同步会使用新密码。",
        "danger.changeSyncPassword.body" if es => {
            "La sincronización futura usará la nueva contraseña."
        }
        "danger.changeSyncPassword.body" if hi => "आगे की क्लाउड सिंक नया पासवर्ड इस्तेमाल करेगी।",
        "danger.changeSyncPassword.body" if ar => {
            "ستستخدم المزامنة السحابية لاحقا كلمة المرور الجديدة."
        }
        "danger.changeSyncPassword.body" if pt => "A sincronização futura usará a nova senha.",
        "danger.changeSyncPassword.body" if ru => {
            "Будущая облачная синхронизация будет использовать новый пароль."
        }
        "danger.changeSyncPassword.body" if fr => {
            "La prochaine synchronisation cloud utilisera le nouveau mot de passe."
        }
        "danger.changeSyncPassword.body" if ja => {
            "今後のクラウド同期は新しいパスワードを使います。"
        }
        "danger.changeSyncPassword.body" if ko => {
            "향후 클라우드 동기화는 새 비밀번호를 사용합니다."
        }
        "danger.changeSyncPassword.body" => "Future cloud sync uses the new password.",
        "danger.changeSyncPassword.detail1" if zh => {
            "旧密码加密的云端数据和旧备份，不能用新密码解开。"
        }
        "danger.changeSyncPassword.detail1" if es => {
            "Los datos de la nube y las copias cifradas con la contraseña anterior no se pueden abrir con la nueva."
        }
        "danger.changeSyncPassword.detail1" if hi => {
            "पुराने पासवर्ड से एन्क्रिप्ट क्लाउड डेटा और बैकअप नई पासवर्ड से नहीं खुलेंगे।"
        }
        "danger.changeSyncPassword.detail1" if ar => {
            "لا يمكن فتح بيانات السحابة والنسخ الاحتياطية المشفرة بكلمة المرور القديمة باستخدام الجديدة."
        }
        "danger.changeSyncPassword.detail1" if pt => {
            "Dados da nuvem e backups criptografados com a senha antiga não abrem com a nova."
        }
        "danger.changeSyncPassword.detail1" if ru => {
            "Облачные данные и резервные копии, зашифрованные старым паролем, не откроются новым."
        }
        "danger.changeSyncPassword.detail1" if fr => {
            "Les données cloud et sauvegardes chiffrées avec l'ancien mot de passe ne s'ouvrent pas avec le nouveau."
        }
        "danger.changeSyncPassword.detail1" if ja => {
            "古いパスワードで暗号化されたクラウドデータやバックアップは、新しいパスワードでは開けません。"
        }
        "danger.changeSyncPassword.detail1" if ko => {
            "이전 비밀번호로 암호화된 클라우드 데이터와 백업은 새 비밀번호로 열 수 없습니다."
        }
        "danger.changeSyncPassword.detail1" => {
            "Cloud data and backups encrypted with the old password cannot be opened with the new password."
        }
        "danger.changeSyncPassword.detail2" if zh => {
            "其他设备需要输入新密码；Cloudflare 还需要同步更新 Worker 的 ZEROCHAT_ACCESS_KEY。"
        }
        "danger.changeSyncPassword.detail2" if es => {
            "Otros dispositivos deben usar la nueva contraseña; en Cloudflare también hay que actualizar ZEROCHAT_ACCESS_KEY del Worker."
        }
        "danger.changeSyncPassword.detail2" if hi => {
            "दूसरे डिवाइस को नया पासवर्ड चाहिए; Cloudflare में Worker ZEROCHAT_ACCESS_KEY भी अपडेट करें।"
        }
        "danger.changeSyncPassword.detail2" if ar => {
            "يجب أن تستخدم الأجهزة الأخرى كلمة المرور الجديدة؛ وفي Cloudflare يجب تحديث ZEROCHAT_ACCESS_KEY في Worker."
        }
        "danger.changeSyncPassword.detail2" if pt => {
            "Outros dispositivos devem usar a nova senha; no Cloudflare também é preciso atualizar o ZEROCHAT_ACCESS_KEY do Worker."
        }
        "danger.changeSyncPassword.detail2" if ru => {
            "Другим устройствам нужен новый пароль; в Cloudflare также нужно обновить ZEROCHAT_ACCESS_KEY Worker."
        }
        "danger.changeSyncPassword.detail2" if fr => {
            "Les autres appareils doivent utiliser le nouveau mot de passe; Cloudflare nécessite aussi la mise à jour de ZEROCHAT_ACCESS_KEY du Worker."
        }
        "danger.changeSyncPassword.detail2" if ja => {
            "他の端末も新しいパスワードが必要です。Cloudflare では Worker の ZEROCHAT_ACCESS_KEY も更新してください。"
        }
        "danger.changeSyncPassword.detail2" if ko => {
            "다른 장치도 새 비밀번호가 필요합니다. Cloudflare에서는 Worker의 ZEROCHAT_ACCESS_KEY도 업데이트해야 합니다."
        }
        "danger.changeSyncPassword.detail2" => {
            "Other devices must use the new password; Cloudflare also needs the Worker ZEROCHAT_ACCESS_KEY updated."
        }
        "danger.changeSyncPassword.detail3" if zh => "建议先导出一份当前加密备份，再确认修改。",
        "danger.changeSyncPassword.detail3" if es => {
            "Exporta una copia cifrada de los datos actuales antes de cambiarla."
        }
        "danger.changeSyncPassword.detail3" if hi => {
            "बदलने से पहले वर्तमान डेटा का एन्क्रिप्टेड बैकअप निर्यात करें।"
        }
        "danger.changeSyncPassword.detail3" if ar => {
            "صدّر نسخة احتياطية مشفرة من البيانات الحالية قبل التغيير."
        }
        "danger.changeSyncPassword.detail3" if pt => {
            "Exporte um backup criptografado dos dados atuais antes de alterar."
        }
        "danger.changeSyncPassword.detail3" if ru => {
            "Перед изменением экспортируйте зашифрованную резервную копию текущих данных."
        }
        "danger.changeSyncPassword.detail3" if fr => {
            "Exportez une sauvegarde chiffrée des données actuelles avant de le changer."
        }
        "danger.changeSyncPassword.detail3" if ja => {
            "変更前に現在のデータの暗号化バックアップをエクスポートしてください。"
        }
        "danger.changeSyncPassword.detail3" if ko => {
            "변경하기 전에 현재 데이터의 암호화 백업을 내보내세요."
        }
        "danger.changeSyncPassword.detail3" => {
            "Export an encrypted backup of the current data before changing it."
        }
        "danger.changeSyncPassword.title" if zh => "修改同步密码",
        "danger.changeSyncPassword.title" if es => "Cambiar contraseña de sincronización",
        "danger.changeSyncPassword.title" if hi => "सिंक पासवर्ड बदलें",
        "danger.changeSyncPassword.title" if ar => "تغيير كلمة مرور المزامنة",
        "danger.changeSyncPassword.title" if pt => "Alterar senha de sincronização",
        "danger.changeSyncPassword.title" if ru => "Изменить пароль синхронизации",
        "danger.changeSyncPassword.title" if fr => "Changer le mot de passe de synchronisation",
        "danger.changeSyncPassword.title" if ja => "同期パスワードを変更",
        "danger.changeSyncPassword.title" if ko => "동기화 비밀번호 변경",
        "danger.changeSyncPassword.title" => "Change sync password",
        "danger.clearCloudData.title" if zh => "清空云端数据",
        "danger.clearCloudData.title" if es => "Borrar datos de la nube",
        "danger.clearCloudData.title" if hi => "क्लाउड डेटा साफ़ करें",
        "danger.clearCloudData.title" if ar => "مسح بيانات السحابة",
        "danger.clearCloudData.title" if pt => "Limpar dados na nuvem",
        "danger.clearCloudData.title" if ru => "Очистить облачные данные",
        "danger.clearCloudData.title" if fr => "Effacer les données cloud",
        "danger.clearCloudData.title" if ja => "クラウドデータを消去",
        "danger.clearCloudData.title" if ko => "클라우드 데이터 지우기",
        "danger.clearCloudData.title" => "Clear cloud data",
        "danger.clearCloudData.body" if zh => {
            "这会清空当前同步方式在云端保存的 ZeroChat 加密数据。"
        }
        "danger.clearCloudData.body" if es => {
            "Esto borra los datos ZeroChat cifrados almacenados en el destino de sincronización de la nube actual."
        }
        "danger.clearCloudData.body" if hi => {
            "यह वर्तमान क्लाउड सिंक लक्ष्य में संग्रहीत एन्क्रिप्टेड ZeroChat डेटा साफ़ करता है।"
        }
        "danger.clearCloudData.body" if ar => {
            "يؤدي هذا إلى مسح بيانات ZeroChat المشفرة المخزنة في هدف مزامنة السحابة الحالي."
        }
        "danger.clearCloudData.body" if pt => {
            "Isso limpa os dados ZeroChat criptografados armazenados no destino de sincronização na nuvem atual."
        }
        "danger.clearCloudData.body" if ru => {
            "При этом будут удалены зашифрованные данные ZeroChat, хранящиеся в текущем целевом объекте облачной синхронизации."
        }
        "danger.clearCloudData.body" if fr => {
            "Cela efface les données ZeroChat chiffrées stockées dans la cible de synchronisation cloud actuelle."
        }
        "danger.clearCloudData.body" if ja => {
            "現在のクラウド同期先に保存されている暗号化済みの ZeroChat データを消去します。"
        }
        "danger.clearCloudData.body" if ko => {
            "현재 클라우드 동기화 대상에 저장된 암호화된 ZeroChat 데이터를 지웁니다."
        }
        "danger.clearCloudData.body" => {
            "This clears the encrypted ZeroChat data stored in the current cloud sync target."
        }
        "danger.clearCloudData.detail1" if zh => {
            "只删除云端密文：Gist 文件，或 Cloudflare Worker 的 KV/R2 同步对象。"
        }
        "danger.clearCloudData.detail1" if es => {
            "Solo se elimina el texto cifrado remoto: el archivo Gist o los objetos de sincronización Cloudflare Worker KV/R2."
        }
        "danger.clearCloudData.detail1" if hi => {
            "केवल दूरस्थ सिफरटेक्स्ट हटा दिया गया है: Gist फ़ाइल, या Cloudflare Worker KV/R2 सिंक ऑब्जेक्ट।"
        }
        "danger.clearCloudData.detail1" if ar => {
            "يتم حذف النص المشفر البعيد فقط: ملف Gist، أو كائنات المزامنة Cloudflare Worker KV/R2."
        }
        "danger.clearCloudData.detail1" if pt => {
            "Apenas o texto cifrado remoto é excluído: o arquivo Gist ou os objetos de sincronização Cloudflare Worker KV/R2."
        }
        "danger.clearCloudData.detail1" if ru => {
            "Удаляется только удаленный зашифрованный текст: файл Gist или объекты синхронизации Cloudflare Worker KV/R2."
        }
        "danger.clearCloudData.detail1" if fr => {
            "Seul le texte chiffré distant est supprimé: le fichier Gist ou les objets de synchronisation Cloudflare Worker KV/R2."
        }
        "danger.clearCloudData.detail1" if ja => {
            "リモート暗号文のみが削除されます: Gist ファイル、または Cloudflare Worker KV/R2 同期オブジェクト。"
        }
        "danger.clearCloudData.detail1" if ko => {
            "원격 암호문(Gist 파일 또는 Cloudflare Worker KV/R2 동기화 개체)만 삭제됩니다."
        }
        "danger.clearCloudData.detail1" => {
            "Only remote ciphertext is deleted: the Gist file, or the Cloudflare Worker KV/R2 sync objects."
        }
        "danger.clearCloudData.detail2" if zh => {
            "本机聊天、设置、服务商密钥和手动导出的加密备份不会被删除。"
        }
        "danger.clearCloudData.detail2" if es => {
            "Los chats locales, la configuración, las claves de proveedor y las copias de seguridad cifradas exportadas permanecen en este dispositivo."
        }
        "danger.clearCloudData.detail2" if hi => {
            "स्थानीय चैट, सेटिंग्स, प्रदाता कुंजी और निर्यातित एन्क्रिप्टेड बैकअप इस डिवाइस पर रहते हैं।"
        }
        "danger.clearCloudData.detail2" if ar => {
            "تبقى الدردشات المحلية والإعدادات ومفاتيح الموفر والنسخ الاحتياطية المشفرة المصدرة على هذا الجهاز."
        }
        "danger.clearCloudData.detail2" if pt => {
            "Bate-papos locais, configurações, chaves de provedor e backups criptografados exportados permanecem neste dispositivo."
        }
        "danger.clearCloudData.detail2" if ru => {
            "Локальные чаты, настройки, ключи поставщика и экспортированные зашифрованные резервные копии остаются на этом устройстве."
        }
        "danger.clearCloudData.detail2" if fr => {
            "Les discussions locales, les paramètres, les clés de fournisseur et les sauvegardes chiffrées exportées restent sur cet appareil."
        }
        "danger.clearCloudData.detail2" if ja => {
            "ローカル チャット、設定、プロバイダー キー、エクスポートされた暗号化されたバックアップはこのデバイスに残ります。"
        }
        "danger.clearCloudData.detail2" if ko => {
            "로컬 채팅, 설정, 공급자 키 및 내보낸 암호화된 백업은 이 장치에 유지됩니다."
        }
        "danger.clearCloudData.detail2" => {
            "Local chats, settings, provider keys, and exported encrypted backups stay on this device."
        }
        "danger.clearCloudData.detail3" if zh => {
            "其他设备如果还保留旧本地数据，之后继续编辑并同步时，可能会重新上传。"
        }
        "danger.clearCloudData.detail3" if es => {
            "Otros dispositivos que todavía tienen datos locales antiguos pueden cargarlos nuevamente si continúan editándolos y sincronizándolos más tarde."
        }
        "danger.clearCloudData.detail3" if hi => {
            "अन्य डिवाइस जिनमें अभी भी पुराना स्थानीय डेटा है, यदि वे संपादन जारी रखते हैं और बाद में सिंक करते हैं तो वे इसे फिर से अपलोड कर सकते हैं।"
        }
        "danger.clearCloudData.detail3" if ar => {
            "قد تقوم الأجهزة الأخرى التي لا تزال تحتوي على بيانات محلية قديمة بتحميلها مرة أخرى إذا استمرت في التحرير والمزامنة لاحقًا."
        }
        "danger.clearCloudData.detail3" if pt => {
            "Outros dispositivos que ainda possuem dados locais antigos poderão carregá-los novamente se continuarem editando e sincronizando posteriormente."
        }
        "danger.clearCloudData.detail3" if ru => {
            "Другие устройства, на которых все еще есть старые локальные данные, могут загрузить их снова, если они продолжат редактировать и синхронизировать их позже."
        }
        "danger.clearCloudData.detail3" if fr => {
            "D'autres appareils disposant encore d'anciennes données locales peuvent les télécharger à nouveau s'ils continuent de les modifier et de les synchroniser ultérieurement."
        }
        "danger.clearCloudData.detail3" if ja => {
            "古いローカル データが残っている他のデバイスは、後で編集と同期を続けると、データを再度アップロードする可能性があります。"
        }
        "danger.clearCloudData.detail3" if ko => {
            "아직 오래된 로컬 데이터가 있는 다른 장치는 나중에 계속 편집하고 동기화하면 다시 업로드할 수 있습니다."
        }
        "danger.clearCloudData.detail3" => {
            "Other devices that still have old local data may upload it again if they keep editing and sync later."
        }
        "danger.clearCloudData.detail4" if zh => "清空云端后，这个同步目标会从下一次同步重新开始。",
        "danger.clearCloudData.detail4" if es => {
            "Tras borrar la nube, este destino empezará de cero en la próxima sincronización."
        }
        "danger.clearCloudData.detail4" if hi => {
            "क्लाउड डेटा साफ़ करने के बाद यह सिंक लक्ष्य अगली सिंक पर फिर से शुरू होगा।"
        }
        "danger.clearCloudData.detail4" if ar => {
            "بعد مسح بيانات السحابة، يبدأ هدف المزامنة هذا من جديد في المزامنة التالية."
        }
        "danger.clearCloudData.detail4" if pt => {
            "Depois de limpar a nuvem, este destino recomeça na próxima sincronização."
        }
        "danger.clearCloudData.detail4" if ru => {
            "После очистки облака эта цель синхронизации начнет заново при следующей синхронизации."
        }
        "danger.clearCloudData.detail4" if fr => {
            "Après l'effacement du cloud, cette cible repartira à zéro à la prochaine synchronisation."
        }
        "danger.clearCloudData.detail4" if ja => {
            "クラウドデータを消去すると、この同期先は次回同期から新しく始まります。"
        }
        "danger.clearCloudData.detail4" if ko => {
            "클라우드 데이터를 지우면 이 동기화 대상은 다음 동기화부터 새로 시작됩니다."
        }
        "danger.clearCloudData.detail4" => {
            "After clearing cloud data, this sync target starts fresh on the next sync."
        }
        "field.baseUrl" if zh => "Base URL",
        "field.baseUrl" if es => "Base URL",
        "field.baseUrl" if hi => "Base URL",
        "field.baseUrl" if ar => "Base URL",
        "field.baseUrl" if pt => "Base URL",
        "field.baseUrl" if ru => "Base URL",
        "field.baseUrl" if fr => "Base URL",
        "field.baseUrl" if ja => "Base URL",
        "field.baseUrl" if ko => "Base URL",
        "field.baseUrl" => "Base URL",
        "field.clientDirectRequest" if zh => "客户端直连请求",
        "field.clientDirectRequest" if es => "Solicitud directa del cliente",
        "field.clientDirectRequest" if hi => "क्लाइंट से सीधा अनुरोध",
        "field.clientDirectRequest" if ar => "طلب مباشر من العميل",
        "field.clientDirectRequest" if pt => "Solicitação direta do cliente",
        "field.clientDirectRequest" if ru => "Прямой запрос клиента",
        "field.clientDirectRequest" if fr => "Requête directe côté client",
        "field.clientDirectRequest" if ja => "クライアントから直接リクエスト",
        "field.clientDirectRequest" if ko => "클라이언트 직접 요청",
        "field.clientDirectRequest" => "Client-side direct request",
        "field.cloudflareAccessKey" if zh => "Cloudflare 访问密钥",
        "field.cloudflareAccessKey" if es => "Cloudflare clave de acceso",
        "field.cloudflareAccessKey" if hi => "Cloudflare एक्सेस कुंजी",
        "field.cloudflareAccessKey" if ar => "Cloudflare مفتاح الوصول",
        "field.cloudflareAccessKey" if pt => "Cloudflare chave de acesso",
        "field.cloudflareAccessKey" if ru => "Cloudflare ключ доступа",
        "field.cloudflareAccessKey" if fr => "Cloudflare clé d'accès",
        "field.cloudflareAccessKey" if ja => "Cloudflare アクセス キー",
        "field.cloudflareAccessKey" if ko => "Cloudflare 액세스 키",
        "field.cloudflareAccessKey" => "Cloudflare access key",
        "field.cloudflareWorkerUrl" if zh => "Cloudflare Worker 地址",
        "field.cloudflareWorkerUrl" if es => "URL de Cloudflare Worker",
        "field.cloudflareWorkerUrl" if hi => "Cloudflare Worker URL",
        "field.cloudflareWorkerUrl" if ar => "رابط Cloudflare Worker",
        "field.cloudflareWorkerUrl" if pt => "URL do Cloudflare Worker",
        "field.cloudflareWorkerUrl" if ru => "URL Cloudflare Worker",
        "field.cloudflareWorkerUrl" if fr => "URL Cloudflare Worker",
        "field.cloudflareWorkerUrl" if ja => "Cloudflare Worker URL",
        "field.cloudflareWorkerUrl" if ko => "Cloudflare Worker URL",
        "field.cloudflareWorkerUrl" => "Cloudflare Worker URL",
        "field.dataPassphrase" if zh => "数据加密密码",
        "field.dataPassphrase" if es => "Contraseña de cifrado de datos",
        "field.dataPassphrase" if hi => "डेटा एन्क्रिप्शन पासवर्ड",
        "field.dataPassphrase" if ar => "كلمة مرور تشفير البيانات",
        "field.dataPassphrase" if pt => "Senha de criptografia de dados",
        "field.dataPassphrase" if ru => "Пароль шифрования данных",
        "field.dataPassphrase" if fr => "Mot de passe de chiffrement des données",
        "field.dataPassphrase" if ja => "データ暗号化パスワード",
        "field.dataPassphrase" if ko => "데이터 암호화 비밀번호",
        "field.dataPassphrase" => "Data encryption password",
        "field.defaultModel" if zh => "默认模型",
        "field.defaultModel" if es => "Modelo predeterminado",
        "field.defaultModel" if hi => "डिफॉल्ट मॉडल",
        "field.defaultModel" if ar => "النموذج الافتراضي",
        "field.defaultModel" if pt => "Modelo padrão",
        "field.defaultModel" if ru => "Модель по умолчанию",
        "field.defaultModel" if fr => "Modèle par défaut",
        "field.defaultModel" if ja => "既定のモデル",
        "field.defaultModel" if ko => "기본 모델",
        "field.defaultModel" => "Default model",
        "field.enabled" if zh => "启用",
        "field.enabled" if es => "Activado",
        "field.enabled" if hi => "सक्षम",
        "field.enabled" if ar => "مفعّل",
        "field.enabled" if pt => "Ativado",
        "field.enabled" if ru => "Включено",
        "field.enabled" if fr => "Activé",
        "field.enabled" if ja => "有効",
        "field.enabled" if ko => "사용",
        "field.enabled" => "Enabled",
        "field.autoSync" if zh => "自动同步",
        "field.autoSync" if es => "Sincronización automática",
        "field.autoSync" if hi => "स्वचालित सिंक",
        "field.autoSync" if ar => "المزامنة التلقائية",
        "field.autoSync" if pt => "Sincronização automática",
        "field.autoSync" if ru => "Автосинхронизация",
        "field.autoSync" if fr => "Synchronisation automatique",
        "field.autoSync" if ja => "自動同期",
        "field.autoSync" if ko => "자동 동기화",
        "field.autoSync" => "Automatic sync",
        "field.gistFile" if zh => "Gist 文件",
        "field.gistFile" if es => "Archivo Gist",
        "field.gistFile" if hi => "Gist फ़ाइल",
        "field.gistFile" if ar => "ملف Gist",
        "field.gistFile" if pt => "Arquivo Gist",
        "field.gistFile" if ru => "Файл Gist",
        "field.gistFile" if fr => "Fichier Gist",
        "field.gistFile" if ja => "Gist ファイル",
        "field.gistFile" if ko => "Gist 파일",
        "field.gistFile" => "Gist file",
        "field.gistId" if zh => "Gist ID",
        "field.gistId" if es => "ID de Gist",
        "field.gistId" if hi => "Gist ID",
        "field.gistId" if ar => "معرف Gist",
        "field.gistId" if pt => "ID do Gist",
        "field.gistId" if ru => "Gist ID",
        "field.gistId" if fr => "ID Gist",
        "field.gistId" if ja => "Gist ID",
        "field.gistId" if ko => "Gist ID",
        "field.gistId" => "Gist ID",
        "field.githubToken" if zh => "GitHub 令牌",
        "field.githubToken" if es => "Token de GitHub",
        "field.githubToken" if hi => "GitHub टोकन",
        "field.githubToken" if ar => "رمز GitHub",
        "field.githubToken" if pt => "Token do GitHub",
        "field.githubToken" if ru => "Токен GitHub",
        "field.githubToken" if fr => "Jeton GitHub",
        "field.githubToken" if ja => "GitHub トークン",
        "field.githubToken" if ko => "GitHub 토큰",
        "field.githubToken" => "GitHub token",
        "field.imageModel" if zh => "图片模型",
        "field.imageModel" if es => "Modelo de imagen",
        "field.imageModel" if hi => "छवि मॉडल",
        "field.imageModel" if ar => "نموذج الصورة",
        "field.imageModel" if pt => "Modelo de imagem",
        "field.imageModel" if ru => "Модель изображения",
        "field.imageModel" if fr => "Modèle d'image",
        "field.imageModel" if ja => "画像モデル",
        "field.imageModel" if ko => "이미지 모델",
        "field.imageModel" => "Image model",
        "field.imageMode" if zh => "图片模式",
        "field.imageMode" if es => "Modo de imagen",
        "field.imageMode" if hi => "चित्र मोड",
        "field.imageMode" if ar => "وضع الصورة",
        "field.imageMode" if pt => "Modo de imagem",
        "field.imageMode" if ru => "Режим изображения",
        "field.imageMode" if fr => "Mode image",
        "field.imageMode" if ja => "画像モード",
        "field.imageMode" if ko => "이미지 모드",
        "field.imageMode" => "Image mode",
        "field.name" if zh => "名称",
        "field.name" if es => "Nombre",
        "field.name" if hi => "नाम",
        "field.name" if ar => "الاسم",
        "field.name" if pt => "Nome",
        "field.name" if ru => "Название",
        "field.name" if fr => "Nom",
        "field.name" if ja => "名前",
        "field.name" if ko => "이름",
        "field.name" => "Name",
        "field.providerModel" if zh => "服务商和模型",
        "field.providerModel" if es => "Proveedor y modelo",
        "field.providerModel" if hi => "प्रदाता और मॉडल",
        "field.providerModel" if ar => "الموفر والطراز",
        "field.providerModel" if pt => "Provedor e modelo",
        "field.providerModel" if ru => "Провайдер и модель",
        "field.providerModel" if fr => "Fournisseur et modèle",
        "field.providerModel" if ja => "プロバイダーとモデル",
        "field.providerModel" if ko => "공급자 및 모델",
        "field.providerModel" => "Provider and model",
        "field.providerKey" if zh => "API Key",
        "field.providerKey" if es => "Clave del proveedor",
        "field.providerKey" if hi => "प्रदाता कुंजी",
        "field.providerKey" if ar => "مفتاح المزود",
        "field.providerKey" if pt => "Chave do provedor",
        "field.providerKey" if ru => "Ключ провайдера",
        "field.providerKey" if fr => "Clé du fournisseur",
        "field.providerKey" if ja => "プロバイダーキー",
        "field.providerKey" if ko => "공급자 키",
        "field.providerKey" => "Provider key",
        "placeholder.providerKeySaved" if zh => "API Key 已保存在此设备",
        "placeholder.providerKeySaved" if es => "Clave guardada en este dispositivo",
        "placeholder.providerKeySaved" if hi => "कुंजी इस डिवाइस पर सहेजी गई",
        "placeholder.providerKeySaved" if ar => "تم حفظ المفتاح على هذا الجهاز",
        "placeholder.providerKeySaved" if pt => "Chave salva neste dispositivo",
        "placeholder.providerKeySaved" if ru => "Ключ сохранен на этом устройстве",
        "placeholder.providerKeySaved" if fr => "Clé enregistrée sur cet appareil",
        "placeholder.providerKeySaved" if ja => "このデバイスにキーを保存済み",
        "placeholder.providerKeySaved" if ko => "이 기기에 키 저장됨",
        "placeholder.providerKeySaved" => "Key saved on this device",
        "field.proxyUrl" if zh => "AI 代理地址（可选）",
        "field.proxyUrl" if es => "URL del proxy de IA (opcional)",
        "field.proxyUrl" if hi => "AI प्रॉक्सी URL (वैकल्पिक)",
        "field.proxyUrl" if ar => "رابط وكيل الذكاء الاصطناعي (اختياري)",
        "field.proxyUrl" if pt => "URL do proxy de IA (opcional)",
        "field.proxyUrl" if ru => "URL AI-прокси (необязательно)",
        "field.proxyUrl" if fr => "URL du proxy IA (facultatif)",
        "field.proxyUrl" if ja => "AI プロキシ URL（任意）",
        "field.proxyUrl" if ko => "AI 프록시 URL(선택 사항)",
        "field.proxyUrl" => "AI proxy URL (optional)",
        "error.providerKeyRequired" if zh => "请先填写这个服务商的 API Key。",
        "error.providerKeyRequired" if es => "Introduce primero la clave de este proveedor.",
        "error.providerKeyRequired" if hi => "पहले इस प्रदाता की कुंजी दर्ज करें।",
        "error.providerKeyRequired" if ar => "أدخل مفتاح هذا المزوّد أولا.",
        "error.providerKeyRequired" if pt => "Informe primeiro a chave deste provedor.",
        "error.providerKeyRequired" if ru => "Сначала введите ключ этого провайдера.",
        "error.providerKeyRequired" if fr => "Saisissez d'abord la clé de ce fournisseur.",
        "error.providerKeyRequired" if ja => "先にこのプロバイダーのキーを入力してください。",
        "error.providerKeyRequired" if ko => "먼저 이 공급자의 키를 입력하세요.",
        "error.providerKeyRequired" => "Enter this provider key first.",
        "error.apiBalanceInsufficient" if zh => "API 余额不足，请充值后重试",
        "error.apiBalanceInsufficient" if es => {
            "El saldo de la API es insuficiente. Recarga y vuelve a intentarlo."
        }
        "error.apiBalanceInsufficient" if hi => "API बैलेंस कम है। क्रेडिट जोड़ें और फिर कोशिश करें।",
        "error.apiBalanceInsufficient" if ar => "رصيد API غير كافٍ. أضف رصيدًا ثم حاول مرة أخرى.",
        "error.apiBalanceInsufficient" if pt => {
            "O saldo da API é insuficiente. Adicione créditos e tente novamente."
        }
        "error.apiBalanceInsufficient" if ru => {
            "Недостаточно средств API. Пополните баланс и повторите попытку."
        }
        "error.apiBalanceInsufficient" if fr => {
            "Le solde API est insuffisant. Rechargez puis réessayez."
        }
        "error.apiBalanceInsufficient" if ja => {
            "API 残高が不足しています。チャージしてから再試行してください。"
        }
        "error.apiBalanceInsufficient" if ko => "API 잔액이 부족합니다. 충전 후 다시 시도하세요.",
        "error.apiBalanceInsufficient" => "API balance is insufficient. Add credit and try again.",
        "error.apiKeyInvalid" if zh => "API Key 无效，请检查是否复制完整",
        "error.apiKeyInvalid" if es => {
            "La API Key no es válida. Comprueba que se haya copiado completa."
        }
        "error.apiKeyInvalid" if hi => "API Key अमान्य है। जांचें कि यह पूरी तरह कॉपी हुई है।",
        "error.apiKeyInvalid" if ar => "مفتاح API غير صالح. تأكد من نسخه بالكامل.",
        "error.apiKeyInvalid" if pt => {
            "A API Key é inválida. Confira se ela foi copiada por completo."
        }
        "error.apiKeyInvalid" if ru => {
            "API Key недействителен. Проверьте, что он скопирован полностью."
        }
        "error.apiKeyInvalid" if fr => {
            "La clé API est invalide. Vérifiez qu'elle a été copiée en entier."
        }
        "error.apiKeyInvalid" if ja => {
            "API Key が無効です。完全にコピーされているか確認してください。"
        }
        "error.apiKeyInvalid" if ko => {
            "API Key가 올바르지 않습니다. 전체가 복사되었는지 확인하세요."
        }
        "error.apiKeyInvalid" => "API key is invalid. Check that it was copied completely.",
        "error.apiRateLimited" if zh => "请求太频繁，请稍等后重试",
        "error.apiRateLimited" if es => {
            "Hay demasiadas solicitudes. Espera un momento y reinténtalo."
        }
        "error.apiRateLimited" if hi => "बहुत अधिक अनुरोध हो रहे हैं। थोड़ी देर बाद फिर कोशिश करें।",
        "error.apiRateLimited" if ar => "طلبات كثيرة جدًا. انتظر قليلًا ثم أعد المحاولة.",
        "error.apiRateLimited" if pt => {
            "Muitas solicitações. Aguarde um momento e tente novamente."
        }
        "error.apiRateLimited" if ru => "Слишком много запросов. Подождите немного и повторите.",
        "error.apiRateLimited" if fr => "Trop de requêtes. Patientez un instant puis réessayez.",
        "error.apiRateLimited" if ja => {
            "リクエストが多すぎます。少し待ってから再試行してください。"
        }
        "error.apiRateLimited" if ko => "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
        "error.apiRateLimited" => "Too many requests. Wait a moment and retry.",
        "error.apiRequestFailed" if zh => "服务商没有完成请求，请稍后重试",
        "error.apiRequestFailed" if es => {
            "El proveedor no pudo completar la solicitud. Inténtalo más tarde."
        }
        "error.apiRequestFailed" if hi => "प्रदाता अनुरोध पूरा नहीं कर सका। बाद में फिर कोशिश करें।",
        "error.apiRequestFailed" if ar => "تعذر على المزوّد إكمال الطلب. حاول لاحقًا.",
        "error.apiRequestFailed" if pt => {
            "O provedor não conseguiu concluir a solicitação. Tente mais tarde."
        }
        "error.apiRequestFailed" if ru => "Поставщик не смог завершить запрос. Повторите позже.",
        "error.apiRequestFailed" if fr => {
            "Le fournisseur n'a pas pu terminer la demande. Réessayez plus tard."
        }
        "error.apiRequestFailed" if ja => {
            "プロバイダーがリクエストを完了できませんでした。後でもう一度お試しください。"
        }
        "error.apiRequestFailed" if ko => {
            "공급자가 요청을 완료하지 못했습니다. 나중에 다시 시도하세요."
        }
        "error.apiRequestFailed" => "The provider could not complete the request. Try again later.",
        "error.providerEndpointMissing" if zh => {
            "此服务商或中继没有提供该接口，请检查能力、Base URL 或 AI 代理路径。"
        }
        "error.providerEndpointMissing" if es => {
            "Este proveedor o relay no expone ese endpoint. Revisa la capacidad, la Base URL o la ruta del proxy de IA."
        }
        "error.providerEndpointMissing" if hi => {
            "यह प्रदाता या relay यह endpoint उपलब्ध नहीं कराता। capability, Base URL या AI proxy path जाँचें।"
        }
        "error.providerEndpointMissing" if ar => {
            "هذا المزوّد أو relay لا يوفّر ذلك endpoint. تحقق من القدرة أو Base URL أو مسار وكيل AI."
        }
        "error.providerEndpointMissing" if pt => {
            "Este provedor ou relay não expõe esse endpoint. Verifique a capacidade, a Base URL ou o caminho do proxy de IA."
        }
        "error.providerEndpointMissing" if ru => {
            "Этот провайдер или релей не предоставляет этот endpoint. Проверьте возможность, Base URL или путь AI-прокси."
        }
        "error.providerEndpointMissing" if fr => {
            "Ce fournisseur ou relais n’expose pas ce endpoint. Vérifiez la capacité, la Base URL ou le chemin du proxy IA."
        }
        "error.providerEndpointMissing" if ja => {
            "このプロバイダーまたはリレーはその endpoint を公開していません。機能、Base URL、AI プロキシのパスを確認してください。"
        }
        "error.providerEndpointMissing" if ko => {
            "이 공급자 또는 릴레이가 해당 endpoint를 제공하지 않습니다. 기능, Base URL 또는 AI 프록시 경로를 확인하세요."
        }
        "error.providerEndpointMissing" => {
            "This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path."
        }
        "error.apiUnavailable" if zh => "服务商暂时不可用，请稍后重试",
        "error.apiUnavailable" if es => {
            "El proveedor no está disponible temporalmente. Inténtalo más tarde."
        }
        "error.apiUnavailable" if hi => "प्रदाता अस्थायी रूप से उपलब्ध नहीं है। बाद में फिर कोशिश करें।",
        "error.apiUnavailable" if ar => "المزوّد غير متاح مؤقتًا. حاول لاحقًا.",
        "error.apiUnavailable" if pt => {
            "O provedor está temporariamente indisponível. Tente mais tarde."
        }
        "error.apiUnavailable" if ru => "Поставщик временно недоступен. Повторите позже.",
        "error.apiUnavailable" if fr => {
            "Le fournisseur est temporairement indisponible. Réessayez plus tard."
        }
        "error.apiUnavailable" if ja => {
            "プロバイダーは一時的に利用できません。後でもう一度お試しください。"
        }
        "error.apiUnavailable" if ko => {
            "공급자를 일시적으로 사용할 수 없습니다. 나중에 다시 시도하세요."
        }
        "error.apiUnavailable" => "The provider is temporarily unavailable. Try again later.",
        "error.networkRequestFailed" if zh => "网络连接失败，请检查网络后重试",
        "error.networkRequestFailed" if es => {
            "La conexión de red falló. Revisa la red e inténtalo de nuevo."
        }
        "error.networkRequestFailed" if hi => {
            "नेटवर्क कनेक्शन विफल रहा। अपना कनेक्शन जांचें और फिर कोशिश करें।"
        }
        "error.networkRequestFailed" if ar => "فشل اتصال الشبكة. تحقق من الاتصال ثم أعد المحاولة.",
        "error.networkRequestFailed" if pt => {
            "A conexão de rede falhou. Verifique a conexão e tente novamente."
        }
        "error.networkRequestFailed" if ru => {
            "Сетевое соединение не удалось. Проверьте сеть и повторите попытку."
        }
        "error.networkRequestFailed" if fr => {
            "La connexion réseau a échoué. Vérifiez votre connexion puis réessayez."
        }
        "error.networkRequestFailed" if ja => {
            "ネットワーク接続に失敗しました。接続を確認して再試行してください。"
        }
        "error.networkRequestFailed" if ko => {
            "네트워크 연결에 실패했습니다. 연결을 확인한 뒤 다시 시도하세요."
        }
        "error.networkRequestFailed" => {
            "Network connection failed. Check your connection and try again."
        }
        "error.urlCredentials" if zh => "{label} 不能包含用户名或密码",
        "error.urlCredentials" if es => {
            "{label} no puede incluir un nombre de usuario o contraseña"
        }
        "error.urlCredentials" if hi => "{label} में उपयोगकर्ता नाम या पासवर्ड शामिल नहीं हो सकता",
        "error.urlCredentials" if ar => "لا يمكن أن يتضمن {label} اسم مستخدم أو كلمة مرور",
        "error.urlCredentials" if pt => "{label} não pode incluir um nome de usuário ou senha",
        "error.urlCredentials" if ru => "{label} не может включать имя пользователя или пароль",
        "error.urlCredentials" if fr => {
            "{label} ne peut pas inclure de nom d'utilisateur ou de mot de passe"
        }
        "error.urlCredentials" if ja => {
            "{label} にはユーザー名またはパスワードを含めることはできません"
        }
        "error.urlCredentials" if ko => "{label}는 사용자 이름이나 비밀번호를 포함할 수 없습니다.",
        "error.urlCredentials" => "{label} cannot include a username or password",
        "error.urlHttps" if zh => "{label} 必须使用 HTTPS 远程地址",
        "error.urlHttps" if es => "{label} debe ser una URL remota HTTPS",
        "error.urlHttps" if hi => "{label} एक दूरस्थ HTTPS URL होना चाहिए",
        "error.urlHttps" if ar => "يجب أن يكون {label} عنوان HTTPS بعيد",
        "error.urlHttps" if pt => "{label} deve ser um URL HTTPS remoto",
        "error.urlHttps" if ru => "{label} должен быть удаленным URL HTTPS",
        "error.urlHttps" if fr => "{label} doit être une URL distante HTTPS",
        "error.urlHttps" if ja => "{label} はリモート HTTPS URL である必要があります",
        "error.urlHttps" if ko => "{label}는 원격 HTTPS URL이어야 합니다.",
        "error.urlHttps" => "{label} must be a remote HTTPS URL",
        "error.urlLocalNetwork" if zh => "{label} 不能使用 localhost、本机、内网或局域网地址",
        "error.urlLocalNetwork" if es => {
            "{label} no puede usar localhost, este dispositivo, red privada o direcciones LAN"
        }
        "error.urlLocalNetwork" if hi => {
            "{label}, localhost, इस डिवाइस, निजी नेटवर्क या LAN पते का उपयोग नहीं कर सकता"
        }
        "error.urlLocalNetwork" if ar => {
            "لا يمكن استخدام {label} localhost أو هذا الجهاز أو الشبكة الخاصة أو عناوين LAN"
        }
        "error.urlLocalNetwork" if pt => {
            "{label} não pode usar localhost, este dispositivo, rede privada ou endereços LAN"
        }
        "error.urlLocalNetwork" if ru => {
            "{label} не может использовать localhost, это устройство, частную сеть или LAN"
        }
        "error.urlLocalNetwork" if fr => {
            "{label} ne peut pas utiliser localhost, cet appareil, un réseau privé ou des adresses LAN"
        }
        "error.urlLocalNetwork" if ja => {
            "{label} は localhost、このデバイス、プライベート ネットワーク、または LAN アドレスを使用できません"
        }
        "error.urlLocalNetwork" if ko => {
            "{label}는 localhost, 이 장치, 개인 네트워크 또는 LAN 주소를 사용할 수 없습니다."
        }
        "error.urlLocalNetwork" => {
            "{label} cannot use localhost, this device, private network, or LAN addresses"
        }
        "error.urlQuery" if zh => "{label} 不能包含查询参数或 # 片段",
        "error.urlQuery" if es => "{label} no puede incluir parámetros de consulta ni fragmentos #",
        "error.urlQuery" if hi => "{label} में क्वेरी पैरामीटर या # टुकड़े शामिल नहीं हो सकते",
        "error.urlQuery" if ar => "لا يمكن أن يتضمن {label} معلمات استعلام أو أجزاء #",
        "error.urlQuery" if pt => "{label} não pode incluir parâmetros de consulta ou fragmentos #",
        "error.urlQuery" if ru => "{label} не может включать параметры запроса или фрагменты #",
        "error.urlQuery" if fr => {
            "{label} ne peut pas inclure de paramètres de requête ou de fragments #"
        }
        "error.urlQuery" if ja => {
            "{label} にクエリ パラメータや # フラグメントを含めることはできません"
        }
        "error.urlQuery" if ko => "{label}는 쿼리 매개변수 또는 # 조각을 포함할 수 없습니다.",
        "error.urlQuery" => "{label} cannot include query parameters or # fragments",
        "error.aiRequestFailed" if zh => "AI 请求失败：{message}",
        "error.aiRequestFailed" if es => "La solicitud de IA falló: {message}",
        "error.aiRequestFailed" if hi => "AI अनुरोध विफल: {message}",
        "error.aiRequestFailed" if ar => "فشل طلب الذكاء الاصطناعي: {message}",
        "error.aiRequestFailed" if pt => "Falha na solicitação de IA: {message}",
        "error.aiRequestFailed" if ru => "Запрос AI не удался: {message}",
        "error.aiRequestFailed" if fr => "La requête IA a échoué: {message}",
        "error.aiRequestFailed" if ja => "AI リクエストに失敗しました: {message}",
        "error.aiRequestFailed" if ko => "AI 요청 실패: {message}",
        "error.aiRequestFailed" => "AI request failed: {message}",
        "error.aiResponseReadFailed" if zh => "读取 AI 响应失败。",
        "error.aiResponseReadFailed" if es => "No se pudo leer la respuesta de IA.",
        "error.aiResponseReadFailed" if hi => "AI प्रतिक्रिया पढ़ी नहीं जा सकी।",
        "error.aiResponseReadFailed" if ar => "تعذرت قراءة استجابة الذكاء الاصطناعي.",
        "error.aiResponseReadFailed" if pt => "Não foi possível ler a resposta de IA.",
        "error.aiResponseReadFailed" if ru => "Не удалось прочитать ответ AI.",
        "error.aiResponseReadFailed" if fr => "Impossible de lire la réponse IA.",
        "error.aiResponseReadFailed" if ja => "AI 応答を読み取れませんでした。",
        "error.aiResponseReadFailed" if ko => "AI 응답을 읽을 수 없습니다.",
        "error.aiResponseReadFailed" => "Could not read the AI response.",
        "error.modelsRequestFailed" if zh => "模型列表请求失败：{message}",
        "error.modelsRequestFailed" if es => "La solicitud de lista de modelos falló: {message}",
        "error.modelsRequestFailed" if hi => "मॉडल सूची अनुरोध विफल: {message}",
        "error.modelsRequestFailed" if ar => "فشل طلب قائمة النماذج: {message}",
        "error.modelsRequestFailed" if pt => "Falha na solicitação da lista de modelos: {message}",
        "error.modelsRequestFailed" if ru => "Запрос списка моделей не удался: {message}",
        "error.modelsRequestFailed" if fr => "La requête de liste des modèles a échoué: {message}",
        "error.modelsRequestFailed" if ja => "モデル一覧リクエストに失敗しました: {message}",
        "error.modelsRequestFailed" if ko => "모델 목록 요청 실패: {message}",
        "error.modelsRequestFailed" => "Model list request failed: {message}",
        "error.modelsReadFailed" if zh => "读取模型列表失败。",
        "error.modelsReadFailed" if es => "No se pudo leer la lista de modelos.",
        "error.modelsReadFailed" if hi => "मॉडल सूची पढ़ी नहीं जा सकी।",
        "error.modelsReadFailed" if ar => "تعذرت قراءة قائمة النماذج.",
        "error.modelsReadFailed" if pt => "Não foi possível ler a lista de modelos.",
        "error.modelsReadFailed" if ru => "Не удалось прочитать список моделей.",
        "error.modelsReadFailed" if fr => "Impossible de lire la liste des modèles.",
        "error.modelsReadFailed" if ja => "モデル一覧を読み取れませんでした。",
        "error.modelsReadFailed" if ko => "모델 목록을 읽을 수 없습니다.",
        "error.modelsReadFailed" => "Could not read the model list.",
        "error.modelsInvalidJson" if zh => "模型列表不是有效 JSON。",
        "error.modelsInvalidJson" if es => "La lista de modelos no es JSON válido.",
        "error.modelsInvalidJson" if hi => "मॉडल सूची मान्य JSON नहीं है।",
        "error.modelsInvalidJson" if ar => "قائمة النماذج ليست JSON صالحا.",
        "error.modelsInvalidJson" if pt => "A lista de modelos não é um JSON válido.",
        "error.modelsInvalidJson" if ru => "Список моделей не является допустимым JSON.",
        "error.modelsInvalidJson" if fr => "La liste des modèles n'est pas un JSON valide.",
        "error.modelsInvalidJson" if ja => "モデル一覧が有効な JSON ではありません。",
        "error.modelsInvalidJson" if ko => "모델 목록이 유효한 JSON이 아닙니다.",
        "error.modelsInvalidJson" => "The model list is not valid JSON.",
        "error.modelsEmpty" if zh => "没有从服务商返回值中找到模型。",
        "error.modelsEmpty" if es => "No se encontraron modelos en la respuesta del proveedor.",
        "error.modelsEmpty" if hi => "प्रदाता की प्रतिक्रिया में कोई मॉडल नहीं मिला।",
        "error.modelsEmpty" if ar => "لم يتم العثور على نماذج في استجابة المزوّد.",
        "error.modelsEmpty" if pt => "Nenhum modelo foi encontrado na resposta do provedor.",
        "error.modelsEmpty" if ru => "В ответе провайдера модели не найдены.",
        "error.modelsEmpty" if fr => "Aucun modèle trouvé dans la réponse du fournisseur.",
        "error.modelsEmpty" if ja => "プロバイダーの応答にモデルが見つかりません。",
        "error.modelsEmpty" if ko => "공급자 응답에서 모델을 찾지 못했습니다.",
        "error.modelsEmpty" => "No models were found in the provider response.",
        "error.imageResponseInvalid" if zh => "图片响应无法读取。",
        "error.imageResponseInvalid" if es => "No se pudo leer la respuesta de imagen.",
        "error.imageResponseInvalid" if hi => "चित्र प्रतिक्रिया पढ़ी नहीं जा सकी।",
        "error.imageResponseInvalid" if ar => "تعذرت قراءة استجابة الصورة.",
        "error.imageResponseInvalid" if pt => "Não foi possível ler a resposta de imagem.",
        "error.imageResponseInvalid" if ru => "Не удалось прочитать ответ изображения.",
        "error.imageResponseInvalid" if fr => "Impossible de lire la réponse d'image.",
        "error.imageResponseInvalid" if ja => "画像応答を読み取れませんでした。",
        "error.imageResponseInvalid" if ko => "이미지 응답을 읽을 수 없습니다.",
        "error.imageResponseInvalid" => "Could not read the image response.",
        "message.emptyInput" if zh => "请输入消息。",
        "message.emptyInput" if es => "Escribe un mensaje.",
        "message.emptyInput" if hi => "संदेश लिखें।",
        "message.emptyInput" if ar => "اكتب رسالة.",
        "message.emptyInput" if pt => "Digite uma mensagem.",
        "message.emptyInput" if ru => "Введите сообщение.",
        "message.emptyInput" if fr => "Saisissez un message.",
        "message.emptyInput" if ja => "メッセージを入力してください。",
        "message.emptyInput" if ko => "메시지를 입력하세요.",
        "message.emptyInput" => "Enter a message.",
        "message.generating" if zh => "生成中...",
        "message.generating" if es => "Generando...",
        "message.generating" if hi => "जनरेट हो रहा है...",
        "message.generating" if ar => "جارٍ التوليد...",
        "message.generating" if pt => "Gerando...",
        "message.generating" if ru => "Генерация...",
        "message.generating" if fr => "Génération...",
        "message.generating" if ja => "生成中...",
        "message.generating" if ko => "생성 중...",
        "message.generating" => "Generating...",
        "notice.networkRetrying" if zh => "网络较慢，正在重试...（{attempt}/{total}）",
        "notice.networkRetrying" if es => "La red va lenta. Reintentando... ({attempt}/{total})",
        "notice.networkRetrying" if hi => {
            "नेटवर्क धीमा है। फिर कोशिश की जा रही है... ({attempt}/{total})"
        }
        "notice.networkRetrying" if ar => "الشبكة بطيئة. جارٍ إعادة المحاولة... ({attempt}/{total})",
        "notice.networkRetrying" if pt => {
            "A rede está lenta. Tentando novamente... ({attempt}/{total})"
        }
        "notice.networkRetrying" if ru => "Сеть медленная. Повторяем... ({attempt}/{total})",
        "notice.networkRetrying" if fr => {
            "Le réseau est lent. Nouvelle tentative... ({attempt}/{total})"
        }
        "notice.networkRetrying" if ja => {
            "ネットワークが遅くなっています。再試行中... ({attempt}/{total})"
        }
        "notice.networkRetrying" if ko => {
            "네트워크가 느립니다. 다시 시도 중... ({attempt}/{total})"
        }
        "notice.networkRetrying" => "Network is slow. Retrying... ({attempt}/{total})",
        "message.generationStopped" if zh => "已停止生成",
        "message.generationStopped" if es => "Generación detenida",
        "message.generationStopped" if hi => "जनरेशन रोक दी गई",
        "message.generationStopped" if ar => "تم إيقاف التوليد",
        "message.generationStopped" if pt => "Geração interrompida",
        "message.generationStopped" if ru => "Генерация остановлена",
        "message.generationStopped" if fr => "Génération arrêtée",
        "message.generationStopped" if ja => "生成を停止しました",
        "message.generationStopped" if ko => "생성이 중지되었습니다",
        "message.generationStopped" => "Generation stopped",
        "message.generatingImage" if zh => "图片生成中...",
        "message.generatingImage" if es => "Generando imagen...",
        "message.generatingImage" if hi => "चित्र बन रहा है...",
        "message.generatingImage" if ar => "جارٍ إنشاء الصورة...",
        "message.generatingImage" if pt => "Gerando imagem...",
        "message.generatingImage" if ru => "Создание изображения...",
        "message.generatingImage" if fr => "Génération de l'image...",
        "message.generatingImage" if ja => "画像を生成中...",
        "message.generatingImage" if ko => "이미지 생성 중...",
        "message.generatingImage" => "Generating image...",
        "message.imageModelRequired" if zh => "请先在设置 > 模型里选择图片模型。",
        "message.imageModelRequired" if es => {
            "Elige primero un modelo de imagen en Ajustes > Modelos."
        }
        "message.imageModelRequired" if hi => "पहले सेटिंग्स > मॉडल में चित्र मॉडल चुनें।",
        "message.imageModelRequired" if ar => "اختر نموذج صورة أولا من الإعدادات > النماذج.",
        "message.imageModelRequired" if pt => {
            "Escolha primeiro um modelo de imagem em Configurações > Modelos."
        }
        "message.imageModelRequired" if ru => {
            "Сначала выберите модель изображений в Настройки > Модели."
        }
        "message.imageModelRequired" if fr => {
            "Choisissez d'abord un modèle d'image dans Réglages > Modèles."
        }
        "message.imageModelRequired" if ja => "先に設定 > モデルで画像モデルを選択してください。",
        "message.imageModelRequired" if ko => "먼저 설정 > 모델에서 이미지 모델을 선택하세요.",
        "message.imageModelRequired" => "Choose an image model in Settings > Models first.",
        "message.audioSpeechModelRequired" if zh => "请先在设置 > 模型里选择语音合成模型。",
        "message.audioSpeechModelRequired" if es => {
            "Elige primero un modelo de voz en Ajustes > Modelos."
        }
        "message.audioSpeechModelRequired" if hi => "पहले सेटिंग्स > मॉडल में ऑडियो स्पीच मॉडल चुनें।",
        "message.audioSpeechModelRequired" if ar => {
            "اختر نموذج تحويل النص إلى كلام أولا من الإعدادات > النماذج."
        }
        "message.audioSpeechModelRequired" if pt => {
            "Escolha primeiro um modelo de fala de áudio em Configurações > Modelos."
        }
        "message.audioSpeechModelRequired" if ru => {
            "Сначала выберите модель озвучивания аудио в Настройки > Модели."
        }
        "message.audioSpeechModelRequired" if fr => {
            "Choisissez d'abord un modèle de synthèse vocale dans Réglages > Modèles."
        }
        "message.audioSpeechModelRequired" if ja => {
            "先に設定 > モデルで音声読み上げモデルを選択してください。"
        }
        "message.audioSpeechModelRequired" if ko => {
            "먼저 설정 > 모델에서 오디오 음성 모델을 선택하세요."
        }
        "message.audioSpeechModelRequired" => {
            "Choose an audio speech model in Settings > Models first."
        }
        "notice.audioSpeechEmpty" if zh => "这条消息没有可朗读的文本",
        "notice.audioSpeechEmpty" if es => "Este mensaje no tiene texto para leer en voz alta",
        "notice.audioSpeechEmpty" if hi => "इस संदेश में ज़ोर से पढ़ने के लिए कोई पाठ नहीं है",
        "notice.audioSpeechEmpty" if ar => "لا تحتوي هذه الرسالة على نص لقراءته بصوت عالٍ",
        "notice.audioSpeechEmpty" if pt => "Esta mensagem não tem texto para ler em voz alta",
        "notice.audioSpeechEmpty" if ru => "В этом сообщении нет текста для озвучивания",
        "notice.audioSpeechEmpty" if fr => "Ce message n'a pas de texte à lire à voix haute",
        "notice.audioSpeechEmpty" if ja => "このメッセージには読み上げるテキストがありません",
        "notice.audioSpeechEmpty" if ko => "이 메시지에는 소리 내어 읽을 텍스트가 없습니다",
        "notice.audioSpeechEmpty" => "This message has no text to read aloud",
        "notice.audioSpeechFailed" if zh => "无法播放音频：{message}",
        "notice.audioSpeechFailed" if es => "No se pudo reproducir el audio: {message}",
        "notice.audioSpeechFailed" if hi => "ऑडियो चलाया नहीं जा सका: {message}",
        "notice.audioSpeechFailed" if ar => "تعذر تشغيل الصوت: {message}",
        "notice.audioSpeechFailed" if pt => "Não foi possível reproduzir o áudio: {message}",
        "notice.audioSpeechFailed" if ru => "Не удалось воспроизвести аудио: {message}",
        "notice.audioSpeechFailed" if fr => "Impossible de lire l'audio: {message}",
        "notice.audioSpeechFailed" if ja => "音声を再生できませんでした: {message}",
        "notice.audioSpeechFailed" if ko => "오디오를 재생할 수 없습니다: {message}",
        "notice.audioSpeechFailed" => "Could not play audio: {message}",
        "notice.audioSpeechPlaying" if zh => "正在使用 {model} 播放语音",
        "notice.audioSpeechPlaying" if es => "Reproduciendo audio con {model}",
        "notice.audioSpeechPlaying" if hi => "{model} से ऑडियो चल रहा है",
        "notice.audioSpeechPlaying" if ar => "جارٍ تشغيل الصوت باستخدام {model}",
        "notice.audioSpeechPlaying" if pt => "Reproduzindo áudio com {model}",
        "notice.audioSpeechPlaying" if ru => "Воспроизведение аудио через {model}",
        "notice.audioSpeechPlaying" if fr => "Lecture audio avec {model}",
        "notice.audioSpeechPlaying" if ja => "{model} で音声を再生しています",
        "notice.audioSpeechPlaying" if ko => "{model}로 오디오 재생 중",
        "notice.audioSpeechPlaying" => "Playing audio with {model}",
        "notice.audioSpeechStopped" if zh => "已停止朗读",
        "notice.audioSpeechStopped" if es => "Reproducción de audio detenida",
        "notice.audioSpeechStopped" if hi => "ऑडियो प्लेबैक रोक दिया गया",
        "notice.audioSpeechStopped" if ar => "تم إيقاف تشغيل الصوت",
        "notice.audioSpeechStopped" if pt => "Reprodução de áudio interrompida",
        "notice.audioSpeechStopped" if ru => "Воспроизведение аудио остановлено",
        "notice.audioSpeechStopped" if fr => "Lecture audio arrêtée",
        "notice.audioSpeechStopped" if ja => "音声再生を停止しました",
        "notice.audioSpeechStopped" if ko => "오디오 재생이 중지되었습니다",
        "notice.audioSpeechStopped" => "Audio playback stopped",
        "message.imagePromptRequired" if zh => "请先描述图片。",
        "message.imagePromptRequired" if es => "Describe primero la imagen.",
        "message.imagePromptRequired" if hi => "पहले चित्र का वर्णन करें।",
        "message.imagePromptRequired" if ar => "صف الصورة أولا.",
        "message.imagePromptRequired" if pt => "Descreva a imagem primeiro.",
        "message.imagePromptRequired" if ru => "Сначала опишите изображение.",
        "message.imagePromptRequired" if fr => "Décrivez d'abord l'image.",
        "message.imagePromptRequired" if ja => "先に画像の説明を入力してください。",
        "message.imagePromptRequired" if ko => "먼저 이미지 설명을 입력하세요.",
        "message.imagePromptRequired" => "Describe the image first.",
        "message.imageProviderRequired" if zh => "图片需要选择 OpenAI 兼容服务商。",
        "message.imageProviderRequired" if es => {
            "Elige un proveedor compatible con OpenAI para imágenes."
        }
        "message.imageProviderRequired" if hi => "चित्रों के लिए OpenAI-संगत प्रदाता चुनें।",
        "message.imageProviderRequired" if ar => "اختر موفرا متوافقا مع OpenAI للصور.",
        "message.imageProviderRequired" if pt => {
            "Escolha um provedor compatível com OpenAI para imagens."
        }
        "message.imageProviderRequired" if ru => {
            "Выберите OpenAI-совместимого провайдера для изображений."
        }
        "message.imageProviderRequired" if fr => {
            "Choisissez un fournisseur compatible OpenAI pour les images."
        }
        "message.imageProviderRequired" if ja => {
            "画像には OpenAI 互換プロバイダーを選択してください。"
        }
        "message.imageProviderRequired" if ko => "이미지에는 OpenAI 호환 공급자를 선택하세요.",
        "message.imageProviderRequired" => "Choose an OpenAI-compatible provider for images.",
        "message.imageReadFailedPrefix" if zh => "无法读取图片",
        "message.imageReadFailedPrefix" if es => "No se pudo leer la imagen",
        "message.imageReadFailedPrefix" if hi => "चित्र पढ़ा नहीं जा सका",
        "message.imageReadFailedPrefix" if ar => "تعذر قراءة الصورة",
        "message.imageReadFailedPrefix" if pt => "Não foi possível ler a imagem",
        "message.imageReadFailedPrefix" if ru => "Не удалось прочитать изображение",
        "message.imageReadFailedPrefix" if fr => "Impossible de lire l'image",
        "message.imageReadFailedPrefix" if ja => "画像を読み込めませんでした",
        "message.imageReadFailedPrefix" if ko => "이미지를 읽을 수 없습니다",
        "message.imageReadFailedPrefix" => "Could not read image",
        "message.fileTooLarge" if zh => "文件超过 {maxMb} MB 上限。",
        "message.fileTooLarge" if es => "El archivo supera el límite de {maxMb} MB.",
        "message.fileTooLarge" if hi => "फ़ाइल {maxMb} MB की सीमा से बड़ी है।",
        "message.fileTooLarge" if ar => "يتجاوز الملف حد {maxMb} ميغابايت.",
        "message.fileTooLarge" if pt => "O arquivo excede o limite de {maxMb} MB.",
        "message.fileTooLarge" if ru => "Файл превышает лимит {maxMb} МБ.",
        "message.fileTooLarge" if fr => "Le fichier dépasse la limite de {maxMb} Mo.",
        "message.fileTooLarge" if ja => "ファイルが {maxMb} MB の上限を超えています。",
        "message.fileTooLarge" if ko => "파일이 {maxMb}MB 제한을 초과합니다.",
        "message.fileTooLarge" => "File exceeds the {maxMb} MB limit.",
        "message.imageRequestFailed" if zh => "图片请求失败",
        "message.imageRequestFailed" if es => "Error de solicitud de imagen",
        "message.imageRequestFailed" if hi => "चित्र अनुरोध विफल",
        "message.imageRequestFailed" if ar => "فشل طلب الصورة",
        "message.imageRequestFailed" if pt => "Falha na solicitação de imagem",
        "message.imageRequestFailed" if ru => "Ошибка запроса изображения",
        "message.imageRequestFailed" if fr => "Échec de la requête d'image",
        "message.imageRequestFailed" if ja => "画像リクエストに失敗しました",
        "message.imageRequestFailed" if ko => "이미지 요청 실패",
        "message.imageRequestFailed" => "Image request failed",
        "message.sourceImageRequired" if zh => "请先选择源图片。",
        "message.sourceImageRequired" if es => "Elige primero una imagen de origen.",
        "message.sourceImageRequired" if hi => "पहले स्रोत चित्र चुनें।",
        "message.sourceImageRequired" if ar => "اختر الصورة المصدر أولا.",
        "message.sourceImageRequired" if pt => "Escolha primeiro uma imagem de origem.",
        "message.sourceImageRequired" if ru => "Сначала выберите исходное изображение.",
        "message.sourceImageRequired" if fr => "Choisissez d'abord une image source.",
        "message.sourceImageRequired" if ja => "先に元画像を選択してください。",
        "message.sourceImageRequired" if ko => "먼저 원본 이미지를 선택하세요.",
        "message.sourceImageRequired" => "Choose a source image first.",
        "message.maskImageRequired" if zh => "请先选择遮罩图片。",
        "message.maskImageRequired" if es => "Elige primero una máscara.",
        "message.maskImageRequired" if hi => "पहले मास्क चित्र चुनें।",
        "message.maskImageRequired" if ar => "اختر صورة القناع أولا.",
        "message.maskImageRequired" if pt => "Escolha primeiro uma máscara.",
        "message.maskImageRequired" if ru => "Сначала выберите маску.",
        "message.maskImageRequired" if fr => "Choisissez d'abord une image de masque.",
        "message.maskImageRequired" if ja => "先にマスク画像を選択してください。",
        "message.maskImageRequired" if ko => "먼저 마스크 이미지를 선택하세요.",
        "message.maskImageRequired" => "Choose a mask image first.",
        "message.generationFailed" if zh => "生成失败：{message}",
        "message.generationFailed" if es => "Error de generación: {message}",
        "message.generationFailed" if hi => "जनरेशन विफल: {message}",
        "message.generationFailed" if ar => "فشل التوليد: {message}",
        "message.generationFailed" if pt => "Falha na geração: {message}",
        "message.generationFailed" if ru => "Ошибка генерации: {message}",
        "message.generationFailed" if fr => "Échec de la génération: {message}",
        "message.generationFailed" if ja => "生成に失敗しました: {message}",
        "message.generationFailed" if ko => "생성 실패: {message}",
        "message.generationFailed" => "Generation failed: {message}",
        "message.modelRequired" if zh => "请先启用服务商并至少添加一个模型。",
        "message.modelRequired" if es => "Activa un proveedor y añade al menos un modelo primero.",
        "message.modelRequired" if hi => "पहले प्रदाता सक्षम करें और कम से कम एक मॉडल जोड़ें।",
        "message.modelRequired" if ar => "فعّل موفرا وأضف نموذجا واحدا على الأقل أولا.",
        "message.modelRequired" if pt => {
            "Ative um provedor e adicione pelo menos um modelo primeiro."
        }
        "message.modelRequired" if ru => {
            "Сначала включите провайдера и добавьте хотя бы одну модель."
        }
        "message.modelRequired" if fr => {
            "Activez d'abord un fournisseur et ajoutez au moins un modèle."
        }
        "message.modelRequired" if ja => {
            "先にプロバイダーを有効にし、少なくとも 1 つのモデルを追加してください。"
        }
        "message.modelRequired" if ko => "먼저 공급자를 활성화하고 모델을 하나 이상 추가하세요.",
        "message.modelRequired" => "Enable a provider and add at least one model first.",
        "message.noEnabledProvider" if zh => "没有启用的服务商",
        "message.noEnabledProvider" if es => "No hay proveedor activo",
        "message.noEnabledProvider" if hi => "कोई सक्षम प्रदाता नहीं",
        "message.noEnabledProvider" if ar => "لا يوجد موفر مفعّل",
        "message.noEnabledProvider" if pt => "Nenhum provedor ativado",
        "message.noEnabledProvider" if ru => "Нет включенного провайдера",
        "message.noEnabledProvider" if fr => "Aucun fournisseur activé",
        "message.noEnabledProvider" if ja => "有効なプロバイダーがありません",
        "message.noEnabledProvider" if ko => "활성화된 공급자 없음",
        "message.noEnabledProvider" => "No enabled provider",
        "message.providerEmptyResponse" if zh => "服务商返回了空回复。",
        "message.providerEmptyResponse" if es => "El proveedor devolvió una respuesta vacía.",
        "message.providerEmptyResponse" if hi => "प्रदाता ने खाली जवाब लौटाया।",
        "message.providerEmptyResponse" if ar => "أعاد الموفر ردا فارغا.",
        "message.providerEmptyResponse" if pt => "O provedor retornou uma resposta vazia.",
        "message.providerEmptyResponse" if ru => "Провайдер вернул пустой ответ.",
        "message.providerEmptyResponse" if fr => "Le fournisseur a renvoyé une réponse vide.",
        "message.providerEmptyResponse" if ja => "プロバイダーが空の応答を返しました。",
        "message.providerEmptyResponse" if ko => "공급자가 빈 응답을 반환했습니다.",
        "message.providerEmptyResponse" => "The provider returned an empty response.",
        "message.skillContextIntro" if zh => {
            "以下是用户启用的相关技能片段。回答时优先遵守，但不要逐字复述。"
        }
        "message.skillContextIntro" if es => {
            "Estos son fragmentos de habilidades relevantes activadas por el usuario. Síguelos al responder sin repetirlos literalmente."
        }
        "message.skillContextIntro" if hi => {
            "ये उपयोगकर्ता द्वारा सक्षम संबंधित कौशल अंश हैं। उत्तर देते समय इन्हें मानें, पर शब्दशः न दोहराएं।"
        }
        "message.skillContextIntro" if ar => {
            "هذه مقتطفات مهارات ذات صلة فعّلها المستخدم. اتبعها في الرد دون تكرارها حرفيا."
        }
        "message.skillContextIntro" if pt => {
            "Estes são trechos de habilidades relevantes ativadas pelo usuário. Siga-os ao responder sem repeti-los literalmente."
        }
        "message.skillContextIntro" if ru => {
            "Это релевантные фрагменты навыков, включенные пользователем. Учитывайте их в ответе, но не повторяйте дословно."
        }
        "message.skillContextIntro" if fr => {
            "Voici des extraits de compétences pertinentes activées par l'utilisateur. Respectez-les sans les répéter mot pour mot."
        }
        "message.skillContextIntro" if ja => {
            "ユーザーが有効にした関連スキルの抜粋です。回答では従い、全文をそのまま繰り返さないでください。"
        }
        "message.skillContextIntro" if ko => {
            "사용자가 켠 관련 스킬 조각입니다. 답변할 때 우선 따르되 그대로 반복하지 마세요."
        }
        "message.skillContextIntro" => {
            "These are relevant user-enabled skill snippets. Follow them when answering without repeating them verbatim."
        }
        "message.imageAttached" if zh => "已附加图片",
        "message.imageAttached" if es => "Imagen adjunta",
        "message.imageAttached" if hi => "चित्र संलग्न है",
        "message.imageAttached" if ar => "الصورة مرفقة",
        "message.imageAttached" if pt => "Imagem anexada",
        "message.imageAttached" if ru => "Изображение прикреплено",
        "message.imageAttached" if fr => "Image jointe",
        "message.imageAttached" if ja => "画像が添付されています",
        "message.imageAttached" if ko => "이미지가 첨부됨",
        "message.imageAttached" => "Image attached",
        "message.backupEncryptedHint" if zh => {
            "加密备份使用此数据密码。导入会在确认后替换本地数据。"
        }
        "message.backupEncryptedHint" if es => {
            "Las copias cifradas usan esta contraseña de datos. Importar reemplaza los datos locales tras confirmar."
        }
        "message.backupEncryptedHint" if hi => {
            "एन्क्रिप्टेड बैकअप इसी डेटा पासवर्ड का उपयोग करते हैं। पुष्टि के बाद आयात स्थानीय डेटा बदल देगा।"
        }
        "message.backupEncryptedHint" if ar => {
            "تستخدم النسخ المشفرة كلمة مرور البيانات هذه. الاستيراد يستبدل البيانات المحلية بعد التأكيد."
        }
        "message.backupEncryptedHint" if pt => {
            "Backups criptografados usam esta senha de dados. Importar substitui os dados locais após confirmação."
        }
        "message.backupEncryptedHint" if ru => {
            "Зашифрованные копии используют этот пароль данных. Импорт заменит локальные данные после подтверждения."
        }
        "message.backupEncryptedHint" if fr => {
            "Les sauvegardes chiffrées utilisent ce mot de passe de données. L’import remplace les données locales après confirmation."
        }
        "message.backupEncryptedHint" if ja => {
            "暗号化バックアップはこのデータパスワードを使います。インポートは確認後にローカルデータを置き換えます。"
        }
        "message.backupEncryptedHint" if ko => {
            "암호화 백업은 이 데이터 비밀번호를 사용합니다. 가져오기는 확인 후 로컬 데이터를 바꿉니다."
        }
        "message.backupEncryptedHint" => {
            "Encrypted backups use this data password. Import replaces local data after confirmation."
        }
        "danger.import.title" if zh => "导入会覆盖当前数据",
        "danger.import.title" if es => "La importación sobrescribirá los datos actuales",
        "danger.import.title" if hi => "आयात मौजूदा डेटा को बदल देगा",
        "danger.import.title" if ar => "سيستبدل الاستيراد البيانات الحالية",
        "danger.import.title" if pt => "A importação substituirá os dados atuais",
        "danger.import.title" if ru => "Импорт перезапишет текущие данные",
        "danger.import.title" if fr => "L’import remplacera les données actuelles",
        "danger.import.title" if ja => "インポートは現在のデータを上書きします",
        "danger.import.title" if ko => "가져오기는 현재 데이터를 덮어씁니다",
        "danger.import.title" => "Import will overwrite current data",
        "danger.import.body" if zh => {
            "导入加密备份会替换本地聊天、服务商、设置和同步的服务商密钥。"
        }
        "danger.import.body" if es => {
            "Importar una copia cifrada reemplaza chats, proveedores, ajustes y claves de proveedor sincronizadas."
        }
        "danger.import.body" if hi => {
            "एन्क्रिप्टेड बैकअप आयात करने से स्थानीय चैट, प्रदाता, सेटिंग्स और सिंक की गई प्रदाता कुंजियां बदल जाती हैं।"
        }
        "danger.import.body" if ar => {
            "استيراد نسخة مشفرة يستبدل الدردشات والموفرين والإعدادات ومفاتيح الموفر المتزامنة."
        }
        "danger.import.body" if pt => {
            "Importar um backup criptografado substitui chats, provedores, configurações e chaves de provedor sincronizadas."
        }
        "danger.import.body" if ru => {
            "Импорт зашифрованной копии заменяет локальные чаты, провайдеров, настройки и синхронизированные ключи провайдеров."
        }
        "danger.import.body" if fr => {
            "Importer une sauvegarde chiffrée remplace les discussions, fournisseurs, réglages et clés de fournisseur synchronisées."
        }
        "danger.import.body" if ja => {
            "暗号化バックアップを読み込むと、ローカルのチャット、プロバイダー、設定、同期されたプロバイダーキーが置き換えられます。"
        }
        "danger.import.body" if ko => {
            "암호화 백업을 가져오면 로컬 채팅, 공급자, 설정, 동기화된 공급자 키가 바뀝니다."
        }
        "danger.import.body" => {
            "Importing an encrypted backup replaces local chats, providers, settings, and synced provider keys."
        }
        "danger.import.detail1" if zh => {
            "如果导入的数据开启了云同步，之后同步可能会用它覆盖云端副本。"
        }
        "danger.import.detail1" if es => {
            "Si los datos importados tienen sincronización en la nube, las próximas sincronizaciones pueden sobrescribir la copia en la nube."
        }
        "danger.import.detail1" if hi => {
            "अगर आयातित डेटा में क्लाउड सिंक चालू है, तो आगे के सिंक क्लाउड कॉपी को इससे बदल सकते हैं।"
        }
        "danger.import.detail1" if ar => {
            "إذا كانت المزامنة السحابية مفعلة للبيانات المستوردة، فقد تستبدل المزامنات التالية النسخة السحابية بها."
        }
        "danger.import.detail1" if pt => {
            "Se os dados importados tiverem sincronização em nuvem, sincronizações futuras podem substituir a cópia na nuvem por eles."
        }
        "danger.import.detail1" if ru => {
            "Если у импортированных данных включена облачная синхронизация, следующие синхронизации могут перезаписать облачную копию."
        }
        "danger.import.detail1" if fr => {
            "Si les données importées ont la synchronisation cloud activée, les prochaines synchronisations peuvent remplacer la copie cloud."
        }
        "danger.import.detail1" if ja => {
            "読み込んだデータでクラウド同期が有効な場合、以後の同期でクラウド側がこのデータに置き換わることがあります。"
        }
        "danger.import.detail1" if ko => {
            "가져온 데이터에 클라우드 동기화가 켜져 있으면 이후 동기화가 클라우드 복사본을 이 데이터로 바꿀 수 있습니다."
        }
        "danger.import.detail1" => {
            "If cloud sync is enabled for the imported data, later syncs may overwrite the cloud copy with it."
        }
        "danger.import.detail2" if zh => "未备份的本地改动可能无法恢复。",
        "danger.import.detail2" if es => "Los cambios locales no guardados pueden no recuperarse.",
        "danger.import.detail2" if hi => "बिना सहेजे स्थानीय बदलाव वापस नहीं मिल सकते।",
        "danger.import.detail2" if ar => "قد لا يمكن استرداد التغييرات المحلية غير المحفوظة.",
        "danger.import.detail2" if pt => "Alterações locais não salvas podem não ser recuperáveis.",
        "danger.import.detail2" if ru => {
            "Несохраненные локальные изменения могут быть невосстановимы."
        }
        "danger.import.detail2" if fr => {
            "Les modifications locales non enregistrées peuvent ne pas être récupérables."
        }
        "danger.import.detail2" if ja => "保存していないローカル変更は復元できない場合があります。",
        "danger.import.detail2" if ko => {
            "저장되지 않은 로컬 변경 사항은 복구하지 못할 수 있습니다."
        }
        "danger.import.detail2" => "Unsaved local changes may not be recoverable.",
        "danger.import.detail3" if zh => "导入前请先导出一份当前数据的加密备份。",
        "danger.import.detail3" if es => {
            "Exporta una copia cifrada de los datos actuales antes de importar."
        }
        "danger.import.detail3" if hi => "आयात से पहले वर्तमान डेटा का एन्क्रिप्टेड बैकअप निर्यात करें।",
        "danger.import.detail3" if ar => "صدّر نسخة مشفرة من البيانات الحالية قبل الاستيراد.",
        "danger.import.detail3" if pt => {
            "Exporte um backup criptografado dos dados atuais antes de importar."
        }
        "danger.import.detail3" if ru => {
            "Перед импортом экспортируйте зашифрованную копию текущих данных."
        }
        "danger.import.detail3" if fr => {
            "Exportez une sauvegarde chiffrée des données actuelles avant d’importer."
        }
        "danger.import.detail3" if ja => {
            "インポート前に現在のデータの暗号化バックアップを書き出してください。"
        }
        "danger.import.detail3" if ko => "가져오기 전에 현재 데이터의 암호화 백업을 내보내세요.",
        "danger.import.detail3" => {
            "Export an encrypted backup of the current data before importing."
        }
        "notice.backupExportNeedsPassphrase" if zh => "请先输入数据加密密码，再导出加密备份。",
        "notice.backupExportNeedsPassphrase" if es => {
            "Introduce la contraseña de datos antes de exportar una copia cifrada."
        }
        "notice.backupExportNeedsPassphrase" if hi => {
            "एन्क्रिप्टेड बैकअप निर्यात करने से पहले डेटा पासवर्ड दर्ज करें।"
        }
        "notice.backupExportNeedsPassphrase" if ar => {
            "أدخل كلمة مرور البيانات قبل تصدير نسخة مشفرة."
        }
        "notice.backupExportNeedsPassphrase" if pt => {
            "Digite a senha de dados antes de exportar um backup criptografado."
        }
        "notice.backupExportNeedsPassphrase" if ru => {
            "Введите пароль данных перед экспортом зашифрованной копии."
        }
        "notice.backupExportNeedsPassphrase" if fr => {
            "Saisissez le mot de passe des données avant d’exporter une sauvegarde chiffrée."
        }
        "notice.backupExportNeedsPassphrase" if ja => {
            "暗号化バックアップを書き出す前にデータパスワードを入力してください。"
        }
        "notice.backupExportNeedsPassphrase" if ko => {
            "암호화 백업을 내보내기 전에 데이터 비밀번호를 입력하세요."
        }
        "notice.backupExportNeedsPassphrase" => {
            "Enter the data encryption password before exporting an encrypted backup."
        }
        "notice.backupExportStarted" if zh => "加密备份已保存。",
        "notice.backupExportStarted" if es => "Copia cifrada guardada.",
        "notice.backupExportStarted" if hi => "एन्क्रिप्टेड बैकअप सहेजा गया।",
        "notice.backupExportStarted" if ar => "تم حفظ النسخة المشفرة.",
        "notice.backupExportStarted" if pt => "Backup criptografado salvo.",
        "notice.backupExportStarted" if ru => "Зашифрованная копия сохранена.",
        "notice.backupExportStarted" if fr => "Sauvegarde chiffrée enregistrée.",
        "notice.backupExportStarted" if ja => "暗号化バックアップを保存しました。",
        "notice.backupExportStarted" if ko => "암호화 백업을 저장했습니다.",
        "notice.backupExportStarted" => "Encrypted backup saved.",
        "notice.backupExportFailedPrefix" if zh => "备份导出失败",
        "notice.backupExportFailedPrefix" if es => "Error al exportar la copia",
        "notice.backupExportFailedPrefix" if hi => "बैकअप निर्यात विफल",
        "notice.backupExportFailedPrefix" if ar => "فشل تصدير النسخة",
        "notice.backupExportFailedPrefix" if pt => "Falha ao exportar backup",
        "notice.backupExportFailedPrefix" if ru => "Не удалось экспортировать копию",
        "notice.backupExportFailedPrefix" if fr => "Échec de l’export de sauvegarde",
        "notice.backupExportFailedPrefix" if ja => "バックアップの書き出しに失敗しました",
        "notice.backupExportFailedPrefix" if ko => "백업 내보내기 실패",
        "notice.backupExportFailedPrefix" => "Backup export failed",
        "notice.backupImportNeedsPassphrase" if zh => "请先输入数据加密密码，再导入加密备份。",
        "notice.backupImportNeedsPassphrase" if es => {
            "Introduce la contraseña de datos antes de importar una copia cifrada."
        }
        "notice.backupImportNeedsPassphrase" if hi => {
            "एन्क्रिप्टेड बैकअप आयात करने से पहले डेटा पासवर्ड दर्ज करें।"
        }
        "notice.backupImportNeedsPassphrase" if ar => {
            "أدخل كلمة مرور البيانات قبل استيراد نسخة مشفرة."
        }
        "notice.backupImportNeedsPassphrase" if pt => {
            "Digite a senha de dados antes de importar um backup criptografado."
        }
        "notice.backupImportNeedsPassphrase" if ru => {
            "Введите пароль данных перед импортом зашифрованной копии."
        }
        "notice.backupImportNeedsPassphrase" if fr => {
            "Saisissez le mot de passe des données avant d’importer une sauvegarde chiffrée."
        }
        "notice.backupImportNeedsPassphrase" if ja => {
            "暗号化バックアップを読み込む前にデータパスワードを入力してください。"
        }
        "notice.backupImportNeedsPassphrase" if ko => {
            "암호화 백업을 가져오기 전에 데이터 비밀번호를 입력하세요."
        }
        "notice.backupImportNeedsPassphrase" => {
            "Enter the data encryption password before importing an encrypted backup."
        }
        "notice.backupImportEncryptedOnly" if zh => "只能导入 ZeroChat 加密备份。",
        "notice.backupImportEncryptedOnly" if es => {
            "Solo se pueden importar copias cifradas de ZeroChat."
        }
        "notice.backupImportEncryptedOnly" if hi => "केवल ZeroChat एन्क्रिप्टेड बैकअप आयात किए जा सकते हैं।",
        "notice.backupImportEncryptedOnly" if ar => "يمكن استيراد نسخ ZeroChat المشفرة فقط.",
        "notice.backupImportEncryptedOnly" if pt => {
            "Somente backups criptografados do ZeroChat podem ser importados."
        }
        "notice.backupImportEncryptedOnly" if ru => {
            "Можно импортировать только зашифрованные копии ZeroChat."
        }
        "notice.backupImportEncryptedOnly" if fr => {
            "Seules les sauvegardes chiffrées ZeroChat peuvent être importées."
        }
        "notice.backupImportEncryptedOnly" if ja => {
            "ZeroChat の暗号化バックアップのみ読み込めます。"
        }
        "notice.backupImportEncryptedOnly" if ko => "ZeroChat 암호화 백업만 가져올 수 있습니다.",
        "notice.backupImportEncryptedOnly" => "Only ZeroChat encrypted backups can be imported.",
        "notice.backupImportFormatInvalid" if zh => "文件格式不正确。",
        "notice.backupImportFormatInvalid" if es => "El formato de archivo no es válido.",
        "notice.backupImportFormatInvalid" if hi => "फ़ाइल प्रारूप अमान्य है।",
        "notice.backupImportFormatInvalid" if ar => "تنسيق الملف غير صالح.",
        "notice.backupImportFormatInvalid" if pt => "Formato de arquivo inválido.",
        "notice.backupImportFormatInvalid" if ru => "Недопустимый формат файла.",
        "notice.backupImportFormatInvalid" if fr => "Format de fichier invalide.",
        "notice.backupImportFormatInvalid" if ja => "ファイル形式が無効です。",
        "notice.backupImportFormatInvalid" if ko => "파일 형식이 잘못되었습니다.",
        "notice.backupImportFormatInvalid" => "File format is invalid.",
        "notice.backupImportFailedPrefix" if zh => "备份导入失败",
        "notice.backupImportFailedPrefix" if es => "Error al importar la copia",
        "notice.backupImportFailedPrefix" if hi => "बैकअप आयात विफल",
        "notice.backupImportFailedPrefix" if ar => "فشل استيراد النسخة",
        "notice.backupImportFailedPrefix" if pt => "Falha ao importar backup",
        "notice.backupImportFailedPrefix" if ru => "Не удалось импортировать копию",
        "notice.backupImportFailedPrefix" if fr => "Échec de l’import de sauvegarde",
        "notice.backupImportFailedPrefix" if ja => "バックアップの読み込みに失敗しました",
        "notice.backupImportFailedPrefix" if ko => "백업 가져오기 실패",
        "notice.backupImportFailedPrefix" => "Backup import failed",
        "notice.backupImported" if zh => "已导入加密备份。",
        "notice.backupImported" if es => "Copia cifrada importada.",
        "notice.backupImported" if hi => "एन्क्रिप्टेड बैकअप आयात किया गया।",
        "notice.backupImported" if ar => "تم استيراد النسخة المشفرة.",
        "notice.backupImported" if pt => "Backup criptografado importado.",
        "notice.backupImported" if ru => "Зашифрованная копия импортирована.",
        "notice.backupImported" if fr => "Sauvegarde chiffrée importée.",
        "notice.backupImported" if ja => "暗号化バックアップを読み込みました。",
        "notice.backupImported" if ko => "암호화 백업을 가져왔습니다.",
        "notice.backupImported" => "Encrypted backup imported.",
        "message.chooseCloudflareSync" if zh => "请先选择 Cloudflare 同步。",
        "message.chooseCloudflareSync" if es => "Elige primero sincronización Cloudflare.",
        "message.chooseCloudflareSync" if hi => "पहले Cloudflare sync चुनें।",
        "message.chooseCloudflareSync" if ar => "اختر مزامنة Cloudflare أولا.",
        "message.chooseCloudflareSync" if pt => "Escolha sync Cloudflare primeiro.",
        "message.chooseCloudflareSync" if ru => "Сначала выберите синхронизацию Cloudflare.",
        "message.chooseCloudflareSync" if fr => "Choisissez d’abord la sync Cloudflare.",
        "message.chooseCloudflareSync" if ja => "先に Cloudflare 同期を選んでください。",
        "message.chooseCloudflareSync" if ko => "먼저 Cloudflare 동기화를 선택하세요.",
        "message.chooseCloudflareSync" => "Choose Cloudflare sync first.",
        "error.syncGithubTokenRequired" if zh => "请先填写 GitHub 令牌。",
        "error.syncGithubTokenRequired" if es => "Introduce primero el token de GitHub.",
        "error.syncGithubTokenRequired" if hi => "सबसे पहले GitHub टोकन दर्ज करें।",
        "error.syncGithubTokenRequired" if ar => "أدخل رمز GitHub أولا.",
        "error.syncGithubTokenRequired" if pt => "Insira o token do GitHub primeiro.",
        "error.syncGithubTokenRequired" if ru => "Сначала введите токен GitHub.",
        "error.syncGithubTokenRequired" if fr => "Entrez d'abord le jeton GitHub.",
        "error.syncGithubTokenRequired" if ja => "最初に GitHub トークンを入力してください。",
        "error.syncGithubTokenRequired" if ko => "GitHub 토큰을 먼저 입력하세요.",
        "error.syncGithubTokenRequired" => "Enter the GitHub token first.",
        "message.cloudflareWorkerAndPasswordRequired" if zh => {
            "需要 Cloudflare Worker 地址和数据加密密码。"
        }
        "message.cloudflareWorkerAndPasswordRequired" if es => {
            "Se requieren la URL de Cloudflare Worker y la contraseña de cifrado de datos."
        }
        "message.cloudflareWorkerAndPasswordRequired" if hi => {
            "Cloudflare Worker URL और डेटा एन्क्रिप्शन पासवर्ड जरूरी हैं।"
        }
        "message.cloudflareWorkerAndPasswordRequired" if ar => {
            "رابط Cloudflare Worker وكلمة مرور تشفير البيانات مطلوبان."
        }
        "message.cloudflareWorkerAndPasswordRequired" if pt => {
            "URL do Cloudflare Worker e senha de criptografia de dados são obrigatórias."
        }
        "message.cloudflareWorkerAndPasswordRequired" if ru => {
            "Требуются URL Cloudflare Worker и пароль шифрования данных."
        }
        "message.cloudflareWorkerAndPasswordRequired" if fr => {
            "L’URL Cloudflare Worker et le mot de passe de chiffrement des données sont requis."
        }
        "message.cloudflareWorkerAndPasswordRequired" if ja => {
            "Cloudflare Worker URL とデータ暗号化パスワードが必要です。"
        }
        "message.cloudflareWorkerAndPasswordRequired" if ko => {
            "Cloudflare Worker URL과 데이터 암호화 비밀번호가 필요합니다."
        }
        "message.cloudflareWorkerAndPasswordRequired" => {
            "Cloudflare Worker URL and data encryption password are required."
        }
        "message.cloudflareWorkerRequired" if zh => "需要填写 Cloudflare Worker 地址。",
        "message.cloudflareWorkerRequired" if es => "La URL de Cloudflare Worker es obligatoria.",
        "message.cloudflareWorkerRequired" if hi => "Cloudflare Worker URL जरूरी है।",
        "message.cloudflareWorkerRequired" if ar => "رابط Cloudflare Worker مطلوب.",
        "message.cloudflareWorkerRequired" if pt => "A URL do Cloudflare Worker é obrigatória.",
        "message.cloudflareWorkerRequired" if ru => "Требуется URL Cloudflare Worker.",
        "message.cloudflareWorkerRequired" if fr => "L’URL Cloudflare Worker est requise.",
        "message.cloudflareWorkerRequired" if ja => "Cloudflare Worker URL が必要です。",
        "message.cloudflareWorkerRequired" if ko => "Cloudflare Worker URL이 필요합니다.",
        "message.cloudflareWorkerRequired" => "Cloudflare Worker URL is required.",
        "message.cloudClearFailedPrefix" if zh => "清除云端失败",
        "message.cloudClearFailedPrefix" if es => "Error al borrar la nube",
        "message.cloudClearFailedPrefix" if hi => "क्लाउड साफ़ करने में विफल",
        "message.cloudClearFailedPrefix" if ar => "فشل مسح السحابة",
        "message.cloudClearFailedPrefix" if pt => "Falha ao limpar a nuvem",
        "message.cloudClearFailedPrefix" if ru => "Не удалось очистить облако",
        "message.cloudClearFailedPrefix" if fr => "Échec de l’effacement cloud",
        "message.cloudClearFailedPrefix" if ja => "クラウド消去に失敗しました",
        "message.cloudClearFailedPrefix" if ko => "클라우드 삭제 실패",
        "message.cloudClearFailedPrefix" => "Cloud clear failed",
        "message.cloudSyncCleared" if zh => "云端同步数据已清空",
        "message.cloudSyncCleared" if es => "Los datos de sincronización en la nube se borraron",
        "message.cloudSyncCleared" if hi => "क्लाउड सिंक डेटा साफ़ किया गया",
        "message.cloudSyncCleared" if ar => "تم مسح بيانات المزامنة السحابية",
        "message.cloudSyncCleared" if pt => "Dados de sincronização na nuvem limpos",
        "message.cloudSyncCleared" if ru => "Данные облачной синхронизации удалены",
        "message.cloudSyncCleared" if fr => "Données de synchronisation cloud effacées",
        "message.cloudSyncCleared" if ja => "クラウド同期データはクリアされました",
        "message.cloudSyncCleared" if ko => "클라우드 동기화 데이터가 지워졌습니다.",
        "message.cloudSyncCleared" => "Cloud sync data cleared",
        "danger.resetLocalData.title" if zh => "重置本机数据",
        "danger.resetLocalData.title" if es => "Restablecer datos locales",
        "danger.resetLocalData.title" if hi => "स्थानीय डेटा रीसेट करें",
        "danger.resetLocalData.title" if ar => "إعادة تعيين البيانات المحلية",
        "danger.resetLocalData.title" if pt => "Redefinir dados locais",
        "danger.resetLocalData.title" if ru => "Сбросить локальные данные",
        "danger.resetLocalData.title" if fr => "Réinitialiser les données locales",
        "danger.resetLocalData.title" if ja => "ローカルデータをリセット",
        "danger.resetLocalData.title" if ko => "로컬 데이터 초기화",
        "danger.resetLocalData.title" => "Reset local data",
        "danger.resetLocalData.body" if zh => {
            "将清空本机聊天、设置、服务商密钥、同步配置和数据加密密码。"
        }
        "danger.resetLocalData.body" if es => {
            "Esto borra chats locales, ajustes, claves de proveedor, configuración de sincronización y contraseña de cifrado."
        }
        "danger.resetLocalData.body" if hi => {
            "यह स्थानीय चैट, सेटिंग्स, प्रदाता कुंजियां, सिंक सेटअप और एन्क्रिप्शन पासवर्ड मिटाता है।"
        }
        "danger.resetLocalData.body" if ar => {
            "يمسح هذا الدردشات المحلية والإعدادات ومفاتيح المزود وإعدادات المزامنة وكلمة مرور التشفير."
        }
        "danger.resetLocalData.body" if pt => {
            "Isso limpa chats locais, configurações, chaves do provedor, configuração de sync e senha de criptografia."
        }
        "danger.resetLocalData.body" if ru => {
            "Будут удалены локальные чаты, настройки, ключи провайдера, параметры синхронизации и пароль шифрования."
        }
        "danger.resetLocalData.body" if fr => {
            "Cela efface les discussions locales, paramètres, clés fournisseur, réglages de sync et mot de passe de chiffrement."
        }
        "danger.resetLocalData.body" if ja => {
            "ローカルのチャット、設定、プロバイダーキー、同期設定、暗号化パスワードを消去します。"
        }
        "danger.resetLocalData.body" if ko => {
            "로컬 채팅, 설정, 공급자 키, 동기화 설정, 암호화 비밀번호를 지웁니다."
        }
        "danger.resetLocalData.body" => {
            "This clears local chats, settings, provider keys, sync configuration, and the data encryption password."
        }
        "danger.resetLocalData.detail1" if zh => "不会主动删除云端已保存的加密数据。",
        "danger.resetLocalData.detail1" if es => {
            "No elimina activamente los datos cifrados ya guardados en la nube."
        }
        "danger.resetLocalData.detail1" if hi => {
            "यह क्लाउड में रखे एन्क्रिप्टेड डेटा को सक्रिय रूप से नहीं हटाता है।"
        }
        "danger.resetLocalData.detail1" if ar => "لا يحذف هذا البيانات المشفرة المحفوظة في السحابة.",
        "danger.resetLocalData.detail1" if pt => {
            "Isso não exclui ativamente os dados criptografados já salvos na nuvem."
        }
        "danger.resetLocalData.detail1" if ru => {
            "Облачные зашифрованные данные не будут удалены автоматически."
        }
        "danger.resetLocalData.detail1" if fr => {
            "Cela ne supprime pas les données chiffrées déjà enregistrées dans le cloud."
        }
        "danger.resetLocalData.detail1" if ja => {
            "クラウドに保存済みの暗号化データは自動削除されません。"
        }
        "danger.resetLocalData.detail1" if ko => {
            "클라우드에 저장된 암호화 데이터는 자동으로 삭제되지 않습니다."
        }
        "danger.resetLocalData.detail1" => {
            "This does not actively delete encrypted data already saved in the cloud."
        }
        "danger.resetLocalData.detail2" if zh => "如果没有加密备份或数据密码，旧数据可能无法恢复。",
        "danger.resetLocalData.detail2" if es => {
            "Sin copia cifrada o contraseña de datos, quizá no puedas recuperar datos antiguos."
        }
        "danger.resetLocalData.detail2" if hi => {
            "एन्क्रिप्टेड बैकअप या डेटा पासवर्ड के बिना पुराना डेटा वापस नहीं आ सकता।"
        }
        "danger.resetLocalData.detail2" if ar => {
            "بدون نسخة مشفرة أو كلمة مرور البيانات قد لا يمكن استعادة البيانات القديمة."
        }
        "danger.resetLocalData.detail2" if pt => {
            "Sem backup criptografado ou senha de dados, dados antigos podem não ser recuperáveis."
        }
        "danger.resetLocalData.detail2" if ru => {
            "Без зашифрованной копии или пароля данных старые данные могут быть недоступны."
        }
        "danger.resetLocalData.detail2" if fr => {
            "Sans sauvegarde chiffrée ou mot de passe, les anciennes données peuvent être irrécupérables."
        }
        "danger.resetLocalData.detail2" if ja => {
            "暗号化バックアップまたはデータパスワードがないと、古いデータは復元できない場合があります。"
        }
        "danger.resetLocalData.detail2" if ko => {
            "암호화 백업이나 데이터 비밀번호가 없으면 이전 데이터를 복구하지 못할 수 있습니다."
        }
        "danger.resetLocalData.detail2" => {
            "Without an encrypted backup or data password, old data may not be recoverable."
        }
        "danger.resetLocalData.detail3" if zh => "重置后会回到初始本地状态。",
        "danger.resetLocalData.detail3" if es => {
            "Después del reinicio, ZeroChat vuelve al estado local inicial."
        }
        "danger.resetLocalData.detail3" if hi => {
            "रीसेट के बाद ZeroChat शुरुआती स्थानीय स्थिति में लौटता है।"
        }
        "danger.resetLocalData.detail3" if ar => {
            "بعد إعادة التعيين يعود ZeroChat إلى الحالة المحلية الأولى."
        }
        "danger.resetLocalData.detail3" if pt => {
            "Depois da redefinição, ZeroChat volta ao estado local inicial."
        }
        "danger.resetLocalData.detail3" if ru => {
            "После сброса ZeroChat вернется к начальному локальному состоянию."
        }
        "danger.resetLocalData.detail3" if fr => {
            "Après réinitialisation, ZeroChat revient à l'état local initial."
        }
        "danger.resetLocalData.detail3" if ja => {
            "リセット後、ZeroChat は初期ローカル状態に戻ります。"
        }
        "danger.resetLocalData.detail3" if ko => {
            "재설정 후 ZeroChat은 초기 로컬 상태로 돌아갑니다."
        }
        "danger.resetLocalData.detail3" => {
            "After reset, ZeroChat returns to the initial local state."
        }
        "danger.resetSyncPassword.title" if zh => "重置同步密码",
        "danger.resetSyncPassword.title" if es => "Restablecer contraseña de sincronización",
        "danger.resetSyncPassword.title" if hi => "सिंक पासवर्ड रीसेट करें",
        "danger.resetSyncPassword.title" if ar => "إعادة تعيين كلمة مرور المزامنة",
        "danger.resetSyncPassword.title" if pt => "Redefinir senha de sincronização",
        "danger.resetSyncPassword.title" if ru => "Сбросить пароль синхронизации",
        "danger.resetSyncPassword.title" if fr => {
            "Réinitialiser le mot de passe de synchronisation"
        }
        "danger.resetSyncPassword.title" if ja => "同期パスワードをリセット",
        "danger.resetSyncPassword.title" if ko => "동기화 비밀번호 초기화",
        "danger.resetSyncPassword.title" => "Reset sync password",
        "danger.resetSyncPassword.body" if zh => "这只会清除本机当前记住的数据加密密码。",
        "danger.resetSyncPassword.body" if es => {
            "Esto solo borra la contraseña de cifrado recordada en este dispositivo."
        }
        "danger.resetSyncPassword.body" if hi => {
            "यह केवल इस डिवाइस पर याद रखा एन्क्रिप्शन पासवर्ड हटाता है।"
        }
        "danger.resetSyncPassword.body" if ar => {
            "يمسح هذا فقط كلمة مرور التشفير المحفوظة على هذا الجهاز."
        }
        "danger.resetSyncPassword.body" if pt => {
            "Isso apenas limpa a senha de criptografia lembrada neste dispositivo."
        }
        "danger.resetSyncPassword.body" if ru => {
            "Это удалит только пароль шифрования, сохраненный на этом устройстве."
        }
        "danger.resetSyncPassword.body" if fr => {
            "Cela efface seulement le mot de passe de chiffrement mémorisé sur cet appareil."
        }
        "danger.resetSyncPassword.body" if ja => {
            "この端末に記憶された暗号化パスワードだけを消去します。"
        }
        "danger.resetSyncPassword.body" if ko => "이 장치에 기억된 암호화 비밀번호만 지웁니다.",
        "danger.resetSyncPassword.body" => {
            "This only clears the data encryption password remembered on this device."
        }
        "danger.resetSyncPassword.detail1" if zh => {
            "不会找回或修改云端旧数据；旧数据仍需要原密码。"
        }
        "danger.resetSyncPassword.detail1" if es => {
            "No recupera ni cambia datos antiguos de la nube; aún necesitan la contraseña anterior."
        }
        "danger.resetSyncPassword.detail1" if hi => {
            "यह पुराने क्लाउड डेटा को वापस या बदलता नहीं; उसे पुराना पासवर्ड चाहिए।"
        }
        "danger.resetSyncPassword.detail1" if ar => {
            "لا يستعيد بيانات السحابة القديمة ولا يغيرها؛ ما زالت تحتاج إلى كلمة المرور القديمة."
        }
        "danger.resetSyncPassword.detail1" if pt => {
            "Isso não recupera nem altera dados antigos da nuvem; eles ainda exigem a senha antiga."
        }
        "danger.resetSyncPassword.detail1" if ru => {
            "Старые облачные данные не будут восстановлены или изменены; им нужен старый пароль."
        }
        "danger.resetSyncPassword.detail1" if fr => {
            "Cela ne récupère ni ne modifie les anciennes données cloud; elles exigent l'ancien mot de passe."
        }
        "danger.resetSyncPassword.detail1" if ja => {
            "古いクラウドデータは復元または変更されず、引き続き古いパスワードが必要です。"
        }
        "danger.resetSyncPassword.detail1" if ko => {
            "기존 클라우드 데이터는 복구되거나 변경되지 않으며 이전 비밀번호가 필요합니다."
        }
        "danger.resetSyncPassword.detail1" => {
            "It does not recover or change old cloud data; old data still requires the old password."
        }
        "danger.resetSyncPassword.detail2" if zh => {
            "重新输入密码后，同步会先校验云端，不会静默覆盖无法解密的数据。"
        }
        "danger.resetSyncPassword.detail2" if es => {
            "Al introducir otra contraseña, la sincronización revisa la nube primero y no sobrescribe datos que no pueda descifrar."
        }
        "danger.resetSyncPassword.detail2" if hi => {
            "दूसरा पासवर्ड डालने पर सिंक पहले क्लाउड जांचता है और न खुलने वाला डेटा नहीं मिटाता।"
        }
        "danger.resetSyncPassword.detail2" if ar => {
            "عند إدخال كلمة أخرى تتحقق المزامنة من السحابة أولا ولا تستبدل بيانات لا تفك تشفيرها."
        }
        "danger.resetSyncPassword.detail2" if pt => {
            "Ao inserir outra senha, a sync verifica a nuvem primeiro e não sobrescreve dados que não descriptografa."
        }
        "danger.resetSyncPassword.detail2" if ru => {
            "После ввода другого пароля синхронизация сначала проверит облако и не перезапишет нечитаемые данные."
        }
        "danger.resetSyncPassword.detail2" if fr => {
            "Après une autre saisie, la sync vérifie d'abord le cloud et ne remplace pas des données indéchiffrables."
        }
        "danger.resetSyncPassword.detail2" if ja => {
            "別のパスワードを入力すると、同期は先にクラウドを確認し、復号できないデータを上書きしません。"
        }
        "danger.resetSyncPassword.detail2" if ko => {
            "다른 비밀번호를 입력하면 동기화가 먼저 클라우드를 확인하며 복호화할 수 없는 데이터를 덮어쓰지 않습니다."
        }
        "danger.resetSyncPassword.detail2" => {
            "After another password is entered, sync checks the cloud first and will not overwrite data it cannot decrypt."
        }
        "danger.resetSyncPassword.detail3" if zh => {
            "如果只是输错了密码，重置后请输入正确的旧密码。"
        }
        "danger.resetSyncPassword.detail3" if es => {
            "Si solo te equivocaste, restablece e introduce la contraseña anterior correcta."
        }
        "danger.resetSyncPassword.detail3" if hi => {
            "अगर पासवर्ड गलत टाइप हुआ था, रीसेट करें और सही पुराना पासवर्ड डालें।"
        }
        "danger.resetSyncPassword.detail3" if ar => {
            "إذا كان الخطأ مجرد كتابة كلمة المرور، فأعد التعيين ثم أدخل القديمة الصحيحة."
        }
        "danger.resetSyncPassword.detail3" if pt => {
            "Se foi apenas erro de digitação, redefina e informe a senha antiga correta."
        }
        "danger.resetSyncPassword.detail3" if ru => {
            "Если пароль был введен неверно, сбросьте его и введите правильный старый пароль."
        }
        "danger.resetSyncPassword.detail3" if fr => {
            "Si le mot de passe était mal saisi, réinitialisez puis saisissez le bon ancien mot de passe."
        }
        "danger.resetSyncPassword.detail3" if ja => {
            "入力ミスの場合は、リセットして正しい古いパスワードを入力してください。"
        }
        "danger.resetSyncPassword.detail3" if ko => {
            "비밀번호 입력 실수였다면 초기화한 뒤 올바른 이전 비밀번호를 입력하세요."
        }
        "danger.resetSyncPassword.detail3" => {
            "If the password was mistyped, reset it here and enter the correct old password."
        }
        "message.syncPasswordAlreadySaved" if zh => "此设备已保存同步密码。",
        "message.syncPasswordAlreadySaved" if es => {
            "La contraseña de sincronización ya está guardada en este dispositivo."
        }
        "message.syncPasswordAlreadySaved" if hi => "सिंक पासवर्ड इस डिवाइस पर पहले से सहेजा है।",
        "message.syncPasswordAlreadySaved" if ar => {
            "كلمة مرور المزامنة محفوظة مسبقا على هذا الجهاز."
        }
        "message.syncPasswordAlreadySaved" if pt => {
            "A senha de sync já está salva neste dispositivo."
        }
        "message.syncPasswordAlreadySaved" if ru => {
            "Пароль синхронизации уже сохранен на этом устройстве."
        }
        "message.syncPasswordAlreadySaved" if fr => {
            "Le mot de passe de sync est déjà enregistré sur cet appareil."
        }
        "message.syncPasswordAlreadySaved" if ja => {
            "同期パスワードはこの端末にすでに保存されています。"
        }
        "message.syncPasswordAlreadySaved" if ko => {
            "동기화 비밀번호가 이미 이 기기에 저장되어 있습니다."
        }
        "message.syncPasswordAlreadySaved" => "Sync password is already saved on this device.",
        "message.syncPasswordChanged" if zh => "此设备的同步密码已修改。",
        "message.syncPasswordChanged" if es => {
            "Contraseña de sincronización cambiada en este dispositivo."
        }
        "message.syncPasswordChanged" if hi => "सिंक पासवर्ड इस डिवाइस पर बदला गया।",
        "message.syncPasswordChanged" if ar => "تم تغيير كلمة مرور المزامنة على هذا الجهاز.",
        "message.syncPasswordChanged" if pt => "Senha de sync alterada neste dispositivo.",
        "message.syncPasswordChanged" if ru => "Пароль синхронизации изменен на этом устройстве.",
        "message.syncPasswordChanged" if fr => "Mot de passe de sync changé sur cet appareil.",
        "message.syncPasswordChanged" if ja => "この端末の同期パスワードを変更しました。",
        "message.syncPasswordChanged" if ko => "이 기기의 동기화 비밀번호를 변경했습니다.",
        "message.syncPasswordChanged" => "Sync password changed on this device.",
        "message.syncPasswordSaved" if zh => {
            "同步密码已保存；Secret Service 不可用时仅本次会话有效。"
        }
        "message.syncPasswordSaved" if es => {
            "Contraseña de sincronización guardada; sin Secret Service dura solo esta sesión."
        }
        "message.syncPasswordSaved" if hi => {
            "सिंक पासवर्ड सहेजा गया; Secret Service न हो तो यह केवल इस सत्र तक रहेगा।"
        }
        "message.syncPasswordSaved" if ar => {
            "تم حفظ كلمة مرور المزامنة؛ دون Secret Service تبقى لهذه الجلسة فقط."
        }
        "message.syncPasswordSaved" if pt => {
            "Senha de sync salva; sem Secret Service vale só nesta sessão."
        }
        "message.syncPasswordSaved" if ru => {
            "Пароль синхронизации сохранен; без Secret Service он действует только в этом сеансе."
        }
        "message.syncPasswordSaved" if fr => {
            "Mot de passe de sync enregistré; sans Secret Service il vaut seulement pour cette session."
        }
        "message.syncPasswordSaved" if ja => {
            "同期パスワードを保存しました。Secret Service がない場合はこのセッションのみ有効です。"
        }
        "message.syncPasswordSaved" if ko => {
            "동기화 비밀번호를 저장했습니다. Secret Service가 없으면 이 세션에서만 유지됩니다."
        }
        "message.syncPasswordSaved" => {
            "Sync password saved; without Secret Service it lasts only for this session."
        }
        "notice.syncPasswordReset" if zh => "已清除本机当前记住的同步密码。",
        "notice.syncPasswordReset" if es => {
            "Contraseña de sincronización borrada en este dispositivo."
        }
        "notice.syncPasswordReset" if hi => "इस डिवाइस पर सिंक पासवर्ड साफ़ हुआ।",
        "notice.syncPasswordReset" if ar => "تم مسح كلمة مرور المزامنة على هذا الجهاز.",
        "notice.syncPasswordReset" if pt => "Senha de sync limpa neste dispositivo.",
        "notice.syncPasswordReset" if ru => "Пароль синхронизации удален на этом устройстве.",
        "notice.syncPasswordReset" if fr => "Mot de passe de sync effacé sur cet appareil.",
        "notice.syncPasswordReset" if ja => "この端末の同期パスワードを消去しました。",
        "notice.syncPasswordReset" if ko => "이 장치의 동기화 비밀번호를 지웠습니다.",
        "notice.syncPasswordReset" => "Sync password cleared on this device.",
        "mode.cloudflare" if zh => "Cloudflare",
        "mode.cloudflare" if es => "Cloudflare",
        "mode.cloudflare" if hi => "Cloudflare",
        "mode.cloudflare" if ar => "Cloudflare",
        "mode.cloudflare" if pt => "Cloudflare",
        "mode.cloudflare" if ru => "Cloudflare",
        "mode.cloudflare" if fr => "Cloudflare",
        "mode.cloudflare" if ja => "Cloudflare",
        "mode.cloudflare" if ko => "Cloudflare",
        "mode.cloudflare" => "Cloudflare",
        "mode.gist" if zh => "GitHub Gist",
        "mode.gist" if es => "GitHub Gist",
        "mode.gist" if hi => "GitHub Gist",
        "mode.gist" if ar => "GitHub Gist",
        "mode.gist" if pt => "GitHub Gist",
        "mode.gist" if ru => "GitHub Gist",
        "mode.gist" if fr => "GitHub Gist",
        "mode.gist" if ja => "GitHub Gist",
        "mode.gist" if ko => "GitHub Gist",
        "mode.gist" => "GitHub Gist",
        "mode.local" if zh => "本地",
        "mode.local" if es => "Local",
        "mode.local" if hi => "लोकल",
        "mode.local" if ar => "محلي",
        "mode.local" if pt => "Local",
        "mode.local" if ru => "Локально",
        "mode.local" if fr => "Local",
        "mode.local" if ja => "ローカル",
        "mode.local" if ko => "로컬",
        "mode.local" => "Local",
        "option.emptyModel" if zh => "选择模型",
        "option.emptyModel" if es => "Seleccionar modelo",
        "option.emptyModel" if hi => "मॉडल चुनें",
        "option.emptyModel" if ar => "اختر نموذجا",
        "option.emptyModel" if pt => "Selecionar modelo",
        "option.emptyModel" if ru => "Выбрать модель",
        "option.emptyModel" if fr => "Choisir un modèle",
        "option.emptyModel" if ja => "モデルを選択",
        "option.emptyModel" if ko => "모델 선택",
        "option.emptyModel" => "Select model",
        "role.user" if zh => "你",
        "role.user" if es => "Tú",
        "role.user" if hi => "आप",
        "role.user" if ar => "أنت",
        "role.user" if pt => "Você",
        "role.user" if ru => "Вы",
        "role.user" if fr => "Vous",
        "role.user" if ja => "あなた",
        "role.user" if ko => "나",
        "role.user" => "You",
        "settings.directRequestNote" if zh => {
            "直连模式会绕过 Worker，配置更简单，但应用会自行发送 API Key。"
        }
        "settings.directRequestNote" if es => {
            "El modo directo omite el Worker. Es más simple, pero la app envía la API Key."
        }
        "settings.directRequestNote" if hi => {
            "Direct mode Worker को छोड़ता है। यह सरल है, लेकिन ऐप API Key खुद भेजता है।"
        }
        "settings.directRequestNote" if ar => {
            "يتجاوز الوضع المباشر Worker. هو أبسط، لكن التطبيق يرسل API Key بنفسه."
        }
        "settings.directRequestNote" if pt => {
            "O modo direto ignora o Worker. É mais simples, mas o app envia a API Key."
        }
        "settings.directRequestNote" if ru => {
            "Прямой режим обходит Worker. Это проще, но приложение само отправляет API Key."
        }
        "settings.directRequestNote" if fr => {
            "Le mode direct contourne le Worker. C’est plus simple, mais l’app envoie elle-même l’API Key."
        }
        "settings.directRequestNote" if ja => {
            "直接モードは Worker を使いません。簡単ですが、アプリ自身が API Key を送信します。"
        }
        "settings.directRequestNote" if ko => {
            "직접 모드는 Worker를 건너뜁니다. 더 간단하지만 앱이 API Key를 직접 보냅니다."
        }
        "settings.directRequestNote" => {
            "Direct mode skips the Worker. It is simpler, but this app sends the API key itself."
        }
        "settings.providerNameHint" if zh => "显示在聊天标题、模型选择器和设置列表里。",
        "settings.providerNameHint" if es => {
            "Se muestra en encabezados de chat, selectores de modelos y listas de ajustes."
        }
        "settings.providerNameHint" if hi => "चैट शीर्षक, मॉडल चयन और सेटिंग सूची में दिखता है।",
        "settings.providerNameHint" if ar => {
            "يظهر في عناوين المحادثات واختيار النماذج وقوائم الإعدادات."
        }
        "settings.providerNameHint" if pt => {
            "Aparece nos cabeçalhos de chat, seletores de modelo e listas de configurações."
        }
        "settings.providerNameHint" if ru => {
            "Показывается в заголовках чатов, выборе моделей и списках настроек."
        }
        "settings.providerNameHint" if fr => {
            "Affiché dans les en-têtes de chat, les sélecteurs de modèle et les listes de réglages."
        }
        "settings.providerNameHint" if ja => "チャット見出し、モデル選択、設定一覧に表示されます。",
        "settings.providerNameHint" if ko => "채팅 제목, 모델 선택기, 설정 목록에 표시됩니다.",
        "settings.providerNameHint" => "Shown in chat headers, model pickers, and settings lists.",
        "settings.providerBaseUrlHint" if zh => {
            "填写服务商 API 根地址，通常以 /v1 结尾；不要把 Worker 地址填在这里。"
        }
        "settings.providerBaseUrlHint" if es => {
            "Usa la raíz de la API del proveedor, normalmente terminada en /v1; no pegues aquí una URL de Worker."
        }
        "settings.providerBaseUrlHint" if hi => {
            "प्रदाता API रूट डालें, आमतौर पर /v1 पर खत्म होता है; यहां Worker URL न चिपकाएं।"
        }
        "settings.providerBaseUrlHint" if ar => {
            "استخدم جذر API للمزوّد، عادة ينتهي بـ /v1؛ لا تلصق رابط Worker هنا."
        }
        "settings.providerBaseUrlHint" if pt => {
            "Use a raiz da API do provedor, geralmente terminando em /v1; não cole uma URL de Worker aqui."
        }
        "settings.providerBaseUrlHint" if ru => {
            "Укажите корень API провайдера, обычно с /v1 в конце; не вставляйте сюда URL Worker."
        }
        "settings.providerBaseUrlHint" if fr => {
            "Utilisez la racine API du fournisseur, souvent terminée par /v1; ne collez pas une URL Worker ici."
        }
        "settings.providerBaseUrlHint" if ja => {
            "プロバイダー API のルートを入力します。通常は /v1 で終わります。Worker URL はここに貼り付けません。"
        }
        "settings.providerBaseUrlHint" if ko => {
            "공급자 API 루트를 입력하세요. 보통 /v1로 끝나며 Worker URL을 여기에 붙여 넣지 마세요."
        }
        "settings.providerBaseUrlHint" => {
            "Use the provider API root, usually ending in /v1; do not paste a Worker URL here."
        }
        "settings.providerKeyHint" if zh => "只保存在本机安全存储中，且只在这个服务商需要时发送。",
        "settings.providerKeyHint" if es => {
            "Se guarda solo en este dispositivo en almacenamiento seguro y se envía solo cuando este proveedor la necesita."
        }
        "settings.providerKeyHint" if hi => {
            "केवल इस डिवाइस के सुरक्षित संग्रह में रहता है और तभी भेजा जाता है जब इस प्रदाता को चाहिए।"
        }
        "settings.providerKeyHint" if ar => {
            "يُحفظ على هذا الجهاز فقط في التخزين الآمن ولا يُرسل إلا عندما يحتاجه هذا المزوّد."
        }
        "settings.providerKeyHint" if pt => {
            "Fica salvo só neste dispositivo em armazenamento seguro e só é enviado quando este provedor precisa."
        }
        "settings.providerKeyHint" if ru => {
            "Хранится только на этом устройстве в защищенном хранилище и отправляется только когда нужен этому провайдеру."
        }
        "settings.providerKeyHint" if fr => {
            "Enregistrée seulement sur cet appareil dans le stockage sécurisé et envoyée seulement si ce fournisseur en a besoin."
        }
        "settings.providerKeyHint" if ja => {
            "この端末の安全な保存領域だけに保存され、このプロバイダーが必要なときだけ送信されます。"
        }
        "settings.providerKeyHint" if ko => {
            "이 기기의 보안 저장소에만 저장되며 이 공급자에 필요할 때만 전송됩니다."
        }
        "settings.providerKeyHint" => {
            "Stored only on this device in secure storage and sent only when this provider needs it."
        }
        "settings.capabilities" if zh => "支持能力",
        "settings.capabilities" if es => "Capacidades",
        "settings.capabilities" if hi => "क्षमताएं",
        "settings.capabilities" if ar => "القدرات",
        "settings.capabilities" if pt => "Capacidades",
        "settings.capabilities" if ru => "Возможности",
        "settings.capabilities" if fr => "Capacités",
        "settings.capabilities" if ja => "機能",
        "settings.capabilities" if ko => "기능",
        "settings.capabilities" => "Capabilities",
        "settings.capabilityNote" if zh => {
            "服务商 API 能力。聊天用聊天模型；图片接口仍需匹配图片模型；已声明的音频、向量、审核和实时接口在目录漏列时会用标准候选模型检查。"
        }
        "settings.capabilityNote" if es => {
            "Capacidades API del proveedor. El chat usa modelos de chat. Imagen requiere modelos de imagen; audio, embeddings, moderación y Realtime declarados pueden usar modelos estándar si el catálogo los omite."
        }
        "settings.capabilityNote" if hi => {
            "प्रदाता API क्षमताएं। चैट के लिए चैट मॉडल हैं। इमेज endpoints को इमेज मॉडल चाहिए; घोषित ऑडियो, embeddings, moderation और Realtime जांचें कैटलॉग में न होने पर मानक fallback मॉडल इस्तेमाल कर सकती हैं।"
        }
        "settings.capabilityNote" if ar => {
            "قدرات API للمزوّد. تستخدم الدردشة نماذج الدردشة. تحتاج الصور إلى نماذج صور؛ ويمكن لفحوص الصوت والتضمينات والإشراف وRealtime المعلنة استخدام نماذج قياسية إذا أغفلها الكتالوج."
        }
        "settings.capabilityNote" if pt => {
            "Recursos API do provedor. Chat usa modelos de chat. Imagem precisa de modelos de imagem; áudio, embeddings, moderação e Realtime declarados podem usar modelos padrão quando o catálogo omite."
        }
        "settings.capabilityNote" if ru => {
            "API-возможности провайдера. Чат использует чат-модели. Для изображений нужны image-модели; объявленные audio, embeddings, moderation и Realtime могут использовать стандартные модели, если каталог их не вернул."
        }
        "settings.capabilityNote" if fr => {
            "Capacités API du fournisseur. Le chat utilise les modèles de chat. L’image exige des modèles image; audio, embeddings, modération et Realtime déclarés peuvent utiliser des modèles standard si le catalogue les omet."
        }
        "settings.capabilityNote" if ja => {
            "プロバイダー API 機能。チャットはチャットモデルを使います。画像は画像モデルが必要です。宣言済みの音声、埋め込み、モデレーション、Realtime はカタログに無い場合も標準候補で確認できます。"
        }
        "settings.capabilityNote" if ko => {
            "공급자 API 기능입니다. 채팅은 채팅 모델을 사용합니다. 이미지는 이미지 모델이 필요하며, 선언된 오디오, 임베딩, 모더레이션, Realtime은 카탈로그에 없으면 표준 후보 모델로 확인할 수 있습니다."
        }
        "settings.capabilityNote" => {
            "Provider API capabilities. Chat uses chat models. Image endpoints need image models; declared audio, embeddings, moderation, and Realtime checks can use standard fallback model IDs when the catalog omits them."
        }
        "settings.capabilityReadiness" if zh => "能力就绪",
        "settings.capabilityReadiness" if es => "Preparación",
        "settings.capabilityReadiness" if hi => "तैयारी",
        "settings.capabilityReadiness" if ar => "الجاهزية",
        "settings.capabilityReadiness" if pt => "Prontidão",
        "settings.capabilityReadiness" if ru => "Готовность",
        "settings.capabilityReadiness" if fr => "Préparation",
        "settings.capabilityReadiness" if ja => "準備状況",
        "settings.capabilityReadiness" if ko => "준비 상태",
        "settings.capabilityReadiness" => "Capability readiness",
        "settings.capabilityReadinessMissing" if zh => "缺：{capabilities}",
        "settings.capabilityReadinessMissing" if es => "Faltan: {capabilities}",
        "settings.capabilityReadinessMissing" if hi => "नहीं हैं: {capabilities}",
        "settings.capabilityReadinessMissing" if ar => "ناقص: {capabilities}",
        "settings.capabilityReadinessMissing" if pt => "Faltam: {capabilities}",
        "settings.capabilityReadinessMissing" if ru => "Нет: {capabilities}",
        "settings.capabilityReadinessMissing" if fr => "Manquants : {capabilities}",
        "settings.capabilityReadinessMissing" if ja => "不足: {capabilities}",
        "settings.capabilityReadinessMissing" if ko => "누락: {capabilities}",
        "settings.capabilityReadinessMissing" => "Missing: {capabilities}",
        "settings.capabilityReadinessReady" if zh => "模型已覆盖",
        "settings.capabilityReadinessReady" if es => "Modelos cubiertos",
        "settings.capabilityReadinessReady" if hi => "मॉडल पूरे हैं",
        "settings.capabilityReadinessReady" if ar => "النماذج مغطاة",
        "settings.capabilityReadinessReady" if pt => "Modelos cobertos",
        "settings.capabilityReadinessReady" if ru => "Модели покрыты",
        "settings.capabilityReadinessReady" if fr => "Modèles couverts",
        "settings.capabilityReadinessReady" if ja => "モデルは網羅済み",
        "settings.capabilityReadinessReady" if ko => "모델 적용됨",
        "settings.capabilityReadinessReady" => "Models covered",
        "settings.capabilityReadinessNote" if zh => {
            "补齐模型后运行能力检查验证路由健康；实时语音需 /realtime/client_secrets。"
        }
        "settings.capabilityReadinessNote" if es => {
            "Añade los modelos que falten y ejecuta las comprobaciones de capacidad para probar la salud de la ruta; Realtime necesita /realtime/client_secrets."
        }
        "settings.capabilityReadinessNote" if hi => {
            "छूटे मॉडल जोड़ें, फिर रूट स्वास्थ्य साबित करने के लिए क्षमता जांच चलाएं; Realtime को /realtime/client_secrets चाहिए."
        }
        "settings.capabilityReadinessNote" if ar => {
            "أضف النماذج الناقصة ثم شغّل فحوصات القدرات لإثبات سلامة المسار؛ يحتاج Realtime /realtime/client_secrets."
        }
        "settings.capabilityReadinessNote" if pt => {
            "Adicione os modelos ausentes e execute verificações de capacidade para provar a saúde da rota; Realtime precisa de /realtime/client_secrets."
        }
        "settings.capabilityReadinessNote" if ru => {
            "Добавьте недостающие модели, затем запустите проверки возможностей, чтобы подтвердить работоспособность маршрутов; Realtime требует /realtime/client_secrets."
        }
        "settings.capabilityReadinessNote" if fr => {
            "Ajoutez les modèles manquants, puis lancez les vérifications de capacité pour prouver la santé des routes; Realtime exige /realtime/client_secrets."
        }
        "settings.capabilityReadinessNote" if ja => {
            "不足モデルを追加し、機能チェックでルート健全性を証明してください。Realtime には /realtime/client_secrets が必要です。"
        }
        "settings.capabilityReadinessNote" if ko => {
            "누락된 모델을 추가한 뒤 기능 확인을 실행해 경로 상태를 증명하세요. Realtime은 /realtime/client_secrets가 필요합니다."
        }
        "settings.capabilityReadinessNote" => {
            "Add missing models, then run capability checks to prove route health; Realtime needs /realtime/client_secrets."
        }
        "settings.interfaces" if zh => "接口",
        "settings.interfaces" if es => "Interfaces",
        "settings.interfaces" if hi => "इंटरफेस",
        "settings.interfaces" if ar => "الواجهات",
        "settings.interfaces" if pt => "Interfaces",
        "settings.interfaces" if ru => "Интерфейсы",
        "settings.interfaces" if fr => "Interfaces",
        "settings.interfaces" if ja => "インターフェイス",
        "settings.interfaces" if ko => "인터페이스",
        "settings.interfaces" => "Interfaces",
        "provider.preset.custom-openai-relay" if zh => "自定义中转（OpenAI 兼容）",
        "provider.preset.custom-openai-relay" if es => "Relé personalizado (OpenAI compatible)",
        "provider.preset.custom-openai-relay" if hi => "कस्टम रिले (OpenAI compatible)",
        "provider.preset.custom-openai-relay" if ar => "مرحل مخصص (متوافق مع OpenAI)",
        "provider.preset.custom-openai-relay" if pt => {
            "Relay personalizado (compatível com OpenAI)"
        }
        "provider.preset.custom-openai-relay" if ru => {
            "Пользовательский ретранслятор (совместимый с OpenAI)"
        }
        "provider.preset.custom-openai-relay" if fr => "Relais personnalisé (compatible OpenAI)",
        "provider.preset.custom-openai-relay" if ja => "カスタムリレー（OpenAI 互換）",
        "provider.preset.custom-openai-relay" if ko => "사용자 지정 릴레이(OpenAI 호환)",
        "provider.preset.custom-openai-relay" => "Custom relay (OpenAI compatible)",
        "settings.interfaceTypeNoteCustom" if zh => {
            "接口在添加时固定。要换协议，请新增对应的自定义中转。大多数中转选 OpenAI 兼容。"
        }
        "settings.interfaceTypeNoteCustom" if es => {
            "El protocolo se fija cuando se agrega. Agregue otro tipo de relé personalizado para cambiar de protocolo. La mayoría de los relés utilizan OpenAI compatible."
        }
        "settings.interfaceTypeNoteCustom" if hi => {
            "जोड़े जाने पर प्रोटोकॉल ठीक हो जाता है। प्रोटोकॉल स्विच करने के लिए एक अन्य कस्टम रिले प्रकार जोड़ें। अधिकांश रिले OpenAI compatible का उपयोग करते हैं।"
        }
        "settings.interfaceTypeNoteCustom" if ar => {
            "يتم إصلاح البروتوكول عند إضافته. قم بإضافة نوع ترحيل مخصص آخر لتبديل البروتوكولات. تستخدم معظم المرحلات OpenAI compatible."
        }
        "settings.interfaceTypeNoteCustom" if pt => {
            "O protocolo é corrigido quando adicionado. Adicione outro tipo de retransmissão personalizado para alternar protocolos. A maioria dos relés usa OpenAI compatible."
        }
        "settings.interfaceTypeNoteCustom" if ru => {
            "Протокол фиксируется при добавлении. Добавьте еще один пользовательский тип реле для переключения протоколов. Большинство реле используют OpenAI compatible."
        }
        "settings.interfaceTypeNoteCustom" if fr => {
            "Le protocole est corrigé une fois ajouté. Ajoutez un autre type de relais personnalisé pour changer de protocole. La plupart des relais utilisent OpenAI compatible."
        }
        "settings.interfaceTypeNoteCustom" if ja => {
            "プロトコルは追加時に固定されます。切り替えるには別のカスタムリレー種別を追加してください。多くのリレーは OpenAI compatible を使用します。"
        }
        "settings.interfaceTypeNoteCustom" if ko => {
            "프로토콜은 추가되면 수정됩니다. 프로토콜을 전환하려면 다른 사용자 정의 릴레이 유형을 추가하세요. 대부분의 릴레이는 OpenAI compatible를 사용합니다."
        }
        "settings.interfaceTypeNoteCustom" => {
            "The protocol is fixed when added. Add another custom relay type to switch protocols. Most relays use OpenAI compatible."
        }
        "settings.providerConnectivityPrivacy" if zh => "只读取模型列表，不会发送聊天内容。",
        "settings.providerConnectivityPrivacy" if es => {
            "Solo lee la lista de modelos. No se envía contenido del chat."
        }
        "settings.providerConnectivityPrivacy" if hi => {
            "सिर्फ मॉडल सूची पढ़ता है। चैट सामग्री नहीं भेजी जाती।"
        }
        "settings.providerConnectivityPrivacy" if ar => {
            "يقرأ قائمة النماذج فقط. لا يتم إرسال محتوى الدردشة."
        }
        "settings.providerConnectivityPrivacy" if pt => {
            "Lê apenas a lista de modelos. Nenhum conteúdo do chat é enviado."
        }
        "settings.providerConnectivityPrivacy" if ru => {
            "Читает только список моделей. Содержимое чата не отправляется."
        }
        "settings.providerConnectivityPrivacy" if fr => {
            "Lit seulement la liste des modèles. Aucun contenu de chat n’est envoyé."
        }
        "settings.providerConnectivityPrivacy" if ja => {
            "モデル一覧だけを読み取ります。チャット内容は送信されません。"
        }
        "settings.providerConnectivityPrivacy" if ko => {
            "모델 목록만 읽습니다. 채팅 내용은 전송되지 않습니다."
        }
        "settings.providerConnectivityPrivacy" => {
            "Reads the model list only. No chat content is sent."
        }
        "settings.linuxProviderKeySessionNote" if zh => {
            "Linux 会优先用系统 Secret Service 保存 API Key；不可用时退回本次会话内存。开启同步后，Key 只会进入端到端加密 vault。"
        }
        "settings.linuxProviderKeySessionNote" if es => {
            "Linux usa Secret Service para guardar la clave cuando está disponible; si no, queda en memoria de sesión. Con sync activada, solo entra en el vault cifrado."
        }
        "settings.linuxProviderKeySessionNote" if hi => {
            "Linux उपलब्ध हो तो Secret Service में कुंजी सहेजता है; नहीं तो इस सत्र की मेमरी में रखता है. sync चालू हो तो कुंजी केवल encrypted vault में जाती है."
        }
        "settings.linuxProviderKeySessionNote" if ar => {
            "يستخدم Linux خدمة Secret Service لحفظ المفتاح عند توفرها؛ وإلا يبقى في ذاكرة الجلسة. مع المزامنة يدخل المفتاح الخزنة المشفرة فقط."
        }
        "settings.linuxProviderKeySessionNote" if pt => {
            "No Linux, a chave usa o Secret Service quando disponível; caso contrário fica na memória da sessão. Com sync ativa, ela só entra no vault cifrado."
        }
        "settings.linuxProviderKeySessionNote" if ru => {
            "В Linux ключ сохраняется через Secret Service, если он доступен; иначе остается в памяти сеанса. При синхронизации ключ попадает только в зашифрованный vault."
        }
        "settings.linuxProviderKeySessionNote" if fr => {
            "Sous Linux, la clé est enregistrée via Secret Service quand il est disponible; sinon elle reste en mémoire de session. Avec la sync, elle va seulement dans le coffre chiffré."
        }
        "settings.linuxProviderKeySessionNote" if ja => {
            "Linux では利用可能な場合 Secret Service にキーを保存し、利用できない場合はセッションメモリに保持します。同期時は暗号化 vault にのみ入ります。"
        }
        "settings.linuxProviderKeySessionNote" if ko => {
            "Linux는 가능하면 Secret Service에 키를 저장하고, 사용할 수 없으면 세션 메모리에 보관합니다. 동기화 시 키는 암호화 vault에만 들어갑니다."
        }
        "settings.linuxProviderKeySessionNote" => {
            "Linux saves keys with Secret Service when available; otherwise they stay in session memory. With sync enabled, keys only enter the encrypted vault."
        }
        "settings.linuxGithubTokenSessionNote" if zh => {
            "GitHub 令牌只保存在此设备；Secret Service 不可用时仅本次会话有效。"
        }
        "settings.linuxGithubTokenSessionNote" if es => {
            "El token de GitHub queda solo en este dispositivo; sin Secret Service dura solo esta sesión."
        }
        "settings.linuxGithubTokenSessionNote" if hi => {
            "GitHub टोकन केवल इस डिवाइस पर रहता है; Secret Service न हो तो यह सिर्फ इस सत्र तक रहता है."
        }
        "settings.linuxGithubTokenSessionNote" if ar => {
            "يبقى رمز GitHub على هذا الجهاز فقط؛ دون Secret Service يبقى لهذه الجلسة فقط."
        }
        "settings.linuxGithubTokenSessionNote" if pt => {
            "O token do GitHub fica só neste dispositivo; sem Secret Service vale só nesta sessão."
        }
        "settings.linuxGithubTokenSessionNote" if ru => {
            "Токен GitHub остается только на этом устройстве; без Secret Service он действует только в этом сеансе."
        }
        "settings.linuxGithubTokenSessionNote" if fr => {
            "Le jeton GitHub reste seulement sur cet appareil; sans Secret Service il vaut seulement pour cette session."
        }
        "settings.linuxGithubTokenSessionNote" if ja => {
            "GitHub トークンはこの端末にのみ保存されます。Secret Service がない場合はこのセッションのみ有効です。"
        }
        "settings.linuxGithubTokenSessionNote" if ko => {
            "GitHub 토큰은 이 기기에만 저장됩니다. Secret Service가 없으면 이 세션에서만 유지됩니다."
        }
        "settings.linuxGithubTokenSessionNote" => {
            "The GitHub token stays only on this device; without Secret Service it lasts only for this session."
        }
        "settings.gistIdHint" if zh => {
            "留空会在首次同步时创建私有 Gist；也可以粘贴已有 Gist ID 继续使用。"
        }
        "settings.gistIdHint" if es => {
            "Déjalo vacío para crear un Gist privado al sincronizar, o pega un ID existente para reutilizarlo."
        }
        "settings.gistIdHint" if hi => {
            "पहली सिंक पर निजी Gist बनाने के लिए खाली छोड़ें, या मौजूदा Gist ID चिपकाएं।"
        }
        "settings.gistIdHint" if ar => {
            "اتركه فارغا لإنشاء Gist خاص عند أول مزامنة، أو الصق معرف Gist موجودا لإعادة استخدامه."
        }
        "settings.gistIdHint" if pt => {
            "Deixe em branco para criar um Gist privado na primeira sincronização ou cole um ID existente."
        }
        "settings.gistIdHint" if ru => {
            "Оставьте пустым, чтобы создать приватный Gist при первой синхронизации, или вставьте ID существующего Gist."
        }
        "settings.gistIdHint" if fr => {
            "Laissez vide pour créer un Gist privé à la première synchronisation, ou collez un ID existant."
        }
        "settings.gistIdHint" if ja => {
            "初回同期で非公開 Gist を作成する場合は空のままにします。既存の Gist ID も使えます。"
        }
        "settings.gistIdHint" if ko => {
            "첫 동기화 때 비공개 Gist를 만들려면 비워 두거나 기존 Gist ID를 붙여 넣으세요."
        }
        "settings.gistIdHint" => {
            "Leave blank to create a private Gist on first sync, or paste an existing Gist ID to reuse one."
        }
        "settings.gistFileHint" if zh => {
            "加密同步数据在 Gist 里的文件名；不确定就保持 zerochat-sync.json。"
        }
        "settings.gistFileHint" if es => {
            "Archivo cifrado dentro del Gist. Mantén zerochat-sync.json salvo que necesites otro nombre."
        }
        "settings.gistFileHint" if hi => {
            "Gist के अंदर एन्क्रिप्टेड सिंक फ़ाइल। जरूरत न हो तो zerochat-sync.json रखें।"
        }
        "settings.gistFileHint" if ar => {
            "ملف المزامنة المشفر داخل Gist. أبقِ zerochat-sync.json ما لم تحتج اسما آخر."
        }
        "settings.gistFileHint" if pt => {
            "Arquivo criptografado dentro do Gist. Mantenha zerochat-sync.json salvo se precisar de outro nome."
        }
        "settings.gistFileHint" if ru => {
            "Зашифрованный файл синхронизации внутри Gist. Оставьте zerochat-sync.json, если не нужен другой файл."
        }
        "settings.gistFileHint" if fr => {
            "Fichier chiffré dans le Gist. Gardez zerochat-sync.json sauf besoin d'un autre nom."
        }
        "settings.gistFileHint" if ja => {
            "Gist 内の暗号化同期ファイル名です。必要がなければ zerochat-sync.json のままにします。"
        }
        "settings.gistFileHint" if ko => {
            "Gist 안의 암호화된 동기화 파일입니다. 필요 없으면 zerochat-sync.json을 유지하세요."
        }
        "settings.gistFileHint" => {
            "Encrypted sync payload file inside the Gist. Keep zerochat-sync.json unless you need another name."
        }
        "settings.githubTokenHint" if zh => {
            "只保存在本机，用来创建和更新私有 Gist；需要 Gist 读写权限。"
        }
        "settings.githubTokenHint" if es => {
            "Solo se guarda en este dispositivo. Necesita permiso de lectura/escritura de Gist."
        }
        "settings.githubTokenHint" if hi => {
            "केवल इसी डिवाइस पर सहेजा जाता है। निजी Gist बनाने/अपडेट करने के लिए Gist पढ़ने-लिखने की अनुमति चाहिए।"
        }
        "settings.githubTokenHint" if ar => {
            "يُحفظ على هذا الجهاز فقط. يحتاج إذن قراءة وكتابة Gist لإنشاء وتحديث Gists الخاصة."
        }
        "settings.githubTokenHint" if pt => {
            "Fica salvo só neste dispositivo. Precisa de permissão de leitura/gravação em Gist."
        }
        "settings.githubTokenHint" if ru => {
            "Хранится только на этом устройстве. Нужны права чтения и записи Gist."
        }
        "settings.githubTokenHint" if fr => {
            "Enregistré seulement sur cet appareil. Nécessite l'autorisation de lire et écrire des Gist."
        }
        "settings.githubTokenHint" if ja => {
            "この端末だけに保存されます。非公開 Gist の作成と更新には Gist の読み書き権限が必要です。"
        }
        "settings.githubTokenHint" if ko => {
            "이 기기에만 저장됩니다. 비공개 Gist 생성과 업데이트를 위한 Gist 읽기/쓰기 권한이 필요합니다."
        }
        "settings.githubTokenHint" => {
            "Stored only on this device. Needs Gist read/write permission to create and update private Gists."
        }
        "settings.cloudflareWorkerUrlHint" if zh => {
            "粘贴你部署的 ZeroChat Cloudflare Worker HTTPS 地址。"
        }
        "settings.cloudflareWorkerUrlHint" if es => {
            "Pega la URL HTTPS de tu Worker de ZeroChat en Cloudflare."
        }
        "settings.cloudflareWorkerUrlHint" if hi => {
            "अपने तैनात ZeroChat Cloudflare Worker की HTTPS URL चिपकाएं।"
        }
        "settings.cloudflareWorkerUrlHint" if ar => {
            "الصق رابط HTTPS الخاص بـ ZeroChat Cloudflare Worker المنشور."
        }
        "settings.cloudflareWorkerUrlHint" if pt => {
            "Cole a URL HTTPS do seu ZeroChat Cloudflare Worker implantado."
        }
        "settings.cloudflareWorkerUrlHint" if ru => {
            "Вставьте HTTPS URL развернутого ZeroChat Cloudflare Worker."
        }
        "settings.cloudflareWorkerUrlHint" if fr => {
            "Collez l'URL HTTPS de votre ZeroChat Cloudflare Worker déployé."
        }
        "settings.cloudflareWorkerUrlHint" if ja => {
            "デプロイ済みの ZeroChat Cloudflare Worker の HTTPS URL を貼り付けます。"
        }
        "settings.cloudflareWorkerUrlHint" if ko => {
            "배포한 ZeroChat Cloudflare Worker의 HTTPS URL을 붙여 넣으세요."
        }
        "settings.cloudflareWorkerUrlHint" => {
            "Paste the HTTPS URL of your deployed ZeroChat Cloudflare Worker."
        }
        "settings.cloudflareAccessKeyFieldHint" if zh => {
            "由“数据”里的加密密码派生；部署 Worker 时作为 ZEROCHAT_ACCESS_KEY 填入。"
        }
        "settings.cloudflareAccessKeyFieldHint" if es => {
            "Se deriva de la contraseña de datos. Cópiala al secreto ZEROCHAT_ACCESS_KEY del Worker."
        }
        "settings.cloudflareAccessKeyFieldHint" if hi => {
            "डेटा पासवर्ड से निकली कुंजी। Worker secret ZEROCHAT_ACCESS_KEY में कॉपी करें।"
        }
        "settings.cloudflareAccessKeyFieldHint" if ar => {
            "مشتق من كلمة مرور البيانات. انسخه إلى سر Worker باسم ZEROCHAT_ACCESS_KEY."
        }
        "settings.cloudflareAccessKeyFieldHint" if pt => {
            "Derivada da senha de dados. Copie para o segredo ZEROCHAT_ACCESS_KEY do Worker."
        }
        "settings.cloudflareAccessKeyFieldHint" if ru => {
            "Получен из пароля данных. Скопируйте в секрет Worker ZEROCHAT_ACCESS_KEY."
        }
        "settings.cloudflareAccessKeyFieldHint" if fr => {
            "Dérivée du mot de passe des données. Copiez-la dans le secret Worker ZEROCHAT_ACCESS_KEY."
        }
        "settings.cloudflareAccessKeyFieldHint" if ja => {
            "データパスワードから派生します。Worker secret の ZEROCHAT_ACCESS_KEY にコピーします。"
        }
        "settings.cloudflareAccessKeyFieldHint" if ko => {
            "데이터 비밀번호에서 파생됩니다. Worker secret ZEROCHAT_ACCESS_KEY에 복사하세요."
        }
        "settings.cloudflareAccessKeyFieldHint" => {
            "Derived from the data password. Copy it into the Worker secret as ZEROCHAT_ACCESS_KEY."
        }
        "settings.cloudflareAccessKeyNote" if zh => {
            "部署 Worker 时填入 ZEROCHAT_ACCESS_KEY。它不能解密聊天；修改数据加密密码后，请更新 Worker Secret。"
        }
        "settings.cloudflareAccessKeyNote" if es => {
            "Usa este valor como ZEROCHAT_ACCESS_KEY al desplegar el Worker. No puede descifrar chats; actualiza el Worker Secret después de cambiar la contraseña de datos."
        }
        "settings.cloudflareAccessKeyNote" if hi => {
            "Worker को तैनात करते समय इसे ZEROCHAT_ACCESS_KEY के रूप में उपयोग करें। यह चैट को डिक्रिप्ट नहीं कर सकता; डेटा पासवर्ड बदलने के बाद Worker Secret को अपडेट करें।"
        }
        "settings.cloudflareAccessKeyNote" if ar => {
            "استخدم هذا كـ ZEROCHAT_ACCESS_KEY عند نشر Worker. لا يمكنه فك تشفير الدردشات. حدّث Worker Secret بعد تغيير كلمة مرور البيانات."
        }
        "settings.cloudflareAccessKeyNote" if pt => {
            "Use isto como ZEROCHAT_ACCESS_KEY ao implementar o Worker. Não pode descriptografar bate-papos; atualize o Worker Secret após alterar a senha dos dados."
        }
        "settings.cloudflareAccessKeyNote" if ru => {
            "Используйте это значение как ZEROCHAT_ACCESS_KEY при развертывании Worker. Он не может расшифровать чаты; обновите Worker Secret после смены пароля данных."
        }
        "settings.cloudflareAccessKeyNote" if fr => {
            "Utilisez-le comme ZEROCHAT_ACCESS_KEY lors du déploiement du Worker. Il ne peut pas décrypter les discussions; mettez à jour le Worker Secret après avoir modifié le mot de passe des données."
        }
        "settings.cloudflareAccessKeyNote" if ja => {
            "Worker をデプロイするときに、これを ZEROCHAT_ACCESS_KEY として使用します。チャットを復号化することはできません。データパスワードを変更した後、Worker Secretを更新してください。"
        }
        "settings.cloudflareAccessKeyNote" if ko => {
            "Worker를 배포할 때 ZEROCHAT_ACCESS_KEY로 사용합니다. 채팅 내용을 해독할 수 없습니다. 데이터 비밀번호를 변경한 후 Worker Secret을 업데이트하세요."
        }
        "settings.cloudflareAccessKeyNote" => {
            "Use this as ZEROCHAT_ACCESS_KEY when deploying the Worker. It cannot decrypt chats; update the Worker Secret after changing the data password."
        }
        "settings.proxyUrlNote" if zh => {
            "你的 Worker 地址，不是服务商 Base URL。留空时会复用同步里的 Cloudflare Worker；没有 Worker 就直连服务商。"
        }
        "settings.proxyUrlNote" if es => {
            "URL del Worker, no el Base URL del proveedor. Déjelo vacío para reutilizar el Worker de sincronización de Cloudflare; sin Worker, ZeroChat llama directamente al proveedor."
        }
        "settings.proxyUrlNote" if hi => {
            "आपका Worker URL, प्रदाता Base URL नहीं। Cloudflare सिंक Worker का पुन: उपयोग करने के लिए खाली छोड़ दें; Worker के बिना, ZeroChat सीधे प्रदाता को कॉल करता है।"
        }
        "settings.proxyUrlNote" if ar => {
            "رابط Worker، وليس Base URL الخاص بالموفر. اتركه فارغًا لإعادة استخدام Worker مزامنة Cloudflare؛ وبدون Worker، يتصل ZeroChat بالموفر مباشرة."
        }
        "settings.proxyUrlNote" if pt => {
            "URL do Worker, não o Base URL do provedor. Deixe em branco para reutilizar o Worker de sincronização do Cloudflare; sem um Worker, o ZeroChat chama o provedor diretamente."
        }
        "settings.proxyUrlNote" if ru => {
            "URL Worker, а не Base URL провайдера. Оставьте пустым, чтобы использовать Worker синхронизации Cloudflare; без Worker ZeroChat обращается к провайдеру напрямую."
        }
        "settings.proxyUrlNote" if fr => {
            "URL du Worker, pas le Base URL du fournisseur. Laissez vide pour réutiliser le Worker de synchronisation Cloudflare; sans Worker, ZeroChat appelle directement le fournisseur."
        }
        "settings.proxyUrlNote" if ja => {
            "プロバイダーの Base URL ではなく Worker URL です。Cloudflare 同期 Worker を再利用する場合は空のままにします。Worker がない場合、ZeroChat はプロバイダーへ直接接続します。"
        }
        "settings.proxyUrlNote" if ko => {
            "공급자 Base URL이 아닌 Worker URL입니다. Cloudflare 동기화 Worker를 재사용하려면 비워 두세요. Worker가 없으면 ZeroChat은 공급자를 직접 호출합니다."
        }
        "settings.proxyUrlNote" => {
            "Your Worker URL, not the provider Base URL. Leave empty to reuse the Cloudflare sync Worker; without a Worker, ZeroChat calls the provider directly."
        }
        "settings.syncEncryptedNote" if zh => {
            "用于云同步和加密备份。请长期保存，忘记后无法恢复云端数据或旧备份。本机保存会自动加密。"
        }
        "settings.syncEncryptedNote" if es => {
            "Esta contraseña permanece en tus dispositivos y cifra la sincronización en la nube y las copias cifradas manuales. El almacenamiento local se cifra automáticamente con la clave de este dispositivo y no necesita esta contraseña."
        }
        "settings.syncEncryptedNote" if hi => {
            "यह पासवर्ड आपके डिवाइस पर रहता है और क्लाउड सिंक तथा मैन्युअल एन्क्रिप्टेड बैकअप को एन्क्रिप्ट करता है। स्थानीय संग्रह इस डिवाइस की कुंजी से अपने आप एन्क्रिप्ट होता है और इस पासवर्ड की जरूरत नहीं होती।"
        }
        "settings.syncEncryptedNote" if ar => {
            "تبقى كلمة المرور هذه على أجهزتك وتشفّر مزامنة السحابة والنسخ الاحتياطية المشفرة اليدوية. يتم تشفير التخزين المحلي تلقائيا بمفتاح هذا الجهاز ولا يحتاج إلى هذه الكلمة."
        }
        "settings.syncEncryptedNote" if pt => {
            "Esta senha fica nos seus dispositivos e criptografa a sincronização em nuvem e backups criptografados manuais. O armazenamento local é criptografado automaticamente com a chave deste dispositivo e não precisa desta senha."
        }
        "settings.syncEncryptedNote" if ru => {
            "Этот пароль остается на ваших устройствах и шифрует облачную синхронизацию и ручные зашифрованные резервные копии. Локальное хранилище автоматически шифруется ключом этого устройства и не требует этого пароля."
        }
        "settings.syncEncryptedNote" if fr => {
            "Ce mot de passe reste sur vos appareils et chiffre la synchronisation cloud et les sauvegardes chiffrées manuelles. Le stockage local est chiffré automatiquement avec la clé de cet appareil et n’a pas besoin de ce mot de passe."
        }
        "settings.syncEncryptedNote" if ja => {
            "このパスワードは端末内に残り、クラウド同期と手動の暗号化バックアップを保護します。ローカル保存はこの端末のキーで自動的に暗号化されるため、このパスワードは不要です。"
        }
        "settings.syncEncryptedNote" if ko => {
            "이 비밀번호는 기기에 남아 클라우드 동기화와 수동 암호화 백업을 보호합니다. 로컬 저장은 기기 키로 자동 암호화되므로 이 비밀번호가 필요하지 않습니다."
        }
        "settings.syncEncryptedNote" => {
            "Protects cloud sync and encrypted backups. Keep it long term; forgotten passwords cannot restore cloud data or old backups. Local storage is encrypted automatically."
        }
        "sync.compare.cloudflare.fit" if zh => "适合长期使用、图片较多，或希望网页端稳定调用 AI。",
        "sync.compare.cloudflare.fit" if es => {
            "Ideal para uso a largo plazo, historiales con muchas imágenes o llamadas de IA estables desde el navegador."
        }
        "sync.compare.cloudflare.fit" if hi => {
            "दीर्घकालिक उपयोग, छवि-भारी इतिहास, या स्थिर ब्राउज़र AI कॉल के लिए सर्वश्रेष्ठ।"
        }
        "sync.compare.cloudflare.fit" if ar => {
            "مناسب للاستخدام طويل المدى، أو السجل كثير الصور، أو مكالمات ذكاء اصطناعي مستقرة من المتصفح."
        }
        "sync.compare.cloudflare.fit" if pt => {
            "Ideal para uso prolongado, históricos com muitas imagens ou chamadas de IA estáveis no navegador."
        }
        "sync.compare.cloudflare.fit" if ru => {
            "Подходит для долгой работы, истории с большим числом изображений или стабильных вызовов ИИ в браузере."
        }
        "sync.compare.cloudflare.fit" if fr => {
            "Idéal pour une utilisation à long terme, un historique riche en images ou des appels IA stables dans le navigateur."
        }
        "sync.compare.cloudflare.fit" if ja => {
            "長期使用、画像の多い履歴、または安定したブラウザの AI 呼び出しに最適です。"
        }
        "sync.compare.cloudflare.fit" if ko => {
            "장기간 사용, 이미지가 많은 기록 또는 안정적인 브라우저 AI 호출에 가장 적합합니다."
        }
        "sync.compare.cloudflare.fit" => {
            "Best for long-term use, image-heavy history, or stable browser AI calls."
        }
        "sync.compare.encrypted" if zh => {
            "Gist 和 Cloudflare 数据上传前会端到端加密；同步设置保存在本机。"
        }
        "sync.compare.encrypted" if es => {
            "Los datos de Gist y Cloudflare se cifran antes de subirlos; la configuración queda en este dispositivo."
        }
        "sync.compare.encrypted" if hi => {
            "Gist और Cloudflare डेटा अपलोड से पहले एन्क्रिप्ट होता है; सिंक सेटिंग्स इसी डिवाइस पर रहती हैं।"
        }
        "sync.compare.encrypted" if ar => {
            "تُشفّر بيانات Gist وCloudflare قبل الرفع؛ وتبقى إعدادات المزامنة على هذا الجهاز."
        }
        "sync.compare.encrypted" if pt => {
            "Os dados do Gist e Cloudflare são criptografados antes do envio; as configurações ficam neste dispositivo."
        }
        "sync.compare.encrypted" if ru => {
            "Данные Gist и Cloudflare шифруются перед загрузкой; настройки синхронизации остаются на этом устройстве."
        }
        "sync.compare.encrypted" if fr => {
            "Les données Gist et Cloudflare sont chiffrées avant envoi; les réglages restent sur cet appareil."
        }
        "sync.compare.encrypted" if ja => {
            "Gist と Cloudflare のデータはアップロード前に暗号化され、同期設定はこの端末に保存されます。"
        }
        "sync.compare.encrypted" if ko => {
            "Gist와 Cloudflare 데이터는 업로드 전에 암호화되며 동기화 설정은 이 기기에 남습니다."
        }
        "sync.compare.encrypted" => {
            "Gist and Cloudflare data is encrypted before upload; sync settings stay on this device."
        }
        "sync.autoSync.on" if zh => {
            "开启后，聊天、设置和技能变更会自动上传加密更新；仍可手动同步。"
        }
        "sync.autoSync.on" if es => {
            "Al activarla, los cambios de chats, ajustes y habilidades suben actualizaciones cifradas automáticamente. También puedes sincronizar manualmente."
        }
        "sync.autoSync.on" if hi => {
            "चालू होने पर, चैट, सेटिंग और कौशल बदलाव एन्क्रिप्टेड अपडेट अपने आप अपलोड करते हैं। आप फिर भी मैन्युअल रूप से सिंक कर सकते हैं।"
        }
        "sync.autoSync.on" if ar => {
            "عند تشغيلها، تُرفع تغييرات الدردشات والإعدادات والمهارات كتحديثات مشفرة تلقائياً. يمكنك أيضاً المزامنة يدوياً."
        }
        "sync.autoSync.on" if pt => {
            "Quando ativa, alterações de chats, configurações e habilidades enviam atualizações criptografadas automaticamente. Você ainda pode sincronizar manualmente."
        }
        "sync.autoSync.on" if ru => {
            "Когда включено, изменения чатов, настроек и навыков автоматически отправляют зашифрованные обновления. Ручная синхронизация остается доступной."
        }
        "sync.autoSync.on" if fr => {
            "Quand elle est activée, les changements des chats, réglages et compétences envoient automatiquement des mises à jour chiffrées. Vous pouvez toujours synchroniser manuellement."
        }
        "sync.autoSync.on" if ja => {
            "オンにすると、チャット、設定、スキルの変更が暗号化された更新として自動アップロードされます。手動同期も引き続き使えます。"
        }
        "sync.autoSync.on" if ko => {
            "켜면 채팅, 설정, 스킬 변경 사항이 암호화된 업데이트로 자동 업로드됩니다. 수동 동기화도 계속 사용할 수 있습니다."
        }
        "sync.autoSync.on" => {
            "When on, chat, settings, and Skill changes upload encrypted updates automatically. Manual sync stays available."
        }
        "sync.autoSync.off" if zh => "关闭后，ZeroChat 会保留当前云配置，只在点击立即同步时同步。",
        "sync.autoSync.off" if es => {
            "Al desactivarla, ZeroChat conserva esta configuración en la nube y solo sincroniza cuando pulsas Sincronizar ahora."
        }
        "sync.autoSync.off" if hi => {
            "बंद होने पर, ZeroChat यह क्लाउड सेटअप रखता है और केवल अभी सिंक करें पर क्लिक करने पर सिंक करता है।"
        }
        "sync.autoSync.off" if ar => {
            "عند إيقافها، يحتفظ ZeroChat بإعداد السحابة الحالي ولا يزامن إلا عند الضغط على مزامنة الآن."
        }
        "sync.autoSync.off" if pt => {
            "Quando desativada, o ZeroChat mantém esta configuração de nuvem e só sincroniza quando você toca em Sincronizar agora."
        }
        "sync.autoSync.off" if ru => {
            "Когда выключено, ZeroChat сохраняет эту облачную настройку и синхронизирует только по нажатию «Синхронизировать сейчас»."
        }
        "sync.autoSync.off" if fr => {
            "Quand elle est désactivée, ZeroChat conserve cette configuration cloud et synchronise seulement quand vous cliquez sur Synchroniser maintenant."
        }
        "sync.autoSync.off" if ja => {
            "オフにすると、このクラウド設定は保持され、今すぐ同期を押したときだけ同期します。"
        }
        "sync.autoSync.off" if ko => {
            "끄면 현재 클라우드 설정은 유지하고 지금 동기화를 누를 때만 동기화합니다."
        }
        "sync.autoSync.off" => {
            "When off, ZeroChat keeps this cloud setup and syncs only when you tap Sync now."
        }
        "sync.compare.gist.fit" if zh => {
            "Gist 也会同步 Linux 的加密数据；图片很多的大历史仍更适合 Cloudflare。"
        }
        "sync.compare.gist.fit" if es => {
            "Gist también sincroniza datos cifrados desde Linux; Cloudflare sigue siendo mejor para historiales grandes con muchas imágenes."
        }
        "sync.compare.gist.fit" if hi => {
            "Gist अब Linux से भी एन्क्रिप्टेड डेटा सिंक करता है; बड़ी image-heavy history के लिए Cloudflare बेहतर है।"
        }
        "sync.compare.gist.fit" if ar => {
            "يزامن Gist البيانات المشفرة من Linux أيضا؛ يبقى Cloudflare أفضل للسجلات الكبيرة الغنية بالصور."
        }
        "sync.compare.gist.fit" if pt => {
            "O Gist também sincroniza dados criptografados no Linux; o Cloudflare ainda é melhor para históricos grandes com muitas imagens."
        }
        "sync.compare.gist.fit" if ru => {
            "Gist теперь синхронизирует зашифрованные данные и в Linux; Cloudflare лучше для больших историй с изображениями."
        }
        "sync.compare.gist.fit" if fr => {
            "Gist synchronise aussi les données chiffrées sous Linux; Cloudflare reste préférable pour les gros historiques avec images."
        }
        "sync.compare.gist.fit" if ja => {
            "Gist は Linux でも暗号化データを同期できます。画像が多い長期履歴には Cloudflare が向いています。"
        }
        "sync.compare.gist.fit" if ko => {
            "Gist도 이제 Linux에서 암호화 데이터를 동기화합니다. 이미지가 많은 큰 기록에는 Cloudflare가 더 좋습니다."
        }
        "sync.compare.gist.fit" => {
            "Gist syncs encrypted data from Linux too; Cloudflare remains better for large image-heavy history."
        }
        "sync.requirement.local" if zh => {
            "本地模式不会上传数据；需要跨设备时请选择 Gist 或 Cloudflare。"
        }
        "sync.requirement.local" if es => {
            "El modo local no sube datos. Elige Gist o Cloudflare para sincronizar entre dispositivos."
        }
        "sync.requirement.local" if hi => {
            "लोकल मोड डेटा अपलोड नहीं करता। डिवाइसों के बीच सिंक के लिए Gist या Cloudflare चुनें।"
        }
        "sync.requirement.local" if ar => {
            "الوضع المحلي لا يرفع البيانات. اختر Gist أو Cloudflare للمزامنة بين الأجهزة."
        }
        "sync.requirement.local" if pt => {
            "O modo local não envia dados. Escolha Gist ou Cloudflare para sincronizar entre dispositivos."
        }
        "sync.requirement.local" if ru => {
            "Локальный режим не загружает данные. Выберите Gist или Cloudflare для синхронизации между устройствами."
        }
        "sync.requirement.local" if fr => {
            "Le mode local n’envoie aucune donnée. Choisissez Gist ou Cloudflare pour synchroniser plusieurs appareils."
        }
        "sync.requirement.local" if ja => {
            "ローカルモードではデータをアップロードしません。複数端末で同期するには Gist または Cloudflare を選択してください。"
        }
        "sync.requirement.local" if ko => {
            "로컬 모드는 데이터를 업로드하지 않습니다. 여러 기기에서 동기화하려면 Gist 또는 Cloudflare를 선택하세요."
        }
        "sync.requirement.local" => {
            "Local mode does not upload data. Choose Gist or Cloudflare when you need multiple devices."
        }
        "sync.localSummary" if zh => "云同步未开启。点“开启云同步”选择 GitHub Gist 或 Cloudflare。",
        "sync.localSummary" if es => {
            "La sincronización en la nube está desactivada. Actívala para elegir GitHub Gist o Cloudflare."
        }
        "sync.localSummary" if hi => {
            "क्लाउड सिंक बंद है। GitHub Gist या Cloudflare चुनने के लिए क्लाउड सिंक शुरू करें।"
        }
        "sync.localSummary" if ar => {
            "مزامنة السحابة متوقفة. ابدأ مزامنة السحابة لاختيار GitHub Gist أو Cloudflare."
        }
        "sync.localSummary" if pt => {
            "A sincronização na nuvem está desligada. Ative-a para escolher GitHub Gist ou Cloudflare."
        }
        "sync.localSummary" if ru => {
            "Облачная синхронизация выключена. Включите ее, чтобы выбрать GitHub Gist или Cloudflare."
        }
        "sync.localSummary" if fr => {
            "La synchronisation cloud est désactivée. Activez-la pour choisir GitHub Gist ou Cloudflare."
        }
        "sync.localSummary" if ja => {
            "クラウド同期はオフです。クラウド同期を開始して GitHub Gist または Cloudflare を選択してください。"
        }
        "sync.localSummary" if ko => {
            "클라우드 동기화가 꺼져 있습니다. GitHub Gist 또는 Cloudflare를 선택하려면 클라우드 동기화를 시작하세요."
        }
        "sync.localSummary" => {
            "Cloud sync is off. Start cloud sync to choose GitHub Gist or Cloudflare."
        }
        "sync.status.complete" if zh => "同步完成",
        "sync.status.complete" if es => "Sincronización completa",
        "sync.status.complete" if hi => "सिंक पूरा हुआ",
        "sync.status.complete" if ar => "اكتملت المزامنة",
        "sync.status.complete" if pt => "Sincronização concluída",
        "sync.status.complete" if ru => "Синхронизация завершена",
        "sync.status.complete" if fr => "Synchronisation terminée",
        "sync.status.complete" if ja => "同期完了",
        "sync.status.complete" if ko => "동기화 완료",
        "sync.status.complete" => "Sync complete",
        "sync.status.remoteAccepted" if zh => "已采用远端加密数据",
        "sync.status.remoteAccepted" if es => "Datos cifrados remotos aplicados",
        "sync.status.remoteAccepted" if hi => "रिमोट एन्क्रिप्टेड डेटा लागू हुआ",
        "sync.status.remoteAccepted" if ar => "تم تطبيق البيانات المشفرة البعيدة",
        "sync.status.remoteAccepted" if pt => "Dados criptografados remotos aplicados",
        "sync.status.remoteAccepted" if ru => "Удаленные зашифрованные данные применены",
        "sync.status.remoteAccepted" if fr => "Données chiffrées distantes appliquées",
        "sync.status.remoteAccepted" if ja => "リモートの暗号化データを適用しました",
        "sync.status.remoteAccepted" if ko => "원격 암호화 데이터가 적용됨",
        "sync.status.remoteAccepted" => "Remote encrypted data applied",
        "message.dataPasswordRequired" if zh => "需要填写数据加密密码。",
        "message.dataPasswordRequired" if es => "La contraseña de cifrado de datos es obligatoria.",
        "message.dataPasswordRequired" if hi => "डेटा एन्क्रिप्शन पासवर्ड जरूरी है।",
        "message.dataPasswordRequired" if ar => "كلمة مرور تشفير البيانات مطلوبة.",
        "message.dataPasswordRequired" if pt => "A senha de criptografia de dados é obrigatória.",
        "message.dataPasswordRequired" if ru => "Требуется пароль шифрования данных.",
        "message.dataPasswordRequired" if fr => {
            "Le mot de passe de chiffrement des données est requis."
        }
        "message.dataPasswordRequired" if ja => "データ暗号化パスワードが必要です。",
        "message.dataPasswordRequired" if ko => "데이터 암호화 비밀번호가 필요합니다.",
        "message.dataPasswordRequired" => "Data encryption password is required.",
        "message.savedLocallySyncQueued" if zh => "已保存到本机。联网且同步配置完整后会自动重试。",
        "message.savedLocallySyncQueued" if es => {
            "Guardado localmente. La sincronización se reintentará cuando haya conexión y esté configurada."
        }
        "message.savedLocallySyncQueued" if hi => {
            "स्थानीय रूप से सहेजा गया। ऑनलाइन और कॉन्फ़िगर होने पर सिंक फिर प्रयास करेगा।"
        }
        "message.savedLocallySyncQueued" if ar => {
            "تم الحفظ محليا. ستعيد المزامنة المحاولة عند الاتصال واكتمال الإعداد."
        }
        "message.savedLocallySyncQueued" if pt => {
            "Salvo localmente. A sincronização tentará novamente quando houver conexão e configuração."
        }
        "message.savedLocallySyncQueued" if ru => {
            "Сохранено локально. Синхронизация повторится при подключении и настроенной синхронизации."
        }
        "message.savedLocallySyncQueued" if fr => {
            "Enregistré localement. La synchronisation réessaiera une fois en ligne et configurée."
        }
        "message.savedLocallySyncQueued" if ja => {
            "ローカルに保存しました。オンラインで設定済みになると同期を再試行します。"
        }
        "message.savedLocallySyncQueued" if ko => {
            "로컬에 저장되었습니다. 온라인이고 설정이 완료되면 동기화를 다시 시도합니다."
        }
        "message.savedLocallySyncQueued" => {
            "Saved locally. Sync will retry when online and configured."
        }
        "error.cloudSyncStepFailed" if zh => "云同步步骤失败：{message}",
        "error.cloudSyncStepFailed" if es => {
            "Falló un paso de sincronización en la nube: {message}"
        }
        "error.cloudSyncStepFailed" if hi => "क्लाउड सिंक चरण विफल: {message}",
        "error.cloudSyncStepFailed" if ar => "فشلت خطوة في المزامنة السحابية: {message}",
        "error.cloudSyncStepFailed" if pt => {
            "Falha em uma etapa da sincronização na nuvem: {message}"
        }
        "error.cloudSyncStepFailed" if ru => "Сбой шага облачной синхронизации: {message}",
        "error.cloudSyncStepFailed" if fr => {
            "Échec d'une étape de synchronisation cloud : {message}"
        }
        "error.cloudSyncStepFailed" if ja => "クラウド同期ステップに失敗しました: {message}",
        "error.cloudSyncStepFailed" if ko => "클라우드 동기화 단계 실패: {message}",
        "error.cloudSyncStepFailed" => "Cloud sync step failed: {message}",
        "error.firstSyncConflict" if zh => "本机和云端都有数据。请先选择使用本机、使用云端或合并。",
        "error.firstSyncConflict" if es => {
            "El dispositivo y la nube ya tienen datos. Elige local, nube o fusionar antes de sincronizar."
        }
        "error.firstSyncConflict" if hi => {
            "स्थानीय और क्लाउड दोनों में डेटा है। सिंक से पहले स्थानीय, क्लाउड या merge चुनें।"
        }
        "error.firstSyncConflict" if ar => {
            "توجد بيانات محلية وسحابية معا. اختر المحلي أو السحابة أو الدمج قبل المزامنة."
        }
        "error.firstSyncConflict" if pt => {
            "Local e nuvem já têm dados. Escolha local, nuvem ou mesclar antes de sincronizar."
        }
        "error.firstSyncConflict" if ru => {
            "Данные есть и локально, и в облаке. Перед синхронизацией выберите локальные, облачные или объединение."
        }
        "error.firstSyncConflict" if fr => {
            "Des données existent en local et dans le cloud. Choisissez local, cloud ou fusion avant de synchroniser."
        }
        "error.firstSyncConflict" if ja => {
            "ローカルとクラウドの両方にデータがあります。同期前にローカル、クラウド、または結合を選択してください。"
        }
        "error.firstSyncConflict" if ko => {
            "로컬과 클라우드 모두에 데이터가 있습니다. 동기화 전에 로컬, 클라우드 또는 병합을 선택하세요."
        }
        "error.firstSyncConflict" => {
            "Local and cloud both have data. Choose local, cloud, or merge before syncing."
        }
        "error.remoteDataBadFormat" if zh => "远端同步数据格式不正确。",
        "error.remoteDataBadFormat" if es => {
            "El formato de los datos remotos de sincronización no es válido."
        }
        "error.remoteDataBadFormat" if hi => "रिमोट सिंक डेटा फ़ॉर्मैट अमान्य है।",
        "error.remoteDataBadFormat" if ar => "تنسيق بيانات المزامنة البعيدة غير صالح.",
        "error.remoteDataBadFormat" if pt => {
            "O formato dos dados remotos de sincronização é inválido."
        }
        "error.remoteDataBadFormat" if ru => {
            "Формат удаленных данных синхронизации недействителен."
        }
        "error.remoteDataBadFormat" if fr => {
            "Le format des données de synchronisation distantes est invalide."
        }
        "error.remoteDataBadFormat" if ja => "リモート同期データの形式が無効です。",
        "error.remoteDataBadFormat" if ko => "원격 동기화 데이터 형식이 올바르지 않습니다.",
        "error.remoteDataBadFormat" => "Remote sync data format is invalid.",
        "error.remoteUpdated" if zh => "云端已有更新，请重新同步一次。",
        "error.remoteUpdated" if es => {
            "Los datos en la nube cambiaron. Sincroniza de nuevo antes de subir."
        }
        "error.remoteUpdated" if hi => "क्लाउड डेटा बदल गया है। अपलोड करने से पहले फिर से सिंक करें।",
        "error.remoteUpdated" if ar => "تغيرت بيانات السحابة. زامن مرة أخرى قبل الرفع.",
        "error.remoteUpdated" if pt => {
            "Os dados na nuvem mudaram. Sincronize novamente antes de enviar."
        }
        "error.remoteUpdated" if ru => {
            "Данные в облаке изменились. Синхронизируйте снова перед отправкой."
        }
        "error.remoteUpdated" if fr => {
            "Les données cloud ont changé. Synchronisez à nouveau avant d'envoyer."
        }
        "error.remoteUpdated" if ja => {
            "クラウドデータが変更されました。アップロード前にもう一度同期してください。"
        }
        "error.remoteUpdated" if ko => {
            "클라우드 데이터가 변경되었습니다. 업로드 전에 다시 동기화하세요."
        }
        "error.remoteUpdated" => "Cloud data changed. Sync again before uploading.",
        "error.remoteWrongPassword" if zh => "解密失败：数据加密密码不正确，或远端数据已损坏。",
        "error.remoteWrongPassword" if es => {
            "Error de descifrado: la contraseña de cifrado de datos es incorrecta o los datos remotos están dañados."
        }
        "error.remoteWrongPassword" if hi => {
            "डिक्रिप्शन विफल: डेटा एन्क्रिप्शन पासवर्ड गलत है या रिमोट डेटा क्षतिग्रस्त है।"
        }
        "error.remoteWrongPassword" if ar => {
            "فشل فك التشفير: كلمة مرور تشفير البيانات غير صحيحة أو البيانات البعيدة تالفة."
        }
        "error.remoteWrongPassword" if pt => {
            "Falha ao descriptografar: a senha de criptografia de dados está errada ou os dados remotos estão danificados."
        }
        "error.remoteWrongPassword" if ru => {
            "Не удалось расшифровать: пароль шифрования данных неверен или удаленные данные повреждены."
        }
        "error.remoteWrongPassword" if fr => {
            "Échec du déchiffrement : le mot de passe de chiffrement des données est incorrect ou les données distantes sont endommagées."
        }
        "error.remoteWrongPassword" if ja => {
            "復号に失敗しました: データ暗号化パスワードが違うか、リモートデータが壊れています。"
        }
        "error.remoteWrongPassword" if ko => {
            "복호화 실패: 데이터 암호화 비밀번호가 틀렸거나 원격 데이터가 손상되었습니다."
        }
        "error.remoteWrongPassword" => {
            "Decryption failed: the data encryption password is wrong or the remote data is damaged."
        }
        "error.syncEndpointUnsafe" if zh => "Cloudflare Worker 地址必须是安全的 HTTPS 远程地址。",
        "error.syncEndpointUnsafe" if es => {
            "La URL de Cloudflare Worker debe ser una dirección HTTPS remota segura."
        }
        "error.syncEndpointUnsafe" if hi => {
            "Cloudflare Worker URL सुरक्षित रिमोट HTTPS पता होना चाहिए।"
        }
        "error.syncEndpointUnsafe" if ar => {
            "يجب أن يكون رابط Cloudflare Worker عنوان HTTPS بعيدا وآمنا."
        }
        "error.syncEndpointUnsafe" if pt => {
            "A URL do Cloudflare Worker deve ser um endereço HTTPS remoto seguro."
        }
        "error.syncEndpointUnsafe" if ru => {
            "URL Cloudflare Worker должен быть безопасным удаленным HTTPS-адресом."
        }
        "error.syncEndpointUnsafe" if fr => {
            "L’URL Cloudflare Worker doit être une adresse HTTPS distante sûre."
        }
        "error.syncEndpointUnsafe" if ja => {
            "Cloudflare Worker URL は安全なリモート HTTPS アドレスにしてください。"
        }
        "error.syncEndpointUnsafe" if ko => {
            "Cloudflare Worker URL은 안전한 원격 HTTPS 주소여야 합니다."
        }
        "error.syncEndpointUnsafe" => "Cloudflare Worker URL must be a safe remote HTTPS address.",
        "settings.modelListNote" if zh => {
            "可以先从服务商获取模型，也可以手动输入。按空格或点添加模型会变成标签，标签可以拖动排序。"
        }
        "settings.modelListNote" if es => {
            "Primero obtenga modelos del proveedor o escríbalos manualmente. Presione Espacio o use Añadir modelo para convertir nombres en etiquetas; arrástrelas para reordenarlas."
        }
        "settings.modelListNote" if hi => {
            "पहले प्रदाता से मॉडल प्राप्त करें या उन्हें मैन्युअल रूप से टाइप करें। नामों को टैग बनाने के लिए स्पेस या मॉडल जोड़ें उपयोग करें; टैगों को पुनः व्यवस्थित करने के लिए खींचें।"
        }
        "settings.modelListNote" if ar => {
            "اجلب النماذج من الموفر أو اكتبها يدويا. اضغط مسافة أو استخدم إضافة نموذج لتحويل الأسماء إلى علامات؛ اسحب العلامات لإعادة ترتيبها."
        }
        "settings.modelListNote" if pt => {
            "Busque modelos do provedor ou digite-os manualmente. Pressione Espaço ou use Adicionar modelo para transformar nomes em tags; arraste as tags para reordená-las."
        }
        "settings.modelListNote" if ru => {
            "Получите модели от поставщика или введите их вручную. Нажмите пробел или используйте «Добавить модель», чтобы превратить названия в теги; перетаскивайте теги для сортировки."
        }
        "settings.modelListNote" if fr => {
            "Récupérez les modèles auprès du fournisseur ou saisissez-les manuellement. Appuyez sur Espace ou utilisez Ajouter un modèle pour créer des étiquettes; faites-les glisser pour les réorganiser."
        }
        "settings.modelListNote" if ja => {
            "プロバイダーからモデルを取得するか、手動で入力します。スペースまたは「モデルを追加」で名前をタグに変換できます。タグはドラッグで並べ替えます。"
        }
        "settings.modelListNote" if ko => {
            "공급자에서 모델을 가져오거나 수동으로 입력하세요. Space 또는 모델 추가로 이름을 태그로 만들고, 태그를 드래그해 순서를 바꿉니다."
        }
        "settings.modelListNote" => {
            "Fetch models from the provider first, or type them manually. Press Space or use Add model to turn names into tags; drag tags to reorder them."
        }
        "placeholder.modelList" if zh => "输入模型名后按空格或点添加模型，例如 gpt-5.2",
        "placeholder.modelList" if es => {
            "Escriba un modelo y presione Espacio o Añadir modelo, por ejemplo gpt-5.2"
        }
        "placeholder.modelList" if hi => {
            "मॉडल का नाम टाइप करें, फिर स्पेस या मॉडल जोड़ें दबाएँ, उदाहरण के लिए gpt-5.2"
        }
        "placeholder.modelList" if ar => {
            "اكتب اسم نموذج ثم اضغط مسافة أو إضافة نموذج، مثال gpt-5.2"
        }
        "placeholder.modelList" if pt => {
            "Digite um modelo e pressione Espaço ou Adicionar modelo, por exemplo gpt-5.2"
        }
        "placeholder.modelList" if ru => {
            "Введите модель и нажмите пробел или «Добавить модель», например gpt-5.2"
        }
        "placeholder.modelList" if fr => {
            "Tapez un modèle puis appuyez sur Espace ou Ajouter un modèle, par exemple gpt-5.2"
        }
        "placeholder.modelList" if ja => {
            "モデル名を入力し、スペースまたは「モデルを追加」を押します。例: gpt-5.2"
        }
        "placeholder.modelList" if ko => {
            "모델 이름을 입력한 뒤 Space 또는 모델 추가를 누르세요. 예: gpt-5.2"
        }
        "placeholder.modelList" => {
            "Type a model name, then press Space or Add model, for example gpt-5.2"
        }
        "field.skillAutoCount" if zh => "自动匹配数量",
        "field.skillAutoCount" if es => "Cantidad automática",
        "field.skillAutoCount" if hi => "ऑटो मिलान संख्या",
        "field.skillAutoCount" if ar => "عدد المطابقة التلقائية",
        "field.skillAutoCount" if pt => "Quantidade automática",
        "field.skillAutoCount" if ru => "Число автоподбора",
        "field.skillAutoCount" if fr => "Nombre auto",
        "field.skillAutoCount" if ja => "自動一致数",
        "field.skillAutoCount" if ko => "자동 매칭 수",
        "field.skillAutoCount" => "Auto-match count",
        "field.skillContent" if zh => "技能内容",
        "field.skillContent" if es => "Contenido de la habilidad",
        "field.skillContent" if hi => "कौशल सामग्री",
        "field.skillContent" if ar => "محتوى المهارة",
        "field.skillContent" if pt => "Conteúdo da habilidade",
        "field.skillContent" if ru => "Содержимое навыка",
        "field.skillContent" if fr => "Contenu de la compétence",
        "field.skillContent" if ja => "スキル内容",
        "field.skillContent" if ko => "스킬 내용",
        "field.skillContent" => "Skill content",
        "field.skillContextBudget" if zh => "上下文预算",
        "field.skillContextBudget" if es => "Presupuesto de contexto",
        "field.skillContextBudget" if hi => "संदर्भ बजट",
        "field.skillContextBudget" if ar => "ميزانية السياق",
        "field.skillContextBudget" if pt => "Orçamento de contexto",
        "field.skillContextBudget" if ru => "Бюджет контекста",
        "field.skillContextBudget" if fr => "Budget de contexte",
        "field.skillContextBudget" if ja => "コンテキスト予算",
        "field.skillContextBudget" if ko => "컨텍스트 예산",
        "field.skillContextBudget" => "Context budget",
        "field.skillName" if zh => "技能名称",
        "field.skillName" if es => "Nombre de la habilidad",
        "field.skillName" if hi => "कौशल नाम",
        "field.skillName" if ar => "اسم المهارة",
        "field.skillName" if pt => "Nome da habilidade",
        "field.skillName" if ru => "Название навыка",
        "field.skillName" if fr => "Nom de la compétence",
        "field.skillName" if ja => "スキル名",
        "field.skillName" if ko => "스킬 이름",
        "field.skillName" => "Skill name",
        "label.skillAutoMatch" if zh => "自动",
        "label.skillAutoMatch" if es => "Auto",
        "label.skillAutoMatch" if hi => "ऑटो",
        "label.skillAutoMatch" if ar => "تلقائي",
        "label.skillAutoMatch" if pt => "Auto",
        "label.skillAutoMatch" if ru => "Авто",
        "label.skillAutoMatch" if fr => "Auto",
        "label.skillAutoMatch" if ja => "自動",
        "label.skillAutoMatch" if ko => "자동",
        "label.skillAutoMatch" => "Auto",
        "label.skillFixed" if zh => "固定",
        "label.skillFixed" if es => "Fijado",
        "label.skillFixed" if hi => "पिन",
        "label.skillFixed" if ar => "مثبت",
        "label.skillFixed" if pt => "Fixada",
        "label.skillFixed" if ru => "Закреплено",
        "label.skillFixed" if fr => "Épinglée",
        "label.skillFixed" if ja => "固定",
        "label.skillFixed" if ko => "고정",
        "label.skillFixed" => "Pinned",
        "label.skillGlobalAutoMatch" if zh => "默认匹配相关技能",
        "label.skillGlobalAutoMatch" if es => "Buscar habilidades relevantes por defecto",
        "label.skillGlobalAutoMatch" if hi => "डिफ़ॉल्ट रूप से प्रासंगिक कौशल मिलाएं",
        "label.skillGlobalAutoMatch" if ar => "مطابقة المهارات ذات الصلة افتراضياً",
        "label.skillGlobalAutoMatch" if pt => "Buscar habilidades relevantes por padrão",
        "label.skillGlobalAutoMatch" if ru => "По умолчанию подбирать релевантные навыки",
        "label.skillGlobalAutoMatch" if fr => "Associer les compétences pertinentes par défaut",
        "label.skillGlobalAutoMatch" if ja => "関連するスキルを既定で照合",
        "label.skillGlobalAutoMatch" if ko => "관련 스킬 기본 매칭",
        "label.skillGlobalAutoMatch" => "Match relevant skills by default",
        "placeholder.skillContent" if zh => "粘贴规则、提示词或项目说明",
        "placeholder.skillContent" if es => "Pega reglas, instrucciones o notas",
        "placeholder.skillContent" if hi => "नियम, प्रॉम्प्ट या नोट्स पेस्ट करें",
        "placeholder.skillContent" if ar => "الصق قواعد أو تعليمات أو ملاحظات",
        "placeholder.skillContent" if pt => "Cole regras, instruções ou notas",
        "placeholder.skillContent" if ru => "Вставьте правила, промпты или заметки",
        "placeholder.skillContent" if fr => "Collez règles, consignes ou notes",
        "placeholder.skillContent" if ja => "ルール、プロンプト、メモを貼り付け",
        "placeholder.skillContent" if ko => "규칙, 프롬프트 또는 메모 붙여넣기",
        "placeholder.skillContent" => "Paste rules, prompts, or notes",
        "placeholder.skillName" if zh => "例如：代码审查规则",
        "placeholder.skillName" if es => "Por ejemplo: reglas de revisión de código",
        "placeholder.skillName" if hi => "उदाहरण: कोड समीक्षा नियम",
        "placeholder.skillName" if ar => "مثال: قواعد مراجعة الكود",
        "placeholder.skillName" if pt => "Exemplo: regras de revisão de código",
        "placeholder.skillName" if ru => "Например: правила ревью кода",
        "placeholder.skillName" if fr => "Par exemple: règles de revue de code",
        "placeholder.skillName" if ja => "例: コードレビュー規則",
        "placeholder.skillName" if ko => "예: 코드 리뷰 규칙",
        "placeholder.skillName" => "For example: code review rules",
        "settings.skillBudgetNote" if zh => {
            "发送消息时只注入固定技能和最相关片段，不会把全部文件塞进上下文。"
        }
        "settings.skillBudgetNote" if es => {
            "Al enviar, solo se inyectan habilidades fijadas y fragmentos relevantes; no se mete todo el archivo en el contexto."
        }
        "settings.skillBudgetNote" if hi => {
            "भेजते समय केवल पिन किए गए कौशल और प्रासंगिक अंश जोड़े जाते हैं; पूरी फ़ाइल संदर्भ में नहीं जाती।"
        }
        "settings.skillBudgetNote" if ar => {
            "عند الإرسال، تتم إضافة المهارات المثبتة والمقاطع ذات الصلة فقط؛ لا يتم إدخال الملف بالكامل في السياق."
        }
        "settings.skillBudgetNote" if pt => {
            "Ao enviar, só entram habilidades fixadas e trechos relevantes; o arquivo inteiro não vai para o contexto."
        }
        "settings.skillBudgetNote" if ru => {
            "При отправке добавляются только закрепленные навыки и релевантные фрагменты; весь файл не помещается в контекст."
        }
        "settings.skillBudgetNote" if fr => {
            "À l'envoi, seules les compétences épinglées et les extraits pertinents sont injectés; le fichier complet n'est pas placé dans le contexte."
        }
        "settings.skillBudgetNote" if ja => {
            "送信時は固定スキルと関連スニペットだけを追加し、ファイル全体はコンテキストに入れません。"
        }
        "settings.skillBudgetNote" if ko => {
            "보낼 때는 고정 스킬과 관련 조각만 넣고, 전체 파일을 컨텍스트에 넣지 않습니다."
        }
        "settings.skillBudgetNote" => {
            "Only pinned skills and relevant snippets are injected when you send. Full files are not pushed into context."
        }
        "settings.skillListProgress" if zh => "已显示 {shown}/{total} 个技能",
        "settings.skillListProgress" if es => "Mostrando {shown} de {total} habilidades",
        "settings.skillListProgress" if hi => "{total} में से {shown} कौशल दिख रहे हैं",
        "settings.skillListProgress" if ar => "يتم عرض {shown} من {total} مهارة",
        "settings.skillListProgress" if pt => "Mostrando {shown} de {total} habilidades",
        "settings.skillListProgress" if ru => "Показано {shown} из {total} навыков",
        "settings.skillListProgress" if fr => "{shown} sur {total} compétences affichées",
        "settings.skillListProgress" if ja => "{total} 件中 {shown} 件のスキルを表示",
        "settings.skillListProgress" if ko => "전체 {total}개 중 {shown}개 표시",
        "settings.skillListProgress" => "Showing {shown} of {total} skills",
        "settings.skillMeta" if zh => "{chunks} 段，约 {tokens} 词元",
        "settings.skillMeta" if es => "{chunks} fragmentos, unos {tokens} tókenes",
        "settings.skillMeta" if hi => "{chunks} अंश, लगभग {tokens} टोकन",
        "settings.skillMeta" if ar => "{chunks} مقاطع، حوالي {tokens} رمزًا",
        "settings.skillMeta" if pt => "{chunks} trechos, cerca de {tokens} tóquens",
        "settings.skillMeta" if ru => "{chunks} фрагментов, около {tokens} токенов",
        "settings.skillMeta" if fr => "{chunks} extraits, environ {tokens} jetons",
        "settings.skillMeta" if ja => "{chunks} 個の断片、約 {tokens} トークン",
        "settings.skillMeta" if ko => "{chunks}개 조각, 약 {tokens} 토큰",
        "settings.skillMeta" => "{chunks} chunks, about {tokens} tokens",
        "settings.skillsEmpty" if zh => "还没有技能。可导入 .md、.txt、.json，或直接粘贴内容。",
        "settings.skillsEmpty" if es => {
            "Aún no hay habilidades. Importa .md, .txt, .json o pega contenido."
        }
        "settings.skillsEmpty" if hi => {
            "अभी कोई कौशल नहीं है। .md, .txt, .json आयात करें या सामग्री पेस्ट करें।"
        }
        "settings.skillsEmpty" if ar => {
            "لا توجد مهارات بعد. استورد .md أو .txt أو .json، أو الصق المحتوى."
        }
        "settings.skillsEmpty" if pt => {
            "Ainda não há habilidades. Importe .md, .txt, .json ou cole conteúdo."
        }
        "settings.skillsEmpty" if ru => {
            "Навыков пока нет. Импортируйте .md, .txt, .json или вставьте текст."
        }
        "settings.skillsEmpty" if fr => {
            "Aucune compétence pour l'instant. Importez .md, .txt, .json ou collez du contenu."
        }
        "settings.skillsEmpty" if ja => {
            "スキルはまだありません。.md、.txt、.json をインポートするか、内容を貼り付けてください。"
        }
        "settings.skillsEmpty" if ko => {
            "아직 스킬이 없습니다. .md, .txt, .json을 가져오거나 내용을 붙여넣으세요."
        }
        "settings.skillsEmpty" => "No skills yet. Import .md, .txt, .json, or paste content.",
        "settings.skillsHelp" if zh => "技能会加密保存。固定项总是优先使用，自动项只在相关时加载。",
        "settings.skillsHelp" if es => {
            "Las habilidades se guardan cifradas. Las fijadas tienen prioridad; las automáticas se cargan solo cuando son relevantes."
        }
        "settings.skillsHelp" if hi => {
            "कौशल एन्क्रिप्ट होकर सहेजे जाते हैं। पिन किए गए कौशल प्राथमिकता पाते हैं; ऑटो कौशल केवल प्रासंगिक होने पर लोड होते हैं।"
        }
        "settings.skillsHelp" if ar => {
            "يتم حفظ المهارات مشفرة. المثبتة لها أولوية؛ والتلقائية يتم تحميلها فقط عند الصلة."
        }
        "settings.skillsHelp" if pt => {
            "Habilidades são salvas com criptografia. Fixadas têm prioridade; automáticas carregam só quando forem relevantes."
        }
        "settings.skillsHelp" if ru => {
            "Навыки сохраняются зашифрованными. Закрепленные имеют приоритет; автоматические загружаются только при релевантности."
        }
        "settings.skillsHelp" if fr => {
            "Les compétences sont enregistrées chiffrées. Les épinglées sont prioritaires; les automatiques ne se chargent que si elles sont pertinentes."
        }
        "settings.skillsHelp" if ja => {
            "スキルは暗号化して保存されます。固定項目を優先し、自動項目は関連時だけ読み込みます。"
        }
        "settings.skillsHelp" if ko => {
            "스킬은 암호화되어 저장됩니다. 고정 항목이 우선이며, 자동 항목은 관련 있을 때만 로드됩니다."
        }
        "settings.skillsHelp" => {
            "Skills are encrypted with your data. Pinned skills are prioritized; automatic skills load only when relevant."
        }
        "status.localSaved" if zh => "本机已保存",
        "status.localSaved" if es => "Guardado localmente",
        "status.localSaved" if hi => "स्थानीय रूप से सहेजा गया",
        "status.localSaved" if ar => "محفوظ محليا",
        "status.localSaved" if pt => "Salvo localmente",
        "status.localSaved" if ru => "Сохранено локально",
        "status.localSaved" if fr => "Enregistré localement",
        "status.localSaved" if ja => "ローカルに保存済み",
        "status.localSaved" if ko => "로컬에 저장됨",
        "status.localSaved" => "Saved locally",
        _ => "",
    }
}

pub(crate) fn localize_sync_status(locale: &str, status: &str) -> String {
    match status {
        "Sync complete" | "同步完成" => tr(locale, "sync.status.complete").to_owned(),
        "Remote data restored"
        | "Remote encrypted data applied"
        | "已采用远端加密数据"
        | "已采用远端加密数" => tr(locale, "sync.status.remoteAccepted").to_owned(),
        "Cloud sync is waiting for the data encryption password." => {
            tr(locale, "message.dataPasswordRequired").to_owned()
        }
        "Cloud sync failed" => tr(locale, "message.savedLocallySyncQueued").to_owned(),
        _ => localize_sync_error(locale, status),
    }
}

pub(crate) fn localize_sync_error(locale: &str, message: &str) -> String {
    let trimmed = message.trim();

    match trimmed {
        "Cloudflare access key is required." | "Cloudflare access key is required" => {
            return tr(locale, "message.dataPasswordRequired").to_owned();
        }
        "Data encryption password is required." => {
            return tr(locale, "message.dataPasswordRequired").to_owned();
        }
        "GitHub token is required." | "GitHub token is required" => {
            return tr(locale, "error.syncGithubTokenRequired").to_owned();
        }
        "Cloudflare Worker endpoint is required." | "Cloudflare Worker URL is required." => {
            return tr(locale, "message.cloudflareWorkerRequired").to_owned();
        }
        "Local and cloud both have data. Choose local, cloud, or merge before syncing." => {
            return tr(locale, "error.firstSyncConflict").to_owned();
        }
        "Local snapshot recovery is required." | "Local snapshot recovery failed." => {
            return tr(locale, "message.localSnapshotLoadFailed").to_owned();
        }
        "Local storage is unavailable." => {
            return tr(locale, "message.localStorageUnavailable").to_owned();
        }
        "Cloudflare Worker endpoint cannot include username or password."
        | "Cloudflare Worker endpoint cannot include query parameters or # fragments."
        | "Cloudflare Worker endpoint must use HTTPS unless it is a loopback address."
        | "Cloudflare Worker URL must use HTTPS unless it is a loopback address." => {
            return tr(locale, "error.syncEndpointUnsafe").to_owned();
        }
        "Remote data could not be decrypted with this password."
        | "Remote incremental data could not be decrypted with this password." => {
            return tr(locale, "error.remoteWrongPassword").to_owned();
        }
        "Cloud data changed. Pull again before uploading." => {
            return tr(locale, "error.remoteUpdated").to_owned();
        }
        "Remote incremental sync head is invalid."
        | "Remote incremental manifest key is invalid."
        | "Remote incremental sync timestamp is invalid."
        | "Remote incremental sync object is invalid."
        | "Remote incremental manifest is invalid."
        | "Remote incremental manifest timestamp does not match the head."
        | "Remote message chunk is invalid."
        | "Remote message chunk does not match its manifest reference."
        | "Remote skill chunk is invalid."
        | "Remote skill chunk does not match its manifest reference."
        | "Remote object uses an unsupported compression format." => {
            return tr(locale, "error.remoteDataBadFormat").to_owned();
        }
        _ => {}
    }

    if trimmed.starts_with("Remote snapshot has invalid ") {
        return tr(locale, "error.remoteDataBadFormat").to_owned();
    }

    for prefix in [
        "Cloud incremental object request failed:",
        "Cloud incremental object write failed:",
        "Cloud incremental object delete failed:",
        "Cloud incremental head write failed:",
        "Cloud legacy snapshot cleanup failed:",
    ] {
        if let Some(detail) = trimmed.strip_prefix(prefix) {
            return replace_placeholders(
                tr(locale, "error.cloudSyncStepFailed"),
                &[("{message}", detail.trim())],
            );
        }
    }

    trimmed.to_owned()
}

pub(crate) fn localize_ai_error(locale: &str, message: &str) -> String {
    let trimmed = message.trim();

    match trimmed {
        "Provider key is required." | "请先填写这个服务商的 API Key" => {
            return tr(locale, "error.providerKeyRequired").to_owned();
        }
        "Cloudflare access key is required." | "代理访问密钥为空" => {
            return tr(locale, "message.dataPasswordRequired").to_owned();
        }
        "Model name is required." | "请先填写模型名称" => {
            return tr(locale, "message.modelRequired").to_owned();
        }
        "Image model is required." | "请先选择图片模型" => {
            return tr(locale, "message.imageModelRequired").to_owned();
        }
        "Image prompt is required."
        | "Image edit prompt is required."
        | "请输入图片描述"
        | "请输入图片编辑描述" => {
            return tr(locale, "message.imagePromptRequired").to_owned();
        }
        "This provider does not support image generation."
        | "This provider does not support image editing."
        | "这个服务商接口不支持图片生成"
        | "这个服务商接口不支持图片编辑" => {
            return tr(locale, "message.imageProviderRequired").to_owned();
        }
        "Source image missing" => {
            return tr(locale, "message.sourceImageRequired").to_owned();
        }
        "Model list is not valid JSON" | "模型列表不是有效 JSON" => {
            return tr(locale, "error.modelsInvalidJson").to_owned();
        }
        "No models were returned by the provider." | "没有从服务商返回值中找到模型" =>
        {
            return tr(locale, "error.modelsEmpty").to_owned();
        }
        "Image response is not valid JSON"
        | "Image response did not include a result"
        | "Image response did not include usable image data"
        | "图片响应不是有效 JSON"
        | "图片响应中没有结果"
        | "图片响应中没有可用图片数据" => {
            return tr(locale, "error.imageResponseInvalid").to_owned();
        }
        _ => {}
    }

    if let Some(key) = provider_http_error_key(trimmed) {
        return tr(locale, key).to_owned();
    }

    if let Some(localized) = localize_labeled_ai_error(locale, trimmed) {
        return localized;
    }

    for (prefix, key) in [
        ("AI request failed: ", "error.aiRequestFailed"),
        ("AI 请求失败: ", "error.aiRequestFailed"),
        ("Model list request failed: ", "error.modelsRequestFailed"),
        ("模型列表请求失败: ", "error.modelsRequestFailed"),
    ] {
        if let Some(detail) = trimmed.strip_prefix(prefix) {
            return replace_placeholders(tr(locale, key), &[("{message}", detail)]);
        }
    }

    for prefix in ["AI response read failed", "读取 AI 响应失败"] {
        if trimmed == prefix || trimmed.starts_with(&format!("{prefix}:")) {
            return tr(locale, "error.aiResponseReadFailed").to_owned();
        }
    }

    for prefix in [
        "Image generation response read failed",
        "读取图片生成响应失败",
        "Image edit response read failed",
        "读取图片编辑响应失败",
    ] {
        if trimmed == prefix || trimmed.starts_with(&format!("{prefix}:")) {
            return tr(locale, "error.imageResponseInvalid").to_owned();
        }
    }

    for prefix in ["Model list read failed", "读取模型列表失败"] {
        if trimmed == prefix || trimmed.starts_with(&format!("{prefix}:")) {
            return tr(locale, "error.modelsReadFailed").to_owned();
        }
    }

    trimmed.to_owned()
}

fn provider_http_error_key(message: &str) -> Option<&'static str> {
    let normalized = message.to_lowercase();
    let status = provider_http_status(&normalized);

    if status == Some(401)
        || status == Some(403)
        || contains_any(&normalized, PROVIDER_AUTH_ERROR_MARKERS)
    {
        return Some("error.apiKeyInvalid");
    }

    if status == Some(402) || contains_any(&normalized, PROVIDER_QUOTA_ERROR_MARKERS) {
        return Some("error.apiBalanceInsufficient");
    }

    if status == Some(408)
        || status == Some(504)
        || contains_any(&normalized, PROVIDER_TIMEOUT_ERROR_MARKERS)
    {
        return Some("error.networkRequestFailed");
    }

    if status == Some(429) || contains_any(&normalized, PROVIDER_RATE_LIMIT_ERROR_MARKERS) {
        return Some("error.apiRateLimited");
    }

    if status == Some(404) || contains_any(&normalized, PROVIDER_ENDPOINT_MISSING_MARKERS) {
        return Some("error.providerEndpointMissing");
    }

    if matches!(status, Some(500..=599))
        || contains_any(&normalized, PROVIDER_UNAVAILABLE_ERROR_MARKERS)
    {
        return Some("error.apiUnavailable");
    }

    if contains_any(&normalized, PROVIDER_REQUEST_FAILURE_MARKERS) {
        return Some("error.apiRequestFailed");
    }

    None
}

fn provider_http_status(text: &str) -> Option<u16> {
    for marker in ["http", "status", "code"] {
        let mut rest = text;
        while let Some(index) = rest.find(marker) {
            let tail = &rest[index + marker.len()..];
            let candidate = tail.trim_start_matches(|character: char| {
                character == ':' || character.is_ascii_whitespace()
            });
            let digits = candidate
                .chars()
                .take_while(|character| character.is_ascii_digit())
                .collect::<String>();
            if digits.len() == 3 {
                return digits.parse::<u16>().ok();
            }
            rest = candidate;
        }
    }
    None
}

fn contains_any(text: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| text.contains(marker))
}

const PROVIDER_AUTH_ERROR_MARKERS: &[&str] = &[
    "api key is invalid",
    "authentication",
    "forbidden",
    "incorrect api key",
    "invalid api key",
    "permission_denied",
    "unauthorized",
];

const PROVIDER_QUOTA_ERROR_MARKERS: &[&str] = &[
    "balance",
    "billing",
    "credit",
    "insufficient_quota",
    "quota",
    "充值",
    "余额",
    "额度",
];

const PROVIDER_TIMEOUT_ERROR_MARKERS: &[&str] = &[
    "deadline exceeded",
    "network connection failed",
    "network request failed",
    "timed out",
    "timeout",
];

const PROVIDER_RATE_LIMIT_ERROR_MARKERS: &[&str] = &[
    "rate limit",
    "rate_limit",
    "requests per",
    "too many requests",
    "请求太频繁",
];

const PROVIDER_UNAVAILABLE_ERROR_MARKERS: &[&str] = &[
    "bad gateway",
    "gateway timeout",
    "overloaded",
    "server error",
    "service unavailable",
    "temporarily unavailable",
];

const PROVIDER_ENDPOINT_MISSING_MARKERS: &[&str] = &[
    "endpoint not found",
    "no route",
    "not found endpoint",
    "route not found",
    "route-missing",
    "unknown endpoint",
    "unsupported endpoint",
];

const PROVIDER_REQUEST_FAILURE_MARKERS: &[&str] = &[
    "ai request failed",
    "image edit request failed",
    "image generation request failed",
    "model list request failed",
    "request failed with http",
];

fn localize_labeled_ai_error(locale: &str, message: &str) -> Option<String> {
    for (suffix, key) in [
        (
            " cannot include a username or password",
            "error.urlCredentials",
        ),
        (" 不能包含用户名或密码", "error.urlCredentials"),
        (
            " cannot include query parameters or # fragments",
            "error.urlQuery",
        ),
        (" 不能包含 query 或 fragment", "error.urlQuery"),
        (" must be a remote HTTPS URL", "error.urlHttps"),
        (" 必须使用远程 HTTPS 地址", "error.urlHttps"),
        (
            " cannot use localhost, this device, private network, or LAN addresses",
            "error.urlLocalNetwork",
        ),
        (
            " 不能使用 localhost、本机、内网或局域网地址",
            "error.urlLocalNetwork",
        ),
    ] {
        if let Some(label) = message.strip_suffix(suffix) {
            let localized_label = localize_ai_error_label(locale, label);
            return Some(replace_placeholders(
                tr(locale, key),
                &[("{label}", &localized_label)],
            ));
        }
    }

    None
}

fn localize_ai_error_label(locale: &str, label: &str) -> String {
    match label.trim() {
        "AI proxy URL" | "代理地址" => tr(locale, "field.proxyUrl").to_owned(),
        "Base URL" => tr(locale, "field.baseUrl").to_owned(),
        other => other.to_owned(),
    }
}

pub(crate) fn language_summary(locale: &str) -> String {
    format!(
        "{}: {}",
        tr(locale, "field.language"),
        match locale {
            "zh-CN" => "中文",
            "es-ES" => "Español",
            "hi-IN" => "हिन्दी",
            "ar-SA" => "العربية",
            "pt-BR" => "Português",
            "ru-RU" => "Русский",
            "ja-JP" => "日本語",
            "ko-KR" => "한국어",
            "fr-FR" => "Français",
            _ => "English",
        },
    )
}

pub(crate) fn format_number(locale: &str, value: i64) -> String {
    let digits = value.unsigned_abs().to_string();
    let grouped = match locale {
        "ar-SA" => localize_decimal_digits(&group_western_digits(&digits, "٬"), ARABIC_DIGITS),
        "es-ES" | "pt-BR" => group_western_digits(&digits, "."),
        "fr-FR" | "ru-RU" => group_western_digits(&digits, "\u{202f}"),
        "hi-IN" => group_indian_digits(&digits),
        _ => group_western_digits(&digits, ","),
    };

    if value < 0 {
        format!("-{grouped}")
    } else {
        grouped
    }
}

const ARABIC_DIGITS: [char; 10] = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

fn group_western_digits(digits: &str, separator: &str) -> String {
    if digits.len() <= 3 {
        return digits.to_owned();
    }

    let mut groups = Vec::new();
    let mut end = digits.len();

    while end > 3 {
        let start = end - 3;
        groups.push(&digits[start..end]);
        end = start;
    }

    groups.push(&digits[..end]);
    groups.reverse();
    groups.join(separator)
}

fn group_indian_digits(digits: &str) -> String {
    if digits.len() <= 3 {
        return digits.to_owned();
    }

    let mut groups = Vec::new();
    let mut end = digits.len();
    groups.push(&digits[end - 3..end]);
    end -= 3;

    while end > 2 {
        let start = end - 2;
        groups.push(&digits[start..end]);
        end = start;
    }

    if end > 0 {
        groups.push(&digits[..end]);
    }

    groups.reverse();
    groups.join(",")
}

fn localize_decimal_digits(value: &str, localized_digits: [char; 10]) -> String {
    value
        .chars()
        .map(|character| {
            character
                .to_digit(10)
                .map(|digit| localized_digits[digit as usize])
                .unwrap_or(character)
        })
        .collect()
}

pub(crate) fn replace_placeholders(template: &str, values: &[(&str, &str)]) -> String {
    let mut text = template.to_owned();
    for (key, value) in values {
        text = text.replace(key, value);
    }
    text
}

#[cfg(test)]
mod tests {
    use super::{format_number, localize_ai_error, tr};

    #[test]
    fn formats_supported_locale_numbers() {
        assert_eq!(format_number("en-US", 1_234_567), "1,234,567");
        assert_eq!(format_number("es-ES", 1_234_567), "1.234.567");
        assert_eq!(format_number("fr-FR", 1_234_567), "1\u{202f}234\u{202f}567");
        assert_eq!(format_number("hi-IN", 1_234_567), "12,34,567");
        assert_eq!(format_number("ar-SA", 1_234_567), "١٬٢٣٤٬٥٦٧");
    }

    #[test]
    fn provider_http_errors_stay_human_readable() {
        assert_eq!(
            localize_ai_error(
                "zh-CN",
                r#"AI request failed: {"error":{"code":"insufficient_quota"}} HTTP 402"#,
            ),
            "API 余额不足，请充值后重试"
        );
        assert_eq!(
            localize_ai_error(
                "en-US",
                r#"Model list request failed: {"error":"invalid API key"} HTTP 401"#,
            ),
            "API key is invalid. Check that it was copied completely."
        );
        assert_eq!(
            localize_ai_error(
                "en-US",
                r#"Image generation request failed: {"error":{"message":"model does not exist"}}"#,
            ),
            "The provider could not complete the request. Try again later."
        );
        assert_eq!(
            localize_ai_error(
                "en-US",
                r#"Audio speech request failed: {"error":{"message":"route not found"}} HTTP 404"#,
            ),
            "This provider or relay does not expose that endpoint. Check the capability, Base URL, or AI proxy path."
        );
    }

    #[test]
    fn feature_hint_copy_stays_localized() {
        assert_eq!(tr("zh-CN", "featureHint.dismiss"), "知道了");
        assert_eq!(tr("en-US", "featureHint.dismiss"), "Got it");
        assert!(tr("zh-CN", "featureHint.provider-model").contains("服务商和模型"));
        assert!(tr("en-US", "featureHint.provider-model").contains("provider and model"));
    }

    #[test]
    fn model_capability_labels_stay_localized() {
        assert_eq!(tr("zh-CN", "capability.chat"), "文字对话");
        assert_eq!(tr("zh-CN", "capability.image-generation"), "图片生成");
        assert_eq!(tr("zh-CN", "capability.audio-transcription"), "音频转写");
        assert_eq!(tr("zh-CN", "capability.vision"), "图片理解");
        assert_eq!(tr("zh-CN", "capability.tools"), "工具调用");
        assert_eq!(tr("zh-CN", "capability.model-list"), "模型列表");
        assert_eq!(tr("en-US", "capability.chat"), "Chat");
        assert_eq!(
            tr("en-US", "capability.image-generation"),
            "Image generation"
        );
        assert_eq!(
            tr("en-US", "capability.audio-transcription"),
            "Audio transcription"
        );
        assert_eq!(tr("en-US", "capability.vision"), "Vision");
        assert_eq!(tr("en-US", "capability.tools"), "Tool calling");
        assert_eq!(tr("en-US", "capability.model-list"), "Model list");
    }

    #[test]
    fn sync_field_hints_explain_credential_purpose() {
        assert!(tr("zh-CN", "settings.gistIdHint").contains("首次同步"));
        assert!(tr("en-US", "settings.gistFileHint").contains("Encrypted sync payload"));
        assert!(tr("zh-CN", "settings.githubTokenHint").contains("Gist 读写权限"));
        assert!(tr("en-US", "settings.cloudflareWorkerUrlHint").contains("HTTPS URL"));
        assert!(
            tr("zh-CN", "settings.cloudflareAccessKeyFieldHint").contains("ZEROCHAT_ACCESS_KEY")
        );
        assert!(tr("en-US", "settings.cloudflareAccessKeyNote").contains("cannot decrypt chats"));
    }

    #[test]
    fn provider_field_hints_explain_setup_purpose() {
        assert!(tr("zh-CN", "settings.providerNameHint").contains("聊天标题"));
        assert!(tr("zh-CN", "settings.providerBaseUrlHint").contains("Worker 地址"));
        assert!(tr("zh-CN", "settings.providerKeyHint").contains("安全存储"));
        assert_eq!(tr("zh-CN", "settings.capabilities"), "支持能力");
        assert_eq!(tr("zh-CN", "settings.interfaces"), "接口");
        assert!(tr("zh-CN", "settings.capabilityNote").contains("标准候选模型"));
        assert_eq!(tr("zh-CN", "settings.capabilityReadiness"), "能力就绪");
        assert!(tr("zh-CN", "settings.capabilityReadinessMissing").contains("{capabilities}"));
        assert!(tr("zh-CN", "settings.capabilityReadinessNote").contains("实时语音"));
        assert!(tr("en-US", "settings.providerNameHint").contains("model pickers"));
        assert!(tr("en-US", "settings.providerBaseUrlHint").contains("Worker URL"));
        assert!(tr("en-US", "settings.providerKeyHint").contains("secure storage"));
        assert_eq!(tr("en-US", "settings.capabilities"), "Capabilities");
        assert_eq!(tr("en-US", "settings.interfaces"), "Interfaces");
        assert!(tr("en-US", "settings.capabilityNote").contains("standard fallback model IDs"));
        assert_eq!(
            tr("en-US", "settings.capabilityReadiness"),
            "Capability readiness"
        );
        assert!(tr("en-US", "settings.capabilityReadinessMissing").contains("{capabilities}"));
        assert_eq!(
            tr("en-US", "settings.capabilityReadinessReady"),
            "Models covered"
        );
        assert!(tr("en-US", "settings.capabilityReadinessNote").contains("route health"));
        assert!(tr("zh-CN", "settings.capabilityReadinessNote").contains("路由健康"));
        assert!(tr("en-US", "settings.capabilityReadinessNote").contains("Realtime"));
    }
}
