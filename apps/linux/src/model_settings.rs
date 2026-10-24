use crate::{
    LinuxAppState,
    ai_protocol::{provider_proxy_access_key, provider_request},
    background::{BACKGROUND_TASK_DISCONNECTED, poll_background_result, spawn_model_list_request},
    i18n::{localize_ai_error, replace_placeholders, tr},
    models::ProviderConfig,
    providers::{
        apply_configured_provider_models, apply_fetched_provider_models,
        ensure_provider_model_present, model_capability_keys, parse_model_list,
        provider_display_name, provider_key_missing, provider_request_is_current,
    },
    ui_helpers::{editable_entry, optional_text, settings_box, settings_card, settings_text},
};
use gtk::prelude::*;
use std::sync::mpsc;

pub(crate) fn model_settings(locale: &str, compact: bool, state: LinuxAppState) -> gtk::Box {
    let box_ = settings_box(compact);
    box_.append(&settings_text(tr(locale, "settings.modelListNote")));

    for provider in state.providers() {
        let provider_id = provider.id.clone();
        let card = settings_card(&provider_display_name(locale, &provider));
        let provider_capability_summary = provider_model_capability_summary(locale, &provider);
        if !provider_capability_summary.is_empty() {
            let summary = settings_text(&provider_capability_summary);
            summary.add_css_class("dim-label");
            card.append(&summary);
        }
        let capability_list = gtk::Box::new(gtk::Orientation::Vertical, 3);
        capability_list.add_css_class("model-capability-list");
        let models_entry = editable_entry(
            tr(locale, "placeholder.modelList"),
            Some(&provider.models.join(" ")),
            {
                let state = state.clone();
                let provider_id = provider_id.clone();
                let locale_for_models = locale.to_owned();
                let capability_list_for_models = capability_list.clone();
                move |value| {
                    let models = parse_model_list(&value);
                    refresh_model_capability_list(
                        &locale_for_models,
                        &capability_list_for_models,
                        &models,
                    );
                    state.update_provider_config(&provider_id, |provider| {
                        apply_configured_provider_models(provider, models);
                    });
                }
            },
        );
        card.append(&models_entry);
        refresh_model_capability_list(locale, &capability_list, &provider.models);
        card.append(&capability_list);
        let default_model_entry =
            editable_entry(tr(locale, "field.defaultModel"), Some(&provider.model), {
                let state = state.clone();
                let provider_id = provider_id.clone();
                move |value| {
                    state.update_provider_config(&provider_id, |provider| {
                        provider.model = value.trim().to_owned();
                        ensure_provider_model_present(provider);
                    });
                }
            });
        card.append(&default_model_entry);
        let manual_model_entry = gtk::Entry::builder()
            .placeholder_text(tr(locale, "placeholder.modelList"))
            .build();
        let add_model_button = gtk::Button::with_label(tr(locale, "action.addModel"));
        add_model_button.set_sensitive(false);
        let add_model_row = gtk::Box::new(gtk::Orientation::Horizontal, 6);
        add_model_row.append(&manual_model_entry);
        add_model_row.append(&add_model_button);
        card.append(&add_model_row);
        {
            let add_model_button = add_model_button.clone();
            manual_model_entry.connect_changed(move |entry| {
                add_model_button.set_sensitive(!parse_model_list(&entry.text()).is_empty());
            });
        }
        {
            let state = state.clone();
            let provider_id = provider_id.clone();
            let models_entry = models_entry.clone();
            let default_model_entry = default_model_entry.clone();
            let manual_model_entry_for_add = manual_model_entry.clone();
            let add_manual_models = move || {
                let values = parse_model_list(&manual_model_entry_for_add.text());
                if values.is_empty() {
                    return;
                }

                let mut merged = parse_model_list(&models_entry.text());
                for model in values {
                    if !merged.iter().any(|existing| existing == &model) {
                        merged.push(model);
                    }
                }
                let first_model = merged.first().cloned().unwrap_or_default();
                models_entry.set_text(&merged.join(" "));
                if default_model_entry.text().trim().is_empty() && !first_model.is_empty() {
                    default_model_entry.set_text(&first_model);
                }

                let merged_for_state = merged;
                state.update_provider_config(&provider_id, |provider| {
                    apply_configured_provider_models(provider, merged_for_state);
                });
                manual_model_entry_for_add.set_text("");
            };
            let add_manual_models = std::rc::Rc::new(add_manual_models);
            {
                let add_manual_models = add_manual_models.clone();
                add_model_button.connect_clicked(move |_| add_manual_models());
            }
            {
                let add_manual_models = add_manual_models.clone();
                manual_model_entry.connect_activate(move |_| add_manual_models());
            }
        }
        card.append(&editable_entry(
            tr(locale, "field.imageModel"),
            provider.image_model.as_deref(),
            {
                let state = state.clone();
                let provider_id = provider_id.clone();
                move |value| {
                    state.update_provider_config(&provider_id, |provider| {
                        provider.image_model = optional_text(value);
                        ensure_provider_model_present(provider);
                    });
                }
            },
        ));
        let status = settings_text("");
        status.add_css_class("dim-label");
        let fetch_models = gtk::Button::with_label(tr(locale, "button.fetchModels"));
        let button_for_fetch = fetch_models.clone();
        let status_for_fetch = status.clone();
        let models_entry_for_fetch = models_entry.clone();
        let default_entry_for_fetch = default_model_entry.clone();
        let state_for_fetch = state.clone();
        let provider_id_for_fetch = provider_id;
        let locale_for_fetch = locale.to_owned();
        fetch_models.connect_clicked(move |_| {
            run_model_fetch(
                &locale_for_fetch,
                &provider_id_for_fetch,
                state_for_fetch.clone(),
                button_for_fetch.clone(),
                status_for_fetch.clone(),
                models_entry_for_fetch.clone(),
                default_entry_for_fetch.clone(),
            );
        });
        card.append(&fetch_models);
        card.append(&status);
        box_.append(&card);
    }
    box_
}

