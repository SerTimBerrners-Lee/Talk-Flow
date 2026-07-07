use crate::logger;
use ct2rs::{ComputeType, Config, Device, TranslationOptions, Translator};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const NLLB_TRANSLATOR_PROVIDER: &str = "nllb-200";
const OPUS_RU_EN_TRANSLATOR_PROVIDER: &str = "opus-mt-ru-en";
const LEGACY_TRAD_PROVIDER: &str = "trad";
const FAST_TRANSLATION_BEAM_SIZE: usize = 1;

const NLLB_MODEL_FILES: &[&str] = &[
    "config.json",
    "model.bin",
    "sentencepiece.bpe.model",
    "shared_vocabulary.txt",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
];

const OPUS_RU_EN_MODEL_FILES: &[&str] = &[
    "config.json",
    "generation_config.json",
    "model.bin",
    "shared_vocabulary.json",
    "source.spm",
    "target.spm",
    "tokenizer_config.json",
    "vocab.json",
];

const NLLB_LEGACY_PROVIDERS: [&str; 1] = [LEGACY_TRAD_PROVIDER];
const NO_LEGACY_PROVIDERS: [&str; 0] = [];

type CtTranslator = Translator<ct2rs::tokenizers::auto::Tokenizer>;

#[derive(Clone, Copy)]
enum LocalTranslatorKind {
    Nllb,
    MarianPair {
        source_language: &'static str,
        target_language: &'static str,
    },
}

struct LocalTranslatorDefinition {
    provider: &'static str,
    legacy_providers: &'static [&'static str],
    name: &'static str,
    model_repo: &'static str,
    model_label: &'static str,
    model_files: &'static [&'static str],
    status_message: &'static str,
    installed_message: &'static str,
    deleted_message: &'static str,
    delete_error_prefix: &'static str,
    not_installed_error: &'static str,
    empty_result_error: &'static str,
    unsupported_source_error: Option<&'static str>,
    unsupported_target_error: Option<&'static str>,
    kind: LocalTranslatorKind,
}

impl LocalTranslatorDefinition {
    fn matches(&self, provider: &str) -> bool {
        self.provider == provider || self.legacy_providers.iter().any(|item| *item == provider)
    }
}

const NLLB_TRANSLATOR: LocalTranslatorDefinition = LocalTranslatorDefinition {
    provider: NLLB_TRANSLATOR_PROVIDER,
    legacy_providers: &NLLB_LEGACY_PROVIDERS,
    name: "NLLB-200 Distilled",
    model_repo: "JustFrederik/nllb-200-distilled-600M-ct2-int8",
    model_label: "NLLB-200 distilled 600M INT8",
    model_files: NLLB_MODEL_FILES,
    status_message: "200+ языков",
    installed_message: "Локальный переводчик NLLB-200 установлен.",
    deleted_message: "Локальный переводчик NLLB-200 удалён.",
    delete_error_prefix: "Не удалось удалить NLLB-200",
    not_installed_error: "Локальная модель NLLB-200 не установлена.",
    empty_result_error: "Локальный переводчик NLLB-200 вернул пустой результат.",
    unsupported_source_error: None,
    unsupported_target_error: None,
    kind: LocalTranslatorKind::Nllb,
};

const OPUS_RU_EN_TRANSLATOR: LocalTranslatorDefinition = LocalTranslatorDefinition {
    provider: OPUS_RU_EN_TRANSLATOR_PROVIDER,
    legacy_providers: &NO_LEGACY_PROVIDERS,
    name: "OPUS-MT RU -> EN",
    model_repo: "gaudi/opus-mt-ru-en-ctranslate2",
    model_label: "OPUS-MT ru-en CTranslate2",
    model_files: OPUS_RU_EN_MODEL_FILES,
    status_message: "русский -> английский",
    installed_message: "Локальный переводчик OPUS-MT RU -> EN установлен.",
    deleted_message: "Локальный переводчик OPUS-MT RU -> EN удалён.",
    delete_error_prefix: "Не удалось удалить OPUS-MT RU -> EN",
    not_installed_error: "Локальная модель OPUS-MT RU -> EN не установлена.",
    empty_result_error: "Локальный переводчик OPUS-MT RU -> EN вернул пустой результат.",
    unsupported_source_error: Some("OPUS-MT RU -> EN поддерживает только русский исходный текст."),
    unsupported_target_error: Some("OPUS-MT RU -> EN поддерживает только перевод на английский."),
    kind: LocalTranslatorKind::MarianPair {
        source_language: "rus_Cyrl",
        target_language: "eng_Latn",
    },
};

