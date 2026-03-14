# Desktop Setup

This project now includes a Tauri desktop shell in `src-tauri/`.

What is already wired:

- `npm run tauri dev` is configured as the desktop entrypoint.
- The frontend build output is mapped to `../dist`.
- A minimal Rust command, `get_shell_info`, is exposed so the React app can detect the native shell.
- Default capabilities are declared for the `main` window.

What is still needed on this machine before the desktop shell can run:

1. Install Rust with `rustup`.
2. Restart the terminal so `cargo` and `rustc` are available.
3. Run `npm install` to ensure the Tauri JS packages are present.
4. Run `npm run desktop:dev`.

For a simpler launch command, use:

```bash
/Users/rohanagarwal/Documents/Playground/run-staff-app.sh
```

Good next implementation steps:

1. Add the Tauri dialog plugin for native folder selection.
2. Add Rust commands for writing exports directly to disk.
3. Persist batch history and review decisions locally.
