#!/usr/bin/env python3
"""
Post-processing fixes for maciev2.json.

Fixes (in priority order):
1. Russian text in verbForms/declension → move to meanings
2. * prefix in translation
3. Numbered meanings N) remaining in example.ru
4. * in word field
5. [] artifacts in translation
6. Garbage examples (nah < 2 chars)
7. Merge duplicate entries
8. Fix broken homonym sequences
"""
import sys, io, json, re
from collections import Counter, defaultdict

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

INPUT = r"F:\programming\mott-larbe\mott-larbe-dosham-backend\dictionaries\maciev2.json"
OUTPUT = INPUT  # overwrite

with open(INPUT, 'r', encoding='utf-8') as f:
    data = json.load(f)

total_before = len(data)
fixes = Counter()

# ════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════

CHECHEN_CHARS = set("ӀӏӀ")  # palochka variants

_STRESS_VOWELS = set('аеёиоуыэюяАЕЁИОУЫЭЮЯ')
_STRESS_STANDALONE = {
    'в', 'к', 'с', 'о', 'у', 'и', 'а', 'не', 'ни', 'по', 'на', 'за',
    'из', 'от', 'до', 'об', 'во', 'со', 'ко', 'же', 'ли', 'бы',
    'то', 'ка', 'да', 'их', 'ее', 'её', 'он', 'мы', 'вы', 'но',
    'ед', 'мн', 'см', 'те',
    'или', 'для', 'как', 'при', 'без', 'все', 'что', 'это', 'его',
    'она', 'они', 'вас', 'нас', 'ему', 'ней', 'ним', 'нем',
    'два', 'три', 'тем', 'чем', 'кем', 'так', 'под', 'над',
    'про', 'где', 'вот', 'тут', 'там', 'кто', 'уже', 'еще',
    'субъект', 'объект', 'даже', 'более', 'также', 'только',
    'когда', 'тоже', 'очень',
}
_WORD_ENDINGS_RE = re.compile(
    r'(ое|ый|ая|ие|ые|ой|ей|ий|ого|его|ому|ему|'
    r'ом|ем|ых|их|ым|им|ую|юю|'
    r'ть|ться|сь|ла|ло|ли|ет|ёт|ит|ат|ут|ют|ём|'
    r'ение|ание|тель|ство|ция|'
    r'ок|ик|ец|нок|мок)$'
)


def _remove_stress_spaces(text):
    """Remove stress-marking spaces from text.

    In the Maciev PDF, stress is encoded as a thin space after the stressed vowel:
    "хозя йство" → "хозяйство", "абажу р" → "абажур"

    Merge rule: vowel + space + lowercase letter, where the tail fragment is short
    (≤6 chars) and neither fragment is a common standalone word.
    """
    words = text.split(' ')
    if len(words) <= 1:
        return text
    result = []
    i = 0
    while i < len(words):
        word = words[i]
        merged_once = False
        while i + 1 < len(words):
            nw = words[i + 1]
            if not word or not nw:
                break
            last = word[-1]
            first = nw[0] if nw else ''

            if not (last in _STRESS_VOWELS and first.isalpha() and first.islower()):
                break

            w_clean = re.sub(r'[.,;:!?)\]]+$', '', word)
            nw_clean = re.sub(r'[.,;:!?)\]]+$', '', nw)

            if w_clean.lower() in _STRESS_STANDALONE or nw_clean.lower() in _STRESS_STANDALONE:
                break

            if len(nw_clean) > 6:
                break

            # If we already merged once and the result looks like a complete word, stop
            if merged_once and len(w_clean) >= 7 and _WORD_ENDINGS_RE.search(w_clean.lower()):
                break

            if len(w_clean) + len(nw_clean) > 20:
                break

            word = word + nw
            merged_once = True
            i += 1
        result.append(word)
        i += 1
    return ' '.join(result)

