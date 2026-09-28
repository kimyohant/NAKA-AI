const { test } = require('node:test');
const assert = require('node:assert/strict');
const { workflows, demoContent } = require('../public/workflows.js');

test('each workflow produces distinct editable drafts and preserves supplied brief', () => {
  const scripts = new Set();
  for (const [workflow, config] of Object.entries(workflows)) {
    const input = { ...config.example, workflow };
    const result = demoContent(input, { mode: 'demo', captions: [{ title: 'a', text: 'a' }, { title: 'b', text: 'b' }, { title: 'c', text: 'c' }], imagePrompt: 'brief' });
    assert.equal(result.mode, 'demo');
    assert.equal(result.captions.length, 3);
    assert.equal(result.plan.length, 3);
    assert.ok(result.script.includes(input.productName));
    assert.ok(result.script.includes(input.details));
    assert.ok(result.imagePrompt);
    scripts.add(result.script);
  }
  assert.equal(scripts.size, 4);
});

test('bot draft does not invent missing price and separates public comments from private order details', () => {
  const result = demoContent({ ...workflows.bot.example, workflow: 'bot', price: '' });
  assert.match(result.captions[0].text, /ยังไม่มีราคายืนยัน/);
  assert.match(result.script, /ข้อความส่วนตัวก่อนขอข้อมูลจัดส่ง/);
  assert.match(result.imagePrompt, /ร่างนี้ไม่ได้บันทึกลงบอตจริง/);
});
