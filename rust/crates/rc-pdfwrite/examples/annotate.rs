//! Adds a Rectangle and a Text Box to every page of a PDF, as the app saves them.
//!
//! `cargo run -p rc-pdfwrite --example annotate -- IN.pdf OUT.pdf`

use rc_markup::{Markup, RECT, TEXT};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let (input, output) = (args.get(1).expect("IN.pdf"), args.get(2).expect("OUT.pdf"));
    let bytes = std::fs::read(input)?;
    let doc = rc_parse::Document::open(&bytes)?;
    let mut markups = Vec::new();
    for (i, [w, h]) in rc_parse::page_sizes(&doc).into_iter().enumerate() {
        let (w, h) = (w as f64, h as f64);
        let mut r = Markup::new(RECT, i, vec![[w * 0.08, h * 0.1], [w * 0.35, h * 0.32]], "annotate");
        r.style.width = 4.0;
        let mut t = Markup::new(TEXT, i, vec![[w * 0.45, h * 0.12], [w * 0.75, h * 0.24]], "annotate");
        t.text = Some(format!(
            "Page {} — check this dimension against the grid before issue.\nRev B",
            i + 1
        ));
        t.style.font_size = Some(h as f64 / 60.0);
        t.style.fill = Some("#fff7c2".into());
        t.style.text_color = Some("#1f2937".into());
        markups.push(r);
        markups.push(t);
    }
    let tail = rc_pdfwrite::update(&doc, &markups, &[])?.expect("markups to add");
    std::fs::write(output, [&bytes[..], &tail[..]].concat())?;
    println!(
        "{output}: {} markups added ({} bytes appended)",
        markups.len(),
        tail.len()
    );
    Ok(())
}
