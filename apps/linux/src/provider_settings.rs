use crate::{
    LinuxAppState,
    ai_protocol::{provider_proxy_access_key, provider_request},
    background::{BACKGROUND_TASK_DISCONNECTED, poll_background_result, spawn_model_list_request},
    i18n::{localize_ai_error, replace_placeholders, tr},
    models::ProviderConfig,
    models::ProviderKind,
    providers::{
        ProviderModelCapability, model_for_provider_audio_speech,
        model_for_provider_audio_transcription, model_for_provider_capability,
        provider_display_name, provider_key_missing, provider_request_is_current,
    },
    ui_helpers::{
        editable_entry, optional_text, row_spacing, settings_box, settings_card, settings_text,
    },
};
use gtk::prelude::*;
use std::sync::mpsc;

pub(crate) fn provider_settings(locale: &str, compact: bool, state: LinuxAppState) -> gtk::Box {
    let box_ = settings_box(compact);
    let status = settings_text("");
    status.add_css_class("dim-label");
    let add_provider = gtk::Button::with_label(tr(locale, "button.addProvider"));
    add_provider.add_css_class("suggested-action");
    let state_for_add = state.clone();
    let box_for_add = box_.clone();
    let status_for_add = status.clone();
    let locale_for_add = locale.to_owned();
    add_provider.connect_clicked(move |_| {
        let provider = state_for_add
            .add_custom_provider(tr(&locale_for_add, "provider.preset.custom-openai-relay"));
        box_for_add.append(&provider_settings_card(
            &locale_for_add,
            compact,
            state_for_add.clone(),
            provider,
            status_for_add.clone(),
        ));
        status_for_add.set_text(tr(&locale_for_add, "settings.changesSaved"));
    });
    box_.append(&add_provider);
    box_.append(&status);
    for provider in state.providers() {
        box_.append(&provider_settings_card(
            locale,
            compact,
            state.clone(),
            provider,
            status.clone(),
        ));
    }
    box_
}

