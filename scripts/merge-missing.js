const fs = require('fs');
const path = require('path');

const DICT_DIR = path.join(__dirname, '..', 'dictionaries');

// Исключения: missing-файл → основной файл (когда имена не совпадают по шаблону)
const OVERRIDES = {
  'umarhadjiev_ahmatukaev_missing.json': 'umarhadjiev_ahmatukaev_ce_ru_ru_ce.json',
};

// Находим все пары: основной файл + _missing файл
const files = fs.readdirSync(DICT_DIR).filter((f) => f.endsWith('.json'));
const missingFiles = files.filter((f) => f.includes('_missing'));

const pairs = missingFiles.map((missingFile) => {
  const baseName = OVERRIDES[missingFile] || missingFile.replace('_missing', '');
  return { baseName, missingFile, hasBase: files.includes(baseName) };
});

if (pairs.length === 0) {
  console.log('Нет _missing файлов для объединения.');
  process.exit(0);
}

console.log(`Найдено ${pairs.length} пар(а) для объединения:\n`);

let totalMerged = 0;

for (const { baseName, missingFile, hasBase } of pairs) {
  if (!hasBase) {
    console.log(`  ⚠ ${missingFile} — основной файл ${baseName} не найден, пропускаю`);
    continue;
  }

  const basePath = path.join(DICT_DIR, baseName);
  const missingPath = path.join(DICT_DIR, missingFile);

  const base = JSON.parse(fs.readFileSync(basePath, 'utf-8'));
  const missing = JSON.parse(fs.readFileSync(missingPath, 'utf-8'));

  // Убираем дубли по word1
  const existingWords = new Set(base.map((e) => e.word1));
  const newEntries = missing.filter((e) => !existingWords.has(e.word1));
  const dupes = missing.length - newEntries.length;

  const merged = [...base, ...newEntries];

  // Пере-нумеруем id
  merged.forEach((entry, i) => {
    entry.id = String(i + 1);
  });

  fs.writeFileSync(basePath, JSON.stringify(merged, null, 2), 'utf-8');

  // Удаляем _missing файл
  fs.unlinkSync(missingPath);

  console.log(
    `  ✓ ${baseName}: ${base.length} + ${newEntries.length} = ${merged.length}` +
      (dupes > 0 ? ` (${dupes} дублей пропущено)` : ''),
  );
  totalMerged += newEntries.length;
}

console.log(`\nГотово! Добавлено ${totalMerged} записей.`);
