//! What the app is allowed to do to the machine right now.
//!
//! Path containment answers *where*; this answers *whether*. They are separate
//! questions: a write inside the workspace is still a write, and there are
//! situations — reviewing someone else's repository, letting an agent explore
//! before you trust it — where reading everything and changing nothing is the
//! whole point.
//!
//! The decision lives in Rust for the same reason the workspace root does. A
//! read-only switch the webview owns is a switch that stops existing the moment
//! the page is compromised, and "the UI hid the button" is not a control.

use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};

/// What a command is about to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// Reads the disk. Always permitted today, and declared at every read
    /// command anyway: a classification that only appears where it forbids
    /// something is not a policy, it is a scattering of special cases.
    Read,
    /// Creates, changes or removes something.
    Write,
    /// Runs a program, which may do either and cannot be inspected first.
    Execute,
}

static READ_ONLY: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

pub fn set_read_only(on: bool) {
    READ_ONLY.store(on, Ordering::SeqCst);
}

pub fn read_only() -> bool {
    READ_ONLY.load(Ordering::SeqCst)
}

/// Decide, given the mode, whether an access may proceed.
///
/// Kept as a pure function of its inputs so the rule can be tested without
/// standing up any global state, and so the rule reads as one expression
/// instead of being spread across every call site.
pub fn decide(access: Access, read_only: bool) -> Result<(), String> {
    match access {
        Access::Read => Ok(()),
        // Execution is refused along with writing, deliberately. A shell
        // command is opaque: `sh build.sh` cannot be shown to be read-only, so
        // treating it as a read would make the mode a promise the app cannot
        // keep.
        Access::Write | Access::Execute if read_only => Err(format!(
            "read-only mode is on: this would {}. Turn it off to continue.",
            match access {
                Access::Execute => "run a command",
                _ => "change a file",
            }
        )),
        _ => Ok(()),
    }
}

/// The gate every mutating command goes through.
pub fn require(access: Access) -> Result<(), String> {
    decide(access, read_only())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reading_is_never_blocked() {
        assert!(decide(Access::Read, true).is_ok());
        assert!(decide(Access::Read, false).is_ok());
    }

    #[test]
    fn read_only_stops_writing_and_running_alike() {
        // Running is refused with writing, not alongside reading: a command is
        // opaque, so allowing it would make the mode a promise that cannot be
        // kept.
        assert!(decide(Access::Write, true).is_err());
        assert!(decide(Access::Execute, true).is_err());
    }

    #[test]
    fn everything_is_allowed_when_the_mode_is_off() {
        for access in [Access::Read, Access::Write, Access::Execute] {
            assert!(decide(access, false).is_ok());
        }
    }

    #[test]
    fn the_refusal_says_what_was_refused_and_how_to_proceed() {
        let write = decide(Access::Write, true).expect_err("refused");
        assert!(write.contains("change a file"));
        assert!(write.contains("Turn it off"));

        let run = decide(Access::Execute, true).expect_err("refused");
        assert!(run.contains("run a command"));
    }

    #[test]
    fn the_mode_is_off_until_it_is_turned_on() {
        // A security control that defaults on would be turned off once and
        // never thought about again; this one is a deliberate choice each time.
        assert!(!read_only());
        set_read_only(true);
        assert!(read_only());
        assert!(require(Access::Write).is_err());
        set_read_only(false);
        assert!(require(Access::Write).is_ok());
    }
}
