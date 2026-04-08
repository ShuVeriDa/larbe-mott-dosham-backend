#!/usr/bin/env python3
"""
Парсер PDF словаря Абдурашидова → abdurashidov_ce_ru_ru_ce2.json

Стили по PDF:
  [B]  Bold           — заглавное слово / фраза / подстатья
  [BI] Bold+Italic    — грамматика (класс, мн.ч., склонение, этимология)
  [I]  Italic         — пояснения, синонимы, (уст.), тильда ~
  [N]  Normal         — перевод

Паттерн CE→RU записи:
  [B]headword [BI](etym.) class; plural class; cases [I](note) [N]translation
  [B]; ← разделитель sub-entries (bold semicolon)
  [B]sub-phrase ~ [BI]class [N]sub-translation
"""

import fitz
import json
import re
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

PDF_PATH = r"H:\MyDocument\MyArhiv\OneDrive - Medical College\MyArhiv\Изучение языков\чеченские словари\Abdurashidov_E.D._Chechensko-russkiy_russko-chechenskiy_slovar_uridicheskih_terminov.pdf"
OUTPUT_PATH = r"F:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\abdurashidov_ce_ru_ru_ce.json"

CE_RU_PAGES = range(7, 95)       # pages 8-95
APPENDIX_PAGES = range(95, 99)   # pages 96-99 (appendix to CE→RU)
RU_CE_PAGES = range(100, 176)    # pages 101-176 (stop before "Заключение автора" on page 177)

CLASS_LETTERS = set("бвдйю")
ETYMOLOGY_LANGS = {"фр.", "лат.", "гр.", "Ӏаьрб.", "нем.", "ит.", "исп.", "ингал."}
ETYMOLOGY_RE = re.compile(r'\((' + '|'.join(re.escape(l) for l in ETYMOLOGY_LANGS) + r')\)')


def _clean(text):
    return re.sub(r'\s+', ' ', text).strip()


def _clean_parens(text):
    """Remove unbalanced parentheses and clean up."""
    result = text.strip()

    # Remove leading unmatched ')'
    while result.startswith(")"):
        result = result[1:].strip()

    # Remove trailing unmatched '('
    while result.endswith("("):
        result = result[:-1].strip()

    # Count balance and remove unmatched parens from inside
    depth = 0
    for ch in result:
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
    if depth > 0:
        # More '(' than ')' — remove unmatched '(' from left to right
        chars = list(result)
        to_remove = depth
        for i in range(len(chars)):
            if chars[i] == '(' and to_remove > 0:
                # Check if this ( has a matching )
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
        # More ')' than '(' — remove unmatched ')' from right to left
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

    # Clean up spaces
    result = re.sub(r'\s+', ' ', result).strip()

    # Strip outer matched parens if entire string is wrapped
    if result.startswith("(") and result.endswith(")"):
        inner = result[1:-1]
        if inner.count("(") == inner.count(")"):
            result = inner.strip()

    return result.strip("; ").strip()


def _extract_class(text):
    """Extract class from text like 'ю,ю', 'д,д', 'в,ю,б', 'б'."""
    cleaned = text.strip(", ()").strip()
    tokens = [t.strip() for t in re.split(r'[,\s]+', cleaned) if t.strip()]
    if all(t in CLASS_LETTERS for t in tokens) and 1 <= len(tokens) <= 3:
        return ", ".join(tokens)
    return None


# ---------------------------------------------------------------------------
# Extract spans from PDF, fix line-break hyphens
# ---------------------------------------------------------------------------

