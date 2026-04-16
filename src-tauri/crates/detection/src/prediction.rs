use serde::Serialize;

use crate::types::VerseRef;
use crate::ReadingMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum PredictionStrategy {
    Sequential,
    ReadingMode,
}

impl std::fmt::Display for PredictionStrategy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PredictionStrategy::Sequential => write!(f, "sequential"),
            PredictionStrategy::ReadingMode => write!(f, "reading_mode"),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VersePrediction {
    pub verse_ref: VerseRef,
    pub verse_text: String,
    pub confidence: f64,
    pub strategy: PredictionStrategy,
}

pub struct VersePredictor {
    max_predictions: usize,
    current_book: Option<i32>,
    current_chapter: Option<i32>,
    current_verse: Option<i32>,
}

impl VersePredictor {
    pub fn new() -> Self {
        Self {
            max_predictions: 5,
            current_book: None,
            current_chapter: None,
            current_verse: None,
        }
    }

    pub fn with_max_predictions(max: usize) -> Self {
        Self {
            max_predictions: max,
            current_book: None,
            current_chapter: None,
            current_verse: None,
        }
    }

    pub fn max_predictions(&self) -> usize {
        self.max_predictions
    }

    pub fn set_max_predictions(&mut self, max: usize) {
        self.max_predictions = max;
    }

    pub fn update_from_detection(&mut self, book_number: i32, chapter: i32, verse: i32) {
        self.current_book = Some(book_number);
        self.current_chapter = Some(chapter);
        self.current_verse = Some(verse);
    }

    pub fn update_from_reading_mode(&mut self, reading_mode: &ReadingMode) {
        if reading_mode.is_active() {
            self.current_book = Some(reading_mode.current_book());
            self.current_chapter = Some(reading_mode.current_chapter());
            self.current_verse = reading_mode.current_verse();
        }
    }

    pub fn predict(&self) -> Vec<VersePrediction> {
        let mut predictions = Vec::new();

        let (book_number, chapter, verse) =
            match (self.current_book, self.current_chapter, self.current_verse) {
                (Some(book), Some(ch), Some(v)) => (book, ch, v),
                _ => return predictions,
            };

        let next_verse = verse + 1;
        predictions.push(VersePrediction {
            verse_ref: VerseRef {
                book_number,
                book_name: String::new(),
                chapter,
                verse_start: next_verse,
                verse_end: None,
            },
            verse_text: "next verse".to_string(),
            confidence: 0.85,
            strategy: PredictionStrategy::Sequential,
        });

        if predictions.len() < self.max_predictions {
            let next_next = verse + 2;
            predictions.push(VersePrediction {
                verse_ref: VerseRef {
                    book_number,
                    book_name: String::new(),
                    chapter,
                    verse_start: next_next,
                    verse_end: None,
                },
                verse_text: "verse after next".to_string(),
                confidence: 0.70,
                strategy: PredictionStrategy::Sequential,
            });
        }

        predictions.truncate(self.max_predictions);
        predictions
    }

    pub fn predict_from_reading_mode(
        &self,
        reading_mode: &ReadingMode,
        verses_ahead: i32,
    ) -> Vec<VersePrediction> {
        let mut predictions = Vec::new();

        if !reading_mode.is_active() {
            return predictions;
        }

        let book_number = reading_mode.current_book();
        let chapter = reading_mode.current_chapter();
        let current_verse = match reading_mode.current_verse() {
            Some(v) => v,
            None => return predictions,
        };

        for i in 1..=verses_ahead {
            let v = current_verse + i;
            let confidence = (0.95 - (i as f64 * 0.10)).max(0.50);

            predictions.push(VersePrediction {
                verse_ref: VerseRef {
                    book_number,
                    book_name: String::new(),
                    chapter,
                    verse_start: v,
                    verse_end: None,
                },
                verse_text: format!("verse {}", v),
                confidence,
                strategy: PredictionStrategy::ReadingMode,
            });
        }

        predictions
    }
}

impl Default for VersePredictor {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_predictor() {
        let predictor = VersePredictor::new();
        assert_eq!(predictor.max_predictions(), 5);
    }

    #[test]
    fn test_predict_empty() {
        let predictor = VersePredictor::new();
        let predictions = predictor.predict();
        assert!(predictions.is_empty());
    }

    #[test]
    fn test_predict_with_context() {
        let mut predictor = VersePredictor::new();
        predictor.update_from_detection(43, 3, 16);
        let predictions = predictor.predict();
        assert!(!predictions.is_empty());
        assert_eq!(predictions[0].verse_ref.verse_start, 17);
    }
}
