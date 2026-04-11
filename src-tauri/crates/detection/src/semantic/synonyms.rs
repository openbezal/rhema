use std::collections::HashMap;

/// Maximum number of expanded query variants returned (excluding the original).
const MAX_EXPANSIONS: usize = 3;

/// Pre-processing module that expands search queries with biblical synonyms
/// before embedding for semantic search.
///
/// When a user says "God saved the world", the expander produces additional
/// variants like "God rescued the world", "God redeemed the world", etc.
/// so the embedding step can catch verse matches that use different vocabulary.
pub struct SynonymExpander {
    synonyms: HashMap<String, Vec<String>>,
}

impl Default for SynonymExpander {
    fn default() -> Self {
        Self::new()
    }
}

impl SynonymExpander {
    /// Build a new expander pre-loaded with the biblical synonym database.
    #[expect(clippy::too_many_lines, reason = "synonym table is a large data definition")]
    pub fn new() -> Self {
        let mut synonyms: HashMap<String, Vec<String>> = HashMap::new();

        // Helper: register a group so that every word maps to all the others.
        let groups: Vec<Vec<&str>> = vec![
            // ── Salvation ──────────────────────────────────────────────
            vec![
                "save", "rescue", "deliver", "redeem", "redemption", "salvation",
                "liberate", "free", "ransom", "atone", "saved", "rescued",
                "delivered", "redeemed", "liberated", "freed", "ransomed",
                "atoned", "savior", "redeemer", "deliverer", "liberator",
            ],
            // ── Faith ──────────────────────────────────────────────────
            vec![
                "faith", "trust", "believe", "confidence", "assurance",
                "conviction", "reliance", "devotion", "fidelity", "loyalty",
                "believed", "trusted", "faithful", "trustworthy", "believing",
            ],
            // ── Love ───────────────────────────────────────────────────
            vec![
                "love", "compassion", "mercy", "grace", "kindness",
                "affection", "charity", "tenderness", "devotion", "benevolence",
                "loved", "loving", "merciful", "gracious", "kind",
                "compassionate", "charitable", "tender", "benevolent",
            ],
            // ── Sin ────────────────────────────────────────────────────
            vec![
                "sin", "transgression", "iniquity", "wickedness", "trespass",
                "wrongdoing", "offense", "rebellion", "disobedience", "evil",
                "sinned", "sinful", "transgressed", "wicked", "rebellious",
                "disobedient", "sinner", "trespassed", "offended",
            ],
            // ── Righteousness ──────────────────────────────────────────
            vec![
                "righteous", "just", "holy", "pure", "blameless", "upright",
                "virtuous", "godly", "devout", "sanctified", "righteousness",
                "justice", "holiness", "purity", "sanctification", "virtue",
                "godliness", "uprightness", "piety", "sanctify",
            ],
            // ── Prayer ─────────────────────────────────────────────────
            vec![
                "pray", "petition", "intercede", "supplicate", "beseech",
                "entreat", "implore", "appeal", "seek", "prayer",
                "prayed", "praying", "intercession", "supplication",
                "beseeched", "entreated", "implored", "appealed",
            ],
            // ── Kingdom ────────────────────────────────────────────────
            vec![
                "kingdom", "reign", "dominion", "rule", "throne", "authority",
                "sovereignty", "power", "government", "empire", "reigning",
                "ruling", "sovereign", "powerful", "dominions", "thrones",
                "authorities", "kingdoms",
            ],
            // ── Death ──────────────────────────────────────────────────
            vec![
                "death", "die", "perish", "destruction", "grave", "tomb",
                "mortality", "end", "expire", "depart", "died", "dead",
                "dying", "perished", "destroyed", "mortal", "expired",
                "departed", "slain", "slay",
            ],
            // ── Life ───────────────────────────────────────────────────
            vec![
                "life", "live", "alive", "eternal", "everlasting", "immortal",
                "breath", "exist", "abide", "dwell", "living", "lived",
                "immortality", "eternity", "existence", "breathe", "abiding",
                "dwelling", "vitality",
            ],
            // ── Punishment ─────────────────────────────────────────────
            vec![
                "punish", "judge", "condemn", "wrath", "anger", "fury",
                "vengeance", "retribution", "chastise", "discipline",
                "punished", "judged", "condemned", "wrathful", "angry",
                "furious", "chastised", "disciplined", "judgment",
                "condemnation", "punishment",
            ],
            // ── Forgiveness ────────────────────────────────────────────
            vec![
                "forgive", "pardon", "absolve", "remit", "mercy", "clemency",
                "acquit", "release", "amnesty", "reconcile", "forgiven",
                "pardoned", "absolved", "acquitted", "released", "reconciled",
                "forgiveness", "reconciliation",
            ],
            // ── Blessing ───────────────────────────────────────────────
            vec![
                "bless", "favor", "gift", "grace", "bounty", "prosperity",
                "benefit", "bestow", "enrich", "reward", "blessed", "blessing",
                "favored", "gifted", "bestowed", "enriched", "rewarded",
                "prosperous", "bountiful",
            ],
            // ── Worship ────────────────────────────────────────────────
            vec![
                "worship", "praise", "glorify", "adore", "exalt", "magnify",
                "honor", "revere", "venerate", "acclaim", "worshipped",
                "praised", "glorified", "adored", "exalted", "magnified",
                "honored", "revered", "venerated", "acclaimed",
            ],
            // ── Creation ───────────────────────────────────────────────
            vec![
                "create", "make", "form", "fashion", "mold", "shape",
                "establish", "ordain", "build", "design", "created", "made",
                "formed", "fashioned", "molded", "shaped", "established",
                "ordained", "built", "designed", "creator", "maker",
            ],
            // ── Covenant ───────────────────────────────────────────────
            vec![
                "covenant", "promise", "oath", "vow", "agreement", "testament",
                "pledge", "pact", "bond", "contract", "promised", "vowed",
                "pledged", "covenanted", "sworn",
            ],
            // ── Shepherd ───────────────────────────────────────────────
            vec![
                "shepherd", "pastor", "guide", "lead", "tend", "watch",
                "guard", "protect", "care", "oversee", "shepherded",
                "pastored", "guided", "led", "tended", "watched", "guarded",
                "protected", "cared", "oversaw",
            ],
            // ── Servant ────────────────────────────────────────────────
            vec![
                "servant", "slave", "minister", "attendant", "steward",
                "worker", "helper", "bondservant", "disciple", "follower",
                "serve", "served", "serving", "ministered", "ministering",
            ],
            // ── Bread / Food ───────────────────────────────────────────
            vec![
                "bread", "food", "nourishment", "sustenance", "provision",
                "manna", "feast", "table", "meal", "grain", "nourish",
                "sustain", "provide", "fed", "feed",
            ],
            // ── Water ──────────────────────────────────────────────────
            vec![
                "water", "river", "stream", "fountain", "well", "spring",
                "flood", "sea", "rain", "drink", "waters", "rivers",
                "streams", "fountains", "springs", "floods", "seas",
            ],
            // ── Light ──────────────────────────────────────────────────
            vec![
                "light", "lamp", "shine", "illuminate", "radiance", "glory",
                "brightness", "beacon", "flame", "fire", "shining", "shone",
                "illuminated", "glorious", "bright", "radiant", "luminous",
            ],
            // ── Darkness ───────────────────────────────────────────────
            vec![
                "darkness", "night", "shadow", "gloom", "blindness",
                "ignorance", "void", "abyss", "pit", "dark", "shadowy",
                "gloomy", "blind", "blinded",
            ],
            // ── Praise / Joy ───────────────────────────────────────────
            vec![
                "joy", "rejoice", "gladness", "delight", "jubilation",
                "celebration", "triumph", "happiness", "merry", "cheerful",
                "joyful", "joyous", "rejoiced", "delighted", "triumphant",
            ],
            // ── Fear / Awe ─────────────────────────────────────────────
            vec![
                "fear", "awe", "dread", "terror", "reverence", "trembling",
                "alarm", "fright", "afraid", "fearful", "awed", "terrified",
                "reverent", "trembled",
            ],
            // ── Prophet / Prophecy ─────────────────────────────────────
            vec![
                "prophet", "prophecy", "prophesy", "seer", "oracle", "vision",
                "revelation", "foretell", "declare", "proclaim", "prophesied",
                "prophetic", "declared", "proclaimed", "revealed",
            ],
            // ── Heal / Restore ─────────────────────────────────────────
            vec![
                "heal", "restore", "cure", "recover", "renew", "repair",
                "mend", "cleanse", "purify", "wholeness", "healed",
                "restored", "cured", "recovered", "renewed", "cleansed",
                "purified", "healing", "restoration",
            ],
            // ── Teach / Wisdom ─────────────────────────────────────────
            vec![
                "teach", "wisdom", "instruct", "knowledge", "understanding",
                "discernment", "insight", "counsel", "guidance", "learn",
                "taught", "instructed", "wise", "learned", "discerning",
                "insightful",
            ],
            // ── Strength / Power ───────────────────────────────────────
            vec![
                "strength", "power", "might", "force", "fortitude", "vigor",
                "endurance", "resilience", "ability", "strong", "powerful",
                "mighty", "strengthen", "strengthened", "empowered",
                "empower",
            ],
            // ── Peace / Rest ───────────────────────────────────────────
            vec![
                "peace", "rest", "calm", "tranquility", "serenity",
                "stillness", "quiet", "harmony", "comfort", "repose",
                "peaceful", "restful", "calmed", "comforted", "serene",
            ],
            // ── Sacrifice / Offering ───────────────────────────────────
            vec![
                "sacrifice", "offering", "oblation", "burnt", "altar",
                "tithe", "tribute", "dedication", "consecrate", "devote",
                "sacrificed", "offered", "consecrated", "devoted",
                "dedicating",
            ],
            // ── Angel / Messenger ──────────────────────────────────────
            vec![
                "angel", "messenger", "seraph", "cherub", "archangel",
                "heavenly", "celestial", "host", "guardian", "minister",
                "angels", "messengers", "seraphim", "cherubim",
            ],
            // ── Temple / Sanctuary ─────────────────────────────────────
            vec![
                "temple", "sanctuary", "tabernacle", "shrine", "altar",
                "dwelling", "habitation", "house", "sacred", "consecrated",
                "temples", "sanctuaries", "tabernacles",
            ],
            // ── Repent / Turn ──────────────────────────────────────────
            vec![
                "repent", "turn", "return", "convert", "change", "reform",
                "amend", "confess", "humble", "contrite", "repented",
                "repentance", "converted", "confessed", "humbled",
                "contrition",
            ],
            // ── Hope / Promise ─────────────────────────────────────────
            vec![
                "hope", "expect", "await", "anticipate", "trust", "assurance",
                "confidence", "longing", "desire", "aspire", "hoped",
                "expected", "awaited", "anticipated", "hopeful",
            ],
            // ── Battle / War ───────────────────────────────────────────
            vec![
                "battle", "war", "fight", "conflict", "combat", "struggle",
                "warfare", "conquer", "defeat", "victory", "fought",
                "conquered", "defeated", "victorious", "warrior",
            ],
            // ── Mercy / Compassion ─────────────────────────────────────
            vec![
                "mercy", "compassion", "pity", "sympathy", "empathy",
                "gentleness", "leniency", "forbearance", "patience",
                "longsuffering", "merciful", "compassionate", "gentle",
                "patient", "forbearing",
            ],
            // ── Glory / Honor ──────────────────────────────────────────
            vec![
                "glory", "honor", "majesty", "splendor", "magnificence",
                "grandeur", "dignity", "fame", "renown", "distinction",
                "glorious", "honorable", "majestic", "splendid",
                "magnificent",
            ],
            // ── Word / Scripture ────────────────────────────────────────
            vec![
                "word", "scripture", "commandment", "law", "statute",
                "precept", "decree", "ordinance", "testimony", "teaching",
                "words", "scriptures", "commandments", "laws", "statutes",
            ],
            // ── Spirit / Soul ──────────────────────────────────────────
            vec![
                "spirit", "soul", "breath", "ghost", "inner", "heart",
                "mind", "conscience", "essence", "being", "spirits",
                "souls", "spiritual",
            ],
            // ── Heaven / Eternal Home ──────────────────────────────────
            vec![
                "heaven", "paradise", "eternity", "celestial", "glory",
                "dwelling", "mansion", "abode", "hereafter", "inheritance",
                "heavens", "heavenly", "eternal",
            ],
            // ── Hell / Judgment ────────────────────────────────────────
            vec![
                "hell", "gehenna", "hades", "sheol", "perdition",
                "damnation", "lake", "torment", "destruction", "abyss",
                "inferno", "underworld",
            ],
            // ── Blood / Atonement ──────────────────────────────────────
            vec![
                "blood", "atonement", "propitiation", "expiation",
                "sacrifice", "offering", "lamb", "passover", "cleansing",
                "shedding", "shed", "sprinkle", "sprinkled",
            ],
            // ── Cross / Suffering ──────────────────────────────────────
            vec![
                "cross", "suffering", "crucify", "crucifixion", "agony",
                "affliction", "tribulation", "persecution", "trial",
                "burden", "crucified", "suffered", "afflicted",
                "persecuted", "burdened",
            ],
            // ── Resurrection / Rise ────────────────────────────────────
            vec![
                "resurrection", "rise", "risen", "raised", "ascend",
                "ascension", "arise", "arose", "awaken", "restore",
                "resurrected", "ascending", "ascended", "awakened",
            ],
            // ── Baptism / Cleansing ────────────────────────────────────
            vec![
                "baptism", "baptize", "immerse", "cleanse", "wash",
                "purify", "sprinkle", "consecrate", "dedicate", "anoint",
                "baptized", "immersed", "cleansed", "washed", "purified",
                "anointed",
            ],
            // ── Church / Assembly ──────────────────────────────────────
            vec![
                "church", "assembly", "congregation", "gathering", "body",
                "fellowship", "community", "flock", "brethren", "believers",
                "churches", "assemblies", "congregations",
            ],
            // ── Gospel / Good News ─────────────────────────────────────
            vec![
                "gospel", "good news", "glad tidings", "message",
                "proclamation", "testimony", "witness", "evangel",
                "preaching", "declaration",
            ],
        ];

        for group in &groups {
            for &word in group {
                let key = word.to_lowercase();
                let others: Vec<String> = group
                    .iter()
                    .filter(|&&w| w.to_lowercase() != key)
                    .map(|&w| w.to_lowercase())
                    .collect();
                synonyms
                    .entry(key)
                    .and_modify(|existing| {
                        for o in &others {
                            if !existing.contains(o) {
                                existing.push(o.clone());
                            }
                        }
                    })
                    .or_insert(others);
            }
        }

        Self { synonyms }
    }

