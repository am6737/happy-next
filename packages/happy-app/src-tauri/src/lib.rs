use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::{Color, Monitor},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Runtime, State, Theme, Window,
};

const TRAY_ID: &str = "main-tray";
const TRAY_SHOW_ID: &str = "tray-show";
const TRAY_HIDE_ID: &str = "tray-hide";
const TRAY_UNREAD_ID: &str = "tray-unread";
const TRAY_QUIT_ID: &str = "tray-quit";
const MENU_NEW_SESSION_ID: &str = "menu-new-session";
const MENU_SEARCH_ID: &str = "menu-search";
const MENU_FIND_ID: &str = "menu-find";
const MENU_SESSIONS_ID: &str = "menu-sessions";
const MENU_INBOX_ID: &str = "menu-inbox";
const MENU_DOOTASK_ID: &str = "menu-dootask";
const MENU_SETTINGS_ID: &str = "menu-settings";
const MENU_BACK_ID: &str = "menu-back";
const MENU_FORWARD_ID: &str = "menu-forward";
const DESKTOP_MENU_ACTION_EVENT: &str = "desktop-menu-action";
const UNAUTHENTICATED_WINDOW_WIDTH: f64 = 800.0;
const UNAUTHENTICATED_WINDOW_HEIGHT: f64 = 600.0;
const AUTHENTICATED_WINDOW_WIDTH: f64 = 1440.0;
const AUTHENTICATED_WINDOW_HEIGHT: f64 = 900.0;
const AUTHENTICATED_MINIMUM_WIDTH: f64 = 1100.0;
const AUTHENTICATED_MINIMUM_HEIGHT: f64 = 700.0;
const WINDOW_EDGE_MARGIN: i32 = 8;
const BOOTSTRAP_CACHE_FILE: &str = "desktop-bootstrap.json";
const BOOTSTRAP_CACHE_VERSION: u32 = 1;
const LIGHT_BACKGROUND_RGB: (u8, u8, u8) = (245, 245, 245);
const DARK_BACKGROUND_RGB: (u8, u8, u8) = (30, 30, 30);
#[cfg(target_os = "macos")]
const AUTHENTICATED_TRAFFIC_LIGHT_Y: f64 = 26.0;
#[cfg(target_os = "macos")]
const UNAUTHENTICATED_TRAFFIC_LIGHT_Y: f64 = 30.0;
#[cfg(target_os = "macos")]
const AUTHENTICATED_TRAFFIC_LIGHT_X: f64 = 16.0;
#[cfg(target_os = "macos")]
const UNAUTHENTICATED_TRAFFIC_LIGHT_X: f64 = 20.0;
#[cfg(not(target_os = "macos"))]
const DESKTOP_NOTIFICATION_CLICKED_EVENT: &str = "desktop-notification-clicked";

#[cfg(not(target_os = "macos"))]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNotificationClicked {
    session_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopMenuAction {
    action: &'static str,
}

#[derive(Clone, Copy, Debug, Default, serde::Deserialize, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum DesktopThemePreference {
    Light,
    Dark,
    #[default]
    Adaptive,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AuthenticatedWindowState {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    #[serde(default)]
    maximized: bool,
}

#[derive(Clone, Debug, serde::Deserialize, serde::Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct DesktopBootstrapState {
    #[serde(default = "bootstrap_cache_version")]
    version: u32,
    #[serde(default)]
    last_authenticated: bool,
    #[serde(default)]
    theme_preference: DesktopThemePreference,
    #[serde(default)]
    window: Option<AuthenticatedWindowState>,
}

const fn bootstrap_cache_version() -> u32 {
    BOOTSTRAP_CACHE_VERSION
}

impl Default for DesktopBootstrapState {
    fn default() -> Self {
        Self {
            version: BOOTSTRAP_CACHE_VERSION,
            last_authenticated: false,
            theme_preference: DesktopThemePreference::Adaptive,
            window: None,
        }
    }
}

