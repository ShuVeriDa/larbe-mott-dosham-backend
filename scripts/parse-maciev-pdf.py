#!/usr/bin/env python3
"""
Парсер PDF словаря Мациева → maciev2.json

Стили по PDF:
  [B 12]  Bold 12pt      — headword, примеры (чеченский текст), номера значений (1. 2.)
  [B 8]   Bold 8pt       — суперскрипт омонимов (1, 2, 3)
  [I 12]  Italic 12pt    — часть речи, грамм. класс (в,й,б,д), мн., пометки (уст., см., понуд. от)
  [N 12]  Normal 12pt    — перевод, грамм. формы в [...], пояснения в (...)
  [N 11]  Normal 11pt    — номер страницы (пропускаем)

Границы:
  Стр. 20-548 (0-idx: 19-547) — основной словарь
  Стр. 549-562 (0-idx: 548-561) — географические названия (отдельная секция)
  Стр. 563+ — грамматический очерк (пропускаем)

Паттерн словарной статьи:
  [B]headword[B8]homonymIdx [N]grammarForms, [I]class; [I]мн. [N]plural, [I]class] [I]POS [N]translation;
  [B]example_nah [N]example_ru; [B]example2_nah [N]example2_ru.
  ◊ [B]phrase_nah [N]phrase_ru.
"""

import fitz
import json
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PDF_PATH = r"H:\MyDocument\MyArhiv\OneDrive - Medical College\MyArhiv\Изучение языков\чеченские словари\Maciev_A.G_Chechensko-russkiy_slovar.pdf"
OUTPUT_PATH = r"F:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\maciev2.json"

DICT_PAGES = range(19, 548)      # pages 20-548 (0-indexed: 19-547)
GEO_PAGES = range(548, 562)      # pages 549-562 (geographic names)

CLASS_LETTERS = set("бвдйю")

# Chechen alphabet order for sorting/validation
CE_ALPHABET = "аАбБвВгГдДеЕжЖзЗиИйЙкКлЛмМнНоОпПрРсСтТуУфФхХцЦчЧшШщЩъЪыЫьЬэЭюЮяЯӀ"


def _clean(text):
    return re.sub(r'\s+', ' ', text).strip()


def _clean_parens(text):
    """Remove unbalanced parentheses and clean up."""
    result = text.strip()
    while result.startswith(")"):
        result = result[1:].strip()
    while result.endswith("("):
        result = result[:-1].strip()

    depth = 0
    for ch in result:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
    if depth > 0:
        chars = list(result)
        to_remove = depth
        for i in range(len(chars)):
            if chars[i] == '(' and to_remove > 0:
                inner_depth = 0
                has_match = False
                for j in range(i, len(chars)):
                    if chars[j] == '(':
                        inner_depth += 1
                    elif chars[j] == ')':
                        inner_depth -= 1
                        if inner_depth == 0:
                            has_match = True
                            break
                if not has_match:
                    chars[i] = ''
                    to_remove -= 1
        result = ''.join(chars)
    elif depth < 0:
        chars = list(result)
        to_remove = -depth
        for i in range(len(chars) - 1, -1, -1):
            if chars[i] == ')' and to_remove > 0:
                inner_depth = 0
                has_match = False
                for j in range(i, -1, -1):
                    if chars[j] == ')':
                        inner_depth += 1
                    elif chars[j] == '(':
                        inner_depth -= 1
                        if inner_depth == 0:
                            has_match = True
                            break
                if not has_match:
                    chars[i] = ''
                    to_remove -= 1
        result = ''.join(chars)

    result = re.sub(r'\s+', ' ', result).strip()
    return result


# ---------------------------------------------------------------------------
# Extract spans from PDF, fix line-break hyphens
# ---------------------------------------------------------------------------

def extract_spans(doc, page_range):
    """Extract (style, text, x0) tuples from PDF pages, fixing line-break hyphens.

    x0 is the x-coordinate of the first span in the line (used for detecting
    continuation lines: x0 <= 80 = new entry, x0 > 80 = continuation).
    """
    raw = []
    for page_idx in page_range:
        page = doc[page_idx]
        for block in page.get_text("dict")["blocks"]:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                # Determine x0 for this line (first meaningful span's x)
                line_x0 = None
                for span in line["spans"]:
                    if span["text"].strip():
                        line_x0 = span["origin"][0]
                        break
                if line_x0 is None:
                    line_x0 = 0

                for span in line["spans"]:
                    text = span["text"]
                    if not text.strip():
                        continue
                    size = round(span["size"], 1)
                    # Skip page numbers (size ~11.0, Calibri font)
                    if size <= 11.0 and not bool(span["flags"] & (1 << 4)):
                        # Could be a page number — check if it's just digits
                        if re.match(r'^\d+\s*$', text.strip()):
                            continue
                    # Skip very large headers
                    if size >= 14.0:
                        continue
                    flags = span["flags"]
                    b = bool(flags & (1 << 4))
                    it = bool(flags & (1 << 1))
                    # Superscript detection: bold + small size (7-9pt)
                    if b and size < 10.0:
                        style = "SUP"  # superscript (homonym index)
                    elif b and it:
                        style = "BI"
                    elif b:
                        style = "B"
                    elif it:
                        style = "I"
                    else:
                        style = "N"
                    # Normalize size differences (some pages use 11.5-11.6)
                    raw.append((style, text, line_x0))

    # Fix line-break hyphens:
    # If span ends with "-" (not " -") and next span of same style starts with lowercase → merge
    fixed = []
    i = 0
    while i < len(raw):
        style, text, x0 = raw[i]
        if (text.rstrip().endswith("-") and
            not text.rstrip().endswith(" -") and
            not text.rstrip().endswith("—") and
            i + 1 < len(raw) and
            raw[i+1][0] == style and
            raw[i+1][1].strip() and
            raw[i+1][1].strip()[0].islower()):
            merged = text.rstrip()[:-1] + raw[i+1][1]
            fixed.append((style, merged, x0))
            i += 2
        else:
            fixed.append((style, text, x0))
            i += 1

    # Fix stress spaces within individual spans:
    # "я щур" → "ящур", "хозя йство" → "хозяйство"
    # Apply per-span since the spaces are WITHIN a single span text
    destressed = []
    for style, text, x0 in fixed:
        if style == "N":
            text = _remove_stress_spaces_in_span(text)
        destressed.append((style, text, x0))

    return destressed