fn provider_model_capability_summary(locale: &str, provider: &ProviderConfig) -> String {
    let mut models = provider.models.clone();
    add_unique_model(&mut models, &provider.model);
    if let Some(image_model) = provider.image_model.as_deref() {
        add_unique_model(&mut models, image_model);
    }

    let mut keys: Vec<&'static str> = Vec::new();
    for model in models {
        for key in model_capability_keys(&model) {
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
    }

    [
        "capability.chat",
        "capability.image-generation",
        "capability.image-editing",
        "capability.audio",
        "capability.audio-speech",
        "capability.audio-transcription",
        "capability.embeddings",
        "capability.moderation",
        "capability.realtime",
    ]
    .into_iter()
    .filter(|key| keys.contains(key))
    .map(|key| tr(locale, key))
    .collect::<Vec<_>>()
    .join(" / ")
}

fn add_unique_model(models: &mut Vec<String>, model: &str) {
    let trimmed = model.trim();
    if !trimmed.is_empty() && !models.iter().any(|existing| existing == trimmed) {
        models.push(trimmed.to_owned());
    }
}

fn model_capability_summary(locale: &str, model: &str) -> String {
    model_capability_keys(model)
        .into_iter()
        .map(|key| tr(locale, key))
        .collect::<Vec<_>>()
        .join(" / ")
}

fn refresh_model_capability_list(locale: &str, list: &gtk::Box, models: &[String]) {
    while let Some(child) = list.first_child() {
        list.remove(&child);
    }

    for model in models {
        let summary = model_capability_summary(locale, model);
        if summary.is_empty() {
            continue;
        }

        let row = settings_text(&format!("{model} · {summary}"));
        row.add_css_class("dim-label");
        list.append(&row);
    }
}

fn run_model_fetch(
    locale: &str,
    provider_id: &str,
    state: LinuxAppState,
    button: gtk::Button,
    status: gtk::Label,
    models_entry: gtk::Entry,
    default_model_entry: gtk::Entry,
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
    button.set_label(tr(locale, "button.fetching"));
    status.set_text(tr(locale, "settings.providerConnectivityPrivacy"));

    let (sender, receiver) = mpsc::channel();
    let request_provider = provider_request(&provider, &state.sync_config());
    let api_key = state.provider_key(&provider.id);
    let access_key = provider_proxy_access_key(&request_provider, || state.cloudflare_access_key());
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
            button.set_label(tr(&locale, "button.fetchModels"));
            match result {
                Ok(catalog) => {
                    let models = catalog.models;
                    let Some(current_provider) = state.provider(&provider_id) else {
                        status.set_text("");
                        return;
                    };
                    let current_request_provider =
                        provider_request(&current_provider, &state.sync_config());
                    let current_api_key = state.provider_key(&provider_id);
                    let current_access_key =
                        provider_proxy_access_key(&current_request_provider, || {
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

                    let mut preview_provider = provider.clone();
                    apply_fetched_provider_models(
                        &mut preview_provider,
                        models.clone(),
                        catalog.model_metadata.clone(),
                    );
                    let mut applied_provider = None;
                    state.update_provider_config(&provider_id, |provider| {
                        apply_fetched_provider_models(
                            provider,
                            models.clone(),
                            catalog.model_metadata.clone(),
                        );
                        applied_provider = Some(provider.clone());
                    });
                    let Some(applied_provider) = applied_provider else {
                        status.set_text("");
                        return;
                    };
                    if applied_provider.models != preview_provider.models
                        || applied_provider.model != preview_provider.model
                        || applied_provider.image_model != preview_provider.image_model
                    {
                        status.set_text("");
                        return;
                    }
                    models_entry.set_text(&preview_provider.models.join(" "));
                    default_model_entry.set_text(&preview_provider.model);

                    let count = models.len().to_string();
                    status.set_text(&replace_placeholders(
                        tr(&locale, "notice.modelsFetched"),
                        &[("{count}", &count)],
                    ));
                }
                Err(message) => {
                    let message = localize_ai_error(&locale, &message);
                    status.set_text(&replace_placeholders(
                        tr(&locale, "notice.modelsFetchFailed"),
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
    use crate::defaults::default_snapshot;
    use crate::providers::provider_request_is_current;

    #[test]
    fn model_fetch_result_is_owned_by_the_exact_provider_request_and_credentials() {
        let provider = default_snapshot().providers[0].clone();

        assert!(provider_request_is_current(
            &provider,
            &provider,
            "provider-key",
            "provider-key",
            "access-key",
            "access-key",
        ));

        let mut changed_provider = provider.clone();
        changed_provider.base_url.push_str("/changed");
        assert!(!provider_request_is_current(
            &provider,
            &changed_provider,
            "provider-key",
            "provider-key",
            "access-key",
            "access-key",
        ));
        assert!(!provider_request_is_current(
            &provider,
            &provider,
            "provider-key",
            "new-provider-key",
            "access-key",
            "access-key",
        ));
        assert!(!provider_request_is_current(
            &provider,
            &provider,
            "provider-key",
            "provider-key",
            "access-key",
            "new-access-key",
        ));
    }
}
