"""
Extract missing entries from the anatomy PDF using verified sub-table offsets
and block-level text extraction for proper column separation.
"""
import fitz
import re
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

PDF_PATH = r'C:\Users\ShuVarhiDa\Desktop\Берсанов-Р.У.-Чеченско-русский-русско-чеченский-словарь-анатомии-человека.pdf'
JSON_PATH = r'f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\ru_ce_anatomy.json'
OUTPUT_PATH = r'f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\ru_ce_anatomy_missing.json'

# Missing IDs
MISSING_IDS = []
ranges_str = "14-15, 17, 41, 50, 67, 79-80, 84-85, 110, 143, 145, 147, 354, 497, 499, 503, 510, 519, 521, 525-527, 535-536, 542, 544, 547, 554, 556, 565-566, 569, 572, 598-599, 616, 620, 643, 659, 677, 681, 696, 707, 759, 777, 785, 798, 803, 805, 809-810, 813, 821, 824, 827, 832, 838, 841, 866, 868, 1003, 1049-1050, 1136, 1144, 1154, 1170, 1174, 1202-1203, 1205, 1220, 1261, 1323, 1457, 1461, 1496, 1509, 1529, 1531, 1554, 1556, 1569-1570, 1580, 1598, 1614, 1629, 1639, 1660, 1676, 1679, 1682, 1693, 1705, 1711, 1721, 1742, 1751"
for part in ranges_str.split(', '):
    if '-' in part:
        a, b = part.split('-')
        for i in range(int(a), int(b) + 1):
            MISSING_IDS.append(i)
    else:
        MISSING_IDS.append(int(part))

MISSING_SET = set(MISSING_IDS)
print(f"Total missing IDs: {len(MISSING_IDS)}")

# Sub-table definitions: (page_start_0indexed, page_end_0indexed, json_offset)
SUBTABLES = [
    (4, 9, 0),        # I: Osteologia
    (11, 13, 111),     # II-A: Joints
    (14, 30, 147),     # II-B: Ligaments
    (32, 42, 353),     # III: Myology
    (43, 52, 498),     # IV: Splanchnology
    (54, 61, 602),     # V: Respiratory
    (62, 69, 710),     # VI: Urogenital
    (70, 73, 829),     # VII-A: Heart
    (73, 82, 862),     # VII-B: Arteries
    (82, 85, 1002),    # VII-C: Veins
    (85, 86, 1046),    # VIII-A: Blood formation
    (87, 92, 1051),    # VIII-B: Lymphatic
    (93, 95, 1134),    # IX: Endocrine
    (96, 103, 1148),   # X-A: CNS
    (103, 117, 1269),  # X-B: Nerves
    (118, 127, 1440),  # XI: Eye
    (128, 137, 1564),  # XII: Ear
    (138, 143, 1694),  # XIII: Skin
]

doc = fitz.open(PDF_PATH)


