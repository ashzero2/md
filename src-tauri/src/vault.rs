//! App-wide state: the open vault root and the SQLite index connection.
//! The DB lives in app-data (never inside the vault) — see ADR D2.

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct VaultState {
    pub root: Mutex<Option<PathBuf>>,
    pub conn: Mutex<Connection>,
    pub db_path: PathBuf,
}

impl VaultState {
    pub fn open(db_path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
        crate::db::init_schema(&conn).map_err(|e| e.to_string())?;
        Ok(VaultState {
            root: Mutex::new(None),
            conn: Mutex::new(conn),
            db_path,
        })
    }
}