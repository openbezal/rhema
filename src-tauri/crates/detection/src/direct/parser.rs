use crate::types::VerseRef;
use rhema_core::{ChapterNumber, VerseNumber};
use super::automaton::BookMatch;

/// A Bible reference token.
#[derive(Debug, PartialEq, Clone)]
enum Token {
    Word(String),
    Number(u16),
    Colon,
    Dash,
}

/// Tokenizes text into a stream of semantic tokens (words, numbers, symbols).
struct Tokenizer<'a> {
    chars: std::iter::Peekable<std::str::Chars<'a>>,
}

impl<'a> Tokenizer<'a> {
    fn new(text: &'a str) -> Self {
        let chars = text.chars().peekable();
        Self { chars }
    }

    fn collect(mut self) -> Vec<Token> {
        let mut tokens = Vec::new();
        while let Some(&ch) = self.chars.peek() {
            match ch {
                ch if ch.is_whitespace() => { self.chars.next(); }
                ':' => { tokens.push(Token::Colon); self.chars.next(); }
                '-' | '\u{2013}' | '\u{2014}' => { tokens.push(Token::Dash); self.chars.next(); }
                ch if ch.is_ascii_digit() => tokens.push(self.read_digit_number()),
                ch if ch.is_alphabetic() => tokens.push(self.read_word_or_spoken_number()),
                _ => { self.chars.next(); }
            }
        }
        tokens
    }

    fn read_digit_number(&mut self) -> Token {
        let mut s = String::new();
        while let Some(&c) = self.chars.peek() {
            if c.is_ascii_digit() { s.push(c); self.chars.next(); } else { break; }
        }
        Token::Number(s.parse().unwrap_or(0))
    }

    fn read_word_or_spoken_number(&mut self) -> Token {
        let mut s = String::new();
        while let Some(&c) = self.chars.peek() {
            if c.is_alphabetic() { s.push(c); self.chars.next(); } else { break; }
        }
        let word = s.to_lowercase();
        if let Some(n) = parse_spoken_number(&word) {
            Token::Number(n as u16)
        } else {
            Token::Word(word)
        }
    }
}

/// Parses a structured VerseRef from transcript text using a declarative scanner.
pub fn parse_reference(text: &str, book_match: &BookMatch) -> Option<VerseRef> {
    let tokens = Tokenizer::new(text[book_match.end..].trim_start()).collect();
    if tokens.is_empty() { return None; }

    let mut scanner = Scanner::new(&tokens);
    let mut vref = VerseRef {
        book_number: book_match.book_number,
        book_name: book_match.book_name.clone(),
        chapter: ChapterNumber(0),
        verse_start: VerseNumber(0),
        verse_end: None,
    };

    scanner.skip_fillers();
    if let Some(ch) = scanner.next_number() {
        vref.chapter = ChapterNumber(ch);
        
        scanner.skip_fillers();
        // Match patterns: "N:M", "N verse M", or bare "N M"
        let is_verse = scanner.consume_word("verse") 
            || scanner.consume_word("verses")
            || scanner.consume_colon();
        
        if is_verse {
            if let Some(v) = scanner.next_number() {
                vref.verse_start = VerseNumber(v);
                vref.verse_end = scanner.scan_range_end().map(VerseNumber);
            }
        } else if let Some(v) = scanner.next_number() {
            // Bare number sequence "John 3 16"
            vref.verse_start = VerseNumber(v);
            vref.verse_end = scanner.scan_range_end().map(VerseNumber);
        }
        return Some(vref);
    }
    None
}

struct Scanner<'a> {
    tokens: &'a [Token],
    cursor: usize,
}

impl<'a> Scanner<'a> {
    fn new(tokens: &'a [Token]) -> Self {
        Self { tokens, cursor: 0 }
    }

    fn skip_fillers(&mut self) {
        while let Some(Token::Word(w)) = self.tokens.get(self.cursor) {
            if matches!(w.as_str(), "and" | "we" | "will" | "be" | "reading" | "from" | "look" | "at" | "i" | "want" | "us" | "to" | "chapter" | "verse" | "verses") {
                self.cursor += 1;
            } else { break; }
        }
    }