fn provider_settings_card(
    locale: &str,
    compact: bool,
    state: LinuxAppState,
    provider: ProviderConfig,
    status: gtk::Label,
) -> gtk::Box {
    let provider_id = provider.id.clone();
    let card = settings_card(&provider_display_name(locale, &provider));
    card.append(&settings_text(tr(
        locale,
        "settings.interfaceTypeNoteCustom",
    )));
    provider_capability_summary(locale, &provider)
        .into_iter()
        .for_each(|text| {
            let summary = settings_text(&text);
            summary.add_css_class("dim-label");
            card.append(&summary);
        });
    card.append(&editable_entry(
        tr(locale, "field.name"),
        Some(&provider.name),
        {
            let state = state.clone();
            let provider_id = provider_id.clone();
            move |value| {
                if !value.is_empty() {
                    state.update_provider_config(&provider_id, |provider| {
                        provider.name = value;
                    });
                }
            }
        },
    ));
    card.append(&settings_text(tr(locale, "settings.providerNameHint")));
    card.append(&editable_entry(
        tr(locale, "field.baseUrl"),
        Some(&provider.base_url),
        {
            let state = state.clone();
            let provider_id = provider_id.clone();
            move |value| {
                state.update_provider_config(&provider_id, |provider| {
                    provider.base_url = value;
                });
            }
        },
    ));
    card.append(&settings_text(tr(locale, "settings.providerBaseUrlHint")));
    let provider_key = gtk::PasswordEntry::builder()
        .placeholder_text(if state.has_provider_key(&provider_id) {
            tr(locale, "placeholder.providerKeySaved")
        } else {
            tr(locale, "field.providerKey")
        })
        .hexpand(true)
        .build();
    let key_row = gtk::Box::new(gtk::Orientation::Horizontal, row_spacing(compact));
    key_row.append(&provider_key);
    let save_key = gtk::Button::with_label(tr(locale, "button.saveProviderKey"));
    let entry_for_save = provider_key.clone();
    let state_for_key = state.clone();
    let provider_id_for_key = provider_id.clone();
    let status_for_key = status.clone();
    let locale_for_key = locale.to_owned();
    save_key.connect_clicked(move |_| {
        let value = entry_for_save.text().trim().to_owned();
        if !value.is_empty() {
            match state_for_key.save_provider_key(&provider_id_for_key, &value) {
                Ok(()) => {
                    entry_for_save.set_text("");
                    status_for_key.set_text("");
                }
                Err(error) => {
                    eprintln!("ZeroChat Provider key commit failed: {error:#}");
                    status_for_key.set_text(tr(&locale_for_key, "message.secretSaveFailed"));
                }
            }
        }
    });
    key_row.append(&save_key);
    let clear_key = gtk::Button::with_label(tr(locale, "button.clearProviderKey"));
    let entry_for_clear = provider_key.clone();
    let state_for_clear_key = state.clone();
    let provider_id_for_clear_key = provider_id.clone();
    let status_for_clear_key = status.clone();
    let locale_for_clear_key = locale.to_owned();
    clear_key.connect_clicked(move |_| {
        match state_for_clear_key.save_provider_key(&provider_id_for_clear_key, "") {
            Ok(()) => {
                entry_for_clear.set_text("");
                status_for_clear_key.set_text("");
            }
            Err(error) => {
                eprintln!("ZeroChat Provider key clear commit failed: {error:#}");
                status_for_clear_key
                    .set_text(tr(&locale_for_clear_key, "message.secretSaveFailed"));
            }
        }
    });
    key_row.append(&clear_key);
    card.append(&key_row);
    card.append(&settings_text(tr(locale, "settings.providerKeyHint")));
    card.append(&settings_text(tr(
        locale,
        "settings.linuxProviderKeySessionNote",
    )));
    card.append(&editable_entry(
        tr(locale, "field.proxyUrl"),
        provider.proxy_url.as_deref(),
        {
            let state = state.clone();
            let provider_id = provider_id.clone();
            move |value| {
                state.update_provider_config(&provider_id, |provider| {
                    provider.proxy_url = optional_text(value);
                });
            }
        },
    ));
    card.append(&settings_text(tr(locale, "settings.proxyUrlNote")));
    let direct_request = gtk::CheckButton::with_label(tr(locale, "field.clientDirectRequest"));
    direct_request.set_active(provider.client_request_mode);
    let state_for_direct = state.clone();
    let provider_id_for_direct = provider_id.clone();
    direct_request.connect_toggled(move |button| {
        state_for_direct.update_provider_config(&provider_id_for_direct, |provider| {
            provider.client_request_mode = button.is_active();
        });
    });
    card.append(&direct_request);
    card.append(&settings_text(tr(locale, "settings.directRequestNote")));
    let connectivity_status = settings_text("");
    connectivity_status.add_css_class("dim-label");
    let check_connectivity = gtk::Button::with_label(tr(locale, "button.checkConnectivity"));
    let button_for_check = check_connectivity.clone();
    let status_for_check = connectivity_status.clone();
    let state_for_check = state.clone();
    let provider_id_for_check = provider_id.clone();
    let locale_for_check = locale.to_owned();
    check_connectivity.connect_clicked(move |_| {
        run_provider_connectivity_check(
            &locale_for_check,
            &provider_id_for_check,
            state_for_check.clone(),
            button_for_check.clone(),
            status_for_check.clone(),
        );
    });
    card.append(&check_connectivity);
    card.append(&connectivity_status);
    card.append(&settings_text(tr(
        locale,
        "settings.providerConnectivityPrivacy",
    )));
    let enabled = gtk::CheckButton::with_label(tr(locale, "field.enabled"));
    enabled.set_active(provider.enabled);
    let state_for_enabled = state.clone();
    let provider_id_for_enabled = provider_id.clone();
    let status_for_enabled = status.clone();
    let locale_for_enabled = locale.to_owned();
    enabled.connect_toggled(move |button| {
        if state_for_enabled.set_provider_enabled(&provider_id_for_enabled, button.is_active()) {
            status_for_enabled.set_text("");
        } else {
            status_for_enabled.set_text(tr(&locale_for_enabled, "notice.providerMinimum"));
            button.set_active(true);
        }
    });
    card.append(&enabled);

    let delete_provider = gtk::Button::with_label(tr(locale, "button.deleteProvider"));
    delete_provider.add_css_class("destructive-action");
    let card_for_delete = card.clone();
    let state_for_delete = state;
    let provider_id_for_delete = provider_id;
    let status_for_delete = status;
    let locale_for_delete = locale.to_owned();
    delete_provider.connect_clicked(move |_| {
        match state_for_delete.delete_provider(&provider_id_for_delete) {
            Ok(true) => {
                card_for_delete.set_visible(false);
                status_for_delete.set_text(tr(&locale_for_delete, "notice.providerDeleted"));
            }
            Ok(false) => {
                status_for_delete.set_text(tr(&locale_for_delete, "notice.providerMinimum"));
            }
            Err(error) => {
                eprintln!("ZeroChat Provider deletion commit failed: {error:#}");
                status_for_delete.set_text(tr(&locale_for_delete, "message.secretSaveFailed"));
            }
        }
    });
    card.append(&delete_provider);

    card
}

