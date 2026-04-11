use super::automaton::BookMatch;
use crate::types::VerseRef;

/// Parse a Bible reference from text given a book match position.
///
/// Looks ahead from the end of the book match for chapter:verse patterns.
pub fn parse_reference(text: &str, book_match: &BookMatch) -> Option<VerseRef> {
    let after = &text[book_match.end..];
    let after_trimmed = after.trim_start();
    let offset = after.len() - after_trimmed.len();
    let _ = offset; // consumed whitespace

    // Tokenize the text after the book name for easier parsing
    let tokens = tokenize(after_trimmed);

    if tokens.is_empty() {
        return None;
    }

    // Try pattern: chapter:verse or chapter:verse-end
    if let Some(result) = try_colon_pattern(&tokens, book_match) {
        return Some(result);
    }

    // Try pattern: "chapter N verse M" (spoken form)
    if let Some(result) = try_chapter_verse_spoken(&tokens, book_match) {
        return Some(result);
    }

    // Try pattern: number followed by "verse" keyword then number
    // e.g. "32 verse 1"
    if let Some(result) = try_number_verse_pattern(&tokens, book_match) {
        return Some(result);
    }

    // Try pattern: spoken numbers like "thirty two verse one"
    if let Some(result) = try_spoken_numbers(&tokens, book_match) {
        return Some(result);
    }

    // Try pattern: two consecutive numbers "3 16" → chapter 3 verse 16
    // This handles "John 3 16" where Deepgram transcribes without colon or keywords
    if let Some(result) = try_two_numbers(&tokens, book_match) {
        return Some(result);
    }

    // Try pattern: just a number (chapter only)
    if let Some(chapter) = token_to_number(&tokens[0]) {
        return Some(VerseRef {
            book_number: book_match.book_number,
            book_name: book_match.book_name.clone(),
            chapter,
            verse_start: 0,
            verse_end: None,
        });
    }

    None
}

/// A token from the text after the book name.
#[derive(Debug, Clone)]
enum Token {
    Word(String),
    Number(i32),
    Colon,
    Dash,
}

/// Tokenize text into words, numbers, colons, and dashes.
fn tokenize(text: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = text.chars().peekable();

    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        if ch == ':' {
            tokens.push(Token::Colon);
            chars.next();
            continue;
        }
        if ch == '-' || ch == '\u{2013}' || ch == '\u{2014}' {
            tokens.push(Token::Dash);
            chars.next();
            continue;
        }
        if ch.is_ascii_digit() {
            let mut num_str = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_ascii_digit() {
                    num_str.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            if let Ok(n) = num_str.parse::<i32>() {
                tokens.push(Token::Number(n));
            }
            continue;
        }
        if ch.is_alphabetic() {
            let mut word = String::new();
            while let Some(&c) = chars.peek() {
                if c.is_alphabetic() {
                    word.push(c);
                    chars.next();
                } else {
                    break;
                }
            }
            tokens.push(Token::Word(word.to_lowercase()));
            continue;
        }
        // Skip other characters
        chars.next();
    }

    tokens
}

/// Try to parse "N:M" or "N : M" or "N:M-E" patterns.
fn try_colon_pattern(tokens: &[Token], book_match: &BookMatch) -> Option<VerseRef> {
    // Look for: Number Colon Number [Dash Number]
    for i in 0..tokens.len() {
        if let Token::Number(chapter) = &tokens[i] {
            if i + 2 < tokens.len()
                && matches!(&tokens[i + 1], Token::Colon)
            {
                if let Token::Number(verse) = &tokens[i + 2] {
                    let mut verse_end = None;
                    if i + 4 < tokens.len()
                        && matches!(&tokens[i + 3], Token::Dash)
                    {
                        if let Token::Number(end) = &tokens[i + 4] {
                            verse_end = Some(*end);
                        }
                    }
                    return Some(VerseRef {
                        book_number: book_match.book_number,
                        book_name: book_match.book_name.clone(),
                        chapter: *chapter,
                        verse_start: *verse,
                        verse_end,
                    });
                }
            }
            // Don't break here; keep looking for a colon pattern
        }
    }
    None
}

