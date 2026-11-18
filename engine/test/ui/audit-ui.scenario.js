const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
(async () => {
  const b = await chromium.launch({ args:['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: 430, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('pageerror ' + e.message)); p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  p.on('dialog', d => { errs.push('DIALOG'); d.dismiss(); });
  await p.goto('file://' + require('path').resolve(__dirname, '../../audit.html'));
  const C='#items > section:first-child';
  const pill = async () => (await p.locator(C+' .item-h').textContent()).replace(/\s+/g,' ').trim();
  await p.click('#demo'); await p.fill('#expert', 'Эксперт-тест');
  console.log('1', await pill());
  await p.click(C+' [data-tab=expert]');
  await p.click('[data-act=attBib]');
  await p.selectOption('[data-xsrc="0"] [data-k=appl]', 'совпадает'); await p.selectOption('[data-xsrc="0"] [data-k=reg]', 'совпадает');
  await p.click('[data-act=attEA]');
  console.log('2 before registry confirm:', await pill(), '| reg btn:', await p.locator('[data-act=attReg]').count(), '| tags:', await p.locator(C+' .tag').count());
  await p.fill('[data-k=regbasis]', 'синтетическая сверка для теста');
  await p.click('[data-act=attReg]');
  console.log('2b after registry confirm (still blocked):', await pill());
  await p.click(C+' [data-tab=edit]'); await p.selectOption(C+' [data-f=preg]', 'действует'); await p.click('[data-act=save]');
  console.log('3', await pill());
  await p.click(C+' [data-tab=just]');
  // риск 2: смена схемы после экспертной оценки — нужна повторная оценка
  await p.click(C+' [data-tab=edit]'); await p.fill(C+' [data-f=order]', 'Лечебный курс препарата Y, другая доза'); await p.click('[data-act=save]');
  await p.click(C+' [data-tab=expert]');
  console.log('3b after order change:', await pill(), '|', (await p.locator('[data-xsrc="0"] .hint').textContent()).replace(/\s+/g,' ').slice(-60));
  await p.click(C+' [data-tab=just]');
  console.log('4 draft:', (await p.locator('[data-draft]').textContent()).slice(0,200).replace(/\n/g,' / '));
  // устаревание: правка без сохранения
  await p.click(C+' [data-tab=edit]');
  await p.fill(C+' [data-f=order]', 'Лечебный курс препарата Y, изменено');
  console.log('5 after typing:', await pill(), '| stale banners:', await p.locator(C+' [data-stale]').count());
  await p.click(C+' [data-tab=expert]');   // collect + rerender
  console.log('6 expert tab: override shown =', await p.locator('[data-act=override]').count(), '| stale =', await p.locator(C+' .stale').count());
  await p.click(C+' [data-tab=just]');
  console.log('7 draft shown =', await p.locator('[data-draft]').count());
  await p.click(C+' [data-tab=edit]'); await p.click('[data-act=save]');
  console.log('8 resaved:', await pill());
  await p.click(C+' [data-tab=expert]');
  console.log('9 journal:', await p.locator('.journal li').count(), (await p.locator('.journal').textContent()).replace(/\s+/g,' ').slice(-260));
  // смена «полной истории» на фрагмент делает результат устаревшим
  await p.click('input[name=scope][value=fragment]');
  console.log('10 scope change:', await pill());
  // черновик при невозможности проверить
  await p.click('#addItem');
  const N='#items > section:last-child';
  await p.fill(N+' [data-f=order]', 'Препарат Z'); await p.selectOption(N+' [data-f=rel]', 'невозможно_проверить');
  await p.click(N+' [data-act=save]'); await p.click(N+' [data-tab=just]');
  console.log('11 unknown draft:', (await p.locator(N+' [data-draft]').textContent()).replace(/\n/g,' / ').slice(0,330));
  await p.screenshot({ path: require('os').tmpdir() + '/audit-ui.png', fullPage: true });
  console.log('ERRORS:', errs); await b.close();
})();
