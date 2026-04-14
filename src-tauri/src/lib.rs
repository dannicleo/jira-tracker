mod commands;

use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

/// Estado do timer de sync em background.
struct SyncTimerState {
    join_handle: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl SyncTimerState {
    fn new() -> Self {
        Self { join_handle: None }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Mutex::new(SyncTimerState::new()))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // macOS: esconde o ícone no Dock — o app vive apenas na barra de menu
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let hide_item = MenuItemBuilder::new("Ocultar").id("hide").build(app)?;
            let show_item = MenuItemBuilder::new("Mostrar").id("show").build(app)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItemBuilder::new("Sair").id("quit").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&hide_item)
                .item(&separator)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .tooltip("Jira Tracker")
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show"  => show_window(app),
                    "hide"  => hide_window(app),
                    "quit"  => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // A janela já inicia visível (visible: true no tauri.conf.json).
            // Aqui só reposicionamos e garantimos alwaysOnTop após o event loop
            // estar rodando — o delay evita que current_monitor() retorne None.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                if let Some(window) = app_handle.get_webview_window("main") {
                    let win = window.clone();
                    let _ = window.run_on_main_thread(move || {
                        let _ = win.set_always_on_top(true);
                        #[cfg(target_os = "macos")]
                        {
                            // Define NSWindowCollectionBehavior diretamente para garantir
                            // que a janela apareça em todos os Spaces SEM sumir ao trocar.
                            // canJoinAllSpaces (1) | stationary (16) — sem o flag transient (8)
                            // que o macOS adiciona automaticamente em janelas floating.
                            configure_window_spaces(&win);
                            position_window_near_tray(&win);
                        }
                    });
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::jira::fetch_jira_issue,
            commands::jira::fetch_jira_issues_bulk,
            commands::jira::validate_jira_credentials,
            commands::jira::fetch_jira_projects,
            set_window_bounds,
            start_background_sync,
            stop_background_sync,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o Jira Tracker");
}

/// Define tamanho + posição num único round-trip IPC.
#[tauri::command]
fn set_window_bounds(window: tauri::WebviewWindow, x: f64, y: f64, width: f64, height: f64) {
    use tauri::{LogicalPosition, LogicalSize};
    let _ = window.set_size(LogicalSize::new(width, height));
    let _ = window.set_position(LogicalPosition::new(x, y));
}

/// Clique esquerdo no ícone: alterna visibilidade da janela.
/// - Visível → oculta
/// - Oculta  → mostra (e reposiciona se necessário)
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            hide_window(app);
        } else {
            show_window(app);
        }
    }
}

/// Exibe a janela.
///
/// Se já estiver visível, apenas traz ao primeiro plano sem mover
/// (preserva posição arrastada pelo usuário).
/// Se estiver oculta, reposiciona no canto superior direito antes de mostrar.
// Chamado sempre a partir de callbacks de tray (já na main thread)
fn show_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let already_visible = window.is_visible().unwrap_or(false);
        if !already_visible {
            #[cfg(target_os = "macos")]
            position_window_near_tray(&window);
        }
        let _ = window.set_always_on_top(true);
        // Garante que a janela apareça em todos os Spaces sem sumir ao trocar
        #[cfg(target_os = "macos")]
        configure_window_spaces(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn start_background_sync(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<SyncTimerState>>,
    interval_secs: u64,
) {
    let mut s = state.lock().unwrap();
    if let Some(handle) = s.join_handle.take() {
        handle.abort();
    }
    let handle = tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
        loop {
            let _ = app.emit("background-sync-tick", ());
            tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
        }
    });
    s.join_handle = Some(handle);
}

#[tauri::command]
fn stop_background_sync(state: tauri::State<'_, Mutex<SyncTimerState>>) {
    let mut s = state.lock().unwrap();
    if let Some(handle) = s.join_handle.take() {
        handle.abort();
    }
}

/// Largura da sidebar (sem painel aberto).
const WINDOW_WIDTH: f64 = 72.0;

/// Define o NSWindowCollectionBehavior correto para uma janela de tray:
/// - `canJoinAllSpaces` (1) → aparece em todos os Spaces (mesas)
/// - `stationary`      (16) → não some ao trocar de Space
///
/// `set_always_on_top` define o nível como NSFloatingWindowLevel, que o macOS
/// trata como "transient" (8) por padrão, fazendo a janela desaparecer ao
/// trocar de mesa. Definir o behavior diretamente sobrescreve esse comportamento.
#[cfg(target_os = "macos")]
fn configure_window_spaces(window: &tauri::WebviewWindow) {
    use objc::{msg_send, sel, sel_impl};
    use objc::runtime::Object;

    if let Ok(ptr) = window.ns_window() {
        let ns_window = ptr as *mut Object;
        unsafe {
            // NSWindowCollectionBehaviorCanJoinAllSpaces = 1
            // NSWindowCollectionBehaviorStationary       = 16
            let behavior: usize = 1 | 16;
            let _: () = msg_send![ns_window, setCollectionBehavior: behavior];
        }
    }
}

/// Posiciona a janela no canto superior direito da tela, abaixo da barra de menu.
///
/// Usa `current_monitor()` se disponível (janela já visível), senão tenta
/// `available_monitors()` — necessário no startup quando a janela ainda está oculta
/// e não tem um monitor associado.
#[cfg(target_os = "macos")]
fn position_window_near_tray(window: &tauri::WebviewWindow) {
    use tauri::{LogicalPosition, LogicalSize};

    // current_monitor() retorna None quando a janela está oculta — usa fallback
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            window
                .available_monitors()
                .ok()?
                .into_iter()
                .next()
        });

    if let Some(monitor) = monitor {
        let screen = monitor.size();
        let scale  = monitor.scale_factor();

        let screen_w = screen.width  as f64 / scale;
        let screen_h = screen.height as f64 / scale;

        let menu_bar_h: f64  = 28.0;
        let right_margin: f64 = 10.0;
        let dock_margin: f64  = 80.0;

        let h = screen_h - menu_bar_h - dock_margin;
        let x = screen_w - WINDOW_WIDTH - right_margin;
        let y = menu_bar_h;

        let _ = window.set_size(LogicalSize::new(WINDOW_WIDTH, h));
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
}
