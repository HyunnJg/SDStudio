const { engines, devDependencies } = require('../../package.json');
function checkToolchain(
  nodeVersion = process.versions.node,
  userAgent = process.env.npm_config_user_agent,
) {
  checkElectronUpgradePolicy();
  const [major, minor, patch] = nodeVersion.split('.').map(Number);
  if (major !== 26 || minor < 13 || (minor === 13 && patch < 1))
    throw Error(
      `Use Node ${engines.node}; found ${nodeVersion}. Select the project's .nvmrc version before installing.`,
    );
  const npm = userAgent?.match(/(?:^|\s)npm\/(\d+)\.(\d+)\.(\d+)/);
  if (
    npm &&
    (+npm[1] !== 11 || +npm[2] < 21 || (+npm[2] === 21 && +npm[3] < 3))
  )
    throw Error(`Use npm ${engines.npm}; found ${npm[1]}.${npm[2]}.${npm[3]}.`);
}
function checkElectronUpgradePolicy(version = devDependencies.electron) {
  if (!/^45\.\d+\.\d+$/.test(version))
    throw Error(
      'Keep Electron pinned to 45.x until asynchronous safeStorage and existing-ciphertext regression checks are complete before Electron 46.',
    );
}
module.exports = { checkToolchain, checkElectronUpgradePolicy };
if (require.main === module) checkToolchain();
