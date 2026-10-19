//! Our own PDF reader for heavy drawings: the file's structure, objects and filters, and a
//! content stream interpreter that writes page content (`rc_scene::PageContent`) directly.
//!
//! It handles what engineering drawings use: paths, clipping, graphics state, device colours,
//! forms, images, text in embedded TrueType and OpenType fonts and Type 3 fonts, optional content
//! and transparency by constant alpha. Anything else is flagged in the content
//! (`rc_scene::content::flags`), and the app then uses PDFium for that page. Every page is still
//! checked against PDFium before the scene is trusted.

pub mod color;
pub mod content;
pub mod document;
pub mod filter;
pub mod font;
pub mod image;
pub mod object;

pub use content::{Options, extract_page};
pub use document::Document;
use rc_scene::PageContent;

/// A page's content, whole.
pub fn page_content(doc: &Document, index: usize, opts: &Options) -> Option<PageContent> {
    let page = doc.page(index)?;
    let opts = Options { chunk_items: 0, ..opts.clone() };
    Some(extract_page(doc, page, &opts, &mut |_| {}))
}

/// A page's content in chunks of about `chunk_items` items, each passed to `on_chunk` as soon
/// as it is read (the last one included).
pub fn page_content_chunked(doc: &Document, index: usize, chunk_items: usize, opts: &Options, on_chunk: &mut dyn FnMut(PageContent)) -> bool {
    let Some(page) = doc.page(index) else { return false };
    let opts = Options { chunk_items: chunk_items.max(1), ..opts.clone() };
    let last = extract_page(doc, page, &opts, on_chunk);
    on_chunk(last);
    true
}

/// Page sizes in points, rotation applied.
pub fn page_sizes(doc: &Document) -> Vec<[f32; 2]> {
    (0..doc.page_count())
        .filter_map(|i| doc.page(i))
        .map(|p| {
            let [x0, y0, x1, y1] = p.crop_box;
            let (w, h) = ((x1 - x0) as f32, (y1 - y0) as f32);
            if p.rotate % 180 == 0 { [w, h] } else { [h, w] }
        })
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not supported: {0}")]
    Unsupported(String),
    #[error("damaged file: {0}")]
    Damaged(String),
}
