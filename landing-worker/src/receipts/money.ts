const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

function integerWords(value: number): string {
  if (value >= 1_000_000) {
    const millions = Math.floor(value / 1_000_000);
    const remainder = value % 1_000_000;
    return integerWords(millions) + 'ล้าน' + (remainder === 1 ? 'เอ็ด' : remainder ? integerWords(remainder) : '');
  }
  const digits = String(value);
  let words = '';
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[i]);
    const place = digits.length - i - 1;
    if (!digit) continue;
    if (place === 1) words += (digit === 1 ? '' : digit === 2 ? 'ยี่' : DIGITS[digit]) + 'สิบ';
    else if (place === 0 && digit === 1 && value > 1) words += 'เอ็ด';
    else words += DIGITS[digit] + PLACES[place];
  }
  return words;
}

/** Accept integer satang so decimal floating-point rounding never changes the receipt. */
export function thaiBahtWords(amountSatang: number): string {
  if (!Number.isSafeInteger(amountSatang) || amountSatang < 0) throw new RangeError('Expected non-negative integer satang');
  const baht = Math.floor(amountSatang / 100);
  const satang = amountSatang % 100;
  return (baht ? integerWords(baht) : 'ศูนย์') + 'บาท' + (satang ? integerWords(satang) + 'สตางค์' : 'ถ้วน');
}

export function formatSatang(amountSatang: number): string {
  return Math.floor(amountSatang / 100).toLocaleString('en-US') + '.' + String(amountSatang % 100).padStart(2, '0');
}

/** Inclusive 7% VAT, rounded to the nearest satang using exact integer arithmetic. */
export function inclusiveVatSatang(amountSatang: number): number {
  return Number((BigInt(amountSatang) * 7n + 53n) / 107n);
}
