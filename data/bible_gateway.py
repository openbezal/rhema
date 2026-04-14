import builtins

_original_open = open

def utf8_open(*args, **kwargs):
    if "encoding" not in kwargs:
        kwargs["encoding"] = "utf-8"
    return _original_open(*args, **kwargs)

builtins.open = utf8_open

import json
import os
import re
import sys

import meaningless.utilities.common as common
from meaningless import JSONDownloader
from meaningless.utilities.common import BIBLE_TRANSLATIONS


# Replacing the function with a new version to allow for proper download of all verses in a chapter
def custom_get_capped_integer(number, min_value=1, max_value=200):
    return min(max(int(number), int(min_value)), int(max_value))


# Override the original function with the custom version
common.get_capped_integer = custom_get_capped_integer
# books of the bible in order
books = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel",
         "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job",
         "Psalm", "Proverbs", "Ecclesiastes", "Song Of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel",
         "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai",
         "Zechariah", "Malachi", "Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians",
         "2 Corinthians", "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
         "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter", "2 Peter",
         "1 John", "2 John", "3 John", "Jude", "Revelation"]

COUNT = 0
TOTAL = 0


# download all the books
def download(book_name, folder, v):
    all_clear = True
    downloader = JSONDownloader(translation=v, show_passage_numbers=False, strip_excess_whitespace=True)

    if not downloader.download_book(book_name, folder + "/" + book_name + ".json") == 1:
        all_clear = False

    return all_clear


# combine all the books into one json file
def combine(folder, n):
    combined_data = {}

    # Iterate through all files in the folder
    for file_name in os.listdir(folder):
        if file_name.endswith('.json'):
            fp = os.path.join(folder, file_name)

            try:
                with open(fp, 'r') as f:
                    data = json.load(f)
                    # Exclude the "Info" section if present
                    if "Info" in data:
                        del data["Info"]
                    # Remove extra whitespace characters from verse content
                    for book, chapters in data.items():
                        for chapter, verses in chapters.items():
                            for verse_num, verse_content in verses.items():
                                # Replace newline characters and excess spaces with a single space
                                data[book][chapter][verse_num] = verse_content.strip()

                    combined_data.update(data)
            except json.JSONDecodeError as e:
                print(f"Error parsing {file_name}: {e}")
                continue

    # Write the combined data to the output file in order
    ordered_data = {book: combined_data[book] for book in books if book in combined_data}

    with open(n, 'w') as out_file:
        json.dump(ordered_data, out_file, indent=4)


# a text progress bar
def generate_progress_bar(progress, total, length=20):
    progress_ratio = min(progress / total, 1)
    progress_bar_length = int(progress_ratio * length)
    progress_bar = "#" * progress_bar_length + "-" * (length - progress_bar_length)
    return f"[{progress_bar}] {progress:2d}/{total}"


def generate_bible(bible_translation, show_progress=True):
    # root
    if not os.path.exists(bible_translation):
        os.makedirs(bible_translation)

    root = bible_translation + "/"
    path = root + bible_translation + "_books"
    if not os.path.exists(path):
        os.makedirs(path)

    files = os.listdir(path)
    total_files = len(files)
    # delete all files in folder
    for i, file in enumerate(files):
        file_path = os.path.join(path, file)
        os.remove(file_path)
    if show_progress:
        print("\rDeleted " + str(total_files) + " files.")
    # download all files
    flag = ""
    for i, book in enumerate(books):
        global COUNT, TOTAL
        COUNT += 1
        if not show_progress:
            print(f"\r[+] Downloading {bible_translation[:8]:<8} ({generate_progress_bar(COUNT, TOTAL, 40)})"
                  f" ({round((COUNT / TOTAL) * 100)}%)", end="")
        if not download(books[i], path, bible_translation):
            flag = book
            break
        if show_progress:
            print(
                f"\r[+] Downloading book: {book[:15]:<15} ({generate_progress_bar(i + 1, len(books), 30)})", end="")

    if flag != "":
        if show_progress:
            print("\r[+] ERROR: " + flag + " failed to download.")
    else:
        if show_progress:
            print("\r[+] Download complete.")

    # combine all books
    combine(path, root + bible_translation + "_bible.json")
    if show_progress:
        print("[+] All books combined into: " + root + bible_translation + "_bible.json")
    # generate sql
    out_name = root + bible_translation + "_bible.sql"
    in_name = root + bible_translation + "_bible.json"
    with open(out_name, 'w') as output_file:
        with open(in_name, 'r') as input_file:
            output_file.write(
                "create table " + bible_translation.lower() + "(book_id int not null, book varchar(255) not null, "
                                                              "chapter "
                                                              "int not null, verse int not null, text varchar(1000) not "
                                                              "null, primary key (book_id, chapter, verse));\n\n")

            cd = json.load(input_file)

            for book, chapters in cd.items():
                for chapter, verses in chapters.items():
                    output_file.write(
                        "INSERT INTO " + bible_translation.lower() + "(book_id, book, chapter, verse, text) "
                                                                     "VALUES\n")
                    for verse_num, verse_content in verses.items():
                        book_id = books.index(book) + 1
                        verse_content = re.sub(r'\s+', ' ', verse_content)
                        verse_content = verse_content.replace("'", "''")
                        output_file.write("(" + str(
                            book_id) + ",'" + book + "'," + chapter + "," + verse_num + ",'" + verse_content + "')")
                        # Check if it's the last line
                        if verse_num == list(verses.keys())[-1]:
                            output_file.write(";\n")
                        else:
                            output_file.write(",\n")

    if show_progress:
        print("[+] SQL file created: " + out_name)


if __name__ == '__main__':
    print("[+] Available Translations: ")
    for bt in BIBLE_TRANSLATIONS.keys():
        sys.stdout.write(bt + " ")
        TOTAL += 66

    download_all = input("\n[+] Download all translations (Y/N): ").upper()
    if download_all == "Y":
        bibles_trans = list(BIBLE_TRANSLATIONS.keys())
        # remove NMB since it's not complete
        bibles_trans.remove("NMB")
        bibles_trans.remove("RVA")
        bibles_trans.sort()
        TOTAL -= 66 * 2
        for t in bibles_trans:
            generate_bible(t, show_progress=False)
        print("\n[+] All translations downloaded!")

    else:
        translation = input("[+] Translation: ").upper()
        generate_bible(translation)
