process.env.NODE_ENV ||= 'test'; // must be set before src/config/env.js loads

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inDailyWindow, minutesInZone } from '../src/utils/time.js';

const { maskPhone, normalizePhone, parseCallback, timestamp } = await import('../src/services/mpesa.js');

test('normalizes Kenyan mobile numbers for Daraja', () => {
  assert.equal(normalizePhone('0712 345 678'), '254712345678');
  assert.equal(normalizePhone('+254-712-345-678'), '254712345678');
  assert.equal(normalizePhone('254112345678'), '254112345678');
  assert.equal(normalizePhone('712345678'), '254712345678');
  assert.equal(normalizePhone('0112345678'), '254112345678');
  assert.equal(normalizePhone('0812345678'), null);
  assert.equal(normalizePhone('07123'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(maskPhone('254712345678'), '0712***678');
});

test('timestamps are Kenya time', () => {
  assert.equal(timestamp(new Date('2026-01-31T22:05:09Z')), '20260201010509');
});

test('parses STK callbacks', () => {
  const paid = parseCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: 'm1',
        CheckoutRequestID: 'ws_1',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 100 },
            { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
            { Name: 'TransactionDate', Value: 20191219102115 },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  });
  assert.deepEqual(paid, {
    checkoutRequestId: 'ws_1',
    merchantRequestId: 'm1',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
    amount: 100,
    receipt: 'NLJ7RT61SV',
    phone: '254712345678',
  });
  const cancelled = parseCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } });
  assert.equal(cancelled.resultCode, 1032);
  assert.equal(cancelled.receipt, undefined);
  assert.equal(parseCallback({}), null);
});

test('daily windows, including ones past midnight', () => {
  const at = (h, m = 0) => h * 60 + m;
  assert.equal(inDailyWindow(undefined, undefined, at(3)), true);
  assert.equal(inDailyWindow('08:00', '08:00', at(3)), true);
  assert.equal(inDailyWindow('18:00', '22:00', at(18)), true);
  assert.equal(inDailyWindow('18:00', '22:00', at(21, 59)), true);
  assert.equal(inDailyWindow('18:00', '22:00', at(22)), false);
  assert.equal(inDailyWindow('18:00', '22:00', at(9)), false);
  assert.equal(inDailyWindow('20:00', '02:00', at(23)), true);
  assert.equal(inDailyWindow('20:00', '02:00', at(1, 30)), true);
  assert.equal(inDailyWindow('20:00', '02:00', at(2)), false);
  assert.equal(minutesInZone(new Date('2026-03-01T17:30:00Z'), 'Africa/Nairobi'), at(20, 30));
});
