import { checkForUpdate, performUpdate } from './src/update.ts';

async function testAutoUpdate() {
  console.log('=== Testing Auto-Update Feature ===');
  
  // Step 1: Check for update
  const updateInfo = await checkForUpdate();
  console.log('Update check result:', updateInfo);
  
  if (updateInfo.outdated) {
    console.log('Update available. Attempting to perform update...');
    
    // Step 2: Perform update
    const success = await performUpdate();
    console.log('Update performed:', success);
    
    // Step 3: Verify update
    if (success) {
      console.log('Update successful. Verifying new version...');
      const newVersion = await checkForUpdate();
      console.log('New version info:', newVersion);
      
      if (!newVersion.outdated) {
        console.log('✓ Auto-update feature works correctly!');
        return true;
      } else {
        console.log('✗ Update failed - still showing as outdated');
        return false;
      }
    } else {
      console.log('✗ Update process failed');
      return false;
    }
  } else {
    console.log('No update available (already on latest version)');
    console.log('✓ Update check works correctly');
    return true;
  }
}

testAutoUpdate()
  .then(success => {
    console.log('\n=== Test Result ===');
    console.log(success ? 'PASS: Auto-update feature working' : 'FAIL: Auto-update feature not working');
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed with error:', error);
    process.exit(1);
  });