struct DesktopState {
    close_to_tray: AtomicBool,
    explicit_quit: AtomicBool,
    authenticated: AtomicBool,
    bootstrap: Mutex<DesktopBootstrapState>,
    bootstrap_path: Mutex<Option<PathBuf>>,
    save_generation: Arc<AtomicU64>,
    ignore_window_events_until: Mutex<Option<Instant>>,
    unread_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            close_to_tray: AtomicBool::new(true),
            explicit_quit: AtomicBool::new(false),
            authenticated: AtomicBool::new(false),
            bootstrap: Mutex::new(DesktopBootstrapState::default()),
            bootstrap_path: Mutex::new(None),
            save_generation: Arc::new(AtomicU64::new(0)),
            ignore_window_events_until: Mutex::new(None),
            unread_item: Mutex::new(None),
        }
    }
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
        let _ = app.run_on_main_thread(|| {
            let main_thread = objc2::MainThreadMarker::new()
                .expect("macOS application activation must run on the main thread");
            #[allow(deprecated)]
            objc2_app_kit::NSApplication::sharedApplication(main_thread)
                .activateIgnoringOtherApps(true);
        });
    }

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
async fn show_desktop_notification(
    app: AppHandle,
    notification_id: i32,
    title: String,
    body: String,
    session_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri::plugin::PermissionState;
        use tauri_plugin_notifications::NotificationsExt;
        let _ = session_id;

        let permission = app
            .notifications()
            .request_permission()
            .await
            .map_err(|error| format!("failed to request notification permission: {error}"))?;
        if permission != PermissionState::Granted {
            return Err(format!(
                "macOS notification permission is not granted: {permission:?}"
            ));
        }

        app.notifications()
            .builder()
            .id(notification_id)
            .title(title)
            .body(body)
            .auto_cancel()
            .show()
            .await
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body);

        #[cfg(target_os = "windows")]
        if !tauri::is_dev() {
            notification.app_id(&app.config().identifier);
        }

        let handle = notification.show().map_err(|error| error.to_string())?;
        std::thread::spawn(move || {
            let _ = handle.wait_for_response(|response: &notify_rust::NotificationResponse| {
                if !matches!(
                    response,
                    notify_rust::NotificationResponse::Default
                        | notify_rust::NotificationResponse::Action(_)
                        | notify_rust::NotificationResponse::Reply(_)
                ) {
                    return;
                }

                show_main_window(&app);
                let _ = app.emit(
                    DESKTOP_NOTIFICATION_CLICKED_EVENT,
                    DesktopNotificationClicked { session_id },
                );
            });
        });
        Ok(())
    }
}

#[tauri::command]
fn toggle_desktop_window(app: AppHandle) {
    toggle_main_window(&app);
}

#[tauri::command]
fn set_desktop_unread_count(app: AppHandle, state: State<'_, DesktopState>, count: u32) {
    apply_desktop_unread_count(&app, &state, count);
}

