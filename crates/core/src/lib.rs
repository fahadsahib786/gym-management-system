//! # danish-core
//!
//! Domain logic and data access for the Danish Fitness gym management system.
//!
//! This crate has no UI or Tauri dependency: the desktop app calls it through thin commands, and a future
//! web server can reuse it unchanged. Every service validates input, enforces permissions, runs in a single
//! SQLite transaction and writes an audit entry.

pub mod attendance;
pub mod audit;
pub mod auth;
pub mod backup;
pub mod billing;
pub mod clock;
pub mod db;
pub mod error;
pub mod expenses;
pub mod export;
pub mod measurements;
pub mod members;
pub mod memberships;
pub mod messages;
pub mod model;
pub mod plans;
pub mod seed;
pub mod settings;
pub mod stats;
pub mod summary;
pub mod system;
pub mod util;

pub use auth::{Actor, Permission};
pub use clock::Clock;
pub use error::{CoreError, CoreResult};
/// Re-exported so hosts (desktop shell, future server) use the exact same SQLite binding.
pub use rusqlite;