def _remove_stress_spaces_in_span(text):
    """Remove stress spaces within a single span text.

    In Maciev PDF, stress is marked by a thin space AFTER the stressed vowel:
    "хозя йство" → "хозяйство" (space after "хозя", before "йство")
    "я щур" → "ящур"
    "ко лос" → "колос"

    The stressed syllable fragment (before space) is short: 1-4 chars.
    We only merge if the LEFT fragment (from previous space/start) is ≤4 chars,
    ensuring we don't merge separate words like "холодное оружие".
    """
    # Split into words
    parts = text.split(' ')
    if len(parts) <= 1:
        return text

    result = [parts[0]]
    for j in range(1, len(parts)):
        prev = result[-1]
        curr = parts[j]
        if not prev or not curr:
            result.append(curr)
            continue

        # Get the "fragment" — the part of prev after the last space-like boundary
        # In the result string, the last "word" is what we'd merge with
        last_word = prev.split()[-1] if prev.split() else prev

        # Merge conditions:
        # 1. Last word fragment is short (≤4 chars) — typical stress prefix
        # 2. Last word fragment ends with a Cyrillic letter
        # 3. Next part starts with a lowercase Cyrillic letter
        VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")
        if (len(last_word) <= 4 and
            last_word[-1].isalpha() and
            last_word[-1] in VOWELS and
            curr[0].isalpha() and curr[0].islower()):
            # Merge: stress space
            result[-1] = prev + curr
        else:
            result.append(curr)

    return ' '.join(result)


# ---------------------------------------------------------------------------
# Split spans into entries
# ---------------------------------------------------------------------------

def split_into_entries(spans):
    """
    Split spans into dictionary entries.

    New entry = [B] span that is a HEADWORD, not an example.

    Headword indicators (next span check):
    - Followed by [N] with grammar forms (comma-separated chechen words, or starts with "[")
    - Followed by [I] with POS marker (прил., прич., масд., нареч., etc.)
    - Followed by [SUP] (homonym index)
    - Followed by [N] with "*" (class variability marker)

    Example indicators:
    - Followed by [N] with Russian translation (stress marks, Russian words)
    - Part of phraseology after ◊
    """
    entries = []
    current = []
    has_translation = False
    bracket_depth = 0

    SECTION_HEADERS = frozenset([
        "А", "Б", "В", "Г", "ГӀ", "Д", "ДӀ", "Е", "Ж", "З", "И",
        "К", "КӀ", "Кх", "Къ", "Л", "М", "Н", "О", "ОЬ", "П", "ПӀ", "Р",
        "С", "Т", "ТӀ", "У", "Ф", "Х", "ХӀ", "Хь", "Ц", "ЦӀ", "Ч",
        "ЧӀ", "Ш", "Щ", "Э", "Ю", "Юь", "Я", "I", "Ӏ"
    ])

    LEFT_MARGIN = 80.0  # x <= 80 = left margin (new entry), x > 80 = continuation (example)

    for i, (style, text, x0) in enumerate(spans):
        stripped = text.strip()

        # Track bracket depth
        if style in ("N", "I"):
            bracket_depth += stripped.count("[") - stripped.count("]")

        # Section headers
        if style == "B" and stripped in SECTION_HEADERS:
            if current:
                entries.append(current)
                current = []
                has_translation = False
                bracket_depth = 0
            continue

        # Check if this [B] starts a new entry
        if style == "B" and has_translation and current and bracket_depth <= 0:
            # NOT new entry:
            if re.match(r'^\d+\.?\s*$', stripped):
                # Numbered meaning marker (1. 2. etc.)
                current.append((style, text))
                continue
            if stripped.startswith("◊") or stripped == "◊":
                # Phraseology marker
                current.append((style, text))
                continue

            # Continuation lines (x > 80) are NEVER new headwords
            if x0 > LEFT_MARGIN:
                current.append((style, text))
                continue

            # Check what follows this [B] to determine if headword or example
            is_headword = _is_new_headword(spans, i)

            if is_headword:
                entries.append(current)
                current = []
                has_translation = False
                bracket_depth = 0
            # else: it's an example, continue in current entry

        current.append((style, text))  # Store as 2-tuple (parse_entry expects this)
        if style == "N" and bracket_depth <= 0:
            has_translation = True

    if current:
        entries.append(current)
    return entries


def _is_new_headword(spans, idx):
    """
    Determine if spans[idx] (a [B] span) is a new dictionary headword.

    Look ahead at the next 1-4 spans to decide:
    - If next is [SUP] → headword (homonym index)
    - If next is [N] with grammar-like content (comma-separated forms, "[", or "*") → headword
    - If next is [I] with POS marker → headword
    - If next is [N] with Russian translation → example (not headword)
    - If next is [B] → multi-word bold (could be either, default to example)
    """
    text = spans[idx][1].strip()

    # Look at next 1-4 spans
    for lookahead in range(1, min(5, len(spans) - idx)):
        next_style, next_text = spans[idx + lookahead][0], spans[idx + lookahead][1]
        nt = next_text.strip()

        if not nt:
            continue

        if next_style == "SUP":
            return True  # Homonym index → definitely headword

        if next_style == "N":
            # Check content of [N]
            if nt.startswith("["):
                return True  # Grammar block → headword
            if nt.startswith("*") or (nt == "*"):
                return True  # Class variability marker → headword
            if "]" in nt:
                return True  # End of grammar block → headword
            # Check if it looks like grammar forms (comma-separated chechen)
            if _looks_like_grammar_start(nt):
                return True
            # Check if it's Russian translation → example
            if _is_russian_start(nt):
                return False
            # If [N] text is very short or ambiguous, check the [B] text itself
            # Multi-word bold text is almost always an example, not headword
            words_in_bold = text.replace(",", " ").split()
            if len(words_in_bold) >= 3:
                return False  # 3+ words in bold → likely example
            # Default to headword
            return True

        if next_style == "I":
            # POS marker → headword
            if _is_pos(nt):
                return True
            # Class letter → headword (grammar)
            if nt in CLASS_LETTERS:
                return True
            if nt.startswith("мн."):
                return True
            # Other italic (note) — could be headword with note
            # Check if it's a reference: "понуд. от", "потенц. от", "см."
            if any(ref in nt for ref in ["понуд.", "потенц.", "см.", "мн. от"]):
                return True
            return True  # Default for italic after bold

        if next_style == "B":
            # Next is also bold — multi-word headword or continuation
            # Check if combined text looks like a headword
            continue  # Look further

    # Couldn't determine — default to headword
    return True


