export function isTauriDesktop() {
  return Boolean(window.__TAURI_INTERNALS__);
}

export async function getDesktopShellInfo() {
  if (!isTauriDesktop()) {
    return {
      platform: "browser",
      shell: "web-preview",
      storageMode: "downloads",
    };
  }

  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke("get_shell_info");
}