    fn next_number(&mut self) -> Option<u16> {
        self.skip_fillers();

        if let Some(Token::Number(n)) = self.tokens.get(self.cursor) {
            let mut val = *n;
            self.cursor += 1;

            // Greedily aggregate spoken compounds (e.g., [30, 2] -> 32)
            // Rule: If current val is multiple of 10 and next is 1..9, add them.
            if val % 10 == 0 && val >= 20 {
                if let Some(Token::Number(n2)) = self.tokens.get(self.cursor) {
                    if *n2 > 0 && *n2 < 10 {
                        val += *n2;
                        self.cursor += 1;
                    }
                }
            }
            Some(val)
        } else {
            None
        }
    }

    fn consume_word(&mut self, target: &str) -> bool {
        if let Some(Token::Word(w)) = self.tokens.get(self.cursor) {
            if w == target { self.cursor += 1; return true; }
        }
        false
    }

    fn consume_colon(&mut self) -> bool {
        if let Some(Token::Colon) = self.tokens.get(self.cursor) {
            self.cursor += 1; return true;
        }
        false
    }

    fn scan_range_end(&mut self) -> Option<u16> {
        let saved = self.cursor;
        let is_range = matches!(self.tokens.get(self.cursor), Some(Token::Dash))
            || self.consume_word("to")
            || self.consume_word("through");
        
        if is_range {
            if matches!(self.tokens.get(self.cursor), Some(Token::Dash)) { self.cursor += 1; }
            self.consume_word("verse");
            self.consume_word("verses");
            if let Some(n) = self.next_number() { return Some(n); }
        }
        self.cursor = saved;
        None
    }
}

pub fn parse_spoken_number(word: &str) -> Option<i32> {
    match word {
        "one" => Some(1), "two" => Some(2), "three" => Some(3), "four" => Some(4),
        "five" => Some(5), "six" => Some(6), "seven" => Some(7), "eight" => Some(8),
        "nine" => Some(9), "ten" => Some(10), "eleven" => Some(11), "twelve" => Some(12),
        "thirteen" => Some(13), "fourteen" => Some(14), "fifteen" => Some(15), "sixteen" => Some(16),
        "seventeen" => Some(17), "eighteen" => Some(18), "nineteen" => Some(19), "twenty" => Some(20),
        "thirty" => Some(30), "forty" => Some(40), "fifty" => Some(50), "sixty" => Some(60),
        "seventy" => Some(70), "eighty" => Some(80), "ninety" => Some(90), "hundred" => Some(100),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct::automaton::BookMatch;
    use std::sync::Arc;

    use rhema_core::{BookId, ChapterNumber, VerseNumber};

    fn make_bm(name: &str, num: i32, end: usize) -> BookMatch {
        BookMatch { book_number: BookId(num as u8), book_name: Arc::from(name), start: 0, end }
    }

    #[test]
    fn test_patterns() {
        let cases = [
            ("John 3:16", 43, "John", 3, 16, None),
            ("Romans 8:28-30", 45, "Romans", 8, 28, Some(30)),
            ("Psalm thirty two verse one", 19, "Psalms", 32, 1, None),
            ("John 3 16", 43, "John", 3, 16, None),
            ("Genesis 1 1", 1, "Genesis", 1, 1, None),
            ("Isaiah chapter 53 verse 5", 23, "Isaiah", 53, 5, None),
            ("Ephesians chapter six we will be reading from verse 10 to verse 16", 49, "Ephesians", 6, 10, Some(16)),
        ];

        for (text, num, name, ch, v, v_end) in cases {
            let bm = make_bm(name, num, name.len());
            let res = parse_reference(text, &bm).expect(text);
            assert_eq!(res.chapter, ChapterNumber(ch as u16), "Chapter mismatch for {}", text);
            assert_eq!(res.verse_start, VerseNumber(v as u16), "Verse mismatch for {}", text);
            assert_eq!(res.verse_end, v_end.map(|vend| VerseNumber(vend as u16)));
        }
    }
}
