use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, Runtime, State, Window,
};
use tauri_plugin_window_state::AppHandleExt;

const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_HIDE_ID: &str = "tray-hide";
const TRAY_UNREAD_ID: &str = "tray-unread";
const TRAY_QUIT_ID: &str = "tray-quit";
const UNAUTHENTICATED_WINDOW_WIDTH: f64 = 800.0;
const UNAUTHENTICATED_WINDOW_HEIGHT: f64 = 600.0;
const AUTHENTICATED_WINDOW_WIDTH: f64 = 1440.0;
const AUTHENTICATED_WINDOW_HEIGHT: f64 = 900.0;
const AUTHENTICATED_MINIMUM_WIDTH: f64 = 1100.0;
const AUTHENTICATED_MINIMUM_HEIGHT: f64 = 700.0;

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
    #[cfg(target_os = "macos")]
    let _ = app.show();

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

#[tauri::command]
fn set_close_to_tray(state: State<'_, DesktopState>, enabled: bool) {
    state.close_to_tray.store(enabled, Ordering::SeqCst);
}

#[tauri::command]
fn show_desktop_window(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
fn desktop_should_start_hidden() -> bool {
    should_start_hidden()
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

fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    tauri_plugin_window_state::StateFlags::SIZE
        | tauri_plugin_window_state::StateFlags::POSITION
        | tauri_plugin_window_state::StateFlags::MAXIMIZED
}

fn configure_desktop_window(app: &AppHandle, authenticated: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let (desired_width, desired_height) = if authenticated {
        (AUTHENTICATED_WINDOW_WIDTH, AUTHENTICATED_WINDOW_HEIGHT)
    } else {
        (UNAUTHENTICATED_WINDOW_WIDTH, UNAUTHENTICATED_WINDOW_HEIGHT)
    };
    let mut target_width = desired_width;
    let mut target_height = desired_height;

    let current_monitor = window.current_monitor().ok().flatten();
    if let Some(monitor) = current_monitor.as_ref() {
        let monitor_size = monitor.size().to_logical::<f64>(monitor.scale_factor());
        target_width = target_width.min((monitor_size.width - 40.0).max(480.0));
        target_height = target_height.min((monitor_size.height - 80.0).max(480.0));
    }

    let _ = window.unmaximize();
    let _ = window.set_resizable(true);

    if authenticated {
        let _ = window.set_min_size(Some(LogicalSize::new(
            AUTHENTICATED_MINIMUM_WIDTH.min(target_width),
            AUTHENTICATED_MINIMUM_HEIGHT.min(target_height),
        )));
    } else {
        let _ = window.set_min_size(None::<LogicalSize<f64>>);
    }

    let _ = window.set_size(LogicalSize::new(target_width, target_height));
    if let Some(monitor) = current_monitor {
        let scale_factor = monitor.scale_factor();
        let target_size =
            LogicalSize::new(target_width, target_height).to_physical::<u32>(scale_factor);
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        let centered_x = i64::from(monitor_position.x)
            + (i64::from(monitor_size.width) - i64::from(target_size.width)) / 2;
        let centered_y = i64::from(monitor_position.y)
            + (i64::from(monitor_size.height) - i64::from(target_size.height)) / 2;
        let _ = window.set_position(PhysicalPosition::new(centered_x as i32, centered_y as i32));
    } else {
        let _ = window.center();
    }
    let _ = window.set_resizable(authenticated);
    let _ = app.save_window_state(window_state_flags());
}

#[tauri::command]
fn set_desktop_authenticated_window(app: AppHandle, authenticated: bool) {
    configure_desktop_window(&app, authenticated);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .skip_initial_state("main")
                .build(),
        )
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
            set_close_to_tray,
            set_desktop_authenticated_window,
            show_desktop_window,
            desktop_should_start_hidden,
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
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
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
        .run(|app, event| match event {
            tauri::RunEvent::Ready => {
                configure_desktop_window(app, false);

                if should_start_hidden() {
                    hide_main_window(app);
                } else {
                    show_main_window(app);
                }
            }
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main_window(app),
            _ => {}
        });
}