def extract_spans(doc, page_range):
    raw = []
    for page_idx in page_range:
        page = doc[page_idx]
        for block in page.get_text("dict")["blocks"]:
            if "lines" not in block:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"]
                    if not text.strip():
                        continue
                    size = round(span["size"], 1)
                    if size <= 10.0 or size >= 18.0:
                        continue
                    flags = span["flags"]
                    b = bool(flags & (1 << 4))
                    it = bool(flags & (1 << 1))
                    style = "BI" if b and it else "B" if b else "I" if it else "N"
                    raw.append((style, text))

    # Fix line-break hyphens
    fixed = []
    i = 0
    while i < len(raw):
        style, text = raw[i]
        if (text.rstrip().endswith("-") and
            not text.rstrip().endswith(" -") and  # real dash like "зулам-"
            i + 1 < len(raw) and
            raw[i+1][0] == style and
            raw[i+1][1].strip() and
            raw[i+1][1].strip()[0].islower()):
            merged = text.rstrip()[:-1] + raw[i+1][1]
            fixed.append((style, merged))
            i += 2
        else:
            fixed.append((style, text))
            i += 1

    # Fix split etymology: [B]( + [BI]лат + [B].) → [BI](лат.)
    # Pattern: "(", then etym lang, then ".)" across 2-4 spans
    ETYM_WORDS = {"фр", "лат", "гр", "Ӏаьрб", "нем", "ит", "исп", "ингал",
                  "ьрб"}  # "ьрб" handles split "Ӏа"+"ьрб"
    result = []
    i = 0
    while i < len(fixed):
        s, t = fixed[i]
        # Check if this span ends with "(" and next spans contain etymology
        if t.rstrip().endswith("(") and i + 1 < len(fixed):
            # Look ahead for etymology pattern
            etym_found = False
            for lookahead in range(1, 5):
                if i + lookahead >= len(fixed):
                    break
                _, lt = fixed[i + lookahead]
                stripped_lt = lt.strip(". ())")
                if stripped_lt in ETYM_WORDS:
                    # Found etymology word — now find closing )
                    close_j = None
                    for j in range(i + lookahead, min(i + lookahead + 3, len(fixed))):
                        if ")" in fixed[j][1]:
                            close_j = j
                            break
                    if close_j is not None:
                        # Reconstruct: remove "(" from current span,
                        # create a BI etymology span, skip consumed spans
                        prefix = t.rstrip()[:-1]  # remove trailing "("
                        if prefix.strip():
                            result.append((s, prefix))
                        # Build etymology string
                        etym_text = "(" + stripped_lt + ".)"
                        result.append(("BI", etym_text))
                        # Add anything after ")" in the closing span
                        after_close = fixed[close_j][1].split(")", 1)
                        if len(after_close) > 1 and after_close[1].strip():
                            result.append((fixed[close_j][0], after_close[1]))
                        i = close_j + 1
                        etym_found = True
                        break
                if ")" in lt:
                    break  # Closing paren without etymology — not what we want
            if etym_found:
                continue
        result.append((s, t))
        i += 1

    return result


# ---------------------------------------------------------------------------
# Split spans into entries
# ---------------------------------------------------------------------------

def split_into_entries(spans):
    """
    New entry = [B] span starting a new headword after we've seen translation [N].
    NOT a new entry if:
      - Bold text is just ";" (sub-entry separator)
      - Bold text contains "~" (sub-entry)
      - Previous span was "~" or ";" (tilde continuation)
    """
    entries = []
    current = []
    has_translation = False

    for i, (style, text) in enumerate(spans):
        stripped = text.strip()

        # Skip single-letter section headers
        if style == "B" and len(stripped) <= 3 and stripped.replace("Ӏ", "").isupper() and len(stripped) >= 1:
            # Could be "А", "Б", "АЬ", "I", "Юь" etc.
            if stripped in ("А", "Б", "В", "Г", "ГӀ", "Д", "ДӀ", "Е", "Ж", "З", "И",
                           "К", "КХ", "Къ", "КӀ", "Л", "М", "Н", "О", "ОЬ", "П", "Р",
                           "С", "Т", "ТӀ", "У", "Ф", "Х", "ХӀ", "Хь", "Ц", "ЦӀ", "Ч",
                           "ЧӀ", "Ш", "Щ", "Э", "Ю", "Я", "I",
                           "АЬ", "Юь", "Бу", "Юь"):
                if current:
                    entries.append(current)
                    current = []
                    has_translation = False
                continue

        # New entry when [B] follows a complete entry without translation
        # e.g. "лач тоьшалла [BI]д [I](...)" then "[B]лаьттан кодекс"
        # Requires: current has [BI] (grammar) AND [I] ending with ")"
        if (style == "B" and not has_translation and current and
            any(s == "BI" for s, _ in current) and
            any(s == "I" for s, _ in current)):
            prev_text = current[-1][1].strip() if current else ""
            if prev_text.endswith(")"):
                entries.append(current)
                current = []
                has_translation = False

        if style == "B" and has_translation and current:
            # Is this a sub-entry or a new headword?
            is_sub = False

            # Bold ";" is a sub-entry separator
            if stripped in (";", ";,", ","):
                is_sub = True

            # Contains tilde — sub-entry
            if "~" in stripped:
                is_sub = True

            # Previous span was tilde or semicolon in any style
            if current:
                prev_style, prev_raw = current[-1]
                prev_text = prev_raw.strip()
                if prev_text in ("~", "~;", "; ~"):
                    is_sub = True
                # Bold ";" or "," as prev — separator (but NOT [N]";")
                elif prev_text in (";", ",") and prev_style == "B":
                    is_sub = True
                # Previous span ENDS with ~ (sub-entry continuation)
                elif prev_text.endswith("~"):
                    is_sub = True
                # Previous span was also [B] — multi-line bold continuation
                elif prev_style == "B":
                    is_sub = True

            # Look-ahead: if the IMMEDIATELY next span is [B] with ~,
            # or any next span (within 1-2) is just "~",
            # this is multi-line sub-entry
            if not is_sub:
                for j in range(i + 1, min(i + 3, len(spans))):
                    ns, nt = spans[j]
                    nt_stripped = nt.strip()
                    # Next [B] has tilde
                    if ns == "B" and "~" in nt_stripped:
                        is_sub = True
                        break
                    # Next span is just "~" (any style)
                    if nt_stripped == "~":
                        is_sub = True
                        break
                    # Next [B] without ~ — stop looking
                    if ns == "B" and "~" not in nt_stripped:
                        break

            if not is_sub:
                entries.append(current)
                current = []
                has_translation = False

        current.append((style, text))
        if style == "N":
            has_translation = True

    if current:
        entries.append(current)
    return entries


