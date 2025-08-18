#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri::Emitter;   
use tauri_plugin_dialog;
use tauri_plugin_shell;

struct ServerProc(Arc<Mutex<Option<Child>>>);

fn backend_is_up(port: u16) -> bool {
  let url = format!("http://127.0.0.1:{}/ready", port);
  let res = ureq::get(&url).timeout(std::time::Duration::from_millis(400)).call();
  res.ok().map(|r| r.status() == 200).unwrap_or(false)
}


fn start_backend(app: &tauri::AppHandle) {
  use std::io::{BufRead, BufReader};

  // check if it's already open
  let port: u16 = 54999;
  if backend_is_up(port) {
    println!("[PYTHON] backend already running on :{port}, not spawning another.");
    return;
  }

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
    .map(|p| {
      std::fs::create_dir_all(&p).ok();
      p
    })
    .unwrap_or(project_root.clone());

  // spawn uvicorn
  let mut cmd = Command::new(python);
  cmd.current_dir(&project_root)
    .arg("-m").arg("uvicorn")
    .arg("core.server:app")
    .arg("--host").arg("127.0.0.1")
    .arg("--port").arg("54999")
    .arg("--no-access-log")
    .env("REFSEARCH_STORE", store_dir.to_string_lossy().to_string());

  #[cfg(debug_assertions)]
  {
    // dev mode: show stdout, capture stderr
    cmd.stdout(Stdio::inherit())
       .stderr(Stdio::piped());
  }

  #[cfg(not(debug_assertions))]
  {
    // prod: silence stdout, but still capture stderr for logging
    cmd.stdout(Stdio::null())
       .stderr(Stdio::piped());
  }

  let mut child = cmd.spawn().expect("failed to start FastAPI backend");

  // capture stderr and emit to frontend
  if let Some(stderr) = child.stderr.take() {
    let app_handle = app.clone();
    std::thread::spawn(move || {
      let reader = BufReader::new(stderr);
      for line in reader.lines() {
        if let Ok(line) = line {
          println!("[PYTHON] {line}");
          let _ = app_handle.emit("backend-log", line);
        }
      }
    });
  }

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
    .plugin(tauri_plugin_shell::init()) 
    .manage(ServerProc(Arc::new(Mutex::new(None))))
    .setup(|app| {
      start_backend(&app.handle());
      Ok(())
    })
    .on_window_event(|app, event| {
      if let WindowEvent::CloseRequested { .. } = event {
        // Closing the last window: kill the sidecar
        stop_backend(&app.app_handle());
      }
    })
    .build(tauri::generate_context!())
    .expect("error while running tauri app")
    .run(|app_handle, event| {
      match event {
        RunEvent::ExitRequested { .. } |
        RunEvent::Exit |
        RunEvent::WindowEvent { event: WindowEvent::Destroyed, .. } => {
          stop_backend(app_handle);
        }
        _ => {}
      }
    });
}