use rhema_core::BookId;

/// Information about a single Bible book.
pub struct BookInfo {
    pub number: BookId,
    pub name: &'static str,
    pub abbreviation: &'static str,
    pub aliases: &'static [&'static str],
}

pub const BOOKS: &[BookInfo] = &[
    // Old Testament
    BookInfo { number: BookId(1), name: "Genesis", abbreviation: "Gen", aliases: &["Gen", "Ge", "Gn"] },
    BookInfo { number: BookId(2), name: "Exodus", abbreviation: "Exod", aliases: &["Exod", "Exo", "Ex"] },
    BookInfo { number: BookId(3), name: "Leviticus", abbreviation: "Lev", aliases: &["Lev", "Le", "Lv"] },
    BookInfo { number: BookId(4), name: "Numbers", abbreviation: "Num", aliases: &["Num", "Nu", "Nm", "Nb"] },
    BookInfo { number: BookId(5), name: "Deuteronomy", abbreviation: "Deut", aliases: &["Deut", "De", "Dt"] },
    BookInfo { number: BookId(6), name: "Joshua", abbreviation: "Josh", aliases: &["Josh", "Jos", "Jsh"] },
    BookInfo { number: BookId(7), name: "Judges", abbreviation: "Judg", aliases: &["Judg", "Jdg", "Jg", "Jdgs"] },
    BookInfo { number: BookId(8), name: "Ruth", abbreviation: "Ruth", aliases: &["Ruth", "Rth", "Ru"] },
    BookInfo {
        number: BookId(9), name: "1 Samuel", abbreviation: "1 Sam",
        aliases: &["1 Sam", "1 Sa", "1Sam", "1Sa", "First Samuel", "1st Samuel", "I Samuel"],
    },
    BookInfo {
        number: BookId(10), name: "2 Samuel", abbreviation: "2 Sam",
        aliases: &["2 Sam", "2 Sa", "2Sam", "2Sa", "Second Samuel", "2nd Samuel", "II Samuel"],
    },
    BookInfo {
        number: BookId(11), name: "1 Kings", abbreviation: "1 Kgs",
        aliases: &["1 Kgs", "1 Ki", "1Kgs", "1Ki", "First Kings", "1st Kings", "I Kings"],
    },
    BookInfo {
        number: BookId(12), name: "2 Kings", abbreviation: "2 Kgs",
        aliases: &["2 Kgs", "2 Ki", "2Kgs", "2Ki", "Second Kings", "2nd Kings", "II Kings"],
    },
    BookInfo {
        number: BookId(13), name: "1 Chronicles", abbreviation: "1 Chr",
        aliases: &["1 Chr", "1 Ch", "1Chr", "1Ch", "First Chronicles", "1st Chronicles", "I Chronicles"],
    },
    BookInfo {
        number: BookId(14), name: "2 Chronicles", abbreviation: "2 Chr",
        aliases: &["2 Chr", "2 Ch", "2Chr", "2Ch", "Second Chronicles", "2nd Chronicles", "II Chronicles"],
    },
    BookInfo { number: BookId(15), name: "Ezra", abbreviation: "Ezra", aliases: &["Ezra", "Ezr"] },
    BookInfo { number: BookId(16), name: "Nehemiah", abbreviation: "Neh", aliases: &["Neh", "Ne"] },
    BookInfo { number: BookId(17), name: "Esther", abbreviation: "Esth", aliases: &["Esth", "Est", "Es"] },
    BookInfo { number: BookId(18), name: "Job", abbreviation: "Job", aliases: &["Job", "Jb"] },
    BookInfo { number: BookId(19), name: "Psalms", abbreviation: "Ps", aliases: &["Psalm", "Psalms", "Ps", "Psa", "Psm", "Pss"] },
    BookInfo { number: BookId(20), name: "Proverbs", abbreviation: "Prov", aliases: &["Prov", "Pro", "Prv", "Pr"] },
    BookInfo { number: BookId(21), name: "Ecclesiastes", abbreviation: "Eccl", aliases: &["Eccl", "Ecc", "Ec", "Qoh"] },
    BookInfo { number: BookId(22), name: "Song of Solomon", abbreviation: "Song", aliases: &["Song", "Song of Solomon", "Song of Songs", "SOS", "So", "Cant"] },
    BookInfo { number: BookId(23), name: "Isaiah", abbreviation: "Isa", aliases: &["Isa", "Is"] },
    BookInfo { number: BookId(24), name: "Jeremiah", abbreviation: "Jer", aliases: &["Jer", "Je", "Jr"] },
    BookInfo { number: BookId(25), name: "Lamentations", abbreviation: "Lam", aliases: &["Lam", "La"] },
    BookInfo { number: BookId(26), name: "Ezekiel", abbreviation: "Ezek", aliases: &["Ezek", "Eze", "Ezk"] },
    BookInfo { number: BookId(27), name: "Daniel", abbreviation: "Dan", aliases: &["Dan", "Da", "Dn"] },
    BookInfo { number: BookId(28), name: "Hosea", abbreviation: "Hos", aliases: &["Hos", "Ho"] },
    BookInfo { number: BookId(29), name: "Joel", abbreviation: "Joel", aliases: &["Joel", "Jl"] },
    BookInfo { number: BookId(30), name: "Amos", abbreviation: "Amos", aliases: &["Amos", "Am"] },
    BookInfo { number: BookId(31), name: "Obadiah", abbreviation: "Obad", aliases: &["Obad", "Ob"] },
    BookInfo { number: BookId(32), name: "Jonah", abbreviation: "Jonah", aliases: &["Jonah", "Jnh", "Jon"] },
    BookInfo { number: BookId(33), name: "Micah", abbreviation: "Mic", aliases: &["Mic", "Mc"] },
    BookInfo { number: BookId(34), name: "Nahum", abbreviation: "Nah", aliases: &["Nah", "Na"] },
    BookInfo { number: BookId(35), name: "Habakkuk", abbreviation: "Hab", aliases: &["Hab", "Hb"] },
    BookInfo { number: BookId(36), name: "Zephaniah", abbreviation: "Zeph", aliases: &["Zeph", "Zep", "Zp"] },
    BookInfo { number: BookId(37), name: "Haggai", abbreviation: "Hag", aliases: &["Hag", "Hg"] },
    BookInfo { number: BookId(38), name: "Zechariah", abbreviation: "Zech", aliases: &["Zech", "Zec", "Zc"] },
    BookInfo { number: BookId(39), name: "Malachi", abbreviation: "Mal", aliases: &["Mal", "Ml"] },

    // New Testament
    BookInfo { number: BookId(40), name: "Matthew", abbreviation: "Matt", aliases: &["Matt", "Mat", "Mt"] },
    BookInfo { number: BookId(41), name: "Mark", abbreviation: "Mark", aliases: &["Mark", "Mrk", "Mk", "Mr"] },
    BookInfo { number: BookId(42), name: "Luke", abbreviation: "Luke", aliases: &["Luke", "Luk", "Lk"] },
    BookInfo { number: BookId(43), name: "John", abbreviation: "John", aliases: &["John", "Joh", "Jhn", "Jn"] },
    BookInfo { number: BookId(44), name: "Acts", abbreviation: "Acts", aliases: &["Acts", "Act", "Ac"] },
    BookInfo { number: BookId(45), name: "Romans", abbreviation: "Rom", aliases: &["Rom", "Ro", "Rm"] },
    BookInfo {
        number: BookId(46), name: "1 Corinthians", abbreviation: "1 Cor",
        aliases: &["1 Cor", "1 Co", "1Cor", "1Co", "First Corinthians", "1st Corinthians", "I Corinthians"],
    },
    BookInfo {
        number: BookId(47), name: "2 Corinthians", abbreviation: "2 Cor",
        aliases: &["2 Cor", "2 Co", "2Cor", "2Co", "Second Corinthians", "2nd Corinthians", "II Corinthians"],
    },
    BookInfo { number: BookId(48), name: "Galatians", abbreviation: "Gal", aliases: &["Gal", "Ga"] },
    BookInfo { number: BookId(49), name: "Ephesians", abbreviation: "Eph", aliases: &["Eph", "Ephes"] },
    BookInfo { number: BookId(50), name: "Philippians", abbreviation: "Phil", aliases: &["Phil", "Php", "Pp"] },
    BookInfo { number: BookId(51), name: "Colossians", abbreviation: "Col", aliases: &["Col", "Co"] },
    BookInfo {
        number: BookId(52), name: "1 Thessalonians", abbreviation: "1 Thess",
        aliases: &["1 Thess", "1 Th", "1Thess", "1Th", "First Thessalonians", "1st Thessalonians", "I Thessalonians"],
    },
    BookInfo {
        number: BookId(53), name: "2 Thessalonians", abbreviation: "2 Thess",
        aliases: &["2 Thess", "2 Th", "2Thess", "2Th", "Second Thessalonians", "2nd Thessalonians", "II Thessalonians"],
    },
    BookInfo {
        number: BookId(54), name: "1 Timothy", abbreviation: "1 Tim",
        aliases: &["1 Tim", "1 Ti", "1Tim", "1Ti", "First Timothy", "1st Timothy", "I Timothy"],
    },
    BookInfo {
        number: BookId(55), name: "2 Timothy", abbreviation: "2 Tim",
        aliases: &["2 Tim", "2 Ti", "2Tim", "2Ti", "Second Timothy", "2nd Timothy", "II Timothy"],
    },
    BookInfo { number: BookId(56), name: "Titus", abbreviation: "Titus", aliases: &["Titus", "Tit", "Ti"] },
    BookInfo { number: BookId(57), name: "Philemon", abbreviation: "Phlm", aliases: &["Phm", "Philem"] },
    BookInfo { number: BookId(58), name: "Hebrews", abbreviation: "Heb", aliases: &["Heb"] },
    BookInfo { number: BookId(59), name: "James", abbreviation: "Jas", aliases: &["Jas", "Jm"] },
    BookInfo {
        number: BookId(60), name: "1 Peter", abbreviation: "1 Pet",
        aliases: &["1 Pet", "1 Pe", "1Pet", "1Pe", "First Peter", "1st Peter", "I Peter"],
    },
    BookInfo {
        number: BookId(61), name: "2 Peter", abbreviation: "2 Pet",
        aliases: &["2 Pet", "2 Pe", "2Pet", "2Pe", "Second Peter", "2nd Peter", "II Peter"],
    },
    BookInfo {
        number: BookId(62), name: "1 John", abbreviation: "1 John",
        aliases: &["1 John", "1 Jn", "1John", "1Jn", "First John", "1st John", "I John"],
    },
    BookInfo {
        number: BookId(63), name: "2 John", abbreviation: "2 John",
        aliases: &["2 John", "2 Jn", "2John", "2Jn", "Second John", "2nd John", "II John"],
    },
    BookInfo {
        number: BookId(64), name: "3 John", abbreviation: "3 John",
        aliases: &["3 John", "3 Jn", "3John", "3Jn", "Third John", "3rd John", "III John"],
    },
    BookInfo { number: BookId(65), name: "Jude", abbreviation: "Jude", aliases: &["Jude", "Jud", "Jd"] },
    BookInfo { number: BookId(66), name: "Revelation", abbreviation: "Rev", aliases: &["Rev", "Re", "Rv", "Apocalypse"] },
];