#[derive(Serialize)]
pub struct LocalTranslatorInfo {
    provider: String,
    name: String,
    status: String,
    managed: bool,
    message: Option<String>,
}

#[derive(Serialize)]
pub struct LocalTranslatorResult {
    success: bool,
    message: String,
}

#[derive(Deserialize)]
pub struct LocalTranslatorProviderRequest {
    provider: String,
}

#[derive(Deserialize)]
pub struct LocalTranslationRequest {
    provider: String,
    text: String,
    source_language: String,
    target_language: String,
}

struct ResolvedTranslationLanguages {
    source_language: String,
    target_language: String,
}

fn translator_cache() -> &'static Mutex<HashMap<String, Arc<CtTranslator>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Arc<CtTranslator>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn local_translator_definitions() -> [&'static LocalTranslatorDefinition; 2] {
    [&NLLB_TRANSLATOR, &OPUS_RU_EN_TRANSLATOR]
}

fn ensure_provider(provider: &str) -> Result<&'static LocalTranslatorDefinition, String> {
    local_translator_definitions()
        .into_iter()
        .find(|definition| definition.matches(provider))
        .ok_or_else(|| format!("Неизвестный локальный переводчик «{}».", provider))
}

fn translator_dir(
    app: &AppHandle,
    definition: &'static LocalTranslatorDefinition,
) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|err| format!("Не удалось найти папку данных Talkis: {}", err))
        .map(|dir| dir.join("local-translators").join(definition.provider))
}

fn model_dir(
    app: &AppHandle,
    definition: &'static LocalTranslatorDefinition,
) -> Result<PathBuf, String> {
    Ok(translator_dir(app, definition)?
        .join("models")
        .join(definition.model_repo.replace('/', "__")))
}

fn is_model_installed(app: &AppHandle, definition: &'static LocalTranslatorDefinition) -> bool {
    let Ok(dir) = model_dir(app, definition) else {
        return false;
    };

    definition
        .model_files
        .iter()
        .all(|file| dir.join(file).is_file())
}

fn local_translator_status(
    app: &AppHandle,
    definition: &'static LocalTranslatorDefinition,
) -> LocalTranslatorInfo {
    if !is_model_installed(app, definition) {
        return LocalTranslatorInfo {
            provider: definition.provider.to_string(),
            name: definition.name.to_string(),
            status: "not_installed".to_string(),
            managed: true,
            message: None,
        };
    }

    LocalTranslatorInfo {
        provider: definition.provider.to_string(),
        name: definition.name.to_string(),
        status: "ready".to_string(),
        managed: true,
        message: Some(format!(
            "CTranslate2/{}: {}",
            definition.model_label, definition.status_message
        )),
    }
}

#[tauri::command]
pub fn list_local_translators(app: AppHandle) -> Vec<LocalTranslatorInfo> {
    local_translator_definitions()
        .into_iter()
        .map(|definition| local_translator_status(&app, definition))
        .collect()
}

#[tauri::command]
pub async fn download_local_translator(
    app: AppHandle,
    req: LocalTranslatorProviderRequest,
) -> Result<LocalTranslatorResult, String> {
    let definition = ensure_provider(&req.provider)?;

    download_model_if_needed(&app, definition).await?;

    Ok(LocalTranslatorResult {
        success: true,
        message: definition.installed_message.to_string(),
    })
}