def _is_russian_text(text):
    """Check if text looks like Russian translation (not Chechen grammar forms)."""
    if not text:
        return False
    t = text.strip()
    # Contains "]" — end of grammar block leaking into field
    if ']' in t:
        after_bracket = t.split(']', 1)[1].strip()
        if after_bracket:
            return True  # text after ] is translation
    # Numbered meanings
    if re.match(r'^\d+\)', t):
        return True
    # Contains Russian-only patterns
    if re.search(r'(ть\s|ться|ение|ание|тель|ство|ный\b|ная\b|ное\b|ное\s)', t):
        return True
    # Ends with period (translation, not form)
    if t.endswith('.') and len(t) > 10:
        return True
    # Contains semicolons with numbered meanings
    if re.search(r';\s*\d+\)', t):
        return True
    # Very long for a grammar form
    if len(t) > 30 and not re.match(r'^[а-яёӀӏ\s,;]+$', t):
        return True
    return False


def _is_chechen_form(text):
    """Check if text looks like a Chechen grammar form (short, Chechen letters)."""
    if not text:
        return False
    t = text.strip()
    # Very short and Chechen-looking
    if len(t) <= 20 and re.match(r'^[а-яёӀӏаьоьуьюь\s]+$', t):
        return True
    return False


def _clean_translation(text):
    """Clean a translation string."""
    t = text.strip()
    t = re.sub(r'^\*\s*', '', t)  # remove leading *
    t = re.sub(r'^\[\s*', '', t)  # remove leading [
    t = re.sub(r'\]\s*$', '', t)  # remove trailing ]
    t = re.sub(r'^\s*[;.,]\s*', '', t)  # remove leading punctuation
    t = t.strip(';., ')
    return t


# ════════════════════════════════════════════════════════════════════════
# Fix 1: Russian text in verbForms → move to meanings
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('verbForms'):
        continue

    vf = e['verbForms']
    all_russian = True
    any_russian = False
    russian_parts = []
    valid_forms = {}

    for key in ('present', 'past', 'participle'):
        val = vf.get(key, '')
        if not val:
            continue
        if _is_russian_text(val):
            any_russian = True
            russian_parts.append(val)
        else:
            all_russian = False
            valid_forms[key] = val

    if not any_russian:
        continue

    if all_russian:
        # All forms are Russian → entire verbForms is misparse, move to meanings
        combined = '; '.join(russian_parts)
        combined = _clean_translation(combined)
        if combined and not e.get('meanings'):
            e['meanings'] = [{"translation": combined}]
            fixes['vf_all_russian_to_meanings'] += 1
        elif combined and e.get('meanings'):
            existing_trans = '; '.join(m.get('translation', '') for m in e['meanings'])
            if combined not in existing_trans:
                e['meanings'].append({"translation": combined})
                fixes['vf_all_russian_appended'] += 1
        del e['verbForms']
    else:
        # Mixed: some valid, some Russian — keep valid forms, move Russian to meanings
        for key in list(vf.keys()):
            val = vf[key]
            if not val:
                continue

            # Special case: "]" in value — split at bracket
            if ']' in val:
                parts = val.split(']', 1)
                form_part = parts[0].strip()
                trans_part = parts[1].strip()
                if form_part:
                    vf[key] = form_part  # keep the form
                else:
                    del vf[key]
                if trans_part:
                    trans_part = _clean_translation(trans_part)
                    if trans_part:
                        e.setdefault('meanings', [])
                        if not e['meanings']:
                            e['meanings'] = [{"translation": trans_part}]
                        else:
                            existing = e['meanings'][-1].get('translation', '')
                            if trans_part not in existing:
                                e['meanings'][-1]['translation'] = (existing + '; ' + trans_part).strip('; ')
                        fixes['vf_bracket_split'] += 1
            elif _is_russian_text(val):
                trans = _clean_translation(val)
                if trans:
                    e.setdefault('meanings', [])
                    if not e['meanings']:
                        e['meanings'] = [{"translation": trans}]
                    else:
                        last_trans = e['meanings'][-1].get('translation', '')
                        if trans not in last_trans:
                            e['meanings'][-1]['translation'] = (last_trans + '; ' + trans).strip('; ')
                    fixes['vf_partial_russian_to_meanings'] += 1
                del vf[key]

        if not vf:
            del e['verbForms']


