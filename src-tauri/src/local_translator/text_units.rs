#[derive(Debug, PartialEq, Eq)]
pub(super) struct TranslationUnit {
    pub(super) text: String,
    pub(super) separator: String,
}

pub(super) fn split_translation_units(text: &str) -> Vec<TranslationUnit> {
    let chars = text.char_indices().collect::<Vec<_>>();
    let mut units = Vec::new();
    let mut unit_start = 0usize;
    let mut index = 0usize;

    while index < chars.len() {
        let (byte_index, ch) = chars[index];

        if ch == '\n' || ch == '\r' {
            let separator_end = consume_whitespace(&chars, index, text.len());
            push_translation_unit(
                &mut units,
                text,
                unit_start,
                byte_index,
                byte_index,
                separator_end,
            );
            unit_start = separator_end;
            index = char_index_at_or_after(&chars, index, separator_end);
            continue;
        }

        if is_sentence_terminator(ch) && is_sentence_boundary(text, &chars, index) {
            let content_end_index = consume_sentence_ending(&chars, index);
            let content_end = byte_after_char(&chars, content_end_index, text.len());
            let separator_start_index = content_end_index + 1;
            let separator_end = consume_whitespace(&chars, separator_start_index, text.len());
            push_translation_unit(
                &mut units,
                text,
                unit_start,
                content_end,
                content_end,
                separator_end,
            );
            unit_start = separator_end;
            index = char_index_at_or_after(&chars, separator_start_index, separator_end);
            continue;
        }

        index += 1;
    }

    push_translation_unit(
        &mut units,
        text,
        unit_start,
        text.len(),
        text.len(),
        text.len(),
    );

    units
}

pub(super) fn join_translation_results(
    units: &[TranslationUnit],
    results: Vec<(String, Option<f32>)>,
) -> Result<String, String> {
    if results.len() != units.len() {
        return Err(format!(
            "CTranslate2 вернул неполный результат: ожидалось {}, получено {}.",
            units.len(),
            results.len()
        ));
    }

    let mut translated = String::new();
    for (unit, (value, _score)) in units.iter().zip(results) {
        let value = value.trim();
        if value.is_empty() {
            return Err("CTranslate2 вернул пустую часть перевода.".to_string());
        }
        translated.push_str(value);
        translated.push_str(&unit.separator);
    }

    Ok(translated)
}

fn is_sentence_boundary(text: &str, chars: &[(usize, char)], index: usize) -> bool {
    if chars[index].1 == '.' && is_abbreviation_before_period(text, chars[index].0) {
        return false;
    }

    let ending_index = consume_sentence_ending(chars, index);
    let next_index = ending_index + 1;
    next_index >= chars.len() || chars[next_index].1.is_whitespace()
}

fn is_abbreviation_before_period(text: &str, period_index: usize) -> bool {
    let token_start = text[..period_index]
        .rfind(char::is_whitespace)
        .map(|index| index + 1)
        .unwrap_or(0);
    let token = text[token_start..period_index]
        .trim_matches(|ch: char| matches!(ch, '"' | '\'' | '“' | '‘' | '«' | '(' | '['));
    let normalized = token.to_ascii_lowercase();
    let common_abbreviation = matches!(
        normalized.as_str(),
        "mr" | "mrs"
            | "ms"
            | "dr"
            | "prof"
            | "sr"
            | "jr"
            | "st"
            | "vs"
            | "etc"
            | "e.g"
            | "i.e"
            | "г"
            | "ул"
            | "д"
            | "т"
            | "им"
    );
    let is_initial =
        token.chars().count() == 1 && token.chars().next().is_some_and(|ch| ch.is_alphabetic());

    common_abbreviation || is_initial || token.contains('.')
}

fn is_sentence_terminator(ch: char) -> bool {
    matches!(ch, '.' | '!' | '?' | '…' | '。' | '！' | '？')
}

fn is_closing_sentence_char(ch: char) -> bool {
    matches!(ch, '"' | '\'' | '”' | '’' | '»' | ')' | ']' | '}')
}

fn consume_sentence_ending(chars: &[(usize, char)], start_index: usize) -> usize {
    let mut index = start_index;
    while index + 1 < chars.len()
        && (is_sentence_terminator(chars[index + 1].1)
            || is_closing_sentence_char(chars[index + 1].1))
    {
        index += 1;
    }
    index
}

fn consume_whitespace(chars: &[(usize, char)], start_index: usize, text_len: usize) -> usize {
    let mut index = start_index;
    while index < chars.len() && chars[index].1.is_whitespace() {
        index += 1;
    }

    chars
        .get(index)
        .map(|(byte_index, _)| *byte_index)
        .unwrap_or(text_len)
}

fn char_index_at_or_after(chars: &[(usize, char)], start_index: usize, byte_index: usize) -> usize {
    let mut index = start_index;
    while index < chars.len() && chars[index].0 < byte_index {
        index += 1;
    }
    index
}

fn byte_after_char(chars: &[(usize, char)], index: usize, text_len: usize) -> usize {
    chars
        .get(index + 1)
        .map(|(byte_index, _)| *byte_index)
        .unwrap_or(text_len)
}

fn push_translation_unit(
    units: &mut Vec<TranslationUnit>,
    text: &str,
    content_start: usize,
    content_end: usize,
    separator_start: usize,
    separator_end: usize,
) {
    let content = text[content_start..content_end].trim();
    if content.is_empty() {
        if let Some(previous) = units.last_mut() {
            previous
                .separator
                .push_str(&text[separator_start..separator_end]);
        }
        return;
    }

    units.push(TranslationUnit {
        text: content.to_string(),
        separator: text[separator_start..separator_end].to_string(),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_multi_sentence_translation_without_losing_spacing() {
        let units = split_translation_units(
            "I closed my sick leave just now. Tomorrow i'll be back in the morning",
        );

        assert_eq!(
            units,
            vec![
                TranslationUnit {
                    text: "I closed my sick leave just now.".to_string(),
                    separator: " ".to_string(),
                },
                TranslationUnit {
                    text: "Tomorrow i'll be back in the morning".to_string(),
                    separator: String::new(),
                },
            ]
        );
    }

    #[test]
    fn keeps_short_translation_as_one_unit() {
        assert_eq!(
            split_translation_units("Hello world"),
            vec![TranslationUnit {
                text: "Hello world".to_string(),
                separator: String::new(),
            }]
        );
    }

    #[test]
    fn preserves_paragraph_separators_and_abbreviations() {
        assert_eq!(
            split_translation_units("Dr. Smith is here.\n\nHe is ready."),
            vec![
                TranslationUnit {
                    text: "Dr. Smith is here.".to_string(),
                    separator: "\n\n".to_string(),
                },
                TranslationUnit {
                    text: "He is ready.".to_string(),
                    separator: String::new(),
                },
            ]
        );
    }

    #[test]
    fn rejects_incomplete_translation_batch() {
        let units = split_translation_units("First. Second.");
        let error =
            join_translation_results(&units, vec![("Первое.".to_string(), None)]).unwrap_err();

        assert!(error.contains("неполный результат"));
    }
}
