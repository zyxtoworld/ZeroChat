use crate::{
    i18n::{format_number, replace_placeholders, tr},
    models::{AppSnapshot, UserSkill, UserSkillChunk},
    now_millis,
};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use uuid::Uuid;

pub(crate) fn skill_context_for_prompt(
    snapshot: &AppSnapshot,
    prompt: &str,
    locale: &str,
) -> Option<String> {
    let settings = &snapshot.skill_settings;
    let prompt_terms = terms_from_text(prompt);
    let mut selected: Vec<&UserSkill> = snapshot
        .skills
        .iter()
        .filter(|skill| skill.enabled && skill.fixed)
        .collect();

    if settings.auto_match {
        let mut matched = snapshot
            .skills
            .iter()
            .filter(|skill| skill.enabled && !skill.fixed && skill.auto_match)
            .filter(|skill| skill_matches_prompt(skill, &prompt_terms))
            .collect::<Vec<_>>();
        matched.sort_by(|left, right| {
            skill_match_score(right, &prompt_terms)
                .cmp(&skill_match_score(left, &prompt_terms))
                .then_with(|| left.name.cmp(&right.name))
        });
        selected.extend(
            matched
                .into_iter()
                .take(settings.max_auto_skills.max(0) as usize),
        );
    }

    let budget = settings.context_budget.max(400) as usize;
    let mut used = 0_usize;
    let mut sections = Vec::new();

    for skill in selected {
        let name = display_skill_name(&skill.name, tr(locale, "fallback.skillName"));
        let mut body = String::new();

        for chunk in &skill.chunks {
            let cost = chunk.token_estimate.max(1) as usize;
            if used + cost > budget && !body.is_empty() {
                break;
            }
            if used + cost > budget {
                continue;
            }

            used += cost;
            if !chunk.heading.trim().is_empty() {
                body.push_str("## ");
                body.push_str(chunk.heading.trim());
                body.push('\n');
            }
            body.push_str(chunk.content.trim());
            body.push_str("\n\n");
        }

        let body = normalize_whitespace(&body);
        if !body.is_empty() {
            sections.push(format!("# {name}\n{body}"));
        }
    }

    if sections.is_empty() {
        None
    } else {
        Some(format!(
            "{}\n\n{}",
            tr(locale, "message.skillContextIntro"),
            sections.join("\n\n")
        ))
    }
}

fn skill_matches_prompt(skill: &UserSkill, prompt_terms: &[String]) -> bool {
    !prompt_terms.is_empty()
        && skill
            .keywords
            .iter()
            .any(|keyword| prompt_terms.iter().any(|term| term == keyword))
}

fn skill_match_score(skill: &UserSkill, prompt_terms: &[String]) -> usize {
    skill
        .keywords
        .iter()
        .filter(|keyword| prompt_terms.iter().any(|term| term == *keyword))
        .count()
}

pub(crate) fn create_native_skill(
    name: &str,
    content: &str,
    content_type: &str,
    file_name: Option<String>,
    fallback_name: &str,
    fallback_heading: &str,
) -> Option<UserSkill> {
    let normalized = normalize_whitespace(content);
    if normalized.is_empty() {
        return None;
    }

    let chunks = build_skill_chunks(&normalized, fallback_heading);
    let description = description_from_content(&normalized);
    let mut skill = UserSkill {
        id: Uuid::new_v4().to_string(),
        name: display_skill_name(name, fallback_name),
        description,
        file_name,
        content_type: content_type.to_owned(),
        source_size: normalized.chars().count() as i32,
        content_hash: sha256_hex(&normalized),
        keywords: vec![],
        chunks,
        fixed: false,
        enabled: true,
        auto_match: true,
        created_at: now_millis(),
        updated_at: now_millis(),
    };
    refresh_skill_keywords(&mut skill);
    Some(skill)
}

