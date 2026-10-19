//! A PDFium worker process. The app normally runs workers as `redcolumn --rc-pdfium-worker`;
//! this standalone binary is for tests and tools.

fn main() {
    if let Err(e) = rc_pdf::worker::main_from_args(std::env::args().skip(1)) {
        eprintln!("rc-pdf-worker: {e:#}");
        std::process::exit(1);
    }
}