#[tauri::command]
pub fn delete_local_translator(
    app: AppHandle,
    req: LocalTranslatorProviderRequest,
) -> Result<LocalTranslatorResult, String> {
    let definition = ensure_provider(&req.provider)?;

    if let Ok(dir) = translator_dir(&app, definition) {
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .map_err(|err| format!("{}: {}", definition.delete_error_prefix, err))?;
        }
    }
    if definition.provider == NLLB_TRANSLATOR_PROVIDER {
        if let Ok(legacy_dir) = app
            .path()
            .app_data_dir()
            .map(|dir| dir.join("local-translators").join(LEGACY_TRAD_PROVIDER))
        {
            if legacy_dir.exists() {
                fs::remove_dir_all(&legacy_dir)
                    .map_err(|err| format!("Не удалось удалить legacy trad: {}", err))?;
            }
        }
    }

    translator_cache()
        .lock()
        .map_err(|_| format!("Не удалось очистить кэш {}.", definition.name))?
        .remove(definition.provider);

    Ok(LocalTranslatorResult {
        success: true,
        message: definition.deleted_message.to_string(),
    })
}

#[tauri::command]
pub async fn translate_with_local_translator(
    app: AppHandle,
    req: LocalTranslationRequest,
) -> Result<String, String> {
    let definition = ensure_provider(&req.provider)?;

    let source_text = req.text.trim();
    if source_text.is_empty() {
        return Err("Нет текста для перевода.".to_string());
    }

    let languages = resolve_translation_languages(definition, &req, source_text)?;

    if !is_model_installed(&app, definition) {
        return Err(definition.not_installed_error.to_string());
    }

    logger::log_info(
        "LOCAL_TRANSLATOR",
        &format!(
            "Running CTranslate2 {}: {} -> {}, chars={}, beam_size={}",
            definition.provider,
            languages.source_language,
            languages.target_language,
            source_text.chars().count(),
            FAST_TRANSLATION_BEAM_SIZE
        ),
    );

    let translator = load_translator(&app, definition)?;
    let text = source_text.to_string();
    let translated = tokio::task::spawn_blocking(move || {
        translate_text(translator, text, definition, languages)
    })
    .await
    .map_err(|err| format!("{} завершился с ошибкой: {}", definition.name, err))??;
    let trimmed = translated.trim().to_string();
    if trimmed.is_empty() {
        return Err(definition.empty_result_error.to_string());
    }

    Ok(trimmed)
}

fn resolve_translation_languages(
    definition: &'static LocalTranslatorDefinition,
    req: &LocalTranslationRequest,
    source_text: &str,
) -> Result<ResolvedTranslationLanguages, String> {
    let target_language = language_to_nllb(&req.target_language)
        .ok_or_else(|| "Укажите целевой язык перевода.".to_string())?;
    if target_language == "auto" {
        return Err("Укажите целевой язык перевода.".to_string());
    }

    let source_language = resolve_source_language(&req.source_language, source_text)
        .ok_or_else(|| format!("{} не смог определить исходный язык.", definition.name))?;

    match definition.kind {
        LocalTranslatorKind::Nllb => {}
        LocalTranslatorKind::MarianPair {
            source_language: supported_source,
            target_language: supported_target,
        } => {
            if source_language != supported_source {
                return Err(definition
                    .unsupported_source_error
                    .unwrap_or("Локальный переводчик не поддерживает исходный язык.")
                    .to_string());
            }
            if target_language != supported_target {
                return Err(definition
                    .unsupported_target_error
                    .unwrap_or("Локальный переводчик не поддерживает целевой язык.")
                    .to_string());
            }
        }
    }

    Ok(ResolvedTranslationLanguages {
        source_language: source_language.to_string(),
        target_language: target_language.to_string(),
    })
}

