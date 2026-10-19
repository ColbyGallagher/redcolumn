//! Tokenising large content in parallel must read it exactly as reading it in order does.

use rc_bench::drawing::{GenOptions, generate};

#[test]
fn parallel_matches_sequential() {
    let pdf = generate(&GenOptions { segments: 400_000, ..Default::default() });
    let doc = rc_parse::Document::open(&pdf).unwrap();
    let par = rc_parse::page_content(&doc, 0, &Default::default()).unwrap();
    let seq = rc_parse::page_content(&doc, 0, &rc_parse::Options { parallel: false, ..Default::default() }).unwrap();
    assert_eq!(par.items.len(), seq.items.len());
    if let Some(i) = par.verbs.iter().zip(&seq.verbs).position(|(a, b)| a != b) {
        panic!("verbs differ at {i} of {}/{}: par {:?} seq {:?}", par.verbs.len(), seq.verbs.len(), &par.verbs[i.saturating_sub(4)..i + 4], &seq.verbs[i.saturating_sub(4)..i + 4]);
    }
    assert_eq!(par.verbs.len(), seq.verbs.len(), "verb counts");
    if let Some(i) = par.points.iter().zip(&seq.points).position(|(a, b)| a != b) {
        panic!("points differ at {i}: par {:?} seq {:?}", &par.points[i.saturating_sub(2)..i + 2], &seq.points[i.saturating_sub(2)..i + 2]);
    }
    assert!(par == seq, "contents differ elsewhere");
}

/// Strings, arrays and inline images that cross chunk boundaries, with tiny chunks.
#[test]
fn tokens_across_chunk_boundaries() {
    let mut content = String::new();
    for i in 0..400 {
        content.push_str(&format!("q 1 0 0 1 {i} 0 cm [3 (a long string with spaces and (nested) parens {i}) 2] pop\n"));
        content.push_str("BI /W 2 /H 1 /CS /G /BPC 8 ID \x00\x7f EI\n");
        content.push_str(&format!("0 0 m {i} 10 l S Q %% a comment {i} with words\n"));
    }
    let pdf = format!(
        "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] /Contents 4 0 R >> endobj\n4 0 obj << /Length {} >>\nstream\n{}\nendstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
        content.len(),
        content
    );
    let doc = rc_parse::Document::open(pdf.as_bytes()).unwrap();
    let seq = rc_parse::page_content(&doc, 0, &rc_parse::Options { parallel: false, ..Default::default() }).unwrap();
    assert_eq!(seq.items.len(), 800, "400 lines and 400 images");
    for chunk in [64, 97, 200, 1000] {
        let o = rc_parse::Options { parallel_min: 0, token_chunk: chunk, ..Default::default() };
        let par = rc_parse::page_content(&doc, 0, &o).unwrap();
        assert!(par == seq, "chunk {chunk}: {} items vs {}", par.items.len(), seq.items.len());
    }
}
