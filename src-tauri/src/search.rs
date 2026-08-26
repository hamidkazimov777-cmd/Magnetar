//! Searching the project's text.
//!
//! The old implementation was a case-insensitive substring walk with a fixed
//! cap and no way to stop it. On a large repository that means one of two bad
//! outcomes: it returns before it has looked at the interesting half, or the
//! user waits with no way out. Neither is a search.
//!
//! What a search over someone else's machine has to be able to say is: here is
//! what I found, and here is why I stopped. So every run reports whether it was
//! cut short by the result budget, by the clock, or by the user — rather than
//! quietly returning a short list that looks complete.

use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SKIP_DIRS: [&str; 8] = [
    "node_modules",
    ".git",
    "target",
    "dist",
    ".next",
    "build",
    ".venv",
    "__pycache__",
];

/// Files above this are generated, minified or data. Reading them is slow and
/// the hits are never what someone was looking for.
const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// A line longer than this is minified output, not source. Matching inside it
/// produces a "hit" nobody can read.
const MAX_LINE_LEN: usize = 1000;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct Hit {
    pub file: String,
    pub line: usize,
    /// The matching line, trimmed of surrounding whitespace and capped.
    pub text: String,
    /// Where the match starts within `text`, so the UI can highlight it rather
    /// than making the reader find it again.
    pub column: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub hits: Vec<Hit>,
    /// True when the budget, the clock or the user stopped it. Each is reported
    /// separately because they mean different things to whoever is reading:
    /// narrow the query, wait longer, or nothing at all.
    pub truncated: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub files_scanned: usize,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
}

fn default_max_results() -> usize {
    500
}
fn default_timeout_ms() -> u64 {
    10_000
}

impl Default for Options {
    fn default() -> Self {
        Self {
            regex: false,
            case_sensitive: false,
            whole_word: false,
            max_results: default_max_results(),
            timeout_ms: default_timeout_ms(),
        }
    }
}

/// Searches the user has asked to stop. Keyed by the id the caller passed in,
/// so a new search does not cancel the one before it by accident.
static CANCELLED: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

pub fn cancel(id: &str) {
    lock(&CANCELLED).insert(id.to_string());
}

fn is_cancelled(id: &str) -> bool {
    !id.is_empty() && lock(&CANCELLED).contains(id)
}

fn finish(id: &str) {
    if !id.is_empty() {
        lock(&CANCELLED).remove(id);
    }
}

/// Turn what the user typed into a matcher.
///
/// A literal search still goes through the regex engine, escaped — one code
/// path for matching means the column of a hit is computed the same way in both
/// modes, and "whole word" works for a literal without a second implementation.
pub fn build_matcher(pattern: &str, opts: &Options) -> Result<Regex, String> {
    let body = if opts.regex {
        pattern.to_string()
    } else {
        regex::escape(pattern)
    };
    let body = if opts.whole_word {
        format!(r"\b(?:{body})\b")
    } else {
        body
    };
    RegexBuilder::new(&body)
        .case_insensitive(!opts.case_sensitive)
        // A user's regex is not a program: refuse the pathological ones rather
        // than letting one lock a thread up for the whole timeout.
        .size_limit(1 << 20)
        .build()
        // The message is what the user sees under the search box, so it says
        // what is wrong with their pattern and nothing about our internals.
        .map_err(|e| format!("invalid pattern: {}", first_line(&e.to_string())))
}

fn first_line(text: &str) -> String {
    text.lines().next().unwrap_or("").trim().to_string()
}

fn is_texty(name: &str) -> bool {
    const BIN: [&str; 21] = [
        "png", "jpg", "jpeg", "gif", "webp", "ico", "pdf", "zip", "gz", "tar", "mp4", "mov",
        "mp3", "wav", "woff", "woff2", "ttf", "otf", "lock", "map", "wasm",
    ];
    let lower = name.to_lowercase();
    // `bundle.min.js` is a JavaScript file by extension and generated output by
    // every other measure. Checking only the last extension let it through, and
    // one minified bundle is enough to bury a page of real results.
    if lower.contains(".min.") {
        return false;
    }
    let ext = lower.rsplit('.').next().unwrap_or("");
    !BIN.contains(&ext)
}