async fn download_model_if_needed(
    app: &AppHandle,
    definition: &'static LocalTranslatorDefinition,
) -> Result<(), String> {
    if is_model_installed(app, definition) {
        return Ok(());
    }

    let dir = model_dir(app, definition)?;
    fs::create_dir_all(&dir).map_err(|err| {
        format!(
            "Не удалось подготовить папку модели {}: {}",
            definition.name, err
        )
    })?;

    logger::log_info(
        "LOCAL_TRANSLATOR",
        &format!(
            "Downloading CTranslate2 model {} from {}",
            definition.model_label, definition.model_repo
        ),
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|err| {
            format!(
                "Не удалось подготовить загрузчик {}: {}",
                definition.name, err
            )
        })?;

    for file in definition.model_files {
        let target = dir.join(file);
        if target.is_file() {
            continue;
        }

        let url = format!(
            "https://huggingface.co/{}/resolve/main/{}",
            definition.model_repo, file
        );
        let bytes = client
            .get(&url)
            .send()
            .await
            .map_err(|err| format!("Не удалось скачать {}: {}", file, err))?
            .error_for_status()
            .map_err(|err| format!("Hugging Face вернул ошибку для {}: {}", file, err))?
            .bytes()
            .await
            .map_err(|err| format!("Не удалось прочитать {}: {}", file, err))?;

        let temp = target.with_extension("download");
        fs::write(&temp, &bytes)
            .map_err(|err| format!("Не удалось сохранить {}: {}", file, err))?;
        fs::rename(&temp, &target)
            .map_err(|err| format!("Не удалось установить {}: {}", file, err))?;
    }

    Ok(())
}

fn load_translator(
    app: &AppHandle,
    definition: &'static LocalTranslatorDefinition,
) -> Result<Arc<CtTranslator>, String> {
    if let Some(translator) = translator_cache()
        .lock()
        .map_err(|_| format!("Не удалось открыть кэш {}.", definition.name))?
        .get(definition.provider)
        .cloned()
    {
        return Ok(translator);
    }

    let dir = model_dir(app, definition)?;
    let config = Config {
        device: Device::CPU,
        compute_type: ComputeType::AUTO,
        ..Default::default()
    };
    let translator = Arc::new(
        Translator::new(&dir, &config)
            .map_err(|err| format!("Не удалось загрузить модель {}: {}", definition.name, err))?,
    );

    translator_cache()
        .lock()
        .map_err(|_| format!("Не удалось обновить кэш {}.", definition.name))?
        .insert(definition.provider.to_string(), translator.clone());

    Ok(translator)
}

fn translate_text(
    translator: Arc<CtTranslator>,
    text: String,
    definition: &'static LocalTranslatorDefinition,
    languages: ResolvedTranslationLanguages,
) -> Result<String, String> {
    let options = TranslationOptions {
        beam_size: FAST_TRANSLATION_BEAM_SIZE,
        max_decoding_length: 512,
        ..Default::default()
    };

    let results = match definition.kind {
        LocalTranslatorKind::Nllb => {
            let source = format!("{} {}", languages.source_language, text);
            let target_prefixes = vec![vec![languages.target_language]];
            translator
                .translate_batch_with_target_prefix(&[source], &target_prefixes, &options, None)
                .map_err(|err| format!("Ошибка CTranslate2: {}", err))?
        }
        LocalTranslatorKind::MarianPair { .. } => translator
            .translate_batch(&[text], &options, None)
            .map_err(|err| format!("Ошибка CTranslate2: {}", err))?,
    };

    results
        .into_iter()
        .next()
        .map(|(value, _score)| value)
        .ok_or_else(|| "CTranslate2 не вернул результат.".to_string())
}

