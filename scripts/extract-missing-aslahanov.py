"""
Extract missing entries from the Aslahanov dictionary text file.

Final approach:
1. Find line positions of existing entries using robust sequential search
2. Parse entries between anchors for missing IDs
3. Output JSON

Key improvements:
- Normalize palochka characters for matching
- Limit search window to avoid false matches in repeated sections
- Use multi-word matching for disambiguation
"""

import json
import re
import sys


TXT_PATH = r"C:\Users\ShuVarhiDa\Desktop\Аслаханов-С-А.М.-Русско-чеченский-словарь-спортивных-терминов-и-словосочетаний.txt"
EXISTING_JSON = r"f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\aslahanov_ru_ce.json"
MISSING_IDS_PATH = r"f:\programming\mott-larbe\mott-larbe-dosham-backend\missing-ids.md"
OUTPUT_PATH = r"f:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\aslahanov_ru_ce_missing.json"
DEBUG_PATH = r"f:\programming\mott-larbe\mott-larbe-dosham-backend\debug_entries.txt"


def parse_missing_ids(path):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(
        r"## aslahanov_ru_ce.*?Пропущенные ID \(диапазонами\):\*\*\s*\n\n(.*?)(\n---|\n## |\Z)",
        content, re.DOTALL
    )
    if not match:
        sys.exit("ERROR: Could not find aslahanov_ru_ce section")
    ids = set()
    for part in match.group(1).strip().split(","):
        part = part.strip()
        if "-" in part:
            try:
                a, b = part.split("-", 1)
                ids.update(range(int(a), int(b) + 1))
            except ValueError:
                pass
        else:
            try:
                ids.add(int(part))
            except ValueError:
                pass
    return ids


def norm(text):
    """Normalize for comparison: lowercase, palochka->I, collapse spaces."""
    text = text.lower().strip()
    text = text.replace('\u04C0', 'I').replace('\u04CF', 'I')  # Cyrillic palochka
    text = text.replace('\u0406', 'I').replace('\u0456', 'I')  # Ukrainian I
    text = re.sub(r'\s+', ' ', text)
    return text


def find_gap(line):
    """Find word/translate gap. Returns (left, right) or None."""
    gaps = list(re.finditer(r' {3,}', line))
    for gap in gaps:
        left = line[:gap.start()].strip()
        right = line[gap.end():].strip()
        if left and right:
            return (left, right)
    return None


def is_skip_line(stripped):
    if not stripped:
        return True
    if re.match(r'^\d{1,3}$', stripped):
        return True
    if re.match(r'^[А-ЯЁ]$', stripped):
        return True
    return False


def find_anchors(existing, txt_lines, txt_norm):
    """
    Find line positions of existing entries in txt file.
    Returns list of (id, line_idx) sorted by id.
    Uses bounded search to avoid false matches.
    """
    sorted_entries = sorted(existing, key=lambda e: int(e["id"]))
    anchors = []
    search_start = 0
    max_search_window = 200  # Don't look more than 200 lines ahead

    for entry in sorted_entries:
        eid = int(entry["id"])
        word = norm(entry["word"])
        words = word.split()
        if not words:
            continue

        first_word = words[0]
        first_two = ' '.join(words[:2]) if len(words) >= 2 else first_word
        first_three = ' '.join(words[:3]) if len(words) >= 3 else first_two

        # Skip entries that look like fragments (Chechen text, HTML, etc)
        if '<i>' in entry["word"] or '</i>' in entry["word"]:
            continue

        search_end = min(search_start + max_search_window, len(txt_lines))

        found_line = -1

        # Pass 1: Try full word or first 3 words (most precise)
        for i in range(search_start, search_end):
            leading = len(txt_lines[i]) - len(txt_lines[i].lstrip())
            if leading >= 8:
                continue
            line = txt_norm[i]
            if not line:
                continue
            if len(words) >= 3 and line.startswith(first_three):
                found_line = i
                break
            elif len(words) >= 2 and line.startswith(first_two + ' ') or line.startswith(first_two + '  ') or line == first_two:
                found_line = i
                break

        # Pass 2: Try first word only (less precise)
        if found_line < 0 and len(first_word) > 3:
            for i in range(search_start, search_end):
                leading = len(txt_lines[i]) - len(txt_lines[i].lstrip())
                if leading >= 8:
                    continue
                line = txt_norm[i]
                if line.startswith(first_word + ' ') or line.startswith(first_word + '  ') or line == first_word:
                    found_line = i
                    break

        # Pass 3: Extended search for section boundaries (if not found in window)
        if found_line < 0:
            extended_end = min(search_start + 500, len(txt_lines))
            for i in range(search_end, extended_end):
                leading = len(txt_lines[i]) - len(txt_lines[i].lstrip())
                if leading >= 8:
                    continue
                line = txt_norm[i]
                if len(words) >= 2 and (line.startswith(first_two + ' ') or line.startswith(first_two + '  ') or line == first_two):
                    found_line = i
                    break

        if found_line >= 0:
            anchors.append((eid, found_line))
            search_start = found_line + 1

    return anchors


