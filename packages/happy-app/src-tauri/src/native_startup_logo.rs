use super::AppHandle;
use std::sync::atomic::{AtomicBool, Ordering};

static DISMISSED: AtomicBool = AtomicBool::new(false);

pub(super) fn is_pending() -> bool {
    !DISMISSED.load(Ordering::SeqCst)
}

#[cfg(target_os = "macos")]
pub(super) unsafe fn install_macos(window: &objc2_app_kit::NSWindow, dark: bool) {
    macos::install(window, dark);
}

#[cfg(target_os = "windows")]
pub(super) fn install_windows(window: &tauri::WebviewWindow, dark: bool) {
    windows::install(window, dark);
}

pub(super) fn dismiss(app: &AppHandle) {
    DISMISSED.store(true, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    macos::dismiss(app);

    #[cfg(target_os = "windows")]
    windows::dismiss(app);
}

#[cfg(target_os = "windows")]
pub(super) fn resize_windows(window: &tauri::Window) {
    windows::resize(window);
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{is_pending, AppHandle};
    use crate::{DARK_BACKGROUND_RGB, LIGHT_BACKGROUND_RGB};
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSAnimatablePropertyContainer, NSAnimationContext, NSAutoresizingMaskOptions, NSColor,
        NSImage, NSImageScaling, NSImageView, NSRectFill, NSWindow,
    };
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize};
    use std::{thread, time::Duration};
    use tauri::Manager;

    const TAG: isize = 0x484E_4C47;
    const FADE_DURATION: Duration = Duration::from_millis(180);

    /// Adds one native image view without changing the NSWindow frame or content view.
    pub(super) unsafe fn install(window: &NSWindow, dark: bool) {
        if !is_pending() {
            return;
        }
        let main_thread = MainThreadMarker::new()
            .expect("native startup logo must be installed on the AppKit thread");
        let Some(content_view) = window.contentView() else {
            return;
        };
        if content_view.viewWithTag(TAG).is_some() {
            return;
        }

        let bounds = content_view.bounds();
        if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
            return;
        }

        let image = NSImage::initWithSize(NSImage::alloc(), bounds.size);
        #[allow(deprecated)]
        image.lockFocus();

        let (red, green, blue) = if dark {
            DARK_BACKGROUND_RGB
        } else {
            LIGHT_BACKGROUND_RGB
        };
        let background = NSColor::colorWithSRGBRed_green_blue_alpha(
            f64::from(red) / 255.0,
            f64::from(green) / 255.0,
            f64::from(blue) / 255.0,
            1.0,
        );
        background.setFill();
        NSRectFill(NSRect::new(NSPoint::new(0.0, 0.0), bounds.size));

        let logo_bytes: &[u8] = if dark {
            include_bytes!("../../sources/assets/images/logo-white.png")
        } else {
            include_bytes!("../../sources/assets/images/logo-black.png")
        };
        let logo_data = NSData::dataWithBytes_length(logo_bytes.as_ptr().cast(), logo_bytes.len());
        if let Some(logo) = NSImage::initWithData(NSImage::alloc(), &logo_data) {
            let logo_size = 48.0;
            logo.drawInRect(NSRect::new(
                NSPoint::new(
                    (bounds.size.width - logo_size) / 2.0,
                    (bounds.size.height - logo_size) / 2.0,
                ),
                NSSize::new(logo_size, logo_size),
            ));
        }

        #[allow(deprecated)]
        image.unlockFocus();

        let overlay = NSImageView::imageViewWithImage(&image, main_thread);
        overlay.setFrame(bounds);
        overlay.setImageScaling(NSImageScaling::ScaleAxesIndependently);
        overlay.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        overlay.setTag(TAG);
        content_view.addSubview(&overlay);
    }

    pub(super) fn dismiss(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let scheduler = app.clone();
        let callback_app = app.clone();
        let _ = window.with_webview(move |webview| {
            // SAFETY: Tauri supplies the live NSWindow on the AppKit thread.
            unsafe {
                let ns_window = &*webview.ns_window().cast::<NSWindow>();
                let Some(content_view) = ns_window.contentView() else {
                    return;
                };
                let Some(overlay) = content_view.viewWithTag(TAG) else {
                    return;
                };

                NSAnimationContext::beginGrouping();
                let animation = NSAnimationContext::currentContext();
                animation.setDuration(FADE_DURATION.as_secs_f64());
                overlay.animator().setAlphaValue(0.0);
                NSAnimationContext::endGrouping();

                thread::spawn(move || {
                    thread::sleep(FADE_DURATION);
                    let _ = scheduler.run_on_main_thread(move || remove(&callback_app));
                });
            }
        });
    }

    fn remove(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(|webview| {
            // SAFETY: Tauri supplies the live NSWindow on the AppKit thread.
            unsafe {
                let ns_window = &*webview.ns_window().cast::<NSWindow>();
                let Some(content_view) = ns_window.contentView() else {
                    return;
                };
                let Some(overlay) = content_view.viewWithTag(TAG) else {
                    return;
                };
                overlay.removeFromSuperview();
                content_view.setNeedsDisplay(true);
                content_view.displayIfNeeded();
            }
        });
    }
}

