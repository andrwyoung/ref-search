#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent};
use tauri_plugin_dialog;

struct ServerProc(Arc<Mutex<Option<Child>>>);

fn start_backend(app: &tauri::AppHandle) {
  // pick python
  let python = std::env::var("REFSEARCH_PYTHON").unwrap_or_else(|_| "python3".to_string());

  // project root: go up from src-tauri/
  let mut project_root = std::env::current_dir().unwrap();
  if project_root.ends_with("src-tauri") {
    project_root.pop();
  }

  // optional: per-app data dir for the store
  let store_dir = app
    .path()
    .app_data_dir()
    .map(|p| { std::fs::create_dir_all(&p).ok(); p })
    .unwrap_or(project_root.clone());

  // spawn uvicorn
  let mut cmd = Command::new(python);
  cmd.current_dir(&project_root)
     .arg("-m").arg("uvicorn")
     .arg("core.server:app")
     .arg("--host").arg("127.0.0.1")
     .arg("--port").arg("5179")
     .arg("--no-access-log")
     .env("REFSEARCH_STORE", store_dir.to_string_lossy().to_string())
     .stdout(Stdio::null())
     .stderr(Stdio::null());

  let child = cmd.spawn().expect("failed to start FastAPI backend");
  app.state::<ServerProc>().0.lock().unwrap().replace(child);
}

fn stop_backend(app: &tauri::AppHandle) {
  if let Some(mut child) = app.state::<ServerProc>().0.lock().unwrap().take() {
    let _ = child.kill();
    let _ = child.wait();
  }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(ServerProc(Arc::new(Mutex::new(None))))
    .setup(|app| {
      start_backend(&app.handle());
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri app")
    .run(|app_handle, event| {
      if let RunEvent::ExitRequested { .. } = event {
        stop_backend(app_handle);
      }
    });
}