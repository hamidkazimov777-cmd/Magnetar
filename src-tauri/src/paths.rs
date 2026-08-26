//! Where a path is allowed to land.
//!
//! Every file tool used to take a string from the frontend and hand it to
//! `std::fs` unchanged. The frontend is untrusted presentation code, and the
//! strings themselves often come from a model, so "the user confirmed it" was
//! being decided on the far side of the boundary it was supposed to protect.
//!
//! ## Containment, not a fence
//!
//! The workspace root is deliberately not a wall. Magnetar's own system prompt
//! tells the agent that work outside the open folder is allowed when the user
//! asks for it — that wording exists because an earlier version read the root
//! as a fence and refused to create a folder on the Desktop that the user had
//! just asked for, telling them to do it by hand instead.
//!
//! So this module answers one narrow question — *is this path inside the
//! workspace, and what exactly does it resolve to* — and leaves the decision
//! about outside paths to an explicit, auditable grant. Resolution happens here
//! either way, because `../../..` and a symlink pointing out of the tree have
//! to be seen for what they are before anyone can decide anything about them.

use once_cell::sync::Lazy;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

/// What a requested path turned out to be.
#[derive(Debug, PartialEq, Eq)]
pub enum Location {
    /// Resolves inside the workspace root. Ordinary work.
    Inside(PathBuf),
    /// Resolves outside it. Legal, but only with an explicit grant.
    Outside(PathBuf),
}

impl Location {
    pub fn path(&self) -> &Path {
        match self {
            Location::Inside(p) | Location::Outside(p) => p,
        }
    }

    pub fn is_inside(&self) -> bool {
        matches!(self, Location::Inside(_))
    }
}

/// Collapse `.` and `..` without touching the filesystem.
///
/// This runs before canonicalisation because the target may not exist yet —
/// `write_file` creates new files, and `canonicalize` fails on anything that is
/// not already there. Doing it lexically first means `dir/../../etc/passwd` is
/// already `etc/passwd` by the time the real path is resolved.
fn lexically_normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                // Popping past the root is not an escape, it is just the root:
                // this mirrors what the kernel does with `/..`.
                if !matches!(out.components().next_back(), None | Some(Component::RootDir)) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Resolve the deepest part of the path that actually exists, then re-attach
/// the rest. Canonicalising the existing prefix is what defeats a symlink: a
/// link inside the workspace that points elsewhere resolves to `elsewhere`, and
/// the containment check then sees the truth rather than the spelling.
fn resolve_existing_prefix(path: &Path) -> PathBuf {
    let mut trailing: Vec<&std::ffi::OsStr> = Vec::new();
    let mut cursor = path;

    loop {
        if let Ok(real) = cursor.canonicalize() {
            let mut out = real;
            for part in trailing.iter().rev() {
                out.push(part);
            }
            return out;
        }
        match (cursor.file_name(), cursor.parent()) {
            (Some(name), Some(parent)) => {
                trailing.push(name);
                cursor = parent;
            }
            // Nothing along the path exists; the lexical form is the best
            // answer available, and it is already free of `.` and `..`.
            _ => return path.to_path_buf(),
        }
    }
}

/// Work out where `requested` really lands, relative to `root`.
///
/// A relative path is taken against the workspace root, which is what every
/// caller means by it. An absolute path is taken at face value — and then
/// checked, like everything else.
pub fn locate(root: &str, requested: &str) -> Result<Location, String> {
    if requested.trim().is_empty() {
        return Err("empty path".into());
    }

    let root_real = Path::new(root)
        .canonicalize()
        .map_err(|e| format!("workspace root is unusable ({root}): {e}"))?;

    let requested_path = Path::new(requested);
    let joined = if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        root_real.join(requested_path)
    };

    let resolved = resolve_existing_prefix(&lexically_normalize(&joined));

    // `starts_with` compares whole components, so a sibling directory whose
    // name merely begins with the root's name — `/work/project-old` next to
    // `/work/project` — is correctly outside. A string prefix check would have
    // let it through, which is the classic version of this bug.
    Ok(if resolved.starts_with(&root_real) {
        Location::Inside(resolved)
    } else {
        Location::Outside(resolved)
    })
}

