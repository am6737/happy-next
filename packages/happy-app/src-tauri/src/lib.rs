use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, State, Window,
};

const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_HIDE_ID: &str = "tray-hide";
const TRAY_UNREAD_ID: &str = "tray-unread";
const TRAY_QUIT_ID: &str = "tray-quit";
const CREDENTIAL_SERVICE: &str = "com.hitosea.happy";
const CREDENTIAL_ACCOUNT: &str = "happy-next-auth";

#[derive(serde::Deserialize, serde::Serialize)]
struct DesktopCredentials {
    token: String,
    secret: String,
}

struct DesktopState {
    close_to_tray: AtomicBool,
    explicit_quit: AtomicBool,
    unread_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
            explicit_quit: AtomicBool::new(false),
            unread_item: Mutex::new(None),
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit_app<R: Runtime>(app: &AppHandle<R>) {
    app.state::<DesktopState>()
        .explicit_quit
        .store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
        .map_err(|_| "Unable to access the system credential store".to_string())
}

#[tauri::command]
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn desktop_get_credentials() -> Result<Option<DesktopCredentials>, String> {
    let entry = credential_entry()?;
    let stored = match entry.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => return Err("Unable to read credentials from the system credential store".into()),
    };

    serde_json::from_str(&stored)
        .map(Some)
        .map_err(|_| "Stored desktop credentials are invalid".to_string())
}

#[tauri::command]
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn desktop_set_credentials(credentials: DesktopCredentials) -> Result<(), String> {
    let stored = serde_json::to_string(&credentials)
        .map_err(|_| "Unable to prepare credentials for secure storage".to_string())?;

    credential_entry()?
        .set_password(&stored)
        .map_err(|_| "Unable to save credentials to the system credential store".to_string())
}

#[tauri::command]
#[cfg(any(target_os = "macos", target_os = "windows"))]
fn desktop_remove_credentials() -> Result<(), String> {
    match credential_entry()?.delete_password() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Unable to remove credentials from the system credential store".into()),
    }
}

#[tauri::command]
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn desktop_get_credentials() -> Result<Option<DesktopCredentials>, String> {
    Err("System credential storage is only available on macOS and Windows".into())
}

#[tauri::command]
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn desktop_set_credentials(_credentials: DesktopCredentials) -> Result<(), String> {
    Err("System credential storage is only available on macOS and Windows".into())
}

#[tauri::command]
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn desktop_remove_credentials() -> Result<(), String> {
    Err("System credential storage is only available on macOS and Windows".into())
}

#[tauri::command]
fn set_close_to_tray(state: State<'_, DesktopState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn show_desktop_window(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn toggle_desktop_window(app: AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn set_desktop_unread_count(app: AppHandle, state: State<'_, DesktopState>, count: u32) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count((count > 0).then_some(count as i64));

        #[cfg(target_os = "windows")]
        {
            let overlay = if count > 0 {
                app.default_window_icon().cloned()
            } else {
                None
            };
            let _ = window.set_overlay_icon(overlay);
        }
    }

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tooltip = if count == 0 {
            "Happy Next".to_string()
        } else {
            format!("Happy Next · {count} unread")
        };
        let _ = tray.set_tooltip(Some(tooltip));

        #[cfg(target_os = "macos")]
        {
            let _ = tray.set_title((count > 0).then(|| count.to_string()));
        }
    }

    if let Ok(item) = state.unread_item.lock() {
        if let Some(item) = item.as_ref() {
            let text = if count == 0 {
                "No unread messages".to_string()
            } else {
                format!(
                    "{count} unread message{}",
                    if count == 1 { "" } else { "s" }
                )
            };
            let _ = item.set_text(text);
        }
    }
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "Show Happy Next", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, TRAY_HIDE_ID, "Hide Window", true, None::<&str>)?;
    let unread = MenuItem::with_id(
        app,
        TRAY_UNREAD_ID,
        "No unread messages",
        false,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit Happy Next", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &unread, &separator, &quit])?;

    if let Ok(mut item) = app.state::<DesktopState>().unread_item.lock() {
        *item = Some(unread);
    }

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Happy Next")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_ID => show_main_window(app),
            TRAY_HIDE_ID => hide_main_window(app),
            TRAY_QUIT_ID => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                toggle_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn should_start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .menu(Menu::default)
        .invoke_handler(tauri::generate_handler![
            desktop_get_credentials,
            desktop_set_credentials,
            desktop_remove_credentials,
            set_close_to_tray,
            show_desktop_window,
            toggle_desktop_window,
            set_desktop_unread_count
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            build_tray(app.handle())?;
            if should_start_hidden() {
                hide_main_window(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window: &Window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<DesktopState>();
                if state.explicit_quit.load(Ordering::SeqCst) {
                    return;
                }

                if state.close_to_tray.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                } else {
                    state.explicit_quit.store(true, Ordering::SeqCst);
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } = event
            {
                show_main_window(app);
            }
        });
}
