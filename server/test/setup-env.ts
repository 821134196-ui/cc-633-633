// 让被测应用连接独立的测试库（globalSetup 已建好表结构）
process.env.DATABASE_URL = 'file:./test.db';
process.env.UNIT_PRICE = '1.25';
process.env.JUMP_THRESHOLD = '500';
