#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;

#[derive(Serialize)]
struct ShellInfo {
  platform: &'static str,
  shell: &'static str,
  storage_mode: &'static str,
}

#[tauri::command]
fn get_shell_info() -> ShellInfo {
  ShellInfo {
    platform: std::env::consts::OS,
    shell: "tauri-desktop",
    storage_mode: "native-filesystem",
  }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![get_shell_info])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
