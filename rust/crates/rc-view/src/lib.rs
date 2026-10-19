//! The document view: layout and camera, page loading (the disk cache, our parser, PDFium),
//! tiles drawn by the GPU from page scenes or by PDFium, scheduling and prefetch, and the
//! fidelity check that decides whether a page's scene can be trusted.

pub mod layout;
pub mod tiles;