pub(crate) fn rebuild_skill_content(skill: &mut UserSkill, content: &str, fallback_heading: &str) {
    let normalized = normalize_whitespace(content);
    skill.description = description_from_content(&normalized);
    skill.source_size = normalized.chars().count() as i32;
    skill.content_hash = sha256_hex(&normalized);
    skill.chunks = build_skill_chunks(&normalized, fallback_heading);
    refresh_skill_keywords(skill);
}

pub(crate) fn refresh_skill_keywords(skill: &mut UserSkill) {
    let mut text = format!("{}\n{}\n", skill.name, skill.description);
    for chunk in &skill.chunks {
        text.push_str(&chunk.heading);
        text.push('\n');
        text.push_str(&chunk.keywords.join(" "));
        text.push('\n');
    }
    skill.keywords = extract_keywords(&text, 48);
}

pub(crate) fn normalize_whitespace(value: &str) -> String {
    value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

fn build_skill_chunks(content: &str, fallback_heading: &str) -> Vec<UserSkillChunk> {
    let normalized = normalize_whitespace(content);
    let mut chunks = Vec::new();

    for section in split_skill_sections(&normalized, fallback_heading) {
        for part in split_long_text(&section.content) {
            chunks.push(UserSkillChunk {
                id: format!("chunk-{}", chunks.len() + 1),
                heading: section.heading.clone(),
                keywords: extract_keywords(&format!("{}\n{}", section.heading, part), 28),
                token_estimate: estimate_tokens(&part),
                content: part,
            });
        }
    }

    if chunks.is_empty() && !normalized.is_empty() {
        chunks.push(UserSkillChunk {
            id: "chunk-1".to_owned(),
            heading: fallback_heading.to_owned(),
            keywords: extract_keywords(&normalized, 28),
            token_estimate: estimate_tokens(&normalized),
            content: normalized,
        });
    }

    chunks
}

struct SkillSection {
    heading: String,
    content: String,
}

fn split_skill_sections(content: &str, fallback_heading: &str) -> Vec<SkillSection> {
    let mut sections: Vec<(String, Vec<String>)> = Vec::new();
    let mut current_heading = fallback_heading.to_owned();
    let mut current_lines: Vec<String> = Vec::new();

    for line in content.lines() {
        if let Some(heading) = markdown_heading(line) {
            let previous = current_lines.join("\n");
            if !normalize_whitespace(&previous).is_empty() {
                sections.push((current_heading, current_lines));
            }
            current_heading = heading;
            current_lines = Vec::new();
        } else {
            current_lines.push(line.to_owned());
        }
    }

    let previous = current_lines.join("\n");
    if !normalize_whitespace(&previous).is_empty() {
        sections.push((current_heading, current_lines));
    }

    sections
        .into_iter()
        .map(|(heading, lines)| SkillSection {
            heading,
            content: normalize_whitespace(&lines.join("\n")),
        })
        .collect()
}

fn markdown_heading(line: &str) -> Option<String> {
    let trimmed = line.trim();
    let hashes = trimmed
        .chars()
        .take_while(|character| *character == '#')
        .count();
    if !(1..=6).contains(&hashes) {
        return None;
    }

    if trimmed.chars().nth(hashes) != Some(' ') {
        return None;
    }

    let heading = trimmed[hashes..].trim().trim_end_matches('#').trim();
    if heading.is_empty() {
        None
    } else {
        Some(heading.to_owned())
    }
}

fn split_long_text(value: &str) -> Vec<String> {
    const MAX_CHUNK_CHARS: usize = 2600;
    const MIN_CHUNK_CHARS: usize = 720;

    let chars = value.chars().collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < chars.len() {
        let mut end = (start + MAX_CHUNK_CHARS).min(chars.len());
        if end < chars.len() {
            let soft_break = (start + MIN_CHUNK_CHARS..end)
                .rev()
                .find(|index| matches!(chars[*index], '\n' | '。' | '.' | '!' | '?'));
            if let Some(index) = soft_break {
                end = index + 1;
            }
        }

        let chunk = normalize_whitespace(&chars[start..end].iter().collect::<String>());
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        start = end;
    }

    chunks
}

fn estimate_tokens(value: &str) -> i32 {
    ((value.chars().count() as f64 / 3.8).ceil() as i32).max(1)
}

fn extract_keywords(value: &str, limit: usize) -> Vec<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for term in terms_from_text(value) {
        *counts.entry(term).or_insert(0) += 1;
    }

    let mut entries = counts.into_iter().collect::<Vec<_>>();
    entries.sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
    entries
        .into_iter()
        .take(limit)
        .map(|(term, _)| term)
        .collect()
}

