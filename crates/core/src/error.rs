//! Error type shared by all services. Serialises to `{ kind, message, field }` for the UI.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    /// Bad input from the user. `field` names the form field when known (camelCase).
    #[error("{message}")]
    Validation { field: Option<String>, message: String },
    #[error("{0} was not found. It may have been removed.")]
    NotFound(String),
    /// The action conflicts with existing data (duplicate code, overlapping period, ...).
    #[error("{0}")]
    Conflict(String),
    #[error("You don't have permission to do this. Ask the owner/admin.")]
    Forbidden,
    #[error("Your session has ended. Please log in again.")]
    Unauthenticated,
    #[error("Database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("Database is busy: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Data error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Other(String),
}

pub type CoreResult<T> = Result<T, CoreError>;

impl CoreError {
    pub fn validation(field: &str, message: impl Into<String>) -> Self {
        CoreError::Validation { field: Some(field.to_string()), message: message.into() }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        CoreError::Validation { field: None, message: message.into() }
    }

    pub fn not_found(what: &str) -> Self {
        CoreError::NotFound(what.to_string())
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        CoreError::Conflict(message.into())
    }

    pub fn other(message: impl Into<String>) -> Self {
        CoreError::Other(message.into())
    }

    pub fn kind(&self) -> &'static str {
        match self {
            CoreError::Validation { .. } => "validation",
            CoreError::NotFound(_) => "notFound",
            CoreError::Conflict(_) => "conflict",
            CoreError::Forbidden => "forbidden",
            CoreError::Unauthenticated => "unauthenticated",
            CoreError::Db(_) | CoreError::Pool(_) => "database",
            CoreError::Io(_) => "io",
            CoreError::Json(_) => "data",
            CoreError::Other(_) => "other",
        }
    }

    fn field(&self) -> Option<&str> {
        match self {
            CoreError::Validation { field, .. } => field.as_deref(),
            _ => None,
        }
    }
}

impl Serialize for CoreError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("CoreError", 3)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.serialize_field("field", &self.field())?;
        s.end()
    }
}

/// Converts a `Result<_, String>` from a normaliser into a field validation error.
pub trait FieldResult<T> {
    fn field(self, field: &str) -> CoreResult<T>;
}

impl<T> FieldResult<T> for Result<T, String> {
    fn field(self, field: &str) -> CoreResult<T> {
        self.map_err(|m| CoreError::validation(field, m))
    }
}