/* --------------------------------------------------------------------------
   THE ROOT, AND WHAT THE USER HAS ALLOWED PAST IT

   Both of these live in Rust rather than in the store. A containment check the
   frontend can configure is not a containment check: the webview is the side
   that gets compromised, and a grant it can mint for itself protects nobody.
   -------------------------------------------------------------------------- */

static WORKSPACE_ROOT: Lazy<Mutex<Option<String>>> = Lazy::new(|| Mutex::new(None));

/// Paths the user has explicitly allowed work outside the workspace on.
///
/// Deliberately not persisted. A grant that survives a restart is a grant
/// nobody remembers giving, and it would sit there authorising a folder the
/// user approved once, weeks ago, for one file.
static GRANTS: Lazy<Mutex<HashSet<PathBuf>>> = Lazy::new(|| Mutex::new(HashSet::new()));

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    // A poisoned lock here means another thread panicked mid-update. Refusing
    // to work after that would disable the file tools entirely; the state is a
    // path string and a set of paths, and neither can be left half-written.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Point containment at a folder, or clear it when the folder is closed.
/// Changing workspace drops every grant: they were given about the old one.
pub fn set_workspace_root(root: Option<String>) {
    let mut current = lock(&WORKSPACE_ROOT);
    if current.as_deref() != root.as_deref() {
        lock(&GRANTS).clear();
    }
    *current = root;
}

pub fn workspace_root() -> Option<String> {
    lock(&WORKSPACE_ROOT).clone()
}

/// Record that the user allowed this exact resolved location. A grant on a
/// directory covers what is under it, so approving a folder once does not mean
/// answering a dialog per file inside it.
pub fn grant(resolved: &Path) {
    lock(&GRANTS).insert(resolved.to_path_buf());
}

fn is_granted(resolved: &Path) -> bool {
    lock(&GRANTS)
        .iter()
        .any(|granted| resolved == granted || resolved.starts_with(granted))
}

/// What the backend should do about a requested path.
#[derive(Debug)]
pub enum Decision {
    /// Inside the workspace, or already covered by a grant.
    Allowed(PathBuf),
    /// Outside, and nobody has approved it yet. The caller must ask the user
    /// — and must ask them, not the webview that made the request.
    NeedsGrant(PathBuf),
}

/// Resolve a requested path and decide whether work on it may proceed.
///
/// With no workspace open there is nothing to contain against, so the path is
/// allowed once resolved: refusing would make the app useless before a folder
/// is chosen, and the resolution still strips `..` and follows symlinks.
pub fn authorize(requested: &str) -> Result<Decision, String> {
    let Some(root) = workspace_root() else {
        let resolved = resolve_existing_prefix(&lexically_normalize(Path::new(requested)));
        if requested.trim().is_empty() {
            return Err("empty path".into());
        }
        return Ok(Decision::Allowed(resolved));
    };

    let located = locate(&root, requested)?;
    let resolved = located.path().to_path_buf();
    Ok(if located.is_inside() || is_granted(&resolved) {
        Decision::Allowed(resolved)
    } else {
        Decision::NeedsGrant(resolved)
    })
}