fn language_to_nllb(language: &str) -> Option<&'static str> {
    let value = language.trim().to_ascii_lowercase();
    if value.is_empty() {
        return None;
    }
    match value.split(['-', '_']).next().unwrap_or(value.as_str()) {
        "auto" => Some("auto"),
        "af" | "afr" => Some("afr_Latn"),
        "sq" | "als" => Some("als_Latn"),
        "am" | "amh" => Some("amh_Ethi"),
        "ar" | "arb" => Some("arb_Arab"),
        "hy" | "hye" => Some("hye_Armn"),
        "az" | "azj" => Some("azj_Latn"),
        "eu" | "eus" => Some("eus_Latn"),
        "be" | "bel" => Some("bel_Cyrl"),
        "bn" | "ben" => Some("ben_Beng"),
        "bs" | "bos" => Some("bos_Latn"),
        "bg" | "bul" => Some("bul_Cyrl"),
        "ca" | "cat" => Some("cat_Latn"),
        "zh" | "zho" => Some("zho_Hans"),
        "hr" | "hrv" => Some("hrv_Latn"),
        "cs" | "ces" => Some("ces_Latn"),
        "da" | "dan" => Some("dan_Latn"),
        "nl" | "nld" => Some("nld_Latn"),
        "en" | "eng" => Some("eng_Latn"),
        "et" | "est" => Some("est_Latn"),
        "fi" | "fin" => Some("fin_Latn"),
        "fr" | "fra" => Some("fra_Latn"),
        "gl" | "glg" => Some("glg_Latn"),
        "ka" | "kat" => Some("kat_Geor"),
        "de" | "deu" => Some("deu_Latn"),
        "el" | "ell" => Some("ell_Grek"),
        "gu" | "guj" => Some("guj_Gujr"),
        "ht" | "hat" => Some("hat_Latn"),
        "he" | "heb" => Some("heb_Hebr"),
        "hi" | "hin" => Some("hin_Deva"),
        "hu" | "hun" => Some("hun_Latn"),
        "is" | "isl" => Some("isl_Latn"),
        "id" | "ind" => Some("ind_Latn"),
        "ga" | "gle" => Some("gle_Latn"),
        "it" | "ita" => Some("ita_Latn"),
        "ja" | "jpn" => Some("jpn_Jpan"),
        "kn" | "kan" => Some("kan_Knda"),
        "kk" | "kaz" => Some("kaz_Cyrl"),
        "km" | "khm" => Some("khm_Khmr"),
        "ko" | "kor" => Some("kor_Hang"),
        "ky" | "kir" => Some("kir_Cyrl"),
        "lo" | "lao" => Some("lao_Laoo"),
        "lv" | "lvs" => Some("lvs_Latn"),
        "lt" | "lit" => Some("lit_Latn"),
        "mk" | "mkd" => Some("mkd_Cyrl"),
        "ms" | "zsm" => Some("zsm_Latn"),
        "ml" | "mal" => Some("mal_Mlym"),
        "mt" | "mlt" => Some("mlt_Latn"),
        "mi" | "mri" => Some("mri_Latn"),
        "mn" | "khk" => Some("khk_Cyrl"),
        "ne" | "npi" => Some("npi_Deva"),
        "nb" | "no" | "nob" => Some("nob_Latn"),
        "nn" | "nno" => Some("nno_Latn"),
        "ps" | "pbt" => Some("pbt_Arab"),
        "fa" | "pes" => Some("pes_Arab"),
        "pl" | "pol" => Some("pol_Latn"),
        "pt" | "por" => Some("por_Latn"),
        "pa" | "pan" => Some("pan_Guru"),
        "ro" | "ron" => Some("ron_Latn"),
        "ru" | "rus" => Some("rus_Cyrl"),
        "sr" | "srp" => Some("srp_Cyrl"),
        "si" | "sin" => Some("sin_Sinh"),
        "sk" | "slk" => Some("slk_Latn"),
        "sl" | "slv" => Some("slv_Latn"),
        "so" | "som" => Some("som_Latn"),
        "es" | "spa" => Some("spa_Latn"),
        "sw" | "swh" => Some("swh_Latn"),
        "sv" | "swe" => Some("swe_Latn"),
        "tg" | "tgk" => Some("tgk_Cyrl"),
        "ta" | "tam" => Some("tam_Taml"),
        "te" | "tel" => Some("tel_Telu"),
        "th" | "tha" => Some("tha_Thai"),
        "tr" | "tur" => Some("tur_Latn"),
        "uk" | "ukr" => Some("ukr_Cyrl"),
        "ur" | "urd" => Some("urd_Arab"),
        "uz" | "uzn" => Some("uzn_Latn"),
        "vi" | "vie" => Some("vie_Latn"),
        "cy" | "cym" => Some("cym_Latn"),
        "xh" | "xho" => Some("xho_Latn"),
        "yi" | "ydd" => Some("ydd_Hebr"),
        "yo" | "yor" => Some("yor_Latn"),
        "zu" | "zul" => Some("zul_Latn"),
        _ => None,
    }
}

