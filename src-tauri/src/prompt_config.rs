use std::collections::HashMap;
use std::sync::OnceLock;

use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};

static PROMPTS_DIR: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../src/config/transcription-prompts");
static PROMPT_REGISTRY: OnceLock<Result<PromptRegistry, String>> = OnceLock::new();

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreview {
    pub prompt: String,
    pub layers: Vec<String>,
    pub profile_key: String,
    pub version: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptManifest {
    version: u32,
    default_language: String,
    default_style: String,
    base_file: String,
    languages: HashMap<String, ManifestFileRef>,
    styles: HashMap<String, ManifestStyleRef>,
    overrides: HashMap<String, String>,
}

#[derive(Deserialize)]
struct ManifestFileRef {
    file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestStyleRef {
    file: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BasePromptConfig {
    assistant_name: String,
    task: String,
    core_rules: Vec<String>,
    what_to_fix: Vec<String>,
    what_not_to_do: Vec<String>,
    output_rules: Vec<String>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LanguagePromptConfig {
    display_name: String,
    filler_examples: Vec<String>,
    rules: Vec<String>,
    examples: Vec<PromptExample>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StylePromptConfig {
    prompt_title: String,
    rules: Vec<String>,
    examples: Vec<PromptExample>,
}

#[derive(Deserialize, Clone)]
struct PromptOverride {
    rules: Vec<String>,
    examples: Vec<PromptExample>,
}

#[derive(Deserialize, Clone)]
struct PromptExample {
    raw: String,
    cleaned: String,
}

struct PromptRegistry {
    manifest: PromptManifest,
    base: BasePromptConfig,
    language_profiles: HashMap<String, LanguageProfile>,
    style_profiles: HashMap<String, StyleProfile>,
    override_profiles: HashMap<String, OverrideProfile>,
}

struct LanguageProfile {
    file: String,
    config: LanguagePromptConfig,
}

struct StyleProfile {
    file: String,
    config: StylePromptConfig,
}

struct OverrideProfile {
    file: String,
    config: PromptOverride,
}

pub fn build_cleanup_prompt_preview(language: &str, style: &str) -> Result<PromptPreview, String> {
    let registry = get_prompt_registry()?;
    let resolved_language = resolve_key(
        language,
        registry.manifest.languages.contains_key(language),
        &registry.manifest.default_language,
    );
    let resolved_style = resolve_key(
        style,
        registry.manifest.styles.contains_key(style),
        &registry.manifest.default_style,
    );

    let language_profile = registry
        .language_profiles
        .get(&resolved_language)
        .ok_or_else(|| format!("Missing language prompt profile: {}", resolved_language))?;
    let style_profile = registry
        .style_profiles
        .get(&resolved_style)
        .ok_or_else(|| format!("Missing style prompt profile: {}", resolved_style))?;

    let override_key = format!("{}:{}", resolved_language, resolved_style);
    let override_profile = registry.override_profiles.get(&override_key);
    let filler_examples = language_profile.config.filler_examples.join(", ");
    let profile_key = override_profile
        .map(|_| override_key.clone())
        .unwrap_or_else(|| format!("{}:{}", resolved_language, resolved_style));

    let mut layers = vec![
        registry.manifest.base_file.clone(),
        language_profile.file.clone(),
        style_profile.file.clone(),
    ];
    if let Some(profile) = override_profile {
        layers.push(profile.file.clone());
    }

    let mut prompt = String::new();
    prompt.push_str(&format!(
        "You are {} — a professional speech-to-text post-processing assistant.\n\n",
        registry.base.assistant_name
    ));
    prompt.push_str(&format!(
        "INPUT: Raw voice transcription dictated in {}.\n",
        language_profile.config.display_name
    ));
    prompt.push_str(&format!("TASK: {}\n\n", registry.base.task));

    prompt.push_str("═══ CORE RULES ═══\n\n");
    append_numbered_rules(&mut prompt, &registry.base.core_rules, &filler_examples);

    if !language_profile.config.rules.is_empty() {
        prompt.push_str("\n═══ LANGUAGE RULES ═══\n\n");
        append_bulleted_rules(
            &mut prompt,
            &language_profile.config.rules,
            &filler_examples,
        );
    }

    if !style_profile.config.rules.is_empty() || override_profile.is_some() {
        prompt.push_str(&format!(
            "\n═══ {} ═══\n\n",
            style_profile.config.prompt_title
        ));
        append_bulleted_rules(&mut prompt, &style_profile.config.rules, &filler_examples);
        if let Some(profile) = override_profile {
            append_bulleted_rules(&mut prompt, &profile.config.rules, &filler_examples);
        }
    }

    prompt.push_str("\n═══ WHAT TO FIX ═══\n\n");
    append_bulleted_rules(&mut prompt, &registry.base.what_to_fix, &filler_examples);

    prompt.push_str("\n═══ WHAT NOT TO DO ═══\n\n");
    append_bulleted_rules(&mut prompt, &registry.base.what_not_to_do, &filler_examples);

    let mut examples: Vec<PromptExample> = Vec::new();
    examples.extend(language_profile.config.examples.clone());
    examples.extend(style_profile.config.examples.clone());
    if let Some(profile) = override_profile {
        examples.extend(profile.config.examples.clone());
    }

    if !examples.is_empty() {
        prompt.push_str("\n═══ EXAMPLES ═══\n\n");
        for example in examples {
            prompt.push_str(&format!(
                "Input: {}\nOutput: {}\n\n",
                render_rule(&example.raw, &filler_examples),
                render_rule(&example.cleaned, &filler_examples)
            ));
        }
    }

    prompt.push_str("═══ OUTPUT FORMAT ═══\n\n");
    append_bulleted_rules(&mut prompt, &registry.base.output_rules, &filler_examples);

    Ok(PromptPreview {
        prompt,
        layers,
        profile_key,
        version: registry.manifest.version,
    })
}

fn get_prompt_registry() -> Result<&'static PromptRegistry, String> {
    let result = PROMPT_REGISTRY.get_or_init(load_prompt_registry);
    result.as_ref().map_err(Clone::clone)
}

fn load_prompt_registry() -> Result<PromptRegistry, String> {
    let manifest: PromptManifest = read_json_file("manifest.json")?;
    let base: BasePromptConfig = read_json_file(&manifest.base_file)?;

    let mut language_profiles = HashMap::new();
    for (key, value) in &manifest.languages {
        let config = read_json_file(&value.file)?;
        language_profiles.insert(
            key.clone(),
            LanguageProfile {
                file: value.file.clone(),
                config,
            },
        );
    }

    let mut style_profiles = HashMap::new();
    for (key, value) in &manifest.styles {
        let config = read_json_file(&value.file)?;
        style_profiles.insert(
            key.clone(),
            StyleProfile {
                file: value.file.clone(),
                config,
            },
        );
    }

    let mut override_profiles = HashMap::new();
    for (key, file) in &manifest.overrides {
        let config = read_json_file(file)?;
        override_profiles.insert(
            key.clone(),
            OverrideProfile {
                file: file.clone(),
                config,
            },
        );
    }

    Ok(PromptRegistry {
        manifest,
        base,
        language_profiles,
        style_profiles,
        override_profiles,
    })
}

fn append_numbered_rules(buffer: &mut String, rules: &[String], filler_examples: &str) {
    for (index, rule) in rules.iter().enumerate() {
        buffer.push_str(&format!(
            "{}. {}\n",
            index + 1,
            render_rule(rule, filler_examples)
        ));
    }
}

fn append_bulleted_rules(buffer: &mut String, rules: &[String], filler_examples: &str) {
    for rule in rules {
        buffer.push_str(&format!("- {}\n", render_rule(rule, filler_examples)));
    }
}

fn render_rule(rule: &str, filler_examples: &str) -> String {
    rule.replace("{filler_examples}", filler_examples)
}

fn resolve_key(requested: &str, exists: bool, fallback: &str) -> String {
    if exists {
        requested.to_string()
    } else {
        fallback.to_string()
    }
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &str) -> Result<T, String> {
    let file = PROMPTS_DIR
        .get_file(path)
        .ok_or_else(|| format!("Prompt config file not found: {}", path))?;
    let content = file
        .contents_utf8()
        .ok_or_else(|| format!("Prompt config file is not valid UTF-8: {}", path))?;

    serde_json::from_str(content)
        .map_err(|error| format!("Failed to parse prompt config {}: {}", path, error))
}