# ---------------------------------------------------------------------------
# Parse CE→RU
# ---------------------------------------------------------------------------

def parse_ce_ru(spans):
    """
    Parse entry by walking through spans sequentially.

    State machine:
    - HEADWORD: collect [B] text as headword
    - GRAMMAR: collect [BI] text as grammar
    - TRANSLATION: first [N] text is translation
    - SUB: after translation, [B] text (with ~) starts sub-entries,
           each sub gets its own [BI] (class) and [N] (translation)
    """
    # First pass: find where the main translation ends and sub-entries begin.
    # Main entry = spans up to first [N], then sub-entries follow.
    # But we need to also collect [N] and [I] spans BETWEEN the first [N] and first sub-entry [B].

    headword_b = []
    grammar_bi = []
    word_note_i = []     # [I] before first [N] — notes about the Chechen word
    trans_note_i = []    # [I] after first [N] — notes about the Russian translation
    translation_n = []

    sub_entries = []
    cur_sub = None  # {"b": [], "bi": [], "i": [], "n": []}

    state = "head"

    for style, text in spans:
        stripped = text.strip()

        if state == "head":
            if style == "B":
                headword_b.append(text)
            elif style == "BI":
                grammar_bi.append(text)
            elif style == "I":
                word_note_i.append(text)
            elif style == "N":
                translation_n.append(text)
                state = "after_trans"

        elif state == "after_trans":
            if style == "B":
                if stripped in (";", ","):
                    # Separator — prepare for sub-entry with ~
                    state = "await_sub"
                    continue
                elif "~" in stripped:
                    if cur_sub:
                        _flush_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    state = "sub"
                    continue
                else:
                    # Bold text without ~ after translation — ignore
                    # (this is spillover from split_into_entries)
                    continue

            elif style in ("BI", "I"):
                if stripped in ("~", ";", "~;", "; ~"):
                    if cur_sub:
                        _flush_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    state = "sub"
                    continue
                elif style == "I":
                    trans_note_i.append(text)
                    continue
                else:
                    continue

            elif style == "N":
                translation_n.append(text)
                continue

        elif state == "await_sub":
            # After [B]; separator — waiting for sub-entry with ~
            if style == "B":
                if "~" in stripped:
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    state = "sub"
                    continue
                elif stripped in (";", ","):
                    continue  # Another separator
                else:
                    # Bold without ~ after separator — could be multi-line
                    # sub-entry phrase (e.g. кхаж тосучеран... → next [B] has ~)
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    state = "sub"
                    continue
            elif style in ("BI", "I"):
                if stripped in ("~", ";"):
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    state = "sub"
                    continue
            elif style == "N":
                # Normal text after separator without sub — append to translation
                translation_n.append(text)
                state = "after_trans"
                continue

        elif state == "sub":
            if style == "B":
                if stripped in (";", ","):
                    # Separator — flush current sub, start new
                    _flush_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [], "bi": [], "i": [], "n": []}
                    continue
                elif "~" in stripped:
                    _flush_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    continue
                else:
                    # Bold without ~ — only add to sub if prev ends with ~
                    # (multi-line phrase like "кхаж тосучеран..." + "харцонаш хиларца доьзна ~")
                    prev_b = _clean(" ".join(cur_sub["b"]))
                    if prev_b.endswith("~") or prev_b.endswith(";"):
                        cur_sub["b"].append(text)
                    elif not cur_sub["n"] and not cur_sub["bi"] and prev_b:
                        # Continuation of multi-line sub phrase (no translation yet, has prev bold)
                        cur_sub["b"].append(text)
                    else:
                        # Not a sub-entry — ignore (spillover from split_into_entries)
                        _flush_sub(sub_entries, cur_sub)
                        cur_sub = {"b": [], "bi": [], "i": [], "n": []}
                    continue

            elif style == "BI":
                if stripped in ("~", ";"):
                    # Tilde — if cur_sub already has translation, start new sub
                    if cur_sub["n"]:
                        _flush_sub(sub_entries, cur_sub)
                        cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    else:
                        cur_sub["b"].append(text)
                else:
                    cur_sub["bi"].append(text)
                continue

            elif style == "I":
                if stripped in ("~", ";", "~;"):
                    # Tilde/separator — if cur_sub has translation, start new
                    if cur_sub["n"]:
                        _flush_sub(sub_entries, cur_sub)
                        cur_sub = {"b": [text], "bi": [], "i": [], "n": []}
                    else:
                        cur_sub["b"].append(text)
                else:
                    cur_sub["i"].append(text)
                continue

            elif style == "N":
                # Check if [N] text ends with ~ — new sub-entry starts
                if stripped.endswith("~") or stripped.endswith("~ "):
                    # Split: text before ~ is translation of current sub,
                    # ~ starts new sub
                    before_tilde = stripped.rsplit("~", 1)[0].strip("; ").strip()
                    if before_tilde:
                        cur_sub["n"].append(before_tilde)
                    _flush_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [], "bi": [], "i": [], "n": []}
                    # The ~ itself is not added — next [B] will be the phrase
                    state = "await_sub"
                elif "~" in stripped:
                    # ~ in middle of [N] — just add the whole text
                    cur_sub["n"].append(text)
                else:
                    cur_sub["n"].append(text)
                continue

    # Flush last sub
    if cur_sub:
        _flush_sub(sub_entries, cur_sub)

    # --- Build entry ---
    headword = _clean(" ".join(headword_b))
    grammar_raw = _clean(" ".join(grammar_bi))
    word_note_raw = _clean(" ".join(word_note_i))
    trans_note_raw = _clean(" ".join(trans_note_i))
    translation = _clean(" ".join(translation_n)).strip("; ").strip()

    if not headword:
        return None

    # Extract trailing class from headword: "бакъо ю" → "бакъо" + class=ю
    # Also handles "в, ю" or "в,ю,б" at end
    trailing_cls = None
    hw_cls_match = re.match(
        r'^(.+?)\s+([бвдйю])(?:\s*,\s*([бвдйю]))*\s*;?\s*$',
        headword
    )
    if hw_cls_match:
        potential_word = hw_cls_match.group(1).strip()
        cls_str = headword[len(potential_word):].strip().rstrip(";").strip()
        cls_tokens = [t.strip() for t in cls_str.split(",") if t.strip()]
        if all(t in CLASS_LETTERS for t in cls_tokens) and potential_word:
            headword = potential_word
            trailing_cls = ", ".join(cls_tokens)

    entry = {"word": headword}

    # Extract etymology — also check headword for fragments like "алкоголизм ("
    etymology = None
    # Try grammar first, then note, then headword+grammar combined
    combined_for_etym = grammar_raw
    # Handle case where "(" is at end of headword and "Ӏаьрб.)" is in grammar
    if headword.endswith("(") or headword.endswith("( "):
        combined_for_etym = "(" + grammar_raw
        headword = re.sub(r'\s*\(\s*$', '', headword).strip()
        entry["word"] = headword

    for src_name, src in [("grammar", combined_for_etym), ("note", word_note_raw)]:
        m = ETYMOLOGY_RE.search(src)
        if m:
            etymology = m.group(1)
            if src_name == "grammar":
                grammar_raw = ETYMOLOGY_RE.sub("", combined_for_etym).strip()
                grammar_raw = re.sub(r'^\s*\(\s*', '', grammar_raw)
                grammar_raw = re.sub(r'\s*\)\s*', ' ', grammar_raw).strip()
            else:
                word_note_raw = ETYMOLOGY_RE.sub("", word_note_raw).strip()
            break
    if etymology:
        entry["etymology"] = etymology

    # Apply trailing class from headword
    if trailing_cls:
        entry["nounClass"] = trailing_cls

    # Parse grammar
    if grammar_raw:
        gram = _parse_grammar(grammar_raw)
        if gram.get("nounClass") and "nounClass" not in entry:
            entry["nounClass"] = gram["nounClass"]
        if gram.get("plural"):
            entry["plural"] = gram["plural"]
        if gram.get("declension"):
            entry["declension"] = gram["declension"]

    # Parse wordNote (from [I] spans before translation)
    # Multiple [I] spans may contain separate parenthetical notes:
    # "(йоьхначу)" + "(йоьхначу машен...)" → split into parts
    if word_note_raw:
        # Split on ")(" boundaries first, then check for ";" within parts
        paren_parts = re.split(r'\)\s*\(', word_note_raw)
        cleaned_parts = []
        for p in paren_parts:
            p = p.strip("() ;~").strip()
            if p:
                cleaned_parts.append(p)

        # Check for уст. in any part
        has_obsolete = any("уст." in p for p in cleaned_parts)
        if has_obsolete:
            entry["obsolete"] = True
            cleaned_parts = [p.replace("уст.", "").strip("; ").strip() for p in cleaned_parts]
            cleaned_parts = [p for p in cleaned_parts if p]

        if len(cleaned_parts) <= 1:
            # Single note → separate field
            note_text = cleaned_parts[0] if cleaned_parts else ""
            if note_text:
                entry["wordNote"] = note_text
        else:
            # Multiple notes (from ")(" split) → embed in word
            word_with_notes = entry["word"]
            for note in cleaned_parts:
                word_with_notes += f" ({note})"
            entry["word"] = word_with_notes

    # Parse translationNote (from [I] spans after translation)
    _multi_trans_notes = []
    if trans_note_raw:
        parts = re.split(r'\)\s*\(', trans_note_raw)
        cleaned_parts = []
        for p in parts:
            p = p.strip("() ;~").strip()
            if p:
                cleaned_parts.append(p)

        if len(cleaned_parts) == 1:
            # Single note → separate field
            entry["translationNote"] = cleaned_parts[0]
        elif len(cleaned_parts) > 1:
            # Multiple notes → will embed into translation below
            _multi_trans_notes = cleaned_parts
        else:
            _multi_trans_notes = []
    else:
        _multi_trans_notes = []

    if translation:
        # Extract class marker from start of translation: "ю стороны" → class=ю, trans="стороны"
        trans_cls_match = re.match(r'^([бвдйю])\s+(.+)$', translation)
        if trans_cls_match and "nounClass" not in entry:
            entry["nounClass"] = trans_cls_match.group(1)
            translation = trans_cls_match.group(2).strip()
        # Embed multiple translationNotes into translation
        if _multi_trans_notes:
            for note in _multi_trans_notes:
                translation += f" ({note})"
        entry["translation"] = translation

    # Clean headword: remove broken parenthetical fragments
    word = entry["word"]
    word = re.sub(r'\s*\(\s*\.?\s*\)\s*', ' ', word)  # "( .)" → " "
    word = re.sub(r'\s*\(\s*$', '', word)               # trailing "("
    word = re.sub(r'\s*;\s*,?\s*$', '', word)            # trailing "; ,"
    word = re.sub(r'\s+', ' ', word).strip()
    entry["word"] = word

    # Clean translation: remove broken parenthetical fragments
    if entry.get("translation"):
        t = entry["translation"]
        t = _clean_parens(t)
        t = re.sub(r'\(\s*\)', '', t)           # "( )" → ""
        t = re.sub(r'\(\s*;\s*\)', '', t)       # "( ; )" → ""
        t = re.sub(r'\(\s*\.\s*\)', '', t)      # "( . )" → ""
        t = re.sub(r'\s+', ' ', t).strip()
        t = t.strip("; ").strip()
        if t:
            entry["translation"] = t
        else:
            del entry["translation"]

    # Replace remaining ~ with headword
    for field in ["translation", "wordNote", "translationNote"]:
        if entry.get(field) and "~" in entry[field]:
            entry[field] = _replace_tilde(entry[field], word)

    if sub_entries:
        # Replace ~ with headword in sub-entry phrases and translations
        for sub in sub_entries:
            if "phrase" in sub:
                sub["phrase"] = _replace_tilde(sub["phrase"], word)
            if "translation" in sub:
                sub["translation"] = _replace_tilde(sub["translation"], word)
        entry["subEntries"] = sub_entries

    return entry


