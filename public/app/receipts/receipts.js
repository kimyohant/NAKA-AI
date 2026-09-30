(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var receiptId = new URLSearchParams(location.search).get('id');

  async function api(path) {
    var response = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      location.replace('/login/?next=' + encodeURIComponent(location.pathname + location.search));
      throw new Error('signed-out');
    }
    if (!response.ok) {
      var error = new Error('request-failed');
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function text(id, value) { $(id).textContent = value == null ? '' : String(value); }
  function optional(row, id, value) { text(id, value); $(row).hidden = !value; }
  function render(receipt) {
    text('receipt-title', receipt.title);
    text('number', receipt.number);
    text('seller-name', receipt.seller.name);
    text('seller-address', receipt.seller.address);
    optional('seller-tax-row', 'seller-tax', receipt.seller.taxId);
    text('buyer-name', receipt.buyer.name);
    optional('buyer-phone-row', 'buyer-phone', receipt.buyer.phone);
    optional('buyer-email-row', 'buyer-email', receipt.buyer.email);
    text('issued-date', receipt.issuedDate);
    text('paid-date', receipt.paidDate);
    text('plan-name', receipt.planName);
    text('period', receipt.periodLabel);
    text('line-amount', receipt.amountText);
    text('total', receipt.amountText);
    text('amount-words', receipt.amountWords);
    text('subtotal', receipt.subtotalText);
    text('vat', receipt.vatText);
    ['subtotal-row', 'vat-row', 'vat-note'].forEach(function (id) { $(id).hidden = !receipt.vatRegistered; });
    document.title = receipt.number + ' — ใบเสร็จรับเงิน';
    $('receipt').hidden = false;
    $('print-help').hidden = false;
    $('print').disabled = false;
  }

  async function load() {
    $('error').hidden = true;
    $('receipt').hidden = true;
    $('print-help').hidden = true;
    $('print').disabled = true;
    $('loading').hidden = false;
    $('main').setAttribute('aria-busy', 'true');
    try {
      await api('/api/auth/me');
      if (!receiptId) {
        text('error-title', 'ยังไม่ได้เลือกใบเสร็จ');
        text('error-message', 'กลับไปหน้าแพ็กเกจ แล้วเลือกใบเสร็จที่ต้องการดู');
        $('retry').hidden = true;
        $('error').hidden = false;
        return;
      }
      render(await api('/api/receipts/' + encodeURIComponent(receiptId)));
    } catch (error) {
      if (error.message === 'signed-out') return;
      var missing = error.status === 404;
      text('error-title', missing ? 'ไม่พบใบเสร็จนี้' : 'โหลดใบเสร็จไม่สำเร็จ');
      text('error-message', missing ? 'ตรวจสอบลิงก์ หรือกลับไปเลือกใบเสร็จจากหน้าแพ็กเกจ' : 'เชื่อมต่อระบบไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง');
      $('retry').hidden = missing;
      $('error').hidden = false;
    } finally {
      $('loading').hidden = true;
      $('main').setAttribute('aria-busy', 'false');
    }
  }

  $('print').addEventListener('click', async function () {
    // Wait for Thai glyphs before opening the browser's print/PDF dialog.
    if (document.fonts) await document.fonts.ready;
    window.print();
  });
  $('retry').addEventListener('click', load);
  load();
})();