/// Try to parse "chapter N verse M" pattern.
/// Handles filler words between chapter and verse:
/// "chapter six we will be reading from verse 10 to verse 16" → 6:10-16
/// Also handles: "let's go to chapter 3 verse 2 to verse 3" → 3:2-3
fn try_chapter_verse_spoken(tokens: &[Token], book_match: &BookMatch) -> Option<VerseRef> {
    for i in 0..tokens.len() {
        if let Token::Word(w) = &tokens[i] {
            if w == "chapter" {
                // Next token(s) should be a number (digit or spoken)
                if let Some((chapter, next_idx)) = consume_number(tokens, i + 1) {
                    // Scan forward (up to 15 tokens) looking for "verse" keyword.
                    // Extended from 12 to 15 to handle longer phrases like:
                    // "let's go to chapter 3 verse 2 to verse 3"
                    let scan_limit = (next_idx + 15).min(tokens.len());
                    for j in next_idx..scan_limit {
                        if let Token::Word(vw) = &tokens[j] {
                            if vw == "verse" || vw == "verses" {
                                if let Some((verse, verse_next)) =
                                    consume_number(tokens, j + 1)
                                {
                                    let verse_end = scan_verse_end(tokens, verse_next);
                                    return Some(VerseRef {
                                        book_number: book_match.book_number,
                                        book_name: book_match.book_name.clone(),
                                        chapter,
                                        verse_start: verse,
                                        verse_end,
                                    });
                                }
                            }
                        }
                    }
                    // No verse keyword found, treat as chapter-only
                    return Some(VerseRef {
                        book_number: book_match.book_number,
                        book_name: book_match.book_name.clone(),
                        chapter,
                        verse_start: 0,
                        verse_end: None,
                    });
                }
            }
        }
    }
    None
}

/// Scan for a verse range ending after the verse number.
/// Handles: "to verse 16", "through 18", "- 20", "to 16"
fn scan_verse_end(tokens: &[Token], start: usize) -> Option<i32> {
    if start >= tokens.len() {
        return None;
    }
    // Check for dash: "10-16"
    if matches!(&tokens[start], Token::Dash) {
        if let Some((end, _)) = consume_number(tokens, start + 1) {
            return Some(end);
        }
    }
    // Check for "to" or "through"
    if let Token::Word(tw) = &tokens[start] {
        if tw == "to" || tw == "through" {
            let next = start + 1;
            if next < tokens.len() {
                // "to verse 16" pattern
                if let Token::Word(vw) = &tokens[next] {
                    if vw == "verse" || vw == "verses" {
                        if let Some((end, _)) = consume_number(tokens, next + 1) {
                            return Some(end);
                        }
                    }
                }
                // "to 16" pattern (no "verse" keyword)
                if let Some((end, _)) = consume_number(tokens, next) {
                    return Some(end);
                }
            }
        }
    }
    None
}

/// Try to parse "N verse M" pattern (number followed by "verse" keyword).
/// Also scans forward for "verse" with filler words: "6 and we read verse 10"
fn try_number_verse_pattern(tokens: &[Token], book_match: &BookMatch) -> Option<VerseRef> {
    for i in 0..tokens.len() {
        if let Some((chapter, next_idx)) = consume_number_at(tokens, i) {
            // Scan forward for "verse" keyword (allow filler)
            let scan_limit = (next_idx + 10).min(tokens.len());
            for j in next_idx..scan_limit {
                if let Token::Word(w) = &tokens[j] {
                    if w == "verse" || w == "verses" {
                        if let Some((verse, verse_next)) = consume_number(tokens, j + 1) {
                            let verse_end = scan_verse_end(tokens, verse_next);
                            return Some(VerseRef {
                                book_number: book_match.book_number,
                                book_name: book_match.book_name.clone(),
                                chapter,
                                verse_start: verse,
                                verse_end,
                            });
                        }
                    }
                }
            }
        }
    }
    None
}

