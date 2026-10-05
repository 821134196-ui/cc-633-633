// 测试前准备：重建独立的 test.db 并推送表结构
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async () => {
  const serverDir = path.join(__dirname, '..');
  const dbPath = path.join(serverDir, 'prisma', 'test.db');
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {}
  }
  execSync('npx prisma db push --skip-generate --force-reset', {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });
};
