import assert from 'node:assert/strict';
import { validateNickname } from '../../src/app/preferences/localPreferences';

const allowed = ['가나', '가나다라마바사', 'ab', 'ABC123', '12', '가A1'];
const rejected = ['', '가', '가나다라마바사아', ' 앞', '뒤 ', '가 나', '가\t나', '가\n나', '가!', '가😀', 'ㄱㄴ', 'ㅏㅑ', '가!A'];

for (const value of allowed) {
  assert.equal(validateNickname(value).valid, true, `허용되어야 함: ${value}`);
}

for (const value of rejected) {
  assert.equal(validateNickname(value).valid, false, `거부되어야 함: ${JSON.stringify(value)}`);
}