/// Try to parse spoken number sequences like "thirty two verse one".
fn try_spoken_numbers(tokens: &[Token], book_match: &BookMatch) -> Option<VerseRef> {
    // Try to consume a spoken number at position 0, then look for "verse" keyword
    if let Some((chapter, next_idx)) = consume_number(tokens, 0) {
        if next_idx < tokens.len() {
            if let Token::Word(w) = &tokens[next_idx] {
                if w == "verse" || w == "verses" {
                    if let Some((verse, verse_next)) = consume_number(tokens, next_idx + 1) {
                        let mut verse_end = None;
                        if verse_next < tokens.len() {
                            if matches!(&tokens[verse_next], Token::Dash) {
                                if let Some((end, _)) = consume_number(tokens, verse_next + 1) {
                                    verse_end = Some(end);
                                }
                            }
                            if let Token::Word(tw) = &tokens[verse_next] {
                                if tw == "through" || tw == "to" {
                                    if let Some((end, _)) = consume_number(tokens, verse_next + 1) {
                                        verse_end = Some(end);
                                    }
                                }
                            }
                        }
                        return Some(VerseRef {
                            book_number: book_match.book_number,
                            book_name: book_match.book_name.clone(),
                            chapter,
                            verse_start: verse,
                            verse_end,
                        });
                    }
                }
            }
        }
    }
    None
}

/// Try to parse two consecutive numbers "N M" as chapter and verse.
/// Handles: "3 16", "119 105", and also spoken: "three sixteen"
fn try_two_numbers(tokens: &[Token], book_match: &BookMatch) -> Option<VerseRef> {
    if let Some((chapter, next_idx)) = consume_number_at(tokens, 0) {
        if chapter > 0 {
            if let Some((verse, verse_next)) = consume_number_at(tokens, next_idx) {
                if verse > 0 {
                    // Check for range: "3 16-18" or "3 16 through 18"
                    let mut verse_end = None;
                    if verse_next < tokens.len() {
                        if matches!(&tokens[verse_next], Token::Dash) {
                            if let Some((end, _)) = consume_number(tokens, verse_next + 1) {
                                verse_end = Some(end);
                            }
                        }
                        if let Token::Word(tw) = &tokens[verse_next] {
                            if tw == "through" || tw == "to" {
                                if let Some((end, _)) = consume_number(tokens, verse_next + 1) {
                                    verse_end = Some(end);
                                }
                            }
                        }
                    }
                    return Some(VerseRef {
                        book_number: book_match.book_number,
                        book_name: book_match.book_name.clone(),
                        chapter,
                        verse_start: verse,
                        verse_end,
                    });
                }
            }
        }
    }
    None
}

/// Try to extract a number from a single token.
fn token_to_number(token: &Token) -> Option<i32> {
    match token {
        Token::Number(n) => Some(*n),
        Token::Word(w) => parse_spoken_number(w),
        _ => None,
    }
}

/// Try to consume a number at the given token position.
/// Returns (number, `next_token_index`) if successful.
/// Handles both digit tokens and spoken number words (including compounds like "thirty two").
fn consume_number(tokens: &[Token], start: usize) -> Option<(i32, usize)> {
    if start >= tokens.len() {
        return None;
    }
    consume_number_at(tokens, start)
}

