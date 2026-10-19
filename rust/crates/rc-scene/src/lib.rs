//! Page content and the GPU scene built from it.
//!
//! - [`content`]: a page's content in paint order and page space, as the extractors produce it.
//! - [`wire`]: a flat encoding of that content for passing between processes.
//! - [`scene`]: the compact, cell-indexed, pre-clipped scene the GPU draws, and its builder.

pub mod clip;
pub mod content;
pub mod scene;
pub mod wire;

pub use content::{Affine, PageContent};
pub use scene::{Scene, SceneOptions, build_scene};