fn apply_desktop_unread_count<R: Runtime>(app: &AppHandle<R>, state: &DesktopState, count: u32) {
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
        let _ = tray.set_title(None::<String>);
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

fn build_application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let new_session = MenuItem::with_id(
        app,
        MENU_NEW_SESSION_ID,
        "New Session",
        true,
        Some("CmdOrCtrl+N"),
    )?;
    let search = MenuItem::with_id(app, MENU_SEARCH_ID, "Search…", true, Some("CmdOrCtrl+K"))?;
    let find = MenuItem::with_id(app, MENU_FIND_ID, "Find…", true, Some("CmdOrCtrl+F"))?;
    let sessions = MenuItem::with_id(app, MENU_SESSIONS_ID, "Sessions", true, Some("CmdOrCtrl+1"))?;
    let inbox = MenuItem::with_id(app, MENU_INBOX_ID, "Inbox", true, Some("CmdOrCtrl+2"))?;
    let dootask = MenuItem::with_id(app, MENU_DOOTASK_ID, "DooTask", true, Some("CmdOrCtrl+3"))?;
    #[cfg(not(target_os = "macos"))]
    let settings = MenuItem::with_id(
        app,
        MENU_SETTINGS_ID,
        "Settings…",
        true,
        Some("CmdOrCtrl+,"),
    )?;
    #[cfg(target_os = "macos")]
    let back_accelerator = "CmdOrCtrl+[";
    #[cfg(not(target_os = "macos"))]
    let back_accelerator = "Alt+Left";
    let back = MenuItem::with_id(app, MENU_BACK_ID, "Back", true, Some(back_accelerator))?;
    #[cfg(target_os = "macos")]
    let forward_accelerator = "CmdOrCtrl+]";
    #[cfg(not(target_os = "macos"))]
    let forward_accelerator = "Alt+Right";
    let forward = MenuItem::with_id(
        app,
        MENU_FORWARD_ID,
        "Forward",
        true,
        Some(forward_accelerator),
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new_session,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let navigate_menu = Submenu::with_items(
        app,
        "Navigate",
        true,
        &[
            &search,
            &find,
            &PredefinedMenuItem::separator(app)?,
            &sessions,
            &inbox,
            &dootask,
            #[cfg(not(target_os = "macos"))]
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &back,
            &forward,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    {
        let app_settings = MenuItem::with_id(
            app,
            MENU_SETTINGS_ID,
            "Settings…",
            true,
            Some("CmdOrCtrl+,"),
        )?;
        let app_menu = Submenu::with_items(
            app,
            "Happy Next",
            true,
            &[
                &PredefinedMenuItem::about(app, None, None)?,
                &PredefinedMenuItem::separator(app)?,
                &app_settings,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::show_all(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?;
        Menu::with_items(
            app,
            &[
                &app_menu,
                &file_menu,
                &edit_menu,
                &navigate_menu,
                &window_menu,
            ],
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        let help_menu = Submenu::with_items(
            app,
            "Help",
            true,
            &[&PredefinedMenuItem::about(app, None, None)?],
        )?;
        Menu::with_items(
            app,
            &[
                &file_menu,
                &edit_menu,
                &navigate_menu,
                &window_menu,
                &help_menu,
            ],
        )
    }
}

fn handle_application_menu_event(app: &AppHandle, id: &str) {
    let action = match id {
        MENU_NEW_SESSION_ID => "newSession",
        MENU_SEARCH_ID | MENU_FIND_ID => "search",
        MENU_SESSIONS_ID => "sessions",
        MENU_INBOX_ID => "inbox",
        MENU_DOOTASK_ID => "dootask",
        MENU_SETTINGS_ID => "settings",
        MENU_BACK_ID => "back",
        MENU_FORWARD_ID => "forward",
        _ => return,
    };
    show_main_window(app);
    let _ = app.emit(DESKTOP_MENU_ACTION_EVENT, DesktopMenuAction { action });
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

    #[cfg(target_os = "macos")]
    {
        let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;
        tray = tray.icon(icon).icon_as_template(true);
    }

    #[cfg(not(target_os = "macos"))]
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;
    Ok(())
}

fn should_start_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

fn read_bootstrap_state(path: &Path) -> DesktopBootstrapState {
    let Ok(contents) = fs::read(path) else {
        return DesktopBootstrapState::default();
    };
    let Ok(mut state) = serde_json::from_slice::<DesktopBootstrapState>(&contents) else {
        return DesktopBootstrapState::default();
    };
    if state.version != BOOTSTRAP_CACHE_VERSION {
        return DesktopBootstrapState::default();
    }
    if let Some(window) = state.window.as_ref() {
        if !window.width.is_finite()
            || !window.height.is_finite()
            || window.width <= 0.0
            || window.height <= 0.0
        {
            state.window = None;
        }
    }
    state
}

fn write_bootstrap_state(path: &Path, state: &DesktopBootstrapState) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let contents = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    let temporary_path = path.with_extension("json.tmp");
    fs::write(&temporary_path, contents)?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary_path, path)
}

fn persist_bootstrap_state(state: &DesktopState) {
    let path = state
        .bootstrap_path
        .lock()
        .ok()
        .and_then(|path| path.clone());
    let snapshot = state.bootstrap.lock().ok().map(|state| state.clone());
    if let (Some(path), Some(snapshot)) = (path, snapshot) {
        let _ = write_bootstrap_state(&path, &snapshot);
    }
}

fn schedule_bootstrap_save(state: &DesktopState) {
    let path = state
        .bootstrap_path
        .lock()
        .ok()
        .and_then(|path| path.clone());
    let snapshot = state.bootstrap.lock().ok().map(|state| state.clone());
    let generation = state.save_generation.fetch_add(1, Ordering::SeqCst) + 1;
    let save_generation = Arc::clone(&state.save_generation);
    if let (Some(path), Some(snapshot)) = (path, snapshot) {
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(350));
            if save_generation.load(Ordering::SeqCst) == generation {
                let _ = write_bootstrap_state(&path, &snapshot);
            }
        });
    }
}

fn rectangles_intersection_area(left: (i64, i64, i64, i64), right: (i64, i64, i64, i64)) -> i64 {
    let width = (left.2.min(right.2) - left.0.max(right.0)).max(0);
    let height = (left.3.min(right.3) - left.1.max(right.1)).max(0);
    width * height
}

fn monitor_rect(monitor: &Monitor) -> (i64, i64, i64, i64) {
    let area = monitor.work_area();
    let x = i64::from(area.position.x);
    let y = i64::from(area.position.y);
    (
        x,
        y,
        x + i64::from(area.size.width),
        y + i64::from(area.size.height),
    )
}

fn choose_restore_monitor<'a>(
    monitors: &'a [Monitor],
    saved: &AuthenticatedWindowState,
) -> Option<&'a Monitor> {
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let saved_width = (saved.width * scale).round().max(1.0) as i64;
            let saved_height = (saved.height * scale).round().max(1.0) as i64;
            let area = rectangles_intersection_area(
                (
                    i64::from(saved.x),
                    i64::from(saved.y),
                    i64::from(saved.x) + saved_width,
                    i64::from(saved.y) + saved_height,
                ),
                monitor_rect(monitor),
            );
            (monitor, area)
        })
        .max_by_key(|(_, area)| *area)
        .and_then(|(monitor, area)| (area > 0).then_some(monitor))
}