    /// Expand a query by replacing key words with synonym variants.
    ///
    /// Returns a `Vec` whose first element is always the original query,
    /// followed by up to [`MAX_EXPANSIONS`] variants where one recognized
    /// word has been replaced with a synonym.
    pub fn expand(&self, query: &str) -> Vec<String> {
        let mut results = vec![query.to_string()];

        let words: Vec<&str> = query.split_whitespace().collect();
        if words.is_empty() {
            return results;
        }

        // Find the first word that has synonyms (by lowercase lookup) and
        // generate variants by substituting different synonyms for it.
        for (idx, &word) in words.iter().enumerate() {
            let normalized = word
                .trim_matches(|c: char| !c.is_alphanumeric())
                .to_lowercase();
            if normalized.is_empty() {
                continue;
            }

            if let Some(syns) = self.synonyms.get(&normalized) {
                let mut count = 0;
                for syn in syns {
                    if count >= MAX_EXPANSIONS {
                        break;
                    }
                    // Skip if the synonym is the same as the original word
                    if syn == &normalized {
                        continue;
                    }
                    let mut new_words: Vec<String> =
                        words.iter().map(std::string::ToString::to_string).collect();
                    // Preserve leading/trailing punctuation from the original word
                    let prefix: String = word
                        .chars()
                        .take_while(|c| !c.is_alphanumeric())
                        .collect();
                    let suffix: String = word
                        .chars()
                        .rev()
                        .take_while(|c| !c.is_alphanumeric())
                        .collect::<String>()
                        .chars()
                        .rev()
                        .collect();
                    new_words[idx] = format!("{prefix}{syn}{suffix}");
                    let variant = new_words.join(" ");
                    if !results.contains(&variant) {
                        results.push(variant);
                        count += 1;
                    }
                }
                // Only expand on the first matching word to keep variants simple.
                if count > 0 {
                    break;
                }
            }
        }

        results
    }

