import { checkForUpdate, getCurrentVersion } from './src/update.ts';

async function testUpdate() {
  console.log('Current version:', getCurrentVersion());
  const updateInfo = await checkForUpdate();
  console.log('Update info:', updateInfo);
}

testUpdate().catch(console.error);