fn provider_capability_summary(locale: &str, provider: &ProviderConfig) -> Vec<String> {
    let mut summary = vec![
        tr(locale, "settings.capabilities").to_owned(),
        provider_settings_capability_summary(locale, provider),
        tr(locale, "settings.interfaces").to_owned(),
        provider_settings_endpoint_summary(provider),
    ];

    if !provider_settings_capability_checks(provider).is_empty() {
        summary.push(tr(locale, "settings.capabilityReadiness").to_owned());
        summary.push(provider_settings_capability_readiness_summary(
            locale, provider,
        ));
        summary.push(tr(locale, "settings.capabilityReadinessNote").to_owned());
    }

    summary.push(tr(locale, "settings.capabilityNote").to_owned());
    summary
}

fn provider_settings_capabilities(provider: &ProviderConfig) -> Vec<String> {
    let source = if provider.capabilities.is_empty() {
        match &provider.kind {
            ProviderKind::Anthropic => vec!["chat", "vision", "tools", "model-list"],
            ProviderKind::OpenaiResponses => vec![
                "chat",
                "vision",
                "tools",
                "image-generation",
                "image-editing",
                "model-list",
            ],
            ProviderKind::OpenaiCompatible => {
                vec!["chat", "vision", "tools", "embeddings", "model-list"]
            }
        }
        .into_iter()
        .map(str::to_owned)
        .collect()
    } else {
        provider.capabilities.clone()
    };
    let mut capabilities = Vec::new();

    for capability in source {
        let trimmed = capability.trim();
        if !trimmed.is_empty() && !capabilities.iter().any(|existing| existing == trimmed) {
            capabilities.push(trimmed.to_owned());
        }
    }

    capabilities.sort_by(|left, right| {
        provider_capability_order(left)
            .cmp(&provider_capability_order(right))
            .then_with(|| left.cmp(right))
    });
    capabilities
}

fn provider_capability_order(capability: &str) -> usize {
    [
        "chat",
        "vision",
        "tools",
        "image-generation",
        "image-editing",
        "audio",
        "realtime",
        "embeddings",
        "moderation",
        "model-list",
    ]
    .iter()
    .position(|item| *item == capability)
    .unwrap_or(usize::MAX)
}

fn provider_settings_capability_summary(locale: &str, provider: &ProviderConfig) -> String {
    provider_settings_capabilities(provider)
        .into_iter()
        .map(|capability| {
            let key = format!("capability.{capability}");
            let label = tr(locale, &key);
            if label.is_empty() || label == key {
                capability
            } else {
                label.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" / ")
}

fn provider_settings_capability_checks(provider: &ProviderConfig) -> Vec<&'static str> {
    let capabilities = provider_settings_capabilities(provider);
    [
        "embeddings",
        "moderation",
        "audio-speech",
        "audio-transcription",
        "realtime",
    ]
    .iter()
    .filter_map(|capability| match *capability {
        "audio-speech" | "audio-transcription"
            if capabilities.iter().any(|item| item == "audio") =>
        {
            Some(*capability)
        }
        "embeddings" | "moderation" | "realtime"
            if capabilities.iter().any(|item| item == *capability) =>
        {
            Some(*capability)
        }
        _ => None,
    })
    .collect()
}

fn provider_settings_missing_capability_model_keys(provider: &ProviderConfig) -> Vec<&'static str> {
    provider_settings_capability_checks(provider)
        .into_iter()
        .filter(|capability| match *capability {
            "audio-speech" => model_for_provider_audio_speech(provider).is_empty(),
            "audio-transcription" => model_for_provider_audio_transcription(provider).is_empty(),
            "embeddings" => {
                model_for_provider_capability(provider, ProviderModelCapability::Embeddings)
                    .is_empty()
            }
            "moderation" => {
                model_for_provider_capability(provider, ProviderModelCapability::Moderation)
                    .is_empty()
            }
            "realtime" => {
                model_for_provider_capability(provider, ProviderModelCapability::Realtime)
                    .is_empty()
            }
            _ => false,
        })
        .collect()
}

