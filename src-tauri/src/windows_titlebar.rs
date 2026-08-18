use std::ffi::c_void;
use std::mem::size_of;

use tauri::WebviewWindow;
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
    DWMWA_USE_IMMERSIVE_DARK_MODE,
};

use crate::logger;

const TITLEBAR_LOG_TAG: &str = "WINDOW_TITLEBAR";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TitlebarTheme {
    Light,
    Dark,
}

impl TitlebarTheme {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            _ => Err(format!("Unsupported title bar theme: {value}")),
        }
    }
}

#[derive(Clone, Copy)]
struct TitlebarPalette {
    caption: u32,
    text: u32,
    border: u32,
}

fn color_ref(red: u8, green: u8, blue: u8) -> u32 {
    u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16)
}

fn palette(theme: TitlebarTheme) -> TitlebarPalette {
    match theme {
        TitlebarTheme::Light => TitlebarPalette {
            caption: color_ref(250, 249, 246),
            text: color_ref(57, 52, 45),
            border: color_ref(232, 228, 220),
        },
        TitlebarTheme::Dark => TitlebarPalette {
            caption: color_ref(5, 5, 5),
            text: color_ref(247, 247, 247),
            border: color_ref(23, 23, 23),
        },
    }
}

fn set_dwm_attribute<T>(hwnd: HWND, attribute: u32, value: &T) -> Result<(), i32> {
    let result = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute,
            value as *const T as *const c_void,
            size_of::<T>() as u32,
        )
    };

    if result < 0 {
        Err(result)
    } else {
        Ok(())
    }
}

pub fn apply(window: &WebviewWindow, theme: TitlebarTheme) -> Result<(), String> {
    let native_handle = window
        .hwnd()
        .map_err(|error| format!("Failed to access the settings window handle: {error}"))?;
    let hwnd = native_handle.0 as HWND;
    let colors = palette(theme);
    let dark_mode = i32::from(theme == TitlebarTheme::Dark);

    let attributes = [
        ("dark mode", DWMWA_USE_IMMERSIVE_DARK_MODE, dark_mode as u32),
        ("caption", DWMWA_CAPTION_COLOR, colors.caption),
        ("text", DWMWA_TEXT_COLOR, colors.text),
        ("border", DWMWA_BORDER_COLOR, colors.border),
    ];

    for (name, attribute, value) in attributes {
        if let Err(result) = set_dwm_attribute(hwnd, attribute as u32, &value) {
            // Caption, text and border colors were introduced in Windows 11.
            // Keeping the native frame is the fallback on older Windows builds.
            logger::log_info(
                TITLEBAR_LOG_TAG,
                &format!("Windows skipped {name} styling (HRESULT {result:#010x})"),
            );
        }
    }

    logger::log_info(
        TITLEBAR_LOG_TAG,
        &format!("Applied {:?} native title bar theme", theme),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_rgb_to_windows_color_ref() {
        assert_eq!(color_ref(0x12, 0x34, 0x56), 0x0056_3412);
    }

    #[test]
    fn accepts_only_effective_themes() {
        assert_eq!(TitlebarTheme::parse("light"), Ok(TitlebarTheme::Light));
        assert_eq!(TitlebarTheme::parse("dark"), Ok(TitlebarTheme::Dark));
        assert!(TitlebarTheme::parse("system").is_err());
    }
}