/// Consume a number starting at position `start`.
/// Handles compound spoken numbers like "thirty two", "one hundred fifty".
fn consume_number_at(tokens: &[Token], start: usize) -> Option<(i32, usize)> {
    if start >= tokens.len() {
        return None;
    }

    // If it's a digit number, return it directly
    if let Token::Number(n) = &tokens[start] {
        return Some((*n, start + 1));
    }

    // Try to parse spoken number words
    if let Token::Word(w) = &tokens[start] {
        if let Some(n) = parse_spoken_number(w) {
            // Check if this is "hundred" — if so, look for more
            if w == "hundred" {
                // Shouldn't start with "hundred" alone without context
                return Some((n, start + 1));
            }

            // If n >= 100, it's already compound (e.g., won't happen with single words)
            // If n is a tens value (20, 30, ..., 90), look for a ones digit next
            if n >= 20 && n % 10 == 0 && start + 1 < tokens.len() {
                if let Token::Word(next_w) = &tokens[start + 1] {
                    if let Some(ones) = parse_spoken_number(next_w) {
                        if (1..=9).contains(&ones) {
                            let combined = n + ones;
                            // Check for "hundred" after tens+ones
                            if start + 2 < tokens.len() {
                                if let Token::Word(hw) = &tokens[start + 2] {
                                    if hw == "hundred" {
                                        // e.g., "one hundred" — but we're at "thirty two hundred"?
                                        // This is unusual, so skip
                                        return Some((combined, start + 2));
                                    }
                                }
                            }
                            return Some((combined, start + 2));
                        }
                    }
                }
            }

            // Check if next word is "hundred"
            if (1..=9).contains(&n) && start + 1 < tokens.len() {
                if let Token::Word(next_w) = &tokens[start + 1] {
                    if next_w == "hundred" {
                        let base = n * 100;
                        // Look for more after "hundred"
                        if start + 2 < tokens.len() {
                            if let Token::Word(w2) = &tokens[start + 2] {
                                // Skip optional "and"
                                let skip = usize::from(w2 == "and");
                                if let Some((rest, rest_idx)) =
                                    consume_number_at(tokens, start + 2 + skip)
                                {
                                    if rest < 100 {
                                        return Some((base + rest, rest_idx));
                                    }
                                }
                            }
                            if let Token::Number(n2) = &tokens[start + 2] {
                                if *n2 < 100 {
                                    return Some((base + n2, start + 3));
                                }
                            }
                        }
                        return Some((base, start + 2));
                    }
                }
            }

            return Some((n, start + 1));
        }
    }

    None
}