def _replace_tilde(text, headword):
    """Replace ~ with headword, handling suffixes like ~ан → headword+ан.

    Rules:
    - ~suffix (no space): ~ан → авторан
    - ~ suffix (short, ≤5 chars): ~ ан → авторан (suffix with accidental space)
    - ~ word (long): ~ яларан → бакъо яларан (separate word)
    - standalone ~: → headword
    """
    # Known suffixes that should merge with headword
    SUFFIX_RE = r'(аш|еш|ш|ан|ин|на|не|но|нел|га|о|е|ца|й|йн|наш|рш|долуш|цабар|ийн)'

    # ~suffix without space → merge
    result = re.sub(r'~(' + SUFFIX_RE[1:-1] + r')\b', headword + r'\1', text)
    # ~ suffix with space → merge (short suffix ≤5 chars after space)
    result = re.sub(r'~\s+(' + SUFFIX_RE[1:-1] + r')\b', headword + r'\1', result)
    # ~ + space + word (not a suffix) → keep space
    result = re.sub(r'~\s+', headword + ' ', result)
    # ~word without space (not matched above) → merge
    result = re.sub(r'~([а-яёӀ])', headword + r'\1', result)
    # standalone ~
    result = result.replace("~", headword)
    # Clean up
    result = re.sub(r'\s+', ' ', result).strip()
    return result


