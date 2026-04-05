"""
Extract missing entries for ce_ru_anatomy from the anatomy PDF.
Uses verified sub-table offsets and block-level text extraction.
ce_ru format: word = Chechen, translate = "Russian (Latin)     <i>Note</i>"
"""
import fitz
import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

PDF_PATH = r'C:\Users\ShuVarhiDa\Desktop\Берсанов-Р.У.-Чеченско-русский-русско-чеченский-словарь-анатомии-человека.pdf'
JSON_PATH = r'f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\ce_ru_anatomy.json'
OUTPUT_PATH = r'f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\ce_ru_anatomy_missing.json'

# Missing IDs from missing-ids.md for ce_ru_anatomy
MISSING_IDS = []
ranges_str = "7, 11, 14, 17, 24, 30, 41, 50, 74, 76, 78-81, 83-85, 87, 94, 97, 107, 111, 141, 143-145, 147, 354, 497, 499-500, 503, 519, 522, 524-527, 534, 542, 544, 547, 554, 556, 559, 566, 572, 574, 616, 620, 641, 643, 659, 677, 681, 689, 696, 777, 785, 795, 798, 801, 803, 813, 821, 832, 838-840, 866, 868, 1048-1049, 1109, 1120, 1134, 1136-1137, 1142, 1144, 1154, 1170, 1174, 1202-1203, 1205, 1261, 1457, 1461, 1496, 1509, 1529, 1531, 1554, 1556, 1569-1570, 1580, 1598, 1629, 1639, 1647, 1665, 1676, 1679, 1682, 1693, 1698, 1705, 1721, 1742, 1751"
for part in ranges_str.split(', '):
    if '-' in part:
        a, b = part.split('-')
        for i in range(int(a), int(b) + 1):
            MISSING_IDS.append(i)
    else:
        MISSING_IDS.append(int(part))

print(f"Total missing IDs: {len(MISSING_IDS)}")

# Verified sub-table definitions from previous analysis:
# (page_start_0indexed, page_end_0indexed, json_offset)
SUBTABLES = [
    (4, 9, 0),        # I: Osteologia, local 1-111
    (11, 13, 111),     # II-A: Joints, local 1-36
    (14, 30, 147),     # II-B: Ligaments, local 1-206
    (32, 42, 353),     # III: Myology, local 1-145
    (43, 52, 498),     # IV: Splanchnology, local 1-105
    (54, 61, 602),     # V: Respiratory, local 1-108
    (62, 69, 710),     # VI: Urogenital, local 1-119
    (70, 73, 829),     # VII-A: Heart, local 1-33
    (73, 82, 862),     # VII-B: Arteries, local 1-141
    (82, 85, 1002),    # VII-C: Veins, local 1-44
    (85, 86, 1046),    # VIII-A: Blood formation, local 1-5
    (87, 92, 1051),    # VIII-B: Lymphatic, local 1-83
    (93, 95, 1134),    # IX: Endocrine, local 1-14
    (96, 103, 1148),   # X-A: CNS, local 1-121
    (103, 117, 1269),  # X-B: Nerves, local 1-171
    (118, 127, 1440),  # XI: Eye, local 1-124
    (128, 137, 1564),  # XII: Ear, local 1-130
    (138, 143, 1694),  # XIII: Skin, local 1-60
]

doc = fitz.open(PDF_PATH)