def _is_russian_start(text):
    """Check if text starts with a Russian word (translation)."""
    # Russian text typically has stress marks (á, é, etc.) or is clearly Russian
    first_word = text.split()[0] if text.split() else ""
    # Remove punctuation
    fw = re.sub(r'[;,.\d\)\(\]\[\s]+', '', first_word)
    if not fw:
        return False
    # Check for stress marks
    if any(c in fw for c in "áéóúы́"):
        return True
    # Check if it's a Russian word (contains only Russian letters)
    russian_only = all(c in "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ-" for c in fw)
    chechen_specific = any(c in fw for c in "ӀӀаьоьуьюь")
    if russian_only and not chechen_specific and len(fw) > 2:
        return True
    return False


# ---------------------------------------------------------------------------
# Parse a single dictionary entry
# ---------------------------------------------------------------------------

def parse_entry(spans):
    """Parse entry spans into structured dictionary entry."""
    if not spans:
        return None

    # Phase 1: Collect headword, superscript, grammar, POS, translation
    headword_parts = []
    homonym_idx = None
    grammar_parts = []
    pos_parts = []
    translation_parts = []
    example_pairs = []  # [(nah, ru, meaning_num)] — meaning_num tracks which numbered meaning this belongs to
    phraseology_pairs = []
    word_note_parts = []  # [I] before first [N] (word notes)
    domain = None
    style_label = None
    obsolete = False

    # State machine
    state = "head"  # head → grammar → pos → translation → examples → phraseology
    in_bracket = False
    in_phraseology = False
    cur_example_b = []
    cur_example_n = []
    has_class_star = False  # * after headword
    _cur_meaning_num = 0  # tracks which numbered meaning (0=before any, 1=after "1)", 2=after "2)", etc.)

    for i, (style, text) in enumerate(spans):
        stripped = text.strip()

        # Handle ◊ — start of phraseology
        if "◊" in stripped:
            # Flush current example
            if cur_example_b and cur_example_n:
                example_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n)), _cur_meaning_num))
                cur_example_b = []
                cur_example_n = []
            elif cur_example_b:
                # Bold without translation — might be part of previous translation
                pass
            in_phraseology = True
            # Text before ◊ goes to translation, text after goes to phraseology
            before_diamond = stripped.split("◊")[0].strip()
            after_diamond = stripped.split("◊", 1)[1].strip() if "◊" in stripped else ""
            if before_diamond and state in ("translation", "examples"):
                translation_parts.append(before_diamond)
            state = "phraseology"
            if after_diamond:
                if style == "B":
                    cur_example_b = [after_diamond]
                elif style == "N":
                    cur_example_n = [after_diamond]
            continue

        if state == "head":
            if style == "B":
                # Check for * at end (class variability marker)
                if stripped.endswith("*"):
                    has_class_star = True
                    stripped = stripped[:-1].strip()
                    if stripped:
                        headword_parts.append(stripped)
                else:
                    headword_parts.append(stripped)
            elif style == "SUP":
                # Homonym index (superscript)
                idx_match = re.match(r'(\d+)', stripped)
                if idx_match:
                    homonym_idx = int(idx_match.group(1))
            elif style == "N":
                # Normal text after headword — could be grammar forms or translation
                # Grammar forms are typically in [...] or space-separated chechen forms
                if stripped.startswith("[") or (in_bracket):
                    state = "grammar"
                    grammar_parts.append(stripped)
                    in_bracket = "[" in stripped and "]" not in stripped
                else:
                    # Check if this looks like grammar forms (chechen words before russian translation)
                    # Grammar forms: "формы, формы, формы, [I]класс; [I]мн. формы, [I]класс]"
                    # They start with chechen words separated by commas
                    # Try to detect: if text has ] in it → grammar
                    if "]" in stripped and not stripped.startswith("]"):
                        state = "grammar"
                        grammar_parts.append(stripped)
                    elif _looks_like_grammar_start(stripped):
                        state = "grammar"
                        grammar_parts.append(stripped)
                    else:
                        state = "translation"
                        translation_parts.append(stripped)
            elif style == "I":
                # Italic after headword — POS or word note
                if _is_pos(stripped):
                    state = "pos"
                    pos_parts.append(stripped)
                elif stripped in CLASS_LETTERS:
                    # Class letter after headword
                    grammar_parts.append(stripped)
                elif stripped.startswith("мн."):
                    grammar_parts.append(stripped)
                else:
                    word_note_parts.append(stripped)
                    state = "word_note"

        elif state == "grammar":
            if style == "N":
                if "]" in stripped:
                    in_bracket = False
                    # Split at ]: everything before ] is grammar, after is translation
                    before_bracket = stripped.split("]", 1)[0].strip()
                    after_bracket = stripped.split("]", 1)[1].strip()
                    if before_bracket:
                        grammar_parts.append(before_bracket)
                    if after_bracket:
                        state = "translation"
                        translation_parts.append(after_bracket)
                    else:
                        # ] was at end — next spans are translation/POS
                        state = "after_grammar"
                elif "[" in stripped:
                    grammar_parts.append(stripped)
                    in_bracket = True
                else:
                    grammar_parts.append(stripped)
            elif style == "I":
                grammar_parts.append(stripped)
            elif style == "B":
                # Bold in grammar section — might be numbered meaning or example
                if re.match(r'^\d+\.?\s*$', stripped):
                    state = "translation"
                    translation_parts.append(stripped)
                else:
                    # End of grammar, this could be example
                    state = "examples"
                    cur_example_b = [stripped]
            elif style == "SUP":
                # More superscript in grammar — ignore
                pass

        elif state == "after_grammar":
            # Just after ], waiting for POS (italic) or translation (normal)
            if style == "I":
                if _is_pos(stripped):
                    state = "pos"
                    pos_parts.append(stripped)
                elif stripped in CLASS_LETTERS or stripped.startswith("мн."):
                    # Still grammar-related
                    grammar_parts.append(stripped)
                else:
                    # Domain or note: "вет.", "уст.", "в разн. знач."
                    pos_parts.append(stripped)
                    state = "pos"
            elif style == "N":
                state = "translation"
                # Track numbered meaning markers
                for nm in re.findall(r'(\d+)\s*\)', stripped):
                    _cur_meaning_num = int(nm)
                translation_parts.append(stripped)
            elif style == "B":
                if re.match(r'^\d+\.?\s*$', stripped):
                    state = "translation"
                    num_val = re.match(r'(\d+)', stripped)
                    if num_val:
                        _cur_meaning_num = int(num_val.group(1))
                    translation_parts.append(stripped)
                else:
                    state = "examples"
                    cur_example_b = [stripped]
            elif style == "SUP":
                pass

        elif state == "word_note":
            if style == "I":
                word_note_parts.append(stripped)
            elif style == "B":
                # Reference: "см. headword" or "понуд. от headword"
                word_note_parts.append(stripped)
            elif style == "N":
                # Translation starts
                state = "translation"
                translation_parts.append(stripped)
            elif style == "SUP":
                word_note_parts.append(stripped)

        elif state == "pos":
            if style == "I":
                pos_parts.append(stripped)
            elif style == "N":
                state = "translation"
                # Track numbered meaning markers
                for nm in re.findall(r'(\d+)\s*\)', stripped):
                    _cur_meaning_num = int(nm)
                translation_parts.append(stripped)
            elif style == "B":
                # Could be reference target: "прил. к [B]headword"
                if pos_parts and any("к" in p or "от" in p for p in pos_parts):
                    word_note_parts.extend(pos_parts)
                    word_note_parts.append(stripped)
                    state = "word_note"
                else:
                    state = "examples"
                    cur_example_b = [stripped]
            elif style == "SUP":
                # Superscript after POS — reference index
                word_note_parts.extend(pos_parts)
                word_note_parts.append(stripped)
                pos_parts = []
                state = "word_note"

        elif state == "translation":
            if style == "N":
                # Track numbered meaning markers to keep _cur_meaning_num updated
                num_markers = re.findall(r'(\d+)\s*\)', stripped)
                for nm in num_markers:
                    _cur_meaning_num = int(nm)
                translation_parts.append(stripped)
            elif style == "I":
                # Italic in translation — could be note, POS for sub-meaning, domain
                translation_parts.append(stripped)
            elif style == "B":
                # Bold in translation — numbered meaning or example
                if re.match(r'^\d+\.?\s*$', stripped):
                    num_val = re.match(r'(\d+)', stripped)
                    if num_val:
                        _cur_meaning_num = int(num_val.group(1))
                    translation_parts.append(stripped)
                else:
                    # Start of example
                    state = "examples"
                    cur_example_b = [stripped]
            elif style == "SUP":
                translation_parts.append(stripped)

        elif state == "examples" and not in_phraseology:
            if style == "B":
                # Flush previous example if we have both parts
                if cur_example_b and cur_example_n:
                    example_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n)), _cur_meaning_num))
                    cur_example_b = [stripped]
                    cur_example_n = []
                elif cur_example_b and not cur_example_n:
                    # Previous bold had no translation yet — extend it
                    cur_example_b.append(stripped)
                else:
                    cur_example_b = [stripped]
            elif style == "N":
                # Check if this Normal text contains a numbered meaning marker (N) ...)
                # e.g. "он тоже уехал в колхоз; 2) даже;"
                # Split at the numbered meaning and return remainder to translation
                num_match = re.search(r'(?:;\s*|$)(\d+)\s*\)', stripped)
                if num_match:
                    before = stripped[:num_match.start()].strip()
                    from_number = stripped[num_match.start():].strip()
                    # "before" is part of the current example's Russian translation
                    if before:
                        # Strip leading/trailing punctuation
                        before = before.rstrip(";, ")
                        if before:
                            cur_example_n.append(before)
                    # Flush the current example
                    if cur_example_b:
                        example_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n)), _cur_meaning_num))
                        cur_example_b = []
                        cur_example_n = []
                    # Return the numbered part to translation
                    # Strip leading punctuation (";") before the number
                    from_number = from_number.lstrip(";, ")
                    if from_number:
                        translation_parts.append(from_number)
                        # Update meaning number from the returned text
                        for nm in re.findall(r'(\d+)\s*\)', from_number):
                            _cur_meaning_num = int(nm)
                    state = "translation"
                else:
                    cur_example_n.append(stripped)
            elif style == "I":
                # Italic in examples — could be note
                if cur_example_n:
                    cur_example_n.append(stripped)
                elif cur_example_b:
                    # POS or note between bold and translation
                    cur_example_n.append(stripped)
                else:
                    translation_parts.append(stripped)
            elif style == "SUP":
                if cur_example_b:
                    cur_example_b.append(stripped)

        elif state == "phraseology":
            if style == "B":
                if cur_example_b and cur_example_n:
                    phraseology_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n))))
                    cur_example_b = [stripped]
                    cur_example_n = []
                elif cur_example_b and not cur_example_n:
                    cur_example_b.append(stripped)
                else:
                    cur_example_b = [stripped]
            elif style == "N":
                cur_example_n.append(stripped)
            elif style == "I":
                if cur_example_n:
                    cur_example_n.append(stripped)
                elif cur_example_b:
                    cur_example_n.append(stripped)
            elif style == "SUP":
                if cur_example_b:
                    cur_example_b.append(stripped)

    # Flush last example/phraseology
    if cur_example_b and cur_example_n:
        if in_phraseology:
            phraseology_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n))))
        else:
            example_pairs.append((_clean(" ".join(cur_example_b)), _clean(" ".join(cur_example_n)), _cur_meaning_num))

    # --- Build entry ---
    headword_raw = _clean(" ".join(headword_parts))
    if not headword_raw:
        return None

    # Remove stress-spacing: "ба хам" → "бахам"
    # Keep word as-is for wordAccented, normalize for word
    headword = _remove_stress_spaces(headword_raw)
    headword_accented = headword_raw if headword_raw != headword else None

    grammar_raw = _clean(" ".join(grammar_parts))
    pos_raw = _clean(" ".join(pos_parts))
    translation_raw = _clean(" ".join(translation_parts))
    word_note_raw = _clean(" ".join(word_note_parts))

    entry = {}
    entry["word"] = headword
    if headword_accented:
        entry["wordAccented"] = headword_accented

    if homonym_idx is not None:
        entry["homonymIndex"] = homonym_idx

    # Parse POS
    pos = _extract_pos(pos_raw)
    if not pos:
        pos = _extract_pos(word_note_raw)
    if not pos:
        pos = _extract_pos_from_translation(translation_raw)

    # Parse grammar block
    grammar_info = _parse_grammar(grammar_raw)

    if grammar_info.get("nounClass"):
        entry["nounClass"] = grammar_info["nounClass"]
    if grammar_info.get("nounClassPlural"):
        entry["nounClassPlural"] = grammar_info["nounClassPlural"]
    if grammar_info.get("plural"):
        entry["plural"] = grammar_info["plural"]
    if grammar_info.get("declension"):
        entry["declension"] = grammar_info["declension"]
    if grammar_info.get("verbForms"):
        entry["verbForms"] = grammar_info["verbForms"]

    # Infer POS from grammar
    if not pos:
        if grammar_info.get("verbForms"):
            pos = "гл."
        elif grammar_info.get("nounClass") or grammar_info.get("declension"):
            pos = "сущ."

    if pos:
        entry["partOfSpeech"] = pos

    # Has class star (*)
    if has_class_star:
        entry["classVariable"] = True

    # Word note
    if word_note_raw:
        # Check for reference patterns: "понуд. от X", "потенц. от X", "см. X", "прил. к X"
        entry["wordNote"] = word_note_raw

    # Parse translation into meanings
    if translation_raw:
        meanings = _parse_meanings(translation_raw, example_pairs, headword)
        if meanings:
            entry["meanings"] = meanings

    # Phraseology
    if phraseology_pairs:
        entry["phraseology"] = [{"nah": _replace_tilde(nah, headword), "ru": ru}
                                 for nah, ru in phraseology_pairs]

    # Extract domain/style labels from POS or translation
    _extract_labels(entry, pos_raw, translation_raw)

    # Check for obsolete
    if "уст." in (pos_raw + " " + word_note_raw + " " + translation_raw):
        entry["obsolete"] = True

    return entry