def _flush_sub(sub_entries, cur_sub):
    """Build and add a sub-entry to the list."""
    phrase = _clean(" ".join(cur_sub["b"])).strip("; ,").strip()
    if not phrase or phrase in ("~", ";"):
        return

    sub = {"phrase": phrase}

    bi = _clean(" ".join(cur_sub["bi"])).strip()
    if bi:
        cls = _extract_class(bi)
        if cls:
            sub["nounClass"] = cls

    note = _clean(" ".join(cur_sub["i"])).strip("() ;").strip()
    if note:
        sub["note"] = note

    trans = _clean(" ".join(cur_sub["n"])).strip("; ").strip()
    if trans:
        sub["translation"] = trans

    sub_entries.append(sub)


def _parse_grammar(text):
    """Parse BI grammar: 'ю; бакъонаш ю; бакъонан, бакъонна, бакъоно, бакъоне'"""
    result = {}
    parts = [p.strip() for p in text.split(";") if p.strip()]
    case_candidates = []

    for part in parts:
        # Split into tokens
        tokens = [t.strip(",. ") for t in part.split() if t.strip(",. ")]
        class_tokens = [t for t in tokens if t in CLASS_LETTERS]
        other_tokens = [t for t in tokens if t not in CLASS_LETTERS and len(t) > 0]

        # Pure class: "ю", "в, ю"
        if not other_tokens and class_tokens:
            if "nounClass" not in result:
                result["nounClass"] = ", ".join(class_tokens)
            continue

        # Mixed: "ю, авантюраш ю" — class + plural in same semicolon segment
        # Pattern: class, word+class (comma-separated, first token is class)
        comma_parts_raw = [p.strip() for p in part.split(",") if p.strip()]
        if (len(comma_parts_raw) >= 2 and
            comma_parts_raw[0].strip() in CLASS_LETTERS):
            if "nounClass" not in result:
                result["nounClass"] = comma_parts_raw[0].strip()
            # Remaining parts: "авантюраш ю" — try as plural
            rest = ", ".join(comma_parts_raw[1:]).strip()
            rest_tokens = rest.split()
            rest_cls = [t for t in rest_tokens if t.strip(",") in CLASS_LETTERS]
            rest_words = [t for t in rest_tokens if t.strip(",") not in CLASS_LETTERS and len(t.strip(",")) > 1]
            if len(rest_words) == 1 and len(rest_cls) == 1 and re.search(r'(аш|еш|ш|й)$', rest_words[0]):
                result["plural"] = f"{rest_words[0]} {rest_cls[0].strip(',')}"
            continue

        # Plural: word ending in -аш/-еш/-ш + class
        if len(other_tokens) == 1 and len(class_tokens) == 1:
            word = other_tokens[0]
            if re.search(r'(аш|еш|ш|й)$', word):
                result["plural"] = f"{word} {class_tokens[0]}"
                continue

        # Class pair in text: "д,д" or "б,б"
        pair = re.match(r'^([бвдйю])\s*,\s*([бвдйю])$', part.strip())
        if pair:
            if "nounClass" not in result:
                result["nounClass"] = f"{pair.group(1)}, {pair.group(2)}"
            continue

        # Case forms: ≥3 comma-separated words
        comma_parts = [p.strip() for p in part.split(",") if p.strip()]
        if len(comma_parts) >= 3:
            forms = []
            for cp in comma_parts:
                for w in cp.split():
                    w = w.strip()
                    if w and w not in CLASS_LETTERS and len(w) > 1:
                        forms.append(w)
            if len(forms) >= 3:
                case_candidates.extend(forms)

    if case_candidates:
        forms = case_candidates[:4]
        if forms:
            result["declension"] = ", ".join(forms)

    return result