fn provider_settings_capability_readiness_summary(
    locale: &str,
    provider: &ProviderConfig,
) -> String {
    let missing_capability_labels = provider_settings_missing_capability_model_keys(provider)
        .into_iter()
        .map(|capability| {
            let key = format!("capability.{capability}");
            let label = tr(locale, &key);
            if label.is_empty() || label == key {
                capability.to_owned()
            } else {
                label.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" / ");

    if missing_capability_labels.is_empty() {
        tr(locale, "settings.capabilityReadinessReady").to_owned()
    } else {
        tr(locale, "settings.capabilityReadinessMissing")
            .replace("{capabilities}", &missing_capability_labels)
    }
}

fn provider_settings_endpoint_summary(provider: &ProviderConfig) -> String {
    provider_settings_endpoint_labels(provider).join(" / ")
}

fn provider_settings_endpoint_labels(provider: &ProviderConfig) -> Vec<&'static str> {
    let capabilities = provider_settings_capabilities(provider);
    let mut endpoints = Vec::new();
    match &provider.kind {
        ProviderKind::Anthropic => {
            add_provider_endpoint(&mut endpoints, "/messages");
            add_provider_endpoint(&mut endpoints, "/models");
        }
        ProviderKind::OpenaiResponses => {
            add_provider_endpoint(&mut endpoints, "/responses");
            add_provider_endpoint(&mut endpoints, "/models");
        }
        ProviderKind::OpenaiCompatible => {
            add_provider_endpoint(&mut endpoints, "/chat/completions");
            add_provider_endpoint(&mut endpoints, "/models");
        }
    }

    if capabilities
        .iter()
        .any(|capability| capability == "image-generation")
        && !model_for_provider_capability(provider, ProviderModelCapability::ImageGeneration)
            .is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/images/generations");
    }
    if capabilities
        .iter()
        .any(|capability| capability == "image-editing")
        && !model_for_provider_capability(provider, ProviderModelCapability::ImageEditing)
            .is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/images/edits");
    }
    if capabilities.iter().any(|capability| capability == "audio")
        && !model_for_provider_audio_speech(provider).is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/audio/speech");
    }
    if capabilities.iter().any(|capability| capability == "audio")
        && !model_for_provider_audio_transcription(provider).is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/audio/transcriptions");
    }
    if capabilities
        .iter()
        .any(|capability| capability == "realtime")
        && !model_for_provider_capability(provider, ProviderModelCapability::Realtime).is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/realtime");
        add_provider_endpoint(&mut endpoints, "/realtime/client_secrets");
    }
    if capabilities
        .iter()
        .any(|capability| capability == "embeddings")
        && !model_for_provider_capability(provider, ProviderModelCapability::Embeddings).is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/embeddings");
    }
    if capabilities
        .iter()
        .any(|capability| capability == "moderation")
        && !model_for_provider_capability(provider, ProviderModelCapability::Moderation).is_empty()
    {
        add_provider_endpoint(&mut endpoints, "/moderations");
    }

    endpoints
}

fn add_provider_endpoint(endpoints: &mut Vec<&'static str>, endpoint: &'static str) {
    if !endpoints.contains(&endpoint) {
        endpoints.push(endpoint);
    }
}