# ════════════════════════════════════════════════════════════════════════
# Fix 1b: Russian text in declension → move to meanings
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('declension'):
        continue

    decl = e['declension']
    all_russian = True
    any_russian = False
    russian_parts = []

    for key, val in list(decl.items()):
        if not val:
            continue
        if _is_russian_text(val):
            any_russian = True
            russian_parts.append(val)
        else:
            all_russian = False

    if not any_russian:
        continue

    if all_russian:
        combined = '; '.join(russian_parts)
        combined = _clean_translation(combined)
        if combined and not e.get('meanings'):
            e['meanings'] = [{"translation": combined}]
            fixes['decl_all_russian_to_meanings'] += 1
        del e['declension']
        # Also remove nounClass if declension was all Russian
        e.pop('nounClass', None)
        e.pop('nounClassPlural', None)
        e.pop('plural', None)
    else:
        # Mixed — remove only the Russian fields
        for key in list(decl.keys()):
            if _is_russian_text(decl[key]):
                trans = _clean_translation(decl[key])
                if trans:
                    if not e.get('meanings'):
                        e['meanings'] = [{"translation": trans}]
                    fixes['decl_partial_russian_to_meanings'] += 1
                del decl[key]
        if not decl:
            del e['declension']


# ════════════════════════════════════════════════════════════════════════
# Fix 2: * prefix in translation
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('meanings'):
        continue
    for m in e['meanings']:
        t = m.get('translation', '')
        if t.startswith('*'):
            cleaned = re.sub(r'^\*\s*', '', t).strip()
            if cleaned:
                m['translation'] = cleaned
                fixes['star_in_translation'] += 1
            else:
                # Translation is just "*" → mark classVariable, clear translation
                m['translation'] = ''
                e['classVariable'] = True
                fixes['star_only_translation'] += 1


# ════════════════════════════════════════════════════════════════════════
# Fix 3: Numbered meanings N) remaining in example.ru
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('meanings'):
        continue
    for m in e['meanings']:
        for ex in m.get('examples', []):
            ru = ex.get('ru', '')
            # Check for "text; N) more text" or "text N) more text" pattern
            num_match = re.search(r'[;.\s]\s*(\d+)\)\s', ru)
            if num_match:
                before = ru[:num_match.start()].strip().rstrip(';., ')
                ex['ru'] = before
                fixes['num_in_example_ru'] += 1
            # Also check for "* объект" or "* субъект" markers in ru
            ru = ex.get('ru', '')
            if ru.startswith('*'):
                ex['ru'] = re.sub(r'^\*\s*', '', ru).strip()
                fixes['star_in_example_ru'] += 1


# ════════════════════════════════════════════════════════════════════════
# Fix 4: * in word field
# ════════════════════════════════════════════════════════════════════════

for e in data:
    w = e.get('word', '')
    changed = False
    if '*' in w:
        w = w.replace('*', '').strip()
        if not e.get('classVariable'):
            e['classVariable'] = True
        fixes['star_in_word'] += 1
        changed = True
    # Remove leading comma/punctuation
    if w.startswith(',') or w.startswith(';'):
        w = w.lstrip(',; ').strip()
        fixes['punct_in_word'] += 1
        changed = True
    # Remove digits after word (homonym index like "акха 1")
    digit_match = re.match(r'^(.+?)\s+(\d+)$', w)
    if digit_match and not e.get('homonymIndex'):
        w = digit_match.group(1)
        e['homonymIndex'] = int(digit_match.group(2))
        fixes['digit_extracted_from_word'] += 1
        changed = True
    if changed:
        e['word'] = w


# ════════════════════════════════════════════════════════════════════════
# Fix 5: [] artifacts in translation
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('meanings'):
        continue
    for m in e['meanings']:
        t = m.get('translation', '')
        orig = t
        # Remove leading [ and trailing ]
        t = re.sub(r'^\[\s*', '', t)
        t = re.sub(r'\]\s*$', '', t)
        # Remove standalone ] in middle only if unbalanced
        if ']' in t and '[' not in t:
            t = t.replace(']', '').strip()
        if '[' in t and ']' not in t:
            t = t.replace('[', '').strip()
        t = t.strip(';., ')
        if t != orig:
            m['translation'] = t
            fixes['brackets_in_translation'] += 1


# ════════════════════════════════════════════════════════════════════════
# Fix 6: Garbage examples (nah < 2 chars or nah is punctuation/number)
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('meanings'):
        continue
    for m in e['meanings']:
        exs = m.get('examples', [])
        if not exs:
            continue
        cleaned = []
        for ex in exs:
            nah = ex.get('nah', '').strip()
            # Remove garbage: single chars, numbers, punctuation
            if len(nah) < 2 or re.match(r'^[\d,;.\s]+$', nah):
                fixes['garbage_example_removed'] += 1
                continue
            cleaned.append(ex)
        if cleaned:
            m['examples'] = cleaned
        else:
            del m['examples']