# ---------------------------------------------------------------------------
# Parse RU→CE
# ---------------------------------------------------------------------------

def parse_ru_ce(spans):
    """Parse RU→CE entry. Similar state machine but RU headword is [B], translation is [N]."""
    headword_b = []
    translation_n = []
    note_parts = []  # [I] and [BI]
    sub_entries = []
    cur_sub = None
    state = "head"

    for style, text in spans:
        stripped = text.strip()

        if state == "head":
            if style == "B":
                headword_b.append(text)
            elif style == "N":
                translation_n.append(text)
                state = "after_trans"
            elif style in ("I", "BI"):
                note_parts.append(text)

        elif state == "after_trans":
            if style == "B":
                if stripped in (";", ","):
                    if cur_sub:
                        _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [], "n": [], "i": []}
                    state = "sub"
                elif "~" in stripped:
                    if cur_sub:
                        _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "n": [], "i": []}
                    state = "sub"
                else:
                    if cur_sub:
                        _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "n": [], "i": []}
                    state = "sub"
            elif style == "N":
                translation_n.append(text)
            elif style in ("I", "BI"):
                if stripped in ("~", ";"):
                    if cur_sub:
                        _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "n": [], "i": []}
                    state = "sub"
                else:
                    note_parts.append(text)

        elif state == "sub":
            if style == "B":
                if stripped in (";", ","):
                    _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [], "n": [], "i": []}
                elif "~" in stripped:
                    _flush_ru_sub(sub_entries, cur_sub)
                    cur_sub = {"b": [text], "n": [], "i": []}
                else:
                    prev_b = _clean(" ".join(cur_sub["b"]))
                    if prev_b.endswith("~") or prev_b.endswith(";") or not cur_sub["n"]:
                        cur_sub["b"].append(text)
                    else:
                        _flush_ru_sub(sub_entries, cur_sub)
                        cur_sub = {"b": [text], "n": [], "i": []}
            elif style == "N":
                cur_sub["n"].append(text)
            elif style in ("I", "BI"):
                if stripped in ("~", ";"):
                    cur_sub["b"].append(text)
                else:
                    cur_sub["i"].append(text)

    if cur_sub:
        _flush_ru_sub(sub_entries, cur_sub)

    headword = _clean(" ".join(headword_b))
    translation = _clean(" ".join(translation_n)).strip("; ").strip()
    note_raw = _clean(" ".join(note_parts)).strip("() ;").strip()

    if not headword:
        return None

    entry = {"word": headword}
    if translation:
        # Clean broken parenthetical fragments
        translation = _clean_parens(translation)
        translation = re.sub(r'\(\s*\)', '', translation)
        translation = re.sub(r'\(\s*;\s*\)', '', translation)
        translation = re.sub(r'\s+', ' ', translation).strip("; ").strip()
        if translation:
            entry["translation"] = translation

    if note_raw:
        # Clean unbalanced parentheses
        note_cleaned = _clean_parens(note_raw)
        # Extract class — try full note as class first
        cls = _extract_class(note_cleaned)
        if cls:
            entry["nounClass"] = cls
            remaining = re.sub(r'^[бвдйю](?:\s*,\s*[бвдйю])*', '', note_cleaned).strip(", ()").strip()
            remaining = _clean_parens(remaining)
            if remaining:
                entry["translationNote"] = remaining
        else:
            # Try extracting class from START of note: "д текст д" → class=д, note="текст д"
            start_cls_match = re.match(
                r'^([бвдйю])(?:\s*,\s*([бвдйю]))*\s+(.+)$',
                note_cleaned
            )
            if start_cls_match:
                cls_part = note_cleaned[:start_cls_match.start(3)].strip().rstrip(",")
                cls_tokens = [t.strip() for t in cls_part.split(",") if t.strip()]
                if all(t in CLASS_LETTERS for t in cls_tokens):
                    entry["nounClass"] = ", ".join(cls_tokens)
                    remaining = start_cls_match.group(3).strip()
                    if remaining:
                        entry["translationNote"] = remaining
                else:
                    entry["translationNote"] = note_cleaned
            elif note_cleaned:
                entry["translationNote"] = note_cleaned

    # Replace ~ with headword in translation and note
    if entry.get("translation") and "~" in entry["translation"]:
        entry["translation"] = _replace_tilde(entry["translation"], headword)
    if entry.get("translationNote") and "~" in entry["translationNote"]:
        entry["translationNote"] = _replace_tilde(entry["translationNote"], headword)

    if sub_entries:
        for sub in sub_entries:
            if "phrase" in sub:
                sub["phrase"] = _replace_tilde(sub["phrase"], headword)
            if "translation" in sub:
                sub["translation"] = _replace_tilde(sub["translation"], headword)
            if "note" in sub:
                sub["note"] = _replace_tilde(sub["note"], headword)
        entry["subEntries"] = sub_entries

    return entry