def _remove_stress_spaces(text):
    """Remove stress-marking spaces within words.

    In Maciev's PDF, stress is indicated by a thin space after the stressed syllable:
    "ба хам" → "бахам", "ба хархо" → "бахархо", "ба хаман" → "бахаман"

    But real multi-word headwords like "авсалан, авсалниг" should keep spaces.

    Strategy: remove spaces between Cyrillic letters where neither part is a
    standalone word (too short, ≤3 chars on either side of the space) — these
    are stress marks. Keep spaces in comma-separated forms.
    """
    if "," in text:
        # Process comma-separated parts individually
        parts = text.split(",")
        return ",".join(_remove_stress_spaces(p.strip()) for p in parts)

    words = text.split()
    if len(words) <= 1:
        return text

    # Merge words that are fragments (stress-split): if a word is short (≤3 chars)
    # and adjacent to another word, it's likely a stress fragment
    result = []
    i = 0
    while i < len(words):
        word = words[i]
        # Look ahead: merge short fragments
        while i + 1 < len(words):
            next_word = words[i + 1]
            # If current word ends with a letter and next starts with a letter,
            # and one of them is ≤3 chars → merge (stress space)
            if (word and next_word and
                word[-1].isalpha() and next_word[0].isalpha() and
                (len(word) <= 3 or len(next_word) <= 3)):
                word = word + next_word
                i += 1
            else:
                break
        result.append(word)
        i += 1

    return " ".join(result)