    /// Return the number of entries in the synonym database.
    pub fn entry_count(&self) -> usize {
        self.synonyms.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synonym_expansion() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("God saved the world");
        assert!(variants.len() > 1, "Expected more than 1 variant, got {}", variants.len());
        // The original query should always be first.
        assert_eq!(variants[0], "God saved the world");
        // Should include variants with "rescue", "redeem", "deliver" etc.
        assert!(
            variants
                .iter()
                .any(|v| v.contains("rescue")
                    || v.contains("redeem")
                    || v.contains("deliver")),
            "Expected at least one variant with rescue/redeem/deliver, got: {:?}",
            variants
        );
    }

    #[test]
    fn test_original_always_first() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("the Lord is my shepherd");
        assert_eq!(variants[0], "the Lord is my shepherd");
    }

    #[test]
    fn test_max_expansions() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("God saved the world");
        // Original + up to MAX_EXPANSIONS variants
        assert!(variants.len() <= MAX_EXPANSIONS + 1);
    }

    #[test]
    fn test_no_synonyms_returns_original() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("xyzzy foobar baz");
        assert_eq!(variants.len(), 1);
        assert_eq!(variants[0], "xyzzy foobar baz");
    }

    #[test]
    fn test_empty_input() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("");
        assert_eq!(variants.len(), 1);
        assert_eq!(variants[0], "");
    }

    #[test]
    fn test_database_has_500_plus_entries() {
        let expander = SynonymExpander::new();
        assert!(
            expander.entry_count() >= 500,
            "Expected 500+ synonym entries, got {}",
            expander.entry_count()
        );
    }

    #[test]
    fn test_faith_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("have faith in God");
        assert!(variants.len() > 1);
        assert!(
            variants
                .iter()
                .any(|v| v.contains("trust")
                    || v.contains("believe")
                    || v.contains("confidence")),
            "Expected faith synonyms, got: {:?}",
            variants
        );
    }

    #[test]
    fn test_sin_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("the sin of man");
        assert!(variants.len() > 1);
        assert!(
            variants
                .iter()
                .any(|v| v.contains("transgression")
                    || v.contains("iniquity")
                    || v.contains("wickedness")),
            "Expected sin synonyms, got: {:?}",
            variants
        );
    }

    #[test]
    fn test_forgiveness_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("please forgive me");
        assert!(variants.len() > 1);
        assert!(
            variants
                .iter()
                .any(|v| v.contains("pardon")
                    || v.contains("absolve")
                    || v.contains("remit")),
            "Expected forgiveness synonyms, got: {:?}",
            variants
        );
    }

    #[test]
    fn test_punctuation_preserved() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("God saved the world.");
        // The original should keep its punctuation
        assert_eq!(variants[0], "God saved the world.");
    }

    #[test]
    fn test_worship_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("we worship the Lord");
        assert!(variants.len() > 1);
        assert!(
            variants
                .iter()
                .any(|v| v.contains("praise")
                    || v.contains("glorify")
                    || v.contains("adore")
                    || v.contains("exalt")),
            "Expected worship synonyms, got: {:?}",
            variants
        );
    }

    #[test]
    fn test_light_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("the light of the world");
        assert!(variants.len() > 1);
    }

    #[test]
    fn test_death_synonyms() {
        let expander = SynonymExpander::new();
        let variants = expander.expand("overcome death and sorrow");
        assert!(variants.len() > 1);
        assert!(
            variants
                .iter()
                .any(|v| v.contains("die")
                    || v.contains("perish")
                    || v.contains("destruction")
                    || v.contains("grave")),
            "Expected death synonyms, got: {:?}",
            variants
        );
    }
}
