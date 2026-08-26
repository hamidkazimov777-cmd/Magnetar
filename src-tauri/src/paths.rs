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

// Wired into the file tools in the next commit, together with the backend-held
// workspace root and the grant record for outside paths. Landing the primitive
// with its tests first keeps that change reviewable instead of arriving as one
// large patch that mixes policy with plumbing.
#![allow(dead_code)]

use std::path::{Component, Path, PathBuf};

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

/// Resolve a path that must be inside the workspace, refusing anything else.
///
/// The error names the resolved location rather than the spelling that was
/// asked for: when a symlink or a `..` chain is what moved the target, the
/// original string tells the reader nothing about why it was refused.
pub fn require_inside(root: &str, requested: &str) -> Result<PathBuf, String> {
    match locate(root, requested)? {
        Location::Inside(p) => Ok(p),
        Location::Outside(p) => Err(format!(
            "outside the workspace: {} resolves to {} (an explicit grant is required)",
            requested,
            p.display()
        )),
    }
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

        assert!(require_inside(&fx.root(), "../secrets.json").is_err());
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

        let err = require_inside(&fx.root(), "link.txt").expect_err("refused");
        // The message must name where it actually lands, not the spelling.
        assert!(err.contains("secret.txt"));
    }

    #[test]
    fn a_symlinked_directory_pointing_out_is_also_outside() {
        let fx = Fixture::new();
        let outside = Fixture::new();
        outside.write("nested/target.txt", "x");
        std::os::unix::fs::symlink(outside.0.join("nested"), fx.0.join("escape")).expect("symlink");

        assert!(require_inside(&fx.root(), "escape/target.txt").is_err());
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
}