def _flush_ru_sub(sub_entries, cur_sub):
    phrase = _clean(" ".join(cur_sub["b"])).strip("; ,").strip()
    if not phrase or phrase in ("~", ";"):
        return
    sub = {"phrase": phrase}
    trans = _clean(" ".join(cur_sub["n"])).strip("; ").strip()
    if trans:
        sub["translation"] = trans
    note = _clean_parens(_clean(" ".join(cur_sub["i"])).strip("() ;").strip())
    if note:
        cls = _extract_class(note)
        if cls:
            sub["nounClass"] = cls
            rem = _clean_parens(re.sub(r'^[бвдйю](?:\s*,\s*[бвдйю])*', '', note).strip(", ()").strip())
            if rem:
                sub["note"] = rem
        else:
            # Try extracting class from start of note
            start_match = re.match(r'^([бвдйю])(?:\s*,\s*([бвдйю]))*\s+(.+)$', note)
            if start_match:
                cls_part = note[:start_match.start(3)].strip().rstrip(",")
                cls_tokens = [t.strip() for t in cls_part.split(",") if t.strip()]
                if all(t in CLASS_LETTERS for t in cls_tokens):
                    sub["nounClass"] = ", ".join(cls_tokens)
                    rem = start_match.group(3).strip()
                    if rem:
                        sub["note"] = rem
                else:
                    sub["note"] = note
            else:
                sub["note"] = note
    sub_entries.append(sub)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    doc = fitz.open(PDF_PATH)
    print(f"Opened PDF: {doc.page_count} pages")
    results = []
    entry_id = 0

    for section_name, page_range, parser in [
        ("ce_ru", CE_RU_PAGES, parse_ce_ru),
        ("appendix", APPENDIX_PAGES, parse_ce_ru),
        ("ru_ce", RU_CE_PAGES, parse_ru_ce),
    ]:
        print(f"Parsing {section_name}...")
        spans = extract_spans(doc, page_range)
        raw_entries = split_into_entries(spans)
        count = 0
        for raw in raw_entries:
            entry = parser(raw)
            if entry:
                entry_id += 1
                result = {"id": str(entry_id), "section": section_name}
                result.update(entry)
                results.append(result)
                count += 1
        print(f"  {count} entries")

    # Post-process: merge split entries detected by alphabetical order
    results = merge_split_entries(results)

    print(f"\nTotal: {len(results)}")
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Written to: {OUTPUT_PATH}")

    validate(results)