#[cfg(target_os = "windows")]
mod windows {
    use super::{is_pending, AppHandle};
    use crate::{DARK_BACKGROUND_RGB, LIGHT_BACKGROUND_RGB};
    use std::{
        mem::{size_of, zeroed},
        ptr,
        sync::{Mutex, OnceLock},
        thread,
        time::Duration,
    };
    use tauri::Manager;
    use windows_sys::Win32::{
        Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{
            BeginPaint, CreateSolidBrush, DeleteObject, EndPaint, FillRect, InvalidateRect,
            SetDIBitsToDevice, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, PAINTSTRUCT,
        },
        System::LibraryLoader::GetModuleHandleW,
        UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, FindWindowExW, GetClientRect,
            RegisterClassW, SetLayeredWindowAttributes, SetWindowPos, HWND_TOP, LWA_ALPHA,
            SWP_NOACTIVATE, SWP_SHOWWINDOW, WM_ERASEBKGND, WM_PAINT, WNDCLASSW, WS_CHILD,
            WS_CLIPSIBLINGS, WS_EX_LAYERED, WS_VISIBLE,
        },
    };

    const LOGO_SIZE: usize = 48;
    const FADE_STEPS: u8 = 9;
    const FADE_STEP_DURATION: Duration = Duration::from_millis(20);
    const CLASS_NAME: &[u16] = &[
        'H' as u16, 'a' as u16, 'p' as u16, 'p' as u16, 'y' as u16, 'N' as u16, 'a' as u16,
        't' as u16, 'i' as u16, 'v' as u16, 'e' as u16, 'L' as u16, 'o' as u16, 'g' as u16,
        'o' as u16, 0,
    ];

    struct PaintData {
        background: (u8, u8, u8),
        logo_bgra: Vec<u8>,
    }

    static REGISTERED_CLASS: OnceLock<()> = OnceLock::new();
    static PAINT_DATA: OnceLock<Mutex<Option<PaintData>>> = OnceLock::new();

    pub(super) fn install(window: &tauri::WebviewWindow, dark: bool) {
        if !is_pending() {
            return;
        }
        let Ok(parent) = window.hwnd() else {
            return;
        };
        let parent = parent.0 as HWND;
        if !find(parent).is_null() {
            return;
        }

        let background = if dark {
            DARK_BACKGROUND_RGB
        } else {
            LIGHT_BACKGROUND_RGB
        };
        let logo_bytes: &[u8] = if dark {
            include_bytes!("../../sources/assets/images/logo-white.png")
        } else {
            include_bytes!("../../sources/assets/images/logo-black.png")
        };
        let Ok(logo) = tauri::image::Image::from_bytes(logo_bytes) else {
            return;
        };
        *PAINT_DATA
            .get_or_init(|| Mutex::new(None))
            .lock()
            .expect("Windows native logo paint data mutex poisoned") = Some(PaintData {
            background,
            logo_bgra: compose_logo(&logo, background),
        });

        // SAFETY: These calls use the live Tauri HWND on its window thread.
        unsafe {
            register_class();
            let mut client: RECT = zeroed();
            if GetClientRect(parent, &mut client) == 0 {
                return;
            }
            let overlay = CreateWindowExW(
                WS_EX_LAYERED,
                CLASS_NAME.as_ptr(),
                ptr::null(),
                WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
                0,
                0,
                client.right - client.left,
                client.bottom - client.top,
                parent,
                ptr::null_mut(),
                GetModuleHandleW(ptr::null()),
                ptr::null(),
            );
            if !overlay.is_null() {
                SetLayeredWindowAttributes(overlay, 0, 255, LWA_ALPHA);
                SetWindowPos(
                    overlay,
                    HWND_TOP,
                    0,
                    0,
                    client.right - client.left,
                    client.bottom - client.top,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    }

    pub(super) fn dismiss(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(parent) = window.hwnd() else {
            return;
        };
        let overlay = find(parent.0 as HWND);
        if overlay.is_null() {
            return;
        }

        let overlay_address = overlay as usize;
        let scheduler = app.clone();
        let callback_app = app.clone();
        thread::spawn(move || {
            for step in 1..=FADE_STEPS {
                thread::sleep(FADE_STEP_DURATION);
                let alpha = 255_u16.saturating_sub(255 * u16::from(step) / u16::from(FADE_STEPS));
                // SAFETY: The overlay remains alive until the final UI-thread removal below.
                unsafe {
                    SetLayeredWindowAttributes(overlay_address as HWND, 0, alpha as u8, LWA_ALPHA);
                }
            }
            let _ = scheduler.run_on_main_thread(move || remove(&callback_app));
        });
    }

    pub(super) fn resize(window: &tauri::Window) {
        let Ok(parent) = window.hwnd() else {
            return;
        };
        let parent = parent.0 as HWND;
        let overlay = find(parent);
        if overlay.is_null() {
            return;
        }
        // SAFETY: The handles are live and owned by this process.
        unsafe {
            let mut client: RECT = zeroed();
            if GetClientRect(parent, &mut client) != 0 {
                SetWindowPos(
                    overlay,
                    HWND_TOP,
                    0,
                    0,
                    client.right - client.left,
                    client.bottom - client.top,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
                InvalidateRect(overlay, ptr::null(), 0);
            }
        }
    }

    fn remove(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let Ok(parent) = window.hwnd() else {
            return;
        };
        let overlay = find(parent.0 as HWND);
        if !overlay.is_null() {
            // SAFETY: The overlay HWND was created by this module on the UI thread.
            unsafe { DestroyWindow(overlay) };
        }
    }

    fn find(parent: HWND) -> HWND {
        // SAFETY: Read-only child-window lookup under a valid parent HWND.
        unsafe { FindWindowExW(parent, ptr::null_mut(), CLASS_NAME.as_ptr(), ptr::null()) }
    }

    unsafe fn register_class() {
        REGISTERED_CLASS.get_or_init(|| {
            let class = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: unsafe { GetModuleHandleW(ptr::null()) },
                lpszClassName: CLASS_NAME.as_ptr(),
                ..unsafe { zeroed() }
            };
            unsafe { RegisterClassW(&class) };
        });
    }

    unsafe extern "system" fn window_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        match message {
            WM_ERASEBKGND => 1,
            WM_PAINT => {
                unsafe { paint(hwnd) };
                0
            }
            _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
        }
    }

    unsafe fn paint(hwnd: HWND) {
        let mut paint: PAINTSTRUCT = unsafe { zeroed() };
        let hdc = unsafe { BeginPaint(hwnd, &mut paint) };
        let Some(data) = PAINT_DATA
            .get_or_init(|| Mutex::new(None))
            .lock()
            .ok()
            .and_then(|data| {
                data.as_ref()
                    .map(|data| (data.background, data.logo_bgra.clone()))
            })
        else {
            unsafe { EndPaint(hwnd, &paint) };
            return;
        };

        let mut client: RECT = unsafe { zeroed() };
        unsafe { GetClientRect(hwnd, &mut client) };
        let brush = unsafe { CreateSolidBrush(colorref(data.0)) };
        unsafe {
            FillRect(hdc, &client, brush);
            DeleteObject(brush);
        }

        let bitmap = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: LOGO_SIZE as i32,
                biHeight: -(LOGO_SIZE as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                ..unsafe { zeroed() }
            },
            ..unsafe { zeroed() }
        };
        let x = ((client.right - client.left) - LOGO_SIZE as i32) / 2;
        let y = ((client.bottom - client.top) - LOGO_SIZE as i32) / 2;
        unsafe {
            SetDIBitsToDevice(
                hdc,
                x,
                y,
                LOGO_SIZE as u32,
                LOGO_SIZE as u32,
                0,
                0,
                0,
                LOGO_SIZE as u32,
                data.1.as_ptr().cast(),
                &bitmap,
                DIB_RGB_COLORS,
            );
            EndPaint(hwnd, &paint);
        }
    }

    fn compose_logo(image: &tauri::image::Image<'_>, background: (u8, u8, u8)) -> Vec<u8> {
        let source = image.rgba();
        let width = image.width().max(1) as usize;
        let height = image.height().max(1) as usize;
        let mut output = vec![0_u8; LOGO_SIZE * LOGO_SIZE * 4];
        for y in 0..LOGO_SIZE {
            for x in 0..LOGO_SIZE {
                let source_x = x * width / LOGO_SIZE;
                let source_y = y * height / LOGO_SIZE;
                let source_index = (source_y * width + source_x) * 4;
                let target_index = (y * LOGO_SIZE + x) * 4;
                let alpha = u16::from(source[source_index + 3]);
                let blend = |foreground: u8, backdrop: u8| {
                    ((u16::from(foreground) * alpha + u16::from(backdrop) * (255 - alpha) + 127)
                        / 255) as u8
                };
                output[target_index] = blend(source[source_index + 2], background.2);
                output[target_index + 1] = blend(source[source_index + 1], background.1);
                output[target_index + 2] = blend(source[source_index], background.0);
                output[target_index + 3] = 255;
            }
        }
        output
    }

    fn colorref((red, green, blue): (u8, u8, u8)) -> COLORREF {
        u32::from(red) | (u32::from(green) << 8) | (u32::from(blue) << 16)
    }
}
