//! Debounced recursive file watching over the vault (ADR D5).
//!
//! Watch events are *triggers only*: this module hands a batch of
//! vault-relative `.md` (and directory) paths to a callback; reconciliation
//! against the index happens in the callback (see vault.rs). Events can be
//! missed by the OS, so the index never trusts event payloads — reconcile
//! compares mtime/size/hash against the DB.

use notify_debouncer_mini::notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, Debouncer, DebounceEventResult};
use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

enum Msg {
    Batch(Vec<String>),
    Stop,
}

/// Owns the OS watcher and its delivery thread. Dropping the guard sends a
/// stop signal, waits for the thread to exit, and stops the OS watcher.
pub struct WatcherGuard {
    _debouncer: Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
    tx: mpsc::Sender<Msg>,
    join: Option<std::thread::JoinHandle<()>>,
}

impl Drop for WatcherGuard {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(h) = self.join.take() {
            let _ = h.join();
        }
    }
}

/// Watch `root` recursively. After each debounce window, `on_batch` receives
/// the deduplicated, sorted set of changed vault-relative paths — `.md` files
/// plus any directories (directories are included so the caller can rescan
/// for files created inside new folders). Dropping the guard stops the watch.
pub fn watch(
    root: &Path,
    debounce_ms: u64,
    on_batch: impl Fn(Vec<String>) + Send + 'static,
) -> Result<WatcherGuard, String> {
    let (tx, rx) = mpsc::channel::<Msg>();
    let guard_tx = tx.clone();
    // Canonicalize so event paths (which arrive canonicalized, e.g.
    // /private/var vs /var on macOS) match the root we strip prefixes from.
    let canonical_root = root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf());
    let root_for_filter = canonical_root.clone();

    let mut debouncer: Debouncer<
        notify_debouncer_mini::notify::RecommendedWatcher,
    > = new_debouncer(
        Duration::from_millis(debounce_ms),
        move |res: DebounceEventResult| {
            let Ok(events) = res else { return };
            let mut paths: Vec<String> = events
                .iter()
                .filter_map(|e| {
                    let rel = e.path.strip_prefix(&root_for_filter).ok()?;
                    if rel.as_os_str().is_empty() {
                        return None; // event on the root itself
                    }
                    let is_md = rel.extension().map(|x| x == "md").unwrap_or(false);
                    if is_md || e.path.is_dir() {
                        Some(rel.to_string_lossy().into_owned())
                    } else {
                        None
                    }
                })
                .collect();
            paths.sort();
            paths.dedup();
            if !paths.is_empty() {
                let _ = tx.send(Msg::Batch(paths));
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&canonical_root, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let join = std::thread::spawn(move || {
        while let Ok(msg) = rx.recv() {
            match msg {
                Msg::Batch(paths) => on_batch(paths),
                Msg::Stop => break,
            }
        }
    });

    Ok(WatcherGuard {
        _debouncer: debouncer,
        tx: guard_tx,
        join: Some(join),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn reports_new_markdown_files_and_ignores_others() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::write(root.join("a.md"), "# A").unwrap();

        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_handle = seen.clone();
        let guard = watch(&root, 100, move |paths| {
            seen_handle.lock().unwrap().extend(paths);
        })
        .unwrap();

        std::fs::write(root.join("b.md"), "# B").unwrap();
        std::fs::write(root.join("b.md.txt"), "not markdown").unwrap();
        std::thread::sleep(Duration::from_millis(2000));

        let seen = seen.lock().unwrap();
        assert!(
            seen.iter().any(|p| p == "b.md"),
            "expected b.md in {seen:?}"
        );
        assert!(
            !seen.iter().any(|p| p.ends_with("b.md.txt")),
            "non-md files must be excluded: {seen:?}"
        );
        drop(guard);
    }

    #[test]
    fn reports_new_files_inside_new_subdirectories() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        let seen: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen_handle = seen.clone();
        let _guard = watch(&root, 100, move |paths| {
            seen_handle.lock().unwrap().extend(paths);
        })
        .unwrap();

        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::thread::sleep(Duration::from_millis(1000));
        std::fs::write(root.join("sub/inside.md"), "# inside").unwrap();
        std::thread::sleep(Duration::from_millis(2000));

        let seen = seen.lock().unwrap();
        assert!(
            seen.iter().any(|p| p == "sub/inside.md"),
            "expected sub/inside.md in {seen:?}"
        );
    }
}