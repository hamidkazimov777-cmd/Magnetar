//! Decoding a byte stream that arrives in arbitrary pieces.
//!
//! Every streaming path in the app used to call `String::from_utf8_lossy` on
//! each chunk as it came off the socket. That is correct only for ASCII: a
//! Cyrillic letter is two bytes, an emoji is four, and a chunk boundary lands
//! wherever the network decides. When it lands mid-character, both halves
//! become U+FFFD and the text is corrupted for good — the user saw `Ток<?><?>н`
//! in the middle of an otherwise perfect answer.
//!
//! The fix is to keep the incomplete tail and decode it once the rest arrives.

/// Incremental UTF-8 decoder: feed it bytes, get back whole characters.
#[derive(Default)]
pub struct Utf8Stream {
    /// Bytes of a character split across chunk boundaries.
    tail: Vec<u8>,
}

impl Utf8Stream {
    pub fn new() -> Self {
        Self::default()
    }

    /// Decode everything that is complete, holding back a partial character.
    pub fn push(&mut self, bytes: &[u8]) -> String {
        if self.tail.is_empty() {
            // Fast path: the overwhelming majority of chunks are self-contained.
            match std::str::from_utf8(bytes) {
                Ok(s) => return s.to_string(),
                Err(_) => self.tail.extend_from_slice(bytes),
            }
        } else {
            self.tail.extend_from_slice(bytes);
        }

        let mut out = String::new();
        loop {
            match std::str::from_utf8(&self.tail) {
                Ok(s) => {
                    out.push_str(s);
                    self.tail.clear();
                    return out;
                }
                Err(e) => {
                    let good = e.valid_up_to();
                    // SAFETY-free equivalent: the prefix is known-valid UTF-8.
                    out.push_str(&String::from_utf8_lossy(&self.tail[..good]));
                    match e.error_len() {
                        // Genuinely invalid bytes (not a split character): emit
                        // the replacement once and move past them, or the
                        // stream would stall on them forever.
                        Some(bad) => {
                            out.push('\u{FFFD}');
                            self.tail.drain(..good + bad);
                        }
                        // Truncated character: keep the tail and wait.
                        None => {
                            self.tail.drain(..good);
                            return out;
                        }
                    }
                }
            }
        }
    }

    /// Flush whatever is left when the stream ends — a trailing partial
    /// character is corruption at the source, so it is shown as one.
    pub fn finish(&mut self) -> String {
        if self.tail.is_empty() {
            return String::new();
        }
        let s = String::from_utf8_lossy(&self.tail).into_owned();
        self.tail.clear();
        s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The regression from the live run: a Russian word arriving in two chunks
    /// that split one of its letters down the middle.
    #[test]
    fn split_cyrillic_letter_survives() {
        let word = "Токен".as_bytes().to_vec();
        // "Ток" is 6 bytes; cut inside the 4th letter.
        let cut = 7;
        let mut dec = Utf8Stream::new();
        let mut got = dec.push(&word[..cut]);
        got.push_str(&dec.push(&word[cut..]));
        got.push_str(&dec.finish());
        assert_eq!(got, "Токен");
        assert!(!got.contains('\u{FFFD}'), "no replacement characters");
    }

    /// Byte-at-a-time is the worst case a slow connection can produce.
    #[test]
    fn one_byte_at_a_time_survives() {
        let text = "Привет, мир! 🧲 done";
        let mut dec = Utf8Stream::new();
        let mut got = String::new();
        for b in text.as_bytes() {
            got.push_str(&dec.push(&[*b]));
        }
        got.push_str(&dec.finish());
        assert_eq!(got, text);
    }

    /// Plain ASCII must not be slowed down or altered.
    #[test]
    fn ascii_passes_through() {
        let mut dec = Utf8Stream::new();
        assert_eq!(dec.push(b"data: {\"a\":1}\n"), "data: {\"a\":1}\n");
        assert_eq!(dec.finish(), "");
    }

    /// Actually invalid bytes must not stall the stream.
    #[test]
    fn invalid_bytes_do_not_stall() {
        let mut dec = Utf8Stream::new();
        let out = dec.push(&[0xC3, 0x28, b'o', b'k']);
        assert!(out.ends_with("ok"), "stream continued past the bad byte: {out:?}");
    }
}