fn clamp_window_to_monitor(
    saved: Option<&AuthenticatedWindowState>,
    monitor: &Monitor,
    default_width: f64,
    default_height: f64,
    minimum_width: f64,
    minimum_height: f64,
) -> AuthenticatedWindowState {
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let available_width =
        (f64::from(area.size.width) / scale - f64::from(WINDOW_EDGE_MARGIN * 2) / scale).max(1.0);
    let available_height =
        (f64::from(area.size.height) / scale - f64::from(WINDOW_EDGE_MARGIN * 2) / scale).max(1.0);
    let width = saved
        .map(|window| window.width)
        .unwrap_or(default_width)
        .clamp(minimum_width.min(available_width), available_width);
    let height = saved
        .map(|window| window.height)
        .unwrap_or(default_height)
        .clamp(minimum_height.min(available_height), available_height);
    let physical_width = (width * scale).round() as i64;
    let physical_height = (height * scale).round() as i64;
    let area_left = i64::from(area.position.x) + i64::from(WINDOW_EDGE_MARGIN);
    let area_top = i64::from(area.position.y) + i64::from(WINDOW_EDGE_MARGIN);
    let area_right =
        i64::from(area.position.x) + i64::from(area.size.width) - i64::from(WINDOW_EDGE_MARGIN);
    let area_bottom =
        i64::from(area.position.y) + i64::from(area.size.height) - i64::from(WINDOW_EDGE_MARGIN);

    let (x, y) = if let Some(saved) = saved {
        (
            i64::from(saved.x).clamp(area_left, (area_right - physical_width).max(area_left)),
            i64::from(saved.y).clamp(area_top, (area_bottom - physical_height).max(area_top)),
        )
    } else {
        (
            area_left + (area_right - area_left - physical_width).max(0) / 2,
            area_top + (area_bottom - area_top - physical_height).max(0) / 2,
        )
    };

    AuthenticatedWindowState {
        x: x as i32,
        y: y as i32,
        width,
        height,
        maximized: saved.is_some_and(|window| window.maximized),
    }
}

fn resolve_dark_background(
    window: &tauri::WebviewWindow,
    preference: DesktopThemePreference,
) -> bool {
    match preference {
        DesktopThemePreference::Light => false,
        DesktopThemePreference::Dark => true,
        DesktopThemePreference::Adaptive => window.theme().is_ok_and(|theme| theme == Theme::Dark),
    }
}