def extract_entries_by_blocks(doc, start_page, end_page):
    """Extract entries using text block positions for proper column separation."""
    entries = {}  # local_num -> {latin, russian, chechen, note}

    for pg_idx in range(start_page, end_page + 1):
        if pg_idx >= doc.page_count:
            continue
        page = doc[pg_idx]
        page_width = page.rect.width

        # Get text blocks with positions
        blocks = page.get_text('dict')['blocks']

        # Collect all text spans with their positions
        spans = []
        for block in blocks:
            if 'lines' not in block:
                continue
            for line in block['lines']:
                for span in line['spans']:
                    text = span['text'].strip()
                    if text:
                        x0 = span['bbox'][0]
                        y0 = span['bbox'][1]
                        x1 = span['bbox'][2]
                        y1 = span['bbox'][3]
                        spans.append({
                            'text': text,
                            'x0': x0, 'y0': y0,
                            'x1': x1, 'y1': y1,
                            'page': pg_idx
                        })

        # Sort by y position then x
        spans.sort(key=lambda s: (round(s['y0'] / 5) * 5, s['x0']))

        # Determine column boundaries from page layout
        # Typical layout: Nr(60-90) | Latin(90-195) | Russian(195-330) | Chechen(330-450) | Note(450-560)
        # But these can vary by page

        # Group spans into rows (similar y position)
        rows = []
        current_row = []
        current_y = -100
        for span in spans:
            if abs(span['y0'] - current_y) > 8:  # New row
                if current_row:
                    rows.append(current_row)
                current_row = [span]
                current_y = span['y0']
            else:
                current_row.append(span)
        if current_row:
            rows.append(current_row)

        # Process rows to find entries
        # An entry starts with a row containing a number in the leftmost position
        current_entry_num = None
        current_entry = {'latin': [], 'russian': [], 'chechen': [], 'note': []}

        for row in rows:
            # Check if this row starts a new entry (has a number on the left)
            first_span = row[0]
            entry_num_match = re.match(r'^(\d{1,3})$', first_span['text'])

            # Also check for number followed by text on same row
            if not entry_num_match and first_span['x0'] < 90:
                entry_num_match = re.match(r'^(\d{1,3})\s', first_span['text'])

            if entry_num_match and first_span['x0'] < 100:
                num = int(entry_num_match.group(1))
                if 1 <= num <= 250:
                    # Save previous entry
                    if current_entry_num is not None:
                        entries[current_entry_num] = {
                            'latin': ' '.join(current_entry['latin']).strip(),
                            'russian': ' '.join(current_entry['russian']).strip(),
                            'chechen': ' '.join(current_entry['chechen']).strip(),
                            'note': ' '.join(current_entry['note']).strip(),
                        }
                    current_entry_num = num
                    current_entry = {'latin': [], 'russian': [], 'chechen': [], 'note': []}

            if current_entry_num is None:
                continue

            # Classify each span in the row by its x position into columns
            for span in row:
                text = span['text'].strip()
                x = span['x0']

                # Skip the entry number itself
                if x < 90 and re.match(r'^\d{1,3}$', text):
                    continue
                # Skip header words
                if text in ['№', 'ЛАТИНИЙН', 'МАТТАХЬ', 'ОЬРСИЙН', 'НОХЧИЙН', 'КХЕТОР', 'МАТТХЬ']:
                    continue

                if x < 195:
                    current_entry['latin'].append(text)
                elif x < 328:
                    current_entry['russian'].append(text)
                elif x < 448:
                    current_entry['chechen'].append(text)
                else:
                    current_entry['note'].append(text)

        # Save last entry
        if current_entry_num is not None:
            entries[current_entry_num] = {
                'latin': ' '.join(current_entry['latin']).strip(),
                'russian': ' '.join(current_entry['russian']).strip(),
                'chechen': ' '.join(current_entry['chechen']).strip(),
                'note': ' '.join(current_entry['note']).strip(),
            }

    return entries


# Parse all sub-tables
global_entries = {}

for start_page, end_page, offset in SUBTABLES:
    entries = extract_entries_by_blocks(doc, start_page, end_page)
    for local_num, entry_data in entries.items():
        global_id = local_num + offset
        if global_id not in global_entries:
            global_entries[global_id] = entry_data

print(f"Total entries: {len(global_entries)}")

# Verify
with open(JSON_PATH, encoding='utf-8') as f:
    existing = json.load(f)
id_to_entry = {int(e['id']): e for e in existing}

print("\nVerification:")
checks = [(1, "Добавочные кости запястья"), (14, "Ключица"), (15, "Копчик"),
           (50, "Молоточек"), (111, "Скуловая кость"), (354, "Апоневроз")]
for gid, expected in checks:
    e = global_entries.get(gid, {})
    print(f"  {gid}: ru='{e.get('russian','')[:40]}' lat='{e.get('latin','')[:30]}' ce='{e.get('chechen','')[:30]}'")

# Extract and format missing entries
output_entries = []
found = 0
not_found = []

for mid in sorted(MISSING_IDS):
    e = global_entries.get(mid)
    if not e:
        not_found.append(mid)
        continue
    found += 1

    russian = e['russian']
    latin = e['latin']
    chechen = e['chechen']
    note = e['note']

    # Clean up: remove any number prefix from latin
    latin = re.sub(r'^\d{1,3}\s+', '', latin)
    # Remove number prefix from russian too
    russian = re.sub(r'^\d{1,3}\s+', '', russian)

    # Build translate field: "Чеченский перевод (Латинское)     <i>Примечание</i>\r\n"
    translate_parts = []
    if chechen:
        translate_parts.append(chechen)
    if latin:
        translate_parts.append(f"({latin})")
    translate = ' '.join(translate_parts)
    if note:
        translate += f"     <i>{note}</i>"
    translate += "\r\n"

    entry = {
        'id': str(mid),
        'word': russian if russian else latin,
        'translate': translate
    }
    output_entries.append(entry)

    print(f"ID {mid}: word='{russian}' | latin='{latin}' | chechen='{chechen[:50]}' | note='{note[:50]}'")

print(f"\nFound: {found}/{len(MISSING_IDS)}")
if not_found:
    print(f"Not found ({len(not_found)}): {not_found}")

# Save
with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
    json.dump(output_entries, f, ensure_ascii=False, indent=2)
print(f"\nSaved {len(output_entries)} entries to {OUTPUT_PATH}")