def _looks_like_grammar_start(text):
    """Check if text looks like grammar forms (chechen words before [...])."""
    # Grammar forms: space-separated chechen words ending with class letter or ]
    # Pattern: "формаGEN, формаDAT, формаERG, формаINSTR, CLASS; мн. PLURAL, CLASS]"
    if "]" in text:
        return True
    # Check: has multiple comma-separated parts (at least 2)
    # AND starts with a non-Russian word (chechen grammar form)
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if len(parts) >= 2:
        first = parts[0].strip().split()[0] if parts[0].strip() else ""
        if first and not _is_russian_start(first):
            return True
    # Trailing comma with non-Russian text → likely grammar forms
    if text.strip().endswith(",") and not _is_russian_start(text.strip().rstrip(",")):
        words = text.strip().rstrip(",").split()
        if words and len(words[0]) > 1:
            return True
    return False


def _is_pos(text):
    """Check if text is a part-of-speech marker."""
    pos_markers = ["прил.", "прич.", "нареч.", "сущ.", "гл.", "масд.", "межд.",
                   "союз", "послел.", "деепр.", "мест.", "числ.", "частица",
                   "звукоподр.", "понуд.", "потенц.", "см.", "разг.",
                   "объект в ед.", "объект во мн.", "субъект в ед.", "субъект во мн."]
    cleaned = text.strip().rstrip(".")
    for pm in pos_markers:
        if text.strip().startswith(pm):
            return True
    return False