def merge_split_entries(results):
    """
    Merge entries that were incorrectly split by detecting alphabetical order violations.

    If entry[i] starts with letter X, entry[i+1] starts with Y > X,
    and entry[i+2] starts with Z <= X — then entry[i+1] is a split-off
    from entry[i] and should be merged as a sub-entry.
    """
    # Process each section separately
    sections = {}
    for e in results:
        sec = e["section"]
        if sec not in sections:
            sections[sec] = []
        sections[sec].append(e)

    merged_results = []
    total_merged = 0

    for sec_name in ["ce_ru", "appendix", "ru_ce"]:
        entries = sections.get(sec_name, [])
        if not entries:
            continue

        merged = []
        skip_next = set()

        for i in range(len(entries)):
            if i in skip_next:
                continue

            entry = entries[i]

            # Look ahead: check if next entries should merge into this one
            j = i + 1
            while j < len(entries) and j not in skip_next:
                if j + 1 >= len(entries):
                    break

                prev_first = entry["word"][0].lower() if entry["word"] else ""
                curr_first = entries[j]["word"][0].lower() if entries[j]["word"] else ""
                next_first = entries[j+1]["word"][0].lower() if entries[j+1]["word"] else ""

                # Current entry breaks alphabetical order
                if curr_first > prev_first and curr_first > next_first and prev_first <= next_first:
                    # Merge entries[j] into entry as sub-entry
                    split_entry = entries[j]
                    sub = {"phrase": split_entry.get("word", "")}
                    if split_entry.get("nounClass"):
                        sub["nounClass"] = split_entry["nounClass"]
                    if split_entry.get("translation"):
                        sub["translation"] = split_entry["translation"]
                    if split_entry.get("note"):
                        sub["note"] = split_entry["note"]

                    if "subEntries" not in entry:
                        entry["subEntries"] = []
                    entry["subEntries"].append(sub)

                    # Also merge any sub-entries from the split entry
                    if split_entry.get("subEntries"):
                        entry["subEntries"].extend(split_entry["subEntries"])

                    skip_next.add(j)
                    total_merged += 1
                    j += 1
                else:
                    break

            merged.append(entry)

        merged_results.extend(merged)

    # Re-number IDs
    for i, entry in enumerate(merged_results):
        entry["id"] = str(i + 1)

    print(f"  Merged {total_merged} split entries")
    return merged_results


def validate(results):
    ce = [e for e in results if e["section"] == "ce_ru"]
    ru = [e for e in results if e["section"] == "ru_ce"]

    print("\n=== CE→RU stats ===")
    print(f"Total: {len(ce)}")
    for field in ["nounClass", "plural", "declension", "etymology", "translation", "subEntries", "note", "obsolete"]:
        n = sum(1 for e in ce if field in e)
        print(f"  {field}: {n}")

    print("\n--- CE→RU key samples ---")
    for target in ["авантюра", "автор", "айкхалла", "арз", "бакъо", "агӀонаш"]:
        e = next((x for x in ce if x["word"] == target), None)
        if e:
            print(json.dumps(e, ensure_ascii=False))

    print(f"\n=== RU→CE stats ===")
    print(f"Total: {len(ru)}")
    for field in ["nounClass", "translation", "subEntries", "note"]:
        n = sum(1 for e in ru if field in e)
        print(f"  {field}: {n}")

    print("\n--- RU→CE key samples ---")
    for target in ["авантюра", "автор", "администрация", "арест"]:
        e = next((x for x in ru if x["word"] == target), None)
        if e:
            print(json.dumps(e, ensure_ascii=False))


if __name__ == "__main__":
    main()
