// PDFView desktop wrapper: hands files opened from Windows (double-click, "Open with") to the page,
// and offers a native Save dialog. The page itself is the offline build of the app.
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

struct Pending(Mutex<Vec<String>>);

fn file_args<I: Iterator<Item = String>>(args: I) -> Vec<String> {
    args.skip(1)
        .filter(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
        .collect()
}

/// Files given on the command line when the app started; the page asks for them once it is ready.
#[tauri::command]
fn pending_files(state: State<Pending>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[tauri::command]
fn read_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// The page sends the PDF bytes as the raw request body and the suggested name in a header.
#[tauri::command]
fn save_file(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    let name = request
        .headers()
        .get("x-filename")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("document.pdf")
        .to_string();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        _ => return Err("expected binary body".into()),
    };
    let Some(picked) = app
        .dialog()
        .file()
        .set_file_name(&name)
        .add_filter("PDF document", &["pdf"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = picked
        .as_path()
        .ok_or("unsupported location")?
        .to_path_buf();
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (double-clicking another PDF) is routed to the running window.
            let files = file_args(argv.into_iter());
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
            if !files.is_empty() {
                let _ = app.emit("open-files", files);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending(Mutex::new(file_args(std::env::args()))))
        .invoke_handler(tauri::generate_handler![
            pending_files,
            read_file,
            save_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running PDFView");
}