fn run_provider_connectivity_check(
    locale: &str,
    provider_id: &str,
    state: LinuxAppState,
    button: gtk::Button,
    status: gtk::Label,
) {
    let Some(provider) = state.provider(provider_id) else {
        status.set_text(tr(locale, "message.noEnabledProvider"));
        return;
    };

    if provider_key_missing(&state, &provider) {
        status.set_text(tr(locale, "error.providerKeyRequired"));
        return;
    }

    button.set_sensitive(false);
    button.set_label(tr(locale, "button.checking"));
    status.set_text(tr(locale, "settings.providerConnectivityPrivacy"));

    let (sender, receiver) = mpsc::channel();
    let request_provider = provider_request(&provider, &state.sync_config());
    let access_key = provider_proxy_access_key(&request_provider, || state.cloudflare_access_key());
    let api_key = state.provider_key(&provider.id);
    spawn_model_list_request(
        request_provider.clone(),
        api_key.clone(),
        access_key.clone(),
        sender,
    );

    let locale = locale.to_owned();
    let provider_id = provider_id.to_owned();
    poll_background_result(
        receiver,
        move |result| {
            button.set_sensitive(true);
            button.set_label(tr(&locale, "button.checkConnectivity"));
            let Some(current_provider) = state.provider(&provider_id) else {
                status.set_text("");
                return;
            };
            let current_request_provider =
                provider_request(&current_provider, &state.sync_config());
            let current_api_key = state.provider_key(&provider_id);
            let current_access_key = provider_proxy_access_key(&current_request_provider, || {
                state.cloudflare_access_key()
            });
            if !provider_request_is_current(
                &request_provider,
                &current_request_provider,
                &api_key,
                &current_api_key,
                &access_key,
                &current_access_key,
            ) {
                status.set_text("");
                return;
            }
            match result {
                Ok(models) => {
                    let count = models.len().to_string();
                    status.set_text(&replace_placeholders(
                        tr(&locale, "notice.providerConnectivityPassed"),
                        &[("{count}", &count)],
                    ));
                }
                Err(message) => {
                    let message = localize_ai_error(&locale, &message);
                    status.set_text(&replace_placeholders(
                        tr(&locale, "notice.providerConnectivityFailed"),
                        &[("{message}", &message)],
                    ));
                }
            }
        },
        || Err(BACKGROUND_TASK_DISCONNECTED.to_owned()),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(id: &str, models: Vec<&str>, capabilities: Vec<&str>) -> ProviderConfig {
        ProviderConfig {
            id: id.to_owned(),
            name: id.to_owned(),
            kind: ProviderKind::OpenaiCompatible,
            base_url: "https://api.example.com/v1".to_owned(),
            proxy_url: None,
            client_request_mode: false,
            model: models.first().copied().unwrap_or("gpt-5.4-mini").to_owned(),
            image_model: None,
            audio_speech_model: None,
            audio_transcription_model: None,
            embedding_model: None,
            moderation_model: None,
            realtime_model: None,
            models: models.into_iter().map(str::to_owned).collect(),
            capabilities: capabilities.into_iter().map(str::to_owned).collect(),
            enabled: true,
            needs_api_key: true,
            custom: Some(true),
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn provider_capability_readiness_reports_missing_endpoint_models() {
        let missing_models_provider = provider(
            "missing",
            vec!["gpt-5.4-mini"],
            vec![
                "chat",
                "audio",
                "embeddings",
                "moderation",
                "realtime",
                "model-list",
            ],
        );
        let ready_provider = provider(
            "ready",
            vec![
                "gpt-5.4-mini",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-realtime",
            ],
            vec![
                "chat",
                "audio",
                "embeddings",
                "moderation",
                "realtime",
                "model-list",
            ],
        );

        assert_eq!(
            provider_settings_capability_checks(&missing_models_provider),
            vec![
                "embeddings",
                "moderation",
                "audio-speech",
                "audio-transcription",
                "realtime",
            ]
        );
        assert_eq!(
            provider_settings_missing_capability_model_keys(&missing_models_provider),
            vec![
                "embeddings",
                "moderation",
                "audio-speech",
                "audio-transcription",
                "realtime",
            ]
        );
        assert_eq!(
            provider_settings_capability_readiness_summary("en-US", &missing_models_provider),
            "Missing: Embeddings / Moderation / Text to speech / Audio transcription / Realtime voice"
        );
        assert!(provider_settings_missing_capability_model_keys(&ready_provider).is_empty());
        assert_eq!(
            provider_settings_capability_readiness_summary("en-US", &ready_provider),
            "Models covered"
        );
    }

    #[test]
    fn provider_endpoint_labels_include_realtime_client_secrets() {
        let ready_provider = provider(
            "ready",
            vec![
                "gpt-5.4-mini",
                "gpt-image-2",
                "text-embedding-3-large",
                "omni-moderation-latest",
                "tts-1",
                "gpt-4o-transcribe",
                "gpt-realtime",
            ],
            vec![
                "chat",
                "image-generation",
                "image-editing",
                "audio",
                "embeddings",
                "moderation",
                "realtime",
                "model-list",
            ],
        );

        assert_eq!(
            provider_settings_endpoint_labels(&ready_provider),
            vec![
                "/chat/completions",
                "/models",
                "/images/generations",
                "/images/edits",
                "/audio/speech",
                "/audio/transcriptions",
                "/realtime",
                "/realtime/client_secrets",
                "/embeddings",
                "/moderations",
            ]
        );
    }
}