def _extract_pos(text):
    """Extract POS from text."""
    if not text:
        return None
    pos_map = {
        "прил.": "прил.", "прич.": "прич.", "нареч.": "нареч.", "сущ.": "сущ.",
        "гл.": "гл.", "масд.": "масд.", "межд.": "межд.", "союз": "союз",
        "послел.": "послел.", "деепр.": "деепр.", "мест.": "мест.",
        "числ.": "числ.", "частица": "частица", "звукоподр.": "звукоподр."
    }
    for key, val in pos_map.items():
        if key in text:
            return val
    return None


def _extract_pos_from_translation(text):
    """Try to extract POS from translation text start."""
    if not text:
        return None
    # Check if translation starts with a Russian infinitive verb → гл.
    first_word = text.split()[0] if text.split() else ""
    fw = re.sub(r'[;,.\d\)\(\]\[]+', '', first_word)
    if fw and re.search(r'(?:ть|чь|сти|сть)(?:ся)?$', fw.lower()):
        return "гл."
    return None


def _parse_grammar(text):
    """Parse grammar block: declension forms, class, plural, verb forms."""
    result = {}
    if not text:
        return result

    # Remove brackets
    text = text.strip("[] \t")

    # Split into parts by semicolons to find class/plural sections
    # Pattern: "gen, dat, erg, instr, CLASS; мн. PLURAL, CLASS"
    # Or: "present, past, participle" (verb)
    # Or: "present, past, participle, future или futureForm CLASS" (verb with mood)

    # Check for "мн." (plural)
    plural_match = re.search(r'мн\.\s*([^;,\]]+?)(?:\s*,\s*([бвдйю]))?(?:\s*\]|\s*$)', text)
    if plural_match:
        plural_form = plural_match.group(1).strip().rstrip(",; ")
        if plural_form:
            result["plural"] = plural_form
        if plural_match.group(2):
            result["nounClassPlural"] = _expand_class(plural_match.group(2))

    # Check for "или" (alternative forms, typically in verbs)
    has_or = "или" in text

    # Find class letters: single [бвдйю] followed by ; or end
    class_matches = re.findall(r'(?:^|[,;\s])([бвдйю])(?:[,;\s\]]|$)', text)

    # Extract forms (everything except class letters, мн., или)
    clean_text = text
    # Remove мн. section
    clean_text = re.sub(r'мн\.\s*[^;]*', '', clean_text)
    # Remove class letters standing alone
    clean_text = re.sub(r'(?:^|(?<=[\s,;]))([бвдйю])(?=[\s,;\]]|$)', '', clean_text)
    # Remove "или" and alternative forms marker
    # Clean up
    clean_text = re.sub(r'\s+', ' ', clean_text).strip(", ;[]")

    forms = [f.strip().rstrip(",;* ").lstrip("* ") for f in clean_text.split(",") if f.strip().rstrip(",;* ")]
    # Filter out empty and class-only forms
    forms = [f for f in forms if f and f not in CLASS_LETTERS and len(f) > 1]

    # Handle "или" in forms (e.g., "гӀор или гӀур бу")
    final_forms = []
    for f in forms:
        if "или" in f:
            parts = f.split("или")
            for p in parts:
                p = p.strip()
                # Remove trailing class letters
                p = re.sub(r'\s+[бвдйю]$', '', p).strip()
                if p and p not in CLASS_LETTERS:
                    final_forms.append(p)
        else:
            # Remove trailing class letters
            f = re.sub(r'\s+[бвдйю]$', '', f).strip()
            if f and f not in CLASS_LETTERS:
                final_forms.append(f)
    forms = final_forms

    # Determine if noun (has class) or verb (no class, 2-3 forms)
    if class_matches:
        # Noun: assign first class as nounClass
        if class_matches and "nounClass" not in result:
            result["nounClass"] = _expand_class(class_matches[0])
        if len(class_matches) >= 2 and "nounClassPlural" not in result:
            result["nounClassPlural"] = _expand_class(class_matches[-1])

        # Noun declension: genitive, dative, ergative, instrumental
        if forms:
            decl = {}
            if len(forms) >= 1:
                decl["genitive"] = forms[0]
            if len(forms) >= 2:
                decl["dative"] = forms[1]
            if len(forms) >= 3:
                decl["ergative"] = forms[2]
            if len(forms) >= 4:
                decl["instrumental"] = forms[3]
            if decl:
                result["declension"] = decl
    elif len(forms) >= 2 and not class_matches:
        # Verb: present, past, participle
        vf = {}
        if len(forms) >= 1:
            vf["present"] = forms[0]
        if len(forms) >= 2:
            vf["past"] = forms[1]
        if len(forms) >= 3:
            vf["participle"] = forms[2]
        if vf:
            result["verbForms"] = vf

    # If we only have "только мн." — mark it
    if re.search(r'только\s+мн\.', text):
        result["pluralOnly"] = True

    return result


def _expand_class(letter):
    """Expand class letter to full form."""
    mapping = {"в": "ву", "й": "йу", "ю": "йу", "д": "ду", "б": "бу"}
    return mapping.get(letter, letter)