def extract_entries_between(txt_lines, txt_norm, start, end, expected_count=0):
    """
    Extract dictionary entries between two line positions.
    Returns list of {word, translate}.

    Uses a two-pass approach:
    1. First try with multi-line word merging (conservative)
    2. If count doesn't match expected, try without merging (each gap-line = new entry)
    """

    def _parse(merge_multiline):
        entries = []
        word_parts = []
        translate_parts = []

        i = start
        while i < end:
            line = txt_lines[i]
            stripped = line.strip()
            i += 1

            if is_skip_line(stripped):
                continue

            leading = len(line) - len(line.lstrip())

            if leading >= 8:
                if re.match(r'^[А-ЯЁ]$', stripped):
                    continue
                if word_parts:
                    translate_parts.append(stripped)
                continue

            gap = find_gap(line)

            if gap:
                left, right = gap
                is_continuation = False
                if merge_multiline and word_parts:
                    if left[0].islower():
                        is_continuation = True
                    elif re.match(r'^[«(]', left):
                        is_continuation = True

                if is_continuation:
                    word_parts.append(left)
                    translate_parts.append(right)
                else:
                    if word_parts:
                        entries.append({
                            "word": re.sub(r'\s+', ' ', ' '.join(word_parts)).strip(),
                            "translate": re.sub(r'\s+', ' ', ' '.join(translate_parts)).strip(),
                        })
                    word_parts = [left]
                    translate_parts = [right]
            else:
                if merge_multiline and word_parts and stripped and stripped[0].islower():
                    word_parts.append(stripped)
                elif merge_multiline and word_parts and re.match(r'^[«(]', stripped):
                    word_parts.append(stripped)
                else:
                    if word_parts:
                        entries.append({
                            "word": re.sub(r'\s+', ' ', ' '.join(word_parts)).strip(),
                            "translate": re.sub(r'\s+', ' ', ' '.join(translate_parts)).strip(),
                        })
                    word_parts = [stripped]
                    translate_parts = []

        if word_parts:
            entries.append({
                "word": re.sub(r'\s+', ' ', ' '.join(word_parts)).strip(),
                "translate": re.sub(r'\s+', ' ', ' '.join(translate_parts)).strip(),
            })

        return entries

    # Try without merging first (simpler, each gap-line = new entry)
    entries_no_merge = _parse(merge_multiline=False)

    if expected_count > 0 and len(entries_no_merge) == expected_count:
        return entries_no_merge

    # Try with merging
    entries_merge = _parse(merge_multiline=True)

    if expected_count > 0 and len(entries_merge) == expected_count:
        return entries_merge

    # Return whichever is closer to expected
    if expected_count > 0:
        diff_no_merge = abs(len(entries_no_merge) - expected_count)
        diff_merge = abs(len(entries_merge) - expected_count)
        if diff_no_merge <= diff_merge:
            return entries_no_merge
        else:
            return entries_merge

    # Default: return no-merge version (more entries, safer for matching)
    return entries_no_merge


def find_first_entry_after(txt_lines, start_line, end_line):
    """
    Find the first line after start_line that begins a new entry.
    Skip continuation lines (leading >= 8), empty lines, page numbers, etc.
    The first line with leading < 8 that has content is a new entry.
    """
    i = start_line + 1
    # First skip all continuation lines of the entry at start_line
    while i < end_line:
        line = txt_lines[i]
        stripped = line.strip()
        if not stripped or is_skip_line(stripped):
            i += 1
            continue
        leading = len(line) - len(line.lstrip())
        if leading >= 8:
            i += 1
            continue
        # Found a line at left margin - this is the start of next content
        return i
    return end_line


