#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { syncMortgageData, getMortgageData, DATA_PATH } = require('../bank-mortgage-data');

async function main() {
  const force = process.argv.includes('--force');
  console.log(`🔄 Синхронизация ипотечных ставок${force ? ' (force)' : ''}…`);
  console.log(`   Файл: ${DATA_PATH}`);

  const result = await syncMortgageData({ force });
  const data = result.data || getMortgageData();

  console.log('\n--- Официальные ставки ---');
  console.log(JSON.stringify(data.official, null, 2));

  console.log('\n--- Банки ---');
  for (const bank of data.banks || []) {
    console.log(`\n${bank.name} (${bank.products?.length || 0} productos)`);
    for (const p of bank.products || []) {
      console.log(' ', [p.type, p.rate_formula, p.tae_pct != null ? `TAE ${p.tae_pct}%` : null, p.tin_pct != null ? `TIN ${p.tin_pct}%` : null]
        .filter(Boolean)
        .join(' · '));
    }
  }

  if (result.skipped) {
    console.log('\n⏭ Данные свежие, синхронизация пропущена (используйте --force).');
  } else {
    console.log('\n✅ Готово.');
  }
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