/// What the user is asked about, and what a refusal says afterwards.
///
/// It names the resolved location rather than the spelling that was requested:
/// when a symlink or a chain of `..` is what moved the target, the original
/// string tells the reader nothing about why they are being asked. Someone
/// approving access needs to see the real destination.
pub fn outside_message(resolved: &Path) -> String {
    format!("{} is outside the open project folder", resolved.display())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            // The temp directory is itself a symlink on macOS (/tmp ->
            // /private/tmp), so the fixture root is canonicalised up front —
            // otherwise every assertion would be testing that symlink instead
            // of the one under test.
            let dir = std::env::temp_dir()
                .canonicalize()
                .expect("temp dir")
                .join(format!("magnetar-paths-{}-{}", std::process::id(), n));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("create fixture");
            Self(dir)
        }

        fn write(&self, rel: &str, body: &str) -> PathBuf {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("parent");
            }
            std::fs::write(&path, body).expect("write");
            path
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

    #[test]
    fn ordinary_paths_resolve_inside() {
        let fx = Fixture::new();
        fx.write("src/main.rs", "fn main() {}");

        for candidate in ["src/main.rs", "./src/main.rs", "src/../src/main.rs"] {
            let loc = locate(&fx.root(), candidate).expect("locate");
            assert!(loc.is_inside(), "{candidate} should be inside");
            assert_eq!(loc.path(), fx.0.join("src/main.rs"));
        }
    }

    #[test]
    fn a_file_that_does_not_exist_yet_still_resolves() {
        // write_file creates files; refusing to resolve them would make the
        // policy unusable for the one tool that needs it most.
        let fx = Fixture::new();
        let loc = locate(&fx.root(), "new/deeply/nested.txt").expect("locate");
        assert!(loc.is_inside());
        assert_eq!(loc.path(), fx.0.join("new/deeply/nested.txt"));
    }

    #[test]
    fn parent_traversal_is_seen_for_what_it_is() {
        let fx = Fixture::new();
        let loc = locate(&fx.root(), "../../../etc/passwd").expect("locate");
        assert!(!loc.is_inside());
        assert!(!loc.path().to_string_lossy().contains(".."));

        assert!(!locate(&fx.root(), "../secrets.json").expect("locate").is_inside());
    }

    #[test]
    fn traversal_that_returns_inside_is_allowed() {
        let fx = Fixture::new();
        fx.write("src/main.rs", "");
        let loc = locate(&fx.root(), "src/../src/main.rs").expect("locate");
        assert!(loc.is_inside());
    }

    #[test]
    fn a_symlink_pointing_out_of_the_tree_is_outside() {
        let fx = Fixture::new();
        let outside = Fixture::new();
        let secret = outside.write("secret.txt", "keys");
        std::os::unix::fs::symlink(&secret, fx.0.join("link.txt")).expect("symlink");

        let loc = locate(&fx.root(), "link.txt").expect("locate");
        assert!(!loc.is_inside(), "a link out of the workspace is not inside it");
        assert_eq!(loc.path(), secret);

        // What the user is asked about must name where it actually lands, not
        // the spelling that was requested.
        let asked = outside_message(loc.path());
        assert!(asked.contains("secret.txt"));
        assert!(!asked.contains("link.txt"));
    }

    #[test]
    fn a_symlinked_directory_pointing_out_is_also_outside() {
        let fx = Fixture::new();
        let outside = Fixture::new();
        outside.write("nested/target.txt", "x");
        std::os::unix::fs::symlink(outside.0.join("nested"), fx.0.join("escape")).expect("symlink");

        assert!(!locate(&fx.root(), "escape/target.txt")
            .expect("locate")
            .is_inside());
    }

    #[test]
    fn a_symlink_that_stays_inside_is_fine() {
        let fx = Fixture::new();
        let real = fx.write("src/main.rs", "");
        std::os::unix::fs::symlink(&real, fx.0.join("alias.rs")).expect("symlink");

        let loc = locate(&fx.root(), "alias.rs").expect("locate");
        assert!(loc.is_inside());
        assert_eq!(loc.path(), real);
    }

    #[test]
    fn a_sibling_whose_name_shares_the_prefix_is_outside() {
        // The bug a string comparison always ships with: /work/project-old is
        // not inside /work/project, however much it looks like it.
        let fx = Fixture::new();
        let sibling = format!("{}-old", fx.root());
        std::fs::create_dir_all(&sibling).expect("sibling");
        let loc = locate(&fx.root(), &format!("{sibling}/file.txt")).expect("locate");
        let _ = std::fs::remove_dir_all(&sibling);
        assert!(!loc.is_inside());
    }

    #[test]
    fn the_root_itself_is_inside() {
        let fx = Fixture::new();
        assert!(locate(&fx.root(), ".").expect("locate").is_inside());
        assert!(locate(&fx.root(), &fx.root()).expect("locate").is_inside());
    }

    #[test]
    fn an_absolute_path_elsewhere_is_outside_but_still_resolved() {
        let fx = Fixture::new();
        let loc = locate(&fx.root(), "/etc/hosts").expect("locate");
        assert!(!loc.is_inside());
        // /etc is itself a symlink to /private/etc on macOS, so the resolved
        // form is the real one rather than the spelling that was asked for.
        // That is the whole point: the check sees where a path lands.
        assert_eq!(loc.path(), Path::new("/etc/hosts").canonicalize().expect("etc"));
    }

    #[test]
    fn an_empty_or_missing_root_is_an_error_not_a_free_pass() {
        let fx = Fixture::new();
        assert!(locate(&fx.root(), "   ").is_err());
        assert!(locate("/no/such/workspace/anywhere", "file.txt").is_err());
    }

    /// The root and the grant set are process-wide, so the tests that touch
    /// them run one at a time.
    static SERIAL: Mutex<()> = Mutex::new(());

    fn serial() -> std::sync::MutexGuard<'static, ()> {
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn allowed(d: &Decision) -> bool {
        matches!(d, Decision::Allowed(_))
    }

    #[test]
    fn without_a_workspace_there_is_nothing_to_contain_against() {
        let _guard = serial();
        set_workspace_root(None);
        assert!(allowed(&authorize("/etc/hosts").expect("authorize")));
        assert!(authorize("  ").is_err());
        set_workspace_root(None);
    }

    #[test]
    fn inside_is_allowed_and_outside_asks_first() {
        let _guard = serial();
        let fx = Fixture::new();
        fx.write("src/main.rs", "");
        set_workspace_root(Some(fx.root()));

        assert!(allowed(&authorize("src/main.rs").expect("authorize")));
        assert!(matches!(
            authorize("../elsewhere.txt").expect("authorize"),
            Decision::NeedsGrant(_)
        ));
        set_workspace_root(None);
    }

    #[test]
    fn a_grant_covers_the_folder_it_was_given_for() {
        let _guard = serial();
        let fx = Fixture::new();
        let outside = Fixture::new();
        outside.write("nested/file.txt", "");
        set_workspace_root(Some(fx.root()));

        let target = outside.0.join("nested/file.txt");
        assert!(matches!(
            authorize(&target.to_string_lossy()).expect("authorize"),
            Decision::NeedsGrant(_)
        ));

        grant(&outside.0);
        assert!(allowed(&authorize(&target.to_string_lossy()).expect("authorize")));
        // A sibling of the granted folder is not covered by it.
        let sibling = format!("{}-other/file.txt", outside.root());
        assert!(matches!(
            authorize(&sibling).expect("authorize"),
            Decision::NeedsGrant(_)
        ));
        set_workspace_root(None);
    }

    #[test]
    fn changing_workspace_forgets_every_grant() {
        let _guard = serial();
        let fx = Fixture::new();
        let outside = Fixture::new();
        let target = outside.write("file.txt", "");
        set_workspace_root(Some(fx.root()));
        grant(&outside.0);
        assert!(allowed(&authorize(&target.to_string_lossy()).expect("authorize")));

        // Opening another folder must not carry the previous folder's
        // permissions into it.
        let next = Fixture::new();
        set_workspace_root(Some(next.root()));
        assert!(matches!(
            authorize(&target.to_string_lossy()).expect("authorize"),
            Decision::NeedsGrant(_)
        ));
        set_workspace_root(None);
    }
}