fn set_desktop_background(window: &tauri::WebviewWindow, preference: DesktopThemePreference) {
    let dark = resolve_dark_background(window, preference);
    let (red, green, blue) = if dark {
        DARK_BACKGROUND_RGB
    } else {
        LIGHT_BACKGROUND_RGB
    };
    let color = Color(red, green, blue, 255);
    let _ = window.set_background_color(Some(color));

    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{
            NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication, NSColor, NSWindow,
        };
        use objc2_foundation::NSArray;
        use objc2_web_kit::WKWebView;

        let _ = window.with_webview(move |webview| {
            // SAFETY: Tauri provides the live WKWebView pointer and invokes this
            // callback on the WebView UI thread.
            unsafe {
                let dark = match preference {
                    DesktopThemePreference::Light => false,
                    DesktopThemePreference::Dark => true,
                    DesktopThemePreference::Adaptive => {
                        let main_thread = objc2::MainThreadMarker::new()
                            .expect("macOS appearance lookup must run on the main thread");
                        let application = NSApplication::sharedApplication(main_thread);
                        let appearances =
                            NSArray::from_slice(&[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]);
                        application
                            .effectiveAppearance()
                            .bestMatchFromAppearancesWithNames(&appearances)
                            .is_some_and(|appearance| {
                                appearance.isEqualToString(NSAppearanceNameDarkAqua)
                            })
                    }
                };
                let (red, green, blue) = if dark {
                    DARK_BACKGROUND_RGB
                } else {
                    LIGHT_BACKGROUND_RGB
                };
                let color = NSColor::colorWithSRGBRed_green_blue_alpha(
                    f64::from(red) / 255.0,
                    f64::from(green) / 255.0,
                    f64::from(blue) / 255.0,
                    1.0,
                );
                let ns_window = &*webview.ns_window().cast::<NSWindow>();
                let webview = &*webview.inner().cast::<WKWebView>();
                webview.setUnderPageBackgroundColor(Some(&color));
                ns_window.setBackgroundColor(Some(&color));
            }
        });
    }
}

#[cfg(target_os = "macos")]
unsafe fn apply_macos_traffic_light_position(
    ns_window: &objc2_app_kit::NSWindow,
    authenticated: bool,
) {
    use objc2_app_kit::{NSView, NSWindowButton};

    let (x, y) = if authenticated {
        (AUTHENTICATED_TRAFFIC_LIGHT_X, AUTHENTICATED_TRAFFIC_LIGHT_Y)
    } else {
        (
            UNAUTHENTICATED_TRAFFIC_LIGHT_X,
            UNAUTHENTICATED_TRAFFIC_LIGHT_Y,
        )
    };

    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let Some(miniaturize) = ns_window.standardWindowButton(NSWindowButton::MiniaturizeButton)
    else {
        return;
    };
    let zoom = ns_window.standardWindowButton(NSWindowButton::ZoomButton);

    let Some(title_bar_view) = close.superview().and_then(|view| view.superview()) else {
        return;
    };
    title_bar_view.layoutSubtreeIfNeeded();
    let close_rect = NSView::frame(&close);
    let title_bar_height = close_rect.size.height + y;
    let mut title_bar_rect = NSView::frame(&title_bar_view);
    if (close_rect.origin.x - x).abs() < 0.25
        && (title_bar_rect.size.height - title_bar_height).abs() < 0.25
    {
        return;
    }
    title_bar_rect.size.height = title_bar_height;
    title_bar_rect.origin.y = ns_window.frame().size.height - title_bar_height;
    title_bar_view.setFrame(title_bar_rect);

    let spacing = NSView::frame(&miniaturize).origin.x - close_rect.origin.x;
    for (index, button) in [Some(close), Some(miniaturize), zoom]
        .into_iter()
        .flatten()
        .enumerate()
    {
        let mut origin = NSView::frame(&button).origin;
        origin.x = x + index as f64 * spacing;
        button.setFrameOrigin(origin);
    }
    ns_window.displayIfNeeded();
}

#[cfg(target_os = "macos")]
fn reconcile_macos_traffic_light_position(app: &AppHandle) {
    use objc2_app_kit::NSWindow;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let app = app.clone();
    let _ = window.with_webview(move |webview| {
        let authenticated = app
            .state::<DesktopState>()
            .authenticated
            .load(Ordering::SeqCst);
        // SAFETY: Tauri provides the live NSWindow on the WebView UI thread.
        unsafe {
            let ns_window = &*webview.ns_window().cast::<NSWindow>();
            apply_macos_traffic_light_position(ns_window, authenticated);
        }
    });
}

#[cfg(target_os = "macos")]
fn show_prepared_macos_window(app: &AppHandle, authenticated: bool) {
    use objc2_app_kit::{NSApplication, NSWindow};

    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(move |webview| {
        // SAFETY: The callback runs on the main thread with the live NSWindow.
        unsafe {
            let ns_window = &*webview.ns_window().cast::<NSWindow>();
            apply_macos_traffic_light_position(ns_window, authenticated);
            ns_window.deminiaturize(None);
            ns_window.makeKeyAndOrderFront(None);
            let main_thread = objc2::MainThreadMarker::new()
                .expect("macOS application activation must run on the main thread");
            #[allow(deprecated)]
            NSApplication::sharedApplication(main_thread).activateIgnoringOtherApps(true);
        }
    });
}