/// Search `root` for `pattern`, stopping for a reason it can name.
pub fn run(root: &str, pattern: &str, opts: &Options, id: &str) -> Result<Outcome, String> {
    if pattern.is_empty() {
        return Ok(Outcome {
            hits: Vec::new(),
            truncated: false,
            timed_out: false,
            cancelled: false,
            files_scanned: 0,
        });
    }
    let matcher = build_matcher(pattern, opts)?;
    let deadline = Instant::now() + Duration::from_millis(opts.timeout_ms.max(100));

    let mut out = Outcome {
        hits: Vec::new(),
        truncated: false,
        timed_out: false,
        cancelled: false,
        files_scanned: 0,
    };
    walk(Path::new(root), &matcher, opts, id, deadline, &mut out);
    finish(id);
    Ok(out)
}

fn walk(
    dir: &Path,
    matcher: &Regex,
    opts: &Options,
    id: &str,
    deadline: Instant,
    out: &mut Outcome,
) {
    if out.truncated || out.timed_out || out.cancelled {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        // Checked per entry rather than per file: a directory of a hundred
        // thousand generated files should still stop when asked.
        if is_cancelled(id) {
            out.cancelled = true;
            return;
        }
        if Instant::now() >= deadline {
            out.timed_out = true;
            return;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }
            walk(&entry.path(), matcher, opts, id, deadline, out);
            if out.truncated || out.timed_out || out.cancelled {
                return;
            }
            continue;
        }

        if !is_texty(&name) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_FILE_BYTES {
            continue;
        }
        let path = entry.path();
        let Ok(content) = std::fs::read_to_string(&path) else {
            continue; // not text after all
        };
        out.files_scanned += 1;

        for (i, line) in content.lines().enumerate() {
            if line.len() > MAX_LINE_LEN {
                continue;
            }
            let Some(m) = matcher.find(line) else { continue };
            let trimmed_start = line.len() - line.trim_start().len();
            out.hits.push(Hit {
                file: path.to_string_lossy().into_owned(),
                line: i + 1,
                text: line.trim().chars().take(400).collect(),
                column: m.start().saturating_sub(trimmed_start),
            });
            if out.hits.len() >= opts.max_results {
                out.truncated = true;
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir()
                .join(format!("magnetar-search-{}-{}", std::process::id(), n));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("fixture");
            Self(dir)
        }
        fn write(&self, rel: &str, body: &str) {
            let path = self.0.join(rel);
            if let Some(p) = path.parent() {
                std::fs::create_dir_all(p).unwrap();
            }
            std::fs::write(path, body).unwrap();
        }
        fn root(&self) -> String {
            self.0.to_string_lossy().into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn opts() -> Options {
        Options::default()
    }

    #[test]
    fn a_literal_search_is_literal() {
        // The pattern is escaped, so regex punctuation means itself. Someone
        // searching for `a.b` is not asking about any character between a and b.
        let fx = Fixture::new();
        fx.write("a.txt", "value a.b here\nvalue axb here\n");
        let found = run(&fx.root(), "a.b", &opts(), "").unwrap();
        assert_eq!(found.hits.len(), 1);
        assert_eq!(found.hits[0].line, 1);
    }

    #[test]
    fn a_regex_search_is_a_regex() {
        let fx = Fixture::new();
        fx.write("a.txt", "fn one()\nfn two()\nnot a function\n");
        let o = Options { regex: true, ..opts() };
        let found = run(&fx.root(), r"^fn \w+\(\)", &o, "").unwrap();
        assert_eq!(found.hits.len(), 2);
    }

    #[test]
    fn case_sensitivity_is_the_caller_s_choice() {
        let fx = Fixture::new();
        fx.write("a.txt", "Widget\nwidget\n");
        assert_eq!(run(&fx.root(), "widget", &opts(), "").unwrap().hits.len(), 2);
        let sensitive = Options { case_sensitive: true, ..opts() };
        assert_eq!(run(&fx.root(), "widget", &sensitive, "").unwrap().hits.len(), 1);
    }

    #[test]
    fn whole_word_does_not_match_inside_a_word() {
        let fx = Fixture::new();
        fx.write("a.txt", "cat\nconcatenate\n");
        let o = Options { whole_word: true, ..opts() };
        let found = run(&fx.root(), "cat", &o, "").unwrap();
        assert_eq!(found.hits.len(), 1);
        assert_eq!(found.hits[0].text, "cat");
    }

    #[test]
    fn a_bad_pattern_is_explained_rather_than_thrown() {
        // The message lands under the search box, so it has to be about the
        // pattern and not about us.
        let fx = Fixture::new();
        let o = Options { regex: true, ..opts() };
        let err = run(&fx.root(), "([unclosed", &o, "").expect_err("refused");
        assert!(err.starts_with("invalid pattern:"));
        assert!(!err.contains("regex::"));
    }

    #[test]
    fn the_budget_is_reported_not_hidden() {
        // A short list that looks complete is worse than a short list that says
        // it is short.
        let fx = Fixture::new();
        for i in 0..10 {
            fx.write(&format!("f{i}.txt"), "needle\n");
        }
        let o = Options { max_results: 3, ..opts() };
        let found = run(&fx.root(), "needle", &o, "").unwrap();
        assert_eq!(found.hits.len(), 3);
        assert!(found.truncated);
        assert!(!found.timed_out);
    }

    #[test]
    fn a_search_stops_when_it_is_asked_to() {
        let fx = Fixture::new();
        for i in 0..50 {
            fx.write(&format!("f{i}.txt"), "needle\n");
        }
        cancel("run-1");
        let found = run(&fx.root(), "needle", &opts(), "run-1").unwrap();
        assert!(found.cancelled);
        // And the cancellation does not linger for the next search.
        let again = run(&fx.root(), "needle", &opts(), "run-1").unwrap();
        assert!(!again.cancelled);
    }

    #[test]
    fn one_search_does_not_cancel_another() {
        let fx = Fixture::new();
        fx.write("a.txt", "needle\n");
        cancel("run-a");
        let other = run(&fx.root(), "needle", &opts(), "run-b").unwrap();
        assert!(!other.cancelled);
        assert_eq!(other.hits.len(), 1);
        cancel("run-a"); // clean up the entry we left behind
        let _ = run(&fx.root(), "needle", &opts(), "run-a");
    }

    #[test]
    fn generated_noise_is_skipped() {
        let fx = Fixture::new();
        fx.write("node_modules/dep/index.js", "needle\n");
        fx.write(".git/config", "needle\n");
        fx.write("bundle.min.js", "needle\n");
        fx.write("app.js.map", "needle\n");
        fx.write("art.png", "needle\n");
        fx.write("src/real.ts", "needle\n");

        let found = run(&fx.root(), "needle", &opts(), "").unwrap();
        assert_eq!(found.hits.len(), 1);
        assert!(found.hits[0].file.ends_with("real.ts"));
    }

    #[test]
    fn a_minified_line_is_not_a_readable_hit() {
        let fx = Fixture::new();
        fx.write("big.js", &format!("var x=\"{}needle\";\n", "a".repeat(2000)));
        fx.write("small.js", "needle\n");
        let found = run(&fx.root(), "needle", &opts(), "").unwrap();
        assert_eq!(found.hits.len(), 1);
        assert!(found.hits[0].file.ends_with("small.js"));
    }

    #[test]
    fn the_column_points_at_the_match_in_the_trimmed_line() {
        // The UI highlights using this, and it renders the trimmed text.
        let fx = Fixture::new();
        fx.write("a.txt", "        let needle = 1;\n");
        let found = run(&fx.root(), "needle", &opts(), "").unwrap();
        let hit = &found.hits[0];
        assert_eq!(hit.text, "let needle = 1;");
        assert_eq!(&hit.text[hit.column..hit.column + 6], "needle");
    }

    #[test]
    fn an_empty_pattern_finds_nothing_rather_than_everything() {
        let fx = Fixture::new();
        fx.write("a.txt", "anything\n");
        let found = run(&fx.root(), "", &opts(), "").unwrap();
        assert!(found.hits.is_empty());
        assert!(!found.truncated);
    }
}