def main():
    print("Loading data...")
    with open(EXISTING_JSON, "r", encoding="utf-8") as f:
        existing_data = json.load(f)

    with open(TXT_PATH, "r", encoding="utf-8") as f:
        txt_lines = [l.rstrip('\n\r') for l in f.readlines()]

    missing_ids = parse_missing_ids(MISSING_IDS_PATH)

    # Precompute normalized lines
    txt_norm = []
    for line in txt_lines:
        n = norm(line)
        txt_norm.append(n)

    print(f"  {len(existing_data)} existing, {len(missing_ids)} missing, {len(txt_lines)} txt lines")

    # Step 1: Find anchors
    print("Finding anchors...")
    anchors = find_anchors(existing_data, txt_lines, txt_norm)
    print(f"  {len(anchors)} anchors found")

    # Step 2: Process gaps
    result = []
    debug = []

    # Sort anchors by id
    anchors.sort(key=lambda x: x[0])

    # Before first anchor
    if anchors:
        first_id, first_line = anchors[0]
        missing_before = sorted([m for m in range(1, first_id) if m in missing_ids])
        if missing_before:
            # Find dict start
            dict_start = first_line
            for i in range(first_line - 1, max(0, first_line - 50), -1):
                if is_skip_line(txt_lines[i].strip()) or txt_lines[i].strip() == '':
                    continue
                leading = len(txt_lines[i]) - len(txt_lines[i].lstrip())
                if leading < 8:
                    gap = find_gap(txt_lines[i])
                    if gap:
                        dict_start = i
            entries = extract_entries_between(txt_lines, txt_norm, dict_start, first_line)
            total_expected = first_id - 1
            debug.append(f"BEFORE id={first_id}: found {len(entries)}, expected {total_expected}, missing {len(missing_before)}")

            if len(entries) == total_expected:
                all_ids = list(range(1, first_id))
                for idx, gid in enumerate(all_ids):
                    if gid in missing_ids:
                        result.append({"id": str(gid), **entries[idx]})
            elif len(entries) == len(missing_before):
                for idx, gid in enumerate(missing_before):
                    result.append({"id": str(gid), **entries[idx]})
            elif len(entries) > 0:
                # Best effort
                for idx, gid in enumerate(missing_before):
                    if idx < len(entries):
                        result.append({"id": str(gid), **entries[idx]})

    # Between consecutive anchors
    for ai in range(len(anchors) - 1):
        id_a, line_a = anchors[ai]
        id_b, line_b = anchors[ai + 1]

        gap_missing = sorted([m for m in range(id_a + 1, id_b) if m in missing_ids])
        if not gap_missing:
            continue

        total_expected = id_b - id_a - 1
        if total_expected == 0:
            continue

        # Find where entries between A and B start
        entry_a_end = find_first_entry_after(txt_lines, line_a, line_b)

        entries = extract_entries_between(txt_lines, txt_norm, entry_a_end, line_b, expected_count=total_expected)
        all_ids = list(range(id_a + 1, id_b))

        if len(entries) == total_expected:
            for idx, gid in enumerate(all_ids):
                if gid in missing_ids:
                    result.append({"id": str(gid), **entries[idx]})
                    debug.append(f"  GAP {id_a}-{id_b} PERFECT id={gid}: \"{entries[idx]['word'][:50]}\"")
        elif len(entries) == len(gap_missing):
            for idx, gid in enumerate(gap_missing):
                result.append({"id": str(gid), **entries[idx]})
                debug.append(f"  GAP {id_a}-{id_b} EXACT id={gid}: \"{entries[idx]['word'][:50]}\"")
        elif 0 < len(entries) < total_expected:
            debug.append(f"  GAP {id_a}-{id_b}: found {len(entries)}, expected {total_expected}, missing {len(gap_missing)}")
            # Assign entries to first N missing IDs
            for idx, gid in enumerate(gap_missing):
                if idx < len(entries):
                    result.append({"id": str(gid), **entries[idx]})
                    debug.append(f"    -> id={gid}: \"{entries[idx]['word'][:50]}\"")
        elif len(entries) > total_expected:
            debug.append(f"  GAP {id_a}-{id_b}: OVER-SPLIT found {len(entries)}, expected {total_expected}")
            # Take first total_expected entries
            trimmed = entries[:total_expected]
            for idx, gid in enumerate(all_ids):
                if gid in missing_ids and idx < len(trimmed):
                    result.append({"id": str(gid), **trimmed[idx]})
                    debug.append(f"    -> id={gid}: \"{trimmed[idx]['word'][:50]}\"")
        else:
            debug.append(f"  GAP {id_a}-{id_b}: EMPTY, {len(gap_missing)} missing")

    # After last anchor
    if anchors:
        last_id, last_line = anchors[-1]
        max_mid = max(missing_ids) if missing_ids else 0
        missing_after = sorted([m for m in range(last_id + 1, max_mid + 1) if m in missing_ids])
        if missing_after:
            entry_end = find_first_entry_after(txt_lines, last_line, len(txt_lines))
            entries = extract_entries_between(txt_lines, txt_norm, entry_end, len(txt_lines))
            for idx, gid in enumerate(missing_after):
                if idx < len(entries):
                    result.append({"id": str(gid), **entries[idx]})

    # Sort and dedupe
    result.sort(key=lambda e: int(e["id"]))

    # Post-processing: remove invalid entries (section headers, etc.)
    cleaned = []
    for entry in result:
        word = entry["word"]
        # Skip section headers (ALL CAPS words)
        if word.isupper() and len(word) > 2:
            continue
        # Skip entries with HTML tags in word
        if '<i>' in word or '</i>' in word:
            continue
        cleaned.append(entry)
    result = cleaned

    # Fix BEFORE section: re-parse with section header filtering
    if anchors:
        first_anchor_id = anchors[0][0]
        expected_ids = sorted([m for m in range(1, first_anchor_id) if m in missing_ids])
        if expected_ids:
            # Remove any existing before-anchor entries from result
            result = [e for e in result if int(e["id"]) >= first_anchor_id]

            # Re-parse the before section, filtering section headers
            first_line = anchors[0][1]
            dict_start = first_line
            for i in range(first_line - 1, max(0, first_line - 50), -1):
                if is_skip_line(txt_lines[i].strip()) or txt_lines[i].strip() == '':
                    continue
                leading = len(txt_lines[i]) - len(txt_lines[i].lstrip())
                if leading < 8:
                    gap = find_gap(txt_lines[i])
                    if gap:
                        dict_start = i
            before_entries = extract_entries_between(
                txt_lines, txt_norm, dict_start, first_line, expected_count=first_anchor_id - 1)

            # Filter out section headers
            valid = [e for e in before_entries
                     if not (e["word"].isupper() and len(e["word"]) > 2)]

            # Assign IDs
            if len(valid) >= len(expected_ids):
                # Take last N
                aligned = valid[-len(expected_ids):]
                for idx, gid in enumerate(expected_ids):
                    result.append({"id": str(gid), **aligned[idx]})
            else:
                for idx, entry in enumerate(valid):
                    if idx < len(expected_ids):
                        result.append({"id": str(expected_ids[idx]), **entry})

    # Manual additions for entries that couldn't be found by the parser
    # These are in gaps where anchors misaligned or entries don't exist in txt
    manual_entries = [
        # id=839: between граница веса (834) and держание противника (840)
        # Not visible in txt - no entry between дебют and держание противника.
        # Skipped - not present in source txt.

        # id=1020: between удар открытой перчаткой (1019) and удар предплечьем (1021)
        {"id": "1020", "word": "удар", "translate": "тохар"},

        # id=1108-1109: between выход наверх нырком(1107) and дальняя дистанция(1110)
        # Anchor mismatch: 1107 found in wrong section. Actual entries in борьба section:
        # txt line 3005: голова -> корта
        # txt line 3006: гонг -> гонг
        {"id": "1108", "word": "голова", "translate": "корта"},
        {"id": "1109", "word": "гонг", "translate": "гонг"},

        # id=1724-1725: between боковое равновесие(1723) and брусья разной высоты(1726)
        # txt line 4179: бревно -> хен (хенан, хенна, хено, хене, б; мн. хенаш, д)
        # txt line 4181: брусья -> брусаш
        {"id": "1724", "word": "бревно", "translate": "хен (хенан, хенна, хено, хене, б; мн. хенаш, д)"},
        {"id": "1725", "word": "брусья", "translate": "брусаш"},

        # id=2280: ДЗЮДО section header
        {"id": "2280", "word": "Дзюдо", "translate": "дзюдо"},
    ]

    found_ids_set = set(int(e["id"]) for e in result)
    for me in manual_entries:
        if int(me["id"]) in missing_ids and int(me["id"]) not in found_ids_set:
            result.append(me)

    result.sort(key=lambda e: int(e["id"]))

    found_ids = set(int(e["id"]) for e in result)
    still_missing = missing_ids - found_ids

    print(f"\nFound {len(result)} of {len(missing_ids)} missing entries")
    print(f"Still missing: {len(still_missing)}")

    # Write debug
    with open(DEBUG_PATH, "w", encoding="utf-8") as f:
        f.write(f"Anchors: {len(anchors)}\n")
        f.write(f"Found: {len(result)}/{len(missing_ids)}\n")
        f.write(f"Still missing: {len(still_missing)}\n\n")

        f.write("=== Anchors (first 30) ===\n")
        for eid, lidx in anchors[:30]:
            f.write(f"  id={eid} line={lidx}: \"{txt_lines[lidx].strip()[:60]}\"\n")

        f.write(f"\n=== Log ===\n")
        for line in debug[:200]:
            f.write(line + "\n")

        f.write(f"\n=== Results (first 50) ===\n")
        for entry in result[:50]:
            f.write(f"  id={entry['id']}: word=\"{entry['word'][:50]}\" tr=\"{entry['translate'][:40]}\"\n")

        if still_missing:
            f.write(f"\n=== Still missing (first 50) ===\n")
            for mid in sorted(still_missing)[:50]:
                f.write(f"  {mid}\n")

    # Save JSON
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"Saved to {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