def _parse_meanings(text, example_pairs, headword):
    """Parse translation text into meanings array, splitting by numbered meanings.

    example_pairs: [(nah, ru, meaning_num), ...] where meaning_num indicates
    which numbered meaning (1, 2, ...) the example belongs to (0 = before any number).
    """
    if not text:
        return []

    # Split by numbered meanings: "1) text; 2) text" or "1. text; 2. text"
    parts = re.split(r'(?:^|\s)(\d+)\s*[).]\s*', text)

    meanings = []
    meaning_nums = []  # track the number of each meaning

    if len(parts) <= 1:
        # No numbered meanings — single meaning
        trans = _clean_translation(text)
        if trans:
            meaning = {"translation": trans}
            if example_pairs:
                meaning["examples"] = [{"nah": _replace_tilde(nah, headword), "ru": ru}
                                       for nah, ru, _mn in example_pairs]
            meanings.append(meaning)
    else:
        # Numbered meanings
        # parts[0] is text before first number (usually empty)
        # parts[1] is first number, parts[2] is text after first number, etc.
        prefix = parts[0].strip()
        if prefix:
            # Text before first number — could be a preamble, add as meaning 0
            pass

        for i in range(1, len(parts), 2):
            num = int(parts[i]) if i < len(parts) else 0
            trans_text = parts[i+1] if i+1 < len(parts) else ""
            trans = _clean_translation(trans_text)
            if trans:
                meaning = {"translation": trans}
                meanings.append(meaning)
                meaning_nums.append(num)

        # Distribute examples to meanings using meaning_num tags
        if example_pairs and meanings:
            if len(meanings) == 1:
                # Single meaning — all examples belong to it
                exs = [{"nah": _replace_tilde(nah, headword), "ru": ru}
                       for nah, ru, _mn in example_pairs]
                if exs:
                    meanings[0]["examples"] = exs
            else:
                # Multiple meanings — distribute by meaning_num
                # Build a mapping: meaning_number -> meaning_index
                num_to_idx = {}
                for idx, mn in enumerate(meaning_nums):
                    num_to_idx[mn] = idx

                for nah, ru, mn in example_pairs:
                    ex = {"nah": _replace_tilde(nah, headword), "ru": ru}
                    # Find the meaning this example belongs to
                    target_idx = num_to_idx.get(mn)
                    if target_idx is None:
                        # Fallback: if meaning_num is 0 (before any number), assign to first meaning
                        # If meaning_num > max known, assign to last meaning
                        if mn == 0:
                            target_idx = 0
                        else:
                            # Find the closest meaning with num <= mn
                            target_idx = len(meanings) - 1
                            for idx, num in enumerate(meaning_nums):
                                if num <= mn:
                                    target_idx = idx
                    meanings[target_idx].setdefault("examples", [])
                    meanings[target_idx]["examples"].append(ex)

    return meanings


def _clean_translation(text):
    """Clean translation text: remove stress spaces, clean parens, strip punctuation."""
    if not text:
        return ""
    result = text.strip()
    result = re.sub(r'\s+', ' ', result)
    result = result.strip(";., \t")
    result = _clean_parens(result)
    return result


def _remove_stress_spaces_russian(text):
    """Remove stress-marking thin spaces in Russian translations.

    "хозя йство" → "хозяйство", "се льское" → "сельское", "я щур" → "ящур"

    Pattern: stress mark in Maciev = space after stressed vowel within a word.
    The fragment BEFORE the space ends with a vowel (the stressed one), and
    the fragment AFTER starts with a consonant.

    We must NOT merge real separate words like "в ед." or "к ним".
    """
    VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯаьоьуь")
    # Common standalone short Russian words that should NOT be merged
    STANDALONE = {"в", "к", "с", "о", "у", "и", "а", "не", "ни", "по", "на", "за",
                  "из", "от", "до", "об", "во", "со", "ко", "же", "ли", "бы",
                  "то", "ка", "да", "их", "ее", "её", "он", "мы", "вы"}

    words = text.split(" ")
    if len(words) <= 1:
        return text

    result = []
    i = 0
    while i < len(words):
        word = words[i]
        while i + 1 < len(words):
            next_word = words[i + 1]
            if not word or not next_word:
                break
            last_char = word[-1] if word else ""
            first_char = next_word[0] if next_word else ""
            # Merge conditions:
            # 1. Previous fragment ends with a vowel
            # 2. Next fragment starts with a lowercase letter
            # 3. Neither fragment is a standalone word
            # 4. One of them is short (≤3 chars) — typical stress split
            if (last_char in VOWELS and
                first_char.isalpha() and first_char.islower() and
                word.lower() not in STANDALONE and
                next_word.lower() not in STANDALONE and
                (len(word) <= 3 or len(next_word) <= 3)):
                word = word + next_word
                i += 1
            else:
                break
        result.append(word)
        i += 1
    return " ".join(result)


def _replace_tilde(text, headword):
    """Replace ~ with headword."""
    if "~" not in text:
        return text

    # Known suffixes that should merge with headword
    SUFFIX_PATTERN = r'(аш|еш|ш|ан|ин|на|не|но|нел|га|о|е|ца|й|йн|наш|рш|ийн|ниг)'

    # ~suffix without space → merge
    result = re.sub(r'~(' + SUFFIX_PATTERN[1:-1] + r')\b', headword + r'\1', text)
    # ~ suffix with space (short suffix ≤5 chars) → merge
    result = re.sub(r'~\s+(' + SUFFIX_PATTERN[1:-1] + r')\b', headword + r'\1', result)
    # ~ + space + word → keep space
    result = re.sub(r'~\s+', headword + ' ', result)
    # ~word → merge
    result = re.sub(r'~([а-яёӀьъ])', headword + r'\1', result)
    # standalone ~
    result = result.replace("~", headword)
    return _clean(result)


def _extract_labels(entry, pos_raw, translation_raw):
    """Extract domain and style labels."""
    domains = {
        "грам.": "грам.", "мат.": "мат.", "мед.": "мед.", "юр.": "юр.",
        "бот.": "бот.", "зоол.": "зоол.", "геогр.": "геогр.", "муз.": "муз.",
        "воен.": "воен.", "тех.": "тех.", "хим.": "хим.", "физ.": "физ.",
        "лит.": "лит.", "ист.": "ист.", "спорт.": "спорт.", "с.-х.": "с.-х.",
        "вет.": "вет.", "рел.": "рел.", "мин.": "мин.", "охот.": "охот.",
        "кул.": "кул.", "анат.": "анат.", "астр.": "астр.", "лингв.": "лингв.",
        "миф.": "миф.",
    }
    style_labels = {
        "разг.": "разг.", "прост.": "прост.", "книжн.": "книжн.",
        "ласк.": "ласк.", "ирон.": "ирон.", "перен.": "перен.",
        "малоупотр.": "малоупотр.",
    }

    full_text = pos_raw + " " + translation_raw
    for key, val in domains.items():
        if key in full_text:
            entry["domain"] = val
            break
    for key, val in style_labels.items():
        if key in full_text:
            entry["styleLabel"] = val
            break


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------