# ════════════════════════════════════════════════════════════════════════
# Fix 7: Merge duplicate entries (same word + homonymIndex)
# ════════════════════════════════════════════════════════════════════════

def _merge_entries(entries):
    """Merge a list of entries with the same word+homonym into one."""
    if len(entries) <= 1:
        return entries[0]

    base = entries[0].copy()

    for other in entries[1:]:
        # Merge meanings
        if other.get('meanings'):
            base.setdefault('meanings', [])
            for m in other['meanings']:
                # Avoid duplicate translations
                existing_trans = set(mm.get('translation', '') for mm in base['meanings'])
                if m.get('translation', '') not in existing_trans:
                    base['meanings'].append(m)

        # Merge phraseology
        if other.get('phraseology'):
            base.setdefault('phraseology', [])
            existing_phr = set(p['nah'] for p in base['phraseology'])
            for p in other['phraseology']:
                if p['nah'] not in existing_phr:
                    base['phraseology'].append(p)

        # Fill missing fields from other entries
        for field in ('nounClass', 'nounClassPlural', 'plural', 'declension',
                      'verbForms', 'partOfSpeech', 'domain', 'styleLabel',
                      'wordAccented', 'wordNote', 'classVariable', 'obsolete'):
            if not base.get(field) and other.get(field):
                base[field] = other[field]

    return base


# Normalize latin I → Ӏ (palochka) in word before merging
for e in data:
    w = e.get('word', '')
    if 'I' in w:  # latin I
        new_w = w.replace('I', '\u04c0')  # → Ӏ
        if new_w != w:
            e['word'] = new_w
            fixes['latin_I_to_palochka'] += 1
    wa = e.get('wordAccented', '')
    if wa and 'I' in wa:
        e['wordAccented'] = wa.replace('I', '\u04c0')

# Group by word + homonymIndex
groups = defaultdict(list)
for e in data:
    key = (e['word'], e.get('homonymIndex'))
    groups[key].append(e)

merged_data = []
merge_count = 0
for key, entries in groups.items():
    if len(entries) > 1:
        # Safety: don't merge if any entry already has many meanings/examples
        # (it's likely a monster-entry from bad parsing)
        total_meanings = sum(len(e.get('meanings', [])) for e in entries)
        total_examples = sum(
            sum(len(m.get('examples', [])) for m in e.get('meanings', []))
            for e in entries
        )
        if total_meanings > 8 or total_examples > 15:
            # Don't merge — keep entries separate, give them homonym indices
            for i, e in enumerate(entries):
                if not e.get('homonymIndex'):
                    e['homonymIndex'] = i + 1
                merged_data.append(e)
            fixes['monster_merge_prevented'] += 1
        else:
            merged = _merge_entries(entries)
            merged_data.append(merged)
            merge_count += len(entries) - 1
    else:
        merged_data.append(entries[0])

fixes['entries_merged'] = merge_count
data = merged_data


# ════════════════════════════════════════════════════════════════════════
# Fix 8: Fix broken homonym sequences
# ════════════════════════════════════════════════════════════════════════

# Group by word, check homonym sequences
word_entries = defaultdict(list)
for e in data:
    word_entries[e['word']].append(e)

for word, entries in word_entries.items():
    hom_entries = [e for e in entries if e.get('homonymIndex')]
    if not hom_entries:
        continue

    # Sort by homonymIndex
    hom_entries.sort(key=lambda e: e['homonymIndex'])

    # Check if sequence is correct (1, 2, 3, ...)
    expected = 1
    needs_fix = False
    for e in hom_entries:
        if e['homonymIndex'] != expected:
            needs_fix = True
            break
        expected += 1

    if needs_fix:
        # Renumber sequentially
        for i, e in enumerate(hom_entries):
            old = e['homonymIndex']
            e['homonymIndex'] = i + 1
            if old != i + 1:
                fixes['homonym_renumbered'] += 1