fn configure_desktop_window(app: &AppHandle, authenticated: bool) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let state = app.state::<DesktopState>();
    if let Ok(mut ignore_until) = state.ignore_window_events_until.lock() {
        *ignore_until = Some(Instant::now() + Duration::from_millis(750));
    }
    let _ = window.unmaximize();
    let _ = window.set_resizable(true);

    if authenticated {
        let saved = state
            .bootstrap
            .lock()
            .ok()
            .and_then(|bootstrap| bootstrap.window.clone());
        let monitors = window.available_monitors().unwrap_or_default();
        let primary_monitor = window.primary_monitor().ok().flatten();
        let monitor = saved
            .as_ref()
            .and_then(|saved| choose_restore_monitor(&monitors, saved))
            .or_else(|| {
                primary_monitor.as_ref().and_then(|primary| {
                    monitors
                        .iter()
                        .find(|monitor| monitor.position() == primary.position())
                })
            })
            .or_else(|| monitors.first());
        let target = monitor.map(|monitor| {
            clamp_window_to_monitor(
                saved.as_ref(),
                monitor,
                AUTHENTICATED_WINDOW_WIDTH,
                AUTHENTICATED_WINDOW_HEIGHT,
                AUTHENTICATED_MINIMUM_WIDTH,
                AUTHENTICATED_MINIMUM_HEIGHT,
            )
        });
        let target_width = target
            .as_ref()
            .map(|window| window.width)
            .unwrap_or(AUTHENTICATED_WINDOW_WIDTH);
        let target_height = target
            .as_ref()
            .map(|window| window.height)
            .unwrap_or(AUTHENTICATED_WINDOW_HEIGHT);
        let _ = window.set_min_size(Some(LogicalSize::new(
            AUTHENTICATED_MINIMUM_WIDTH.min(target_width),
            AUTHENTICATED_MINIMUM_HEIGHT.min(target_height),
        )));
        let _ = window.set_size(LogicalSize::new(target_width, target_height));
        if let Some(target) = target.as_ref() {
            let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
            if target.maximized {
                let _ = window.maximize();
            }
        } else {
            let _ = window.center();
        }
    } else {
        let _ = window.set_min_size(None::<LogicalSize<f64>>);
        let monitor = window
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| window.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let target = clamp_window_to_monitor(
                None,
                &monitor,
                UNAUTHENTICATED_WINDOW_WIDTH,
                UNAUTHENTICATED_WINDOW_HEIGHT,
                480.0,
                480.0,
            );
            let _ = window.set_size(LogicalSize::new(target.width, target.height));
            let _ = window.set_position(PhysicalPosition::new(target.x, target.y));
        } else {
            let _ = window.set_size(LogicalSize::new(
                UNAUTHENTICATED_WINDOW_WIDTH,
                UNAUTHENTICATED_WINDOW_HEIGHT,
            ));
            let _ = window.center();
        }
    }
    let _ = window.set_resizable(authenticated);
}

fn capture_authenticated_window_state(window: &Window, state: &DesktopState) {
    if !state.authenticated.load(Ordering::SeqCst) {
        return;
    }
    if state
        .ignore_window_events_until
        .lock()
        .ok()
        .and_then(|until| *until)
        .is_some_and(|until| Instant::now() < until)
    {
        return;
    }
    let maximized = window.is_maximized().unwrap_or(false);
    if let Ok(mut bootstrap) = state.bootstrap.lock() {
        let saved = bootstrap.window.get_or_insert(AuthenticatedWindowState {
            x: 0,
            y: 0,
            width: AUTHENTICATED_WINDOW_WIDTH,
            height: AUTHENTICATED_WINDOW_HEIGHT,
            maximized,
        });
        saved.maximized = maximized;
        if !maximized {
            if let Ok(position) = window.outer_position() {
                saved.x = position.x;
                saved.y = position.y;
            }
            if let (Ok(size), Ok(scale)) = (window.inner_size(), window.scale_factor()) {
                let logical = size.to_logical::<f64>(scale);
                if logical.width.is_finite() && logical.height.is_finite() {
                    saved.width = logical.width;
                    saved.height = logical.height;
                }
            }
        }
    }
    schedule_bootstrap_save(state);
}