fn terms_from_text(value: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();

    for character in value.chars() {
        if character.is_alphanumeric() {
            current.extend(character.to_lowercase());
        } else {
            push_keyword_term(&mut terms, &current);
            current.clear();
        }
    }
    push_keyword_term(&mut terms, &current);

    terms
}

fn push_keyword_term(terms: &mut Vec<String>, term: &str) {
    if term.is_empty() {
        return;
    }

    let chars = term.chars().collect::<Vec<_>>();
    if chars.iter().any(|character| is_cjk(*character)) {
        if chars.len() <= 8 {
            terms.push(term.to_owned());
        }

        for pair in chars.windows(2) {
            terms.push(pair.iter().collect());
        }
    } else if chars.len() >= 2 && !is_stop_word(term) {
        terms.push(term.to_owned());
    }
}

fn is_cjk(character: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&character)
        || ('\u{3040}'..='\u{30FF}').contains(&character)
        || ('\u{AC00}'..='\u{D7AF}').contains(&character)
}

fn is_stop_word(term: &str) -> bool {
    matches!(
        term,
        "a" | "an"
            | "and"
            | "are"
            | "as"
            | "at"
            | "be"
            | "but"
            | "by"
            | "for"
            | "from"
            | "has"
            | "have"
            | "if"
            | "in"
            | "into"
            | "is"
            | "it"
            | "its"
            | "of"
            | "on"
            | "or"
            | "that"
            | "the"
            | "this"
            | "to"
            | "use"
            | "with"
            | "you"
            | "your"
    )
}

fn sha256_hex(value: &str) -> String {
    Sha256::digest(value.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn description_from_content(content: &str) -> String {
    let line = content
        .lines()
        .map(|line| {
            let heading = markdown_heading(line).unwrap_or_else(|| line.trim().to_owned());
            heading.trim_matches('`').trim().to_owned()
        })
        .find(|line| !line.is_empty())
        .unwrap_or_default();

    truncate_chars(&line, 140)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let preview = chars.by_ref().take(limit).collect::<String>();
    if chars.next().is_some() {
        format!("{}...", preview.trim_end())
    } else {
        preview
    }
}

pub(crate) fn display_skill_name(name: &str, fallback_name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        fallback_name.to_owned()
    } else {
        trimmed.to_owned()
    }
}

pub(crate) fn skill_name_from_file_name(file_name: &str, fallback_name: &str) -> String {
    let stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name)
        .replace(['-', '_'], " ")
        .trim()
        .to_owned();
    display_skill_name(&stem, fallback_name)
}

pub(crate) fn content_type_from_file_name(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".json") {
        "json".to_owned()
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") {
        "markdown".to_owned()
    } else {
        "text".to_owned()
    }
}

pub(crate) fn skill_content(skill: &UserSkill) -> String {
    skill
        .chunks
        .iter()
        .map(|chunk| chunk.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub(crate) fn skill_meta_text(locale: &str, skill: &UserSkill) -> String {
    let tokens = skill
        .chunks
        .iter()
        .map(|chunk| chunk.token_estimate)
        .sum::<i32>();
    let chunks_text = format_number(locale, skill.chunks.len() as i64);
    let tokens_text = format_number(locale, tokens as i64);
    replace_placeholders(
        tr(locale, "settings.skillMeta"),
        &[("{chunks}", &chunks_text), ("{tokens}", &tokens_text)],
    )
}