# ════════════════════════════════════════════════════════════════════════
# Fix 9: Remove completely empty entries (no meanings, no wordNote, no phraseology, no verbForms)
# ════════════════════════════════════════════════════════════════════════

clean_data = []
for e in data:
    has_content = (e.get('meanings') or e.get('wordNote') or e.get('phraseology')
                   or e.get('verbForms') or e.get('declension'))
    if has_content:
        clean_data.append(e)
    else:
        fixes['empty_entries_removed'] += 1

data = clean_data


# ════════════════════════════════════════════════════════════════════════
# Fix 10: Clean empty meanings (translation is empty or just punctuation)
# ════════════════════════════════════════════════════════════════════════

for e in data:
    if not e.get('meanings'):
        continue
    cleaned_meanings = []
    for m in e['meanings']:
        t = m.get('translation', '').strip()
        if not t or t in ('-', '.', ',', ';', '—'):
            fixes['empty_meaning_removed'] += 1
            continue
        cleaned_meanings.append(m)
    if cleaned_meanings:
        e['meanings'] = cleaned_meanings
    else:
        del e['meanings']


# ════════════════════════════════════════════════════════════════════════
# Fix 11: Second pass — remove entries that became empty after Fix 10
# ════════════════════════════════════════════════════════════════════════

clean_data2 = []
for e in data:
    has_content = (e.get('meanings') or e.get('wordNote') or e.get('phraseology')
                   or e.get('verbForms') or e.get('declension'))
    if has_content:
        clean_data2.append(e)
    else:
        fixes['empty_entries_removed_pass2'] += 1
data = clean_data2


# ════════════════════════════════════════════════════════════════════════
# Fix 12: Remove stress-marking spaces from ALL text fields
# ════════════════════════════════════════════════════════════════════════

for e in data:
    # translation
    for m in e.get('meanings', []):
        t = m.get('translation', '')
        if t:
            fixed = _remove_stress_spaces(t)
            if fixed != t:
                m['translation'] = fixed
                fixes['stress_space_translation'] += 1

        # examples
        for ex in m.get('examples', []):
            for field in ('nah', 'ru'):
                val = ex.get(field, '')
                if val:
                    fixed = _remove_stress_spaces(val)
                    if fixed != val:
                        ex[field] = fixed
                        fixes['stress_space_example'] += 1

    # phraseology
    for p in e.get('phraseology', []):
        for field in ('nah', 'ru'):
            val = p.get(field, '')
            if val:
                fixed = _remove_stress_spaces(val)
                if fixed != val:
                    p[field] = fixed
                    fixes['stress_space_phraseology'] += 1

    # wordNote
    wn = e.get('wordNote', '')
    if wn:
        fixed = _remove_stress_spaces(wn)
        if fixed != wn:
            e['wordNote'] = fixed
            fixes['stress_space_wordnote'] += 1

    # wordAccented — leave as-is (stress spaces are intentional there)
    # word — leave as-is (Chechen stress spaces are different)

    # declension values
    if e.get('declension'):
        for k, v in e['declension'].items():
            if v:
                fixed = _remove_stress_spaces(v)
                if fixed != v:
                    e['declension'][k] = fixed
                    fixes['stress_space_declension'] += 1

    # verbForms values
    if e.get('verbForms'):
        for k, v in e['verbForms'].items():
            if v:
                fixed = _remove_stress_spaces(v)
                if fixed != v:
                    e['verbForms'][k] = fixed
                    fixes['stress_space_verbforms'] += 1

    # plural
    if e.get('plural'):
        fixed = _remove_stress_spaces(e['plural'])
        if fixed != e['plural']:
            e['plural'] = fixed
            fixes['stress_space_plural'] += 1


# ════════════════════════════════════════════════════════════════════════
# Renumber IDs
# ════════════════════════════════════════════════════════════════════════

for i, e in enumerate(data):
    e['id'] = str(i + 1)


# ════════════════════════════════════════════════════════════════════════
# Write output
# ════════════════════════════════════════════════════════════════════════

with open(OUTPUT, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"\n=== POST-PROCESSING RESULTS ===")
print(f"Before: {total_before} entries")
print(f"After:  {len(data)} entries")
print(f"\nFixes applied:")
for fix, cnt in fixes.most_common():
    print(f"  {fix}: {cnt}")