fn resolve_source_language<'a>(language: &'a str, text: &str) -> Option<&'a str> {
    match language_to_nllb(language) {
        Some("auto") | None => detect_source_language(text),
        other => other,
    }
}

fn detect_source_language(text: &str) -> Option<&'static str> {
    let mut cyrillic = 0usize;
    let mut latin = 0usize;
    for ch in text.chars() {
        if ('\u{0400}'..='\u{04FF}').contains(&ch) {
            cyrillic += 1;
        } else if ('\u{0590}'..='\u{05FF}').contains(&ch) {
            return Some("heb_Hebr");
        } else if ('\u{0600}'..='\u{06FF}').contains(&ch) {
            return Some("arb_Arab");
        } else if ('\u{0370}'..='\u{03FF}').contains(&ch) {
            return Some("ell_Grek");
        } else if ('\u{3040}'..='\u{30FF}').contains(&ch) {
            return Some("jpn_Jpan");
        } else if ('\u{AC00}'..='\u{D7AF}').contains(&ch) {
            return Some("kor_Hang");
        } else if ('\u{4E00}'..='\u{9FFF}').contains(&ch) {
            return Some("zho_Hans");
        } else if ('\u{0E00}'..='\u{0E7F}').contains(&ch) {
            return Some("tha_Thai");
        } else if ch.is_ascii_alphabetic() {
            latin += 1;
        }
    }

    if cyrillic > latin {
        Some("rus_Cyrl")
    } else if latin > 0 {
        Some("eng_Latn")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_provider() {
        assert!(ensure_provider("other").is_err());
        assert!(ensure_provider(NLLB_TRANSLATOR_PROVIDER).is_ok());
        assert!(ensure_provider(OPUS_RU_EN_TRANSLATOR_PROVIDER).is_ok());
        assert!(ensure_provider(LEGACY_TRAD_PROVIDER).is_ok());
    }

    #[test]
    fn resolves_opus_ru_en_languages() {
        let definition = ensure_provider(OPUS_RU_EN_TRANSLATOR_PROVIDER).unwrap();
        let req = LocalTranslationRequest {
            provider: OPUS_RU_EN_TRANSLATOR_PROVIDER.to_string(),
            text: "Привет".to_string(),
            source_language: "auto".to_string(),
            target_language: "en".to_string(),
        };
        let resolved = resolve_translation_languages(definition, &req, &req.text).unwrap();
        assert_eq!(resolved.source_language, "rus_Cyrl");
        assert_eq!(resolved.target_language, "eng_Latn");

        let wrong_target = LocalTranslationRequest {
            target_language: "de".to_string(),
            ..req
        };
        assert!(
            resolve_translation_languages(definition, &wrong_target, &wrong_target.text).is_err()
        );

        let wrong_source = LocalTranslationRequest {
            text: "Hello".to_string(),
            source_language: "auto".to_string(),
            target_language: "en".to_string(),
            provider: OPUS_RU_EN_TRANSLATOR_PROVIDER.to_string(),
        };
        assert!(
            resolve_translation_languages(definition, &wrong_source, &wrong_source.text).is_err()
        );
    }

    #[test]
    fn detects_cyrillic_and_latin_sources() {
        assert_eq!(detect_source_language("Привет мир"), Some("rus_Cyrl"));
        assert_eq!(detect_source_language("Hello world"), Some("eng_Latn"));
        assert_eq!(detect_source_language("שלום"), Some("heb_Hebr"));
        assert_eq!(detect_source_language("こんにちは"), Some("jpn_Jpan"));
        assert_eq!(detect_source_language("12345"), None);
    }

    #[test]
    fn maps_talkis_languages_to_nllb_codes() {
        assert_eq!(language_to_nllb("en"), Some("eng_Latn"));
        assert_eq!(language_to_nllb("ru"), Some("rus_Cyrl"));
        assert_eq!(language_to_nllb("de"), Some("deu_Latn"));
        assert_eq!(language_to_nllb("ja"), Some("jpn_Jpan"));
        assert_eq!(language_to_nllb("auto"), Some("auto"));
        assert_eq!(language_to_nllb("unknown"), None);
    }
}