/// Convert a spoken number word to an integer.
/// Supports "one" through "twenty", tens "thirty" through "ninety",
/// and "hundred". Returns None if the word is not a recognized number.
pub fn parse_spoken_number(word: &str) -> Option<i32> {
    match word.to_lowercase().as_str() {
        "zero" => Some(0),
        "one" => Some(1),
        "two" => Some(2),
        "three" => Some(3),
        "four" => Some(4),
        "five" => Some(5),
        "six" => Some(6),
        "seven" => Some(7),
        "eight" => Some(8),
        "nine" => Some(9),
        "ten" => Some(10),
        "eleven" => Some(11),
        "twelve" => Some(12),
        "thirteen" => Some(13),
        "fourteen" => Some(14),
        "fifteen" => Some(15),
        "sixteen" => Some(16),
        "seventeen" => Some(17),
        "eighteen" => Some(18),
        "nineteen" => Some(19),
        "twenty" => Some(20),
        "thirty" => Some(30),
        "forty" => Some(40),
        "fifty" => Some(50),
        "sixty" => Some(60),
        "seventy" => Some(70),
        "eighty" => Some(80),
        "ninety" => Some(90),
        "hundred" => Some(100),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::direct::automaton::BookMatch;

    fn make_book_match(name: &str, number: i32, end: usize) -> BookMatch {
        BookMatch {
            book_number: number,
            book_name: name.to_string(),
            start: 0,
            end,
        }
    }

    #[test]
    fn test_colon_reference() {
        let bm = make_book_match("John", 43, 4);
        let text = "John 3:16 says something";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 16);
        assert!(result.verse_end.is_none());
    }

    #[test]
    fn test_colon_range() {
        let bm = make_book_match("Romans", 45, 6);
        let text = "Romans 8:28-30 is powerful";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 8);
        assert_eq!(result.verse_start, 28);
        assert_eq!(result.verse_end, Some(30));
    }

    #[test]
    fn test_spoken_chapter_verse() {
        let bm = make_book_match("Psalms", 19, 5);
        let text = "Psalm thirty two verse one now says";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 32);
        assert_eq!(result.verse_start, 1);
    }

    #[test]
    fn test_chapter_only() {
        let bm = make_book_match("Genesis", 1, 7);
        let text = "Genesis 3 is about the fall";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 0);
    }

    #[test]
    fn test_chapter_verse_keywords() {
        let bm = make_book_match("Isaiah", 23, 6);
        let text = "Isaiah chapter 53 verse 5";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 53);
        assert_eq!(result.verse_start, 5);
    }

    #[test]
    fn test_two_numbers_space_separated() {
        let bm = make_book_match("John", 43, 4);
        let text = "John 3 16 for God so loved";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 16);
    }

    #[test]
    fn test_two_numbers_genesis() {
        let bm = make_book_match("Genesis", 1, 7);
        let text = "Genesis 1 1 in the beginning";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 1);
        assert_eq!(result.verse_start, 1);
    }

    #[test]
    fn test_two_numbers_large() {
        let bm = make_book_match("Psalms", 19, 5);
        let text = "Psalm 119 105 thy word is a lamp";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 119);
        assert_eq!(result.verse_start, 105);
    }

    #[test]
    fn test_spoken_number_parser() {
        assert_eq!(parse_spoken_number("one"), Some(1));
        assert_eq!(parse_spoken_number("twenty"), Some(20));
        assert_eq!(parse_spoken_number("thirty"), Some(30));
        assert_eq!(parse_spoken_number("hundred"), Some(100));
        assert_eq!(parse_spoken_number("dog"), None);
    }

    #[test]
    fn test_chapter_verse_with_filler_words() {
        let bm = make_book_match("Ephesians", 49, 10);
        let text = "Ephesians chapter six we will be reading from verse 10 to verse 16";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 6);
        assert_eq!(result.verse_start, 10);
        assert_eq!(result.verse_end, Some(16));
    }

    #[test]
    fn test_chapter_verse_with_and_filler() {
        let bm = make_book_match("John", 43, 4);
        let text = "John chapter three and I want us to look at verse sixteen";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 16);
    }

    #[test]
    fn test_chapter_verse_range_to() {
        let bm = make_book_match("Genesis", 1, 7);
        let text = "Genesis chapter one verse one to verse five";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 1);
        assert_eq!(result.verse_start, 1);
        assert_eq!(result.verse_end, Some(5));
    }

    #[test]
    fn test_number_verse_with_filler() {
        let bm = make_book_match("Romans", 45, 6);
        let text = "Romans 8 and let's look at verse 28";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 8);
        assert_eq!(result.verse_start, 28);
    }

    #[test]
    fn test_lets_go_to_with_range() {
        // Issue: "let's go to Genesis 3 verse 2 to verse 3"
        let bm = make_book_match("Genesis", 1, 7);
        let text = "Genesis let's go to chapter 3 verse 2 to verse 3";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 2);
        assert_eq!(result.verse_end, Some(3));
    }

    #[test]
    fn test_genesis_without_chapter_keyword() {
        // Direct pattern: "Genesis 3 verse 2 to verse 3"
        let bm = make_book_match("Genesis", 1, 7);
        let text = "Genesis 3 verse 2 to verse 3";
        let result = parse_reference(text, &bm).unwrap();
        assert_eq!(result.chapter, 3);
        assert_eq!(result.verse_start, 2);
        assert_eq!(result.verse_end, Some(3));
    }
}