#[tauri::command]
fn sync_desktop_bootstrap_state(
    app: AppHandle,
    authenticated: bool,
    theme_preference: DesktopThemePreference,
) {
    let state = app.state::<DesktopState>();
    let authentication_changed =
        state.authenticated.swap(authenticated, Ordering::SeqCst) != authenticated;
    if let Ok(mut bootstrap) = state.bootstrap.lock() {
        bootstrap.last_authenticated = authenticated;
        bootstrap.theme_preference = theme_preference;
    }

    if let Some(window) = app.get_webview_window("main") {
        set_desktop_background(&window, theme_preference);
    }
    if authentication_changed {
        configure_desktop_window(&app, authenticated);
    }
    if !authenticated {
        apply_desktop_unread_count(&app, &state, 0);
    }
    schedule_bootstrap_save(&state);
}

#[tauri::command]
fn start_desktop_window_dragging(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().manage(DesktopState::default());

    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_plugin_notifications::init());

    builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .menu(build_application_menu)
        .on_menu_event(|app, event| {
            handle_application_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            set_close_to_tray,
            sync_desktop_bootstrap_state,
            start_desktop_window_dragging,
            show_desktop_window,
            show_desktop_notification,
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

            #[cfg(debug_assertions)]
            if std::env::var_os("HAPPY_OPEN_DEVTOOLS").is_some() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }

            build_tray(app.handle())?;
            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }

            let bootstrap_path = app
                .path()
                .app_config_dir()
                .map(|directory| directory.join(BOOTSTRAP_CACHE_FILE))?;
            let bootstrap = read_bootstrap_state(&bootstrap_path);
            let authenticated = bootstrap.last_authenticated;
            let theme_preference = bootstrap.theme_preference;
            let state = app.state::<DesktopState>();
            state.authenticated.store(authenticated, Ordering::SeqCst);
            if let Ok(mut path) = state.bootstrap_path.lock() {
                *path = Some(bootstrap_path);
            }
            if let Ok(mut cached) = state.bootstrap.lock() {
                *cached = bootstrap;
            }
            if let Some(window) = app.get_webview_window("main") {
                set_desktop_background(&window, theme_preference);
            }
            configure_desktop_window(app.handle(), authenticated);
            Ok(())
        })
        .on_window_event(|window: &Window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                capture_authenticated_window_state(window, &window.state::<DesktopState>());
            }
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
                if should_start_hidden() {
                    hide_main_window(app);
                } else {
                    #[cfg(target_os = "macos")]
                    {
                        let authenticated = app
                            .state::<DesktopState>()
                            .authenticated
                            .load(Ordering::SeqCst);
                        show_prepared_macos_window(app, authenticated);
                    }
                    #[cfg(not(target_os = "macos"))]
                    show_main_window(app);
                }
            }
            tauri::RunEvent::Exit => persist_bootstrap_state(&app.state::<DesktopState>()),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::MainEventsCleared => reconcile_macos_traffic_light_position(app),
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => show_main_window(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_cache_uses_safe_defaults_for_missing_fields() {
        let state: DesktopBootstrapState = serde_json::from_str(r#"{"version":1}"#).unwrap();
        assert!(!state.last_authenticated);
        assert_eq!(state.theme_preference, DesktopThemePreference::Adaptive);
        assert_eq!(state.window, None);
    }

    #[test]
    fn bootstrap_cache_round_trips_authenticated_window_state() {
        let state = DesktopBootstrapState {
            version: BOOTSTRAP_CACHE_VERSION,
            last_authenticated: true,
            theme_preference: DesktopThemePreference::Dark,
            window: Some(AuthenticatedWindowState {
                x: -1280,
                y: 24,
                width: 1440.0,
                height: 900.0,
                maximized: true,
            }),
        };
        let encoded = serde_json::to_string(&state).unwrap();
        let decoded: DesktopBootstrapState = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, state);
    }

    #[test]
    fn offscreen_rectangles_have_no_intersection() {
        assert_eq!(
            rectangles_intersection_area((3000, 3000, 3800, 3600), (0, 0, 1920, 1080)),
            0
        );
        assert_eq!(
            rectangles_intersection_area((1600, 800, 2200, 1200), (0, 0, 1920, 1080)),
            89_600
        );
    }
}
