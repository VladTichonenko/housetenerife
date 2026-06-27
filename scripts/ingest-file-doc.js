'use strict';

/**
 * Извлекает текст из file_doc/ → data/file-doc-knowledge.json
 * Запуск: node scripts/ingest-file-doc.js
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const SOURCE_DIR = path.join(__dirname, '..', 'file_doc');
const OUT_PATH = path.join(__dirname, '..', 'data', 'file-doc-knowledge.json');
const MAX_CHARS_PER_DOC = 12000;

function cleanText(raw) {
  return String(raw || '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function truncate(text, max = MAX_CHARS_PER_DOC) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…(обрезано)`;
}

async function extractPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const data = await parser.getText();
    return cleanText(data.text);
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanText(result.value);
}

async function main() {
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error('Папка не найдена:', SOURCE_DIR);
    process.exit(1);
  }

  const files = fs
    .readdirSync(SOURCE_DIR)
    .filter((f) => /\.(pdf|docx)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const documents = [];
  let totalChars = 0;

  for (const file of files) {
    const filePath = path.join(SOURCE_DIR, file);
    const ext = path.extname(file).toLowerCase();
    let text = '';
    try {
      text =
        ext === '.pdf' ? await extractPdf(filePath) : await extractDocx(filePath);
    } catch (e) {
      console.warn(`⚠️ ${file}: ${e.message}`);
      continue;
    }
    if (!text || text.length < 40) {
      console.warn(`⚠️ ${file}: мало текста, пропуск`);
      continue;
    }
    const entry = {
      id: file.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_'),
      title: file.replace(/\.[^.]+$/, ''),
      source_file: file,
      text: truncate(text),
    };
    documents.push(entry);
    totalChars += entry.text.length;
    console.log(`✓ ${file} — ${entry.text.length} симв.`);
  }

  const payload = {
    _meta: {
      source_dir: 'file_doc',
      ingested_at: new Date().toISOString(),
      document_count: documents.length,
      total_chars: totalChars,
    },
    usage_note:
      'Материалы House Tenerife: инвестиционные предложения, проекты, услуги. Используй факты только из этих документов; цены и доходность — ориентиры, не гарантия. Детали по закрытым объектам — через менеджера.',
    documents,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n→ ${OUT_PATH} (${documents.length} документов, ${totalChars} симв.)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