def extract_entries_by_blocks(doc, start_page, end_page):
    """Extract entries using text block positions for column separation."""
    entries = {}

    for pg_idx in range(start_page, end_page + 1):
        if pg_idx >= doc.page_count:
            continue
        page = doc[pg_idx]
        blocks = page.get_text('dict')['blocks']

        spans = []
        for block in blocks:
            if 'lines' not in block:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    text = span['text'].strip()
                    if text:
                        spans.append({
                            'text': text,
                            'x0': span['bbox'][0],
                            'y0': span['bbox'][1],
                        })

        spans.sort(key=lambda s: (round(s['y0'] / 5) * 5, s['x0']))

        # Group into rows
        rows = []
        current_row = []
        current_y = -100
        for span in spans:
            if abs(span['y0'] - current_y) > 8:
                if current_row:
                    rows.append(current_row)
                current_row = [span]
                current_y = span['y0']
            else:
                current_row.append(span)
        if current_row:
            rows.append(current_row)

        current_entry_num = None
        current_entry = {'latin': [], 'russian': [], 'chechen': [], 'note': []}

        for row in rows:
            first_span = row[0]
            entry_num_match = re.match(r'^(\d{1,3})$', first_span['text'])
            if not entry_num_match and first_span['x0'] < 90:
                entry_num_match = re.match(r'^(\d{1,3})\s', first_span['text'])

            if entry_num_match and first_span['x0'] < 100:
                num = int(entry_num_match.group(1))
                if 1 <= num <= 250:
                    if current_entry_num is not None:
                        entries[current_entry_num] = {k: ' '.join(v).strip() for k, v in current_entry.items()}
                    current_entry_num = num
                    current_entry = {'latin': [], 'russian': [], 'chechen': [], 'note': []}

            if current_entry_num is None:
                continue

            for span in row:
                text = span['text'].strip()
                x = span['x0']
                if x < 90 and re.match(r'^\d{1,3}$', text):
                    continue
                if text in ['№', 'ЛАТИНИЙН', 'МАТТАХЬ', 'ОЬРСИЙН', 'НОХЧИЙН', 'КХЕТОР', 'МАТТХЬ']:
                    continue

                # Column boundaries (verified from PDF analysis):
                # x < 195: Latin name
                # 195 <= x < 328: Russian word
                # 328 <= x < 448: Chechen translation
                # x >= 448: Note (КХЕТОР)
                if x < 195:
                    current_entry['latin'].append(text)
                elif x < 328:
                    current_entry['russian'].append(text)
                elif x < 448:
                    current_entry['chechen'].append(text)
                else:
                    current_entry['note'].append(text)

        if current_entry_num is not None:
            entries[current_entry_num] = {k: ' '.join(v).strip() for k, v in current_entry.items()}

    return entries


# Parse all sub-tables and build global entry map
global_entries = {}

for start_page, end_page, offset in SUBTABLES:
    entries = extract_entries_by_blocks(doc, start_page, end_page)
    for local_num, entry_data in entries.items():
        global_id = local_num + offset
        if global_id not in global_entries:
            global_entries[global_id] = entry_data

print(f"Total entries in global map: {len(global_entries)}")

# Load existing to verify
with open(JSON_PATH, encoding='utf-8') as f:
    existing = json.load(f)
existing_ids = {int(e['id']) for e in existing}

# Build output — for ce_ru: word = Chechen, translate = "Russian (Latin)     <i>Note</i>"
output_entries = []
found = 0
not_found = []

for mid in sorted(MISSING_IDS):
    e = global_entries.get(mid)
    if not e:
        not_found.append(mid)
        continue
    found += 1

    latin = re.sub(r'^\d{1,3}\s+', '', e['latin'])
    russian = re.sub(r'^\d{1,3}\s+', '', e['russian'])
    chechen = e['chechen']
    note = e['note']

    # For ce_ru: word = chechen, translate = "Russian (Latin)     <i>Note</i>"
    translate_parts = []
    if russian:
        translate_parts.append(russian)
    if latin:
        translate_parts.append(f"({latin})")
    translate = ' '.join(translate_parts)
    if note:
        translate += f"     <i>{note}</i>"
    translate += "\r\n"

    word = chechen if chechen else russian  # fallback

    entry = {
        'id': str(mid),
        'word': word,
        'translate': translate
    }
    output_entries.append(entry)
    print(f"ID {mid}: word='{chechen[:40]}' | ru='{russian[:30]}' | lat='{latin[:25]}' | note='{note[:30]}'")

print(f"\nFound: {found}/{len(MISSING_IDS)}")
if not_found:
    print(f"Not found ({len(not_found)}): {not_found}")

# Save
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output_entries, f, ensure_ascii=False, indent=2)
print(f"\nSaved {len(output_entries)} entries to {OUTPUT_PATH}")