def merge_split_entries(results):
    """Merge entries that were incorrectly split by detecting alphabetical violations."""
    merged = []
    skip_next = set()
    total_merged = 0

    for i in range(len(results)):
        if i in skip_next:
            continue

        entry = results[i]
        j = i + 1
        while j < len(results) and j not in skip_next:
            if j + 1 >= len(results):
                break

            prev_first = entry["word"][0].lower() if entry.get("word") else ""
            curr_first = results[j]["word"][0].lower() if results[j].get("word") else ""
            next_first = results[j+1]["word"][0].lower() if results[j+1].get("word") else ""

            if curr_first > prev_first and curr_first > next_first and prev_first <= next_first:
                # Merge results[j] into entry
                split_entry = results[j]
                # Add as extra meaning or example
                if split_entry.get("meanings"):
                    entry.setdefault("meanings", [])
                    entry["meanings"].extend(split_entry["meanings"])
                if split_entry.get("phraseology"):
                    entry.setdefault("phraseology", [])
                    entry["phraseology"].extend(split_entry["phraseology"])

                skip_next.add(j)
                total_merged += 1
                j += 1
            else:
                break

        merged.append(entry)

    print(f"  Merged {total_merged} split entries")
    return merged


def validate(results):
    """Print validation statistics."""
    print(f"\n=== Statistics ===")
    print(f"Total entries: {len(results)}")

    for field in ["nounClass", "plural", "declension", "verbForms", "partOfSpeech",
                  "meanings", "phraseology", "wordNote", "obsolete", "domain",
                  "styleLabel", "homonymIndex", "classVariable"]:
        n = sum(1 for e in results if field in e)
        print(f"  {field}: {n}")

    # Count meanings with examples
    with_examples = sum(1 for e in results if e.get("meanings") and
                        any(m.get("examples") for m in e["meanings"]))
    print(f"  entries_with_examples: {with_examples}")

    # Count empty translations
    empty_trans = sum(1 for e in results if not e.get("meanings") and not e.get("wordNote"))
    print(f"  empty_translation: {empty_trans}")

    # Count remaining tildes
    tilde_count = 0
    for e in results:
        for m in e.get("meanings", []):
            if "~" in m.get("translation", ""):
                tilde_count += 1
            for ex in m.get("examples", []):
                if "~" in ex.get("nah", "") or "~" in ex.get("ru", ""):
                    tilde_count += 1
        for p in e.get("phraseology", []):
            if "~" in p.get("nah", "") or "~" in p.get("ru", ""):
                tilde_count += 1
    print(f"  remaining_tildes: {tilde_count}")

    # Count broken parens
    broken_parens = 0
    for e in results:
        for m in e.get("meanings", []):
            t = m.get("translation", "")
            if "( )" in t or "( " in t or " )" in t:
                broken_parens += 1
    print(f"  broken_parens: {broken_parens}")

    # POS distribution
    pos_dist = {}
    for e in results:
        p = e.get("partOfSpeech", "unknown")
        pos_dist[p] = pos_dist.get(p, 0) + 1
    print(f"\n  POS distribution:")
    for p, c in sorted(pos_dist.items(), key=lambda x: -x[1]):
        print(f"    {p}: {c}")

    # Sample entries
    print(f"\n--- Key samples ---")
    for target in ["авсал", "бахам", "бахархо", "нана", "герз", "шекдала", "кан", "тӀам"]:
        matches = [e for e in results if e["word"] == target or
                   e["word"].replace(" ", "") == target]
        if matches:
            for e in matches:
                print(json.dumps(e, ensure_ascii=False, indent=2)[:500])
        else:
            # Try fuzzy
            close = [e for e in results if target in e["word"]][:1]
            if close:
                print(f"  (fuzzy for '{target}'): {json.dumps(close[0], ensure_ascii=False)[:300]}")
            else:
                print(f"  '{target}': NOT FOUND")


# ---------------------------------------------------------------------------
# Parse geographic names
# ---------------------------------------------------------------------------

def parse_geo_entry(spans):
    """Parse geographic name entry (simpler structure)."""
    if not spans:
        return None

    headword_parts = []
    geo_type_parts = []
    translation_parts = []

    state = "head"
    for style, text in spans:
        stripped = text.strip()
        if state == "head":
            if style == "B":
                headword_parts.append(stripped)
            elif style == "I":
                geo_type_parts.append(stripped)
                state = "type"
            elif style == "N":
                translation_parts.append(stripped)
                state = "trans"
        elif state == "type":
            if style == "N":
                translation_parts.append(stripped)
                state = "trans"
            elif style == "I":
                geo_type_parts.append(stripped)
            elif style == "B":
                # Reference: "см. X"
                if any("см." in g for g in geo_type_parts):
                    translation_parts.append(stripped)
                    state = "trans"
                else:
                    headword_parts.append(stripped)
        elif state == "trans":
            if style in ("N", "I", "B"):
                translation_parts.append(stripped)

    headword = _clean(" ".join(headword_parts))
    if not headword:
        return None

    entry = {"word": headword, "section": "geo"}
    geo_type = _clean(" ".join(geo_type_parts))
    translation = _clean(" ".join(translation_parts)).strip(";. ")

    if geo_type:
        entry["geoType"] = geo_type
    if translation:
        entry["translation"] = translation

    return entry


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    doc = fitz.open(PDF_PATH)
    print(f"Opened PDF: {doc.page_count} pages")

    results = []
    entry_id = 0

    # Parse main dictionary
    print("Parsing main dictionary (pages 20-548)...")
    spans = extract_spans(doc, DICT_PAGES)
    print(f"  Extracted {len(spans)} spans")
    raw_entries = split_into_entries(spans)
    print(f"  Split into {len(raw_entries)} raw entries")
    count = 0
    for raw in raw_entries:
        entry = parse_entry(raw)
        if entry:
            entry_id += 1
            entry["id"] = str(entry_id)
            results.append(entry)
            count += 1
    print(f"  Parsed {count} entries")

    # Post-process: merge split entries
    results = merge_split_entries(results)

    # Re-number
    for i, entry in enumerate(results):
        entry["id"] = str(i + 1)

    print(f"\nTotal: {len(results)}")
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Written to: {OUTPUT_PATH}")

    validate(results)


if __name__ == "__main__":
    main()
