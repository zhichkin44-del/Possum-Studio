// Поддельный Electron safeStorage для тестов: обратимо «шифрует», открытого текста в результате нет.
export function fakeVault({ available = true } = {}) {
  const calls = { enc: 0, dec: 0 };
  return {
    calls,
    isEncryptionAvailable: () => available,
    encryptString(s) { calls.enc++; return Buffer.from(`ENC:${[...String(s)].reverse().join('')}`, 'utf8'); },
    decryptString(b) {
      calls.dec++;
      const t = Buffer.from(b).toString('utf8');
      if (!t.startsWith('ENC:')) throw new Error('не тот ключ шифрования');
      return [...t.slice(4)].reverse().join('');
    },
  };
}
